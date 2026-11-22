import Database from 'better-sqlite3'
import { copyFileSync, existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { Host, HostInput, KnownHostEntry } from '../../shared/contracts'
import { hostInputSchema } from '../../shared/contracts'
import {
  fileProfileInputSchema,
  normalizeProtocolSettings,
  protocolSettingsSchemas,
  PROTOCOL_NAMESPACES,
  type AllProtocolSettings,
  type FileProfile,
  type FileProfileInput,
  type FileSecretsInput,
  type ProtocolNamespace,
  type ProtocolSettingsMap
} from '../../shared/files'
import {
  rdpProfileInputSchema,
  type KnownRdpHostEntry,
  type RdpProfile,
  type RdpProfileInput
} from '../../shared/rdp'
import {
  syncGroupInputSchema,
  syncTunnelInputSchema,
  type HostSyncExtras,
  type SyncConflict,
  type SyncDocumentEnvelope,
  type SyncDocumentProtocolsV2,
  type SyncDocumentSettingsV2,
  type SyncDocumentV1,
  type SyncGroup,
  type SyncGroupInput,
  type SyncNamespace,
  type SyncTunnel,
  type SyncTunnelInput,
  type VaultMetadataWire
} from '../../shared/sync'
import {
  createVaultMaterial,
  decryptNamespaceDocument,
  decryptSyncDocument,
  encryptNamespaceDocument,
  encryptSyncDocument,
  recoverVaultWithKey,
  rotateVaultKeyMaterials,
  unlockVaultWithPassword
} from './sync-crypto'
import {
  normalizeRemoteDocument,
  threeWayMerge,
  type LocalMergedHost,
  type LocalSyncSource
} from './sync-merge'
import {
  buildLocalProtocolsDocument,
  buildLocalSettingsDocument,
  normalizeRemoteProtocolsDocument,
  normalizeRemoteSettingsDocument,
  threeWayMergeProtocols,
  threeWayMergeSettings,
  type LocalMergedFileProfile,
  type LocalMergedRdpProfile,
  type LocalProtocolsSyncSource,
  type LocalSettingsSyncSource
} from './sync-merge-v2'

const CURRENT_SCHEMA_VERSION = 6

const FILES_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS file_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    protocol TEXT NOT NULL,
    document TEXT NOT NULL,
    secret BLOB,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS protocol_settings (
    namespace TEXT PRIMARY KEY,
    document TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`

const RDP_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS rdp_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    document TEXT NOT NULL,
    secret BLOB,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS known_rdp_hosts (
    id TEXT PRIMARY KEY,
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    fingerprint TEXT NOT NULL,
    subject TEXT NOT NULL,
    issuer TEXT NOT NULL,
    valid_from TEXT NOT NULL,
    valid_to TEXT NOT NULL,
    accepted_at TEXT NOT NULL
  );
`

const SYNC_NAMESPACES_SQL = `
  CREATE TABLE IF NOT EXISTS sync_namespaces (
    namespace TEXT PRIMARY KEY,
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
`

const SYNC_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS sync_accounts (
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
    sync_file_credentials INTEGER NOT NULL DEFAULT 0,
    sync_rdp_credentials INTEGER NOT NULL DEFAULT 0,
    sync_protocol_settings INTEGER NOT NULL DEFAULT 1,
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
  CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    unknown_extra TEXT,
    account_scope TEXT NOT NULL DEFAULT 'local'
  );
  CREATE TABLE IF NOT EXISTS tunnels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    server_id TEXT NOT NULL,
    group_id TEXT,
    type TEXT NOT NULL,
    listen_host TEXT NOT NULL,
    listen_port INTEGER NOT NULL,
    dest_host TEXT NOT NULL,
    dest_port INTEGER NOT NULL,
    dest_server_id TEXT,
    auto_reconnect INTEGER NOT NULL DEFAULT 1,
    enabled INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    unknown_extra TEXT,
    account_scope TEXT NOT NULL DEFAULT 'local'
  );
  ${SYNC_NAMESPACES_SQL}
`

export interface SyncNamespaceRecord {
  namespace: SyncNamespace
  lastRevision: string | null
  lastEtag: string | null
  lastSyncAt: string | null
  baseDocCipher?: Uint8Array
  pendingChanges: boolean
  readOnlyRemoteSchema: boolean
  remoteSchemaVersion?: number
  docExtra?: Record<string, unknown>
  updatedAt: string
}

export interface SyncAccountRecord {
  id: string
  serverUrl: string
  email: string
  rememberEmail: boolean
  keepSignedIn: boolean
  autoSync: boolean
  writeMode: 'realtime' | 'local-only'
  allowInsecureHttp: boolean
  encryptedRefreshToken?: Uint8Array
  encryptedVaultKey?: Uint8Array
  deviceId: string
  deviceName: string
  vaultId: string | null
  keyVersion: number
  syncPasswords: boolean
  syncPrivateKeys: boolean
  syncFileCredentials: boolean
  syncRdpCredentials: boolean
  syncProtocolSettings: boolean
  lastRevision: string | null
  lastEtag: string | null
  lastSyncAt: string | null
  baseDocCipher?: Uint8Array
  pendingChanges: boolean
  readOnlyRemoteSchema: boolean
  remoteSchemaVersion?: number
  docExtra?: Record<string, unknown>
  updatedAt: string
}

export interface SyncEvaluateOutput {
  readOnlySchema: boolean
  remoteSchemaVersion?: number
  conflicts: SyncConflict[]
  needsUpload: boolean
  uploadEnvelope?: SyncDocumentEnvelope
  mergedBaseJson?: string
  hostSecretsToEncrypt: Array<{ hostId: string; password: string | null }>
  localHostUpdates: LocalMergedHost[]
  deletedHostIds: string[]
  localGroups: Array<SyncGroup & { unknownExtra?: Record<string, unknown> }>
  localTunnels: Array<SyncTunnel & { unknownExtra?: Record<string, unknown> }>
  nextPreferences: { syncPasswords: boolean; syncPrivateKeys: boolean }
  remoteHostFingerprints: Array<{ address: string; port: number; fingerprint: string }>
  docExtra?: Record<string, unknown>
}

export interface SyncEvaluateProtocolsOutput {
  readOnlySchema: boolean
  remoteSchemaVersion?: number
  conflicts: SyncConflict[]
  needsUpload: boolean
  uploadEnvelope?: SyncDocumentEnvelope
  mergedBaseJson?: string
  fileSecretsToEncrypt: Array<{ profileId: string; secrets: FileSecretsInput | null }>
  rdpSecretsToEncrypt: Array<{ profileId: string; password: string | null }>
  localFileProfileUpdates: LocalMergedFileProfile[]
  deletedFileProfileIds: string[]
  localRdpProfileUpdates: LocalMergedRdpProfile[]
  deletedRdpProfileIds: string[]
  localKnownRdpHosts: KnownRdpHostEntry[]
  deletedKnownRdpHostIds: string[]
  nextPreferences: { syncFileCredentials: boolean; syncRdpCredentials: boolean }
  docExtra?: Record<string, unknown>
}

export interface SyncEvaluateSettingsOutput {
  readOnlySchema: boolean
  remoteSchemaVersion?: number
  conflicts: SyncConflict[]
  needsUpload: boolean
  uploadEnvelope?: SyncDocumentEnvelope
  mergedBaseJson?: string
  nextProtocolSettings?: AllProtocolSettings
  nextPreferences: { syncProtocolSettings: boolean }
  docExtra?: Record<string, unknown>
}

export class Repository {
  private db: Database.Database
  private closed = false
  private readonly stmtCache = new Map<string, Database.Statement>()
  private vaultKeys = new Map<string, Buffer>()
  private pendingRotatedKeys = new Map<string, { keyVersion: number; key: Buffer }>()

  private stmt(sql: string): Database.Statement {
    let cached = this.stmtCache.get(sql)
    if (!cached) {
      cached = this.db.prepare(sql)
      this.stmtCache.set(sql, cached)
    }
    return cached
  }

  constructor(path: string) {
    this.db = new Database(path)
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('journal_mode = WAL')
    let version = this.db.pragma('user_version', { simple: true }) as number
    if (version > CURRENT_SCHEMA_VERSION) {
      this.db.close()
      this.closed = true
      throw new Error('数据库版本高于当前应用，请使用较新版本。')
    }
    let backedUp = false
    if (version === 0) {
      this.db.transaction(() => {
        this.db.exec(`
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
          ${SYNC_TABLES_SQL}
          ${FILES_TABLES_SQL}
          ${RDP_TABLES_SQL}
          PRAGMA user_version = 6;
        `)
      })()
      return
    }
    if (version === 1) {
      if (path !== ':memory:' && existsSync(path)) {
        this.db.pragma('wal_checkpoint(TRUNCATE)')
        copyFileSync(path, `${path}.bak-v1-${Date.now()}`)
        backedUp = true
      }
      this.db.transaction(() => {
        this.db.exec(`
          ALTER TABLE known_hosts ADD COLUMN public_key BLOB;
          ALTER TABLE known_hosts ADD COLUMN trusted_at TEXT;
          ALTER TABLE known_hosts ADD COLUMN source TEXT NOT NULL DEFAULT 'local';
          PRAGMA user_version = 2;
        `)
      })()
      version = 2
    }
    if (version === 2) {
      if (!backedUp && path !== ':memory:' && existsSync(path)) {
        this.db.pragma('wal_checkpoint(TRUNCATE)')
        copyFileSync(path, `${path}.bak-v2-${Date.now()}`)
        backedUp = true
      }
      this.db.transaction(() => {
        this.db.exec(`
          ALTER TABLE hosts ADD COLUMN sync_extras TEXT;
          ALTER TABLE hosts ADD COLUMN account_scope TEXT NOT NULL DEFAULT 'local';
          ${SYNC_TABLES_SQL}
          PRAGMA user_version = 3;
        `)
      })()
      version = 3
    }
    if (version === 3) {
      if (!backedUp && path !== ':memory:' && existsSync(path)) {
        this.db.pragma('wal_checkpoint(TRUNCATE)')
        copyFileSync(path, `${path}.bak-v3-${Date.now()}`)
        backedUp = true
      }
      this.db.transaction(() => {
        this.db.exec(`
          ${FILES_TABLES_SQL}
          PRAGMA user_version = 4;
        `)
      })()
      version = 4
    }
    if (version === 4) {
      if (!backedUp && path !== ':memory:' && existsSync(path)) {
        this.db.pragma('wal_checkpoint(TRUNCATE)')
        copyFileSync(path, `${path}.bak-v4-${Date.now()}`)
        backedUp = true
      }
      this.db.transaction(() => {
        this.db.exec(`
          ${RDP_TABLES_SQL}
          PRAGMA user_version = 5;
        `)
      })()
      version = 5
    }
    if (version === 5) {
      if (!backedUp && path !== ':memory:' && existsSync(path)) {
        this.db.pragma('wal_checkpoint(TRUNCATE)')
        copyFileSync(path, `${path}.bak-v5-${Date.now()}`)
        backedUp = true
      }
      this.db.transaction(() => {
        this.db.exec(`
          ${SYNC_NAMESPACES_SQL}
          PRAGMA user_version = 6;
        `)
      })()
    }
    this.ensureSyncColumns()
  }

  private ensureSyncColumns(): void {
    const cols = this.db.prepare('PRAGMA table_info(sync_accounts)').all() as Array<{ name: string }>
    if (!cols.some((c) => c.name === 'encrypted_vault_key')) {
      this.db.exec('ALTER TABLE sync_accounts ADD COLUMN encrypted_vault_key BLOB')
    }
    if (!cols.some((c) => c.name === 'write_mode')) {
      this.db.exec("ALTER TABLE sync_accounts ADD COLUMN write_mode TEXT NOT NULL DEFAULT 'realtime'")
    }
    if (!cols.some((c) => c.name === 'allow_insecure_http')) {
      this.db.exec('ALTER TABLE sync_accounts ADD COLUMN allow_insecure_http INTEGER NOT NULL DEFAULT 0')
    }
    if (!cols.some((c) => c.name === 'sync_file_credentials')) {
      this.db.exec('ALTER TABLE sync_accounts ADD COLUMN sync_file_credentials INTEGER NOT NULL DEFAULT 0')
    }
    if (!cols.some((c) => c.name === 'sync_rdp_credentials')) {
      this.db.exec('ALTER TABLE sync_accounts ADD COLUMN sync_rdp_credentials INTEGER NOT NULL DEFAULT 0')
    }
    if (!cols.some((c) => c.name === 'sync_protocol_settings')) {
      this.db.exec('ALTER TABLE sync_accounts ADD COLUMN sync_protocol_settings INTEGER NOT NULL DEFAULT 1')
    }
  }

  list(): Host[] {
    return (
      this.stmt('SELECT document, secret IS NOT NULL AS saved FROM hosts ORDER BY rowid DESC').all() as {
        document: string
        saved: number
      }[]
    ).map((row) => {
      const parsed = JSON.parse(row.document) as Host
      return { ...parsed, keepalive: parsed.keepalive ?? 30, hasPassword: Boolean(row.saved) }
    })
  }

  get(id: string): { host: Host; secret?: Uint8Array } {
    const row = this.stmt('SELECT document, secret FROM hosts WHERE id = ?').get(id) as
      | { document: string; secret?: Buffer }
      | undefined
    if (!row) throw new Error('主机已删除，请刷新列表。')
    const parsed = JSON.parse(row.document) as Host
    return {
      host: { ...parsed, keepalive: parsed.keepalive ?? 30, hasPassword: Boolean(row.secret) },
      secret: row.secret
    }
  }

  private markSyncPending(): void {
    this.stmt("UPDATE sync_accounts SET pending_changes = 1 WHERE id = 'primary'").run()
  }

  private markNamespacePending(namespace: 'protocols' | 'settings'): void {
    const now = new Date().toISOString()
    this.stmt(
      `INSERT INTO sync_namespaces (namespace, pending_changes, updated_at)
       VALUES (?, 1, ?)
       ON CONFLICT(namespace) DO UPDATE SET pending_changes = 1, updated_at = excluded.updated_at`
    ).run(namespace, now)
  }

  save(raw: HostInput, encrypted?: Uint8Array): Host[] {
    const input = hostInputSchema.parse(raw)
    const { password: _password, savePassword: _savePassword, clearPassword, ...metadata } = input
    const id = input.id ?? randomUUID()
    const runSave = this.db.transaction(() => {
      const previous = input.id ? this.get(input.id) : undefined
      const secret =
        input.auth !== 'password' || clearPassword
          ? null
          : encrypted
            ? Buffer.from(encrypted)
            : (previous?.secret ?? null)
      const host: Host = {
        ...metadata,
        id,
        hasPassword: Boolean(secret),
        updatedAt: new Date().toISOString()
      }
      try {
        this.stmt(
          'INSERT INTO hosts (id, name, document, secret) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, document=excluded.document, secret=excluded.secret'
        ).run(id, input.name, JSON.stringify(host), secret)
      } catch (error) {
        if ((error as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE')
          throw new Error('主机名称已存在，请使用其他名称。')
        throw error
      }
      this.markSyncPending()
      return this.list()
    })
    return runSave()
  }

  remove(id: string): Host[] {
    this.db.transaction(() => {
      this.stmt('DELETE FROM hosts WHERE id = ?').run(id)
      this.markSyncPending()
    })()
    return this.list()
  }

  updateSecret(id: string, encrypted: Uint8Array): void {
    const result = this.stmt('UPDATE hosts SET secret = ? WHERE id = ?').run(Buffer.from(encrypted), id)
    if (result.changes === 0) throw new Error('主机已删除，无法更新凭据。')
  }

  /* ---------------- multi-protocol file profiles (FTP / FTPS / WebDAV / S3 / SMB) ---------------- */

  fileProfilesList(): FileProfile[] {
    return (
      this.stmt(
        'SELECT document, secret IS NOT NULL AS saved FROM file_profiles ORDER BY rowid DESC'
      ).all() as { document: string; saved: number }[]
    ).map((row) => ({ ...(JSON.parse(row.document) as FileProfile), hasSecrets: Boolean(row.saved) }))
  }

  fileProfileGet(id: string): { profile: FileProfile; secret?: Uint8Array } {
    const row = this.stmt('SELECT document, secret FROM file_profiles WHERE id = ?').get(id) as
      | { document: string; secret?: Buffer | null }
      | undefined
    if (!row) throw new Error('文件服务器配置已删除，请刷新列表。')
    return {
      profile: { ...(JSON.parse(row.document) as FileProfile), hasSecrets: Boolean(row.secret) },
      secret: row.secret ?? undefined
    }
  }

  /**
   * `encrypted` replaces the stored secret blob; when omitted the previous blob is kept unless
   * the input asks to clear it. Secret values never reach this layer in plaintext.
   */
  fileProfileSave(raw: FileProfileInput, encrypted?: Uint8Array): FileProfile[] {
    const input = fileProfileInputSchema.parse(raw)
    const id = input.id ?? randomUUID()
    this.db.transaction(() => {
      const previous = input.id
        ? (this.stmt('SELECT secret FROM file_profiles WHERE id = ?').get(input.id) as
            | { secret?: Buffer | null }
            | undefined)
        : undefined
      if (input.id && !previous) throw new Error('文件服务器配置已删除，请刷新列表。')
      const secret = input.clearSecrets
        ? null
        : encrypted
          ? Buffer.from(encrypted)
          : (previous?.secret ?? null)
      const now = new Date().toISOString()
      const profile: FileProfile = {
        id,
        name: input.name,
        protocol: input.protocol,
        host: input.host,
        port: input.port,
        username: input.username,
        initialPath: input.initialPath,
        notes: input.notes,
        favorite: input.favorite,
        options: input.options,
        hasSecrets: Boolean(secret),
        updatedAt: now
      }
      try {
        this.stmt(
          `INSERT INTO file_profiles (id, name, protocol, document, secret, updated_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name=excluded.name, protocol=excluded.protocol, document=excluded.document, secret=excluded.secret, updated_at=excluded.updated_at`
        ).run(id, input.name, input.protocol, JSON.stringify(profile), secret, now)
      } catch (error) {
        if ((error as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE')
          throw new Error('服务器名称已存在，请使用其他名称。')
        throw error
      }
      this.markNamespacePending('protocols')
    })()
    return this.fileProfilesList()
  }

  fileProfileUpdateSecret(id: string, encrypted: Uint8Array): void {
    const result = this.stmt('UPDATE file_profiles SET secret = ? WHERE id = ?').run(
      Buffer.from(encrypted),
      id
    )
    if (result.changes === 0) throw new Error('文件服务器配置已删除，无法更新凭据。')
  }

  fileProfileRemove(id: string): FileProfile[] {
    this.db.transaction(() => {
      this.stmt('DELETE FROM file_profiles WHERE id = ?').run(id)
      this.markNamespacePending('protocols')
    })()
    return this.fileProfilesList()
  }

  /* ---------------- remote desktop profiles (RDP) & TLS certificate TOFU store ---------------- */

  rdpProfilesList(): RdpProfile[] {
    return (
      this.stmt(
        'SELECT document, secret IS NOT NULL AS saved FROM rdp_profiles ORDER BY rowid DESC'
      ).all() as { document: string; saved: number }[]
    ).map((row) => ({ ...(JSON.parse(row.document) as RdpProfile), hasPassword: Boolean(row.saved) }))
  }

  rdpProfileGet(id: string): { profile: RdpProfile; secret?: Uint8Array } {
    const row = this.stmt('SELECT document, secret FROM rdp_profiles WHERE id = ?').get(id) as
      | { document: string; secret?: Buffer | null }
      | undefined
    if (!row) throw new Error('远程桌面配置已删除，请刷新列表。')
    return {
      profile: { ...(JSON.parse(row.document) as RdpProfile), hasPassword: Boolean(row.secret) },
      secret: row.secret ?? undefined
    }
  }

  /** `encrypted` replaces stored password blob; omitted preserves previous blob unless clearPassword is true. */
  rdpProfileSave(raw: RdpProfileInput, encrypted?: Uint8Array): RdpProfile[] {
    const input = rdpProfileInputSchema.parse(raw)
    const id = input.id ?? randomUUID()
    this.db.transaction(() => {
      const previous = input.id
        ? (this.stmt('SELECT secret FROM rdp_profiles WHERE id = ?').get(input.id) as
            | { secret?: Buffer | null }
            | undefined)
        : undefined
      if (input.id && !previous) throw new Error('远程桌面配置已删除，请刷新列表。')
      const secret = input.clearPassword
        ? null
        : encrypted
          ? Buffer.from(encrypted)
          : (previous?.secret ?? null)
      const now = new Date().toISOString()
      const profile: RdpProfile = {
        id,
        name: input.name,
        host: input.host,
        port: input.port,
        domain: input.domain,
        username: input.username,
        ...(input.linkedHostId ? { linkedHostId: input.linkedHostId } : {}),
        notes: input.notes,
        favorite: input.favorite,
        options: input.options,
        hasPassword: Boolean(secret),
        updatedAt: now
      }
      try {
        this.stmt(
          `INSERT INTO rdp_profiles (id, name, document, secret, updated_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name=excluded.name, document=excluded.document, secret=excluded.secret, updated_at=excluded.updated_at`
        ).run(id, input.name, JSON.stringify(profile), secret, now)
      } catch (error) {
        if ((error as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE')
          throw new Error('远程桌面名称已存在，请使用其他名称。')
        throw error
      }
      this.markNamespacePending('protocols')
    })()
    return this.rdpProfilesList()
  }

  rdpProfileUpdateSecret(id: string, encrypted: Uint8Array): void {
    const result = this.stmt('UPDATE rdp_profiles SET secret = ? WHERE id = ?').run(
      Buffer.from(encrypted),
      id
    )
    if (result.changes === 0) throw new Error('远程桌面配置已删除，无法更新密码。')
  }

  rdpProfileRemove(id: string): RdpProfile[] {
    this.db.transaction(() => {
      this.stmt('DELETE FROM rdp_profiles WHERE id = ?').run(id)
      this.markNamespacePending('protocols')
    })()
    return this.rdpProfilesList()
  }

  rdpKnownHostsList(): KnownRdpHostEntry[] {
    return this.stmt(
      'SELECT id, host, port, fingerprint, subject, issuer, valid_from AS validFrom, valid_to AS validTo, accepted_at AS acceptedAt FROM known_rdp_hosts ORDER BY accepted_at DESC'
    ).all() as KnownRdpHostEntry[]
  }

  rdpKnownHostVerify(
    host: string,
    port: number,
    fingerprint: string
  ): { status: 'unknown' | 'trusted' | 'mismatch'; previousFingerprint?: string } {
    const id = `${host.trim().toLowerCase()}:${port}`
    const row = this.stmt('SELECT fingerprint FROM known_rdp_hosts WHERE id = ?').get(id) as
      | { fingerprint: string }
      | undefined
    if (!row) return { status: 'unknown' }
    if (row.fingerprint.toLowerCase() === fingerprint.toLowerCase()) return { status: 'trusted' }
    return { status: 'mismatch', previousFingerprint: row.fingerprint }
  }

  rdpKnownHostTrust(entry: Omit<KnownRdpHostEntry, 'id' | 'acceptedAt'>): KnownRdpHostEntry[] {
    const host = entry.host.trim()
    const id = `${host.toLowerCase()}:${entry.port}`
    this.db.transaction(() => {
      this.stmt(
        `INSERT INTO known_rdp_hosts (id, host, port, fingerprint, subject, issuer, valid_from, valid_to, accepted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           fingerprint = excluded.fingerprint,
           subject = excluded.subject,
           issuer = excluded.issuer,
           valid_from = excluded.valid_from,
           valid_to = excluded.valid_to,
           accepted_at = excluded.accepted_at`
      ).run(
        id,
        host,
        entry.port,
        entry.fingerprint,
        entry.subject,
        entry.issuer,
        entry.validFrom,
        entry.validTo,
        new Date().toISOString()
      )
      this.markNamespacePending('protocols')
    })()
    return this.rdpKnownHostsList()
  }

  rdpKnownHostRemove(id: string): KnownRdpHostEntry[] {
    this.db.transaction(() => {
      this.stmt('DELETE FROM known_rdp_hosts WHERE id = ?').run(id)
      this.markNamespacePending('protocols')
    })()
    return this.rdpKnownHostsList()
  }

  /* ---------------- protocol-scoped settings ---------------- */

  protocolSettingsAll(): AllProtocolSettings {
    const rows = this.stmt('SELECT namespace, document FROM protocol_settings').all() as {
      namespace: string
      document: string
    }[]
    const stored = new Map<string, unknown>()
    for (const row of rows) {
      try {
        stored.set(row.namespace, JSON.parse(row.document))
      } catch {
        /* corrupt document -> defaults */
      }
    }
    return {
      ssh: normalizeProtocolSettings('ssh', stored.get('ssh')),
      files: normalizeProtocolSettings('files', stored.get('files')),
      rdp: normalizeProtocolSettings('rdp', stored.get('rdp'))
    }
  }

  protocolSettingsPatch<N extends ProtocolNamespace>(
    namespace: N,
    patch: Partial<ProtocolSettingsMap[N]>
  ): AllProtocolSettings {
    if (!PROTOCOL_NAMESPACES.includes(namespace)) throw new Error('未知的设置分类')
    const schema = protocolSettingsSchemas[namespace] as unknown as {
      partial(): { parse(value: unknown): Record<string, unknown> }
    }
    const checked = schema.partial().parse(patch)
    this.db.transaction(() => {
      const current = this.protocolSettingsAll()[namespace] as unknown as Record<string, unknown>
      const next = normalizeProtocolSettings(namespace, { ...current, ...checked })
      this.stmt(
        `INSERT INTO protocol_settings (namespace, document, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(namespace) DO UPDATE SET document=excluded.document, updated_at=excluded.updated_at`
      ).run(namespace, JSON.stringify(next), new Date().toISOString())
      this.markNamespacePending('settings')
    })()
    return this.protocolSettingsAll()
  }

  known(
    address: string,
    port: number
  ): { fingerprint: string; algorithm: string; trustedAt?: string; source: string } | undefined {
    return this.stmt(
      'SELECT fingerprint, algorithm, trusted_at AS trustedAt, source FROM known_hosts WHERE address = ? AND port = ?'
    ).get(address, port) as
      | { fingerprint: string; algorithm: string; trustedAt?: string; source: string }
      | undefined
  }

  trust(
    address: string,
    port: number,
    fingerprint: string,
    algorithm: string,
    publicKey?: Uint8Array,
    source = 'local'
  ): void {
    this.stmt(
      `INSERT INTO known_hosts (address, port, fingerprint, algorithm, public_key, trusted_at, source)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(address, port) DO UPDATE SET
           fingerprint = excluded.fingerprint,
           algorithm = excluded.algorithm,
           public_key = excluded.public_key,
           trusted_at = excluded.trusted_at,
           source = excluded.source`
    ).run(
      address,
      port,
      fingerprint,
      algorithm,
      publicKey ? Buffer.from(publicKey) : null,
      new Date().toISOString(),
      source
    )
  }

  knownHostsList(): KnownHostEntry[] {
    const rows = this.stmt(
      'SELECT address, port, fingerprint, trusted_at AS trustedAt FROM known_hosts ORDER BY trusted_at DESC'
    ).all() as Array<{ address: string; port: number; fingerprint: string; trustedAt?: string }>
    return rows.map((row) => ({
      hostKey: `${row.address}:${row.port}`,
      fingerprint: row.fingerprint,
      updatedAt: row.trustedAt ? Date.parse(row.trustedAt) || Date.now() : Date.now()
    }))
  }

  knownHostsRemove(hostKey: string): KnownHostEntry[] {
    const lastColon = hostKey.lastIndexOf(':')
    if (lastColon > 0) {
      const address = hostKey.slice(0, lastColon)
      const port = Number(hostKey.slice(lastColon + 1))
      if (Number.isInteger(port)) {
        this.stmt('DELETE FROM known_hosts WHERE address = ? AND port = ?').run(address, port)
      }
    }
    return this.knownHostsList()
  }

  groupsList(): SyncGroup[] {
    return this.stmt(
      'SELECT id, name, color, updated_at AS updatedAt FROM groups ORDER BY name COLLATE NOCASE'
    ).all() as SyncGroup[]
  }

  groupSave(raw: SyncGroupInput): SyncGroup[] {
    const input = syncGroupInputSchema.parse(raw)
    const id = input.id ?? randomUUID()
    const updatedAt = new Date().toISOString()
    this.db.transaction(() => {
      this.stmt(
        `INSERT INTO groups (id, name, color, updated_at, account_scope)
           VALUES (?, ?, ?, ?, 'sync')
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             color = excluded.color,
             updated_at = excluded.updated_at`
      ).run(id, input.name, input.color, updatedAt)
      this.markSyncPending()
    })()
    return this.groupsList()
  }

  groupRemove(id: string): SyncGroup[] {
    this.db.transaction(() => {
      this.stmt('UPDATE tunnels SET group_id = NULL WHERE group_id = ?').run(id)
      this.stmt('DELETE FROM groups WHERE id = ?').run(id)
      this.markSyncPending()
    })()
    return this.groupsList()
  }

  tunnelsList(): SyncTunnel[] {
    const rows = this.stmt(
      `SELECT id, name, server_id, group_id, type, listen_host, listen_port, dest_host, dest_port,
                dest_server_id, auto_reconnect, enabled, updated_at
         FROM tunnels ORDER BY name COLLATE NOCASE`
    ).all() as Array<{
      id: string
      name: string
      server_id: string
      group_id: string | null
      type: string
      listen_host: string
      listen_port: number
      dest_host: string
      dest_port: number
      dest_server_id: string | null
      auto_reconnect: number
      enabled: number
      updated_at: string
    }>
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      serverId: row.server_id,
      groupId: row.group_id,
      type: row.type,
      listenHost: row.listen_host,
      listenPort: row.listen_port,
      destHost: row.dest_host,
      destPort: row.dest_port,
      destServerId: row.dest_server_id,
      autoReconnect: Boolean(row.auto_reconnect),
      enabled: Boolean(row.enabled),
      readOnly: row.type !== 'L' && row.type !== 'R' && row.type !== 'D',
      updatedAt: row.updated_at
    }))
  }

  tunnelSave(raw: SyncTunnelInput): SyncTunnel[] {
    const input = syncTunnelInputSchema.parse(raw)
    const id = input.id ?? randomUUID()
    const updatedAt = new Date().toISOString()
    this.db.transaction(() => {
      if (input.id) {
        const existing = this.stmt('SELECT type FROM tunnels WHERE id = ?').get(input.id) as
          | { type: string }
          | undefined
        if (existing && existing.type !== 'L' && existing.type !== 'R' && existing.type !== 'D') {
          throw new Error('该隧道为其他客户端写入的未知只读类型，当前版本仅保留不修改。')
        }
      }
      const serverExists = this.stmt('SELECT 1 FROM hosts WHERE id = ?').get(input.serverId)
      if (!serverExists) throw new Error('关联的 SSH 主机不存在，请先创建或选择有效主机。')
      if (input.groupId) {
        const groupExists = this.stmt('SELECT 1 FROM groups WHERE id = ?').get(input.groupId)
        if (!groupExists) throw new Error('关联的分组不存在。')
      }
      this.stmt(
        `INSERT INTO tunnels (
             id, name, server_id, group_id, type, listen_host, listen_port, dest_host, dest_port,
             dest_server_id, auto_reconnect, enabled, updated_at, account_scope
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sync')
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             server_id = excluded.server_id,
             group_id = excluded.group_id,
             type = excluded.type,
             listen_host = excluded.listen_host,
             listen_port = excluded.listen_port,
             dest_host = excluded.dest_host,
             dest_port = excluded.dest_port,
             dest_server_id = excluded.dest_server_id,
             auto_reconnect = excluded.auto_reconnect,
             enabled = excluded.enabled,
             updated_at = excluded.updated_at`
      ).run(
        id,
        input.name,
        input.serverId,
        input.groupId ?? null,
        input.type,
        input.listenHost,
        input.listenPort,
        input.destHost,
        input.destPort,
        input.destServerId ?? null,
        input.autoReconnect ? 1 : 0,
        input.enabled ? 1 : 0,
        updatedAt
      )
      this.markSyncPending()
    })()
    return this.tunnelsList()
  }

  tunnelRemove(id: string): SyncTunnel[] {
    this.db.transaction(() => {
      this.stmt('DELETE FROM tunnels WHERE id = ?').run(id)
      this.markSyncPending()
    })()
    return this.tunnelsList()
  }

  syncAccountGet(id = 'primary'): SyncAccountRecord | undefined {
    const row = this.stmt('SELECT * FROM sync_accounts WHERE id = ?').get(id) as
      | {
          id: string
          server_url: string
          email: string
          remember_email: number
          keep_signed_in: number
          auto_sync: number
          write_mode?: string | null
          allow_insecure_http?: number | null
          encrypted_refresh_token: Buffer | null
          encrypted_vault_key?: Buffer | null
          device_id: string
          device_name: string
          vault_id: string | null
          key_version: number
          sync_passwords: number
          sync_private_keys: number
          sync_file_credentials?: number | null
          sync_rdp_credentials?: number | null
          sync_protocol_settings?: number | null
          last_revision: string | null
          last_etag: string | null
          last_sync_at: string | null
          base_doc_cipher: Buffer | null
          pending_changes: number
          read_only_remote_schema: number
          remote_schema_version: number | null
          doc_extra: string | null
          updated_at: string
        }
      | undefined
    if (!row) return undefined
    return {
      id: row.id,
      serverUrl: row.server_url,
      email: row.email,
      rememberEmail: Boolean(row.remember_email),
      keepSignedIn: Boolean(row.keep_signed_in),
      autoSync: Boolean(row.auto_sync),
      writeMode: row.write_mode === 'local-only' ? 'local-only' : 'realtime',
      allowInsecureHttp: Boolean(row.allow_insecure_http),
      encryptedRefreshToken: row.encrypted_refresh_token ?? undefined,
      encryptedVaultKey: row.encrypted_vault_key ?? undefined,
      deviceId: row.device_id,
      deviceName: row.device_name,
      vaultId: row.vault_id,
      keyVersion: row.key_version,
      syncPasswords: Boolean(row.sync_passwords),
      syncPrivateKeys: Boolean(row.sync_private_keys),
      syncFileCredentials: Boolean(row.sync_file_credentials),
      syncRdpCredentials: Boolean(row.sync_rdp_credentials),
      syncProtocolSettings: row.sync_protocol_settings !== 0,
      lastRevision: row.last_revision,
      lastEtag: row.last_etag,
      lastSyncAt: row.last_sync_at,
      baseDocCipher: row.base_doc_cipher ?? undefined,
      pendingChanges: Boolean(row.pending_changes),
      readOnlyRemoteSchema: Boolean(row.read_only_remote_schema),
      remoteSchemaVersion: row.remote_schema_version ?? undefined,
      docExtra: row.doc_extra ? (JSON.parse(row.doc_extra) as Record<string, unknown>) : undefined,
      updatedAt: row.updated_at
    }
  }

  syncAccountUpsert(patch: {
    id?: string
    serverUrl: string
    email: string
    rememberEmail: boolean
    keepSignedIn: boolean
    autoSync: boolean
    writeMode?: 'realtime' | 'local-only'
    allowInsecureHttp?: boolean
    encryptedRefreshToken?: Uint8Array | null
    encryptedVaultKey?: Uint8Array | null
    deviceId: string
    deviceName: string
    vaultId?: string | null
    keyVersion?: number
    syncPasswords?: boolean
    syncPrivateKeys?: boolean
    syncFileCredentials?: boolean
    syncRdpCredentials?: boolean
    syncProtocolSettings?: boolean
    lastRevision?: string | null
    lastEtag?: string | null
    lastSyncAt?: string | null
    baseDocCipher?: Uint8Array | null
    pendingChanges?: boolean
    readOnlyRemoteSchema?: boolean
    remoteSchemaVersion?: number | null
    docExtra?: Record<string, unknown> | null
    resetSyncCursor?: boolean
  }): SyncAccountRecord {
    const id = patch.id ?? 'primary'
    const existing = this.syncAccountGet(id)
    const resetCursor = Boolean(patch.resetSyncCursor)
    const nextToken =
      patch.encryptedRefreshToken !== undefined
        ? patch.encryptedRefreshToken
          ? Buffer.from(patch.encryptedRefreshToken)
          : null
        : existing?.encryptedRefreshToken
          ? Buffer.from(existing.encryptedRefreshToken)
          : null
    const nextVaultKey =
      patch.encryptedVaultKey !== undefined
        ? patch.encryptedVaultKey
          ? Buffer.from(patch.encryptedVaultKey)
          : null
        : existing?.encryptedVaultKey
          ? Buffer.from(existing.encryptedVaultKey)
          : null
    const nextWriteMode: 'realtime' | 'local-only' = patch.writeMode ?? existing?.writeMode ?? 'realtime'
    const nextAllowInsecureHttp =
      patch.allowInsecureHttp !== undefined ? patch.allowInsecureHttp : (existing?.allowInsecureHttp ?? false)
    const nextBase = resetCursor
      ? null
      : patch.baseDocCipher !== undefined
        ? patch.baseDocCipher
          ? Buffer.from(patch.baseDocCipher)
          : null
        : existing?.baseDocCipher
          ? Buffer.from(existing.baseDocCipher)
          : null
    const updatedAt = new Date().toISOString()

    this.db.transaction(() => {
      this.stmt(
        `INSERT INTO sync_accounts (
           id, server_url, email, remember_email, keep_signed_in, auto_sync, write_mode, allow_insecure_http,
           encrypted_refresh_token, encrypted_vault_key, device_id, device_name, vault_id, key_version,
           sync_passwords, sync_private_keys, sync_file_credentials, sync_rdp_credentials, sync_protocol_settings,
           last_revision, last_etag, last_sync_at,
           base_doc_cipher, pending_changes, read_only_remote_schema, remote_schema_version,
           doc_extra, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           server_url = excluded.server_url,
           email = excluded.email,
           remember_email = excluded.remember_email,
           keep_signed_in = excluded.keep_signed_in,
           auto_sync = excluded.auto_sync,
           write_mode = excluded.write_mode,
           allow_insecure_http = excluded.allow_insecure_http,
           encrypted_refresh_token = excluded.encrypted_refresh_token,
           encrypted_vault_key = excluded.encrypted_vault_key,
           device_id = excluded.device_id,
           device_name = excluded.device_name,
           vault_id = excluded.vault_id,
           key_version = excluded.key_version,
           sync_passwords = excluded.sync_passwords,
           sync_private_keys = excluded.sync_private_keys,
           sync_file_credentials = excluded.sync_file_credentials,
           sync_rdp_credentials = excluded.sync_rdp_credentials,
           sync_protocol_settings = excluded.sync_protocol_settings,
           last_revision = excluded.last_revision,
           last_etag = excluded.last_etag,
           last_sync_at = excluded.last_sync_at,
           base_doc_cipher = excluded.base_doc_cipher,
           pending_changes = excluded.pending_changes,
           read_only_remote_schema = excluded.read_only_remote_schema,
           remote_schema_version = excluded.remote_schema_version,
           doc_extra = excluded.doc_extra,
           updated_at = excluded.updated_at`
      ).run(
        id,
        patch.serverUrl,
        patch.email,
        patch.rememberEmail ? 1 : 0,
        patch.keepSignedIn ? 1 : 0,
        patch.autoSync ? 1 : 0,
        nextWriteMode,
        nextAllowInsecureHttp ? 1 : 0,
        nextToken,
        nextVaultKey,
        patch.deviceId,
        patch.deviceName,
        patch.vaultId !== undefined ? patch.vaultId : (existing?.vaultId ?? null),
        patch.keyVersion ?? existing?.keyVersion ?? 1,
        (patch.syncPasswords ?? existing?.syncPasswords ?? false) ? 1 : 0,
        (patch.syncPrivateKeys ?? existing?.syncPrivateKeys ?? false) ? 1 : 0,
        (patch.syncFileCredentials ?? existing?.syncFileCredentials ?? false) ? 1 : 0,
        (patch.syncRdpCredentials ?? existing?.syncRdpCredentials ?? false) ? 1 : 0,
        (patch.syncProtocolSettings ?? existing?.syncProtocolSettings ?? true) ? 1 : 0,
        resetCursor
          ? null
          : patch.lastRevision !== undefined
            ? patch.lastRevision
            : (existing?.lastRevision ?? null),
        resetCursor ? null : patch.lastEtag !== undefined ? patch.lastEtag : (existing?.lastEtag ?? null),
        resetCursor
          ? null
          : patch.lastSyncAt !== undefined
            ? patch.lastSyncAt
            : (existing?.lastSyncAt ?? null),
        nextBase,
        (patch.pendingChanges ?? existing?.pendingChanges ?? false) ? 1 : 0,
        (resetCursor ? false : (patch.readOnlyRemoteSchema ?? existing?.readOnlyRemoteSchema ?? false))
          ? 1
          : 0,
        resetCursor
          ? null
          : patch.remoteSchemaVersion !== undefined
            ? patch.remoteSchemaVersion
            : (existing?.remoteSchemaVersion ?? null),
        resetCursor
          ? null
          : patch.docExtra !== undefined
            ? patch.docExtra
              ? JSON.stringify(patch.docExtra)
              : null
            : existing?.docExtra
              ? JSON.stringify(existing.docExtra)
              : null,
        updatedAt
      )
      if (resetCursor) {
        this.stmt('DELETE FROM sync_namespaces').run()
      }
    })()
    return this.syncAccountGet(id)!
  }

  syncAccountClearAuth(opts: { id?: string; clearEmail?: boolean } = {}): SyncAccountRecord | undefined {
    const id = opts.id ?? 'primary'
    this.vaultLock(id)
    const existing = this.syncAccountGet(id)
    if (!existing) return undefined
    const clearEmail = opts.clearEmail ?? !existing.rememberEmail
    this.stmt(
      `UPDATE sync_accounts
         SET encrypted_refresh_token = NULL,
             encrypted_vault_key = NULL,
             keep_signed_in = 0,
             email = CASE WHEN ? THEN '' ELSE email END,
             updated_at = ?
         WHERE id = ?`
    ).run(clearEmail ? 1 : 0, new Date().toISOString(), id)
    return this.syncAccountGet(id)
  }

  syncListSecretBlobs(): Array<{ id: string; secret: Uint8Array }> {
    return this.stmt('SELECT id, secret FROM hosts WHERE secret IS NOT NULL').all() as Array<{
      id: string
      secret: Buffer
    }>
  }

  vaultHasUnlockedKey(accountId = 'primary'): boolean {
    return this.vaultKeys.has(accountId)
  }

  vaultExportKey(accountId = 'primary'): string | null {
    const key = this.vaultKeys.get(accountId)
    return key ? key.toString('base64') : null
  }

  vaultRestoreKey(input: { accountId?: string; rawKeyBase64: string }): boolean {
    const accountId = input.accountId ?? 'primary'
    const buf = Buffer.from(input.rawKeyBase64, 'base64')
    if (buf.length !== 32) return false
    this.vaultLock(accountId)
    this.vaultKeys.set(accountId, buf)
    return true
  }

  vaultLock(accountId = 'primary'): void {
    const key = this.vaultKeys.get(accountId)
    if (key) {
      key.fill(0)
      this.vaultKeys.delete(accountId)
    }
    const pending = this.pendingRotatedKeys.get(accountId)
    if (pending) {
      pending.key.fill(0)
      this.pendingRotatedKeys.delete(accountId)
    }
  }

  async vaultCreate(input: {
    accountId?: string
    keyVersion: number
    masterPassword: string
  }): Promise<{ envelope: VaultMetadataWire; recoveryKey: string }> {
    const accountId = input.accountId ?? 'primary'
    const created = await createVaultMaterial(input.keyVersion, input.masterPassword)
    this.vaultLock(accountId)
    this.vaultKeys.set(accountId, created.vaultKey)
    return { envelope: created.envelope, recoveryKey: created.recoveryKey }
  }

  async vaultUnlock(input: {
    accountId?: string
    metadata: VaultMetadataWire
    masterPassword: string
  }): Promise<boolean> {
    const accountId = input.accountId ?? 'primary'
    const key = await unlockVaultWithPassword(input.metadata, input.masterPassword)
    this.vaultLock(accountId)
    this.vaultKeys.set(accountId, key)
    const vaultId = input.metadata.id ?? this.syncAccountGet(accountId)?.vaultId ?? null
    this.stmt('UPDATE sync_accounts SET vault_id = ?, key_version = ?, updated_at = ? WHERE id = ?').run(
      vaultId,
      input.metadata.keyVersion,
      new Date().toISOString(),
      accountId
    )
    return true
  }

  async vaultRecover(input: {
    accountId?: string
    metadata: VaultMetadataWire
    recoveryKey: string
    newMasterPassword?: string
  }): Promise<{ updatedEnvelope?: VaultMetadataWire }> {
    const accountId = input.accountId ?? 'primary'
    const res = await recoverVaultWithKey(input.metadata, input.recoveryKey, input.newMasterPassword)
    this.vaultLock(accountId)
    this.vaultKeys.set(accountId, res.vaultKey)
    const vaultId = input.metadata.id ?? this.syncAccountGet(accountId)?.vaultId ?? null
    this.stmt('UPDATE sync_accounts SET vault_id = ?, key_version = ?, updated_at = ? WHERE id = ?').run(
      vaultId,
      input.metadata.keyVersion,
      new Date().toISOString(),
      accountId
    )
    return { updatedEnvelope: res.updatedEnvelope }
  }

  private buildLocalSyncSource(
    plaintextPasswords: Record<string, string>,
    overridePreferences?: { syncPasswords: boolean; syncPrivateKeys: boolean },
    accountId = 'primary'
  ): LocalSyncSource {
    const account = this.syncAccountGet(accountId)
    const hostRows = this.stmt(
      'SELECT document, secret IS NOT NULL AS saved, sync_extras FROM hosts ORDER BY name COLLATE NOCASE'
    ).all() as Array<{ document: string; saved: number; sync_extras: string | null }>
    const hosts = hostRows.map((row) => {
      const parsed = JSON.parse(row.document) as Host
      const syncExtras = row.sync_extras ? (JSON.parse(row.sync_extras) as HostSyncExtras) : undefined
      return {
        ...parsed,
        keepalive: parsed.keepalive ?? 30,
        hasPassword: Boolean(row.saved),
        syncExtras
      }
    })
    const knownRows = this.stmt('SELECT address, port, fingerprint FROM known_hosts').all() as Array<{
      address: string
      port: number
      fingerprint: string
    }>
    const knownFingerprints: Record<string, string> = {}
    for (const row of knownRows) {
      knownFingerprints[`${row.address}:${row.port}`] = row.fingerprint
    }

    const groups = this.groupsList()
    const groupExtras: Record<string, Record<string, unknown>> = {}
    for (const row of this.stmt(
      'SELECT id, unknown_extra FROM groups WHERE unknown_extra IS NOT NULL'
    ).all() as Array<{
      id: string
      unknown_extra: string
    }>) {
      groupExtras[row.id] = JSON.parse(row.unknown_extra) as Record<string, unknown>
    }

    const tunnels = this.tunnelsList()
    const tunnelExtras: Record<string, Record<string, unknown>> = {}
    for (const row of this.stmt(
      'SELECT id, unknown_extra FROM tunnels WHERE unknown_extra IS NOT NULL'
    ).all() as Array<{
      id: string
      unknown_extra: string
    }>) {
      tunnelExtras[row.id] = JSON.parse(row.unknown_extra) as Record<string, unknown>
    }

    return {
      hosts,
      plaintextPasswords,
      knownFingerprints,
      groups,
      tunnels,
      tunnelExtras,
      groupExtras,
      preferences: overridePreferences ?? {
        syncPasswords: account?.syncPasswords ?? false,
        syncPrivateKeys: account?.syncPrivateKeys ?? false
      },
      docExtra: account?.docExtra
    }
  }

  syncEvaluateRemoteAndMerge(input: {
    accountId?: string
    plaintextPasswords: Record<string, string>
    baseDocJson?: string | null
    remoteEnvelope?: SyncDocumentEnvelope | null
    resolutions?: Record<string, 'local' | 'remote'>
  }): SyncEvaluateOutput {
    const accountId = input.accountId ?? 'primary'
    const vaultKey = this.vaultKeys.get(accountId)
    if (!vaultKey) throw new Error('保管库未解锁，请先输入主密码解锁')
    const account = this.syncAccountGet(accountId)
    if (!account?.vaultId) throw new Error('同步账号尚未绑定保管库')

    let remoteDoc: SyncDocumentV1 | null = null
    if (input.remoteEnvelope) {
      const decrypted = decryptSyncDocument(vaultKey, account.vaultId, input.remoteEnvelope)
      if (decrypted.readOnlySchema) {
        this.stmt(
          'UPDATE sync_accounts SET read_only_remote_schema = 1, remote_schema_version = ?, updated_at = ? WHERE id = ?'
        ).run(decrypted.schemaVersion, new Date().toISOString(), accountId)
        return {
          readOnlySchema: true,
          remoteSchemaVersion: decrypted.schemaVersion,
          conflicts: [],
          needsUpload: false,
          hostSecretsToEncrypt: [],
          localHostUpdates: [],
          deletedHostIds: [],
          localGroups: [],
          localTunnels: [],
          nextPreferences: {
            syncPasswords: account.syncPasswords,
            syncPrivateKeys: account.syncPrivateKeys
          },
          remoteHostFingerprints: []
        }
      }
      remoteDoc = normalizeRemoteDocument(decrypted.rawDocument)
    }

    let baseDoc: SyncDocumentV1 | null = null
    if (input.baseDocJson) {
      const parsedBase = JSON.parse(input.baseDocJson) as Record<string, unknown>
      baseDoc = normalizeRemoteDocument(parsedBase)
    }

    const localSource = this.buildLocalSyncSource(input.plaintextPasswords, undefined, accountId)
    const merge = threeWayMerge({
      localSource,
      baseDoc,
      remoteDoc,
      resolutions: input.resolutions
    })

    if (merge.conflicts.length > 0) {
      return {
        readOnlySchema: false,
        conflicts: merge.conflicts,
        needsUpload: false,
        hostSecretsToEncrypt: [],
        localHostUpdates: [],
        deletedHostIds: [],
        localGroups: [],
        localTunnels: [],
        nextPreferences: merge.nextPreferences,
        remoteHostFingerprints: []
      }
    }

    const uploadEnvelope = merge.needsUpload
      ? encryptSyncDocument(vaultKey, account.vaultId, account.keyVersion, merge.merged)
      : undefined
    const hostSecretsToEncrypt = merge.localHostUpdates
      .filter((item) => item.passwordTouched)
      .map((item) => ({
        hostId: item.host.id,
        password: item.plaintextPassword ?? null
      }))

    const docExtraKeys = Object.keys(merge.merged).filter(
      (k) => !['schemaVersion', 'updatedAt', 'preferences', 'servers', 'tunnels', 'groups'].includes(k)
    )
    const docExtra: Record<string, unknown> | undefined = docExtraKeys.length
      ? Object.fromEntries(docExtraKeys.map((k) => [k, merge.merged[k]]))
      : undefined

    return {
      readOnlySchema: false,
      conflicts: [],
      needsUpload: merge.needsUpload,
      uploadEnvelope,
      mergedBaseJson: JSON.stringify(merge.merged),
      hostSecretsToEncrypt,
      localHostUpdates: merge.localHostUpdates,
      deletedHostIds: merge.deletedHostIds,
      localGroups: merge.localGroups,
      localTunnels: merge.localTunnels,
      nextPreferences: merge.nextPreferences,
      remoteHostFingerprints: merge.remoteHostFingerprints,
      docExtra
    }
  }

  async syncPrepareRotate(input: {
    accountId?: string
    newKeyVersion: number
    masterPassword: string
    syncPasswords: boolean
    plaintextPasswords: Record<string, string>
  }): Promise<{
    recoveryKey: string
    keyEnvelope: VaultMetadataWire
    reencryptedEnvelope: SyncDocumentEnvelope
    nextBaseDocJson: string
  }> {
    const accountId = input.accountId ?? 'primary'
    const account = this.syncAccountGet(accountId)
    if (!account?.vaultId) throw new Error('尚未创建或关联保管库')
    const materials = await rotateVaultKeyMaterials(input.newKeyVersion, input.masterPassword)
    const source = this.buildLocalSyncSource(
      input.plaintextPasswords,
      { syncPasswords: input.syncPasswords, syncPrivateKeys: account.syncPrivateKeys },
      accountId
    )
    const doc = threeWayMerge({
      localSource: source,
      baseDoc: null,
      remoteDoc: null
    }).merged
    doc.preferences.syncPasswords = input.syncPasswords
    if (!input.syncPasswords) {
      doc.servers = doc.servers.map((server) => {
        if (!server.secrets) return server
        const nextSecrets = { ...server.secrets }
        delete nextSecrets.password
        delete nextSecrets.passphrase
        const next = { ...server }
        if (Object.keys(nextSecrets).length > 0) next.secrets = nextSecrets
        else delete next.secrets
        return next
      })
    }
    const reencryptedEnvelope = encryptSyncDocument(
      materials.vaultKey,
      account.vaultId,
      input.newKeyVersion,
      doc
    )
    const oldPending = this.pendingRotatedKeys.get(accountId)
    if (oldPending) oldPending.key.fill(0)
    this.pendingRotatedKeys.set(accountId, { keyVersion: input.newKeyVersion, key: materials.vaultKey })
    return {
      recoveryKey: materials.recoveryKey,
      keyEnvelope: materials.envelope,
      reencryptedEnvelope,
      nextBaseDocJson: JSON.stringify(doc)
    }
  }

  syncCommitRotate(input: {
    accountId?: string
    keyVersion: number
    syncPasswords: boolean
    revision: string
    etag: string | null
    baseDocCipher: Uint8Array
  }): void {
    const accountId = input.accountId ?? 'primary'
    const pending = this.pendingRotatedKeys.get(accountId)
    if (!pending || pending.keyVersion !== input.keyVersion) {
      throw new Error('轮换密钥会话不存在或已过期')
    }
    const oldKey = this.vaultKeys.get(accountId)
    if (oldKey) oldKey.fill(0)
    this.vaultKeys.set(accountId, pending.key)
    this.pendingRotatedKeys.delete(accountId)
    this.stmt(
      `UPDATE sync_accounts
         SET key_version = ?, sync_passwords = ?, last_revision = ?, last_etag = ?,
             last_sync_at = ?, base_doc_cipher = ?, pending_changes = 0, updated_at = ?
         WHERE id = ?`
    ).run(
      input.keyVersion,
      input.syncPasswords ? 1 : 0,
      input.revision,
      input.etag,
      new Date().toISOString(),
      Buffer.from(input.baseDocCipher),
      new Date().toISOString(),
      accountId
    )
  }

  syncCancelRotate(accountId = 'primary'): void {
    const pending = this.pendingRotatedKeys.get(accountId)
    if (pending) {
      pending.key.fill(0)
      this.pendingRotatedKeys.delete(accountId)
    }
  }

  syncEvaluateRevisionRestore(input: {
    accountId?: string
    plaintextPasswords: Record<string, string>
    revisionEnvelope: SyncDocumentEnvelope
  }): SyncEvaluateOutput {
    const accountId = input.accountId ?? 'primary'
    const vaultKey = this.vaultKeys.get(accountId)
    if (!vaultKey) throw new Error('保管库未解锁')
    const account = this.syncAccountGet(accountId)
    if (!account?.vaultId) throw new Error('同步账号尚未绑定保管库')
    const decrypted = decryptSyncDocument(vaultKey, account.vaultId, input.revisionEnvelope)
    if (decrypted.readOnlySchema) {
      throw new Error(`历史版本 schemaVersion=${decrypted.schemaVersion} 高于当前客户端版本，无法回滚恢复。`)
    }
    const remoteDoc = normalizeRemoteDocument(decrypted.rawDocument)
    const localSource = this.buildLocalSyncSource(input.plaintextPasswords, undefined, accountId)
    // Force full restore by treating current local entities missing in archive as deleted cleanly
    const currentLocalDoc = threeWayMerge({ localSource, baseDoc: null, remoteDoc: null }).merged
    const merge = threeWayMerge({
      localSource,
      baseDoc: currentLocalDoc,
      remoteDoc
    })
    const hostSecretsToEncrypt = merge.localHostUpdates
      .filter((item) => item.passwordTouched)
      .map((item) => ({
        hostId: item.host.id,
        password: item.plaintextPassword ?? null
      }))
    return {
      readOnlySchema: false,
      conflicts: [],
      needsUpload: false,
      mergedBaseJson: JSON.stringify(merge.merged),
      hostSecretsToEncrypt,
      localHostUpdates: merge.localHostUpdates,
      deletedHostIds: merge.deletedHostIds,
      localGroups: merge.localGroups,
      localTunnels: merge.localTunnels,
      nextPreferences: merge.nextPreferences,
      remoteHostFingerprints: merge.remoteHostFingerprints
    }
  }

  syncCommitApplied(input: {
    accountId?: string
    localHostUpdates: LocalMergedHost[]
    encryptedHostSecrets: Record<string, Uint8Array | null>
    deletedHostIds: string[]
    localGroups: Array<SyncGroup & { unknownExtra?: Record<string, unknown> }>
    localTunnels: Array<SyncTunnel & { unknownExtra?: Record<string, unknown> }>
    nextPreferences: { syncPasswords: boolean; syncPrivateKeys: boolean }
    remoteHostFingerprints: Array<{ address: string; port: number; fingerprint: string }>
    revision: string | null
    etag: string | null
    baseDocCipher: Uint8Array | null
    docExtra?: Record<string, unknown>
  }): { hosts: Host[]; groups: SyncGroup[]; tunnels: SyncTunnel[] } {
    const accountId = input.accountId ?? 'primary'
    const nowIso = new Date().toISOString()

    this.db.transaction(() => {
      for (const deletedId of input.deletedHostIds) {
        this.stmt('DELETE FROM hosts WHERE id = ?').run(deletedId)
      }

      const selectExisting = this.stmt('SELECT id, secret FROM hosts WHERE id = ?')
      const selectByName = this.stmt('SELECT id FROM hosts WHERE name = ? COLLATE NOCASE AND id != ?')
      const upsertHost = this.stmt(
        `INSERT INTO hosts (id, name, document, secret, sync_extras, account_scope)
         VALUES (?, ?, ?, ?, ?, 'sync')
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           document = excluded.document,
           secret = excluded.secret,
           sync_extras = excluded.sync_extras,
           account_scope = excluded.account_scope`
      )

      for (const entry of input.localHostUpdates) {
        const existing = selectExisting.get(entry.host.id) as
          | { id: string; secret: Buffer | null }
          | undefined
        const hasOverride = Object.prototype.hasOwnProperty.call(input.encryptedHostSecrets, entry.host.id)
        const nextSecret = hasOverride
          ? input.encryptedHostSecrets[entry.host.id]
            ? Buffer.from(input.encryptedHostSecrets[entry.host.id]!)
            : null
          : (existing?.secret ?? null)

        let candidateName = entry.host.name
        const conflict = selectByName.get(candidateName, entry.host.id) as { id: string } | undefined
        if (conflict) {
          candidateName = `${entry.host.name.slice(0, 70)} (${entry.host.id.slice(0, 4)})`
        }
        const hostDoc: Host = {
          ...entry.host,
          name: candidateName,
          hasPassword: Boolean(nextSecret)
        }
        upsertHost.run(
          hostDoc.id,
          hostDoc.name,
          JSON.stringify(hostDoc),
          nextSecret,
          entry.syncExtras ? JSON.stringify(entry.syncExtras) : null
        )
      }

      this.stmt('DELETE FROM tunnels').run()
      this.stmt('DELETE FROM groups').run()
      const insertGroup = this.stmt(
        `INSERT INTO groups (id, name, color, updated_at, unknown_extra, account_scope)
         VALUES (?, ?, ?, ?, ?, 'sync')`
      )
      for (const group of input.localGroups) {
        insertGroup.run(
          group.id,
          group.name,
          group.color,
          group.updatedAt,
          group.unknownExtra ? JSON.stringify(group.unknownExtra) : null
        )
      }
      const insertTunnel = this.stmt(
        `INSERT INTO tunnels (
           id, name, server_id, group_id, type, listen_host, listen_port, dest_host, dest_port,
           dest_server_id, auto_reconnect, enabled, updated_at, unknown_extra, account_scope
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sync')`
      )
      for (const tunnel of input.localTunnels) {
        insertTunnel.run(
          tunnel.id,
          tunnel.name,
          tunnel.serverId,
          tunnel.groupId ?? null,
          tunnel.type,
          tunnel.listenHost,
          tunnel.listenPort,
          tunnel.destHost,
          tunnel.destPort,
          tunnel.destServerId ?? null,
          tunnel.autoReconnect ? 1 : 0,
          tunnel.enabled ? 1 : 0,
          tunnel.updatedAt,
          tunnel.unknownExtra ? JSON.stringify(tunnel.unknownExtra) : null
        )
      }

      const checkKnown = this.stmt('SELECT 1 FROM known_hosts WHERE address = ? AND port = ?')
      const insertKnown = this.stmt(
        `INSERT INTO known_hosts (address, port, fingerprint, algorithm, public_key, trusted_at, source)
         VALUES (?, ?, ?, 'sync', NULL, ?, 'sync')`
      )
      for (const item of input.remoteHostFingerprints) {
        if (!checkKnown.get(item.address, item.port)) {
          insertKnown.run(item.address, item.port, item.fingerprint, nowIso)
        }
      }

      this.stmt(
        `UPDATE sync_accounts
           SET sync_passwords = ?,
               sync_private_keys = ?,
               last_revision = ?,
               last_etag = ?,
               last_sync_at = ?,
               base_doc_cipher = ?,
               pending_changes = 0,
               read_only_remote_schema = 0,
               remote_schema_version = NULL,
               doc_extra = ?,
               updated_at = ?
           WHERE id = ?`
      ).run(
        input.nextPreferences.syncPasswords ? 1 : 0,
        input.nextPreferences.syncPrivateKeys ? 1 : 0,
        input.revision,
        input.etag,
        nowIso,
        input.baseDocCipher ? Buffer.from(input.baseDocCipher) : null,
        input.docExtra ? JSON.stringify(input.docExtra) : null,
        nowIso,
        accountId
      )
    })()

    return {
      hosts: this.list(),
      groups: this.groupsList(),
      tunnels: this.tunnelsList()
    }
  }

  syncRecordUploadedCheckpoint(input: {
    accountId?: string
    revision: string | null
    etag: string | null
    baseDocCipher: Uint8Array | null
    docExtra?: Record<string, unknown>
  }): void {
    const accountId = input.accountId ?? 'primary'
    const nowIso = new Date().toISOString()
    this.stmt(
      `UPDATE sync_accounts
         SET last_revision = ?,
             last_etag = ?,
             base_doc_cipher = ?,
             doc_extra = ?,
             updated_at = ?
         WHERE id = ?`
    ).run(
      input.revision,
      input.etag,
      input.baseDocCipher ? Buffer.from(input.baseDocCipher) : null,
      input.docExtra ? JSON.stringify(input.docExtra) : null,
      nowIso,
      accountId
    )
  }

  /* ---------------- multi-namespace sync (`protocols` & `settings`) ---------------- */

  syncNamespacesList(): SyncNamespaceRecord[] {
    const rows = this.stmt('SELECT * FROM sync_namespaces').all() as Array<{
      namespace: string
      last_revision: string | null
      last_etag: string | null
      last_sync_at: string | null
      base_doc_cipher: Buffer | null
      pending_changes: number
      read_only_remote_schema: number
      remote_schema_version: number | null
      doc_extra: string | null
      updated_at: string
    }>
    return rows.map((row) => ({
      namespace: row.namespace as SyncNamespace,
      lastRevision: row.last_revision,
      lastEtag: row.last_etag,
      lastSyncAt: row.last_sync_at,
      baseDocCipher: row.base_doc_cipher ?? undefined,
      pendingChanges: Boolean(row.pending_changes),
      readOnlyRemoteSchema: Boolean(row.read_only_remote_schema),
      remoteSchemaVersion: row.remote_schema_version ?? undefined,
      docExtra: row.doc_extra ? (JSON.parse(row.doc_extra) as Record<string, unknown>) : undefined,
      updatedAt: row.updated_at
    }))
  }

  syncNamespaceGet(namespace: SyncNamespace): SyncNamespaceRecord | undefined {
    return this.syncNamespacesList().find((item) => item.namespace === namespace)
  }

  syncNamespaceMarkPending(namespace: 'protocols' | 'settings'): void {
    this.markNamespacePending(namespace)
  }

  syncListFileSecretBlobs(): Array<{ id: string; secret: Uint8Array }> {
    return this.stmt('SELECT id, secret FROM file_profiles WHERE secret IS NOT NULL').all() as Array<{
      id: string
      secret: Buffer
    }>
  }

  syncListRdpSecretBlobs(): Array<{ id: string; secret: Uint8Array }> {
    return this.stmt('SELECT id, secret FROM rdp_profiles WHERE secret IS NOT NULL').all() as Array<{
      id: string
      secret: Buffer
    }>
  }

  private buildLocalProtocolsSyncSource(
    plaintextFileSecrets: Record<string, FileSecretsInput>,
    plaintextRdpPasswords: Record<string, string>,
    overridePreferences?: { syncFileCredentials: boolean; syncRdpCredentials: boolean },
    accountId = 'primary'
  ): LocalProtocolsSyncSource {
    const account = this.syncAccountGet(accountId)
    const ns = this.syncNamespaceGet('protocols')
    return {
      fileProfiles: this.fileProfilesList(),
      plaintextFileSecrets,
      rdpProfiles: this.rdpProfilesList(),
      plaintextRdpPasswords,
      knownRdpHosts: this.rdpKnownHostsList(),
      preferences: overridePreferences ?? {
        syncFileCredentials: account?.syncFileCredentials ?? false,
        syncRdpCredentials: account?.syncRdpCredentials ?? false
      },
      docExtra: ns?.docExtra
    }
  }

  private buildLocalSettingsSyncSource(
    overridePreferences?: { syncProtocolSettings: boolean },
    accountId = 'primary'
  ): LocalSettingsSyncSource {
    const account = this.syncAccountGet(accountId)
    const ns = this.syncNamespaceGet('settings')
    return {
      protocolSettings: this.protocolSettingsAll(),
      preferences: overridePreferences ?? {
        syncProtocolSettings: account?.syncProtocolSettings ?? true
      },
      docExtra: ns?.docExtra
    }
  }

  syncEvaluateProtocolsAndMerge(input: {
    accountId?: string
    plaintextFileSecrets: Record<string, FileSecretsInput>
    plaintextRdpPasswords: Record<string, string>
    baseDocJson?: string | null
    remoteEnvelope?: SyncDocumentEnvelope | null
    resolutions?: Record<string, 'local' | 'remote'>
    maxDocumentBytes?: number
  }): SyncEvaluateProtocolsOutput {
    const accountId = input.accountId ?? 'primary'
    const vaultKey = this.vaultKeys.get(accountId)
    if (!vaultKey) throw new Error('保管库未解锁，请先输入主密码解锁')
    const account = this.syncAccountGet(accountId)
    if (!account?.vaultId) throw new Error('同步账号尚未绑定保管库')

    let remoteDoc: SyncDocumentProtocolsV2 | null = null
    if (input.remoteEnvelope) {
      const decrypted = decryptNamespaceDocument(vaultKey, account.vaultId, 'protocols', input.remoteEnvelope)
      if (decrypted.readOnlySchema) {
        const now = new Date().toISOString()
        this.stmt(
          `INSERT INTO sync_namespaces (namespace, read_only_remote_schema, remote_schema_version, updated_at)
           VALUES ('protocols', 1, ?, ?)
           ON CONFLICT(namespace) DO UPDATE SET
             read_only_remote_schema = 1,
             remote_schema_version = excluded.remote_schema_version,
             updated_at = excluded.updated_at`
        ).run(decrypted.schemaVersion, now)
        return {
          readOnlySchema: true,
          remoteSchemaVersion: decrypted.schemaVersion,
          conflicts: [],
          needsUpload: false,
          fileSecretsToEncrypt: [],
          rdpSecretsToEncrypt: [],
          localFileProfileUpdates: [],
          deletedFileProfileIds: [],
          localRdpProfileUpdates: [],
          deletedRdpProfileIds: [],
          localKnownRdpHosts: [],
          deletedKnownRdpHostIds: [],
          nextPreferences: {
            syncFileCredentials: account.syncFileCredentials,
            syncRdpCredentials: account.syncRdpCredentials
          }
        }
      }
      remoteDoc = normalizeRemoteProtocolsDocument(decrypted.rawDocument)
    }

    let baseDoc: SyncDocumentProtocolsV2 | null = null
    if (input.baseDocJson) {
      baseDoc = normalizeRemoteProtocolsDocument(JSON.parse(input.baseDocJson) as Record<string, unknown>)
    }

    const localSource = this.buildLocalProtocolsSyncSource(
      input.plaintextFileSecrets,
      input.plaintextRdpPasswords,
      undefined,
      accountId
    )
    const merge = threeWayMergeProtocols({
      localSource,
      baseDoc,
      remoteDoc,
      resolutions: input.resolutions
    })

    if (merge.conflicts.length > 0) {
      return {
        readOnlySchema: false,
        conflicts: merge.conflicts,
        needsUpload: false,
        fileSecretsToEncrypt: [],
        rdpSecretsToEncrypt: [],
        localFileProfileUpdates: [],
        deletedFileProfileIds: [],
        localRdpProfileUpdates: [],
        deletedRdpProfileIds: [],
        localKnownRdpHosts: [],
        deletedKnownRdpHostIds: [],
        nextPreferences: merge.nextPreferences
      }
    }

    const uploadEnvelope = merge.needsUpload
      ? encryptNamespaceDocument(
          vaultKey,
          account.vaultId,
          'protocols',
          account.keyVersion,
          merge.merged,
          input.maxDocumentBytes
        )
      : undefined

    const fileSecretsToEncrypt = merge.localFileProfileUpdates
      .filter((item) => item.secretsTouched)
      .map((item) => ({ profileId: item.profile.id, secrets: item.plaintextSecrets }))

    const rdpSecretsToEncrypt = merge.localRdpProfileUpdates
      .filter((item) => item.passwordTouched)
      .map((item) => ({ profileId: item.profile.id, password: item.plaintextPassword }))

    const docExtraKeys = Object.keys(merge.merged).filter(
      (k) =>
        ![
          'schemaVersion',
          'updatedAt',
          'preferences',
          'fileProfiles',
          'rdpProfiles',
          'knownRdpHosts'
        ].includes(k)
    )
    const docExtra = docExtraKeys.length
      ? Object.fromEntries(docExtraKeys.map((k) => [k, merge.merged[k]]))
      : undefined

    return {
      readOnlySchema: false,
      conflicts: [],
      needsUpload: merge.needsUpload,
      uploadEnvelope,
      mergedBaseJson: JSON.stringify(merge.merged),
      fileSecretsToEncrypt,
      rdpSecretsToEncrypt,
      localFileProfileUpdates: merge.localFileProfileUpdates,
      deletedFileProfileIds: merge.deletedFileProfileIds,
      localRdpProfileUpdates: merge.localRdpProfileUpdates,
      deletedRdpProfileIds: merge.deletedRdpProfileIds,
      localKnownRdpHosts: merge.localKnownRdpHosts,
      deletedKnownRdpHostIds: merge.deletedKnownRdpHostIds,
      nextPreferences: merge.nextPreferences,
      docExtra
    }
  }

  syncCommitProtocolsApplied(input: {
    accountId?: string
    localFileProfileUpdates: LocalMergedFileProfile[]
    encryptedFileSecrets: Record<string, Uint8Array | null>
    deletedFileProfileIds: string[]
    localRdpProfileUpdates: LocalMergedRdpProfile[]
    encryptedRdpSecrets: Record<string, Uint8Array | null>
    deletedRdpProfileIds: string[]
    localKnownRdpHosts: KnownRdpHostEntry[]
    deletedKnownRdpHostIds: string[]
    nextPreferences: { syncFileCredentials: boolean; syncRdpCredentials: boolean }
    revision: string | null
    etag: string | null
    baseDocCipher: Uint8Array | null
    docExtra?: Record<string, unknown>
  }): { fileProfiles: FileProfile[]; rdpProfiles: RdpProfile[]; knownRdpHosts: KnownRdpHostEntry[] } {
    const accountId = input.accountId ?? 'primary'
    const nowIso = new Date().toISOString()

    this.db.transaction(() => {
      for (const deletedId of input.deletedFileProfileIds) {
        this.stmt('DELETE FROM file_profiles WHERE id = ?').run(deletedId)
      }
      const selectExistingFile = this.stmt('SELECT id, secret FROM file_profiles WHERE id = ?')
      const selectFileByName = this.stmt(
        'SELECT id FROM file_profiles WHERE name = ? COLLATE NOCASE AND id != ?'
      )
      const upsertFile = this.stmt(
        `INSERT INTO file_profiles (id, name, protocol, document, secret, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           protocol = excluded.protocol,
           document = excluded.document,
           secret = excluded.secret,
           updated_at = excluded.updated_at`
      )
      for (const entry of input.localFileProfileUpdates) {
        const existing = selectExistingFile.get(entry.profile.id) as
          | { id: string; secret: Buffer | null }
          | undefined
        const hasOverride = Object.prototype.hasOwnProperty.call(input.encryptedFileSecrets, entry.profile.id)
        const nextSecret = hasOverride
          ? input.encryptedFileSecrets[entry.profile.id]
            ? Buffer.from(input.encryptedFileSecrets[entry.profile.id]!)
            : null
          : (existing?.secret ?? null)

        let candidateName = entry.profile.name
        const conflict = selectFileByName.get(candidateName, entry.profile.id) as { id: string } | undefined
        if (conflict) {
          candidateName = `${entry.profile.name.slice(0, 70)} (${entry.profile.id.slice(0, 4)})`
        }
        const doc: FileProfile = {
          ...entry.profile,
          name: candidateName,
          hasSecrets: Boolean(nextSecret)
        }
        upsertFile.run(
          doc.id,
          doc.name,
          doc.protocol,
          JSON.stringify(doc),
          nextSecret,
          doc.updatedAt || nowIso
        )
      }

      for (const deletedId of input.deletedRdpProfileIds) {
        this.stmt('DELETE FROM rdp_profiles WHERE id = ?').run(deletedId)
      }
      const selectExistingRdp = this.stmt('SELECT id, secret FROM rdp_profiles WHERE id = ?')
      const selectRdpByName = this.stmt(
        'SELECT id FROM rdp_profiles WHERE name = ? COLLATE NOCASE AND id != ?'
      )
      const upsertRdp = this.stmt(
        `INSERT INTO rdp_profiles (id, name, document, secret, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           document = excluded.document,
           secret = excluded.secret,
           updated_at = excluded.updated_at`
      )
      for (const entry of input.localRdpProfileUpdates) {
        const existing = selectExistingRdp.get(entry.profile.id) as
          | { id: string; secret: Buffer | null }
          | undefined
        const hasOverride = Object.prototype.hasOwnProperty.call(input.encryptedRdpSecrets, entry.profile.id)
        const nextSecret = hasOverride
          ? input.encryptedRdpSecrets[entry.profile.id]
            ? Buffer.from(input.encryptedRdpSecrets[entry.profile.id]!)
            : null
          : (existing?.secret ?? null)

        let candidateName = entry.profile.name
        const conflict = selectRdpByName.get(candidateName, entry.profile.id) as { id: string } | undefined
        if (conflict) {
          candidateName = `${entry.profile.name.slice(0, 70)} (${entry.profile.id.slice(0, 4)})`
        }
        const doc: RdpProfile = {
          ...entry.profile,
          name: candidateName,
          hasPassword: Boolean(nextSecret)
        }
        upsertRdp.run(doc.id, doc.name, JSON.stringify(doc), nextSecret, doc.updatedAt || nowIso)
      }

      for (const deletedKnownId of input.deletedKnownRdpHostIds) {
        this.stmt('DELETE FROM known_rdp_hosts WHERE id = ?').run(deletedKnownId)
      }
      const upsertKnownRdp = this.stmt(
        `INSERT INTO known_rdp_hosts (id, host, port, fingerprint, subject, issuer, valid_from, valid_to, accepted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           host = excluded.host,
           port = excluded.port,
           fingerprint = excluded.fingerprint,
           subject = excluded.subject,
           issuer = excluded.issuer,
           valid_from = excluded.valid_from,
           valid_to = excluded.valid_to,
           accepted_at = excluded.accepted_at`
      )
      for (const item of input.localKnownRdpHosts) {
        upsertKnownRdp.run(
          item.id,
          item.host,
          item.port,
          item.fingerprint,
          item.subject,
          item.issuer,
          item.validFrom,
          item.validTo,
          item.acceptedAt
        )
      }

      this.stmt(
        `UPDATE sync_accounts
           SET sync_file_credentials = ?,
               sync_rdp_credentials = ?,
               updated_at = ?
           WHERE id = ?`
      ).run(
        input.nextPreferences.syncFileCredentials ? 1 : 0,
        input.nextPreferences.syncRdpCredentials ? 1 : 0,
        nowIso,
        accountId
      )

      this.stmt(
        `INSERT INTO sync_namespaces (
           namespace, last_revision, last_etag, last_sync_at, base_doc_cipher,
           pending_changes, read_only_remote_schema, remote_schema_version, doc_extra, updated_at
         ) VALUES ('protocols', ?, ?, ?, ?, 0, 0, NULL, ?, ?)
         ON CONFLICT(namespace) DO UPDATE SET
           last_revision = excluded.last_revision,
           last_etag = excluded.last_etag,
           last_sync_at = excluded.last_sync_at,
           base_doc_cipher = excluded.base_doc_cipher,
           pending_changes = 0,
           read_only_remote_schema = 0,
           remote_schema_version = NULL,
           doc_extra = excluded.doc_extra,
           updated_at = excluded.updated_at`
      ).run(
        input.revision,
        input.etag,
        nowIso,
        input.baseDocCipher ? Buffer.from(input.baseDocCipher) : null,
        input.docExtra ? JSON.stringify(input.docExtra) : null,
        nowIso
      )
    })()

    return {
      fileProfiles: this.fileProfilesList(),
      rdpProfiles: this.rdpProfilesList(),
      knownRdpHosts: this.rdpKnownHostsList()
    }
  }

  syncEvaluateSettingsAndMerge(input: {
    accountId?: string
    baseDocJson?: string | null
    remoteEnvelope?: SyncDocumentEnvelope | null
    resolutions?: Record<string, 'local' | 'remote'>
    maxDocumentBytes?: number
  }): SyncEvaluateSettingsOutput {
    const accountId = input.accountId ?? 'primary'
    const vaultKey = this.vaultKeys.get(accountId)
    if (!vaultKey) throw new Error('保管库未解锁，请先输入主密码解锁')
    const account = this.syncAccountGet(accountId)
    if (!account?.vaultId) throw new Error('同步账号尚未绑定保管库')

    let remoteDoc: SyncDocumentSettingsV2 | null = null
    if (input.remoteEnvelope) {
      const decrypted = decryptNamespaceDocument(vaultKey, account.vaultId, 'settings', input.remoteEnvelope)
      if (decrypted.readOnlySchema) {
        const now = new Date().toISOString()
        this.stmt(
          `INSERT INTO sync_namespaces (namespace, read_only_remote_schema, remote_schema_version, updated_at)
           VALUES ('settings', 1, ?, ?)
           ON CONFLICT(namespace) DO UPDATE SET
             read_only_remote_schema = 1,
             remote_schema_version = excluded.remote_schema_version,
             updated_at = excluded.updated_at`
        ).run(decrypted.schemaVersion, now)
        return {
          readOnlySchema: true,
          remoteSchemaVersion: decrypted.schemaVersion,
          conflicts: [],
          needsUpload: false,
          nextPreferences: { syncProtocolSettings: account.syncProtocolSettings }
        }
      }
      remoteDoc = normalizeRemoteSettingsDocument(decrypted.rawDocument)
    }

    let baseDoc: SyncDocumentSettingsV2 | null = null
    if (input.baseDocJson) {
      baseDoc = normalizeRemoteSettingsDocument(JSON.parse(input.baseDocJson) as Record<string, unknown>)
    }

    const localSource = this.buildLocalSettingsSyncSource(undefined, accountId)
    const merge = threeWayMergeSettings({
      localSource,
      baseDoc,
      remoteDoc,
      resolutions: input.resolutions
    })

    if (merge.conflicts.length > 0) {
      return {
        readOnlySchema: false,
        conflicts: merge.conflicts,
        needsUpload: false,
        nextPreferences: merge.nextPreferences
      }
    }

    const uploadEnvelope = merge.needsUpload
      ? encryptNamespaceDocument(
          vaultKey,
          account.vaultId,
          'settings',
          account.keyVersion,
          merge.merged,
          input.maxDocumentBytes
        )
      : undefined

    const docExtraKeys = Object.keys(merge.merged).filter(
      (k) => !['schemaVersion', 'updatedAt', 'preferences', 'protocolSettings'].includes(k)
    )
    const docExtra = docExtraKeys.length
      ? Object.fromEntries(docExtraKeys.map((k) => [k, merge.merged[k]]))
      : undefined

    return {
      readOnlySchema: false,
      conflicts: [],
      needsUpload: merge.needsUpload,
      uploadEnvelope,
      mergedBaseJson: JSON.stringify(merge.merged),
      nextProtocolSettings: merge.nextProtocolSettings,
      nextPreferences: merge.nextPreferences,
      docExtra
    }
  }

  syncCommitSettingsApplied(input: {
    accountId?: string
    nextProtocolSettings: AllProtocolSettings
    revision: string | null
    etag: string | null
    baseDocCipher: Uint8Array | null
    docExtra?: Record<string, unknown>
  }): { protocolSettings: AllProtocolSettings } {
    const nowIso = new Date().toISOString()
    this.db.transaction(() => {
      const current = this.protocolSettingsAll()
      const mergedRdp = {
        ...normalizeProtocolSettings('rdp', input.nextProtocolSettings.rdp),
        externalClientPath: current.rdp.externalClientPath,
        sharedDrivePath: current.rdp.sharedDrivePath
      }
      const docs: Record<ProtocolNamespace, unknown> = {
        ssh: normalizeProtocolSettings('ssh', input.nextProtocolSettings.ssh),
        files: normalizeProtocolSettings('files', input.nextProtocolSettings.files),
        rdp: mergedRdp
      }
      const upsert = this.stmt(
        `INSERT INTO protocol_settings (namespace, document, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(namespace) DO UPDATE SET document = excluded.document, updated_at = excluded.updated_at`
      )
      for (const ns of PROTOCOL_NAMESPACES) {
        upsert.run(ns, JSON.stringify(docs[ns]), nowIso)
      }

      this.stmt(
        `INSERT INTO sync_namespaces (
           namespace, last_revision, last_etag, last_sync_at, base_doc_cipher,
           pending_changes, read_only_remote_schema, remote_schema_version, doc_extra, updated_at
         ) VALUES ('settings', ?, ?, ?, ?, 0, 0, NULL, ?, ?)
         ON CONFLICT(namespace) DO UPDATE SET
           last_revision = excluded.last_revision,
           last_etag = excluded.last_etag,
           last_sync_at = excluded.last_sync_at,
           base_doc_cipher = excluded.base_doc_cipher,
           pending_changes = 0,
           read_only_remote_schema = 0,
           remote_schema_version = NULL,
           doc_extra = excluded.doc_extra,
           updated_at = excluded.updated_at`
      ).run(
        input.revision,
        input.etag,
        nowIso,
        input.baseDocCipher ? Buffer.from(input.baseDocCipher) : null,
        input.docExtra ? JSON.stringify(input.docExtra) : null,
        nowIso
      )
    })()

    return { protocolSettings: this.protocolSettingsAll() }
  }

  syncRecordNamespaceUploadedCheckpoint(input: {
    namespace: 'protocols' | 'settings'
    revision: string | null
    etag: string | null
    baseDocCipher: Uint8Array | null
    docExtra?: Record<string, unknown>
  }): void {
    const nowIso = new Date().toISOString()
    this.stmt(
      `INSERT INTO sync_namespaces (namespace, last_revision, last_etag, base_doc_cipher, doc_extra, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(namespace) DO UPDATE SET
         last_revision = excluded.last_revision,
         last_etag = excluded.last_etag,
         base_doc_cipher = excluded.base_doc_cipher,
         doc_extra = excluded.doc_extra,
         updated_at = excluded.updated_at`
    ).run(
      input.namespace,
      input.revision,
      input.etag,
      input.baseDocCipher ? Buffer.from(input.baseDocCipher) : null,
      input.docExtra ? JSON.stringify(input.docExtra) : null,
      nowIso
    )
  }

  syncEvaluateNamespaceRevisionRestore(input: {
    accountId?: string
    namespace: 'protocols' | 'settings'
    plaintextFileSecrets?: Record<string, FileSecretsInput>
    plaintextRdpPasswords?: Record<string, string>
    revisionEnvelope: SyncDocumentEnvelope
  }): SyncEvaluateProtocolsOutput | SyncEvaluateSettingsOutput {
    const accountId = input.accountId ?? 'primary'
    const vaultKey = this.vaultKeys.get(accountId)
    if (!vaultKey) throw new Error('保管库未解锁')
    const account = this.syncAccountGet(accountId)
    if (!account?.vaultId) throw new Error('同步账号尚未绑定保管库')

    const decrypted = decryptNamespaceDocument(
      vaultKey,
      account.vaultId,
      input.namespace,
      input.revisionEnvelope
    )
    if (decrypted.readOnlySchema) {
      throw new Error(`历史版本 schemaVersion=${decrypted.schemaVersion} 高于当前客户端版本，无法回滚恢复。`)
    }

    if (input.namespace === 'protocols') {
      const remoteDoc = normalizeRemoteProtocolsDocument(decrypted.rawDocument)
      const localSource = this.buildLocalProtocolsSyncSource(
        input.plaintextFileSecrets ?? {},
        input.plaintextRdpPasswords ?? {},
        undefined,
        accountId
      )
      const currentLocalDoc = buildLocalProtocolsDocument(localSource)
      const merge = threeWayMergeProtocols({
        localSource,
        baseDoc: currentLocalDoc,
        remoteDoc
      })
      const fileSecretsToEncrypt = merge.localFileProfileUpdates
        .filter((item) => item.secretsTouched)
        .map((item) => ({ profileId: item.profile.id, secrets: item.plaintextSecrets }))
      const rdpSecretsToEncrypt = merge.localRdpProfileUpdates
        .filter((item) => item.passwordTouched)
        .map((item) => ({ profileId: item.profile.id, password: item.plaintextPassword }))
      return {
        readOnlySchema: false,
        conflicts: [],
        needsUpload: false,
        mergedBaseJson: JSON.stringify(merge.merged),
        fileSecretsToEncrypt,
        rdpSecretsToEncrypt,
        localFileProfileUpdates: merge.localFileProfileUpdates,
        deletedFileProfileIds: merge.deletedFileProfileIds,
        localRdpProfileUpdates: merge.localRdpProfileUpdates,
        deletedRdpProfileIds: merge.deletedRdpProfileIds,
        localKnownRdpHosts: merge.localKnownRdpHosts,
        deletedKnownRdpHostIds: merge.deletedKnownRdpHostIds,
        nextPreferences: merge.nextPreferences
      } satisfies SyncEvaluateProtocolsOutput
    }

    const remoteDoc = normalizeRemoteSettingsDocument(decrypted.rawDocument)
    const localSource = this.buildLocalSettingsSyncSource(undefined, accountId)
    const currentLocalDoc = buildLocalSettingsDocument(localSource)
    const merge = threeWayMergeSettings({
      localSource,
      baseDoc: currentLocalDoc,
      remoteDoc
    })
    return {
      readOnlySchema: false,
      conflicts: [],
      needsUpload: false,
      mergedBaseJson: JSON.stringify(merge.merged),
      nextProtocolSettings: merge.nextProtocolSettings,
      nextPreferences: merge.nextPreferences
    } satisfies SyncEvaluateSettingsOutput
  }

  async syncPrepareBatchRotate(input: {
    accountId?: string
    newKeyVersion: number
    masterPassword: string
    syncPasswords: boolean
    syncFileCredentials: boolean
    syncRdpCredentials: boolean
    syncProtocolSettings: boolean
    includeNamespaces: SyncNamespace[]
    maxDocumentBytes?: number
    plaintextPasswords: Record<string, string>
    plaintextFileSecrets: Record<string, FileSecretsInput>
    plaintextRdpPasswords: Record<string, string>
  }): Promise<{
    recoveryKey: string
    keyEnvelope: VaultMetadataWire
    envelopes: Partial<Record<SyncNamespace, SyncDocumentEnvelope>>
    nextBaseDocs: Partial<Record<SyncNamespace, string>>
  }> {
    const accountId = input.accountId ?? 'primary'
    const account = this.syncAccountGet(accountId)
    if (!account?.vaultId) throw new Error('尚未创建或关联保管库')
    const materials = await rotateVaultKeyMaterials(input.newKeyVersion, input.masterPassword)
    const envelopes: Partial<Record<SyncNamespace, SyncDocumentEnvelope>> = {}
    const nextBaseDocs: Partial<Record<SyncNamespace, string>> = {}

    // Always re-encrypt `core`
    const coreSource = this.buildLocalSyncSource(
      input.plaintextPasswords,
      { syncPasswords: input.syncPasswords, syncPrivateKeys: account.syncPrivateKeys },
      accountId
    )
    const coreDoc = threeWayMerge({ localSource: coreSource, baseDoc: null, remoteDoc: null }).merged
    coreDoc.preferences.syncPasswords = input.syncPasswords
    if (!input.syncPasswords) {
      coreDoc.servers = coreDoc.servers.map((server) => {
        if (!server.secrets) return server
        const nextSecrets = { ...server.secrets }
        delete nextSecrets.password
        delete nextSecrets.passphrase
        const next = { ...server }
        if (Object.keys(nextSecrets).length > 0) next.secrets = nextSecrets
        else delete next.secrets
        return next
      })
    }
    envelopes.core = encryptSyncDocument(materials.vaultKey, account.vaultId, input.newKeyVersion, coreDoc)
    nextBaseDocs.core = JSON.stringify(coreDoc)

    if (input.includeNamespaces.includes('protocols')) {
      const protoSource = this.buildLocalProtocolsSyncSource(
        input.plaintextFileSecrets,
        input.plaintextRdpPasswords,
        {
          syncFileCredentials: input.syncFileCredentials,
          syncRdpCredentials: input.syncRdpCredentials
        },
        accountId
      )
      const protoDoc = buildLocalProtocolsDocument(protoSource)
      envelopes.protocols = encryptNamespaceDocument(
        materials.vaultKey,
        account.vaultId,
        'protocols',
        input.newKeyVersion,
        protoDoc,
        input.maxDocumentBytes
      )
      nextBaseDocs.protocols = JSON.stringify(protoDoc)
    }

    if (input.includeNamespaces.includes('settings')) {
      const settingsSource = this.buildLocalSettingsSyncSource(
        { syncProtocolSettings: input.syncProtocolSettings },
        accountId
      )
      const settingsDoc = buildLocalSettingsDocument(settingsSource)
      envelopes.settings = encryptNamespaceDocument(
        materials.vaultKey,
        account.vaultId,
        'settings',
        input.newKeyVersion,
        settingsDoc,
        input.maxDocumentBytes
      )
      nextBaseDocs.settings = JSON.stringify(settingsDoc)
    }

    const oldPending = this.pendingRotatedKeys.get(accountId)
    if (oldPending) oldPending.key.fill(0)
    this.pendingRotatedKeys.set(accountId, { keyVersion: input.newKeyVersion, key: materials.vaultKey })
    return {
      recoveryKey: materials.recoveryKey,
      keyEnvelope: materials.envelope,
      envelopes,
      nextBaseDocs
    }
  }

  syncCommitBatchRotate(input: {
    accountId?: string
    keyVersion: number
    syncPasswords: boolean
    syncFileCredentials: boolean
    syncRdpCredentials: boolean
    coreRevision: string
    coreEtag: string | null
    coreBaseDocCipher: Uint8Array | null
    namespaces?: Partial<
      Record<
        'protocols' | 'settings',
        { revision: string; etag: string | null; baseDocCipher: Uint8Array | null }
      >
    >
  }): void {
    const accountId = input.accountId ?? 'primary'
    const pending = this.pendingRotatedKeys.get(accountId)
    if (!pending || pending.keyVersion !== input.keyVersion) {
      throw new Error('轮换密钥会话不存在或已过期')
    }
    const oldKey = this.vaultKeys.get(accountId)
    if (oldKey) oldKey.fill(0)
    this.vaultKeys.set(accountId, pending.key)
    this.pendingRotatedKeys.delete(accountId)
    const nowIso = new Date().toISOString()

    this.db.transaction(() => {
      this.stmt(
        `UPDATE sync_accounts
           SET key_version = ?,
               sync_passwords = ?,
               sync_file_credentials = ?,
               sync_rdp_credentials = ?,
               last_revision = ?,
               last_etag = ?,
               last_sync_at = ?,
               base_doc_cipher = ?,
               pending_changes = 0,
               updated_at = ?
           WHERE id = ?`
      ).run(
        input.keyVersion,
        input.syncPasswords ? 1 : 0,
        input.syncFileCredentials ? 1 : 0,
        input.syncRdpCredentials ? 1 : 0,
        input.coreRevision,
        input.coreEtag,
        nowIso,
        input.coreBaseDocCipher ? Buffer.from(input.coreBaseDocCipher) : null,
        nowIso,
        accountId
      )

      const upsertNs = this.stmt(
        `INSERT INTO sync_namespaces (
           namespace, last_revision, last_etag, last_sync_at, base_doc_cipher,
           pending_changes, read_only_remote_schema, remote_schema_version, updated_at
         ) VALUES (?, ?, ?, ?, ?, 0, 0, NULL, ?)
         ON CONFLICT(namespace) DO UPDATE SET
           last_revision = excluded.last_revision,
           last_etag = excluded.last_etag,
           last_sync_at = excluded.last_sync_at,
           base_doc_cipher = excluded.base_doc_cipher,
           pending_changes = 0,
           read_only_remote_schema = 0,
           remote_schema_version = NULL,
           updated_at = excluded.updated_at`
      )
      for (const ns of ['protocols', 'settings'] as const) {
        const entry = input.namespaces?.[ns]
        if (!entry) continue
        upsertNs.run(
          ns,
          entry.revision,
          entry.etag,
          nowIso,
          entry.baseDocCipher ? Buffer.from(entry.baseDocCipher) : null,
          nowIso
        )
      }
    })()
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const key of this.vaultKeys.values()) key.fill(0)
    this.vaultKeys.clear()
    for (const item of this.pendingRotatedKeys.values()) item.key.fill(0)
    this.pendingRotatedKeys.clear()
    this.stmtCache.clear()
    this.db.close()
  }
}
