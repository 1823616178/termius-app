import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename as fsRename, stat as fsStat } from 'node:fs/promises'
import { Agent as HttpAgent } from 'node:http'
import { Agent as HttpsAgent } from 'node:https'
import { dirname } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { AuthType, createClient, type FileStat, type WebDAVClient, type WebDAVClientOptions } from 'webdav'
import type { SftpRemoteTreeManifest } from '../../../shared/contracts'
import { capabilitiesFor, type FileConnectConfig } from '../../../shared/files'
import {
  formatUnixPermissions,
  joinRemotePosixPath,
  normalizeRemotePosixPath,
  parentRemotePosixPath,
  remoteBaseName,
  type SftpEntry,
  type SftpListResult,
  type SftpStatResult
} from '../../../shared/sftp'
import type { DownloadParams, FileAdapter, TransferOutcome, UploadParams } from '../adapter'
import {
  buildTempLocalPath,
  buildTempRemotePath,
  collectSecretsToRedact,
  createProgressReporter,
  createTimeoutLinkedSignal,
  MeteredThrottleStream,
  resolveNonCollidingLocalPath,
  resolveNonCollidingRemotePath,
  sanitizeFileError,
  throwIfAborted,
  toEpochSeconds,
  unlinkLocalQuietly
} from '../transfer-utils'

const MAX_COLLECT_ENTRIES = 5000

function fileStatToEntry(item: FileStat, fullPath: string): SftpEntry {
  const isDir = item.type === 'directory'
  const kind = isDir ? 'directory' : 'file'
  const mode = isDir ? 0o040755 : 0o100644
  return {
    name: item.basename || remoteBaseName(fullPath),
    path: fullPath,
    kind,
    size: Number.isFinite(item.size) && item.size >= 0 ? item.size : 0,
    mode,
    permissions: formatUnixPermissions(mode, kind),
    mtime: toEpochSeconds(item.lastmod),
    uid: 0,
    gid: 0
  }
}

export class WebDavAdapter implements FileAdapter {
  readonly capabilities = capabilitiesFor('webdav')
  private readonly secrets: string[]
  private readonly client: WebDAVClient
  private readonly httpAgent: HttpAgent
  private readonly httpsAgent: HttpsAgent
  private readonly initialHome: string
  private readonly timeoutMs: number

  constructor(config: FileConnectConfig) {
    this.secrets = collectSecretsToRedact(config.secrets)
    this.timeoutMs = Math.max(5000, config.connectTimeoutMs || 20_000)
    const rawUrl = config.options.url ?? ''
    this.httpAgent = new HttpAgent({ keepAlive: true })
    this.httpsAgent = new HttpsAgent({
      keepAlive: true,
      rejectUnauthorized: config.options.tlsVerify !== 'insecure'
    })

    const authKind = config.options.webdavAuth ?? 'basic'
    const opts: WebDAVClientOptions = {
      httpAgent: this.httpAgent,
      httpsAgent: this.httpsAgent
    }
    if (authKind === 'token' && config.secrets.token) {
      opts.authType = AuthType.Token
      opts.token = { access_token: config.secrets.token, token_type: 'Bearer' }
    } else if (authKind === 'digest') {
      opts.authType = AuthType.Digest
      opts.username = config.username
      opts.password = config.secrets.password ?? ''
    } else {
      opts.authType = config.username ? AuthType.Password : AuthType.None
      if (config.username) {
        opts.username = config.username
        opts.password = config.secrets.password ?? ''
      }
    }

    this.client = createClient(rawUrl, opts)
    this.initialHome = config.initialPath.trim() ? normalizeRemotePosixPath(config.initialPath) : '/'
  }

  private isNotFoundError(error: unknown): boolean {
    const status = (error as { status?: number })?.status
    return status === 404
  }

