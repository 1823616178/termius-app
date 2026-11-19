import { computed, ref, watch } from 'vue'
import type { Host, TerminalEvent } from '../../../shared/contracts'
import {
  joinRemotePosixPath,
  parentRemotePosixPath,
  sanitizeDownloadFilename,
  sortSftpEntries,
  type SftpConflictDecision,
  type SftpEntry,
  type SftpProgressEvent,
  type SftpSortField,
  type SftpTransferDirection,
  type SftpTransferItem
} from '../../../shared/sftp'
import {
  currentTab,
  focusedPane,
  hosts,
  notify,
  protocolSettings,
  tabs,
  windowInstance
} from '../stores/workbench'
import { writeTerminalInputByToken } from './terminal-registry'
import { markHostUsed } from './host-recency'
import { t } from './i18n'
import { planUploads, trimTransferHistory, type UploadConflictChoice } from './file-transfers'

export interface ActiveSftpContext {
  source: 'pane' | 'standalone'
  paneToken?: string
  sessionId?: string
  hostId?: string
  title: string
  state: string
  message?: string
}

interface PendingJob {
  sessionId: string
  direction: SftpTransferDirection
  localPath: string
  remotePath: string
  conflict: SftpConflictDecision
}

export const sftpDrawerOpen = ref(false)
export const sftpPanelWidth = ref(loadSavedWidth())
export const sftpTargetPaneToken = ref('')
export const sftpCurrentPath = ref('~')
export const sftpEntries = ref<SftpEntry[]>([])
export const sftpLoading = ref(false)
export const sftpError = ref('')
export const sftpShowHidden = ref(false)
export const sftpFilter = ref('')
export const sftpSortBy = ref<SftpSortField>('name')
export const sftpSortAsc = ref(true)
export const sftpTransfers = ref<SftpTransferItem[]>([])
export const sftpStandalone = ref<{
  sessionId?: string
  hostId: string
  title: string
  state: string
  message?: string
} | null>(null)
export const sftpPasswordPrompt = ref<{ host: Host; error?: string } | null>(null)
export const sftpConflictPrompt = ref<{
  name: string
  direction: SftpTransferDirection
  resolve: (choice: UploadConflictChoice) => void
} | null>(null)

const pendingJobs = new Map<string, PendingJob>()
let runningJobCount = 0
const loadedSessions = new Map<string, string>()
let standalonePort: MessagePort | undefined
let removeProgressListener: (() => void) | undefined
let removeFailureListener: (() => void) | undefined
let listRequestSerial = 0
let listedSessionId: string | undefined
let refreshDebounceTimer: ReturnType<typeof setTimeout> | undefined
let hiddenSyncedFromSettings = false

function loadSavedWidth(): number {
  try {
    const saved = Number(localStorage.getItem('orbit:sftp-width'))
    if (saved >= 300 && saved <= 660) return saved
  } catch {
    /* ignore */
  }
  return 410
}

export function setSftpPanelWidth(next: number): void {
  const clamped = Math.max(300, Math.min(660, Math.round(next)))
  sftpPanelWidth.value = clamped
  try {
    localStorage.setItem('orbit:sftp-width', String(clamped))
  } catch {
    /* ignore */
  }
}

export const allSshPanes = computed(() =>
  tabs.value.flatMap((tab) => tab.panes.filter((pane) => pane.kind === 'ssh'))
)

export const activeSftpContext = computed<ActiveSftpContext | null>(() => {
  if (sftpTargetPaneToken.value) {
    const explicit = allSshPanes.value.find((pane) => pane.token === sftpTargetPaneToken.value)
    if (explicit) {
      return {
        source: 'pane',
        paneToken: explicit.token,
        sessionId: explicit.sessionId,
        hostId: explicit.hostId,
        title: explicit.title,
        state: explicit.state
      }
    }
  }
  if (!sftpStandalone.value) {
    const focused = focusedPane.value
    if (focused?.kind === 'ssh') {
      return {
        source: 'pane',
        paneToken: focused.token,
        sessionId: focused.sessionId,
        hostId: focused.hostId,
        title: focused.title,
        state: focused.state
      }
    }
    const tabSsh = currentTab.value?.panes.find((pane) => pane.kind === 'ssh')
    if (tabSsh) {
      return {
        source: 'pane',
        paneToken: tabSsh.token,
        sessionId: tabSsh.sessionId,
        hostId: tabSsh.hostId,
        title: tabSsh.title,
        state: tabSsh.state
      }
    }
  }
  if (sftpStandalone.value) {
    return {
      source: 'standalone',
      sessionId: sftpStandalone.value.sessionId,
      hostId: sftpStandalone.value.hostId,
      title: sftpStandalone.value.title,
      state: sftpStandalone.value.state,
      message: sftpStandalone.value.message
    }
  }
  return null
})

