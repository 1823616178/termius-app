import Database from 'better-sqlite3'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Repository } from '../../src/workers/data-crypto/database'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'orbit-db-test-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('Repository persistence and migrations', () => {
  it('supports CRUD, case-insensitive duplicate rejection, and secret preservation/clearing', () => {
    const repo = new Repository(':memory:')
    try {
      const secret1 = Uint8Array.from([1, 2, 3])
      const list1 = repo.save(
        { name: 'Prod-Server', address: '10.0.0.10', port: 22, username: 'deploy', auth: 'password' },
        secret1
      )
      expect(list1).toHaveLength(1)
      expect(list1[0]!.hasPassword).toBe(true)

      expect(() =>
        repo.save({ name: 'prod-server', address: '10.0.0.11', port: 22, username: 'deploy' })
      ).toThrow('主机名称已存在，请使用其他名称。')

      // Updating metadata without passing new encrypted buffer preserves existing secret
      const id = list1[0]!.id
      const list2 = repo.save({
        id,
        name: 'Prod-Server-Updated',
        address: '10.0.0.10',
        port: 2222,
        username: 'deploy',
        auth: 'password'
      })
      expect(list2[0]!.hasPassword).toBe(true)
      expect(Uint8Array.from(repo.get(id).secret!)).toEqual(secret1)

      // updateSecret updates existing row and throws on missing row
      const secret2 = Uint8Array.from([9, 8, 7])
      repo.updateSecret(id, secret2)
      expect(Uint8Array.from(repo.get(id).secret!)).toEqual(secret2)
      expect(() => repo.updateSecret(crypto.randomUUID(), secret2)).toThrow('主机已删除，无法更新凭据。')

      // clearPassword clears stored secret
      const list3 = repo.save({
        id,
        name: 'Prod-Server-Updated',
        address: '10.0.0.10',
        port: 2222,
        username: 'deploy',
        auth: 'password',
        clearPassword: true
      })
      expect(list3[0]!.hasPassword).toBe(false)
      expect(repo.get(id).secret).toBeNull()

      expect(repo.remove(id)).toEqual([])
      expect(() => repo.get(id)).toThrow('主机已删除，请刷新列表。')
    } finally {
      repo.close()
    }
  })

  it('stores and updates known host trust metadata', () => {
    const repo = new Repository(':memory:')
    try {
      expect(repo.known('host.test', 22)).toBeUndefined()
      repo.trust('host.test', 22, 'SHA256:abc', 'ssh-ed25519', Uint8Array.from([4, 5]), 'local')
      const entry = repo.known('host.test', 22)
      expect(entry?.fingerprint).toBe('SHA256:abc')
      expect(entry?.algorithm).toBe('ssh-ed25519')
      expect(entry?.source).toBe('local')
      expect(entry?.trustedAt).toBeTruthy()
    } finally {
      repo.close()
    }
  })

  it('migrates schema v1 to v2 with a backup file and preserves existing rows', () => {
    const dir = makeTempDir()
    const dbPath = join(dir, 'vault.db')
    const legacy = new Database(dbPath)
    legacy.pragma('journal_mode = WAL')
    legacy.exec(`
      CREATE TABLE hosts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        document TEXT NOT NULL,
        secret BLOB
      );
      CREATE TABLE known_hosts (
        address TEXT NOT NULL,
        port INTEGER NOT NULL,
        fingerprint TEXT NOT NULL,
        algorithm TEXT NOT NULL,
        PRIMARY KEY(address, port)
      );
      PRAGMA user_version = 1;
    `)
    legacy
      .prepare('INSERT INTO known_hosts (address, port, fingerprint, algorithm) VALUES (?, ?, ?, ?)')
      .run('legacy.test', 22, 'SHA256:legacy', 'ssh-rsa')
    legacy.close()

    const repo = new Repository(dbPath)
    try {
      const backups = readdirSync(dir).filter((name) => name.startsWith('vault.db.bak-v1-'))
      expect(backups.length).toBe(1)
      const known = repo.known('legacy.test', 22)
      expect(known?.fingerprint).toBe('SHA256:legacy')
      expect(known?.source).toBe('local')

      repo.trust('legacy.test', 22, 'SHA256:new', 'ssh-ed25519', Uint8Array.from([1, 2]), 'manual')
      expect(repo.known('legacy.test', 22)?.fingerprint).toBe('SHA256:new')
    } finally {
      repo.close()
    }
  })

  it('rejects database files from newer application versions', () => {
    const dir = makeTempDir()
    const dbPath = join(dir, 'future.db')
    const future = new Database(dbPath)
    future.exec('PRAGMA user_version = 99;')
    future.close()

    expect(() => new Repository(dbPath)).toThrow('数据库版本高于当前应用，请使用较新版本。')
  })

  it('migrates schema v2 to v3 with backup and supports synced groups and tunnels CRUD', () => {
    const dir = makeTempDir()
    const dbPath = join(dir, 'v2.db')
    const legacy = new Database(dbPath)
    legacy.pragma('journal_mode = WAL')
    legacy.exec(`
      CREATE TABLE hosts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        document TEXT NOT NULL,
        secret BLOB
      );
      CREATE TABLE known_hosts (
        address TEXT NOT NULL,
        port INTEGER NOT NULL,
        fingerprint TEXT NOT NULL,
        algorithm TEXT NOT NULL,
        public_key BLOB,
        trusted_at TEXT,
        source TEXT NOT NULL DEFAULT 'local',
        PRIMARY KEY(address, port)
      );
      PRAGMA user_version = 2;
    `)
    const hostId = crypto.randomUUID()
    legacy.prepare('INSERT INTO hosts (id, name, document, secret) VALUES (?, ?, ?, NULL)').run(
      hostId,
      'Legacy-V2',
      JSON.stringify({
        id: hostId,
        name: 'Legacy-V2',
        address: '10.0.0.2',
        port: 22,
        username: 'root',
        auth: 'password',
        group: 'local',
        notes: '',
        favorite: false,
        hasPassword: false,
        updatedAt: '2026-11-14T00:00:00.000Z'
      })
    )
    legacy.close()

    const repo = new Repository(dbPath)
    try {
      const backups = readdirSync(dir).filter((name) => name.startsWith('v2.db.bak-v2-'))
      expect(backups.length).toBe(1)
      expect(repo.list().map((h) => h.name)).toEqual(['Legacy-V2'])

      const groups = repo.groupSave({ name: 'Infra', color: '#22C55E' })
      expect(groups).toHaveLength(1)

      const tunnels = repo.tunnelSave({
        name: 'DB-Forward',
        serverId: hostId,
        groupId: groups[0]!.id,
        type: 'L',
        listenHost: '127.0.0.1',
        listenPort: 15432,
        destHost: '127.0.0.1',
        destPort: 5432
      })
      expect(tunnels).toHaveLength(1)
      expect(tunnels[0]!.readOnly).toBe(false)

      // Removing referenced group cleanly unlinks tunnel.groupId
      repo.groupRemove(groups[0]!.id)
      expect(repo.tunnelsList()[0]!.groupId).toBeNull()

      // Repeated queries reuse cached prepared statements cleanly across mutations
      expect(repo.list()).toHaveLength(1)
      expect(repo.get(hostId).host.name).toBe('Legacy-V2')
      expect(repo.knownHostsList()).toEqual([])
      repo.trust('example.test', 22, 'SHA256:abc', 'ssh-ed25519')
      expect(repo.known('example.test', 22)?.fingerprint).toBe('SHA256:abc')
      expect(repo.knownHostsList()).toHaveLength(1)
    } finally {
      repo.close()
    }
  })
})
