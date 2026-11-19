import { basename } from 'node:path'
import type { SftpConflictDecision, SftpTransferItem, SftpTransferStatus } from '../../shared/sftp'
import { remoteBaseName } from '../../shared/sftp'
import type { FileConnectConfig, FileProgressEvent, FileProtocol } from '../../shared/files'
import type { FileAdapter } from './adapter'
import { createAdapter } from './adapters'
import { collectSecretsToRedact, sanitizeFileError } from './transfer-utils'

interface ActiveSession {
  protocol: FileProtocol
  adapter: FileAdapter
  secrets: string[]
  transfers: Map<string, AbortController>
}

const sessions = new Map<string, ActiveSession>()

function post(message: Record<string, unknown>): void {
  process.parentPort.postMessage(message)
}

function sendResponse(requestId: string, ok: boolean, valueOrError: unknown): void {
  if (ok) {
    post({ type: 'files:response', requestId, ok: true, result: valueOrError })
  } else {
    post({
      type: 'files:response',
      requestId,
      ok: false,
      error: valueOrError instanceof Error ? valueOrError.message : String(valueOrError ?? '文件操作失败')
    })
  }
}

function emitProgress(event: FileProgressEvent): void {
  post({ type: 'files:progress', ...event })
}

async function closeSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId)
  if (!session) return
  sessions.delete(sessionId)
  for (const controller of session.transfers.values()) {
    controller.abort()
  }
  session.transfers.clear()
  await session.adapter.close().catch(() => {})
}

async function handleConnect(msg: {
  requestId: string
  sessionId: string
  config: FileConnectConfig
}): Promise<void> {
  const secrets = collectSecretsToRedact(msg.config.secrets)
  const adapter = createAdapter(msg.config)
  const connectAc = new AbortController()
  const timeoutMs = Math.max(5000, msg.config.connectTimeoutMs || 20_000)
  const timer = setTimeout(() => connectAc.abort(new Error('连接超时')), timeoutMs)
  try {
    await adapter.connect(connectAc.signal)
    const home = await adapter.home()
    sessions.set(msg.sessionId, {
      protocol: msg.config.protocol,
      adapter,
      secrets,
      transfers: new Map()
    })
    sendResponse(msg.requestId, true, { home, capabilities: adapter.capabilities })
  } catch (error) {
    await adapter.close().catch(() => {})
    sendResponse(msg.requestId, false, sanitizeFileError(error, secrets))
  } finally {
    clearTimeout(timer)
  }
}

async function runTransfer(
  sessionId: string,
  session: ActiveSession,
  direction: 'upload' | 'download',
  payload: {
    transferId: string
    localPath: string
    remotePath: string
    conflict: SftpConflictDecision
    speedLimitBps?: number
  }
): Promise<SftpTransferItem> {
  const startedAt = Date.now()
  const controller = new AbortController()
  session.transfers.set(payload.transferId, controller)
  const name =
    direction === 'upload' ? basename(payload.localPath) : remoteBaseName(payload.remotePath) || 'download'

  let lastAt = startedAt
  let lastEmitAt = 0
  let lastBytes = 0
  let totalBytes = 0
  let speedBps = 0

  const report = (
    transferred: number,
    total: number,
    status: SftpTransferStatus,
    error?: string,
    force = false
  ): void => {
    const now = Date.now()
    const dt = (now - lastAt) / 1000
    if (dt >= 0.2 && transferred >= lastBytes) {
      speedBps = Math.round((transferred - lastBytes) / dt)
      lastAt = now
      lastBytes = transferred
    }
    totalBytes = total
    if (!force && status === 'running' && now - lastEmitAt < 120 && (total <= 0 || transferred < total)) {
      return
    }
    lastEmitAt = now
    emitProgress({
      transferId: payload.transferId,
      sessionId,
      protocol: session.protocol,
      direction,
      name,
      localPath: payload.localPath,
      remotePath: payload.remotePath,
      totalBytes: total,
      transferredBytes: transferred,
      speedBps: status === 'running' ? speedBps : 0,
      status,
      ...(error ? { error } : {})
    })
  }

  report(0, 0, 'running', undefined, true)

  try {
    const speedLimitBps = Math.max(0, Number(payload.speedLimitBps ?? 0) || 0)
    const outcome =
      direction === 'upload'
        ? await session.adapter.upload({
            localPath: payload.localPath,
            remotePath: payload.remotePath,
            conflict: payload.conflict,
            signal: controller.signal,
            speedLimitBps,
            onProgress: (p) => report(p.transferredBytes, p.totalBytes, 'running')
          })
        : await session.adapter.download({
            remotePath: payload.remotePath,
            localPath: payload.localPath,
            conflict: payload.conflict,
            signal: controller.signal,
            speedLimitBps,
            onProgress: (p) => report(p.transferredBytes, p.totalBytes, 'running')
          })

    const finalRemote = direction === 'upload' ? outcome.finalPath : payload.remotePath
    const finalLocal = direction === 'download' ? outcome.finalPath : payload.localPath
    totalBytes = outcome.bytes
    emitProgress({
      transferId: payload.transferId,
      sessionId,
      protocol: session.protocol,
      direction,
      name,
      localPath: finalLocal,
      remotePath: finalRemote,
      totalBytes,
      transferredBytes: totalBytes,
      speedBps: 0,
      status: 'completed'
    })

    return {
      id: payload.transferId,
      sessionId,
      direction,
      name,
      localPath: finalLocal,
      remotePath: finalRemote,
      totalBytes,
      transferredBytes: totalBytes,
      speedBps: 0,
      status: 'completed',
      startedAt,
      updatedAt: Date.now()
    }
  } catch (error) {
    const cancelled = controller.signal.aborted
    const cleanError = cancelled ? '已取消传输' : sanitizeFileError(error, session.secrets).message
    const status: SftpTransferStatus = cancelled ? 'cancelled' : 'failed'
    emitProgress({
      transferId: payload.transferId,
      sessionId,
      protocol: session.protocol,
      direction,
      name,
      localPath: payload.localPath,
      remotePath: payload.remotePath,
      totalBytes,
      transferredBytes: lastBytes,
      speedBps: 0,
      status,
      error: cleanError
    })
    throw new Error(cleanError)
  } finally {
    session.transfers.delete(payload.transferId)
  }
}