export const activeTransferCount = computed(
  () => sftpTransfers.value.filter((item) => item.status === 'running' || item.status === 'queued').length
)

export const visibleSftpEntries = computed(() => {
  const q = sftpFilter.value.trim().toLowerCase()
  const filtered = sftpEntries.value.filter((entry) => {
    if (!sftpShowHidden.value && entry.name.startsWith('.')) return false
    if (q && !entry.name.toLowerCase().includes(q)) return false
    return true
  })
  return sortSftpEntries(filtered, sftpSortBy.value, sftpSortAsc.value)
})

function pushTransferItem(item: SftpTransferItem): void {
  sftpTransfers.value = trimTransferHistory([item, ...sftpTransfers.value])
}

function scheduleUploadRefresh(sessionId: string, dirPath: string): void {
  if (activeSftpContext.value?.sessionId !== sessionId || sftpCurrentPath.value !== dirPath) return
  clearTimeout(refreshDebounceTimer)
  refreshDebounceTimer = setTimeout(() => {
    refreshDebounceTimer = undefined
    if (activeSftpContext.value?.sessionId === sessionId && sftpCurrentPath.value === dirPath) {
      void refreshSftpDirectory(dirPath)
    }
  }, 300)
}

function cancelSessionTransfers(sessionId: string): void {
  const now = Date.now()
  let changed = false
  const next = sftpTransfers.value.map((item) => {
    if (item.sessionId !== sessionId) return item
    if (item.status === 'queued') {
      pendingJobs.delete(item.id)
      changed = true
      return {
        ...item,
        status: 'cancelled' as const,
        error: t('sftp.queueCancelled'),
        updatedAt: now
      }
    }
    if (item.status === 'running') {
      void window.orbit.sftp.cancelTransfer(sessionId, item.id).catch(() => {})
      changed = true
      return {
        ...item,
        status: 'cancelled' as const,
        error: t('sftp.queueCancelled'),
        updatedAt: now
      }
    }
    return item
  })
  if (changed) sftpTransfers.value = trimTransferHistory(next)
}

function handleProgressEvent(event: SftpProgressEvent): void {
  const idx = sftpTransfers.value.findIndex((item) => item.id === event.transferId)
  if (idx < 0) return
  const current = sftpTransfers.value[idx]!
  if (current.status === 'cancelled') return
  sftpTransfers.value[idx] = {
    ...current,
    totalBytes: event.totalBytes,
    transferredBytes: event.transferredBytes,
    speedBps: event.speedBps,
    status: event.status,
    error: event.error,
    remotePath: event.remotePath,
    localPath: event.localPath,
    updatedAt: Date.now()
  }
}

export function initSftpBridgeListeners(): void {
  if (!hiddenSyncedFromSettings) {
    hiddenSyncedFromSettings = true
    sftpShowHidden.value = Boolean(protocolSettings.value.files.showHidden)
  }
  if (!removeProgressListener) {
    removeProgressListener = window.orbit.sftp.onProgress(handleProgressEvent)
  }
  if (!removeFailureListener) {
    removeFailureListener = window.orbit.onSessionFailure((event) => {
      if (sftpStandalone.value?.sessionId === event.id) {
        sftpStandalone.value = {
          ...sftpStandalone.value,
          state: 'error',
          message: event.message
        }
      }
    })
  }
}

export function disposeSftpBridgeListeners(): void {
  clearTimeout(refreshDebounceTimer)
  refreshDebounceTimer = undefined
  removeProgressListener?.()
  removeProgressListener = undefined
  removeFailureListener?.()
  removeFailureListener = undefined
  closeStandaloneSftpSession()
}

export function closeStandaloneSftpSession(): void {
  if (standalonePort) {
    try {
      standalonePort.postMessage({ type: 'close' })
      standalonePort.close()
    } catch {
      /* ignore */
    }
    standalonePort = undefined
  }
  const sid = sftpStandalone.value?.sessionId
  if (sid) {
    cancelSessionTransfers(sid)
    loadedSessions.delete(sid)
    void window.orbit.sessions.close(sid).catch(() => {})
  }
  sftpStandalone.value = null
}

