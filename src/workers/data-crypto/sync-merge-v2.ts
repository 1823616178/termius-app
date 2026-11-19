import {
  DEFAULT_FILES_SETTINGS,
  DEFAULT_SSH_SETTINGS,
  FILE_PROTOCOLS,
  FILE_SECRET_KEYS,
  normalizeProtocolSettings,
  type AllProtocolSettings,
  type FileProfile,
  type FileProfileOptions,
  type FileProtocol,
  type FileSecretsInput,
  type FilesSettings,
  type SshSettings
} from '../../shared/files'
import {
  DEFAULT_RDP_SETTINGS,
  type KnownRdpHostEntry,
  type RdpProfile,
  type RdpProfileOptions,
  type RdpSettings
} from '../../shared/rdp'
import {
  MAX_SYNC_FILE_PROFILES,
  MAX_SYNC_KNOWN_RDP_HOSTS,
  MAX_SYNC_RDP_PROFILES,
  SYNC_NAMESPACE_SCHEMA_VERSION,
  type SyncConflict,
  type SyncConflictEntityType,
  type SyncDocumentProtocolsV2,
  type SyncDocumentSettingsV2,
  type SyncedRdpSettings,
  type WireFileProfile,
  type WireKnownRdpHost,
  type WireProtocolsPreferences,
  type WireRdpProfile,
  type WireRdpProfileSecrets,
  type WireSettingsPreferences
} from '../../shared/sync'
import { canonicalEquals } from './sync-merge'

const VALID_FILE_PROTOCOLS = new Set<string>(FILE_PROTOCOLS)

export interface LocalProtocolsSyncSource {
  fileProfiles: FileProfile[]
  plaintextFileSecrets: Record<string, FileSecretsInput>
  rdpProfiles: RdpProfile[]
  plaintextRdpPasswords: Record<string, string>
  knownRdpHosts: KnownRdpHostEntry[]
  preferences: {
    syncFileCredentials: boolean
    syncRdpCredentials: boolean
  }
  docExtra?: Record<string, unknown>
}

export interface LocalMergedFileProfile {
  profile: FileProfile
  plaintextSecrets: FileSecretsInput | null
  secretsTouched: boolean
}

export interface LocalMergedRdpProfile {
  profile: RdpProfile
  plaintextPassword: string | null
  passwordTouched: boolean
}

export interface ProtocolsMergeResult {
  merged: SyncDocumentProtocolsV2
  conflicts: SyncConflict[]
  needsUpload: boolean
  localFileProfileUpdates: LocalMergedFileProfile[]
  deletedFileProfileIds: string[]
  localRdpProfileUpdates: LocalMergedRdpProfile[]
  deletedRdpProfileIds: string[]
  localKnownRdpHosts: KnownRdpHostEntry[]
  deletedKnownRdpHostIds: string[]
  nextPreferences: {
    syncFileCredentials: boolean
    syncRdpCredentials: boolean
  }
}

export interface LocalSettingsSyncSource {
  protocolSettings: AllProtocolSettings
  preferences: {
    syncProtocolSettings: boolean
  }
  docExtra?: Record<string, unknown>
}

export interface SettingsMergeResult {
  merged: SyncDocumentSettingsV2
  conflicts: SyncConflict[]
  needsUpload: boolean
  nextProtocolSettings: AllProtocolSettings
  nextPreferences: {
    syncProtocolSettings: boolean
  }
}

function stripKeys<T extends Record<string, unknown>>(
  obj: T,
  keys: readonly string[]
): Record<string, unknown> | undefined {
  const skip = new Set(keys)
  const extra: Record<string, unknown> = {}
  let count = 0
  for (const [k, v] of Object.entries(obj)) {
    if (!skip.has(k) && v !== undefined) {
      extra[k] = v
      count++
    }
  }
  return count > 0 ? extra : undefined
}

function stableClone(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableClone)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const val = (value as Record<string, unknown>)[key]
      if (val !== undefined) out[key] = stableClone(val)
    }
    return out
  }
  return value
}

