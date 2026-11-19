import { randomBytes } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from 'ssh2'
import { afterEach, describe, expect, it } from 'vitest'
import { handleSftpRequest, type SftpSessionState } from '../../src/workers/connection/sftp-handler'
import { startMockSftpSshServer } from '../helpers/mock-sftp-server'
import {
  openSessionSchema,
  sftpChmodSchema,
  sftpDeleteSchema,
  sftpDownloadSchema,
  sftpPathRequestSchema,
  sftpRenameSchema,
  sftpUploadSchema
} from '../../src/shared/contracts'
import {
  extractFilePathsFromUriList,
  formatBytes,
  formatOctalMode,
  formatSpeed,
  formatUnixPermissions,
  joinRemotePosixPath,
  normalizeRemotePosixPath,
  parentRemotePosixPath,
  parseFileUriToLocalPath,
  remoteBaseName,
  remoteBreadcrumbs,
  sanitizeDownloadFilename,
  sortSftpEntries,
  type SftpEntry
} from '../../src/shared/sftp'

function makeEntry(overrides: Partial<SftpEntry>): SftpEntry {
  return {
    name: 'file.txt',
    path: '/file.txt',
    kind: 'file',
    size: 100,
    mode: 0o644,
    permissions: '-rw-r--r--',
    mtime: 1_700_000_000,
    uid: 1000,
    gid: 1000,
    ...overrides
  }
}

describe('SFTP pure utilities and security helpers', () => {
  it('normalizes and joins remote POSIX paths accurately', () => {
    expect(normalizeRemotePosixPath('~')).toBe('~')
    expect(normalizeRemotePosixPath('~/a/../b/./c')).toBe('~/b/c')
    expect(normalizeRemotePosixPath('/var/log//nginx/..')).toBe('/var/log')
    expect(normalizeRemotePosixPath('/')).toBe('/')
    expect(() => normalizeRemotePosixPath('/etc/\0passwd')).toThrow('路径不能包含空字符')

    expect(joinRemotePosixPath('~', 'deploy', '../logs', 'app.log')).toBe('~/logs/app.log')
    expect(joinRemotePosixPath('/etc', 'nginx/nginx.conf')).toBe('/etc/nginx/nginx.conf')
    expect(joinRemotePosixPath('~/sub', '../..')).toBe('~')
    expect(() => joinRemotePosixPath('/tmp', 'a\0b')).toThrow('路径不能包含空字符')

    expect(parentRemotePosixPath('/var/log')).toBe('/var')
    expect(parentRemotePosixPath('/')).toBe('/')
    expect(parentRemotePosixPath('~')).toBe('~')
    expect(parentRemotePosixPath('~/docs/a')).toBe('~/docs')
    expect(parentRemotePosixPath('~/docs')).toBe('~')

    expect(remoteBaseName('/var/log/app.log')).toBe('app.log')
    expect(remoteBaseName('~')).toBe('')
    expect(remoteBaseName('/')).toBe('')
  })

  it('builds breadcrumb segments for both home-relative and root paths', () => {
    expect(remoteBreadcrumbs('~/app/dist')).toEqual([
      { label: '~', path: '~' },
      { label: 'app', path: '~/app' },
      { label: 'dist', path: '~/app/dist' }
    ])
    expect(remoteBreadcrumbs('/etc/ssh')).toEqual([
      { label: '/', path: '/' },
      { label: 'etc', path: '/etc' },
      { label: 'ssh', path: '/etc/ssh' }
    ])
  })

  it('sanitizes download filenames against traversal, illegal characters and Windows reserved names', () => {
    expect(sanitizeDownloadFilename('../../etc/passwd')).toBe('passwd')
    expect(sanitizeDownloadFilename('C:\\Windows\\System32\\cmd.exe')).toBe('cmd.exe')
    expect(sanitizeDownloadFilename('a<b>c:d|e?f*g.txt')).toBe('a_b_c_d_e_f_g.txt')
    expect(sanitizeDownloadFilename('notes.txt . ')).toBe('notes.txt')
    expect(sanitizeDownloadFilename('...')).toBe('downloaded_file')
    expect(sanitizeDownloadFilename('CON')).toBe('_CON')
    expect(sanitizeDownloadFilename('nul.log')).toBe('_nul.log')
    expect(sanitizeDownloadFilename('COM1')).toBe('_COM1')
    expect(sanitizeDownloadFilename('LPT9.tar.gz')).toBe('_LPT9.tar.gz')
  })

  it('formats permissions, byte sizes and speeds cleanly', () => {
    expect(formatOctalMode(0o100755)).toBe('0755')
    expect(formatOctalMode(0o4750)).toBe('4750')
    expect(formatOctalMode(0o644)).toBe('0644')

    expect(formatUnixPermissions(0o755, 'directory')).toBe('drwxr-xr-x')
    expect(formatUnixPermissions(0o100644, 'file')).toBe('-rw-r--r--')
    expect(formatUnixPermissions(0o777, 'symlink')).toBe('lrwxrwxrwx')
    expect(formatUnixPermissions(0o4755, 'file')).toBe('-rwsr-xr-x')

    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.50 KB')
    expect(formatBytes(10 * 1024 * 1024)).toBe('10.0 MB')
    expect(formatBytes(-1)).toBe('—')

    expect(formatSpeed(0)).toBe('0 B/s')
    expect(formatSpeed(2048)).toBe('2.00 KB/s')
  })

  it('keeps directories before files when sorting by name, size or mtime', () => {
    const entries: SftpEntry[] = [
      makeEntry({ name: 'item10.log', path: '/item10.log', size: 20, mtime: 300 }),
      makeEntry({ name: 'dirB', path: '/dirB', kind: 'directory', size: 4096, mtime: 100 }),
      makeEntry({
        name: 'linkDir',
        path: '/linkDir',
        kind: 'symlink',
        targetKind: 'directory',
        size: 10,
        mtime: 400
      }),
      makeEntry({ name: 'item2.log', path: '/item2.log', size: 500, mtime: 200 })
    ]

    expect(sortSftpEntries(entries, 'name', true).map((e) => e.name)).toEqual([
      'dirB',
      'linkDir',
      'item2.log',
      'item10.log'
    ])
    expect(sortSftpEntries(entries, 'size', false).map((e) => e.name)).toEqual([
      'dirB',
      'linkDir',
      'item2.log',
      'item10.log'
    ])
    expect(sortSftpEntries(entries, 'mtime', false).map((e) => e.name)).toEqual([
      'linkDir',
      'dirB',
      'item10.log',
      'item2.log'
    ])
  })
})

