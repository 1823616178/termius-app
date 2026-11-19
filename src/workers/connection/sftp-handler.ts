import {
  mkdir,
  open as fsOpen,
  rename as fsRename,
  stat as fsStat,
  unlink as fsUnlink,
  type FileHandle
} from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import type { Client, FileEntryWithStats, SFTPWrapper, Stats } from 'ssh2'
import {
  formatUnixPermissions,
  joinRemotePosixPath,
  normalizeRemotePosixPath,
  parentRemotePosixPath,
  remoteBaseName,
  sanitizeDownloadFilename,
  type SftpConflictDecision,
  type SftpEntry,
  type SftpEntryKind,
  type SftpListResult,
  type SftpProgressEvent,
  type SftpStatResult,
  type SftpTransferItem
} from '../../shared/sftp'
import type { SftpRemoteTreeManifest } from '../../shared/contracts'

export interface SftpSessionState {
  client: Client
  sftp?: SFTPWrapper
  sftpPromise?: Promise<SFTPWrapper>
  activeTransfers: Map<string, AbortController>
}

export interface SftpWorkerRequest {
  type: 'sftp:request'
  requestId: string
  sessionId: string
  action:
    | 'home'
    | 'list'
    | 'stat'
    | 'collectTree'
    | 'mkdir'
    | 'rename'
    | 'chmod'
    | 'delete'
    | 'upload'
    | 'download'
  path?: string
  oldPath?: string
  newPath?: string
  mode?: number
  recursive?: boolean
  transferId?: string
  localPath?: string
  remotePath?: string
  conflict?: SftpConflictDecision
  speedLimitBps?: number
}

const PIPELINE_CHUNK_SIZE = 32 * 1024
const PIPELINE_CONCURRENCY = 16
const MAX_TREE_ENTRIES = 5000

class AsyncRateLimiter {
  private readonly bytesPerSec: number
  private readonly capacity: number
  private tokens: number
  private lastRefillMs: number
  private chain: Promise<void> = Promise.resolve()

  constructor(speedLimitBps: number) {
    this.bytesPerSec = Number.isFinite(speedLimitBps) && speedLimitBps > 0 ? speedLimitBps : 0
    this.capacity =
      this.bytesPerSec > 0
        ? Math.max(PIPELINE_CHUNK_SIZE, Math.min(256 * 1024, Math.floor(this.bytesPerSec)))
        : 0
    this.tokens = this.capacity
    this.lastRefillMs = Date.now()
  }

  async consume(bytes: number, signal: AbortSignal): Promise<void> {
    if (this.bytesPerSec <= 0 || bytes <= 0) return
    const waitTurn = this.chain.then(async () => {
      if (signal.aborted) throw new Error('已取消传输')
      let remaining = bytes
      while (remaining > 0) {
        if (signal.aborted) throw new Error('已取消传输')
        const now = Date.now()
        const elapsed = Math.max(0, now - this.lastRefillMs)
        this.lastRefillMs = now
        this.tokens = Math.min(this.capacity, this.tokens + (elapsed / 1000) * this.bytesPerSec)
        if (this.tokens >= remaining) {
          this.tokens -= remaining
          return
        }
        if (this.tokens > 0) {
          remaining -= this.tokens
          this.tokens = 0
        }
        const waitMs = Math.max(10, Math.ceil((Math.min(remaining, this.capacity) / this.bytesPerSec) * 1000))
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => {
            clearTimeout(timer)
            reject(new Error('已取消传输'))
          }
          const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort)
            resolve()
          }, waitMs)
          signal.addEventListener('abort', onAbort, { once: true })
        })
      }
    })
    this.chain = waitTurn.catch(() => {})
    return waitTurn
  }
}

function sftpOpen(
  sftp: SFTPWrapper,
  path: string,
  flags: 'r' | 'w',
  attrs?: { mode?: number }
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const cb = (error: Error | undefined | null, handle: Buffer) => {
      if (error || !handle) reject(error ?? new Error('无法打开远端文件句柄'))
      else resolve(handle)
    }
    if (attrs) sftp.open(path, flags, attrs, cb)
    else sftp.open(path, flags, cb)
  })
}