function sanitizeFileSecrets(raw?: FileSecretsInput | Record<string, unknown>): FileSecretsInput | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: FileSecretsInput = {}
  for (const key of FILE_SECRET_KEYS) {
    const val = (raw as Record<string, unknown>)[key]
    if (typeof val === 'string' && val.length > 0) {
      out[key] = val
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function sanitizeRdpSecrets(
  raw?: WireRdpProfileSecrets | Record<string, unknown>
): WireRdpProfileSecrets | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: WireRdpProfileSecrets = {}
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string' && v.length > 0) {
      out[k] = v
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function stripRdpPasswordSecret(secrets?: WireRdpProfileSecrets): WireRdpProfileSecrets | undefined {
  if (!secrets) return undefined
  const next = { ...secrets }
  delete next.password
  return Object.keys(next).length > 0 ? next : undefined
}

function maskValue(value: unknown, isSecret: boolean): string {
  if (isSecret) {
    if (typeof value !== 'string' || value.length === 0) return '（未设置）'
    return `已设置（••••••，${value.length} 位）`
  }
  if (value === null || value === undefined || value === '') return '（空）'
  if (typeof value === 'boolean') return value ? '开启' : '关闭'
  if (typeof value === 'object') return JSON.stringify(stableClone(value))
  return String(value)
}

function mergeFieldV2<T>(
  ctx: {
    namespace: 'protocols' | 'settings'
    entityType: SyncConflictEntityType
    entityId: string
    entityName: string
    conflicts: SyncConflict[]
    resolutions: Record<string, 'local' | 'remote'>
  },
  field: string,
  fieldLabel: string,
  baseVal: T | undefined,
  localVal: T,
  remoteVal: T,
  hasBase: boolean,
  isSecret = false,
  defaultValForFirstSync?: T
): T {
  if (canonicalEquals(localVal, remoteVal)) return localVal
  if (!hasBase) {
    if (defaultValForFirstSync !== undefined && canonicalEquals(localVal, defaultValForFirstSync)) {
      return remoteVal
    }
    const conflictId = `${ctx.entityType}:${ctx.entityId}:${field}`
    const resolved = ctx.resolutions[conflictId]
    if (resolved === 'local') return localVal
    if (resolved === 'remote') return remoteVal
    ctx.conflicts.push({
      id: conflictId,
      namespace: ctx.namespace,
      entityType: ctx.entityType,
      entityId: ctx.entityId,
      entityName: ctx.entityName,
      field,
      fieldLabel,
      isSecret,
      localDisplay: maskValue(localVal, isSecret),
      remoteDisplay: maskValue(remoteVal, isSecret)
    })
    return localVal
  }
  const localChanged = !canonicalEquals(localVal, baseVal)
  const remoteChanged = !canonicalEquals(remoteVal, baseVal)
  if (localChanged && !remoteChanged) return localVal
  if (!localChanged && remoteChanged) return remoteVal
  if (!localChanged && !remoteChanged) return localVal

  const conflictId = `${ctx.entityType}:${ctx.entityId}:${field}`
  const resolved = ctx.resolutions[conflictId]
  if (resolved === 'local') return localVal
  if (resolved === 'remote') return remoteVal

  ctx.conflicts.push({
    id: conflictId,
    namespace: ctx.namespace,
    entityType: ctx.entityType,
    entityId: ctx.entityId,
    entityName: ctx.entityName,
    field,
    fieldLabel,
    isSecret,
    localDisplay: maskValue(localVal, isSecret),
    remoteDisplay: maskValue(remoteVal, isSecret)
  })
  return localVal
}

function mergeCollectionV2<T>(
  namespace: 'protocols' | 'settings',
  entityType: SyncConflictEntityType,
  getId: (item: T) => string,
  getName: (item: T) => string,
  baseList: T[],
  localList: T[],
  remoteList: T[],
  hasBase: boolean,
  mergeItem: (base: T | undefined, local: T, remote: T) => T,
  conflicts: SyncConflict[],
  resolutions: Record<string, 'local' | 'remote'>
): { items: T[]; deletedLocalIds: string[] } {
  const baseMap = new Map(baseList.map((i) => [getId(i), i]))
  const localMap = new Map(localList.map((i) => [getId(i), i]))
  const remoteMap = new Map(remoteList.map((i) => [getId(i), i]))
  const allIds = [...new Set([...baseMap.keys(), ...localMap.keys(), ...remoteMap.keys()])].sort()
  const items: T[] = []
  const deletedLocalIds: string[] = []

  for (const id of allIds) {
    const b = baseMap.get(id)
    const l = localMap.get(id)
    const r = remoteMap.get(id)

    if (l && r) {
      items.push(mergeItem(b, l, r))
      continue
    }
    if (l && !r) {
      if (!hasBase || !b) {
        items.push(l)
        continue
      }
      if (canonicalEquals(l, b)) {
        deletedLocalIds.push(id)
        continue
      }
      const conflictId = `${entityType}:${id}:__presence__`
      const resolved = resolutions[conflictId]
      if (resolved === 'remote') {
        deletedLocalIds.push(id)
        continue
      }
      if (resolved !== 'local') {
        conflicts.push({
          id: conflictId,
          namespace,
          entityType,
          entityId: id,
          entityName: getName(l),
          field: '__presence__',
          fieldLabel: '实体存在性',
          isSecret: false,
          localDisplay: '本地已修改',
          remoteDisplay: '远端已删除'
        })
      }
      items.push(l)
      continue
    }
    if (!l && r) {
      if (!hasBase || !b) {
        items.push(r)
        continue
      }
      if (canonicalEquals(r, b)) {
        continue
      }
      const conflictId = `${entityType}:${id}:__presence__`
      const resolved = resolutions[conflictId]
      if (resolved === 'local') {
        continue
      }
      if (resolved === 'remote') {
        items.push(r)
        continue
      }
      conflicts.push({
        id: conflictId,
        namespace,
        entityType,
        entityId: id,
        entityName: getName(r),
        field: '__presence__',
        fieldLabel: '实体存在性',
        isSecret: false,
        localDisplay: '本地已删除',
        remoteDisplay: '远端已修改'
      })
      items.push(r)
    }
  }

  return { items, deletedLocalIds }
}

/* ================================================================== */
/* Protocols namespace (`protocols`, schemaVersion = 2)                */
/* ================================================================== */

function canonicalProtocolsWithoutTimestamp(doc: SyncDocumentProtocolsV2): unknown {
  const copy = {
    ...doc,
    updatedAt: '',
    fileProfiles: [...doc.fileProfiles]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((item) => ({ ...item, updatedAt: '' })),
    rdpProfiles: [...doc.rdpProfiles]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((item) => ({ ...item, updatedAt: '' })),
    knownRdpHosts: [...doc.knownRdpHosts].sort((a, b) => a.id.localeCompare(b.id))
  }
  return stableClone(copy)
}

export function protocolsDocumentsLogicallyEqual(
  a: SyncDocumentProtocolsV2,
  b: SyncDocumentProtocolsV2
): boolean {
  return (
    JSON.stringify(canonicalProtocolsWithoutTimestamp(a)) ===
    JSON.stringify(canonicalProtocolsWithoutTimestamp(b))
  )
}

export function buildLocalProtocolsDocument(
  source: LocalProtocolsSyncSource,
  updatedAt = new Date().toISOString()
): SyncDocumentProtocolsV2 {
  if (source.fileProfiles.length > MAX_SYNC_FILE_PROFILES) {
    throw new Error(`同步文件服务器数量 ${source.fileProfiles.length} 超出上限 ${MAX_SYNC_FILE_PROFILES}`)
  }
  if (source.rdpProfiles.length > MAX_SYNC_RDP_PROFILES) {
    throw new Error(`同步远程桌面数量 ${source.rdpProfiles.length} 超出上限 ${MAX_SYNC_RDP_PROFILES}`)
  }
  if (source.knownRdpHosts.length > MAX_SYNC_KNOWN_RDP_HOSTS) {
    throw new Error(
      `同步 RDP 信任证书数量 ${source.knownRdpHosts.length} 超出上限 ${MAX_SYNC_KNOWN_RDP_HOSTS}`
    )
  }

  const fileProfiles: WireFileProfile[] = [...source.fileProfiles]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((profile) => {
      const secrets = source.preferences.syncFileCredentials
        ? sanitizeFileSecrets(source.plaintextFileSecrets[profile.id])
        : undefined
      return {
        id: profile.id,
        name: profile.name,
        protocol: profile.protocol,
        host: profile.host,
        port: profile.port,
        username: profile.username,
        initialPath: profile.initialPath,
        notes: profile.notes,
        favorite: profile.favorite,
        options: { ...profile.options },
        ...(secrets ? { secrets } : {})
      }
    })

  const rdpProfiles: WireRdpProfile[] = [...source.rdpProfiles]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((profile) => {
      const plainPw = source.preferences.syncRdpCredentials
        ? source.plaintextRdpPasswords[profile.id]
        : undefined
      const secrets = plainPw ? { password: plainPw } : undefined
      return {
        id: profile.id,
        name: profile.name,
        host: profile.host,
        port: profile.port,
        domain: profile.domain,
        username: profile.username,
        linkedHostId: profile.linkedHostId ?? null,
        notes: profile.notes,
        favorite: profile.favorite,
        options: { ...profile.options },
        ...(secrets ? { secrets } : {})
      }
    })

  const knownRdpHosts: WireKnownRdpHost[] = [...source.knownRdpHosts]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((entry) => ({
      id: entry.id,
      host: entry.host,
      port: entry.port,
      fingerprint: entry.fingerprint,
      subject: entry.subject,
      issuer: entry.issuer,
      validFrom: entry.validFrom,
      validTo: entry.validTo,
      acceptedAt: entry.acceptedAt
    }))

  return {
    ...(source.docExtra ?? {}),
    schemaVersion: SYNC_NAMESPACE_SCHEMA_VERSION,
    updatedAt,
    preferences: {
      syncFileCredentials: source.preferences.syncFileCredentials,
      syncRdpCredentials: source.preferences.syncRdpCredentials
    },
    fileProfiles,
    rdpProfiles,
    knownRdpHosts
  }
}

export function normalizeRemoteProtocolsDocument(raw: Record<string, unknown>): SyncDocumentProtocolsV2 {
  const rawPrefs = (raw.preferences && typeof raw.preferences === 'object' ? raw.preferences : {}) as Record<
    string,
    unknown
  >
  const preferences: WireProtocolsPreferences = {
    ...(stripKeys(rawPrefs, ['syncFileCredentials', 'syncRdpCredentials']) ?? {}),
    syncFileCredentials: Boolean(rawPrefs.syncFileCredentials),
    syncRdpCredentials: Boolean(rawPrefs.syncRdpCredentials)
  }

  const rawFiles = Array.isArray(raw.fileProfiles) ? raw.fileProfiles : []
  const fileProfiles: WireFileProfile[] = rawFiles
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => {
      const protocolRaw = String(item.protocol ?? 'ftp')
      const protocol: FileProtocol = VALID_FILE_PROTOCOLS.has(protocolRaw)
        ? (protocolRaw as FileProtocol)
        : 'ftp'
      const rawOptions =
        item.options && typeof item.options === 'object' && !Array.isArray(item.options)
          ? (item.options as FileProfileOptions)
          : {}
      const secrets = sanitizeFileSecrets(item.secrets as Record<string, unknown> | undefined)
      const port =
        typeof item.port === 'number' && Number.isInteger(item.port) && item.port >= 0 && item.port <= 65535
          ? item.port
          : 0
      const extra = stripKeys(item, [
        'id',
        'name',
        'protocol',
        'host',
        'port',
        'username',
        'initialPath',
        'notes',
        'favorite',
        'options',
        'secrets',
        'updatedAt'
      ])
      return {
        ...(extra ?? {}),
        id: String(item.id ?? '').trim(),
        name: String(item.name ?? '未命名文件服务器').slice(0, 80),
        protocol,
        host: String(item.host ?? '').trim(),
        port,
        username: String(item.username ?? '').trim(),
        initialPath: String(item.initialPath ?? ''),
        notes: String(item.notes ?? ''),
        favorite: Boolean(item.favorite),
        options: { ...rawOptions },
        ...(secrets ? { secrets } : {})
      } satisfies WireFileProfile
    })
    .filter((item) => Boolean(item.id))

  const rawRdps = Array.isArray(raw.rdpProfiles) ? raw.rdpProfiles : []
  const rdpProfiles: WireRdpProfile[] = rawRdps
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => {
      const rawOptions =
        item.options && typeof item.options === 'object' && !Array.isArray(item.options)
          ? (item.options as RdpProfileOptions)
          : {}
      const secrets = sanitizeRdpSecrets(item.secrets as Record<string, unknown> | undefined)
      const port =
        typeof item.port === 'number' && Number.isInteger(item.port) && item.port >= 1 && item.port <= 65535
          ? item.port
          : 3389
      const extra = stripKeys(item, [
        'id',
        'name',
        'host',
        'port',
        'domain',
        'username',
        'linkedHostId',
        'notes',
        'favorite',
        'options',
        'secrets',
        'updatedAt'
      ])
      return {
        ...(extra ?? {}),
        id: String(item.id ?? '').trim(),
        name: String(item.name ?? '未命名远程桌面').slice(0, 80),
        host: String(item.host ?? '').trim(),
        port,
        domain: String(item.domain ?? '').trim(),
        username: String(item.username ?? '').trim(),
        linkedHostId:
          typeof item.linkedHostId === 'string' && item.linkedHostId.trim() ? item.linkedHostId.trim() : null,
        notes: String(item.notes ?? ''),
        favorite: Boolean(item.favorite),
        options: { ...rawOptions },
        ...(secrets ? { secrets } : {})
      } satisfies WireRdpProfile
    })
    .filter((item) => Boolean(item.id) && Boolean(item.host))

  const rawKnown = Array.isArray(raw.knownRdpHosts) ? raw.knownRdpHosts : []
  const knownRdpHosts: WireKnownRdpHost[] = rawKnown
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => {
      const host = String(item.host ?? '').trim()
      const port =
        typeof item.port === 'number' && Number.isInteger(item.port) && item.port >= 1 && item.port <= 65535
          ? item.port
          : 3389
      const id = String(item.id ?? `${host.toLowerCase()}:${port}`).trim()
      const extra = stripKeys(item, [
        'id',
        'host',
        'port',
        'fingerprint',
        'subject',
        'issuer',
        'validFrom',
        'validTo',
        'acceptedAt'
      ])
      return {
        ...(extra ?? {}),
        id,
        host,
        port,
        fingerprint: String(item.fingerprint ?? '').trim(),
        subject: String(item.subject ?? ''),
        issuer: String(item.issuer ?? ''),
        validFrom: String(item.validFrom ?? ''),
        validTo: String(item.validTo ?? ''),
        acceptedAt: String(item.acceptedAt ?? new Date().toISOString())
      } satisfies WireKnownRdpHost
    })
    .filter((item) => Boolean(item.id) && Boolean(item.host) && Boolean(item.fingerprint))

  const docExtra = stripKeys(raw, [
    'schemaVersion',
    'updatedAt',
    'preferences',
    'fileProfiles',
    'rdpProfiles',
    'knownRdpHosts'
  ])

  return {
    ...(docExtra ?? {}),
    schemaVersion: SYNC_NAMESPACE_SCHEMA_VERSION,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    preferences,
    fileProfiles,
    rdpProfiles,
    knownRdpHosts
  }
}

