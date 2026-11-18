import Database from 'better-sqlite3'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Repository } from '../../src/workers/data-crypto/database'
import {
  DEFAULT_FILES_SETTINGS,
  DEFAULT_SSH_SETTINGS,
  capabilitiesFor,
  describeFileEndpoint,
  fileConnectSchema,
  fileProfileInputSchema,
  isFileProtocolAvailable,
  normalizeProtocolSettings,
  protocolSettingsPatchSchema
} from '../../src/shared/files'

const tempDirs: string[] = []
afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})
function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'orbit-files-test-'))
  tempDirs.push(dir)
  return dir
}

describe('file profile input schema', () => {
  const base = { name: 'Backup', protocol: 'ftp' as const, host: 'ftp.example.com' }

  it('accepts minimal valid profiles per protocol and fills defaults', () => {
    const ftp = fileProfileInputSchema.parse(base)
    expect(ftp.port).toBe(0)
    expect(ftp.options).toEqual({})
    expect(ftp.saveSecrets).toBe(false)

    expect(
      fileProfileInputSchema.safeParse({
        name: 'Secure',
        protocol: 'ftps',
        host: 'h',
        options: { tlsMode: 'implicit' }
      }).success
    ).toBe(true)
    expect(
      fileProfileInputSchema.safeParse({
        name: 'DAV',
        protocol: 'webdav',
        options: { url: 'https://dav.example.com/remote.php/dav/files/me' }
      }).success
    ).toBe(true)
    expect(
      fileProfileInputSchema.safeParse({
        name: 'Bucket',
        protocol: 's3',
        username: 'AKIA',
        options: { bucket: 'b', region: 'eu-west-1' }
      }).success
    ).toBe(true)
  })

  it('rejects per-protocol invalid combinations', () => {
    expect(fileProfileInputSchema.safeParse({ ...base, host: '' }).success).toBe(false)
    expect(fileProfileInputSchema.safeParse({ ...base, protocol: 'ftps' }).success).toBe(false)
    expect(fileProfileInputSchema.safeParse({ ...base, host: 'a b' }).success).toBe(false)
    expect(fileProfileInputSchema.safeParse({ ...base, host: 'a/b' }).success).toBe(false)
    expect(fileProfileInputSchema.safeParse({ name: 'x', protocol: 'webdav' }).success).toBe(false)
    expect(
      fileProfileInputSchema.safeParse({
        name: 'x',
        protocol: 'webdav',
        options: { url: 'ftp://dav.example.com' }
      }).success
    ).toBe(false)
    expect(
      fileProfileInputSchema.safeParse({
        name: 'x',
        protocol: 'webdav',
        options: { url: 'https://user:pass@dav.example.com' }
      }).success
    ).toBe(false)
    expect(
      fileProfileInputSchema.safeParse({
        name: 'x',
        protocol: 's3',
        username: 'AK',
        options: { bucket: 'b' }
      }).success
    ).toBe(false)
    expect(
      fileProfileInputSchema.safeParse({ name: 'x', protocol: 's3', options: { bucket: 'b', region: 'r' } })
        .success
    ).toBe(false)
    expect(
      fileProfileInputSchema.safeParse({ ...base, secrets: { password: 'p' }, clearSecrets: true }).success
    ).toBe(false)
  })

  it('rejects unknown keys and sftp as a file-profile protocol', () => {
    expect(fileProfileInputSchema.safeParse({ ...base, extra: 1 }).success).toBe(false)
    expect(fileProfileInputSchema.safeParse({ ...base, options: { nope: true } }).success).toBe(false)
    expect(fileProfileInputSchema.safeParse({ ...base, protocol: 'sftp' }).success).toBe(false)
  })

  it('validates connect sources and exposes capability/availability helpers', () => {
    const id = crypto.randomUUID()
    expect(fileConnectSchema.safeParse({ kind: 'profile', profileId: id }).success).toBe(true)
    expect(fileConnectSchema.safeParse({ kind: 'profile', profileId: 'nope' }).success).toBe(false)
    expect(fileConnectSchema.safeParse({ kind: 'adhoc', profile: base }).success).toBe(true)
    expect(capabilitiesFor('s3').realDirectories).toBe(false)
    expect(capabilitiesFor('webdav').chmod).toBe(false)
    expect(capabilitiesFor('ftp').chmod).toBe(true)
    expect(isFileProtocolAvailable('s3')).toBe(true)
    expect(isFileProtocolAvailable('smb')).toBe(false)
    expect(describeFileEndpoint({ protocol: 'ftp', host: 'h', port: 0, options: {} })).toBe('h:21')
  })
})

describe('protocol settings schema', () => {
  it('falls back field-by-field instead of resetting everything', () => {
    const files = normalizeProtocolSettings('files', {
      maxConcurrentTransfers: 5,
      speedLimitKBps: -1,
      defaultConflict: 'rename',
      bogus: true
    })
    expect(files.maxConcurrentTransfers).toBe(5)
    expect(files.speedLimitKBps).toBe(DEFAULT_FILES_SETTINGS.speedLimitKBps)
    expect(files.defaultConflict).toBe('rename')
    expect(normalizeProtocolSettings('ssh', 'garbage')).toEqual(DEFAULT_SSH_SETTINGS)
    expect(normalizeProtocolSettings('files', null)).toEqual(DEFAULT_FILES_SETTINGS)
  })

  it('validates patches', () => {
    expect(
      protocolSettingsPatchSchema.safeParse({ namespace: 'files', patch: { maxConcurrentTransfers: 9 } })
        .success
    ).toBe(false)
    expect(
      protocolSettingsPatchSchema.safeParse({ namespace: 'ssh', patch: { defaultKeepaliveSec: 15 } }).success
    ).toBe(true)
    expect(protocolSettingsPatchSchema.safeParse({ namespace: 'rdp', patch: {} }).success).toBe(false)
  })
})