function sftpClose(sftp: SFTPWrapper, handle: Buffer): Promise<void> {
  return new Promise((resolve) => {
    sftp.close(handle, () => resolve())
  })
}

function sftpWriteChunk(
  sftp: SFTPWrapper,
  handle: Buffer,
  buf: Buffer,
  offset: number,
  length: number,
  position: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.write(handle, buf, offset, length, position, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function sftpReadChunk(
  sftp: SFTPWrapper,
  handle: Buffer,
  buf: Buffer,
  offset: number,
  length: number,
  position: number
): Promise<number> {
  return new Promise((resolve, reject) => {
    sftp.read(handle, buf, offset, length, position, (error, bytesRead) => {
      if (error) reject(error)
      else resolve(bytesRead ?? 0)
    })
  })
}

function isMissingError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const err = error as { code?: number | string; message?: string }
  return err.code === 2 || err.code === 'ENOENT' || /no such file/i.test(err.message ?? '')
}

function classifyStats(
  stats: Pick<Stats, 'mode' | 'isDirectory' | 'isSymbolicLink' | 'isFile'>
): SftpEntryKind {
  if (typeof stats.isSymbolicLink === 'function' && stats.isSymbolicLink()) return 'symlink'
  if (typeof stats.isDirectory === 'function' && stats.isDirectory()) return 'directory'
  if (typeof stats.isFile === 'function' && stats.isFile()) return 'file'
  const fileType = stats.mode & 0o170000
  if (fileType === 0o120000) return 'symlink'
  if (fileType === 0o040000) return 'directory'
  if (fileType === 0o100000) return 'file'
  return 'other'
}

function toSftpEntry(
  name: string,
  fullPath: string,
  stats: Stats,
  extra?: { targetKind?: SftpEntryKind; linkTarget?: string }
): SftpEntry {
  const kind = classifyStats(stats)
  const mode = typeof stats.mode === 'number' ? stats.mode : 0o644
  return {
    name,
    path: fullPath,
    kind,
    ...(extra?.targetKind ? { targetKind: extra.targetKind } : {}),
    ...(extra?.linkTarget ? { linkTarget: extra.linkTarget } : {}),
    size: Number.isFinite(stats.size) ? stats.size : 0,
    mode,
    permissions: formatUnixPermissions(mode, kind),
    mtime: Number.isFinite(stats.mtime) ? stats.mtime : 0,
    uid: Number.isFinite(stats.uid) ? stats.uid : 0,
    gid: Number.isFinite(stats.gid) ? stats.gid : 0
  }
}

async function ensureSftp(state: SftpSessionState): Promise<SFTPWrapper> {
  if (state.sftp) return state.sftp
  if (!state.sftpPromise) {
    state.sftpPromise = new Promise<SFTPWrapper>((resolve, reject) => {
      state.client.sftp((error, sftp) => {
        if (error || !sftp) {
          state.sftpPromise = undefined
          reject(error ?? new Error('无法初始化 SFTP 通道'))
          return
        }
        state.sftp = sftp
        const clear = () => {
          state.sftp = undefined
          state.sftpPromise = undefined
        }
        sftp.once('close', clear)
        sftp.once('end', clear)
        resolve(sftp)
      })
    })
  }
  return state.sftpPromise
}

function sftpRealpath(sftp: SFTPWrapper, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    sftp.realpath(path, (error, absPath) => {
      if (error) reject(error)
      else resolve(normalizeRemotePosixPath(absPath || '/'))
    })
  })
}

function sftpExpandPath(sftp: SFTPWrapper, path: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    if (typeof sftp.ext_openssh_expandPath !== 'function') {
      resolve(undefined)
      return
    }
    try {
      sftp.ext_openssh_expandPath(path, (error, absPath) => {
        if (error || !absPath) resolve(undefined)
        else resolve(normalizeRemotePosixPath(absPath))
      })
    } catch {
      resolve(undefined)
    }
  })
}