function mergeFileProfiles(
  base: WireFileProfile | undefined,
  local: WireFileProfile,
  remote: WireFileProfile,
  hasBase: boolean,
  conflicts: SyncConflict[],
  resolutions: Record<string, 'local' | 'remote'>
): WireFileProfile {
  const ctx = {
    namespace: 'protocols' as const,
    entityType: 'fileProfile' as const,
    entityId: local.id,
    entityName: local.name || remote.name,
    conflicts,
    resolutions
  }
  const extra = {
    ...(stripKeys(remote, [
      'id',
      'name',
      'protocol',
      'host',
      'port',
      'username',
      'initialPath',
      'notes',
      'favorite',
      'options',
      'secrets',
      'updatedAt'
    ]) ?? {}),
    ...(stripKeys(local, [
      'id',
      'name',
      'protocol',
      'host',
      'port',
      'username',
      'initialPath',
      'notes',
      'favorite',
      'options',
      'secrets',
      'updatedAt'
    ]) ?? {})
  }

  const secretLabels: Record<(typeof FILE_SECRET_KEYS)[number], string> = {
    password: '文件服务密码',
    token: 'WebDAV 令牌',
    secretAccessKey: 'S3 Secret Access Key',
    sessionToken: 'S3 会话令牌'
  }
  const nextSecrets: FileSecretsInput = {}
  for (const key of FILE_SECRET_KEYS) {
    const mergedSecret = mergeFieldV2(
      ctx,
      `secrets.${key}`,
      secretLabels[key],
      base?.secrets?.[key] ?? '',
      local.secrets?.[key] ?? '',
      remote.secrets?.[key] ?? '',
      hasBase,
      true
    )
    if (mergedSecret) nextSecrets[key] = mergedSecret
  }
  const cleanSecrets = sanitizeFileSecrets(nextSecrets)

  const mergedOptions = mergeFieldV2(
    ctx,
    'options',
    '协议选项',
    base?.options,
    local.options,
    remote.options,
    hasBase
  )

  return {
    ...extra,
    id: local.id,
    name: mergeFieldV2(ctx, 'name', '名称', base?.name, local.name, remote.name, hasBase),
    protocol: mergeFieldV2(
      ctx,
      'protocol',
      '文件协议',
      base?.protocol,
      local.protocol,
      remote.protocol,
      hasBase
    ),
    host: mergeFieldV2(ctx, 'host', '服务器地址', base?.host, local.host, remote.host, hasBase),
    port: mergeFieldV2(ctx, 'port', '端口', base?.port, local.port, remote.port, hasBase),
    username: mergeFieldV2(
      ctx,
      'username',
      '用户名 / Key ID',
      base?.username,
      local.username,
      remote.username,
      hasBase
    ),
    initialPath: mergeFieldV2(
      ctx,
      'initialPath',
      '默认目录',
      base?.initialPath,
      local.initialPath,
      remote.initialPath,
      hasBase
    ),
    notes: mergeFieldV2(ctx, 'notes', '备注', base?.notes, local.notes, remote.notes, hasBase),
    favorite: mergeFieldV2(ctx, 'favorite', '收藏', base?.favorite, local.favorite, remote.favorite, hasBase),
    options: mergedOptions,
    ...(cleanSecrets ? { secrets: cleanSecrets } : {})
  }
}