async function handleSessionRequest(msg: {
  requestId: string
  sessionId: string
  action: string
  [key: string]: unknown
}): Promise<void> {
  const session = sessions.get(msg.sessionId)
  if (!session) {
    sendResponse(msg.requestId, false, '文件会话未连接或已关闭')
    return
  }
  try {
    let result: unknown
    switch (msg.action) {
      case 'home':
        result = await session.adapter.home()
        break
      case 'list':
        result = await session.adapter.list(String(msg.path ?? '/'))
        break
      case 'stat':
        result = await session.adapter.stat(String(msg.path ?? '/'))
        break
      case 'collectTree':
        result = await session.adapter.collectTree(String(msg.path ?? '/'))
        break
      case 'mkdir':
        await session.adapter.mkdir(String(msg.path ?? '/'))
        result = undefined
        break
      case 'rename':
        await session.adapter.rename(String(msg.oldPath ?? ''), String(msg.newPath ?? ''))
        result = undefined
        break
      case 'chmod':
        await session.adapter.chmod(String(msg.path ?? '/'), Number(msg.mode ?? 0))
        result = undefined
        break
      case 'delete':
        await session.adapter.remove(String(msg.path ?? '/'), Boolean(msg.recursive))
        result = undefined
        break
      case 'upload':
        result = await runTransfer(msg.sessionId, session, 'upload', {
          transferId: String(msg.transferId),
          localPath: String(msg.localPath),
          remotePath: String(msg.remotePath),
          conflict: (msg.conflict as SftpConflictDecision) ?? 'overwrite',
          speedLimitBps: typeof msg.speedLimitBps === 'number' ? msg.speedLimitBps : 0
        })
        break
      case 'download':
        result = await runTransfer(msg.sessionId, session, 'download', {
          transferId: String(msg.transferId),
          remotePath: String(msg.remotePath),
          localPath: String(msg.localPath),
          conflict: (msg.conflict as SftpConflictDecision) ?? 'overwrite',
          speedLimitBps: typeof msg.speedLimitBps === 'number' ? msg.speedLimitBps : 0
        })
        break
      default:
        throw new Error(`不支持的文件操作：${msg.action}`)
    }
    sendResponse(msg.requestId, true, result)
  } catch (error) {
    sendResponse(msg.requestId, false, sanitizeFileError(error, session.secrets))
  }
}

process.parentPort.on('message', ({ data }) => {
  if (!data || typeof data !== 'object') return
  if (data.type === 'shutdown') {
    void Promise.all([...sessions.keys()].map((id) => closeSession(id))).finally(() => {
      process.exit(0)
    })
    return
  }
  if (data.type === 'files:connect') {
    void handleConnect(data as { requestId: string; sessionId: string; config: FileConnectConfig })
    return
  }
  if (data.type === 'files:close') {
    void closeSession(String(data.sessionId ?? ''))
    return
  }
  if (data.type === 'files:cancel') {
    const session = sessions.get(String(data.sessionId ?? ''))
    const ctrl = session?.transfers.get(String(data.transferId ?? ''))
    ctrl?.abort()
    return
  }
  if (data.type === 'files:request') {
    void handleSessionRequest(
      data as { requestId: string; sessionId: string; action: string; [key: string]: unknown }
    )
  }
})
