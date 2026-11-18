import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename as fsRename, stat as fsStat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { PassThrough } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Client, FileType, type AccessOptions, type FileInfo } from 'basic-ftp'
import type { SftpRemoteTreeManifest } from '../../../shared/contracts'
import { capabilitiesFor, FILE_DEFAULT_PORTS, type FileConnectConfig } from '../../../shared/files'
import {
  formatOctalMode,
  formatUnixPermissions,
  joinRemotePosixPath,
  normalizeRemotePosixPath,
  parentRemotePosixPath,
  remoteBaseName,
  type SftpEntry,
  type SftpEntryKind,
  type SftpListResult,
  type SftpStatResult
} from '../../../shared/sftp'
import type { DownloadParams, FileAdapter, TransferOutcome, UploadParams } from '../adapter'
import {
  buildTempLocalPath,
  buildTempRemotePath,
  collectSecretsToRedact,
  createProgressReporter,
  MeteredThrottleStream,
  resolveNonCollidingLocalPath,
  resolveNonCollidingRemotePath,
  sanitizeFileError,
  throwIfAborted,
  toEpochSeconds,
  unlinkLocalQuietly
} from '../transfer-utils'

const MAX_COLLECT_ENTRIES = 5000

function fileInfoToKind(info: FileInfo): SftpEntryKind {
  if (info.type === FileType.Directory || info.isDirectory) return 'directory'
  if (info.type === FileType.SymbolicLink || info.isSymbolicLink) return 'symlink'
  if (info.type === FileType.File || info.isFile) return 'file'
  return 'other'
}

function fileInfoToMode(info: FileInfo, kind: SftpEntryKind): number {
  if (info.permissions) {
    const p = info.permissions
    const typeBits = kind === 'directory' ? 0o040000 : kind === 'symlink' ? 0o120000 : 0o100000
    return typeBits | ((p.user & 7) << 6) | ((p.group & 7) << 3) | (p.world & 7)
  }
  return kind === 'directory' ? 0o040755 : 0o100644
}

function toSftpEntry(info: FileInfo, fullPath: string): SftpEntry {
  const kind = fileInfoToKind(info)
  const mode = fileInfoToMode(info, kind)
  return {
    name: info.name,
    path: fullPath,
    kind,
    ...(info.link ? { linkTarget: info.link } : {}),
    size: Number.isFinite(info.size) && info.size >= 0 ? info.size : 0,
    mode,
    permissions: formatUnixPermissions(mode, kind),
    mtime: toEpochSeconds(info.modifiedAt),
    uid: 0,
    gid: 0
  }
}

export class FtpAdapter implements FileAdapter {
  readonly capabilities: ReturnType<typeof capabilitiesFor>
  private readonly secrets: string[]
  private readonly accessOptions: AccessOptions
  private readonly timeoutMs: number
  private controlClient: Client
  private controlQueue: Promise<unknown> = Promise.resolve()
  private initialHome = '/'
  private closed = false

  constructor(private readonly config: FileConnectConfig) {
    this.capabilities = capabilitiesFor(config.protocol)
    this.secrets = collectSecretsToRedact(config.secrets)
    this.timeoutMs = Math.max(5000, config.connectTimeoutMs || 20_000)
    const isImplicit = config.protocol === 'ftps' && config.options.tlsMode === 'implicit'
    const defaultPort = isImplicit ? 990 : FILE_DEFAULT_PORTS[config.protocol]
    const port = config.port > 0 ? config.port : defaultPort
    const username = config.username.trim() || 'anonymous'
    const password = config.secrets.password ?? (username === 'anonymous' ? 'anonymous@orbit' : '')
    const secure: AccessOptions['secure'] =
      config.protocol === 'ftps' ? (isImplicit ? 'implicit' : true) : false

    this.accessOptions = {
      host: config.host,
      port,
      user: username,
      password,
      secure,
      ...(config.protocol === 'ftps'
        ? { secureOptions: { rejectUnauthorized: config.options.tlsVerify !== 'insecure' } }
        : {})
    }
    this.controlClient = this.createRawClient()
  }

  private createRawClient(): Client {
    const client = new Client(this.timeoutMs)
    client.ftp.encoding = 'utf-8'
    return client
  }

  private async openClient(signal?: AbortSignal): Promise<Client> {
    throwIfAborted(signal)
    const client = this.createRawClient()
    const onAbort = () => {
      try {
        client.close()
      } catch {
        /* ignore */
      }
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      await client.access(this.accessOptions)
      client.ftp.encoding = 'utf-8'
      return client
    } catch (error) {
      client.close()
      throw sanitizeFileError(error, this.secrets)
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }
  }