function mergeRdpProfiles(
  base: WireRdpProfile | undefined,
  local: WireRdpProfile,
  remote: WireRdpProfile,
  hasBase: boolean,
  conflicts: SyncConflict[],
  resolutions: Record<string, 'local' | 'remote'>
): WireRdpProfile {
  const ctx = {
    namespace: 'protocols' as const,
    entityType: 'rdpProfile' as const,
    entityId: local.id,
    entityName: local.name || remote.name,
    conflicts,
    resolutions
  }
  const extra = {
    ...(stripKeys(remote, [
      'id',
      'name',
      'host',
      'port',
      'domain',
      'username',
      'linkedHostId',
      'notes',
      'favorite',
      'options',
      'secrets',
      'updatedAt'
    ]) ?? {}),
    ...(stripKeys(local, [
      'id',
      'name',
      'host',
      'port',
      'domain',
      'username',
      'linkedHostId',
      'notes',
      'favorite',
      'options',
      'secrets',
      'updatedAt'
    ]) ?? {})
  }

  const mergedPassword = mergeFieldV2(
    ctx,
    'secrets.password',
    'RDP 密码',
    base?.secrets?.password ?? '',
    local.secrets?.password ?? '',
    remote.secrets?.password ?? '',
    hasBase,
    true
  )
  const nextSecrets: WireRdpProfileSecrets = {
    ...(stripKeys(remote.secrets ?? {}, ['password']) ?? {}),
    ...(stripKeys(local.secrets ?? {}, ['password']) ?? {})
  }
  if (mergedPassword) nextSecrets.password = mergedPassword
  const cleanSecrets = sanitizeRdpSecrets(nextSecrets)

  const mergedOptions = mergeFieldV2(
    ctx,
    'options',
    'RDP 选项',
    base?.options,
    local.options,
    remote.options,
    hasBase
  )

  return {
    ...extra,
    id: local.id,
    name: mergeFieldV2(ctx, 'name', '名称', base?.name, local.name, remote.name, hasBase),
    host: mergeFieldV2(ctx, 'host', '远程主机地址', base?.host, local.host, remote.host, hasBase),
    port: mergeFieldV2(ctx, 'port', 'RDP 端口', base?.port, local.port, remote.port, hasBase),
    domain: mergeFieldV2(ctx, 'domain', '域 (Domain)', base?.domain, local.domain, remote.domain, hasBase),
    username: mergeFieldV2(
      ctx,
      'username',
      '用户名',
      base?.username,
      local.username,
      remote.username,
      hasBase
    ),
    linkedHostId: mergeFieldV2(
      ctx,
      'linkedHostId',
      '关联 SSH 主机',
      base?.linkedHostId ?? null,
      local.linkedHostId ?? null,
      remote.linkedHostId ?? null,
      hasBase
    ),
    notes: mergeFieldV2(ctx, 'notes', '备注', base?.notes, local.notes, remote.notes, hasBase),
    favorite: mergeFieldV2(ctx, 'favorite', '收藏', base?.favorite, local.favorite, remote.favorite, hasBase),
    options: mergedOptions,
    ...(cleanSecrets ? { secrets: cleanSecrets } : {})
  }
}

