import { stat as fsStat, unlink as fsUnlink } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { Transform, type TransformCallback } from 'node:stream'
import { randomUUID } from 'node:crypto'
import type { FileSecretsInput } from '../../shared/files'
import { joinRemotePosixPath, parentRemotePosixPath, remoteBaseName } from '../../shared/sftp'

/**
 * Shared stream throttling, progress batching, conflict naming and safe error
 * redaction helpers used by all VFS protocol adapters.
 */

export function collectSecretsToRedact(secrets?: FileSecretsInput): string[] {
  if (!secrets) return []
  return [secrets.password, secrets.token, secrets.secretAccessKey, secrets.sessionToken].filter(
    (value): value is string => typeof value === 'string' && value.length >= 2
  )
}

const TLS_CERT_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'
])

function extractErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return ''
  const rec = error as { code?: unknown; cause?: unknown }
  if (typeof rec.code === 'string') return rec.code
  if (
    rec.cause &&
    typeof rec.cause === 'object' &&
    typeof (rec.cause as { code?: unknown }).code === 'string'
  ) {
    return (rec.cause as { code: string }).code
  }
  return ''
}

function extractHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const rec = error as {
    status?: unknown
    statusCode?: unknown
    code?: unknown
    $metadata?: { httpStatusCode?: number }
  }
  if (typeof rec.status === 'number') return rec.status
  if (typeof rec.statusCode === 'number') return rec.statusCode
  if (typeof rec.$metadata?.httpStatusCode === 'number') return rec.$metadata.httpStatusCode
  if (typeof rec.code === 'number') return rec.code
  return undefined
}

export function sanitizeFileError(error: unknown, secrets: string[] = []): Error {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new Error('操作已取消')
  }
  const errObj = error instanceof Error ? error : new Error(String(error ?? '未知错误'))
  if (errObj.name === 'AbortError' || errObj.message === 'The operation was aborted') {
    return new Error('操作已取消')
  }
  const code = extractErrorCode(error)
  const status = extractHttpStatus(error)
  let rawMessage = errObj.message || '操作失败'

  for (const secret of secrets) {
    if (secret) rawMessage = rawMessage.split(secret).join('***')
  }
  // Strip user:password@ inside embedded URLs if any library echoed them
  rawMessage = rawMessage.replace(/\/\/[^/\s:@]+:[^/\s@]+@/g, '//***:***@')

  if (TLS_CERT_CODES.has(code) || /certificate|self[- ]signed|unable to verify/i.test(rawMessage)) {
    return new Error('TLS 证书校验失败；若为自签证书，可在连接配置中开启“忽略证书错误”。')
  }
  if (code === 'ECONNREFUSED') {
    return new Error('目标服务器拒绝连接，请检查主机地址、端口及服务状态。')
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return new Error('无法解析主机域名，请检查网络或地址拼写。')
  }
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || /timeout/i.test(rawMessage)) {
    return new Error('连接或请求超时，请检查网络连通性与超时设置。')
  }
  if (code === 'ECONNRESET' || code === 'EPIPE') {
    return new Error('连接被远端意外中断，请检查网络后重试。')
  }
  if (
    status === 401 ||
    status === 403 ||
    /\b(530|430)\b|InvalidAccessKeyId|SignatureDoesNotMatch|AccessDenied|authentication failed|login incorrect|unauthorized/i.test(
      rawMessage
    )
  ) {
    return new Error('认证或权限校验失败，请检查账号、凭据或访问权限。')
  }
  if (status === 404 || code === 'ENOENT' || /NoSuchKey|NoSuchBucket|not found|\b550\b/i.test(rawMessage)) {
    return new Error(`远端路径或对象不存在（${rawMessage.slice(0, 120)}）`)
  }
  return new Error(rawMessage)
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('操作已取消')
  }
}

export function createTimeoutLinkedSignal(
  timeoutMs: number,
  outer?: AbortSignal
): {
  signal: AbortSignal
  cleanup(): void
} {
  const controller = new AbortController()
  const onOuterAbort = () => controller.abort(outer?.reason ?? new Error('操作已取消'))
  if (outer) {
    if (outer.aborted) {
      controller.abort(outer.reason ?? new Error('操作已取消'))
    } else {
      outer.addEventListener('abort', onOuterAbort, { once: true })
    }
  }
  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          controller.abort(new Error('连接或请求超时'))
        }, timeoutMs)
      : undefined
  return {
    signal: controller.signal,
    cleanup() {
      if (timer) clearTimeout(timer)
      outer?.removeEventListener('abort', onOuterAbort)
    }
  }
}

/**
 * Token-bucket throttle + byte-counting Transform stream.
 * Pass `speedLimitBps = 0` for unrestricted throughput while still reporting byte counts.
 */
export class MeteredThrottleStream extends Transform {
  private readonly bytesPerSec: number
  private readonly chunkCap: number
  private readonly onBytes: (totalBytes: number) => void
  private readonly signal?: AbortSignal
  private totalBytes = 0
  private tokens: number
  private lastRefillMs: number
  private waitTimer?: NodeJS.Timeout

  constructor(options: {
    speedLimitBps: number
    signal?: AbortSignal
    onBytes: (totalBytes: number) => void
  }) {
    super()
    this.bytesPerSec =
      Number.isFinite(options.speedLimitBps) && options.speedLimitBps > 0 ? options.speedLimitBps : 0
    this.chunkCap =
      this.bytesPerSec > 0 ? Math.max(8192, Math.min(65536, Math.floor(this.bytesPerSec / 4))) : 0
    this.tokens = this.chunkCap
    this.lastRefillMs = Date.now()
    this.onBytes = options.onBytes
    this.signal = options.signal
  }