describe('Repository v4: file profiles and protocol settings', () => {
  it('creates, updates, preserves/clears secrets, enforces unique names and deletes profiles', () => {
    const repo = new Repository(':memory:')
    try {
      expect(repo.fileProfilesList()).toEqual([])
      const secret = Uint8Array.from([1, 2, 3])
      const [created] = repo.fileProfileSave(
        { name: 'Prod FTP', protocol: 'ftp', host: 'ftp.example.com', username: 'deploy' },
        secret
      )
      expect(created!.hasSecrets).toBe(true)
      expect(created!.port).toBe(0)
      expect(JSON.stringify(created)).not.toContain('password')

      expect(() => repo.fileProfileSave({ name: 'prod ftp', protocol: 'ftp', host: 'other' })).toThrow(
        '服务器名称已存在'
      )

      const id = created!.id
      // Updating without a new secret keeps the stored one.
      const updated = repo.fileProfileSave({
        id,
        name: 'Prod FTP 2',
        protocol: 'ftp',
        host: 'ftp.example.com',
        port: 2121
      })
      expect(updated[0]!.name).toBe('Prod FTP 2')
      expect(updated[0]!.port).toBe(2121)
      expect(updated[0]!.hasSecrets).toBe(true)
      expect(Uint8Array.from(repo.fileProfileGet(id).secret!)).toEqual(secret)

      repo.fileProfileUpdateSecret(id, Uint8Array.from([9]))
      expect(Uint8Array.from(repo.fileProfileGet(id).secret!)).toEqual(Uint8Array.from([9]))
      expect(() => repo.fileProfileUpdateSecret(crypto.randomUUID(), Uint8Array.from([1]))).toThrow()

      const cleared = repo.fileProfileSave({
        id,
        name: 'Prod FTP 2',
        protocol: 'ftp',
        host: 'ftp.example.com',
        clearSecrets: true
      })
      expect(cleared[0]!.hasSecrets).toBe(false)
      expect(repo.fileProfileGet(id).secret).toBeUndefined()

      expect(() =>
        repo.fileProfileSave({ id: crypto.randomUUID(), name: 'ghost', protocol: 'ftp', host: 'h' })
      ).toThrow('已删除')
      expect(() => repo.fileProfileGet(crypto.randomUUID())).toThrow('已删除')
      expect(repo.fileProfileRemove(id)).toEqual([])
    } finally {
      repo.close()
    }
  })

  it('persists protocol settings, merges patches and survives corrupt documents', () => {
    const repo = new Repository(':memory:')
    try {
      expect(repo.protocolSettingsAll()).toEqual({
        ssh: DEFAULT_SSH_SETTINGS,
        files: DEFAULT_FILES_SETTINGS
      })
      const afterFiles = repo.protocolSettingsPatch('files', { maxConcurrentTransfers: 6 })
      expect(afterFiles.files.maxConcurrentTransfers).toBe(6)
      const afterSsh = repo.protocolSettingsPatch('ssh', { defaultKeepaliveSec: 10 })
      expect(afterSsh.ssh.defaultKeepaliveSec).toBe(10)
      expect(afterSsh.files.maxConcurrentTransfers).toBe(6)
      repo.protocolSettingsPatch('files', { defaultConflict: 'skip' })
      expect(repo.protocolSettingsAll().files).toMatchObject({
        maxConcurrentTransfers: 6,
        defaultConflict: 'skip'
      })
      expect(() => repo.protocolSettingsPatch('files', { maxConcurrentTransfers: 99 })).toThrow()
      expect(() => repo.protocolSettingsPatch('rdp' as unknown as 'files', {} as never)).toThrow(
        '未知的设置分类'
      )
    } finally {
      repo.close()
    }
  })

  it('migrates a v3 database to v4 with a backup and keeps existing rows', () => {
    const dir = makeTempDir()
    const dbPath = join(dir, 'v3.db')
    const first = new Repository(dbPath)
    first.save({ name: 'Keep-Me', address: '10.0.0.1', port: 22, username: 'root' })
    first.close()

    // Downgrade the marker and drop the v4 tables to mimic a real v3 file.
    const raw = new Database(dbPath)
    raw.exec('DROP TABLE file_profiles; DROP TABLE protocol_settings; PRAGMA user_version = 3;')
    raw.close()

    const repo = new Repository(dbPath)
    try {
      expect(readdirSync(dir).filter((n) => n.startsWith('v3.db.bak-v3-'))).toHaveLength(1)
      expect(repo.list().map((h) => h.name)).toEqual(['Keep-Me'])
      expect(repo.fileProfilesList()).toEqual([])
      expect(repo.protocolSettingsAll().files).toEqual(DEFAULT_FILES_SETTINGS)
    } finally {
      repo.close()
    }
    const verify = new Database(dbPath, { readonly: true })
    expect(verify.pragma('user_version', { simple: true })).toBe(4)
    verify.close()
  })
})
