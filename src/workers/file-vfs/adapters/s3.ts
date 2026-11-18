import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename as fsRename, stat as fsStat } from 'node:fs/promises'
import { Agent as HttpAgent } from 'node:http'
import { Agent as HttpsAgent } from 'node:https'
import { dirname } from 'node:path'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type _Object
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { NodeHttpHandler } from '@smithy/node-http-handler'
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

const MAX_LIST_ENTRIES = 20_000
const MAX_TREE_ENTRIES = 5000

/** Convert a normalized POSIX path (`/a/b`) to an S3 object key (`a/b`), or `''` for root `/`. */
function pathToKey(remotePath: string): string {
  const norm = normalizeRemotePosixPath(remotePath)
  return norm === '/' ? '' : norm.replace(/^\/+/, '')
}

function pathToPrefix(remotePath: string): string {
  const key = pathToKey(remotePath).replace(/\/+$/, '')
  return key ? `${key}/` : ''
}

function encodeCopySource(bucket: string, key: string): string {
  const encodedKey = key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `${encodeURIComponent(bucket)}/${encodedKey}`
}

function isS3NotFound(error: unknown): boolean {
  const rec = error as { name?: string; $metadata?: { httpStatusCode?: number } }
  return rec?.$metadata?.httpStatusCode === 404 || rec?.name === 'NotFound' || rec?.name === 'NoSuchKey'
}

export class S3Adapter implements FileAdapter {
  readonly capabilities = capabilitiesFor('s3')
  private readonly secrets: string[]
  private readonly bucket: string
  private readonly client: S3Client
  private readonly httpAgent: HttpAgent
  private readonly httpsAgent: HttpsAgent
  private readonly initialHome: string
  private readonly timeoutMs: number
  private readonly partSizeBytes: number

  constructor(config: FileConnectConfig) {
    this.secrets = collectSecretsToRedact(config.secrets)
    this.bucket = (config.options.bucket ?? '').trim()
    this.timeoutMs = Math.max(5000, config.connectTimeoutMs || 20_000)
    const partMiB = Math.max(5, Math.min(128, config.s3PartSizeMiB || 8))
    this.partSizeBytes = partMiB * 1024 * 1024
    this.initialHome = config.initialPath.trim() ? normalizeRemotePosixPath(config.initialPath) : '/'

    this.httpAgent = new HttpAgent({ keepAlive: true })
    this.httpsAgent = new HttpsAgent({
      keepAlive: true,
      rejectUnauthorized: config.options.tlsVerify !== 'insecure'
    })

    const endpoint = config.options.endpoint?.trim() || undefined
    const region = config.options.region?.trim() || 'us-east-1'
    this.client = new S3Client({
      region,
      ...(endpoint ? { endpoint } : {}),
      forcePathStyle: Boolean(config.options.forcePathStyle || endpoint),
      credentials: {
        accessKeyId: config.username.trim(),
        secretAccessKey: config.secrets.secretAccessKey ?? '',
        ...(config.secrets.sessionToken ? { sessionToken: config.secrets.sessionToken } : {})
      },
      requestHandler: new NodeHttpHandler({
        httpAgent: this.httpAgent,
        httpsAgent: this.httpsAgent,
        connectionTimeout: this.timeoutMs,
        socketTimeout: this.timeoutMs
      })
    })
  }