function mergeKnownRdpHosts(
  base: WireKnownRdpHost | undefined,
  local: WireKnownRdpHost,
  remote: WireKnownRdpHost,
  hasBase: boolean,
  conflicts: SyncConflict[],
  resolutions: Record<string, 'local' | 'remote'>
): WireKnownRdpHost {
  const ctx = {
    namespace: 'protocols' as const,
    entityType: 'knownRdpHost' as const,
    entityId: local.id,
    entityName: `${local.host}:${local.port}`,
    conflicts,
    resolutions
  }
  const mergedFingerprint = mergeFieldV2(
    ctx,
    'fingerprint',
    'RDP TLS 证书指纹',
    base?.fingerprint,
    local.fingerprint,
    remote.fingerprint,
    hasBase
  )
  const winner =
    mergedFingerprint === remote.fingerprint && mergedFingerprint !== local.fingerprint ? remote : local
  return {
    ...winner,
    id: local.id,
    host: local.host,
    port: local.port,
    fingerprint: mergedFingerprint
  }
}

export function threeWayMergeProtocols(params: {
  localSource: LocalProtocolsSyncSource
  baseDoc: SyncDocumentProtocolsV2 | null
  remoteDoc: SyncDocumentProtocolsV2 | null
  resolutions?: Record<string, 'local' | 'remote'>
  nowIso?: string
}): ProtocolsMergeResult {
  const nowIso = params.nowIso ?? new Date().toISOString()
  const resolutions = params.resolutions ?? {}
  const localDoc = buildLocalProtocolsDocument(params.localSource, nowIso)
  const localFileMap = new Map(params.localSource.fileProfiles.map((p) => [p.id, p]))
  const localRdpMap = new Map(params.localSource.rdpProfiles.map((p) => [p.id, p]))

  if (!params.remoteDoc) {
    return buildProtocolsResultFromMerged({
      merged: localDoc,
      remoteDoc: null,
      conflicts: [],
      deletedFileProfileIds: [],
      deletedRdpProfileIds: [],
      deletedKnownRdpHostIds: [],
      localFileMap,
      localRdpMap,
      source: params.localSource,
      nowIso
    })
  }

  const remote = params.remoteDoc
  const base = params.baseDoc
  const hasBase = Boolean(base)
  const conflicts: SyncConflict[] = []

  const prefCtx = {
    namespace: 'protocols' as const,
    entityType: 'preferences' as const,
    entityId: 'protocols',
    entityName: '多协议同步偏好',
    conflicts,
    resolutions
  }

  // On initial onboarding (no base & no local profiles), cleanly adopt remote credential sync flags
  const noLocalFiles = params.localSource.fileProfiles.length === 0
  const noLocalRdps = params.localSource.rdpProfiles.length === 0

  const mergedPrefs: WireProtocolsPreferences = {
    ...(stripKeys(remote.preferences, ['syncFileCredentials', 'syncRdpCredentials']) ?? {}),
    ...(stripKeys(localDoc.preferences, ['syncFileCredentials', 'syncRdpCredentials']) ?? {}),
    syncFileCredentials: mergeFieldV2(
      prefCtx,
      'syncFileCredentials',
      '文件协议凭据加密同步',
      base?.preferences.syncFileCredentials,
      localDoc.preferences.syncFileCredentials,
      remote.preferences.syncFileCredentials,
      hasBase,
      false,
      noLocalFiles ? false : undefined
    ),
    syncRdpCredentials: mergeFieldV2(
      prefCtx,
      'syncRdpCredentials',
      'RDP 密码加密同步',
      base?.preferences.syncRdpCredentials,
      localDoc.preferences.syncRdpCredentials,
      remote.preferences.syncRdpCredentials,
      hasBase,
      false,
      noLocalRdps ? false : undefined
    )
  }

  const fileRes = mergeCollectionV2(
    'protocols',
    'fileProfile',
    (item) => item.id,
    (item) => item.name,
    base?.fileProfiles ?? [],
    localDoc.fileProfiles,
    remote.fileProfiles,
    hasBase,
    (b, l, r) => mergeFileProfiles(b, l, r, hasBase, conflicts, resolutions),
    conflicts,
    resolutions
  )

  const rdpRes = mergeCollectionV2(
    'protocols',
    'rdpProfile',
    (item) => item.id,
    (item) => item.name,
    base?.rdpProfiles ?? [],
    localDoc.rdpProfiles,
    remote.rdpProfiles,
    hasBase,
    (b, l, r) => mergeRdpProfiles(b, l, r, hasBase, conflicts, resolutions),
    conflicts,
    resolutions
  )

  const knownRes = mergeCollectionV2(
    'protocols',
    'knownRdpHost',
    (item) => item.id,
    (item) => `${item.host}:${item.port}`,
    base?.knownRdpHosts ?? [],
    localDoc.knownRdpHosts,
    remote.knownRdpHosts,
    hasBase,
    (b, l, r) => mergeKnownRdpHosts(b, l, r, hasBase, conflicts, resolutions),
    conflicts,
    resolutions
  )

  const merged: SyncDocumentProtocolsV2 = {
    ...(stripKeys(remote, [
      'schemaVersion',
      'updatedAt',
      'preferences',
      'fileProfiles',
      'rdpProfiles',
      'knownRdpHosts'
    ]) ?? {}),
    ...(stripKeys(localDoc, [
      'schemaVersion',
      'updatedAt',
      'preferences',
      'fileProfiles',
      'rdpProfiles',
      'knownRdpHosts'
    ]) ?? {}),
    schemaVersion: SYNC_NAMESPACE_SCHEMA_VERSION,
    updatedAt: nowIso,
    preferences: mergedPrefs,
    fileProfiles: fileRes.items,
    rdpProfiles: rdpRes.items,
    knownRdpHosts: knownRes.items
  }

  if (!mergedPrefs.syncFileCredentials) {
    merged.fileProfiles = merged.fileProfiles.map((item) => {
      const next = { ...item }
      delete next.secrets
      return next
    })
  }
  if (!mergedPrefs.syncRdpCredentials) {
    merged.rdpProfiles = merged.rdpProfiles.map((item) => {
      const secrets = stripRdpPasswordSecret(item.secrets)
      const next = { ...item }
      if (secrets) next.secrets = secrets
      else delete next.secrets
      return next
    })
  }

  return buildProtocolsResultFromMerged({
    merged,
    remoteDoc: remote,
    conflicts,
    deletedFileProfileIds: fileRes.deletedLocalIds,
    deletedRdpProfileIds: rdpRes.deletedLocalIds,
    deletedKnownRdpHostIds: knownRes.deletedLocalIds,
    localFileMap,
    localRdpMap,
    source: params.localSource,
    nowIso
  })
}