export function reconnectStandaloneSftp(): void {
  const hostId = sftpStandalone.value?.hostId
  if (!hostId) return
  const host = hosts.value.find((item) => item.id === hostId)
  if (host) void connectStandaloneSftpHost(host)
}

export async function connectStandaloneSftpHost(host: Host, password?: string): Promise<void> {
  closeStandaloneSftpSession()
  sftpTargetPaneToken.value = ''
  sftpEntries.value = []
  sftpError.value = ''
  sftpFilter.value = ''
  if (host.auth === 'password' && !host.hasPassword && password === undefined) {
    sftpPasswordPrompt.value = { host }
    return
  }
  sftpPasswordPrompt.value = null
  markHostUsed(host.id)
  sftpStandalone.value = { hostId: host.id, title: host.name, state: 'connecting' }

  const requestId = crypto.randomUUID()
  let listener: ((event: MessageEvent) => void) | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  const delivered = new Promise<MessagePort>((resolve, reject) => {
    listener = (event) => {
      const expectedOrigin = window.location.protocol === 'file:' ? 'null' : window.location.origin
      if (
        event.source !== window ||
        event.origin !== expectedOrigin ||
        event.data?.type !== 'orbit:terminal-port' ||
        event.data.requestId !== requestId ||
        !event.ports[0]
      ) {
        return
      }
      resolve(event.ports[0])
    }
    window.addEventListener('message', listener)
    timeout = setTimeout(() => reject(new Error(t('sftp.channelTimeout'))), 20_000)
  })
  void delivered.catch(() => {})

  try {
    const opened = await window.orbit.sessions.open({
      kind: 'ssh',
      hostId: host.id,
      ...(password !== undefined ? { password } : {}),
      mode: 'sftp',
      requestId,
      cols: 80,
      rows: 24
    })
    const port = await delivered
    standalonePort = port
    sftpStandalone.value = {
      sessionId: opened.id,
      hostId: host.id,
      title: host.name,
      state: 'connecting'
    }
    port.onmessage = ({ data }: MessageEvent<TerminalEvent>) => {
      if (data.type !== 'state' || !sftpStandalone.value) return
      if (data.reason === 'auth-failed') {
        closeStandaloneSftpSession()
        sftpPasswordPrompt.value = {
          host,
          error: data.message ?? t('sftp.authFailed')
        }
        return
      }
      sftpStandalone.value = {
        ...sftpStandalone.value,
        state: data.state,
        message: data.message
      }
    }
    port.start()
  } catch (error) {
    const msg = error instanceof Error ? error.message : t('sftp.connectFailed')
    if (msg.includes('请输入本次连接密码')) {
      sftpStandalone.value = null
      sftpPasswordPrompt.value = { host, error: msg }
    } else {
      sftpStandalone.value = { hostId: host.id, title: host.name, state: 'error', message: msg }
    }
  } finally {
    if (listener) window.removeEventListener('message', listener)
    clearTimeout(timeout)
  }
}

export function openSftpForPane(paneToken?: string): void {
  if (paneToken) {
    const pane = allSshPanes.value.find((item) => item.token === paneToken)
    if (pane) {
      closeStandaloneSftpSession()
      sftpTargetPaneToken.value = paneToken
    } else {
      sftpTargetPaneToken.value = ''
    }
  }
  sftpDrawerOpen.value = true
}

export function toggleSftpPanel(paneToken?: string): void {
  if (paneToken && sftpDrawerOpen.value && sftpTargetPaneToken.value !== paneToken) {
    openSftpForPane(paneToken)
    return
  }
  if (!sftpDrawerOpen.value) {
    openSftpForPane(paneToken)
    return
  }
  sftpDrawerOpen.value = false
}

export function selectSftpPaneTarget(paneToken: string): void {
  closeStandaloneSftpSession()
  sftpTargetPaneToken.value = paneToken
  sftpEntries.value = []
  sftpError.value = ''
  sftpFilter.value = ''
  const sessionId = activeSftpContext.value?.sessionId
  if (sessionId && activeSftpContext.value?.state === 'running') {
    const savedPath = loadedSessions.get(sessionId)
    void refreshSftpDirectory(savedPath || '~')
  }
}