describe('SFTP IPC Zod boundary contracts', () => {
  const sessionId = crypto.randomUUID()
  const transferId = crypto.randomUUID()

  it('supports standalone SFTP mode only on SSH session branch', () => {
    expect(
      openSessionSchema.safeParse({
        requestId: crypto.randomUUID(),
        kind: 'ssh',
        hostId: crypto.randomUUID(),
        cols: 80,
        rows: 24,
        mode: 'sftp'
      }).success
    ).toBe(true)

    expect(
      openSessionSchema.safeParse({
        requestId: crypto.randomUUID(),
        kind: 'ssh',
        hostId: crypto.randomUUID(),
        cols: 80,
        rows: 24,
        mode: 'ftp'
      }).success
    ).toBe(false)

    expect(
      openSessionSchema.safeParse({
        requestId: crypto.randomUUID(),
        kind: 'local',
        profileId: 'pwsh',
        cols: 80,
        rows: 24,
        mode: 'sftp'
      }).success
    ).toBe(false)
  })

  it('validates upload, download, chmod, rename, path and delete payloads strictly', () => {
    expect(
      sftpUploadSchema.safeParse({
        transferId,
        sessionId,
        localPath: 'C:\\temp\\a.txt',
        remotePath: '/tmp/a.txt',
        conflict: 'overwrite'
      }).success
    ).toBe(true)

    expect(
      sftpUploadSchema.safeParse({
        transferId,
        sessionId,
        localPath: '',
        remotePath: '/tmp/a.txt',
        conflict: 'overwrite'
      }).success
    ).toBe(false)

    expect(
      sftpDownloadSchema.safeParse({
        transferId,
        sessionId,
        remotePath: '/etc/hosts',
        localPath: 'C:\\temp\\hosts',
        conflict: 'rename'
      }).success
    ).toBe(true)

    expect(sftpChmodSchema.safeParse({ sessionId, path: '/tmp/a', mode: 0o755 }).success).toBe(true)
    expect(sftpChmodSchema.safeParse({ sessionId, path: '/tmp/a', mode: 0o10000 }).success).toBe(false)
    expect(sftpChmodSchema.safeParse({ sessionId, path: '/tmp/a', mode: -1 }).success).toBe(false)
    expect(sftpPathRequestSchema.safeParse({ sessionId, path: '/tmp' }).success).toBe(true)
    expect(sftpRenameSchema.safeParse({ sessionId, oldPath: '/a', newPath: '/b' }).success).toBe(true)
    expect(sftpDeleteSchema.safeParse({ sessionId, path: '/a', recursive: true }).success).toBe(true)
    expect(sftpDeleteSchema.safeParse({ sessionId, path: '/a', recursive: true, shell: true }).success).toBe(
      false
    )
  })
})