async function resolveRemotePath(sftp: SFTPWrapper, rawPath: string): Promise<string> {
  const normalized = normalizeRemotePosixPath(rawPath)
  if (normalized === '~' || normalized.startsWith('~/')) {
    const expanded = await sftpExpandPath(sftp, normalized)
    if (expanded) return expanded
    const home = await sftpRealpath(sftp, '.')
    if (normalized === '~') return home
    return joinRemotePosixPath(home, normalized.slice(2))
  }
  return normalized
}

function sftpReaddir(sftp: SFTPWrapper, path: string): Promise<FileEntryWithStats[]> {
  return new Promise((resolve, reject) => {
    sftp.readdir(path, (error, list) => {
      if (error) reject(error)
      else resolve(list ?? [])
    })
  })
}

function sftpStat(sftp: SFTPWrapper, path: string): Promise<Stats> {
  return new Promise((resolve, reject) => {
    sftp.stat(path, (error, stats) => {
      if (error) reject(error)
      else resolve(stats)
    })
  })
}

function sftpLstat(sftp: SFTPWrapper, path: string): Promise<Stats> {
  return new Promise((resolve, reject) => {
    sftp.lstat(path, (error, stats) => {
      if (error) reject(error)
      else resolve(stats)
    })
  })
}

function sftpReadlink(sftp: SFTPWrapper, path: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    sftp.readlink(path, (error, target) => {
      resolve(error ? undefined : target)
    })
  })
}