function buildProtocolsResultFromMerged(input: {
  merged: SyncDocumentProtocolsV2
  remoteDoc: SyncDocumentProtocolsV2 | null
  conflicts: SyncConflict[]
  deletedFileProfileIds: string[]
  deletedRdpProfileIds: string[]
  deletedKnownRdpHostIds: string[]
  localFileMap: Map<string, FileProfile>
  localRdpMap: Map<string, RdpProfile>
  source: LocalProtocolsSyncSource
  nowIso: string
}): ProtocolsMergeResult {
  const {
    merged,
    remoteDoc,
    conflicts,
    deletedFileProfileIds,
    deletedRdpProfileIds,
    deletedKnownRdpHostIds,
    localFileMap,
    localRdpMap,
    source,
    nowIso
  } = input

  const needsUpload = !remoteDoc || !protocolsDocumentsLogicallyEqual(merged, remoteDoc)
  if (!needsUpload && remoteDoc) {
    merged.updatedAt = remoteDoc.updatedAt
  }

  const localFileProfileUpdates: LocalMergedFileProfile[] = merged.fileProfiles.map((wire) => {
    const existing = localFileMap.get(wire.id)
    const wireSecrets = sanitizeFileSecrets(wire.secrets) ?? null
    const localExistingSecrets = sanitizeFileSecrets(source.plaintextFileSecrets[wire.id]) ?? null
    const effectiveSecrets = merged.preferences.syncFileCredentials ? wireSecrets : localExistingSecrets
    const secretsTouched = merged.preferences.syncFileCredentials
      ? !canonicalEquals(wireSecrets, localExistingSecrets)
      : false
    const profile: FileProfile = {
      id: wire.id,
      name: wire.name,
      protocol: wire.protocol,
      host: wire.host,
      port: wire.port,
      username: wire.username,
      initialPath: wire.initialPath,
      notes: wire.notes,
      favorite: wire.favorite,
      options: { ...wire.options },
      hasSecrets:
        Boolean(effectiveSecrets) ||
        (!merged.preferences.syncFileCredentials && Boolean(existing?.hasSecrets)),
      updatedAt: existing?.updatedAt ?? nowIso
    }
    return {
      profile,
      plaintextSecrets: effectiveSecrets,
      secretsTouched
    }
  })

  const localRdpProfileUpdates: LocalMergedRdpProfile[] = merged.rdpProfiles.map((wire) => {
    const existing = localRdpMap.get(wire.id)
    const wirePassword = wire.secrets?.password ?? null
    const localExistingPw = source.plaintextRdpPasswords[wire.id] ?? null
    const effectivePassword = merged.preferences.syncRdpCredentials ? wirePassword : localExistingPw
    const passwordTouched = merged.preferences.syncRdpCredentials ? wirePassword !== localExistingPw : false
    const profile: RdpProfile = {
      id: wire.id,
      name: wire.name,
      host: wire.host,
      port: wire.port,
      domain: wire.domain,
      username: wire.username,
      ...(wire.linkedHostId ? { linkedHostId: wire.linkedHostId } : {}),
      notes: wire.notes,
      favorite: wire.favorite,
      options: { ...wire.options },
      hasPassword:
        Boolean(effectivePassword) ||
        (!merged.preferences.syncRdpCredentials && Boolean(existing?.hasPassword)),
      updatedAt: existing?.updatedAt ?? nowIso
    }
    return {
      profile,
      plaintextPassword: effectivePassword,
      passwordTouched
    }
  })

  const localKnownRdpHosts: KnownRdpHostEntry[] = merged.knownRdpHosts.map((entry) => ({
    id: entry.id,
    host: entry.host,
    port: entry.port,
    fingerprint: entry.fingerprint,
    subject: entry.subject,
    issuer: entry.issuer,
    validFrom: entry.validFrom,
    validTo: entry.validTo,
    acceptedAt: entry.acceptedAt
  }))

  return {
    merged,
    conflicts,
    needsUpload,
    localFileProfileUpdates,
    deletedFileProfileIds,
    localRdpProfileUpdates,
    deletedRdpProfileIds,
    localKnownRdpHosts,
    deletedKnownRdpHostIds,
    nextPreferences: {
      syncFileCredentials: merged.preferences.syncFileCredentials,
      syncRdpCredentials: merged.preferences.syncRdpCredentials
    }
  }
}

