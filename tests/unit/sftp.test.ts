import { describe, expect, it } from 'vitest'
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
  formatBytes,
  formatOctalMode,
  formatSpeed,
  formatUnixPermissions,
  joinRemotePosixPath,
  normalizeRemotePosixPath,
  parentRemotePosixPath,
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