  async connect(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal)
    const { signal: reqSignal, cleanup } = createTimeoutLinkedSignal(this.timeoutMs, signal)
    try {
      await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: pathToPrefix(this.initialHome),
          Delimiter: '/',
          MaxKeys: 1
        }),
        { abortSignal: reqSignal }
      )
    } catch (error) {
      throw sanitizeFileError(error, this.secrets)
    } finally {
      cleanup()
    }
  }

  async close(): Promise<void> {
    this.client.destroy()
    this.httpAgent.destroy()
    this.httpsAgent.destroy()
  }

  async home(): Promise<string> {
    return this.initialHome
  }

  async list(rawPath: string): Promise<SftpListResult> {
    const targetPath = normalizeRemotePosixPath(rawPath || '/')
    const prefix = pathToPrefix(targetPath)
    const entries: SftpEntry[] = []
    const seenDirs = new Set<string>()
    let continuationToken: string | undefined

    const { signal: reqSignal, cleanup } = createTimeoutLinkedSignal(this.timeoutMs)
    try {
      do {
        const res = await this.client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: prefix,
            Delimiter: '/',
            MaxKeys: 1000,
            ...(continuationToken ? { ContinuationToken: continuationToken } : {})
          }),
          { abortSignal: reqSignal }
        )

        for (const cp of res.CommonPrefixes ?? []) {
          const fullPrefix = cp.Prefix ?? ''
          if (!fullPrefix.startsWith(prefix)) continue
          const rel = fullPrefix.slice(prefix.length).replace(/\/+$/, '')
          if (!rel || seenDirs.has(rel)) continue
          seenDirs.add(rel)
          entries.push({
            name: rel,
            path: joinRemotePosixPath(targetPath, rel),
            kind: 'directory',
            size: 0,
            mode: 0o040755,
            permissions: formatUnixPermissions(0o040755, 'directory'),
            mtime: 0,
            uid: 0,
            gid: 0
          })
          if (entries.length >= MAX_LIST_ENTRIES) break
        }

        for (const obj of res.Contents ?? []) {
          const key = obj.Key ?? ''
          if (!key.startsWith(prefix)) continue
          const rel = key.slice(prefix.length)
          // Skip zero-byte folder placeholder `prefix/` or empty relative key
          if (!rel || rel.endsWith('/')) continue
          entries.push({
            name: rel,
            path: joinRemotePosixPath(targetPath, rel),
            kind: 'file',
            size: Number.isFinite(obj.Size) ? (obj.Size ?? 0) : 0,
            mode: 0o100644,
            permissions: formatUnixPermissions(0o100644, 'file'),
            mtime: toEpochSeconds(obj.LastModified),
            uid: 0,
            gid: 0
          })
          if (entries.length >= MAX_LIST_ENTRIES) break
        }

        continuationToken =
          res.IsTruncated && entries.length < MAX_LIST_ENTRIES ? res.NextContinuationToken : undefined
      } while (continuationToken)

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
    const key = pathToKey(targetPath)
    const { signal: reqSignal, cleanup } = createTimeoutLinkedSignal(this.timeoutMs)
    try {
      try {
        const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }), {
          abortSignal: reqSignal
        })
        const name = remoteBaseName(targetPath)
        return {
          exists: true,
          entry: {
            name,
            path: targetPath,
            kind: 'file',
            size: Number.isFinite(head.ContentLength) ? (head.ContentLength ?? 0) : 0,
            mode: 0o100644,
            permissions: formatUnixPermissions(0o100644, 'file'),
            mtime: toEpochSeconds(head.LastModified),
            uid: 0,
            gid: 0
          }
        }
      } catch (err) {
        if (!isS3NotFound(err)) throw err
      }

      // Check if it exists as a virtual prefix (`key/`)
      const prefix = pathToPrefix(targetPath)
      const list = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, MaxKeys: 1 }),
        { abortSignal: reqSignal }
      )
      if ((list.KeyCount ?? 0) > 0 || (list.Contents?.length ?? 0) > 0) {
        return {
          exists: true,
          entry: {
            name: remoteBaseName(targetPath),
            path: targetPath,
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
      return { exists: false }
    } catch (error) {
      throw sanitizeFileError(error, this.secrets)
    } finally {
      cleanup()
    }
  }

  private async listAllObjectsUnderPrefix(prefix: string, limit: number): Promise<_Object[]> {
    const objects: _Object[] = []
    let continuationToken: string | undefined
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          MaxKeys: 1000,
          ...(continuationToken ? { ContinuationToken: continuationToken } : {})
        })
      )
      for (const obj of res.Contents ?? []) {
        objects.push(obj)
        if (objects.length > limit) {
          throw new Error(`单次操作对象数超过 ${limit} 上限，请分批处理`)
        }
      }
      continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined
    } while (continuationToken)
    return objects
  }

  async collectTree(rawPath: string): Promise<SftpRemoteTreeManifest> {
    const rootPath = normalizeRemotePosixPath(rawPath || '/')
    const st = await this.stat(rootPath)
    if (!st.exists || !st.entry) throw new Error(`远端路径不存在：${rootPath}`)
    const rootName = remoteBaseName(rootPath) || this.bucket || 'download'
    if (st.entry.kind !== 'directory') {
      return {
        dirs: [],
        files: [{ remotePath: rootPath, relativePath: rootName, name: rootName, size: st.entry.size }],
        skippedSymlinks: 0
      }
    }

    const prefix = pathToPrefix(rootPath)
    try {
      const objects = await this.listAllObjectsUnderPrefix(prefix, MAX_TREE_ENTRIES)
      const dirSet = new Set<string>([rootName])
      const files: SftpRemoteTreeManifest['files'] = []
      for (const obj of objects) {
        const key = obj.Key ?? ''
        if (!key.startsWith(prefix)) continue
        const rel = key.slice(prefix.length)
        if (!rel) continue
        if (rel.endsWith('/')) {
          const cleanDir = rel.replace(/\/+$/, '')
          if (cleanDir) dirSet.add(`${rootName}/${cleanDir}`)
          continue
        }
        const parts = rel.split('/')
        for (let i = 1; i < parts.length; i++) {
          dirSet.add(`${rootName}/${parts.slice(0, i).join('/')}`)
        }
        files.push({
          remotePath: joinRemotePosixPath(rootPath, rel),
          relativePath: `${rootName}/${rel}`,
          name: parts[parts.length - 1]!,
          size: Number.isFinite(obj.Size) ? (obj.Size ?? 0) : 0
        })
      }
      return { dirs: [...dirSet], files, skippedSymlinks: 0 }
    } catch (error) {
      throw sanitizeFileError(error, this.secrets)
    }
  }

  async mkdir(rawPath: string): Promise<void> {
    const targetPath = normalizeRemotePosixPath(rawPath)
    if (targetPath === '/') return
    const key = pathToPrefix(targetPath)
    const { signal: reqSignal, cleanup } = createTimeoutLinkedSignal(this.timeoutMs)
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: Buffer.alloc(0)
        }),
        { abortSignal: reqSignal }
      )
    } catch (error) {
      throw sanitizeFileError(error, this.secrets)
    } finally {
      cleanup()
    }
  }

  private async deleteKeysBatched(keys: string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += 1000) {
      const chunk = keys.slice(i, i + 1000)
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true }
        })
      )
    }
  }

  async rename(oldRaw: string, newRaw: string): Promise<void> {
    const fromPath = normalizeRemotePosixPath(oldRaw)
    const toPath = normalizeRemotePosixPath(newRaw)
    if (fromPath === toPath) return
    const st = await this.stat(fromPath)
    if (!st.exists || !st.entry) throw new Error(`源对象不存在：${fromPath}`)

    try {
      if (st.entry.kind !== 'directory') {
        const srcKey = pathToKey(fromPath)
        const dstKey = pathToKey(toPath)
        await this.client.send(
          new CopyObjectCommand({
            Bucket: this.bucket,
            Key: dstKey,
            CopySource: encodeCopySource(this.bucket, srcKey)
          })
        )
        await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: srcKey }))
        return
      }

      const srcPrefix = pathToPrefix(fromPath)
      const dstPrefix = pathToPrefix(toPath)
      const objs = await this.listAllObjectsUnderPrefix(srcPrefix, MAX_TREE_ENTRIES)
      for (const obj of objs) {
        const srcKey = obj.Key ?? ''
        if (!srcKey.startsWith(srcPrefix)) continue
        const dstKey = `${dstPrefix}${srcKey.slice(srcPrefix.length)}`
        await this.client.send(
          new CopyObjectCommand({
            Bucket: this.bucket,
            Key: dstKey,
            CopySource: encodeCopySource(this.bucket, srcKey)
          })
        )
      }
      const deleteKeys = objs.map((o) => o.Key).filter((k): k is string => Boolean(k))
      if (deleteKeys.length) await this.deleteKeysBatched(deleteKeys)
    } catch (error) {
      throw sanitizeFileError(error, this.secrets)
    }
  }

  async remove(rawPath: string, recursive: boolean): Promise<void> {
    const targetPath = normalizeRemotePosixPath(rawPath)
    if (targetPath === '/') throw new Error('禁止删除存储桶根目录')
    const st = await this.stat(targetPath)
    if (!st.exists || !st.entry) throw new Error(`远端对象不存在：${targetPath}`)

    try {
      if (st.entry.kind !== 'directory') {
        await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: pathToKey(targetPath) }))
        return
      }
      const prefix = pathToPrefix(targetPath)
      const objs = await this.listAllObjectsUnderPrefix(prefix, MAX_LIST_ENTRIES)
      const nonPlaceholder = objs.filter((o) => o.Key && o.Key !== prefix)
      if (!recursive && nonPlaceholder.length > 0) {
        throw new Error('目录非空，请启用递归删除')
      }
      const keys = objs.map((o) => o.Key).filter((k): k is string => Boolean(k))
      if (keys.length) await this.deleteKeysBatched(keys)
    } catch (error) {
      throw sanitizeFileError(error, this.secrets)
    }
  }

  async chmod(): Promise<void> {
    throw new Error('S3 对象存储不支持修改 POSIX 文件权限')
  }

  async upload(params: UploadParams): Promise<TransferOutcome> {
    throwIfAborted(params.signal)
    const localStats = await fsStat(params.localPath)
    if (!localStats.isFile()) throw new Error(`只能上传普通文件：${params.localPath}`)
    const totalBytes = localStats.size
    const desiredPath = normalizeRemotePosixPath(params.remotePath)

    const existsFn = async (candidate: string) => {
      try {
        await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: pathToKey(candidate) }))
        return true
      } catch (err) {
        if (isS3NotFound(err)) return false
        throw err
      }
    }

    let targetPath = desiredPath
    try {
      if (params.conflict === 'skip' && (await existsFn(desiredPath))) {
        return { status: 'skipped', finalPath: desiredPath, bytes: totalBytes }
      }
      if (params.conflict === 'rename') {
        targetPath = await resolveNonCollidingRemotePath(desiredPath, existsFn)
      }
    } catch (error) {
      throw sanitizeFileError(error, this.secrets)
    }

    const key = pathToKey(targetPath)
    const reporter = createProgressReporter(totalBytes, (transferredBytes, total) => {
      params.onProgress({ transferredBytes, totalBytes: total })
    })
    reporter.update(0)

    const readStream = createReadStream(params.localPath)
    let uploadedViaStream = 0
    const meter = new MeteredThrottleStream({
      speedLimitBps: params.speedLimitBps,
      signal: params.signal,
      onBytes: (bytes) => {
        uploadedViaStream = bytes
        // Report read progress continuously (held just under totalBytes until CompleteMultipartUpload resolves)
        const reported = totalBytes > 1 ? Math.min(bytes, totalBytes - 1) : bytes
        reporter.update(reported)
      }
    })
    const source = readStream.pipe(meter)

    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: source,
        ContentLength: totalBytes
      },
      partSize: this.partSizeBytes,
      queueSize: 4,
      leavePartsOnError: false
    })

    const onAbort = () => {
      readStream.destroy()
      meter.destroy()
      void upload.abort().catch(() => {})
    }
    params.signal.addEventListener('abort', onAbort, { once: true })

    try {
      await upload.done()
      throwIfAborted(params.signal)
      reporter.finish(Math.max(totalBytes, uploadedViaStream))
      return { status: 'completed', finalPath: targetPath, bytes: totalBytes }
    } catch (error) {
      throw sanitizeFileError(error, this.secrets)
    } finally {
      params.signal.removeEventListener('abort', onAbort)
      readStream.destroy()
      meter.destroy()
    }
  }

  async download(params: DownloadParams): Promise<TransferOutcome> {
    throwIfAborted(params.signal)
    const remotePath = normalizeRemotePosixPath(params.remotePath)
    const key = pathToKey(remotePath)

    let tempLocal = ''
    let bodyStream: Readable | undefined
    const onAbort = () => {
      bodyStream?.destroy(new Error('操作已取消'))
    }
    params.signal.addEventListener('abort', onAbort, { once: true })

    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
        abortSignal: params.signal
      })
      const totalBytes = Number.isFinite(response.ContentLength) ? (response.ContentLength ?? 0) : 0
      bodyStream = response.Body as Readable | undefined
      if (!bodyStream) throw new Error('服务端未返回文件内容流')

      let targetLocal = params.localPath
      const localExists = await fsStat(targetLocal).catch(() => undefined)
      if (localExists && params.conflict === 'skip') {
        bodyStream.destroy()
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

      const meter = new MeteredThrottleStream({
        speedLimitBps: params.speedLimitBps,
        signal: params.signal,
        onBytes: (bytes) => reporter.update(bytes)
      })
      const fileOut = createWriteStream(tempLocal)
      await pipeline(bodyStream, meter, fileOut)

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
    }
  }
}