/* ================================================================== */
/* Settings namespace (`settings`, schemaVersion = 2)                  */
/* ================================================================== */

export function stripMachineLocalRdpSettings(rdp: RdpSettings): SyncedRdpSettings {
  const { externalClientPath: _ext, sharedDrivePath: _drv, ...synced } = rdp
  return synced
}

const DEFAULT_SYNCED_RDP_SETTINGS: SyncedRdpSettings = stripMachineLocalRdpSettings(DEFAULT_RDP_SETTINGS)

function canonicalSettingsWithoutTimestamp(doc: SyncDocumentSettingsV2): unknown {
  return stableClone({ ...doc, updatedAt: '' })
}

export function settingsDocumentsLogicallyEqual(
  a: SyncDocumentSettingsV2,
  b: SyncDocumentSettingsV2
): boolean {
  return (
    JSON.stringify(canonicalSettingsWithoutTimestamp(a)) ===
    JSON.stringify(canonicalSettingsWithoutTimestamp(b))
  )
}

export function buildLocalSettingsDocument(
  source: LocalSettingsSyncSource,
  updatedAt = new Date().toISOString()
): SyncDocumentSettingsV2 {
  return {
    ...(source.docExtra ?? {}),
    schemaVersion: SYNC_NAMESPACE_SCHEMA_VERSION,
    updatedAt,
    preferences: {
      syncProtocolSettings: source.preferences.syncProtocolSettings
    },
    protocolSettings: {
      ssh: normalizeProtocolSettings('ssh', source.protocolSettings.ssh),
      files: normalizeProtocolSettings('files', source.protocolSettings.files),
      rdp: stripMachineLocalRdpSettings(normalizeProtocolSettings('rdp', source.protocolSettings.rdp))
    }
  }
}

export function normalizeRemoteSettingsDocument(raw: Record<string, unknown>): SyncDocumentSettingsV2 {
  const rawPrefs = (raw.preferences && typeof raw.preferences === 'object' ? raw.preferences : {}) as Record<
    string,
    unknown
  >
  const preferences: WireSettingsPreferences = {
    ...(stripKeys(rawPrefs, ['syncProtocolSettings']) ?? {}),
    syncProtocolSettings:
      rawPrefs.syncProtocolSettings !== undefined ? Boolean(rawPrefs.syncProtocolSettings) : true
  }

  const rawProto = (
    raw.protocolSettings && typeof raw.protocolSettings === 'object' ? raw.protocolSettings : {}
  ) as Record<string, unknown>
  const ssh = normalizeProtocolSettings('ssh', rawProto.ssh)
  const files = normalizeProtocolSettings('files', rawProto.files)
  const rdpFull = normalizeProtocolSettings('rdp', rawProto.rdp)
  const docExtra = stripKeys(raw, ['schemaVersion', 'updatedAt', 'preferences', 'protocolSettings'])

  return {
    ...(docExtra ?? {}),
    schemaVersion: SYNC_NAMESPACE_SCHEMA_VERSION,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    preferences,
    protocolSettings: {
      ssh,
      files,
      rdp: stripMachineLocalRdpSettings(rdpFull)
    }
  }
}

const SSH_FIELD_LABELS: Record<keyof SshSettings, string> = {
  defaultPort: 'SSH 默认端口',
  defaultKeepaliveSec: 'SSH 默认保活间隔'
}

const FILES_FIELD_LABELS: Record<keyof FilesSettings, string> = {
  maxConcurrentTransfers: '文件最大并发传输数',
  speedLimitKBps: '文件传输限速 (KB/s)',
  defaultConflict: '文件默认冲突策略',
  showHidden: '默认显示隐藏文件',
  confirmDelete: '删除前确认',
  connectTimeoutSec: '文件连接超时(秒)',
  s3PartSizeMiB: 'S3 分片大小 (MiB)',
  s3DefaultPathStyle: 'S3 默认路径风格'
}

