import {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  dialog,
  MessageChannelMain,
  safeStorage,
  clipboard,
  shell,
  session as electronSession,
  utilityProcess,
  type UtilityProcess,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from 'electron'
import { basename, join } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'
import { lstat, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  IPC,
  MAX_CLIPBOARD_BYTES,
  MAX_SESSIONS,
  appLocaleSchema,
  fontsListRequestSchema,
  hostInputSchema,
  idSchema,
  knownHostRemoveSchema,
  netProbeSchema,
  openSessionSchema,
  portCheckSchema,
  sftpCancelTransferSchema,
  sftpChmodSchema,
  sftpDeleteSchema,
  sftpDownloadSchema,
  sftpExpandLocalSchema,
  sftpPathRequestSchema,
  sftpPickDownloadFileSchema,
  sftpRenameSchema,
  sftpRevealLocalSchema,
  sftpSessionSchema,
  sftpUploadSchema,
  trayPreferencesPatchSchema,
  tunnelToggleSchema,
  type AppLocale,
  type Bootstrap,
  type EncryptionBackend,
  type Host,
  type HostTrust,
  type KnownHostEntry,
  type ShellProfile,
  type SyncDataUpdate
} from '../shared/contracts'
import {
  sanitizeDownloadFilename,
  type SftpExpandedUploadManifest,
  type SftpProgressEvent
} from '../shared/sftp'
import {
  syncGroupInputSchema,
  syncListRevisionsInputSchema,
  syncLoginInputSchema,
  syncPreferencesUpdateSchema,
  syncRegisterInputSchema,
  syncResolveConflictsSchema,
  syncRestoreRevisionInputSchema,
  syncTunnelInputSchema,
  syncVaultCreateInputSchema,
  syncVaultRecoverInputSchema,
  syncVaultUnlockInputSchema,
  type SyncGroup,
  type SyncStatusSnapshot,
  type SyncTunnel
} from '../shared/sync'
import {
  fileCancelTransferSchema,
  fileChmodRequestSchema,
  fileConnectSchema,
  fileDeleteRequestSchema,
  fileDownloadRequestSchema,
  filePathRequestSchema,
  fileProfileIdSchema,
  fileProfileInputSchema,
  fileRenameRequestSchema,
  fileSessionIdSchema,
  fileUploadRequestSchema,
  protocolSettingsPatchSchema,
  type AllProtocolSettings,
  type FileProfile
} from '../shared/files'
import {
  rdpCertDecisionSchema,
  rdpConnectSourceSchema,
  rdpKnownHostRemoveSchema,
  rdpProfileInputSchema,
  rdpSessionIdSchema
} from '../shared/rdp'
import { DataClient } from './data-client'
import { DiagnosticLog } from './diagnostics'
import { FilesService } from './files-service'
import { discoverSystemFonts } from './fonts'
import { authorizeSender, createIpcRegistrar, isTrustedRendererUrl } from './ipc-auth'
import { RdpService } from './rdp/service'
import { discoverShells } from './shells'
import { SyncService } from './sync-service'
import { OrbitTrayManager } from './tray-manager'
import { probeTcpConnectivity, TunnelRuntimeManager } from './tunnel-network'
import { OrbitUpdateService } from './update-service'
import { lookupOpenSshKnownHost } from './openssh-known-hosts'
import { updatePreferencesPatchSchema, type UpdateStatusSnapshot } from '../shared/updater'

function resolveEncryptionBackend(): EncryptionBackend {
  if (process.platform === 'win32') return 'dpapi'
  if (process.platform === 'darwin') return 'keychain'
  if (process.platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function') {
    try {
      return safeStorage.getSelectedStorageBackend()
    } catch {
      return 'unknown'
    }
  }
  return 'unknown'
}

async function isEncryptionUsable(): Promise<boolean> {
  try {
    const available = await safeStorage.isAsyncEncryptionAvailable()
    if (!available) return false
    if (process.platform === 'linux' && resolveEncryptionBackend() === 'basic_text') {
      return false
    }
    return true
  } catch {
    return false
  }
}

if (process.env.ORBIT_USER_DATA) app.setPath('userData', process.env.ORBIT_USER_DATA)
const windows = new Map<number, BrowserWindow>()
let repository: DataClient
let filesService: FilesService
let rdpService: RdpService
let syncService: SyncService
let tunnelRuntime: TunnelRuntimeManager
let trayManager: OrbitTrayManager | undefined
let updateService: OrbitUpdateService | undefined
let diagnostics: DiagnosticLog
let profiles: ShellProfile[] = []
let syncPhaseLabel = '本地工作区'
let currentLocale: AppLocale = 'zh-CN'
const workers = new Map<'local' | 'ssh', UtilityProcess>()
const sessions = new Map<string, { owner: number; kind: 'local' | 'ssh'; host?: Host; pid?: number }>()
const challenges = new Map<string, HostTrust>()
const pendingSftpRequests = new Map<
  string,
  {
    sessionId: string
    ownerWindowId?: number
    isTransfer?: boolean
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timer?: NodeJS.Timeout
  }
>()

function countActiveSftpTransfers(ownerWindowId?: number): number {
  let count = 0
  for (const pending of pendingSftpRequests.values()) {
    if (!pending.isTransfer) continue
    if (ownerWindowId !== undefined && pending.ownerWindowId !== ownerWindowId) continue
    count++
  }
  return count
}

function countActiveAllTransfers(ownerWindowId?: number): number {
  return countActiveSftpTransfers(ownerWindowId) + (filesService?.getActiveTransferCount(ownerWindowId) ?? 0)
}
let pendingSessionOpens = 0
let quitting = false
let shuttingDown = false

const rendererPath = join(__dirname, '../renderer/index.html')
const rendererUrl = process.env.ELECTRON_RENDERER_URL

function trustedUrl(url: string): boolean {
  return isTrustedRendererUrl(url, { rendererUrl, rendererPath })
}

function authorize(event: IpcMainInvokeEvent | IpcMainEvent): BrowserWindow {
  return authorizeSender(event, {
    getOwner: (sender) => BrowserWindow.fromWebContents(sender as Electron.WebContents),
    hasWindow: (id) => windows.has(id),
    getMainFrame: (sender) => (sender as Electron.WebContents).mainFrame,
    urlConfig: { rendererUrl, rendererPath }
  })
}

function rejectPendingSftpForSession(sessionId: string, reason: string): void {
  for (const [requestId, pending] of pendingSftpRequests) {
    if (pending.sessionId === sessionId) {
      pendingSftpRequests.delete(requestId)
      if (pending.timer) clearTimeout(pending.timer)
      pending.reject(new Error(reason))
    }
  }
}

function closeSession(id: string): void {
  const session = sessions.get(id)
  if (!session) return
  rejectPendingSftpForSession(id, 'SSH 会话已关闭')
  workers.get(session.kind)?.postMessage({ type: 'close', id })
  sessions.delete(id)
  challenges.delete(id)
  trayManager?.refresh()
}

function formatSyncPhaseLabel(status: SyncStatusSnapshot): string {
  if (status.phase === 'synced')
    return status.lastRevision ? `已同步 rev-${status.lastRevision}` : '云端已同步'
  if (status.phase === 'syncing') return '云同步中'
  if (status.phase === 'vault-locked') return '保管库已锁定'
  if (status.phase === 'conflict') return `同步冲突 (${status.conflicts.length})`
  if (status.phase === 'offline') return '离线模式'
  if (status.phase === 'signed-out') return '未登录同步'
  return '本地工作区'
}

function getWorker(kind: 'local' | 'ssh'): UtilityProcess {
  const existing = workers.get(kind)
  if (existing) return existing
  const worker = utilityProcess.fork(
    join(__dirname, kind === 'local' ? 'local-pty.js' : 'connection.js'),
    [],
    { serviceName: kind === 'local' ? 'Orbit Local PTY' : 'Orbit SSH', stdio: 'pipe' }
  )
  workers.set(kind, worker)
  worker.stderr?.on('data', (chunk: Buffer) => diagnostics?.write(`${kind}-worker`, chunk.toString('utf8')))
  worker.on('message', async (data) => {
    if (data.type === 'sftp:response') {
      const pending = pendingSftpRequests.get(data.requestId)
      if (!pending) return
      pendingSftpRequests.delete(data.requestId)
      if (pending.timer) clearTimeout(pending.timer)
      if (data.ok) pending.resolve(data.result)
      else pending.reject(new Error(typeof data.error === 'string' ? data.error : 'SFTP 操作失败'))
      return
    }
    if (data.type === 'sftp:progress') {
      const progress = data as SftpProgressEvent & { type: 'sftp:progress' }
      const s = sessions.get(progress.sessionId)
      if (!s) return
      const win = windows.get(s.owner)
      if (win && !win.isDestroyed()) win.webContents.send(IPC.sftpProgress, progress)
      return
    }
    const session = sessions.get(data.id)
    if (!session) return
    const ownerWindow = windows.get(session.owner)
    if (data.type === 'spawned') session.pid = data.pid
    if (data.type === 'closed') {
      rejectPendingSftpForSession(data.id, 'SSH 会话已断开')
      sessions.delete(data.id)
      challenges.delete(data.id)
      trayManager?.refresh()
    }
    if (data.type === 'verify' && session.host) {
      try {
        const known = await repository.call<{ fingerprint: string; algorithm: string } | undefined>(
          'known',
          session.host.address,
          session.host.port
        )
        if (!sessions.has(data.id)) return
        if (known && known.fingerprint === data.fingerprint && known.algorithm === data.algorithm)
          worker.postMessage({ type: 'verify', id: data.id, accept: true })
        else {
          const openSshKnown = !known
            ? lookupOpenSshKnownHost(
                session.host.address,
                session.host.port,
                data.fingerprint,
                data.algorithm
              )
            : undefined
          if (
            !known &&
            openSshKnown &&
            openSshKnown.fingerprint === data.fingerprint &&
            openSshKnown.algorithm === data.algorithm
          ) {
            await repository.call(
              'trust',
              session.host.address,
              session.host.port,
              data.fingerprint,
              data.algorithm,
              undefined,
              'openssh'
            )
            worker.postMessage({ type: 'verify', id: data.id, accept: true })
            return
          }
          const challenge: HostTrust = {
            sessionId: data.id,
            address: session.host.address,
            port: session.host.port,
            fingerprint: data.fingerprint,
            algorithm: data.algorithm,
            previous: known?.fingerprint ?? openSshKnown?.fingerprint
          }
          challenges.set(data.id, challenge)
          ownerWindow?.webContents.send(IPC.trustRequest, challenge)
        }
      } catch {
        worker.postMessage({ type: 'verify', id: data.id, accept: false })
      }
    }
  })
  worker.on('exit', (code) => {
    workers.delete(kind)
    if (code !== 0 && !shuttingDown) {
      diagnostics?.write(`${kind}-worker`, `worker exited abnormally with code ${code}`)
    }
    for (const [id, session] of sessions) {
      if (session.kind === kind) {
        rejectPendingSftpForSession(id, 'SSH 后台进程已退出')
        windows
          .get(session.owner)
          ?.webContents.send(IPC.sessionFailure, { id, message: '终端后台进程已退出，请新建会话。' })
        sessions.delete(id)
        challenges.delete(id)
      }
    }
    trayManager?.refresh()
  })
  return worker
}

function callSftpWorker(
  owner: BrowserWindow,
  sessionId: string,
  payload: Record<string, unknown>,
  timeoutMs = 30_000,
  isTransfer = false
): Promise<unknown> {
  const session = sessions.get(sessionId)
  if (!session || session.owner !== owner.id || session.kind !== 'ssh') {
    return Promise.reject(new Error('当前终端未连接活跃 SSH 会话，无法使用 SFTP'))
  }
  const requestId = randomUUID()
  const worker = getWorker('ssh')
  return new Promise((resolve, reject) => {
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            pendingSftpRequests.delete(requestId)
            reject(new Error('SFTP 操作超时，请检查网络连接'))
          }, timeoutMs)
        : undefined
    pendingSftpRequests.set(requestId, {
      sessionId,
      ownerWindowId: owner.id,
      isTransfer,
      resolve,
      reject,
      timer
    })
    worker.postMessage({ type: 'sftp:request', requestId, sessionId, ...payload })
  })
}