function sftpMkdir(sftp: SFTPWrapper, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.mkdir(path, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function sftpRename(sftp: SFTPWrapper, oldPath: string, newPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.rename(oldPath, newPath, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function sftpPosixRename(sftp: SFTPWrapper, oldPath: string, newPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof sftp.ext_openssh_rename !== 'function') {
      reject(new Error('POSIX rename unavailable'))
      return
    }
    sftp.ext_openssh_rename(oldPath, newPath, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function sftpUnlink(sftp: SFTPWrapper, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.unlink(path, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function sftpRmdir(sftp: SFTPWrapper, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.rmdir(path, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function sftpChmod(sftp: SFTPWrapper, path: string, mode: number): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.chmod(path, mode, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

async function mapConcurrent<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const idx = nextIndex++
      results[idx] = await worker(items[idx]!)
    }
  })
  await Promise.all(runners)
  return results
}

async function listDirectory(sftp: SFTPWrapper, rawPath: string): Promise<SftpListResult> {
  const resolved = await resolveRemotePath(sftp, rawPath)
  const rawEntries = await sftpReaddir(sftp, resolved)
  const filtered = rawEntries.filter((item) => item.filename !== '.' && item.filename !== '..')
  const entries = await mapConcurrent(filtered, 8, async (item) => {
    const fullPath = joinRemotePosixPath(resolved, item.filename)
    const kind = classifyStats(item.attrs)
    if (kind === 'symlink') {
      const [linkTarget, targetStats] = await Promise.all([
        sftpReadlink(sftp, fullPath),
        sftpStat(sftp, fullPath).catch(() => undefined)
      ])
      return toSftpEntry(item.filename, fullPath, item.attrs, {
        ...(linkTarget ? { linkTarget } : {}),
        ...(targetStats ? { targetKind: classifyStats(targetStats) } : {})
      })
    }
    return toSftpEntry(item.filename, fullPath, item.attrs)
  })
  return {
    path: resolved,
    parentPath: parentRemotePosixPath(resolved),
    entries
  }
}

async function statRemote(sftp: SFTPWrapper, rawPath: string): Promise<SftpStatResult> {
  const resolved = await resolveRemotePath(sftp, rawPath)
  try {
    const stats = await sftpLstat(sftp, resolved)
    const kind = classifyStats(stats)
    if (kind === 'symlink') {
      const targetStats = await sftpStat(sftp, resolved).catch(() => undefined)
      return {
        exists: true,
        entry: toSftpEntry(remoteBaseName(resolved) || '/', resolved, stats, {
          ...(targetStats ? { targetKind: classifyStats(targetStats) } : {})
        })
      }
    }
    return {
      exists: true,
      entry: toSftpEntry(remoteBaseName(resolved) || '/', resolved, stats)
    }
  } catch (error) {
    if (isMissingError(error)) return { exists: false }
    throw error
  }
}

async function ensureRemoteDirectory(sftp: SFTPWrapper, rawPath: string): Promise<void> {
  const target = await resolveRemotePath(sftp, rawPath)
  if (target === '/') return
  // Fast path: check target directory directly before walking from root (saves N-1 RTTs on existing dirs).
  try {
    const existing = await sftpStat(sftp, target)
    if (classifyStats(existing).startsWith('dir')) return
    throw new Error(`路径已存在且不是目录：${target}`)
  } catch (error) {
    if (!isMissingError(error)) throw error
  }
  const parts = target.split('/').filter(Boolean)
  let current = ''
  for (const part of parts) {
    current = `${current}/${part}`
    try {
      const st = await sftpStat(sftp, current)
      if (!classifyStats(st).startsWith('dir')) {
        throw new Error(`路径已存在且不是目录：${current}`)
      }
    } catch (error) {
      if (!isMissingError(error)) throw error
      try {
        await sftpMkdir(sftp, current)
      } catch (mkdirErr) {
        const recheck = await sftpStat(sftp, current).catch(() => undefined)
        if (!recheck) throw mkdirErr
      }
    }
  }
}

async function collectRemoteTree(sftp: SFTPWrapper, rawPath: string): Promise<SftpRemoteTreeManifest> {
  const root = await resolveRemotePath(sftp, rawPath)
  const dirs: string[] = []
  const files: SftpRemoteTreeManifest['files'] = []
  let skippedSymlinks = 0
  let visited = 0

  async function walk(remoteDir: string, relDir: string): Promise<void> {
    const list = await sftpReaddir(sftp, remoteDir)
    for (const item of list) {
      if (item.filename === '.' || item.filename === '..') continue
      if (++visited > MAX_TREE_ENTRIES) {
        throw new Error(`目录条目超过 ${MAX_TREE_ENTRIES} 项上限，请分批下载`)
      }
      const safeSegment = sanitizeDownloadFilename(item.filename)
      const fullPath = joinRemotePosixPath(remoteDir, item.filename)
      const relPath = relDir ? `${relDir}/${safeSegment}` : safeSegment
      const kind = classifyStats(item.attrs)
      if (kind === 'symlink') {
        skippedSymlinks++
        continue
      }
      if (kind === 'directory') {
        dirs.push(relPath)
        await walk(fullPath, relPath)
      } else if (kind === 'file') {
        files.push({
          remotePath: fullPath,
          relativePath: relPath,
          name: safeSegment,
          size: Number.isFinite(item.attrs.size) ? item.attrs.size : 0
        })
      }
    }
  }

  await walk(root, '')
  return { dirs, files, skippedSymlinks }
}

async function removeRemotePath(sftp: SFTPWrapper, rawPath: string, recursive = false): Promise<void> {
  const target = await resolveRemotePath(sftp, rawPath)
  if (target === '/') throw new Error('出于安全限制，不允许删除根目录 /')
  const stats = await sftpLstat(sftp, target)
  const kind = classifyStats(stats)
  if (kind !== 'directory') {
    await sftpUnlink(sftp, target)
    return
  }
  if (!recursive) {
    await sftpRmdir(sftp, target)
    return
  }
  const children = await sftpReaddir(sftp, target)
  for (const child of children) {
    if (child.filename === '.' || child.filename === '..') continue
    const childPath = joinRemotePosixPath(target, child.filename)
    const childKind = classifyStats(child.attrs)
    if (childKind === 'directory') {
      await removeRemotePath(sftp, childPath, true)
    } else {
      await sftpUnlink(sftp, childPath)
    }
  }
  await sftpRmdir(sftp, target)
}

async function resolveNonCollidingRemotePath(sftp: SFTPWrapper, desiredPath: string): Promise<string> {
  const dir = parentRemotePosixPath(desiredPath)
  const name = remoteBaseName(desiredPath)
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let index = 1; index <= 999; index++) {
    const candidate = joinRemotePosixPath(dir, `${stem} (${index})${ext}`)
    const existing = await sftpLstat(sftp, candidate).catch(() => undefined)
    if (!existing) return candidate
  }
  throw new Error('无法生成不冲突的远端文件名')
}

async function resolveNonCollidingLocalPath(desiredPath: string): Promise<string> {
  const dir = dirname(desiredPath)
  const ext = extname(desiredPath)
  const stem = basename(desiredPath, ext)
  for (let index = 1; index <= 999; index++) {
    const candidate = join(dir, `${stem} (${index})${ext}`)
    const exists = await fsStat(candidate).catch(() => undefined)
    if (!exists) return candidate
  }
  throw new Error('无法生成不冲突的本地文件名')
}

async function promoteRemoteTemp(
  sftp: SFTPWrapper,
  tempPath: string,
  targetPath: string,
  overwrite: boolean
): Promise<void> {
  try {
    await sftpPosixRename(sftp, tempPath, targetPath)
    return
  } catch {
    /* Fall back to standard SFTP v3 rename */
  }
  try {
    await sftpRename(sftp, tempPath, targetPath)
    return
  } catch (error) {
    if (!overwrite) throw error
    const existing = await sftpLstat(sftp, targetPath).catch(() => undefined)
    if (!existing) throw error
    await sftpUnlink(sftp, targetPath)
    await sftpRename(sftp, tempPath, targetPath)
  }
}

async function uploadFile(
  state: SftpSessionState,
  sftp: SFTPWrapper,
  input: {
    transferId: string
    sessionId: string
    localPath: string
    remotePath: string
    conflict: SftpConflictDecision
    speedLimitBps?: number
  },
  emitProgress: (event: SftpProgressEvent) => void
): Promise<SftpTransferItem> {
  const startedAt = Date.now()
  const localStats = await fsStat(input.localPath)
  if (!localStats.isFile()) throw new Error(`只能上传普通文件：${input.localPath}`)
  const totalBytes = localStats.size
  let targetRemotePath = await resolveRemotePath(sftp, input.remotePath)
  const remoteDir = parentRemotePosixPath(targetRemotePath)
  await ensureRemoteDirectory(sftp, remoteDir)

  const existing = await sftpLstat(sftp, targetRemotePath).catch(() => undefined)
  if (existing) {
    if (input.conflict === 'skip') {
      const skipped: SftpTransferItem = {
        id: input.transferId,
        sessionId: input.sessionId,
        direction: 'upload',
        name: remoteBaseName(targetRemotePath) || basename(input.localPath),
        localPath: input.localPath,
        remotePath: targetRemotePath,
        totalBytes,
        transferredBytes: 0,
        speedBps: 0,
        status: 'completed',
        startedAt,
        updatedAt: Date.now()
      }
      return skipped
    }
    if (input.conflict === 'rename') {
      targetRemotePath = await resolveNonCollidingRemotePath(sftp, targetRemotePath)
    }
  }

  const fileName = remoteBaseName(targetRemotePath) || basename(input.localPath)
  const tempRemotePath = joinRemotePosixPath(remoteDir, `.orbit-part-${input.transferId}`)
  const controller = new AbortController()
  state.activeTransfers.set(input.transferId, controller)

  let transferredBytes = 0
  let lastEmitAt = 0
  let lastBytes = 0
  let speedBps = 0

  const sendUpdate = (status: SftpTransferItem['status'], error?: string, force = false): void => {
    const now = Date.now()
    if (!force && now - lastEmitAt < 120) return
    const dt = Math.max(0.05, (now - (lastEmitAt || startedAt)) / 1000)
    if (now > lastEmitAt) {
      speedBps = Math.max(0, Math.round((transferredBytes - lastBytes) / dt))
      lastEmitAt = now
      lastBytes = transferredBytes
    }
    emitProgress({
      transferId: input.transferId,
      sessionId: input.sessionId,
      direction: 'upload',
      name: fileName,
      localPath: input.localPath,
      remotePath: targetRemotePath,
      totalBytes,
      transferredBytes,
      speedBps,
      status,
      ...(error ? { error } : {})
    })
  }

  sendUpdate('running', undefined, true)
  let localFh: FileHandle | undefined
  let remoteHandle: Buffer | undefined
  try {
    if (controller.signal.aborted) throw new Error('已取消传输')
    localFh = await fsOpen(input.localPath, 'r')
    remoteHandle = await sftpOpen(sftp, tempRemotePath, 'w', {
      mode: localStats.mode & 0o777 || 0o644
    })

    const limiter = new AsyncRateLimiter(input.speedLimitBps ?? 0)
    const workerCount =
      totalBytes > 0 ? Math.min(PIPELINE_CONCURRENCY, Math.ceil(totalBytes / PIPELINE_CHUNK_SIZE)) : 0
    let nextOffset = 0
    let firstError: unknown

    const runners = Array.from({ length: workerCount }, async () => {
      const buf = Buffer.allocUnsafe(PIPELINE_CHUNK_SIZE)
      while (!firstError && !controller.signal.aborted) {
        const offset = nextOffset
        if (offset >= totalBytes) break
        const len = Math.min(PIPELINE_CHUNK_SIZE, totalBytes - offset)
        nextOffset += len
        try {
          const { bytesRead } = await localFh!.read(buf, 0, len, offset)
          if (bytesRead <= 0) break
          await limiter.consume(bytesRead, controller.signal)
          if (controller.signal.aborted) throw new Error('已取消传输')
          await sftpWriteChunk(sftp, remoteHandle!, buf, 0, bytesRead, offset)
          transferredBytes += bytesRead
          sendUpdate('running')
        } catch (err) {
          if (!firstError) firstError = err
          break
        }
      }
    })

    await Promise.all(runners)
    if (firstError) throw firstError
    if (controller.signal.aborted) throw new Error('已取消传输')

    await sftpClose(sftp, remoteHandle)
    remoteHandle = undefined
    await localFh.close()
    localFh = undefined

    await promoteRemoteTemp(sftp, tempRemotePath, targetRemotePath, input.conflict === 'overwrite')
    transferredBytes = totalBytes
    sendUpdate('completed', undefined, true)
    return {
      id: input.transferId,
      sessionId: input.sessionId,
      direction: 'upload',
      name: fileName,
      localPath: input.localPath,
      remotePath: targetRemotePath,
      totalBytes,
      transferredBytes,
      speedBps,
      status: 'completed',
      startedAt,
      updatedAt: Date.now()
    }
  } catch (error) {
    if (remoteHandle) {
      await sftpClose(sftp, remoteHandle).catch(() => {})
      remoteHandle = undefined
    }
    if (localFh) {
      await localFh.close().catch(() => {})
      localFh = undefined
    }
    await sftpUnlink(sftp, tempRemotePath).catch(() => {})
    const cancelled = controller.signal.aborted
    const message = cancelled ? '已取消传输' : error instanceof Error ? error.message : '上传失败'
    sendUpdate(cancelled ? 'cancelled' : 'failed', message, true)
    throw new Error(message)
  } finally {
    state.activeTransfers.delete(input.transferId)
  }
}

async function downloadFile(
  state: SftpSessionState,
  sftp: SFTPWrapper,
  input: {
    transferId: string
    sessionId: string
    remotePath: string
    localPath: string
    conflict: SftpConflictDecision
    speedLimitBps?: number
  },
  emitProgress: (event: SftpProgressEvent) => void
): Promise<SftpTransferItem> {
  const startedAt = Date.now()
  const resolvedRemote = await resolveRemotePath(sftp, input.remotePath)
  const remoteStats = await sftpStat(sftp, resolvedRemote)
  if (classifyStats(remoteStats) === 'directory') {
    throw new Error(`远端路径是目录，请使用目录下载：${resolvedRemote}`)
  }
  const totalBytes = Number.isFinite(remoteStats.size) ? remoteStats.size : 0
  let targetLocalPath = input.localPath
  const existingLocal = await fsStat(targetLocalPath).catch(() => undefined)
  if (existingLocal) {
    if (input.conflict === 'skip') {
      return {
        id: input.transferId,
        sessionId: input.sessionId,
        direction: 'download',
        name: basename(targetLocalPath),
        localPath: targetLocalPath,
        remotePath: resolvedRemote,
        totalBytes,
        transferredBytes: 0,
        speedBps: 0,
        status: 'completed',
        startedAt,
        updatedAt: Date.now()
      }
    }
    if (input.conflict === 'rename') {
      targetLocalPath = await resolveNonCollidingLocalPath(targetLocalPath)
    }
  }

  await mkdir(dirname(targetLocalPath), { recursive: true })
  const fileName = basename(targetLocalPath)
  const tempLocalPath = `${targetLocalPath}.orbit-part-${input.transferId}`
  const controller = new AbortController()
  state.activeTransfers.set(input.transferId, controller)

  let transferredBytes = 0
  let lastEmitAt = 0
  let lastBytes = 0
  let speedBps = 0

  const sendUpdate = (status: SftpTransferItem['status'], error?: string, force = false): void => {
    const now = Date.now()
    if (!force && now - lastEmitAt < 120) return
    const dt = Math.max(0.05, (now - (lastEmitAt || startedAt)) / 1000)
    if (now > lastEmitAt) {
      speedBps = Math.max(0, Math.round((transferredBytes - lastBytes) / dt))
      lastEmitAt = now
      lastBytes = transferredBytes
    }
    emitProgress({
      transferId: input.transferId,
      sessionId: input.sessionId,
      direction: 'download',
      name: fileName,
      localPath: targetLocalPath,
      remotePath: resolvedRemote,
      totalBytes,
      transferredBytes,
      speedBps,
      status,
      ...(error ? { error } : {})
    })
  }

  sendUpdate('running', undefined, true)
  let remoteHandle: Buffer | undefined
  let localFh: FileHandle | undefined
  try {
    if (controller.signal.aborted) throw new Error('已取消传输')
    remoteHandle = await sftpOpen(sftp, resolvedRemote, 'r')
    localFh = await fsOpen(tempLocalPath, 'w')

    const limiter = new AsyncRateLimiter(input.speedLimitBps ?? 0)
    const workerCount =
      totalBytes > 0 ? Math.min(PIPELINE_CONCURRENCY, Math.ceil(totalBytes / PIPELINE_CHUNK_SIZE)) : 0
    let nextOffset = 0
    let firstError: unknown

    const runners = Array.from({ length: workerCount }, async () => {
      const buf = Buffer.allocUnsafe(PIPELINE_CHUNK_SIZE)
      while (!firstError && !controller.signal.aborted) {
        const offset = nextOffset
        if (offset >= totalBytes) break
        const expected = Math.min(PIPELINE_CHUNK_SIZE, totalBytes - offset)
        nextOffset += expected
        try {
          let filled = 0
          while (filled < expected) {
            if (controller.signal.aborted) throw new Error('已取消传输')
            const n = await sftpReadChunk(
              sftp,
              remoteHandle!,
              buf,
              filled,
              expected - filled,
              offset + filled
            )
            if (n <= 0) break
            await limiter.consume(n, controller.signal)
            filled += n
            transferredBytes += n
            sendUpdate('running')
          }
          if (filled > 0) {
            await localFh!.write(buf, 0, filled, offset)
          }
        } catch (err) {
          if (!firstError) firstError = err
          break
        }
      }
    })

    await Promise.all(runners)
    if (firstError) throw firstError
    if (controller.signal.aborted) throw new Error('已取消传输')

    await localFh.close()
    localFh = undefined
    await sftpClose(sftp, remoteHandle)
    remoteHandle = undefined

    try {
      await fsRename(tempLocalPath, targetLocalPath)
    } catch (renameError) {
      if (input.conflict === 'overwrite') {
        await fsUnlink(targetLocalPath).catch(() => {})
        await fsRename(tempLocalPath, targetLocalPath)
      } else {
        throw renameError
      }
    }
    transferredBytes = totalBytes
    sendUpdate('completed', undefined, true)
    return {
      id: input.transferId,
      sessionId: input.sessionId,
      direction: 'download',
      name: fileName,
      localPath: targetLocalPath,
      remotePath: resolvedRemote,
      totalBytes,
      transferredBytes,
      speedBps,
      status: 'completed',
      startedAt,
      updatedAt: Date.now()
    }
  } catch (error) {
    if (localFh) {
      await localFh.close().catch(() => {})
      localFh = undefined
    }
    if (remoteHandle) {
      await sftpClose(sftp, remoteHandle).catch(() => {})
      remoteHandle = undefined
    }
    await fsUnlink(tempLocalPath).catch(() => {})
    const cancelled = controller.signal.aborted
    const message = cancelled ? '已取消传输' : error instanceof Error ? error.message : '下载失败'
    sendUpdate(cancelled ? 'cancelled' : 'failed', message, true)
    throw new Error(message)
  } finally {
    state.activeTransfers.delete(input.transferId)
  }
}

export async function handleSftpRequest(
  state: SftpSessionState,
  req: SftpWorkerRequest,
  emitProgress: (event: SftpProgressEvent) => void
): Promise<unknown> {
  const sftp = await ensureSftp(state)
  switch (req.action) {
    case 'home':
      return sftpRealpath(sftp, '.')
    case 'list':
      return listDirectory(sftp, req.path || '.')
    case 'stat':
      return statRemote(sftp, req.path || '.')
    case 'collectTree':
      return collectRemoteTree(sftp, req.path || '.')
    case 'mkdir':
      await ensureRemoteDirectory(sftp, req.path || '')
      return undefined
    case 'rename': {
      const oldPath = await resolveRemotePath(sftp, req.oldPath || '')
      const newPath = await resolveRemotePath(sftp, req.newPath || '')
      await sftpRename(sftp, oldPath, newPath)
      return undefined
    }
    case 'chmod': {
      const target = await resolveRemotePath(sftp, req.path || '')
      await sftpChmod(sftp, target, req.mode ?? 0o644)
      return undefined
    }
    case 'delete':
      await removeRemotePath(sftp, req.path || '', Boolean(req.recursive))
      return undefined
    case 'upload':
      if (!req.transferId || !req.localPath || !req.remotePath) {
        throw new Error('缺少上传参数')
      }
      return uploadFile(
        state,
        sftp,
        {
          transferId: req.transferId,
          sessionId: req.sessionId,
          localPath: req.localPath,
          remotePath: req.remotePath,
          conflict: req.conflict ?? 'overwrite',
          speedLimitBps: typeof req.speedLimitBps === 'number' ? req.speedLimitBps : 0
        },
        emitProgress
      )
    case 'download':
      if (!req.transferId || !req.remotePath || !req.localPath) {
        throw new Error('缺少下载参数')
      }
      return downloadFile(
        state,
        sftp,
        {
          transferId: req.transferId,
          sessionId: req.sessionId,
          remotePath: req.remotePath,
          localPath: req.localPath,
          conflict: req.conflict ?? 'overwrite',
          speedLimitBps: typeof req.speedLimitBps === 'number' ? req.speedLimitBps : 0
        },
        emitProgress
      )
  }
}
