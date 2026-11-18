import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import FtpSrv from 'ftp-srv'
import { v2 as webdav } from 'webdav-server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FileConnectConfig } from '../../src/shared/files'
import { createAdapter } from '../../src/workers/file-vfs/adapters'
import { startMockS3Server, type MockS3ServerHandle } from '../helpers/mock-s3-server'

function baseConfig(
  partial: Partial<FileConnectConfig> & Pick<FileConnectConfig, 'protocol'>
): FileConnectConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    username: '',
    initialPath: '',
    options: {},
    secrets: {},
    connectTimeoutMs: 10_000,
    s3PartSizeMiB: 5,
    ...partial
  }
}

describe('File protocol adapters (FTP, WebDAV, S3)', () => {
  const workDirs: string[] = []
  let localScratch = ''
  let ftpRoot = ''
  let ftpServer: InstanceType<typeof FtpSrv>
  let ftpPort = 0

  let davRoot = ''
  let davServer: InstanceType<typeof webdav.WebDAVServer>
  let davUrl = ''

  let s3Server: MockS3ServerHandle

  const quietLog = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    trace: () => {},
    fatal: () => {},
    child: () => quietLog
  }

  beforeAll(async () => {
    localScratch = await mkdtemp(join(tmpdir(), 'orbit-adapter-local-'))
    ftpRoot = await mkdtemp(join(tmpdir(), 'orbit-adapter-ftp-'))
    davRoot = await mkdtemp(join(tmpdir(), 'orbit-adapter-dav-'))
    workDirs.push(localScratch, ftpRoot, davRoot)

    // 1. Real FTP server (ftp-srv on 127.0.0.1 ephemeral port)
    ftpServer = new FtpSrv({
      url: 'ftp://127.0.0.1:0',
      pasv_url: '127.0.0.1',
      pasv_min: 45000,
      pasv_max: 45500,
      anonymous: false,
      log: quietLog
    })
    ftpServer.on('login', ({ username, password }, resolve, reject) => {
      if (username === 'ftpuser' && password === 'FtpSecret!42') {
        resolve({ root: ftpRoot, cwd: '/' })
      } else {
        reject(new Error('530 Invalid credentials'))
      }
    })
    await ftpServer.listen()
    ftpPort = (ftpServer as unknown as { server: { address(): { port: number } } }).server.address().port

    // 2. Real WebDAV v2 server with Basic auth backed by PhysicalFileSystem
    const userManager = new webdav.SimpleUserManager()
    const user = userManager.addUser('davuser', 'DavSecret!99', false)
    const privilegeManager = new webdav.SimplePathPrivilegeManager()
    privilegeManager.setRights(user, '/', ['all'])
    davServer = new webdav.WebDAVServer({
      port: 0,
      httpAuthentication: new webdav.HTTPBasicAuthentication(userManager, 'OrbitDAV'),
      privilegeManager
    })
    await new Promise<void>((resolve, reject) => {
      davServer.setFileSystem('/', new webdav.PhysicalFileSystem(davRoot), (ok) => {
        if (ok) resolve()
        else reject(new Error('WebDAV FS init failed'))
      })
    })
    const httpSrv = await new Promise<{ address(): { port: number } }>((resolve) => {
      davServer.start((srv) => resolve(srv as unknown as { address(): { port: number } }))
    })
    davUrl = `http://127.0.0.1:${httpSrv.address().port}`

    // 3. In-memory S3 HTTP mock server
    s3Server = await startMockS3Server()
  })

  afterAll(async () => {
    await ftpServer?.close().catch(() => {})
    await new Promise<void>((resolve) => {
      try {
        davServer.stop(() => resolve())
      } catch {
        resolve()
      }
    })
    await s3Server?.close()
    for (const dir of workDirs) {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  })

  it('rejects unsupported protocols clearly (smb)', () => {
    expect(() => createAdapter(baseConfig({ protocol: 'smb' }))).toThrow('尚未提供')
  })

  async function runCommonLifecycle(name: string, config: FileConnectConfig, wrongConfig: FileConnectConfig) {
    // 1. Wrong credentials produce sanitized error without leaking secret
    const bad = createAdapter(wrongConfig)
    const badSecret =
      wrongConfig.secrets.password || wrongConfig.secrets.secretAccessKey || wrongConfig.secrets.token || ''
    let authErr: Error | undefined
    try {
      await bad.connect()
    } catch (e) {
      authErr = e as Error
    } finally {
      await bad.close()
    }
    expect(authErr).toBeDefined()
    if (badSecret) expect(authErr!.message).not.toContain(badSecret)

    // 2. Connect + home + mkdir + list with spaces & CJK
    const adapter = createAdapter(config)
    await adapter.connect()
    try {
      expect(await adapter.home()).toBe('/')
      const missing = await adapter.stat('/does-not-exist-xyz')
      expect(missing).toEqual({ exists: false })

      const dirName = `${name} 测试目录`
      const remoteDir = `/${dirName}`
      await adapter.mkdir(remoteDir)
      const rootList = await adapter.list('/')
      expect(rootList.entries.some((e) => e.name === dirName && e.kind === 'directory')).toBe(true)

      // 3. Upload with conflict overwrite / skip / rename & monotonic progress
      const srcDir = join(localScratch, name)
      await mkdir(srcDir, { recursive: true })
      const sampleFile = join(srcDir, 'hello 世界.txt')
      const v1Content = Buffer.from('hello-orbit-v1-' + 'Z'.repeat(32 * 1024), 'utf8')
      const v2Content = Buffer.from('hello-orbit-v2-' + 'W'.repeat(16 * 1024), 'utf8')
      await writeFile(sampleFile, v1Content)

      const remoteFile = `${remoteDir}/hello 世界.txt`
      const progressValues: number[] = []
      const up1 = await adapter.upload({
        localPath: sampleFile,
        remotePath: remoteFile,
        conflict: 'overwrite',
        signal: new AbortController().signal,
        speedLimitBps: 0,
        onProgress: (p) => progressValues.push(p.transferredBytes)
      })
      expect(up1).toEqual({ status: 'completed', finalPath: remoteFile, bytes: v1Content.byteLength })
      expect(progressValues.at(-1)).toBe(v1Content.byteLength)
      for (let i = 1; i < progressValues.length; i++) {
        expect(progressValues[i]!).toBeGreaterThanOrEqual(progressValues[i - 1]!)
      }

      // conflict: skip
      await writeFile(sampleFile, v2Content)
      const upSkip = await adapter.upload({
        localPath: sampleFile,
        remotePath: remoteFile,
        conflict: 'skip',
        signal: new AbortController().signal,
        speedLimitBps: 0,
        onProgress: () => {}
      })
      expect(upSkip.status).toBe('skipped')

      // conflict: rename -> `hello 世界 (1).txt`
      const upRename = await adapter.upload({
        localPath: sampleFile,
        remotePath: remoteFile,
        conflict: 'rename',
        signal: new AbortController().signal,
        speedLimitBps: 0,
        onProgress: () => {}
      })
      expect(upRename.status).toBe('completed')
      expect(upRename.finalPath).toBe(`${remoteDir}/hello 世界 (1).txt`)

      // conflict: overwrite actually replaces with v2Content
      const upOverwrite = await adapter.upload({
        localPath: sampleFile,
        remotePath: remoteFile,
        conflict: 'overwrite',
        signal: new AbortController().signal,
        speedLimitBps: 0,
        onProgress: () => {}
      })
      expect(upOverwrite.bytes).toBe(v2Content.byteLength)

      // 4. Download + conflict rename + verify bytes
      const dlPath = join(srcDir, 'downloaded.txt')
      const dlProgress: number[] = []
      const dl1 = await adapter.download({
        remotePath: remoteFile,
        localPath: dlPath,
        conflict: 'overwrite',
        signal: new AbortController().signal,
        speedLimitBps: 0,
        onProgress: (p) => dlProgress.push(p.transferredBytes)
      })
      expect(dl1.status).toBe('completed')
      expect(dlProgress.at(-1)).toBe(v2Content.byteLength)
      expect(await readFile(dlPath)).toEqual(v2Content)

      const dlRename = await adapter.download({
        remotePath: remoteFile,
        localPath: dlPath,
        conflict: 'rename',
        signal: new AbortController().signal,
        speedLimitBps: 0,
        onProgress: () => {}
      })
      expect(dlRename.finalPath).toBe(join(srcDir, 'downloaded (1).txt'))

      // 5. Large > 6 MiB file (triggers S3 multipart > 5 MiB part size) + throttled abort leaves no temp files
      const bigFile = join(srcDir, 'large.bin')
      const bigBytes = 6 * 1024 * 1024 + 12345
      await writeFile(bigFile, Buffer.alloc(bigBytes, 0x6b))
      const bigRemote = `${remoteDir}/large.bin`
      const upBig = await adapter.upload({
        localPath: bigFile,
        remotePath: bigRemote,
        conflict: 'overwrite',
        signal: new AbortController().signal,
        speedLimitBps: 0,
        onProgress: () => {}
      })
      expect(upBig.bytes).toBe(bigBytes)
      const bigStat = await adapter.stat(bigRemote)
      expect(bigStat.exists).toBe(true)
      expect(bigStat.entry?.size).toBe(bigBytes)

      // Abort mid-download via speed throttling so abort definitely happens before EOF
      const abortController = new AbortController()
      const abortTarget = join(srcDir, 'aborted-dl.bin')
      let abortFired = false
      await expect(
        adapter.download({
          remotePath: bigRemote,
          localPath: abortTarget,
          conflict: 'overwrite',
          signal: abortController.signal,
          speedLimitBps: 32_768,
          onProgress: (p) => {
            if (!abortFired && p.transferredBytes >= 8192) {
              abortFired = true
              abortController.abort()
            }
          }
        })
      ).rejects.toThrow()
      const localFiles = await readdir(srcDir)
      expect(localFiles.some((f) => f.startsWith('.orbit-part-') || f === 'aborted-dl.bin')).toBe(false)

      // 6. collectTree + rename + remove (non-recursive fails on non-empty, recursive succeeds)
      const tree = await adapter.collectTree(remoteDir)
      expect(tree.files.some((f) => f.name === 'large.bin')).toBe(true)

      const renamedFile = `${remoteDir}/renamed-world.txt`
      await adapter.rename(`${remoteDir}/hello 世界 (1).txt`, renamedFile)
      expect((await adapter.stat(renamedFile)).exists).toBe(true)
      expect((await adapter.stat(`${remoteDir}/hello 世界 (1).txt`)).exists).toBe(false)

      await expect(adapter.remove(remoteDir, false)).rejects.toThrow('非空')
      await adapter.remove(remoteDir, true)
      expect((await adapter.stat(remoteDir)).exists).toBe(false)
      // Verify no leftover .orbit-tmp-* files
      const afterRoot = await adapter.list('/')
      expect(afterRoot.entries.some((e) => e.name.startsWith('.orbit-tmp-'))).toBe(false)
    } finally {
      await adapter.close()
    }
  }

  it('passes full lifecycle on FTP adapter', async () => {
    await runCommonLifecycle(
      'ftp',
      baseConfig({
        protocol: 'ftp',
        host: '127.0.0.1',
        port: ftpPort,
        username: 'ftpuser',
        secrets: { password: 'FtpSecret!42' }
      }),
      baseConfig({
        protocol: 'ftp',
        host: '127.0.0.1',
        port: ftpPort,
        username: 'ftpuser',
        secrets: { password: 'WRONG-PASSWORD-LEAK-CHECK' }
      })
    )
  }, 30_000)

  it('passes full lifecycle on WebDAV adapter', async () => {
    await runCommonLifecycle(
      'webdav',
      baseConfig({
        protocol: 'webdav',
        options: { url: davUrl, webdavAuth: 'basic' },
        username: 'davuser',
        secrets: { password: 'DavSecret!99' }
      }),
      baseConfig({
        protocol: 'webdav',
        options: { url: davUrl, webdavAuth: 'basic' },
        username: 'davuser',
        secrets: { password: 'WRONG-DAV-PASSWORD' }
      })
    )
    // Verify chmod rejects explicitly since WebDAV lacks POSIX chmod
    const dav = createAdapter(
      baseConfig({
        protocol: 'webdav',
        options: { url: davUrl, webdavAuth: 'basic' },
        username: 'davuser',
        secrets: { password: 'DavSecret!99' }
      })
    )
    await expect(dav.chmod('/anything', 0o644)).rejects.toThrow('不支持')
    await dav.close()
  }, 30_000)

  it('passes full lifecycle + multipart upload abort cleanup on S3 adapter', async () => {
    await runCommonLifecycle(
      's3',
      baseConfig({
        protocol: 's3',
        username: s3Server.accessKeyId,
        options: {
          endpoint: s3Server.url,
          region: 'us-east-1',
          bucket: s3Server.bucket,
          forcePathStyle: true
        },
        secrets: { secretAccessKey: s3Server.secretAccessKey },
        s3PartSizeMiB: 5
      }),
      baseConfig({
        protocol: 's3',
        username: 'BADACCESSKEY',
        options: {
          endpoint: s3Server.url,
          region: 'us-east-1',
          bucket: s3Server.bucket,
          forcePathStyle: true
        },
        secrets: { secretAccessKey: 'WRONG-S3-SECRET-LEAK-CHECK' }
      })
    )

    // Also test aborting a multipart upload cleans up pending multipart state on server
    const adapter = createAdapter(
      baseConfig({
        protocol: 's3',
        username: s3Server.accessKeyId,
        options: {
          endpoint: s3Server.url,
          region: 'us-east-1',
          bucket: s3Server.bucket,
          forcePathStyle: true
        },
        secrets: { secretAccessKey: s3Server.secretAccessKey },
        s3PartSizeMiB: 5
      })
    )
    await adapter.connect()
    try {
      const upDir = join(localScratch, 's3-abort')
      await mkdir(upDir, { recursive: true })
      const upFile = join(upDir, 'abort-multi.bin')
      await writeFile(upFile, Buffer.alloc(6 * 1024 * 1024, 0x33))
      const ac = new AbortController()
      let aborted = false
      await expect(
        adapter.upload({
          localPath: upFile,
          remotePath: '/abort-multi.bin',
          conflict: 'overwrite',
          signal: ac.signal,
          speedLimitBps: 65_536,
          onProgress: (p) => {
            if (!aborted && p.transferredBytes >= 16_384) {
              aborted = true
              ac.abort()
            }
          }
        })
      ).rejects.toThrow()
      expect(s3Server.activeUploadCount()).toBe(0)
      expect((await stat(upFile)).size).toBe(6 * 1024 * 1024)
    } finally {
      await adapter.close()
    }
  }, 30_000)
})