export async function refreshSftpDirectory(targetPath?: string): Promise<void> {
  const ctx = activeSftpContext.value
  if (!ctx?.sessionId || ctx.state !== 'running') return
  const sessionId = ctx.sessionId
  const serial = ++listRequestSerial
  sftpLoading.value = true
  sftpError.value = ''
  const previousPath = sftpCurrentPath.value
  try {
    const resolvedPath =
      targetPath ?? (loadedSessions.get(sessionId) || (await window.orbit.sftp.home(sessionId)))
    const res = await window.orbit.sftp.list(sessionId, resolvedPath)
    if (serial !== listRequestSerial || activeSftpContext.value?.sessionId !== sessionId) return
    if (res.path !== previousPath) {
      sftpFilter.value = ''
    }
    sftpCurrentPath.value = res.path
    sftpEntries.value = res.entries
    listedSessionId = sessionId
    loadedSessions.set(sessionId, res.path)
  } catch (error) {
    if (serial !== listRequestSerial) return
    sftpError.value = error instanceof Error ? error.message : t('sftp.readDirFailed')
  } finally {
    if (serial === listRequestSerial) sftpLoading.value = false
  }
}

watch(
  () => [sftpDrawerOpen.value, activeSftpContext.value?.sessionId, activeSftpContext.value?.state] as const,
  ([open, sessionId, state]) => {
    if (listedSessionId && listedSessionId !== sessionId) {
      listedSessionId = undefined
      sftpEntries.value = []
      sftpCurrentPath.value = '~'
      sftpFilter.value = ''
    }
    if (!open || !sessionId || state !== 'running') return
    const saved = loadedSessions.get(sessionId)
    if (listedSessionId !== sessionId || !saved || sftpCurrentPath.value !== saved) {
      void refreshSftpDirectory(saved)
    }
  },
  { immediate: true }
)

watch(
  () => [sftpTargetPaneToken.value, allSshPanes.value] as const,
  ([token, panes]) => {
    if (token && !panes.some((pane) => pane.token === token)) {
      sftpTargetPaneToken.value = ''
    }
    const activeIds = new Set<string>()
    for (const pane of panes) {
      if (pane.sessionId) activeIds.add(pane.sessionId)
    }
    if (sftpStandalone.value?.sessionId) activeIds.add(sftpStandalone.value.sessionId)
    for (const sid of loadedSessions.keys()) {
      if (!activeIds.has(sid)) loadedSessions.delete(sid)
    }
  }
)

function askConflict(name: string, direction: SftpTransferDirection): Promise<UploadConflictChoice> {
  return new Promise((resolve) => {
    sftpConflictPrompt.value = {
      name,
      direction,
      resolve: (choice) => {
        sftpConflictPrompt.value = null
        resolve(choice)
      }
    }
  })
}

function pumpTransfers(): void {
  const maxConcurrent = Math.max(1, Math.min(8, protocolSettings.value.files.maxConcurrentTransfers || 3))
  if (runningJobCount >= maxConcurrent) return
  const slots = maxConcurrent - runningJobCount
  const queued = sftpTransfers.value.filter((item) => item.status === 'queued').slice(0, slots)
  for (const item of queued) {
    const job = pendingJobs.get(item.id)
    if (!job) continue
    runningJobCount++
    item.status = 'running'
    item.updatedAt = Date.now()
    const op =
      job.direction === 'upload'
        ? window.orbit.sftp.upload({
            transferId: item.id,
            sessionId: job.sessionId,
            localPath: job.localPath,
            remotePath: job.remotePath,
            conflict: job.conflict
          })
        : window.orbit.sftp.download({
            transferId: item.id,
            sessionId: job.sessionId,
            remotePath: job.remotePath,
            localPath: job.localPath,
            conflict: job.conflict
          })
    void op
      .then((result) => {
        const idx = sftpTransfers.value.findIndex((t) => t.id === item.id)
        if (idx >= 0 && sftpTransfers.value[idx]!.status !== 'cancelled') sftpTransfers.value[idx] = result
        pendingJobs.delete(item.id)
        if (job.direction === 'upload') {
          const parentDir = parentRemotePosixPath(result.remotePath)
          if (parentDir === sftpCurrentPath.value) {
            scheduleUploadRefresh(job.sessionId, parentDir)
          }
        }
      })
      .catch((error) => {
        const idx = sftpTransfers.value.findIndex((t) => t.id === item.id)
        if (idx >= 0 && sftpTransfers.value[idx]!.status !== 'cancelled') {
          const msg = error instanceof Error ? error.message : t('sftp.transferFailed')
          sftpTransfers.value[idx] = {
            ...sftpTransfers.value[idx]!,
            status: msg.includes('取消') || msg.toLowerCase().includes('cancel') ? 'cancelled' : 'failed',
            error: msg,
            updatedAt: Date.now()
          }
        }
        pendingJobs.delete(item.id)
      })
      .finally(() => {
        runningJobCount--
        sftpTransfers.value = trimTransferHistory(sftpTransfers.value)
        pumpTransfers()
      })
  }
}