async function expandLocalUploadPaths(localPaths: string[]): Promise<SftpExpandedUploadManifest> {
  const MAX_ENTRIES = 5000
  const dirs: string[] = []
  const files: SftpExpandedUploadManifest['files'] = []
  let skippedSymlinks = 0
  let count = 0

  async function walkDir(fullDir: string, relBase: string): Promise<void> {
    const entries = await readdir(fullDir, { withFileTypes: true })
    for (const entry of entries) {
      if (++count > MAX_ENTRIES) {
        throw new Error(`单次上传项目超过 ${MAX_ENTRIES} 个上限，请分批传输`)
      }
      const fullChild = join(fullDir, entry.name)
      const relChild = `${relBase}/${entry.name}`
      if (entry.isSymbolicLink()) {
        skippedSymlinks++
        continue
      }
      if (entry.isDirectory()) {
        dirs.push(relChild)
        await walkDir(fullChild, relChild)
      } else if (entry.isFile()) {
        const st = await lstat(fullChild)
        files.push({ localPath: fullChild, relativePath: relChild, name: entry.name, size: st.size })
      }
    }
  }

  for (const rawPath of localPaths) {
    if (++count > MAX_ENTRIES) {
      throw new Error(`单次上传项目超过 ${MAX_ENTRIES} 个上限，请分批传输`)
    }
    const st = await lstat(rawPath)
    if (st.isSymbolicLink()) {
      skippedSymlinks++
      continue
    }
    const name = basename(rawPath)
    if (!name) continue
    if (st.isDirectory()) {
      dirs.push(name)
      await walkDir(rawPath, name)
    } else if (st.isFile()) {
      files.push({ localPath: rawPath, relativePath: name, name, size: st.size })
    }
  }
  return { dirs, files, skippedSymlinks }
}