  private refill(): void {
    const now = Date.now()
    const elapsed = Math.max(0, now - this.lastRefillMs)
    this.lastRefillMs = now
    this.tokens = Math.min(this.chunkCap, this.tokens + (elapsed / 1000) * this.bytesPerSec)
  }

  private pushWithRate(buf: Buffer, offset: number, callback: TransformCallback): void {
    if (this.signal?.aborted) {
      callback(new Error('操作已取消'))
      return
    }
    if (offset >= buf.length) {
      callback()
      return
    }
    if (this.bytesPerSec <= 0) {
      const slice = offset === 0 ? buf : buf.subarray(offset)
      this.push(slice)
      this.totalBytes += slice.length
      this.onBytes(this.totalBytes)
      callback()
      return
    }

    this.refill()
    const remaining = buf.length - offset
    if (this.tokens >= 1) {
      const take = Math.min(remaining, this.chunkCap, Math.max(1024, Math.floor(this.tokens)))
      this.tokens -= take
      const slice = buf.subarray(offset, offset + take)
      this.push(slice)
      this.totalBytes += take
      this.onBytes(this.totalBytes)
      if (offset + take >= buf.length) {
        callback()
      } else {
        setImmediate(() => this.pushWithRate(buf, offset + take, callback))
      }
      return
    }

    const neededTokens = Math.min(remaining, 8192) - this.tokens
    const waitMs = Math.max(10, Math.ceil((neededTokens / this.bytesPerSec) * 1000))
    this.waitTimer = setTimeout(() => {
      this.waitTimer = undefined
      this.pushWithRate(buf, offset, callback)
    }, waitMs)
  }

  _transform(chunk: Buffer | string, encoding: BufferEncoding, callback: TransformCallback): void {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding)
    this.pushWithRate(buf, 0, callback)
  }

  _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    if (this.waitTimer) {
      clearTimeout(this.waitTimer)
      this.waitTimer = undefined
    }
    callback(error)
  }
}

export function createProgressReporter(
  totalBytes: number,
  emit: (transferredBytes: number, totalBytes: number) => void,
  minIntervalMs = 90
): {
  update(transferredBytes: number): void
  finish(finalBytes?: number): void
} {
  let lastEmitAt = 0
  let lastValue = -1
  return {
    update(transferredBytes: number) {
      const clamped = Math.max(0, totalBytes > 0 ? Math.min(transferredBytes, totalBytes) : transferredBytes)
      const now = Date.now()
      if (clamped === lastValue && now - lastEmitAt < minIntervalMs) return
      if (
        lastEmitAt === 0 ||
        now - lastEmitAt >= minIntervalMs ||
        (totalBytes > 0 && clamped >= totalBytes)
      ) {
        lastEmitAt = now
        lastValue = clamped
        emit(clamped, totalBytes)
      }
    },
    finish(finalBytes?: number) {
      const value = finalBytes ?? totalBytes
      lastEmitAt = Date.now()
      lastValue = value
      emit(value, Math.max(totalBytes, value))
    }
  }
}

export async function resolveNonCollidingLocalPath(desiredPath: string): Promise<string> {
  const dir = dirname(desiredPath)
  const ext = extname(desiredPath)
  const stem = basename(desiredPath, ext)
  const existsFirst = await fsStat(desiredPath).catch(() => undefined)
  if (!existsFirst) return desiredPath
  for (let index = 1; index <= 999; index++) {
    const candidate = join(dir, `${stem} (${index})${ext}`)
    const exists = await fsStat(candidate).catch(() => undefined)
    if (!exists) return candidate
  }
  throw new Error('无法生成不冲突的本地文件名')
}

export async function resolveNonCollidingRemotePath(
  desiredPath: string,
  existsFn: (candidate: string) => Promise<boolean>
): Promise<string> {
  if (!(await existsFn(desiredPath))) return desiredPath
  const dir = parentRemotePosixPath(desiredPath)
  const name = remoteBaseName(desiredPath)
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let index = 1; index <= 999; index++) {
    const candidate = joinRemotePosixPath(dir, `${stem} (${index})${ext}`)
    if (!(await existsFn(candidate))) return candidate
  }
  throw new Error('无法生成不冲突的远端文件名')
}

export function buildTempRemotePath(targetPath: string): string {
  const dir = parentRemotePosixPath(targetPath)
  const name = remoteBaseName(targetPath) || 'upload'
  return joinRemotePosixPath(dir, `.orbit-tmp-${randomUUID().slice(0, 8)}-${name}`)
}

export function buildTempLocalPath(targetPath: string): string {
  const dir = dirname(targetPath)
  const name = basename(targetPath) || 'download'
  return join(dir, `.orbit-part-${randomUUID().slice(0, 8)}-${name}`)
}

export async function unlinkLocalQuietly(path: string): Promise<void> {
  await fsUnlink(path).catch(() => {})
}

export function toEpochSeconds(dateLike?: Date | string | number | null): number {
  if (dateLike instanceof Date) {
    const ms = dateLike.getTime()
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0
  }
  if (typeof dateLike === 'string' && dateLike.trim()) {
    const ms = Date.parse(dateLike)
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0
  }
  if (typeof dateLike === 'number' && Number.isFinite(dateLike)) {
    return dateLike > 10_000_000_000 ? Math.floor(dateLike / 1000) : Math.floor(dateLike)
  }
  return 0
}