export async function uploadLocalPathsToCurrentDir(localPaths: string[]): Promise<void> {
  const ctx = activeSftpContext.value
  if (!ctx?.sessionId || ctx.state !== 'running' || !localPaths.length) return
  const sessionId = ctx.sessionId
  const baseRemoteDir = sftpCurrentPath.value
  const knownRootPaths = new Set(sftpEntries.value.map((entry) => entry.path))
  const manifest = await window.orbit.sftp.expandLocalUploads(localPaths)
  if (manifest.skippedSymlinks > 0) {
    notify(t('sftp.skippedLocalSymlinks', { count: manifest.skippedSymlinks }))
  }
  const uploads = await planUploads(
    manifest.files,
    baseRemoteDir,
    protocolSettings.value.files.defaultConflict,
    async (file, path) => {
      if (knownRootPaths.has(path)) return true
      if (listedSessionId === sessionId && !file.relativePath.includes('/')) return false
      const result = await window.orbit.sftp.stat(sessionId, path).catch(() => ({ exists: false }))
      return result.exists
    },
    (file) => askConflict(file.relativePath, 'upload')
  )
  const sessionIsOpen = () =>
    (sftpStandalone.value?.sessionId === sessionId && sftpStandalone.value.state === 'running') ||
    allSshPanes.value.some((pane) => pane.sessionId === sessionId && pane.state === 'running')
  if (!uploads || !sessionIsOpen()) return

  for (const relDir of manifest.dirs) {
    await window.orbit.sftp.mkdir(sessionId, joinRemotePosixPath(baseRemoteDir, relDir))
  }
  if (!sessionIsOpen()) return
  for (const file of uploads) {
    const transferId = crypto.randomUUID()
    pendingJobs.set(transferId, {
      sessionId,
      direction: 'upload',
      localPath: file.localPath,
      remotePath: file.remotePath,
      conflict: file.conflict
    })
    pushTransferItem({
      id: transferId,
      sessionId,
      direction: 'upload',
      name: file.name,
      localPath: file.localPath,
      remotePath: file.remotePath,
      totalBytes: file.size,
      transferredBytes: 0,
      speedBps: 0,
      status: 'queued',
      startedAt: Date.now(),
      updatedAt: Date.now()
    })
  }
  pumpTransfers()
  if (manifest.dirs.length > 0) {
    scheduleUploadRefresh(sessionId, baseRemoteDir)
  }
}