describe('local dropped file URI parsing', () => {
  it('parses Windows, UNC and POSIX file URIs while filtering comments and non-file URLs', () => {
    expect(parseFileUriToLocalPath('file:///C:/Users/Alice/My%20Docs/%E4%B8%AD%E6%96%87.txt')).toBe(
      'C:\\Users\\Alice\\My Docs\\中文.txt'
    )
    expect(parseFileUriToLocalPath('file://fileserver/share/release/app.exe')).toBe(
      '\\\\fileserver\\share\\release\\app.exe'
    )
    expect(parseFileUriToLocalPath('file:///home/alice/a%20b.txt')).toBe('/home/alice/a b.txt')
    expect(parseFileUriToLocalPath('https://example.com/file.txt')).toBeNull()

    expect(
      extractFilePathsFromUriList(
        [
          '# comment line',
          'https://example.com/ignored.zip',
          'file:///D:/work/demo.txt',
          'file:///D:/work/demo.txt',
          'file:///D:/work/%E6%96%87%E6%A1%A3.md'
        ].join('\r\n')
      )
    ).toEqual(['D:\\work\\demo.txt', 'D:\\work\\文档.md'])
  })
})

describe('pipelined SFTP worker transfer engine', () => {
  const cleanups: Array<() => Promise<void> | void> = []

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()!()
    }
  })

  async function openClientState(): Promise<{
    server: Awaited<ReturnType<typeof startMockSftpSshServer>>
    state: SftpSessionState
    localDir: string
  }> {
    const server = await startMockSftpSshServer({ username: 'pipe-user', password: 'PipePass!1' })
    cleanups.push(() => server.close())
    const localDir = await mkdtemp(join(tmpdir(), 'orbit-sftp-pipe-'))
    cleanups.push(() => rm(localDir, { recursive: true, force: true }))
    const client = new Client()
    await new Promise<void>((resolve, reject) => {
      client.once('ready', () => resolve())
      client.once('error', reject)
      client.connect({
        host: '127.0.0.1',
        port: server.port,
        username: server.username,
        password: server.password
      })
    })
    cleanups.push(() => {
      client.end()
    })
    const state: SftpSessionState = { client, activeTransfers: new Map() }
    return { server, state, localDir }
  }

  it('transfers multi-chunk binary files and 0-byte files losslessly with progress events', async () => {
    const { server, state, localDir } = await openClientState()
    const payload = randomBytes(260 * 1024 + 137) // > 8 chunks of 32 KiB
    const srcFile = join(localDir, 'payload.bin')
    const emptyFile = join(localDir, 'empty.dat')
    const dlFile = join(localDir, 'downloaded.bin')
    const dlEmpty = join(localDir, 'downloaded-empty.dat')
    await writeFile(srcFile, payload)
    await writeFile(emptyFile, Buffer.alloc(0))

    const uploadEvents: string[] = []
    await handleSftpRequest(
      state,
      {
        type: 'sftp:request',
        requestId: 'r1',
        sessionId: 's1',
        action: 'upload',
        transferId: 't-up-1',
        localPath: srcFile,
        remotePath: '~/nested/payload.bin',
        conflict: 'overwrite'
      },
      (evt) => uploadEvents.push(evt.status)
    )
    expect(uploadEvents).toContain('completed')
    const uploadedOnServer = await readFile(join(server.homeDir, 'nested', 'payload.bin'))
    expect(uploadedOnServer.equals(payload)).toBe(true)

    const downloadEvents: string[] = []
    await handleSftpRequest(
      state,
      {
        type: 'sftp:request',
        requestId: 'r2',
        sessionId: 's1',
        action: 'download',
        transferId: 't-dl-1',
        remotePath: '~/nested/payload.bin',
        localPath: dlFile,
        conflict: 'overwrite'
      },
      (evt) => downloadEvents.push(evt.status)
    )
    expect(downloadEvents).toContain('completed')
    expect((await readFile(dlFile)).equals(payload)).toBe(true)

    // 0-byte empty file upload & download
    await handleSftpRequest(
      state,
      {
        type: 'sftp:request',
        requestId: 'r3',
        sessionId: 's1',
        action: 'upload',
        transferId: 't-up-empty',
        localPath: emptyFile,
        remotePath: '~/empty.dat',
        conflict: 'overwrite'
      },
      () => {}
    )
    await handleSftpRequest(
      state,
      {
        type: 'sftp:request',
        requestId: 'r4',
        sessionId: 's1',
        action: 'download',
        transferId: 't-dl-empty',
        remotePath: '~/empty.dat',
        localPath: dlEmpty,
        conflict: 'overwrite'
      },
      () => {}
    )
    expect((await readFile(dlEmpty)).length).toBe(0)
  })

  it('enforces speedLimitBps throttling and cleans up partial files when cancelled', async () => {
    const { server, state, localDir } = await openClientState()
    const payload = randomBytes(128 * 1024)
    const srcFile = join(localDir, 'throttled.bin')
    await writeFile(srcFile, payload)

    // 1. Speed limit test: 128 KiB with initial bucket 64 KiB + 64 KiB/s -> remaining 64 KiB takes ~1s, fast-checked with 96 KiB/s (~333ms)
    const started = Date.now()
    await handleSftpRequest(
      state,
      {
        type: 'sftp:request',
        requestId: 'r-limit',
        sessionId: 's1',
        action: 'upload',
        transferId: 't-limit',
        localPath: srcFile,
        remotePath: '~/throttled.bin',
        conflict: 'overwrite',
        speedLimitBps: 96 * 1024
      },
      () => {}
    )
    expect(Date.now() - started).toBeGreaterThanOrEqual(250)

    // 2. Cancellation test: abort during throttled upload and ensure temp .orbit-part file is removed
    const cancelPayload = randomBytes(256 * 1024)
    const cancelSrc = join(localDir, 'cancel.bin')
    await writeFile(cancelSrc, cancelPayload)
    const uploadPromise = handleSftpRequest(
      state,
      {
        type: 'sftp:request',
        requestId: 'r-cancel',
        sessionId: 's1',
        action: 'upload',
        transferId: 't-cancel',
        localPath: cancelSrc,
        remotePath: '~/cancel.bin',
        conflict: 'overwrite',
        speedLimitBps: 64 * 1024
      },
      () => {
        state.activeTransfers.get('t-cancel')?.abort()
      }
    )
    await expect(uploadPromise).rejects.toThrow(/取消/)
    const serverFiles = await readdir(server.homeDir)
    expect(serverFiles.some((f) => f.includes('.orbit-part'))).toBe(false)
    expect(serverFiles).not.toContain('cancel.bin')
  })
})