function registerSessionSecurity(): void {
  const defaultSession = electronSession.defaultSession
  defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
    if (permission === 'clipboard-read' || permission === 'clipboard-sanitized-write') {
      const owner = BrowserWindow.fromWebContents(contents)
      const allowed = Boolean(
        owner && windows.has(owner.id) && owner.isFocused() && trustedUrl(contents.getURL())
      )
      callback(allowed)
      return
    }
    callback(false)
  })
  defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const devOrigin = rendererUrl ? new URL(rendererUrl).origin : ''
    const connect = [
      ...(devOrigin ? [devOrigin, devOrigin.replace(/^http/, 'ws')] : []),
      'data:',
      'ws://127.0.0.1:*'
    ].join(' ')
    const styleSrc = "style-src 'self' 'unsafe-inline'"
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; ${styleSrc}; img-src 'self' data:; font-src 'self' data:; connect-src ${connect}; object-src 'none'; base-uri 'none'; frame-src 'none'`
        ]
      }
    })
  })
}

function registerIpc(): void {
  const ipc = createIpcRegistrar(ipcMain, authorize)
  const clipboardWriteSchema = z
    .string()
    .refine((v) => Buffer.byteLength(v, 'utf8') <= MAX_CLIPBOARD_BYTES, '复制内容超过 1 MiB 限制')
  const openExternalSchema = z.string().min(1).max(2048)
  const revokeDeviceSchema = z.string().min(1).max(200)
  const trustDecisionSchema = z.object({ id: idSchema, accept: z.boolean() }).strict()
  const windowActionSchema = z.enum(['minimize', 'maximize', 'close', 'hide-to-tray', 'restore-from-tray'])
  const defaultTrayState = {
    minimizeToTray: true,
    closeToTray: false,
    closeAction: 'quit' as const,
    trayVisibility: 'when-minimized' as const,
    trayCreated: false,
    windowHiddenToTray: false
  }
  const requireUpdateService = (): OrbitUpdateService => {
    if (!updateService) throw new Error('更新服务尚未就绪')
    return updateService
  }
  const handleSftp = <TSchema extends z.ZodType<Record<string, unknown> & { sessionId: string }>>(
    channel: string,
    schema: TSchema,
    action: string,
    timeoutMs?: number
  ): void => {
    ipc.handleSchema(channel, schema, async (input, owner) => {
      const { sessionId, ...rest } = input
      const isTransfer = action === 'upload' || action === 'download'
      let payload: Record<string, unknown> = { action, ...rest }
      if (isTransfer) {
        const settings = await filesService?.getProtocolSettings().catch(() => undefined)
        const speedLimitBps = Math.max(0, settings?.files.speedLimitKBps ?? 0) * 1024
        payload = { ...payload, speedLimitBps }
      }
      return callSftpWorker(owner, sessionId, payload, timeoutMs, isTransfer)
    })
  }

  ipc.handle(
    IPC.clipboardRead,
    async () => {
      const text = await clipboard.readText()
      if (Buffer.byteLength(text, 'utf8') > MAX_CLIPBOARD_BYTES)
        throw new Error('剪贴板文本超过 1 MiB 限制，请分批粘贴。')
      return text
    },
    { requireFocused: true }
  )
  ipc.handleSchema(IPC.clipboardWrite, clipboardWriteSchema, (text) => clipboard.writeText(text), {
    requireFocused: true
  })
  ipc.handleSchema(
    IPC.openExternal,
    openExternalSchema,
    async (urlText, owner) => {
      let parsed: URL
      try {
        parsed = new URL(urlText)
      } catch {
        throw new Error('无效的链接地址')
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('出于安全限制，仅允许在浏览器中打开 http/https 链接。')
      }
      const en = currentLocale === 'en-US'
      const { response } = await dialog.showMessageBox(owner, {
        type: 'question',
        title: en ? 'Open External Link?' : '打开外部链接？',
        message: en
          ? 'Open this terminal link in your default system browser?'
          : '确认在系统默认浏览器中打开此终端链接？',
        detail: parsed.href,
        buttons: en ? ['Cancel', 'Open in Browser'] : ['取消', '在浏览器中打开'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      })
      if (response === 1) await shell.openExternal(parsed.href)
    },
    { requireFocused: true }
  )
  ipc.handleSchema(IPC.localeSet, appLocaleSchema, (nextLocale) => {
    currentLocale = nextLocale
    trayManager?.setLocale(nextLocale)
  })
  ipc.handleSchema(IPC.fontsListSystem, fontsListRequestSchema, (refresh) =>
    discoverSystemFonts(Boolean(refresh))
  )
  ipc.handle(IPC.bootstrap, async (owner) => {
    const [
      hosts,
      groups,
      tunnels,
      fileProfiles,
      rdpProfiles,
      knownRdpHosts,
      rdpProbe,
      protocolSettings,
      sync
    ] = await Promise.all([
      repository.call<Host[]>('list'),
      repository.call<SyncGroup[]>('groupsList'),
      repository.call<SyncTunnel[]>('tunnelsList'),
      filesService.listProfiles(),
      rdpService.listProfiles(),
      rdpService.listKnownHosts(),
      rdpService.probe(false),
      filesService.getProtocolSettings(),
      syncService.getStatus()
    ])
    return {
      windowId: `w${owner.id}`,
      platform: process.platform,
      hosts,
      groups,
      tunnels,
      fileProfiles,
      rdpProfiles,
      knownRdpHosts,
      rdpProbe,
      protocolSettings,
      sync,
      shells: profiles,
      home: homedir(),
      encryptionAvailable: await isEncryptionUsable(),
      encryptionBackend: resolveEncryptionBackend(),
      maximized: owner.isMaximized(),
      tray: trayManager?.getState() ?? defaultTrayState,
      update: updateService!.getState(),
      versions: {
        app: app.getVersion(),
        electron: process.versions.electron,
        node: process.versions.node,
        chrome: process.versions.chrome,
        modules: process.versions.modules
      }
    } satisfies Bootstrap
  })
  ipc.handle(IPC.shellsRefresh, async () => {
    profiles = await discoverShells()
    return profiles
  })
  ipc.handleSchema(IPC.hostSave, hostInputSchema, async (input) => {
    let encrypted: Buffer | undefined
    if (input.password && input.savePassword && input.auth === 'password') {
      if (!(await isEncryptionUsable())) {
        throw new Error(
          process.platform === 'linux'
            ? '当前 Linux 系统未检测到可用的 Keyring（gnome-keyring / kwallet），无法安全保存密码；请取消勾选保存并在连接时输入临时密码。'
            : '系统凭据保护不可用，不能保存密码。'
        )
      }
      encrypted = await safeStorage.encryptStringAsync(input.password)
    }
    syncService.markLocalMutation()
    const hosts = await repository.call<Host[]>('save', { ...input, password: undefined }, encrypted)
    syncService.scheduleAutoSync(true)
    return hosts
  })
  ipc.handleSchema(IPC.hostRemove, idSchema, async (id) => {
    syncService.markLocalMutation()
    const hosts = await repository.call<Host[]>('remove', id)
    syncService.scheduleAutoSync(true)
    return hosts
  })
  ipc.handleSchema(IPC.groupSave, syncGroupInputSchema, async (input) => {
    syncService.markLocalMutation()
    const groups = await repository.call<SyncGroup[]>('groupSave', input)
    syncService.scheduleAutoSync(true)
    return groups
  })
  ipc.handleSchema(IPC.groupRemove, idSchema, async (id) => {
    syncService.markLocalMutation()
    const groups = await repository.call<SyncGroup[]>('groupRemove', id)
    syncService.scheduleAutoSync(true)
    return groups
  })
  ipc.handleSchema(IPC.tunnelSave, syncTunnelInputSchema, async (input) => {
    syncService.markLocalMutation()
    const tunnels = await repository.call<SyncTunnel[]>('tunnelSave', input)
    syncService.scheduleAutoSync(true)
    return tunnels
  })
  ipc.handleSchema(IPC.tunnelRemove, idSchema, async (id) => {
    await tunnelRuntime.stop(id)
    syncService.markLocalMutation()
    const tunnels = await repository.call<SyncTunnel[]>('tunnelRemove', id)
    syncService.scheduleAutoSync(true)
    trayManager?.refresh()
    return tunnels
  })
  ipc.handle(IPC.tunnelStatuses, async () => {
    const tunnels = await repository.call<SyncTunnel[]>('tunnelsList')
    return tunnelRuntime.listStatuses(tunnels)
  })
  ipc.handleSchema(IPC.tunnelToggle, tunnelToggleSchema, async ({ id, active }) => {
    const tunnels = await repository.call<SyncTunnel[]>('tunnelsList')
    const tunnel = tunnels.find((item) => item.id === id)
    if (!tunnel) throw new Error('端口转发规则不存在，请刷新列表。')
    await tunnelRuntime.toggle(tunnel, active)
    syncService.markLocalMutation()
    await repository.call<SyncTunnel[]>('tunnelSave', {
      id: tunnel.id,
      name: tunnel.name,
      serverId: tunnel.serverId,
      groupId: tunnel.groupId ?? null,
      type: tunnel.type === 'R' ? 'R' : tunnel.type === 'D' ? 'D' : 'L',
      listenHost: tunnel.listenHost,
      listenPort: tunnel.listenPort,
      destHost: tunnel.destHost,
      destPort: tunnel.destPort,
      destServerId: tunnel.destServerId ?? null,
      autoReconnect: tunnel.autoReconnect,
      enabled: active
    })
    const updatedTunnels = await repository.call<SyncTunnel[]>('tunnelsList')
    trayManager?.refresh()
    return tunnelRuntime.listStatuses(updatedTunnels)
  })
  ipc.handleSchema(IPC.netProbe, netProbeSchema, (input) => probeTcpConnectivity(input))
  ipc.handleSchema(IPC.portCheck, portCheckSchema, (input) => tunnelRuntime.checkLocalPort(input))
  ipc.handle(IPC.knownHostsList, () => repository.call<KnownHostEntry[]>('knownHostsList'))
  ipc.handleSchema(IPC.knownHostsRemove, knownHostRemoveSchema, ({ hostKey }) =>
    repository.call<KnownHostEntry[]>('knownHostsRemove', hostKey)
  )
  ipc.handle(IPC.syncStatus, () => syncService.getStatus())
  ipc.handle(IPC.syncDefaults, () => syncService.getDefaults())
  ipc.handleSchema(IPC.syncRegister, syncRegisterInputSchema, (input) => syncService.register(input))
  ipc.handleSchema(IPC.syncLogin, syncLoginInputSchema, (input) => syncService.login(input))
  ipc.handle(IPC.syncLogout, () => syncService.logout())
  ipc.handleSchema(IPC.syncVaultCreate, syncVaultCreateInputSchema, (input) => syncService.createVault(input))
  ipc.handleSchema(IPC.syncVaultUnlock, syncVaultUnlockInputSchema, (input) => syncService.unlockVault(input))
  ipc.handleSchema(IPC.syncVaultRecover, syncVaultRecoverInputSchema, (input) =>
    syncService.recoverVault(input)
  )
  ipc.handle(IPC.syncVaultLock, () => syncService.lockVault())
  ipc.handle(IPC.syncRun, () => syncService.syncNow())
  ipc.handleSchema(IPC.syncResolveConflicts, syncResolveConflictsSchema, ({ resolutions }) =>
    syncService.resolveConflicts(resolutions)
  )
  ipc.handleSchema(IPC.syncUpdatePreferences, syncPreferencesUpdateSchema, (input) =>
    syncService.updatePreferences(input)
  )
  ipc.handle(IPC.syncListDevices, () => syncService.listDevices())
  ipc.handleSchema(IPC.syncRevokeDevice, revokeDeviceSchema, (deviceId) => syncService.revokeDevice(deviceId))
  ipc.handleSchema(IPC.syncListRevisions, syncListRevisionsInputSchema, (input) => {
    const ns = typeof input === 'string' ? input : input?.namespace
    return syncService.listRevisions(ns ?? 'core')
  })
  ipc.handleSchema(IPC.syncRestoreRevision, syncRestoreRevisionInputSchema, (input) => {
    if (typeof input === 'string') return syncService.restoreRevision(input, 'core')
    return syncService.restoreRevision(input.revision, input.namespace ?? 'core')
  })
  ipc.handleSchema(IPC.sessionOpen, openSessionSchema, async (input, owner) => {
    if (sessions.size + pendingSessionOpens >= MAX_SESSIONS)
      throw new Error(`最多同时打开 ${MAX_SESSIONS} 个会话，请先关闭不再使用的会话。`)
    pendingSessionOpens++
    try {
      const id = randomUUID()
      let spec: Record<string, unknown>, title: string, host: Host | undefined
      if (input.kind === 'local') {
        const profile = profiles.find((item) => item.id === input.profileId)
        if (!profile) throw new Error('Shell 不可用，请刷新本地终端配置或重新打开应用。')
        const cwd = existsSync(homedir()) ? homedir() : process.cwd()
        title = profile.name
        spec = { executable: profile.executable, args: profile.args, cwd }
      } else {
        const record = await repository.call<{ host: Host; secret?: Uint8Array }>('get', input.hostId)
        host = record.host
        title = host.name
        let password = input.password
        if (host.auth === 'password' && password === undefined && record.secret) {
          try {
            const decrypted = await safeStorage.decryptStringAsync(Buffer.from(record.secret))
            password = decrypted.result
            if (decrypted.shouldReEncrypt && (await isEncryptionUsable()))
              await repository.call('updateSecret', host.id, await safeStorage.encryptStringAsync(password))
          } catch {
            throw new Error('无法解锁已保存的密码（系统 Keyring / 凭据保护不可用），请重新输入本次连接密码。')
          }
        }
        if (host.auth === 'password' && password === undefined) throw new Error('请输入本次连接密码。')
        spec = { host, password, mode: input.mode ?? 'shell' }
      }
      if (owner.isDestroyed()) throw new Error('窗口已关闭')
      const worker = getWorker(input.kind)
      const { port1, port2 } = new MessageChannelMain()
      sessions.set(id, { owner: owner.id, kind: input.kind, host })
      worker.postMessage({ ...spec, type: 'open', id, cols: input.cols, rows: input.rows }, [port1])
      owner.webContents.postMessage(IPC.port, { requestId: input.requestId, sessionId: id, generation: 1 }, [
        port2
      ])
      trayManager?.refresh()
      return { id, generation: 1, title, kind: input.kind }
    } finally {
      pendingSessionOpens--
    }
  })
  ipc.handleSchema(IPC.sessionClose, idSchema, (id, owner) => {
    if (sessions.get(id)?.owner === owner.id) closeSession(id)
  })
  ipc.handleSchema(IPC.trust, trustDecisionSchema, async ({ id, accept }, owner) => {
    const request = challenges.get(id)
    if (!request || sessions.get(id)?.owner !== owner.id) throw new Error('主机校验请求已过期，请重新连接。')
    challenges.delete(id)
    if (accept)
      await repository.call('trust', request.address, request.port, request.fingerprint, request.algorithm)
    workers.get('ssh')?.postMessage({ type: 'verify', id, accept })
  })
  handleSftp(IPC.sftpHome, sftpSessionSchema, 'home')
  handleSftp(IPC.sftpList, sftpPathRequestSchema, 'list')
  handleSftp(IPC.sftpStat, sftpPathRequestSchema, 'stat')
  handleSftp(IPC.sftpCollectTree, sftpPathRequestSchema, 'collectTree', 60_000)
  handleSftp(IPC.sftpMkdir, sftpPathRequestSchema, 'mkdir')
  handleSftp(IPC.sftpRename, sftpRenameSchema, 'rename')
  handleSftp(IPC.sftpChmod, sftpChmodSchema, 'chmod')
  handleSftp(IPC.sftpDelete, sftpDeleteSchema, 'delete', 120_000)
  handleSftp(IPC.sftpUpload, sftpUploadSchema, 'upload', 0)
  handleSftp(IPC.sftpDownload, sftpDownloadSchema, 'download', 0)
  ipc.handleSchema(IPC.sftpCancelTransfer, sftpCancelTransferSchema, ({ sessionId, transferId }, owner) => {
    const session = sessions.get(sessionId)
    if (session && session.owner === owner.id && session.kind === 'ssh') {
      workers.get('ssh')?.postMessage({ type: 'sftp:cancel', sessionId, transferId })
    }
  })
  ipc.handle(IPC.sftpPickUploadFiles, async (owner) => {
    const res = await dialog.showOpenDialog(owner, {
      title: '选择要上传的本地文件',
      properties: ['openFile', 'multiSelections']
    })
    return res.canceled ? [] : res.filePaths
  })
  ipc.handle(IPC.sftpPickUploadDirs, async (owner) => {
    const res = await dialog.showOpenDialog(owner, {
      title: '选择要上传的本地文件夹',
      properties: ['openDirectory', 'multiSelections']
    })
    return res.canceled ? [] : res.filePaths
  })
  ipc.handle(IPC.sftpPickDownloadDir, async (owner) => {
    const res = await dialog.showOpenDialog(owner, {
      title: '选择本地保存目录',
      defaultPath: app.getPath('downloads'),
      properties: ['openDirectory', 'createDirectory']
    })
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })
  ipc.handleSchema(IPC.sftpPickDownloadFile, sftpPickDownloadFileSchema, async ({ defaultName }, owner) => {
    const safeName = sanitizeDownloadFilename(defaultName)
    const res = await dialog.showSaveDialog(owner, {
      title: '保存远端文件到本地',
      defaultPath: join(app.getPath('downloads'), safeName)
    })
    return res.canceled ? null : (res.filePath ?? null)
  })
  ipc.handleSchema(IPC.sftpExpandLocalUploads, sftpExpandLocalSchema, ({ localPaths }) =>
    expandLocalUploadPaths(localPaths)
  )
  ipc.handleSchema(IPC.sftpRevealLocal, sftpRevealLocalSchema, ({ localPath }) => {
    if (!existsSync(localPath)) return false
    shell.showItemInFolder(localPath)
    return true
  })

  const handleFiles = <TSchema extends z.ZodType<Record<string, unknown> & { sessionId: string }>>(
    channel: string,
    schema: TSchema,
    action: string,
    timeoutMs?: number
  ): void => {
    ipc.handleSchema(channel, schema, (input, owner) => {
      const { sessionId, ...rest } = input
      return filesService.callSession(owner.id, sessionId, action, rest, timeoutMs)
    })
  }
  ipc.handle(IPC.fileProfilesList, (): Promise<FileProfile[]> => filesService.listProfiles())
  ipc.handleSchema(IPC.fileProfileSave, fileProfileInputSchema, async (input) => {
    syncService.markLocalMutation()
    const next = await filesService.saveProfile(input)
    syncService.scheduleAutoSync(true)
    return next
  })
  ipc.handleSchema(IPC.fileProfileRemove, idSchema, async (id) => {
    syncService.markLocalMutation()
    const next = await filesService.removeProfile(id)
    syncService.scheduleAutoSync(true)
    return next
  })
  ipc.handle(IPC.protocolSettingsGet, (): Promise<AllProtocolSettings> => filesService.getProtocolSettings())
  ipc.handleSchema(IPC.protocolSettingsPatch, protocolSettingsPatchSchema, async (patch) => {
    syncService.markLocalMutation()
    const next = await filesService.patchProtocolSettings(patch)
    if (patch.namespace === 'rdp') rdpService.invalidateProbeCache()
    syncService.scheduleAutoSync(true)
    return next
  })
  ipc.handleSchema(IPC.filesConnect, fileConnectSchema, (source, owner) =>
    filesService.connect(owner.id, source)
  )
  ipc.handleSchema(IPC.filesClose, fileSessionIdSchema, ({ sessionId }, owner) =>
    filesService.closeSession(owner.id, sessionId)
  )
  handleFiles(IPC.filesHome, fileSessionIdSchema, 'home')
  handleFiles(IPC.filesList, filePathRequestSchema, 'list')
  handleFiles(IPC.filesStat, filePathRequestSchema, 'stat')
  handleFiles(IPC.filesCollectTree, filePathRequestSchema, 'collectTree', 60_000)
  handleFiles(IPC.filesMkdir, filePathRequestSchema, 'mkdir')
  handleFiles(IPC.filesRename, fileRenameRequestSchema, 'rename')
  handleFiles(IPC.filesChmod, fileChmodRequestSchema, 'chmod')
  handleFiles(IPC.filesDelete, fileDeleteRequestSchema, 'delete', 120_000)
  handleFiles(IPC.filesUpload, fileUploadRequestSchema, 'upload', 0)
  handleFiles(IPC.filesDownload, fileDownloadRequestSchema, 'download', 0)
  ipc.handleSchema(IPC.filesCancelTransfer, fileCancelTransferSchema, ({ sessionId, transferId }, owner) =>
    filesService.cancelTransfer(owner.id, sessionId, transferId)
  )
  void fileProfileIdSchema
  ipc.handleSchema(IPC.rdpProbe, fontsListRequestSchema, (refresh) => rdpService.probe(Boolean(refresh)))
  ipc.handle(IPC.rdpProfilesList, () => rdpService.listProfiles())
  ipc.handleSchema(IPC.rdpProfileSave, rdpProfileInputSchema, async (input) => {
    syncService.markLocalMutation()
    const next = await rdpService.saveProfile(input)
    syncService.scheduleAutoSync(true)
    return next
  })
  ipc.handleSchema(IPC.rdpProfileRemove, idSchema, async (id) => {
    syncService.markLocalMutation()
    const next = await rdpService.removeProfile(id)
    syncService.scheduleAutoSync(true)
    return next
  })
  ipc.handle(IPC.rdpKnownHostsList, () => rdpService.listKnownHosts())
  ipc.handleSchema(IPC.rdpKnownHostRemove, rdpKnownHostRemoveSchema, async ({ id }) => {
    syncService.markLocalMutation()
    const next = await rdpService.removeKnownHost(id)
    syncService.scheduleAutoSync(true)
    return next
  })
  ipc.handleSchema(IPC.rdpConnect, rdpConnectSourceSchema, (source, owner) =>
    rdpService.connect(owner.id, source)
  )
  ipc.handleSchema(
    IPC.rdpSetDisplayVisible,
    rdpSessionIdSchema.extend({ visible: z.boolean() }),
    (input, owner) => rdpService.setDisplayVisible(owner.id, input.sessionId, input.visible)
  )
  ipc.handleSchema(IPC.rdpDisconnect, rdpSessionIdSchema, ({ sessionId }, owner) =>
    rdpService.disconnect(owner.id, sessionId)
  )
  ipc.handleSchema(IPC.rdpCertDecision, rdpCertDecisionSchema, async ({ promptId, accept }, owner) => {
    if (accept) syncService.markLocalMutation()
    await rdpService.decideCertPrompt(owner.id, promptId, accept)
    if (accept) syncService.scheduleAutoSync(true)
  })
  ipc.handle(IPC.trayState, () => trayManager?.getState() ?? defaultTrayState)
  ipc.handleSchema(IPC.trayUpdatePreferences, trayPreferencesPatchSchema, (patch) => {
    if (!trayManager) throw new Error('系统托盘尚未就绪')
    return trayManager.updatePreferences(patch)
  })
  ipc.handle(IPC.updateState, () => requireUpdateService().getState())
  ipc.handle(IPC.updateCheck, () => requireUpdateService().checkForUpdates({ silent: false }))
  ipc.handle(IPC.updateDownload, () => requireUpdateService().downloadUpdate())
  ipc.handle(IPC.updateCancelDownload, () => requireUpdateService().cancelDownload())
  ipc.handle(IPC.updateInstall, () => requireUpdateService().installUpdate())
  ipc.handle(IPC.updateRevealFile, () => requireUpdateService().revealDownloadedFile())
  ipc.handle(IPC.updateOpenReleasePage, () => requireUpdateService().openReleasePage())
  ipc.handleSchema(IPC.updateUpdatePreferences, updatePreferencesPatchSchema, (patch) =>
    requireUpdateService().updatePreferences(patch)
  )
  ipc.handle(IPC.windowIsMaximized, (owner) => owner.isMaximized())
  ipc.on(IPC.window, (rawAction, owner) => {
    const parsed = windowActionSchema.safeParse(rawAction)
    if (!parsed.success) return
    const action = parsed.data
    if (action === 'minimize') {
      if (trayManager?.getPreferences().minimizeToTray) trayManager.minimizeToTray(owner)
      else owner.minimize()
    }
    if (action === 'maximize') owner.isMaximized() ? owner.unmaximize() : owner.maximize()
    if (action === 'close') owner.close()
    if (action === 'hide-to-tray') trayManager?.minimizeToTray(owner)
    if (action === 'restore-from-tray') trayManager?.restoreFromTray(owner)
  })
}

function publishWindowPresence(): void {
  let anyInteractive = false
  for (const win of windows.values()) {
    if (win.isDestroyed()) continue
    const active = win.isVisible() && !win.isMinimized()
    if (active) anyInteractive = true
    const contents = win.webContents
    const allowThrottling = !active
    if (process.platform === 'win32' && contents.getBackgroundThrottling() !== allowThrottling) {
      // Wake Chromium's frame clock from the main process. The terminal and
      // motion recovery both wait for rAF and cannot wake a throttled compositor.
      contents.setBackgroundThrottling(allowThrottling)
      if (active) contents.invalidate()
    }
    contents.send(IPC.windowPresence, active)
  }
  syncService?.setUiBackgrounded(!anyInteractive)
}

async function createWindow(): Promise<void> {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../resources/icon.png')
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#0B0D12',
    title: 'Graphite Orbit',
    icon: existsSync(iconPath) ? iconPath : undefined,
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: true
    }
  })
  const windowId = win.id
  windows.set(windowId, win)
  const contents = win.webContents
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event, url) => {
    if (!trustedUrl(url)) event.preventDefault()
  })
  contents.on('unresponsive', () => diagnostics?.write('window', `renderer unresponsive, window ${windowId}`))
  contents.on('responsive', () => diagnostics?.write('window', `renderer responsive, window ${windowId}`))
  contents.on('render-process-gone', (_event, details) => {
    diagnostics?.write('window', `renderer gone, window ${windowId}, ${details.reason} (${details.exitCode})`)
    filesService?.closeOwnerSessions(windowId)
    void rdpService?.closeWindowSessions(windowId)
    for (const [id, session] of sessions) {
      if (session.owner === windowId) closeSession(id)
    }
  })
  const publishPresence = () => publishWindowPresence()
  contents.on('did-finish-load', publishPresence)
  if (process.platform === 'win32') win.on('focus', publishPresence)
  win.on('maximize', () => contents.send(IPC.windowState, true))
  win.on('unmaximize', () => contents.send(IPC.windowState, false))
  win.on('minimize', () => {
    trayManager?.handleNativeMinimize(win)
    publishPresence()
  })
  win.on('hide', publishPresence)
  win.on('show', () => {
    trayManager?.handleWindowShown(win)
    publishPresence()
  })
  win.on('restore', () => {
    trayManager?.handleWindowShown(win)
    publishPresence()
  })
  win.on('close', (event) => {
    if (quitting) return
    const prefs = trayManager?.getPreferences()
    const closeAction = prefs?.closeAction ?? (prefs?.closeToTray ? 'tray' : 'quit')
    if (closeAction === 'tray') {
      event.preventDefault()
      trayManager?.minimizeToTray(win)
      return
    }
    if (closeAction === 'minimize') {
      event.preventDefault()
      trayManager?.minimizeToTaskbar(win)
      return
    }
    const ownedCount = [...sessions.values()].filter((session) => session.owner === windowId).length
    const activeTunnels = tunnelRuntime?.getActiveCount() ?? 0
    const activeRdp = rdpService?.getActiveSessionCount(windowId) ?? 0
    const activeTransfers = countActiveAllTransfers(windowId)
    if (ownedCount === 0 && activeTunnels === 0 && activeRdp === 0 && activeTransfers === 0) return
    const en = currentLocale === 'en-US'
    const parts: string[] = []
    if (ownedCount > 0) parts.push(en ? `${ownedCount} terminal session(s)` : `${ownedCount} 个终端会话`)
    if (activeRdp > 0) parts.push(en ? `${activeRdp} RDP session(s)` : `${activeRdp} 个远程桌面会话`)
    if (activeTransfers > 0)
      parts.push(en ? `${activeTransfers} file transfer(s)` : `${activeTransfers} 个文件传输任务`)
    if (activeTunnels > 0)
      parts.push(en ? `${activeTunnels} port forwarding tunnel(s)` : `${activeTunnels} 条活动端口转发`)
    const summary = parts.join(en ? ', ' : '、')
    const response = dialog.showMessageBoxSync(win, {
      type: 'question',
      title: en ? 'Close Active Sessions & Transfers?' : '结束活动会话与传输？',
      message: en ? `Quitting will close ${summary}.` : `退出将结束 ${summary}。`,
      buttons: en ? ['Cancel', 'Minimize to Tray', 'End & Quit'] : ['取消', '最小化到后台托盘', '结束并退出'],
      defaultId: 1,
      cancelId: 0,
      noLink: true
    })
    if (response === 0) event.preventDefault()
    else if (response === 1) {
      event.preventDefault()
      trayManager?.minimizeToTray(win)
    }
  })
  win.on('closed', () => {
    filesService?.closeOwnerSessions(windowId)
    void rdpService?.closeWindowSessions(windowId)
    for (const [id, session] of sessions) {
      if (session.owner === windowId) closeSession(id)
    }
    windows.delete(windowId)
    publishPresence()
    trayManager?.handleWindowClosed(windowId)
  })
  win.once('ready-to-show', () => win.show())
  if (rendererUrl) await win.loadURL(rendererUrl)
  else await win.loadFile(rendererPath)
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    const first = [...windows.values()][0]
    if (!first) return
    if (trayManager) trayManager.restoreFromTray(first)
    else {
      if (first.isMinimized()) first.restore()
      first.focus()
    }
  })
  app
    .whenReady()
    .then(async () => {
      if (process.platform === 'linux') {
        Menu.setApplicationMenu(null)
      }
      const userDataDir = app.getPath('userData')
      mkdirSync(userDataDir, { recursive: true })
      diagnostics = new DiagnosticLog(userDataDir)
      registerSessionSecurity()
      repository = new DataClient(join(userDataDir, 'orbit.sqlite'), (message) =>
        diagnostics.write('data-worker', message)
      )
      await repository.ready
      filesService = new FilesService(
        repository,
        isEncryptionUsable,
        (windowId) => windows.get(windowId),
        (ownerWin, event) => ownerWin.webContents.send(IPC.filesProgress, event),
        (ownerWin, sessionId, reason) =>
          ownerWin.webContents.send(IPC.filesSessionClosed, { sessionId, reason }),
        (message) => diagnostics.write('file-vfs', message)
      )
      rdpService = new RdpService({
        data: repository,
        encryptSecret: async (plaintext) => {
          if (!(await isEncryptionUsable())) {
            throw new Error(
              process.platform === 'linux'
                ? '当前 Linux 系统未检测到可用的 Keyring（gnome-keyring / kwallet），无法安全保存密码；请取消勾选保存并在连接时输入临时密码。'
                : '系统凭据保护不可用，不能保存 RDP 密码。'
            )
          }
          return safeStorage.encryptStringAsync(plaintext)
        },
        decryptSecret: async (profileId, blob) => {
          try {
            const decrypted = await safeStorage.decryptStringAsync(Buffer.from(blob))
            if (decrypted.shouldReEncrypt && (await isEncryptionUsable())) {
              await repository.call(
                'rdpProfileUpdateSecret',
                profileId,
                await safeStorage.encryptStringAsync(decrypted.result)
              )
            }
            return decrypted.result
          } catch {
            throw new Error('无法解锁已保存的 RDP 密码（系统凭据保护不可用），请在连接前重新输入密码。')
          }
        },
        emitSessionState: (windowId, event) => {
          const ownerWin = windows.get(windowId)
          if (ownerWin && !ownerWin.isDestroyed()) {
            ownerWin.webContents.send(IPC.rdpSessionState, event)
          }
        },
        emitCertPrompt: (windowId, prompt) => {
          const ownerWin = windows.get(windowId)
          if (ownerWin && !ownerWin.isDestroyed()) {
            ownerWin.webContents.send(IPC.rdpCertPrompt, prompt)
          }
        }
      })
      tunnelRuntime = new TunnelRuntimeManager(repository)
      syncService = new SyncService(
        repository,
        (status: SyncStatusSnapshot) => {
          syncPhaseLabel = formatSyncPhaseLabel(status)
          trayManager?.refresh()
          for (const win of windows.values()) {
            if (!win.isDestroyed()) win.webContents.send(IPC.syncStatusChanged, status)
          }
        },
        (data: SyncDataUpdate) => {
          for (const win of windows.values()) {
            if (!win.isDestroyed()) win.webContents.send(IPC.syncDataChanged, data)
          }
        },
        (message) => diagnostics.write('sync', message)
      )
      await syncService.initFromDb()
      updateService = new OrbitUpdateService(userDataDir, {
        onStateChanged: (snapshot: UpdateStatusSnapshot) => {
          for (const win of windows.values()) {
            if (!win.isDestroyed()) win.webContents.send(IPC.updateStateChanged, snapshot)
          }
        },
        onDiagnostic: (message) => diagnostics.write('updater', message),
        onConfirmInstall: async () => {
          if (process.env.ORBIT_UPDATE_TEST_DRY_INSTALL === '1') return true
          const win = [...windows.values()][0]
          const activeSessions = sessions.size
          const activeTunnels = tunnelRuntime?.getActiveCount() ?? 0
          const activeRdp = rdpService?.getActiveSessionCount() ?? 0
          const activeTransfers = countActiveAllTransfers()
          const en = currentLocale === 'en-US'
          const activeParts: string[] = []
          if (activeSessions > 0)
            activeParts.push(en ? `${activeSessions} terminal session(s)` : `${activeSessions} 个终端会话`)
          if (activeRdp > 0)
            activeParts.push(en ? `${activeRdp} RDP session(s)` : `${activeRdp} 个远程桌面会话`)
          if (activeTransfers > 0)
            activeParts.push(en ? `${activeTransfers} file transfer(s)` : `${activeTransfers} 个文件传输任务`)
          if (activeTunnels > 0)
            activeParts.push(en ? `${activeTunnels} active tunnel(s)` : `${activeTunnels} 条活动转发`)
          const extra =
            activeParts.length > 0
              ? en
                ? `\n${activeParts.join(', ')} will be closed before installing.`
                : `\n当前仍有 ${activeParts.join('、')} 将在安装前关闭。`
              : ''
          const detail = en
            ? `Graphite Orbit will exit automatically once the installer starts to finish updating.${extra}`
            : `安装程序启动后，Graphite Orbit 将自动退出以完成文件更新。${extra}`
          const result = win
            ? await dialog.showMessageBox(win, {
                type: 'question',
                title: en ? 'Quit & Launch Installer?' : '退出并启动更新安装程序？',
                message: en ? 'Ready to Install Update' : '已准备好安装新版本',
                detail,
                buttons: en ? ['Not Now', 'Quit & Install'] : ['暂不安装', '退出并安装'],
                defaultId: 1,
                cancelId: 0,
                noLink: true
              })
            : { response: 1 }
          return result.response === 1
        },
        onPrepareInstallQuit: () => {
          quitting = true
          for (const win of windows.values()) {
            if (!win.isDestroyed()) win.destroy()
          }
          trayManager?.destroy()
          app.quit()
        }
      })
      trayManager = new OrbitTrayManager(userDataDir, {
        getMainWindow: () => [...windows.values()][0],
        getSessionCount: () => sessions.size,
        getActiveTunnelCount: () => tunnelRuntime?.getActiveCount() ?? 0,
        getSyncLabel: () => syncPhaseLabel,
        onDispatchAction: (action) => {
          const target = [...windows.values()][0]
          if (target && !target.isDestroyed()) target.webContents.send(IPC.trayAction, action)
        },
        onStateChanged: (state) => {
          for (const win of windows.values()) {
            if (!win.isDestroyed()) win.webContents.send(IPC.trayStateChanged, state)
          }
        },
        onQuit: () => {
          const activeSessions = sessions.size
          const activeTunnels = tunnelRuntime?.getActiveCount() ?? 0
          const activeRdp = rdpService?.getActiveSessionCount() ?? 0
          const activeTransfers = countActiveAllTransfers()
          if (activeSessions > 0 || activeTunnels > 0 || activeRdp > 0 || activeTransfers > 0) {
            const win = [...windows.values()][0]
            if (win) trayManager?.restoreFromTray(win)
            const en = currentLocale === 'en-US'
            const parts: string[] = []
            if (activeSessions > 0)
              parts.push(en ? `${activeSessions} terminal session(s)` : `${activeSessions} 个终端会话`)
            if (activeRdp > 0) parts.push(en ? `${activeRdp} RDP session(s)` : `${activeRdp} 个远程桌面会话`)
            if (activeTransfers > 0)
              parts.push(en ? `${activeTransfers} file transfer(s)` : `${activeTransfers} 个文件传输任务`)
            if (activeTunnels > 0)
              parts.push(en ? `${activeTunnels} active tunnel(s)` : `${activeTunnels} 条活动端口转发`)
            const response = win
              ? dialog.showMessageBoxSync(win, {
                  type: 'question',
                  title: en ? 'Quit Graphite Orbit?' : '退出 Graphite Orbit？',
                  message: en
                    ? `There are still ${parts.join(', ')} running in the background. Close all and quit?`
                    : `后台仍有 ${parts.join('、')} 正在运行，确认全部结束并退出吗？`,
                  buttons: en ? ['Keep Running', 'Close All & Quit'] : ['继续后台运行', '全部结束并退出'],
                  defaultId: 0,
                  cancelId: 0,
                  noLink: true
                })
              : 1
            if (response === 0) {
              if (win) trayManager?.minimizeToTray(win, { notifyBalloon: false })
              return
            }
          }
          for (const win of windows.values()) {
            if (!win.isDestroyed()) win.destroy()
          }
          trayManager?.destroy()
          app.quit()
        }
      })
      profiles = await discoverShells()
      registerIpc()
      await createWindow()
      trayManager.reconcileTrayVisibility()
      void syncService.resumeSession()
      updateService.scheduleStartupCheck()
    })
    .catch((error) => {
      diagnostics?.write('main', error instanceof Error ? error.message : String(error))
      dialog.showErrorBox(
        'Graphite Orbit 无法启动',
        '本地数据服务初始化失败。请确认依赖已安装并执行 yarn native:rebuild；原有数据不会被重置。'
      )
      app.quit()
    })
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', (event) => {
    if (quitting || windows.size > 0 || (!workers.size && !repository)) return
    event.preventDefault()
    if (shuttingDown) return
    shuttingDown = true
    trayManager?.destroy()
    updateService?.dispose()
    syncService?.dispose()
    const shutdownTasks = [
      ...(filesService ? [filesService.shutdown()] : []),
      ...(rdpService ? [rdpService.shutdownAll()] : []),
      ...(tunnelRuntime ? [tunnelRuntime.dispose()] : []),
      ...[...workers.values()].map(
        (worker) =>
          new Promise<void>((resolve) => {
            const timeout = setTimeout(() => {
              worker.kill()
              resolve()
            }, 2500)
            worker.once('exit', () => {
              clearTimeout(timeout)
              resolve()
            })
            worker.postMessage({ type: 'shutdown' })
          })
      ),
      ...(repository ? [repository.shutdown()] : []),
      ...(diagnostics ? [diagnostics.flush()] : [])
    ]
    void Promise.all(shutdownTasks).then(() => {
      quitting = true
      app.quit()
    })
  })
  app.on('will-quit', () => {
    quitting = true
    trayManager?.destroy()
    for (const worker of workers.values()) worker.postMessage({ type: 'shutdown' })
    repository?.close()
  })
}