export async function downloadRemoteEntries(entries: SftpEntry[]): Promise<void> {
  const ctx = activeSftpContext.value
  if (!ctx?.sessionId || ctx.state !== 'running' || !entries.length) return
  const sessionId = ctx.sessionId

  const single = entries.length === 1 ? entries[0]! : undefined
  if (single && single.kind !== 'directory' && single.targetKind !== 'directory') {
    const targetFile = await window.orbit.sftp.pickDownloadFile(single.name)
    if (!targetFile) return
    const transferId = crypto.randomUUID()
    pendingJobs.set(transferId, {
      sessionId,
      direction: 'download',
      localPath: targetFile,
      remotePath: single.path,
      conflict: 'overwrite'
    })
    pushTransferItem({
      id: transferId,
      sessionId,
      direction: 'download',
      name: single.name,
      localPath: targetFile,
      remotePath: single.path,
      totalBytes: single.size,
      transferredBytes: 0,
      speedBps: 0,
      status: 'queued',
      startedAt: Date.now(),
      updatedAt: Date.now()
    })
    pumpTransfers()
    return
  }

  const destDir = await window.orbit.sftp.pickDownloadDir()
  if (!destDir) return
  const cleanBase = destDir.replace(/[\\/]+$/, '')
  const configuredConflict = protocolSettings.value.files.defaultConflict
  const downloadConflict: SftpConflictDecision = configuredConflict === 'ask' ? 'rename' : configuredConflict
  let skippedSymlinks = 0

  for (const entry of entries) {
    const safeName = sanitizeDownloadFilename(entry.name)
    if (entry.kind === 'directory' || entry.targetKind === 'directory') {
      const tree = await window.orbit.sftp.collectTree(sessionId, entry.path)
      skippedSymlinks += tree.skippedSymlinks
      for (const file of tree.files) {
        const localPath = `${cleanBase}/${safeName}/${file.relativePath}`
        const transferId = crypto.randomUUID()
        pendingJobs.set(transferId, {
          sessionId,
          direction: 'download',
          localPath,
          remotePath: file.remotePath,
          conflict: downloadConflict
        })
        pushTransferItem({
          id: transferId,
          sessionId,
          direction: 'download',
          name: file.name,
          localPath,
          remotePath: file.remotePath,
          totalBytes: file.size,
          transferredBytes: 0,
          speedBps: 0,
          status: 'queued',
          startedAt: Date.now(),
          updatedAt: Date.now()
        })
      }
    } else {
      const localPath = `${cleanBase}/${safeName}`
      const transferId = crypto.randomUUID()
      pendingJobs.set(transferId, {
        sessionId,
        direction: 'download',
        localPath,
        remotePath: entry.path,
        conflict: downloadConflict
      })
      pushTransferItem({
        id: transferId,
        sessionId,
        direction: 'download',
        name: entry.name,
        localPath,
        remotePath: entry.path,
        totalBytes: entry.size,
        transferredBytes: 0,
        speedBps: 0,
        status: 'queued',
        startedAt: Date.now(),
        updatedAt: Date.now()
      })
    }
  }
  if (skippedSymlinks > 0) {
    notify(t('sftp.skippedRemoteSymlinks', { count: skippedSymlinks }))
  }
  pumpTransfers()
}

export async function cancelSftpTransfer(item: SftpTransferItem): Promise<void> {
  if (item.status === 'queued') {
    pendingJobs.delete(item.id)
    const idx = sftpTransfers.value.findIndex((t) => t.id === item.id)
    if (idx >= 0) {
      sftpTransfers.value[idx] = {
        ...item,
        status: 'cancelled',
        error: t('sftp.queueCancelled'),
        updatedAt: Date.now()
      }
      sftpTransfers.value = trimTransferHistory(sftpTransfers.value)
    }
    return
  }
  if (item.status === 'running') {
    await window.orbit.sftp.cancelTransfer(item.sessionId, item.id).catch(() => {})
  }
}

export function retrySftpTransfer(item: SftpTransferItem): void {
  const ctx = activeSftpContext.value
  const sessionId = ctx?.state === 'running' && ctx.sessionId ? ctx.sessionId : item.sessionId
  const newId = crypto.randomUUID()
  pendingJobs.set(newId, {
    sessionId,
    direction: item.direction,
    localPath: item.localPath,
    remotePath: item.remotePath,
    conflict: 'overwrite'
  })
  sftpTransfers.value = trimTransferHistory([
    {
      ...item,
      id: newId,
      sessionId,
      status: 'queued' as const,
      transferredBytes: 0,
      speedBps: 0,
      error: undefined,
      startedAt: Date.now(),
      updatedAt: Date.now()
    },
    ...sftpTransfers.value.filter((t) => t.id !== item.id)
  ])
  pumpTransfers()
}

export function clearFinishedSftpTransfers(): void {
  sftpTransfers.value = sftpTransfers.value.filter(
    (item) => item.status === 'queued' || item.status === 'running'
  )
}

export function insertRemotePathIntoTerminal(remotePath: string): void {
  const escaped = `'${remotePath.replaceAll("'", "'\\''")}'`
  const paneToken =
    activeSftpContext.value?.paneToken ||
    (focusedPane.value?.kind === 'ssh' ? focusedPane.value.token : undefined)
  if (paneToken && writeTerminalInputByToken(windowInstance(paneToken), `${escaped} `)) {
    notify(t('sftp.insertedPathNotice'))
    return
  }
  void window.orbit.clipboard.writeText(remotePath).then(() => {
    notify(t('sftp.copiedPathNoTerminalNotice'))
  })
}

export function availableSshHosts(): Host[] {
  return hosts.value
}
