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

  it('places newly added hosts, file profiles, and RDP profiles at the top and preserves order on update', () => {
    const repo = new Repository(':memory:')
    try {
      repo.save({ name: 'Alpha', address: '10.0.0.1', port: 22, username: 'root' })
      const afterBravo = repo.save({ name: 'Bravo', address: '10.0.0.2', port: 22, username: 'root' })
      const bravoId = afterBravo[0]!.id
      repo.save({ name: 'Charlie', address: '10.0.0.3', port: 22, username: 'root' })
      expect(repo.list().map((h) => h.name)).toEqual(['Charlie', 'Bravo', 'Alpha'])

      repo.save({ id: bravoId, name: 'Bravo-Edited', address: '10.0.0.2', port: 2222, username: 'root' })
      expect(repo.list().map((h) => h.name)).toEqual(['Charlie', 'Bravo-Edited', 'Alpha'])

      repo.fileProfileSave({ name: 'File-A', protocol: 'ftp', host: '10.0.1.1' })
      const afterFileB = repo.fileProfileSave({ name: 'File-B', protocol: 'ftp', host: '10.0.1.2' })
      const fileBId = afterFileB[0]!.id
      repo.fileProfileSave({ name: 'File-C', protocol: 'ftp', host: '10.0.1.3' })
      expect(repo.fileProfilesList().map((p) => p.name)).toEqual(['File-C', 'File-B', 'File-A'])

      repo.fileProfileSave({ id: fileBId, name: 'File-B-Edited', protocol: 'ftp', host: '10.0.1.2' })
      expect(repo.fileProfilesList().map((p) => p.name)).toEqual(['File-C', 'File-B-Edited', 'File-A'])

      repo.rdpProfileSave({ name: 'Rdp-A', host: '10.0.2.1' })
      const afterRdpB = repo.rdpProfileSave({ name: 'Rdp-B', host: '10.0.2.2' })
      const rdpBId = afterRdpB[0]!.id
      repo.rdpProfileSave({ name: 'Rdp-C', host: '10.0.2.3' })
      expect(repo.rdpProfilesList().map((p) => p.name)).toEqual(['Rdp-C', 'Rdp-B', 'Rdp-A'])

      repo.rdpProfileSave({ id: rdpBId, name: 'Rdp-B-Edited', host: '10.0.2.2' })
      expect(repo.rdpProfilesList().map((p) => p.name)).toEqual(['Rdp-C', 'Rdp-B-Edited', 'Rdp-A'])
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

  it('migrates schema v4 to v5 with backup and manages rdp_profiles and known_rdp_hosts', () => {
    const dir = makeTempDir()
    const dbPath = join(dir, 'v4.db')
    const legacy = new Database(dbPath)
    legacy.pragma('journal_mode = WAL')
    legacy.exec(`
      CREATE TABLE hosts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        document TEXT NOT NULL,
        secret BLOB,
        sync_extras TEXT,
        account_scope TEXT NOT NULL DEFAULT 'local'
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
      CREATE TABLE sync_accounts (
        id TEXT PRIMARY KEY,
        server_url TEXT NOT NULL,
        email TEXT NOT NULL,
        remember_email INTEGER NOT NULL DEFAULT 1,
        keep_signed_in INTEGER NOT NULL DEFAULT 0,
        auto_sync INTEGER NOT NULL DEFAULT 1,
        write_mode TEXT NOT NULL DEFAULT 'realtime',
        allow_insecure_http INTEGER NOT NULL DEFAULT 0,
        encrypted_refresh_token BLOB,
        encrypted_vault_key BLOB,
        device_id TEXT NOT NULL,
        device_name TEXT NOT NULL,
        vault_id TEXT,
        key_version INTEGER NOT NULL DEFAULT 1,
        sync_passwords INTEGER NOT NULL DEFAULT 0,
        sync_private_keys INTEGER NOT NULL DEFAULT 0,
        last_revision TEXT,
        last_etag TEXT,
        last_sync_at TEXT,
        base_doc_cipher BLOB,
        pending_changes INTEGER NOT NULL DEFAULT 0,
        read_only_remote_schema INTEGER NOT NULL DEFAULT 0,
        remote_schema_version INTEGER,
        doc_extra TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, updated_at TEXT NOT NULL, unknown_extra TEXT, account_scope TEXT NOT NULL DEFAULT 'local');
      CREATE TABLE tunnels (id TEXT PRIMARY KEY, name TEXT NOT NULL, server_id TEXT NOT NULL, group_id TEXT, type TEXT NOT NULL, listen_host TEXT NOT NULL, listen_port INTEGER NOT NULL, dest_host TEXT NOT NULL, dest_port INTEGER NOT NULL, dest_server_id TEXT, auto_reconnect INTEGER NOT NULL DEFAULT 1, enabled INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, unknown_extra TEXT, account_scope TEXT NOT NULL DEFAULT 'local');
      CREATE TABLE file_profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, protocol TEXT NOT NULL, document TEXT NOT NULL, secret BLOB, updated_at TEXT NOT NULL);
      CREATE TABLE protocol_settings (namespace TEXT PRIMARY KEY, document TEXT NOT NULL, updated_at TEXT NOT NULL);
      PRAGMA user_version = 4;
    `)
    legacy
      .prepare('INSERT INTO protocol_settings (namespace, document, updated_at) VALUES (?, ?, ?)')
      .run('ssh', JSON.stringify({ defaultPort: 2222, defaultKeepaliveSec: 45 }), '2026-11-18T00:00:00.000Z')
    legacy.close()

    const repo = new Repository(dbPath)
    try {
      const backups = readdirSync(dir).filter((name) => name.startsWith('v4.db.bak-v4-'))
      expect(backups).toHaveLength(1)
      expect(repo.protocolSettingsAll().ssh.defaultPort).toBe(2222)
      expect(repo.protocolSettingsAll().rdp.preferredMode).toBe('external')

      const enc = Uint8Array.from([10, 20, 30])
      const list1 = repo.rdpProfileSave(
        {
          name: 'Win11-Box',
          host: '192.168.1.50',
          port: 3389,
          username: 'Administrator',
          savePassword: true,
          options: { launchMode: 'embedded' }
        },
        enc
      )
      expect(list1).toHaveLength(1)
      expect(list1[0]!.hasPassword).toBe(true)

      expect(() => repo.rdpProfileSave({ name: 'win11-box', host: '10.0.0.1' })).toThrow(
        '远程桌面名称已存在，请使用其他名称。'
      )

      const id = list1[0]!.id
      const cleared = repo.rdpProfileSave({
        id,
        name: 'Win11-Box',
        host: '192.168.1.50',
        port: 3389,
        clearPassword: true
      })
      expect(cleared[0]!.hasPassword).toBe(false)
      expect(repo.rdpProfileGet(id).secret).toBeUndefined()

      expect(repo.rdpKnownHostVerify('Win11.local', 3389, 'AA:BB')).toEqual({ status: 'unknown' })
      const trusted = repo.rdpKnownHostTrust({
        host: 'Win11.local',
        port: 3389,
        fingerprint: 'AA:BB',
        subject: 'CN=Win11',
        issuer: 'CN=Win11',
        validFrom: '2026',
        validTo: '2035'
      })
      expect(trusted).toHaveLength(1)
      expect(repo.rdpKnownHostVerify('win11.local', 3389, 'aa:bb')).toEqual({ status: 'trusted' })
      expect(repo.rdpKnownHostVerify('win11.local', 3389, 'CC:DD')).toEqual({
        status: 'mismatch',
        previousFingerprint: 'AA:BB'
      })
      expect(repo.rdpKnownHostRemove(trusted[0]!.id)).toEqual([])
      expect(repo.rdpProfileRemove(id)).toEqual([])
    } finally {
      repo.close()
    }
  })

  it('migrates schema v5 to v6 with .bak-v5 backup, adds sync_namespaces and marks pending changes on multi-protocol mutations', () => {
    const dir = makeTempDir()
    const dbPath = join(dir, 'v5.db')
    const first = new Repository(dbPath)
    first.close()

    const raw = new Database(dbPath)
    raw.exec('DROP TABLE sync_namespaces; PRAGMA user_version = 5;')
    raw.close()

    const repo = new Repository(dbPath)
    try {
      expect(readdirSync(dir).filter((n) => n.startsWith('v5.db.bak-v5-'))).toHaveLength(1)
      expect(repo.syncNamespacesList()).toEqual([])

      repo.fileProfileSave({ name: 'Nas-FTP', protocol: 'ftp', host: '10.0.0.12' })
      expect(repo.syncNamespaceGet('protocols')?.pendingChanges).toBe(true)

      repo.protocolSettingsPatch('ssh', { defaultPort: 2200 })
      expect(repo.syncNamespaceGet('settings')?.pendingChanges).toBe(true)

      const acc = repo.syncAccountUpsert({
        serverUrl: 'https://sync.example.com',
        email: 'ops@example.com',
        rememberEmail: true,
        keepSignedIn: false,
        autoSync: true,
        deviceId: 'dev-v6',
        deviceName: 'V6-Box',
        syncFileCredentials: true,
        syncRdpCredentials: true,
        syncProtocolSettings: false
      })
      expect(acc.syncFileCredentials).toBe(true)
      expect(acc.syncRdpCredentials).toBe(true)
      expect(acc.syncProtocolSettings).toBe(false)
    } finally {
      repo.close()
    }
  })
})