const RDP_FIELD_LABELS: Record<keyof SyncedRdpSettings, string> = {
  preferredMode: 'RDP 默认启动方案',
  autoFallbackToEmbedded: 'RDP 缺失自动回退内嵌引擎',
  resolutionMode: 'RDP 分辨率模式',
  defaultWidth: 'RDP 默认宽度',
  defaultHeight: 'RDP 默认高度',
  colorDepth: 'RDP 色彩深度',
  qualityPreset: 'RDP 画质预设',
  securityLayer: 'RDP 安全协议层',
  certPolicy: 'RDP 证书校验策略',
  enableClipboard: 'RDP 剪贴板共享',
  enableAudio: 'RDP 音频重定向',
  driveRedirect: 'RDP 磁盘共享模式',
  connectTimeoutSec: 'RDP 连接超时(秒)'
}

export function threeWayMergeSettings(params: {
  localSource: LocalSettingsSyncSource
  baseDoc: SyncDocumentSettingsV2 | null
  remoteDoc: SyncDocumentSettingsV2 | null
  resolutions?: Record<string, 'local' | 'remote'>
  nowIso?: string
}): SettingsMergeResult {
  const nowIso = params.nowIso ?? new Date().toISOString()
  const resolutions = params.resolutions ?? {}
  const localDoc = buildLocalSettingsDocument(params.localSource, nowIso)
  const localRdpFull = normalizeProtocolSettings('rdp', params.localSource.protocolSettings.rdp)

  if (!params.remoteDoc) {
    return {
      merged: localDoc,
      conflicts: [],
      needsUpload: true,
      nextProtocolSettings: {
        ssh: localDoc.protocolSettings.ssh,
        files: localDoc.protocolSettings.files,
        rdp: {
          ...localDoc.protocolSettings.rdp,
          externalClientPath: localRdpFull.externalClientPath,
          sharedDrivePath: localRdpFull.sharedDrivePath
        }
      },
      nextPreferences: { syncProtocolSettings: localDoc.preferences.syncProtocolSettings }
    }
  }

  const remote = params.remoteDoc
  const base = params.baseDoc
  const hasBase = Boolean(base)
  const conflicts: SyncConflict[] = []

  const sshCtx = {
    namespace: 'settings' as const,
    entityType: 'protocolSettings' as const,
    entityId: 'ssh',
    entityName: 'SSH 协议设置',
    conflicts,
    resolutions
  }
  const mergedSsh = { ...localDoc.protocolSettings.ssh }
  for (const key of Object.keys(SSH_FIELD_LABELS) as Array<keyof SshSettings>) {
    ;(mergedSsh as Record<string, unknown>)[key] = mergeFieldV2(
      sshCtx,
      key,
      SSH_FIELD_LABELS[key],
      base?.protocolSettings.ssh[key],
      localDoc.protocolSettings.ssh[key],
      remote.protocolSettings.ssh[key],
      hasBase,
      false,
      DEFAULT_SSH_SETTINGS[key]
    )
  }

  const filesCtx = {
    namespace: 'settings' as const,
    entityType: 'protocolSettings' as const,
    entityId: 'files',
    entityName: '文件协议设置',
    conflicts,
    resolutions
  }
  const mergedFiles = { ...localDoc.protocolSettings.files }
  for (const key of Object.keys(FILES_FIELD_LABELS) as Array<keyof FilesSettings>) {
    ;(mergedFiles as Record<string, unknown>)[key] = mergeFieldV2(
      filesCtx,
      key,
      FILES_FIELD_LABELS[key],
      base?.protocolSettings.files[key],
      localDoc.protocolSettings.files[key],
      remote.protocolSettings.files[key],
      hasBase,
      false,
      DEFAULT_FILES_SETTINGS[key]
    )
  }

  const rdpCtx = {
    namespace: 'settings' as const,
    entityType: 'protocolSettings' as const,
    entityId: 'rdp',
    entityName: 'RDP 协议设置',
    conflicts,
    resolutions
  }
  const mergedRdp = { ...localDoc.protocolSettings.rdp }
  for (const key of Object.keys(RDP_FIELD_LABELS) as Array<keyof SyncedRdpSettings>) {
    ;(mergedRdp as Record<string, unknown>)[key] = mergeFieldV2(
      rdpCtx,
      key,
      RDP_FIELD_LABELS[key],
      base?.protocolSettings.rdp[key],
      localDoc.protocolSettings.rdp[key],
      remote.protocolSettings.rdp[key],
      hasBase,
      false,
      DEFAULT_SYNCED_RDP_SETTINGS[key]
    )
  }

  const merged: SyncDocumentSettingsV2 = {
    ...(stripKeys(remote, ['schemaVersion', 'updatedAt', 'preferences', 'protocolSettings']) ?? {}),
    ...(stripKeys(localDoc, ['schemaVersion', 'updatedAt', 'preferences', 'protocolSettings']) ?? {}),
    schemaVersion: SYNC_NAMESPACE_SCHEMA_VERSION,
    updatedAt: nowIso,
    preferences: {
      ...(stripKeys(remote.preferences, ['syncProtocolSettings']) ?? {}),
      ...(stripKeys(localDoc.preferences, ['syncProtocolSettings']) ?? {}),
      syncProtocolSettings: localDoc.preferences.syncProtocolSettings
    },
    protocolSettings: {
      ssh: mergedSsh,
      files: mergedFiles,
      rdp: mergedRdp
    }
  }

  const needsUpload = !settingsDocumentsLogicallyEqual(merged, remote)
  if (!needsUpload) {
    merged.updatedAt = remote.updatedAt
  }

  return {
    merged,
    conflicts,
    needsUpload,
    nextProtocolSettings: {
      ssh: mergedSsh,
      files: mergedFiles,
      rdp: {
        ...mergedRdp,
        externalClientPath: localRdpFull.externalClientPath,
        sharedDrivePath: localRdpFull.sharedDrivePath
      }
    },
    nextPreferences: {
      syncProtocolSettings: merged.preferences.syncProtocolSettings
    }
  }
}