  private runControl<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    const next = this.controlQueue.then(async () => {
      if (this.closed) throw new Error('文件会话已关闭')
      if (this.controlClient.closed) {
        this.controlClient = await this.openClient()
      }
      try {
        return await fn(this.controlClient)
      } catch (error) {
        // Reconnect once transparently if the control socket dropped underneath us
        if (this.controlClient.closed && !this.closed) {
          try {
            this.controlClient = await this.openClient()
            return await fn(this.controlClient)
          } catch (retryErr) {
            throw sanitizeFileError(retryErr, this.secrets)
          }
        }
        throw sanitizeFileError(error, this.secrets)
      }
    })
    // Keep the queue alive even if a call rejects
    this.controlQueue = next.catch(() => {})
    return next
  }

  async connect(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal)
    try {
      this.controlClient = await this.openClient(signal)
      const pwd = await this.controlClient.pwd().catch(() => '/')
      const startPath = this.config.initialPath.trim()
        ? normalizeRemotePosixPath(this.config.initialPath)
        : normalizeRemotePosixPath(pwd || '/')
      this.initialHome = startPath
    } catch (error) {
      this.controlClient.close()
      throw sanitizeFileError(error, this.secrets)
    }
  }

  async close(): Promise<void> {
    this.closed = true
    try {
      this.controlClient.close()
    } catch {
      /* ignore */
    }
  }

  async home(): Promise<string> {
    return this.initialHome
  }

  async list(rawPath: string): Promise<SftpListResult> {
    const targetPath = normalizeRemotePosixPath(rawPath || '/')
    return this.runControl(async (client) => {
      const list = await client.list(targetPath)
      const entries: SftpEntry[] = []
      for (const item of list) {
        if (!item.name || item.name === '.' || item.name === '..') continue
        const fullPath = joinRemotePosixPath(targetPath, item.name)
        entries.push(toSftpEntry(item, fullPath))
      }
      return {
        path: targetPath,
        parentPath: parentRemotePosixPath(targetPath),
        entries
      }
    })
  }

  private async statWithClient(client: Client, rawPath: string): Promise<SftpStatResult> {
    const targetPath = normalizeRemotePosixPath(rawPath || '/')
    if (targetPath === '/') {
      return {
        exists: true,
        entry: {
          name: '/',
          path: '/',
          kind: 'directory',
          size: 0,
          mode: 0o040755,
          permissions: formatUnixPermissions(0o040755, 'directory'),
          mtime: 0,
          uid: 0,
          gid: 0
        }
      }
    }
    const parent = parentRemotePosixPath(targetPath)
    const leaf = remoteBaseName(targetPath)
    try {
      const items = await client.list(parent)
      const hit = items.find((item) => item.name === leaf)
      if (!hit) return { exists: false }
      return { exists: true, entry: toSftpEntry(hit, targetPath) }
    } catch {
      return { exists: false }
    }
  }

  async stat(rawPath: string): Promise<SftpStatResult> {
    return this.runControl((client) => this.statWithClient(client, rawPath))
  }

  async collectTree(rawPath: string): Promise<SftpRemoteTreeManifest> {
    const rootPath = normalizeRemotePosixPath(rawPath || '/')
    return this.runControl(async (client) => {
      const statRes = await this.statWithClient(client, rootPath)
      if (!statRes.exists || !statRes.entry) {
        throw new Error(`远端路径不存在：${rootPath}`)
      }
      const rootName = remoteBaseName(rootPath) || 'download'
      if (statRes.entry.kind === 'symlink') {
        return { dirs: [], files: [], skippedSymlinks: 1 }
      }
      if (statRes.entry.kind !== 'directory') {
        return {
          dirs: [],
          files: [{ remotePath: rootPath, relativePath: rootName, name: rootName, size: statRes.entry.size }],
          skippedSymlinks: 0
        }
      }

      const dirs: string[] = [rootName]
      const files: SftpRemoteTreeManifest['files'] = []
      let skippedSymlinks = 0
      const walk = async (curRemote: string, curRel: string): Promise<void> => {
        if (dirs.length + files.length >= MAX_COLLECT_ENTRIES) {
          throw new Error(`单次下载最多包含 ${MAX_COLLECT_ENTRIES} 个条目，请分批下载`)
        }
        const items = await client.list(curRemote)
        for (const item of items) {
          if (!item.name || item.name === '.' || item.name === '..') continue
          const childRemote = joinRemotePosixPath(curRemote, item.name)
          const childRel = `${curRel}/${item.name}`
          const kind = fileInfoToKind(item)
          if (kind === 'symlink') {
            skippedSymlinks++
            continue
          }
          if (kind === 'directory') {
            dirs.push(childRel)
            await walk(childRemote, childRel)
          } else if (kind === 'file') {
            files.push({
              remotePath: childRemote,
              relativePath: childRel,
              name: item.name,
              size: Number.isFinite(item.size) ? item.size : 0
            })
          }
          if (dirs.length + files.length >= MAX_COLLECT_ENTRIES) {
            throw new Error(`单次下载最多包含 ${MAX_COLLECT_ENTRIES} 个条目，请分批下载`)
          }
        }
      }
      await walk(rootPath, rootName)
      return { dirs, files, skippedSymlinks }
    })
  }

  private async ensureDirWithClient(client: Client, targetPath: string): Promise<void> {
    const normalized = normalizeRemotePosixPath(targetPath)
    if (normalized === '/') return
    const segments = normalized.split('/').filter(Boolean)
    let cur = ''
    for (const seg of segments) {
      cur = `${cur}/${seg}`
      const st = await this.statWithClient(client, cur)
      if (!st.exists) {
        await client.send(`MKD ${cur}`)
      }
    }
  }

  async mkdir(rawPath: string): Promise<void> {
    const targetPath = normalizeRemotePosixPath(rawPath)
    if (targetPath === '/') return
    await this.runControl(async (client) => {
      await this.ensureDirWithClient(client, targetPath)
    })
  }

  async rename(oldRaw: string, newRaw: string): Promise<void> {
    const from = normalizeRemotePosixPath(oldRaw)
    const to = normalizeRemotePosixPath(newRaw)
    await this.runControl(async (client) => {
      await client.rename(from, to)
    })
  }

  async chmod(rawPath: string, mode: number): Promise<void> {
    const targetPath = normalizeRemotePosixPath(rawPath)
    const octal = formatOctalMode(mode)
    await this.runControl(async (client) => {
      const resp = await client.send(`SITE CHMOD ${octal} ${targetPath}`)
      if (resp.code >= 400) {
        throw new Error(`服务端不支持或拒绝修改权限 (${resp.message})`)
      }
    })
  }

  private async removeTreeWithClient(client: Client, targetPath: string): Promise<void> {
    const items = await client.list(targetPath)
    for (const item of items) {
      if (!item.name || item.name === '.' || item.name === '..') continue
      const child = joinRemotePosixPath(targetPath, item.name)
      const kind = fileInfoToKind(item)
      if (kind === 'directory') {
        await this.removeTreeWithClient(client, child)
      } else {
        await client.remove(child)
      }
    }
    await client.send(`RMD ${targetPath}`)
  }

  async remove(rawPath: string, recursive: boolean): Promise<void> {
    const targetPath = normalizeRemotePosixPath(rawPath)
    if (targetPath === '/') throw new Error('禁止删除根目录')
    await this.runControl(async (client) => {
      const st = await this.statWithClient(client, targetPath)
      if (!st.exists || !st.entry) throw new Error(`远端路径不存在：${targetPath}`)
      if (st.entry.kind === 'directory') {
        if (!recursive) {
          const children = await client.list(targetPath)
          const nonDot = children.filter((c) => c.name && c.name !== '.' && c.name !== '..')
          if (nonDot.length > 0) throw new Error('目录非空，请启用递归删除')
          await client.send(`RMD ${targetPath}`)
        } else {
          await this.removeTreeWithClient(client, targetPath)
        }
      } else {
        await client.remove(targetPath)
      }
    })
  }

  async upload(params: UploadParams): Promise<TransferOutcome> {
    throwIfAborted(params.signal)
    const localStats = await fsStat(params.localPath)
    if (!localStats.isFile()) throw new Error(`只能上传普通文件：${params.localPath}`)
    const totalBytes = localStats.size
    const desiredPath = normalizeRemotePosixPath(params.remotePath)

    const txClient = await this.openClient(params.signal)
    const onAbort = () => {
      try {
        txClient.close()
      } catch {
        /* ignore */
      }
    }
    params.signal.addEventListener('abort', onAbort, { once: true })

    let tempRemote = ''
    try {
      let targetPath = desiredPath
      const exists = async (candidate: string) => (await this.statWithClient(txClient, candidate)).exists

      if (params.conflict === 'skip' && (await exists(desiredPath))) {
        return { status: 'skipped', finalPath: desiredPath, bytes: totalBytes }
      }
      if (params.conflict === 'rename') {
        targetPath = await resolveNonCollidingRemotePath(desiredPath, exists)
      }

      await this.ensureDirWithClient(txClient, parentRemotePosixPath(targetPath))
      tempRemote = buildTempRemotePath(targetPath)

      const reporter = createProgressReporter(totalBytes, (transferredBytes, total) => {
        params.onProgress({ transferredBytes, totalBytes: total })
      })
      reporter.update(0)

      const readStream = createReadStream(params.localPath)
      const meter = new MeteredThrottleStream({
        speedLimitBps: params.speedLimitBps,
        signal: params.signal,
        onBytes: (bytes) => reporter.update(bytes)
      })
      const source = readStream.pipe(meter)

      const cleanupStreams = () => {
        readStream.destroy()
        meter.destroy()
      }
      params.signal.addEventListener('abort', cleanupStreams, { once: true })
      try {
        await txClient.uploadFrom(source, tempRemote)
      } finally {
        params.signal.removeEventListener('abort', cleanupStreams)
        cleanupStreams()
      }

      throwIfAborted(params.signal)
      if (params.conflict === 'overwrite' && (await exists(targetPath))) {
        await txClient.remove(targetPath).catch(() => {})
      }
      await txClient.rename(tempRemote, targetPath)
      tempRemote = ''
      reporter.finish(totalBytes)
      return { status: 'completed', finalPath: targetPath, bytes: totalBytes }
    } catch (error) {
      if (tempRemote && !txClient.closed) {
        await txClient.remove(tempRemote).catch(() => {})
      } else if (tempRemote) {
        // Transfer socket was destroyed on abort; use a quick control request to remove orphan temp file
        await this.runControl((ctrl) => ctrl.remove(tempRemote)).catch(() => {})
      }
      throw sanitizeFileError(error, this.secrets)
    } finally {
      params.signal.removeEventListener('abort', onAbort)
      txClient.close()
    }
  }

  async download(params: DownloadParams): Promise<TransferOutcome> {
    throwIfAborted(params.signal)
    const remotePath = normalizeRemotePosixPath(params.remotePath)

    const txClient = await this.openClient(params.signal)
    const onAbort = () => {
      try {
        txClient.close()
      } catch {
        /* ignore */
      }
    }
    params.signal.addEventListener('abort', onAbort, { once: true })

    let tempLocal = ''
    try {
      const st = await this.statWithClient(txClient, remotePath)
      if (!st.exists || !st.entry) throw new Error(`远端文件不存在：${remotePath}`)
      if (st.entry.kind === 'directory') throw new Error(`不能直接下载目录：${remotePath}`)
      let totalBytes = st.entry.size
      if (!Number.isFinite(totalBytes) || totalBytes < 0) {
        totalBytes = await txClient.size(remotePath).catch(() => 0)
      }

      let targetLocal = params.localPath
      const localExists = await fsStat(targetLocal).catch(() => undefined)
      if (localExists && params.conflict === 'skip') {
        return { status: 'skipped', finalPath: targetLocal, bytes: totalBytes }
      }
      if (localExists && params.conflict === 'rename') {
        targetLocal = await resolveNonCollidingLocalPath(targetLocal)
      }

      await mkdir(dirname(targetLocal), { recursive: true })
      tempLocal = buildTempLocalPath(targetLocal)

      const reporter = createProgressReporter(totalBytes, (transferredBytes, total) => {
        params.onProgress({ transferredBytes, totalBytes: total })
      })
      reporter.update(0)

      const pass = new PassThrough()
      const meter = new MeteredThrottleStream({
        speedLimitBps: params.speedLimitBps,
        signal: params.signal,
        onBytes: (bytes) => reporter.update(bytes)
      })
      const fileOut = createWriteStream(tempLocal)

      const cleanupStreams = () => {
        pass.destroy()
        meter.destroy()
        fileOut.destroy()
      }
      params.signal.addEventListener('abort', cleanupStreams, { once: true })

      try {
        await Promise.all([txClient.downloadTo(pass, remotePath), pipeline(pass, meter, fileOut)])
      } finally {
        params.signal.removeEventListener('abort', cleanupStreams)
      }

      throwIfAborted(params.signal)
      const finalStats = await fsStat(tempLocal)
      await fsRename(tempLocal, targetLocal)
      tempLocal = ''
      reporter.finish(finalStats.size)
      return { status: 'completed', finalPath: targetLocal, bytes: finalStats.size }
    } catch (error) {
      if (tempLocal) await unlinkLocalQuietly(tempLocal)
      throw sanitizeFileError(error, this.secrets)
    } finally {
      params.signal.removeEventListener('abort', onAbort)
      txClient.close()
    }
  }
}