  async connect(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal)
    const { signal: reqSignal, cleanup } = createTimeoutLinkedSignal(this.timeoutMs, signal)
    try {
      await this.client.getDirectoryContents(this.initialHome, { signal: reqSignal })
    } catch (error) {
      if (this.initialHome !== '/' && this.isNotFoundError(error)) {
        // Fallback probe on `/` if custom initialPath doesn't exist yet
        await this.client.getDirectoryContents('/', { signal: reqSignal }).catch((rootErr) => {
          throw sanitizeFileError(rootErr, this.secrets)
        })
        return
      }
      throw sanitizeFileError(error, this.secrets)
    } finally {
      cleanup()
    }
  }

  async close(): Promise<void> {
    this.httpAgent.destroy()
    this.httpsAgent.destroy()
  }

  async home(): Promise<string> {
    return this.initialHome
  }

  async list(rawPath: string): Promise<SftpListResult> {
    const targetPath = normalizeRemotePosixPath(rawPath || '/')
    const { signal: reqSignal, cleanup } = createTimeoutLinkedSignal(this.timeoutMs)
    try {
      const contents = (await this.client.getDirectoryContents(targetPath, {
        signal: reqSignal
      })) as FileStat[]
      const entries: SftpEntry[] = []
      const seen = new Set<string>()
      for (const item of contents) {
        const name = item.basename || remoteBaseName(item.filename)
        if (!name || name === '.' || name === '..') continue
        const fullPath = joinRemotePosixPath(targetPath, name)
        if (fullPath === targetPath || seen.has(fullPath)) continue
        seen.add(fullPath)
        entries.push(fileStatToEntry({ ...item, basename: name }, fullPath))
      }
      return {
        path: targetPath,
        parentPath: parentRemotePosixPath(targetPath),
        entries
      }
    } catch (error) {
      throw sanitizeFileError(error, this.secrets)
    } finally {
      cleanup()
    }
  }

  async stat(rawPath: string): Promise<SftpStatResult> {
    const targetPath = normalizeRemotePosixPath(rawPath || '/')
    const { signal: reqSignal, cleanup } = createTimeoutLinkedSignal(this.timeoutMs)
    try {
      const result = (await this.client.stat(targetPath, { signal: reqSignal })) as FileStat
      const name = targetPath === '/' ? '/' : result.basename || remoteBaseName(targetPath)
      return {
        exists: true,
        entry: fileStatToEntry({ ...result, basename: name }, targetPath)
      }
    } catch (error) {
      if (this.isNotFoundError(error)) return { exists: false }
      throw sanitizeFileError(error, this.secrets)
    } finally {
      cleanup()
    }
  }

  async collectTree(rawPath: string): Promise<SftpRemoteTreeManifest> {
    const rootPath = normalizeRemotePosixPath(rawPath || '/')
    const st = await this.stat(rootPath)
    if (!st.exists || !st.entry) throw new Error(`远端路径不存在：${rootPath}`)
    const rootName = remoteBaseName(rootPath) || 'download'
    if (st.entry.kind !== 'directory') {
      return {
        dirs: [],
        files: [{ remotePath: rootPath, relativePath: rootName, name: rootName, size: st.entry.size }],
        skippedSymlinks: 0
      }
    }
    const dirs: string[] = [rootName]
    const files: SftpRemoteTreeManifest['files'] = []
    const walk = async (curRemote: string, curRel: string): Promise<void> => {
      if (dirs.length + files.length >= MAX_COLLECT_ENTRIES) {
        throw new Error(`单次下载最多包含 ${MAX_COLLECT_ENTRIES} 个条目，请分批下载`)
      }
      const listed = await this.list(curRemote)
      for (const entry of listed.entries) {
        const childRel = `${curRel}/${entry.name}`
        if (entry.kind === 'directory') {
          dirs.push(childRel)
          await walk(entry.path, childRel)
        } else if (entry.kind === 'file') {
          files.push({ remotePath: entry.path, relativePath: childRel, name: entry.name, size: entry.size })
        }
        if (dirs.length + files.length >= MAX_COLLECT_ENTRIES) {
          throw new Error(`单次下载最多包含 ${MAX_COLLECT_ENTRIES} 个条目，请分批下载`)
        }
      }
    }
    await walk(rootPath, rootName)
    return { dirs, files, skippedSymlinks: 0 }
  }

  async mkdir(rawPath: string): Promise<void> {
    const targetPath = normalizeRemotePosixPath(rawPath)
    if (targetPath === '/') return
    const { signal: reqSignal, cleanup } = createTimeoutLinkedSignal(this.timeoutMs)
    try {
      await this.client.createDirectory(targetPath, { recursive: true, signal: reqSignal })
    } catch (error) {
      const status = (error as { status?: number })?.status
      // Some WebDAV servers return 405 Method Not Allowed when directory already exists
      if (status === 405) {
        const existing = await this.stat(targetPath)
        if (existing.exists && existing.entry?.kind === 'directory') return
      }
      throw sanitizeFileError(error, this.secrets)
    } finally {
      cleanup()
    }
  }

  async rename(oldRaw: string, newRaw: string): Promise<void> {
    const from = normalizeRemotePosixPath(oldRaw)
    const to = normalizeRemotePosixPath(newRaw)
    const { signal: reqSignal, cleanup } = createTimeoutLinkedSignal(this.timeoutMs)
    try {
      await this.client.moveFile(from, to, { signal: reqSignal, overwrite: false })
    } catch (error) {
      throw sanitizeFileError(error, this.secrets)
    } finally {
      cleanup()
    }
  }

  async remove(rawPath: string, recursive: boolean): Promise<void> {
    const targetPath = normalizeRemotePosixPath(rawPath)
    if (targetPath === '/') throw new Error('禁止删除根目录')
    const st = await this.stat(targetPath)
    if (!st.exists || !st.entry) throw new Error(`远端路径不存在：${targetPath}`)
    if (st.entry.kind === 'directory' && !recursive) {
      const listed = await this.list(targetPath)
      if (listed.entries.length > 0) throw new Error('目录非空，请启用递归删除')
    }
    const { signal: reqSignal, cleanup } = createTimeoutLinkedSignal(this.timeoutMs)
    try {
      await this.client.deleteFile(targetPath, { signal: reqSignal })
    } catch (error) {
      throw sanitizeFileError(error, this.secrets)
    } finally {
      cleanup()
    }
  }

  async chmod(): Promise<void> {
    throw new Error('WebDAV 协议不支持修改 POSIX 文件权限')
  }

  async upload(params: UploadParams): Promise<TransferOutcome> {
    throwIfAborted(params.signal)
    const localStats = await fsStat(params.localPath)
    if (!localStats.isFile()) throw new Error(`只能上传普通文件：${params.localPath}`)
    const totalBytes = localStats.size
    const desiredPath = normalizeRemotePosixPath(params.remotePath)

    const existsFn = async (candidate: string) => (await this.stat(candidate)).exists
    let targetPath = desiredPath
    if (params.conflict === 'skip' && (await existsFn(desiredPath))) {
      return { status: 'skipped', finalPath: desiredPath, bytes: totalBytes }
    }
    if (params.conflict === 'rename') {
      targetPath = await resolveNonCollidingRemotePath(desiredPath, existsFn)
    }

    const parentDir = parentRemotePosixPath(targetPath)
    if (parentDir !== '/') {
      await this.mkdir(parentDir)
    }

    const tempRemote = buildTempRemotePath(targetPath)
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
      await this.client.putFileContents(
        tempRemote,
        source as unknown as Parameters<WebDAVClient['putFileContents']>[1],
        {
          contentLength: totalBytes,
          overwrite: true,
          signal: params.signal
        }
      )
      throwIfAborted(params.signal)
      await this.client.moveFile(tempRemote, targetPath, { overwrite: params.conflict === 'overwrite' })
      reporter.finish(totalBytes)
      return { status: 'completed', finalPath: targetPath, bytes: totalBytes }
    } catch (error) {
      await this.client.deleteFile(tempRemote).catch(() => {})
      throw sanitizeFileError(error, this.secrets)
    } finally {
      params.signal.removeEventListener('abort', cleanupStreams)
      cleanupStreams()
    }
  }

  async download(params: DownloadParams): Promise<TransferOutcome> {
    throwIfAborted(params.signal)
    const remotePath = normalizeRemotePosixPath(params.remotePath)
    const st = await this.stat(remotePath)
    if (!st.exists || !st.entry) throw new Error(`远端文件不存在：${remotePath}`)
    if (st.entry.kind === 'directory') throw new Error(`不能直接下载目录：${remotePath}`)
    const totalBytes = st.entry.size

    let targetLocal = params.localPath
    const localExists = await fsStat(targetLocal).catch(() => undefined)
    if (localExists && params.conflict === 'skip') {
      return { status: 'skipped', finalPath: targetLocal, bytes: totalBytes }
    }
    if (localExists && params.conflict === 'rename') {
      targetLocal = await resolveNonCollidingLocalPath(targetLocal)
    }

    await mkdir(dirname(targetLocal), { recursive: true })
    const tempLocal = buildTempLocalPath(targetLocal)

    const reporter = createProgressReporter(totalBytes, (transferredBytes, total) => {
      params.onProgress({ transferredBytes, totalBytes: total })
    })
    reporter.update(0)

    const readStream = this.client.createReadStream(remotePath, {
      signal: params.signal
    }) as unknown as Readable
    const meter = new MeteredThrottleStream({
      speedLimitBps: params.speedLimitBps,
      signal: params.signal,
      onBytes: (bytes) => reporter.update(bytes)
    })
    const fileOut = createWriteStream(tempLocal)

    const cleanupStreams = () => {
      readStream.destroy(new Error('操作已取消'))
      meter.destroy()
      fileOut.destroy()
    }
    params.signal.addEventListener('abort', cleanupStreams, { once: true })

    try {
      await pipeline(readStream, meter, fileOut)
      throwIfAborted(params.signal)
      const finalStats = await fsStat(tempLocal)
      await fsRename(tempLocal, targetLocal)
      reporter.finish(finalStats.size)
      return { status: 'completed', finalPath: targetLocal, bytes: finalStats.size }
    } catch (error) {
      await unlinkLocalQuietly(tempLocal)
      throw sanitizeFileError(error, this.secrets)
    } finally {
      params.signal.removeEventListener('abort', cleanupStreams)
    }
  }
}
