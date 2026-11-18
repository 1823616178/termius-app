import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { safeStorage, utilityProcess, type BrowserWindow, type UtilityProcess } from 'electron'
import {
  DEFAULT_FILES_SETTINGS,
  FILE_DEFAULT_PORTS,
  describeFileEndpoint,
  fileConnectSchema,
  fileProfileInputSchema,
  fileSecretsInputSchema,
  isFileProtocolAvailable,
  protocolSettingsPatchSchema,
  type AllProtocolSettings,
  type FileCapabilities,
  type FileConnectConfig,
  type FileConnectSource,
  type FileProfile,
  type FileProfileInput,
  type FileProgressEvent,
  type FileProtocol,
  type FileSecretsInput,
  type FileSessionInfo,
  type ProtocolSettingsPatch
} from '../shared/files'
import type { DataClient } from './data-client'

interface ActiveFileSession {
  sessionId: string
  ownerWindowId: number
  protocol: FileProtocol
  profileId?: string
  title: string
}

interface PendingRpc {
  sessionId: string
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer?: NodeJS.Timeout
}

export class FilesService {
  private worker: UtilityProcess | null = null
  private shuttingDown = false
  private readonly sessions = new Map<string, ActiveFileSession>()
  private readonly pending = new Map<string, PendingRpc>()

  constructor(
    private readonly repository: DataClient,
    private readonly isEncryptionUsable: () => Promise<boolean>,
    private readonly getOwnerWindow: (windowId: number) => BrowserWindow | undefined,
    private readonly onProgress: (ownerWindow: BrowserWindow, event: FileProgressEvent) => void,
    private readonly onSessionClosed: (
      ownerWindow: BrowserWindow,
      sessionId: string,
      reason?: string
    ) => void,
    private readonly onDiagnostic?: (message: string) => void
  ) {}

  private ensureWorker(): UtilityProcess {
    if (this.worker) return this.worker
    const worker = utilityProcess.fork(join(__dirname, 'file-vfs.js'), [], {
      serviceName: 'Orbit File VFS',
      stdio: 'pipe'
    })
    this.worker = worker
    worker.stderr?.on('data', (chunk: Buffer) => {
      this.onDiagnostic?.(chunk.toString('utf8'))
    })
    worker.on('message', (data) => {
      if (!data || typeof data !== 'object') return
      if (data.type === 'files:response') {
        const req = this.pending.get(String(data.requestId ?? ''))
        if (!req) return
        this.pending.delete(String(data.requestId))
        if (req.timer) clearTimeout(req.timer)
        if (data.ok) req.resolve(data.result)
        else req.reject(new Error(typeof data.error === 'string' ? data.error : '文件操作失败'))
        return
      }
      if (data.type === 'files:progress') {
        const evt = data as FileProgressEvent & { type: 'files:progress' }
        const session = this.sessions.get(evt.sessionId)
        if (!session) return
        const win = this.getOwnerWindow(session.ownerWindowId)
        if (win && !win.isDestroyed()) {
          this.onProgress(win, {
            transferId: evt.transferId,
            sessionId: evt.sessionId,
            protocol: evt.protocol,
            direction: evt.direction,
            name: evt.name,
            localPath: evt.localPath,
            remotePath: evt.remotePath,
            totalBytes: evt.totalBytes,
            transferredBytes: evt.transferredBytes,
            speedBps: evt.speedBps,
            status: evt.status,
            ...(evt.error ? { error: evt.error } : {})
          })
        }
      }
    })
    worker.on('exit', (code) => {
      if (this.worker === worker) this.worker = null
      if (code !== 0 && !this.shuttingDown) {
        this.onDiagnostic?.(`file-vfs worker exited unexpectedly with code ${code}`)
      }
      for (const [reqId, req] of this.pending) {
        clearTimeout(req.timer)
        req.reject(new Error('文件传输工作进程已退出，请重新连接'))
        this.pending.delete(reqId)
      }
      for (const [sid, session] of this.sessions) {
        this.sessions.delete(sid)
        const win = this.getOwnerWindow(session.ownerWindowId)
        if (win && !win.isDestroyed()) {
          this.onSessionClosed(win, sid, '文件传输进程已退出')
        }
      }
    })
    return worker
  }

  private callWorker<T>(sessionId: string, message: Record<string, unknown>, timeoutMs = 30_000): Promise<T> {
    const requestId = randomUUID()
    const worker = this.ensureWorker()
    return new Promise<T>((resolve, reject) => {
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(requestId)
              reject(new Error('文件操作超时，请检查网络连接'))
            }, timeoutMs)
          : undefined
      this.pending.set(requestId, {
        sessionId,
        resolve: (val) => resolve(val as T),
        reject,
        timer
      })
      worker.postMessage({ ...message, requestId, sessionId })
    })
  }

  private rejectPendingForSession(sessionId: string, reason: string): void {
    for (const [reqId, req] of this.pending) {
      if (req.sessionId !== sessionId) continue
      clearTimeout(req.timer)
      this.pending.delete(reqId)
      req.reject(new Error(reason))
    }
  }

  async listProfiles(): Promise<FileProfile[]> {
    return this.repository.call<FileProfile[]>('fileProfilesList')
  }

  async saveProfile(rawInput: FileProfileInput): Promise<FileProfile[]> {
    const input = fileProfileInputSchema.parse(rawInput)
    const secretsObj = input.secrets ? fileSecretsInputSchema.parse(input.secrets) : undefined
    const hasSecretValue = Boolean(
      secretsObj && Object.values(secretsObj).some((v) => typeof v === 'string' && v.length > 0)
    )

    let encrypted: Buffer | undefined
    if (hasSecretValue && input.saveSecrets) {
      if (!(await this.isEncryptionUsable())) {
        throw new Error(
          process.platform === 'linux'
            ? '当前 Linux 系统未检测到可用的 Keyring（gnome-keyring / kwallet），无法安全保存凭据；请取消勾选保存并在连接时输入临时凭据。'
            : '系统凭据保护不可用，不能保存敏感凭据。'
        )
      }
      encrypted = await safeStorage.encryptStringAsync(JSON.stringify(secretsObj))
    }

    return this.repository.call<FileProfile[]>('fileProfileSave', { ...input, secrets: undefined }, encrypted)
  }

  async removeProfile(id: string): Promise<FileProfile[]> {
    return this.repository.call<FileProfile[]>('fileProfileRemove', id)
  }

  async getProtocolSettings(): Promise<AllProtocolSettings> {
    return this.repository.call<AllProtocolSettings>('protocolSettingsAll')
  }

  async patchProtocolSettings(rawPatch: ProtocolSettingsPatch): Promise<AllProtocolSettings> {
    const patch = protocolSettingsPatchSchema.parse(rawPatch)
    return this.repository.call<AllProtocolSettings>('protocolSettingsPatch', patch.namespace, patch.patch)
  }

  private async decryptStoredSecrets(profileId: string, blob?: Uint8Array): Promise<FileSecretsInput> {
    if (!blob) return {}
    try {
      const decrypted = await safeStorage.decryptStringAsync(Buffer.from(blob))
      if (decrypted.shouldReEncrypt && (await this.isEncryptionUsable())) {
        await this.repository.call(
          'fileProfileUpdateSecret',
          profileId,
          await safeStorage.encryptStringAsync(decrypted.result)
        )
      }
      const parsed = JSON.parse(decrypted.result)
      return fileSecretsInputSchema.parse(parsed)
    } catch {
      throw new Error('无法解锁已保存的凭据（系统凭据保护不可用），请在连接前重新输入凭据。')
    }
  }

  async connect(ownerWindowId: number, rawSource: FileConnectSource): Promise<FileSessionInfo> {
    const source = fileConnectSchema.parse(rawSource)
    const settings = await this.getProtocolSettings().catch(() => ({
      files: DEFAULT_FILES_SETTINGS
    }))
    const filesCfg = settings.files

    let profileId: string | undefined
    let title = ''
    let connectConfig: FileConnectConfig

    if (source.kind === 'profile') {
      const record = await this.repository.call<{ profile: FileProfile; secret?: Uint8Array }>(
        'fileProfileGet',
        source.profileId
      )
      const storedSecrets = await this.decryptStoredSecrets(record.profile.id, record.secret)
      const overrideSecrets = source.secrets ?? {}
      const mergedSecrets: FileSecretsInput = {
        ...storedSecrets,
        ...(overrideSecrets.password !== undefined ? { password: overrideSecrets.password } : {}),
        ...(overrideSecrets.token !== undefined ? { token: overrideSecrets.token } : {}),
        ...(overrideSecrets.secretAccessKey !== undefined
          ? { secretAccessKey: overrideSecrets.secretAccessKey }
          : {}),
        ...(overrideSecrets.sessionToken !== undefined ? { sessionToken: overrideSecrets.sessionToken } : {})
      }
      if (!isFileProtocolAvailable(record.profile.protocol)) {
        throw new Error('该协议在当前版本尚未提供')
      }
      profileId = record.profile.id
      title = record.profile.name
      connectConfig = {
        protocol: record.profile.protocol,
        host: record.profile.host,
        port: record.profile.port || FILE_DEFAULT_PORTS[record.profile.protocol],
        username: record.profile.username,
        initialPath: record.profile.initialPath,
        options: record.profile.options,
        secrets: mergedSecrets,
        connectTimeoutMs: filesCfg.connectTimeoutSec * 1000,
        s3PartSizeMiB: filesCfg.s3PartSizeMiB
      }
    } else {
      const parsed = fileProfileInputSchema.parse(source.profile)
      if (!isFileProtocolAvailable(parsed.protocol)) {
        throw new Error('该协议在当前版本尚未提供')
      }
      title =
        parsed.name ||
        describeFileEndpoint({
          protocol: parsed.protocol,
          host: parsed.host,
          port: parsed.port,
          options: parsed.options
        })
      connectConfig = {
        protocol: parsed.protocol,
        host: parsed.host,
        port: parsed.port || FILE_DEFAULT_PORTS[parsed.protocol],
        username: parsed.username,
        initialPath: parsed.initialPath,
        options: parsed.options,
        secrets: parsed.secrets ?? {},
        connectTimeoutMs: filesCfg.connectTimeoutSec * 1000,
        s3PartSizeMiB: filesCfg.s3PartSizeMiB
      }
    }

    const sessionId = randomUUID()
    const connectTimeoutMs = Math.max(8_000, connectConfig.connectTimeoutMs + 5_000)
    const connected = await this.callWorker<{ home: string; capabilities: FileCapabilities }>(
      sessionId,
      { type: 'files:connect', config: connectConfig },
      connectTimeoutMs
    )
    this.sessions.set(sessionId, {
      sessionId,
      ownerWindowId,
      protocol: connectConfig.protocol,
      profileId,
      title
    })
    return {
      sessionId,
      ...(profileId ? { profileId } : {}),
      protocol: connectConfig.protocol,
      title,
      home: connected.home,
      capabilities: connected.capabilities
    }
  }

  closeSession(ownerWindowId: number, sessionId: string): void {
    const existing = this.sessions.get(sessionId)
    if (!existing || existing.ownerWindowId !== ownerWindowId) return
    this.sessions.delete(sessionId)
    this.rejectPendingForSession(sessionId, '文件会话已关闭')
    this.worker?.postMessage({ type: 'files:close', sessionId })
  }

  closeOwnerSessions(ownerWindowId: number): void {
    for (const [sid, session] of this.sessions) {
      if (session.ownerWindowId !== ownerWindowId) continue
      this.sessions.delete(sid)
      this.rejectPendingForSession(sid, '窗口已关闭')
      this.worker?.postMessage({ type: 'files:close', sessionId: sid })
    }
  }

  async callSession<T>(
    ownerWindowId: number,
    sessionId: string,
    action: string,
    payload: Record<string, unknown> = {},
    timeoutMs = 30_000
  ): Promise<T> {
    const existing = this.sessions.get(sessionId)
    if (!existing || existing.ownerWindowId !== ownerWindowId) {
      throw new Error('文件会话未连接或已关闭')
    }
    let enrichedPayload = payload
    if (action === 'upload' || action === 'download') {
      const settings = await this.getProtocolSettings().catch(() => ({
        files: DEFAULT_FILES_SETTINGS
      }))
      const speedLimitBps = Math.max(0, settings.files.speedLimitKBps) * 1024
      enrichedPayload = { ...payload, speedLimitBps }
    }
    return this.callWorker<T>(sessionId, { type: 'files:request', action, ...enrichedPayload }, timeoutMs)
  }

  cancelTransfer(ownerWindowId: number, sessionId: string, transferId: string): void {
    const existing = this.sessions.get(sessionId)
    if (!existing || existing.ownerWindowId !== ownerWindowId) return
    this.worker?.postMessage({ type: 'files:cancel', sessionId, transferId })
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true
    const worker = this.worker
    if (!worker) return
    await new Promise<void>((resolve) => {
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
  }
}
