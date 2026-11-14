import type { Host } from '../../shared/contracts'
import {
  MAX_PRIVATE_KEY_BYTES,
  MAX_SYNC_HOSTS,
  SYNC_SCHEMA_VERSION,
  type HostSyncExtras,
  type SyncConflict,
  type SyncDocumentV1,
  type SyncGroup,
  type SyncTunnel,
  type WireGroup,
  type WirePreferences,
  type WireServer,
  type WireServerProfile,
  type WireServerSecrets,
  type WireTunnel
} from '../../shared/sync'

const KNOWN_TUNNEL_TYPES = new Set(['L', 'R', 'D'])

export interface LocalSyncSource {
  hosts: Array<Host & { syncExtras?: HostSyncExtras }>
  plaintextPasswords: Record<string, string>
  knownFingerprints: Record<string, string>
  groups: SyncGroup[]
  tunnels: SyncTunnel[]
  tunnelExtras: Record<string, Record<string, unknown>>
  groupExtras: Record<string, Record<string, unknown>>
  preferences: { syncPasswords: boolean; syncPrivateKeys: boolean }
  docExtra?: Record<string, unknown>
}

export interface MergeResult {
  merged: SyncDocumentV1
  conflicts: SyncConflict[]
  needsUpload: boolean
  localHostUpdates: LocalMergedHost[]
  deletedHostIds: string[]
  localGroups: Array<SyncGroup & { unknownExtra?: Record<string, unknown> }>
  localTunnels: Array<SyncTunnel & { unknownExtra?: Record<string, unknown> }>
  nextPreferences: { syncPasswords: boolean; syncPrivateKeys: boolean }
  remoteHostFingerprints: Array<{ address: string; port: number; fingerprint: string }>
}

export interface LocalMergedHost {
  host: Host
  syncExtras?: HostSyncExtras
  plaintextPassword?: string | null
  passwordTouched: boolean
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

export function canonicalEquals(a: unknown, b: unknown): boolean {
  return JSON.stringify(stableClone(a)) === JSON.stringify(stableClone(b))
}

function canonicalDocWithoutTimestamp(doc: SyncDocumentV1): unknown {
  const copy = { ...doc, updatedAt: '' }
  copy.servers = [...doc.servers].sort((a, b) => a.profile.id.localeCompare(b.profile.id))
  copy.tunnels = [...doc.tunnels].sort((a, b) => a.id.localeCompare(b.id))
  copy.groups = [...doc.groups].sort((a, b) => a.id.localeCompare(b.id))
  return stableClone(copy)
}

export function documentsLogicallyEqual(a: SyncDocumentV1, b: SyncDocumentV1): boolean {
  return JSON.stringify(canonicalDocWithoutTimestamp(a)) === JSON.stringify(canonicalDocWithoutTimestamp(b))
}

function sanitizeSecrets(raw?: Record<string, unknown>): WireServerSecrets | undefined {
  if (!raw) return undefined
  const out: WireServerSecrets = {}
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string' && v.length > 0) {
      out[k] = v
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function stripPasswordFromSecrets(secrets?: WireServerSecrets): WireServerSecrets | undefined {
  if (!secrets) return undefined
  const next: WireServerSecrets = { ...secrets }
  delete next.password
  delete next.passphrase
  return Object.keys(next).length > 0 ? next : undefined
}

export function buildLocalWireDocument(
  source: LocalSyncSource,
  updatedAt = new Date().toISOString()
): SyncDocumentV1 {
  if (source.hosts.length > MAX_SYNC_HOSTS) {
    throw new Error(`同步主机数量 ${source.hosts.length} 超出上限 ${MAX_SYNC_HOSTS}`)
  }
  const servers: WireServer[] = [...source.hosts]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((host) => {
      const extras = host.syncExtras
      const profileExtra = extras?.profileExtra ? { ...extras.profileExtra } : {}
      delete profileExtra.groupId
      const serverExtra = extras?.serverExtra ? { ...extras.serverExtra } : {}
      const fp =
        source.knownFingerprints[`${host.address}:${host.port}`] ??
        (typeof extras?.profileExtra?.hostFingerprint === 'string'
          ? extras.profileExtra.hostFingerprint
          : undefined)
      const profile: WireServerProfile = {
        ...profileExtra,
        id: host.id,
        name: host.name,
        host: host.address,
        port: host.port,
        username: host.username,
        authType: host.auth === 'password' ? 'password' : (extras?.rawAuthType ?? 'key'),
        hostFingerprint: fp ?? null,
        keepalive: typeof host.keepalive === 'number' ? host.keepalive : 30
      }
      const nextSecrets: WireServerSecrets = extras?.secrets ? { ...extras.secrets } : {}
      if (source.preferences.syncPasswords) {
        const plainPw = source.plaintextPasswords[host.id]
        if (plainPw) {
          nextSecrets.password = plainPw
        } else {
          delete nextSecrets.password
        }
      } else {
        delete nextSecrets.password
        delete nextSecrets.passphrase
      }
      if (
        typeof nextSecrets.privateKey === 'string' &&
        Buffer.byteLength(nextSecrets.privateKey, 'utf8') > MAX_PRIVATE_KEY_BYTES
      ) {
        throw new Error(`主机 ${host.name} 的私钥体积超过 256 KiB 限制`)
      }
      const cleanSecrets = sanitizeSecrets(nextSecrets)
      const server: WireServer = {
        ...serverExtra,
        profile,
        ...(cleanSecrets ? { secrets: cleanSecrets } : {})
      }
      return server
    })

  const groups: WireGroup[] = [...source.groups]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((group) => ({
      ...(source.groupExtras[group.id] ?? {}),
      id: group.id,
      name: group.name,
      color: group.color
    }))

  const tunnels: WireTunnel[] = [...source.tunnels]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((tunnel) => ({
      ...(source.tunnelExtras[tunnel.id] ?? {}),
      id: tunnel.id,
      name: tunnel.name,
      serverId: tunnel.serverId,
      groupId: tunnel.groupId ?? null,
      type: tunnel.type,
      listenHost: tunnel.listenHost,
      listenPort: tunnel.listenPort,
      destHost: tunnel.destHost,
      destPort: tunnel.destPort,
      destServerId: tunnel.destServerId ?? '',
      autoReconnect: tunnel.autoReconnect,
      enabled: tunnel.enabled
    }))

  return {
    ...(source.docExtra ?? {}),
    schemaVersion: SYNC_SCHEMA_VERSION,
    updatedAt,
    preferences: {
      syncPasswords: source.preferences.syncPasswords,
      syncPrivateKeys: source.preferences.syncPrivateKeys
    },
    servers,
    tunnels,
    groups
  }
}

export function normalizeRemoteDocument(raw: Record<string, unknown>): SyncDocumentV1 {
  const rawPrefs = (raw.preferences && typeof raw.preferences === 'object' ? raw.preferences : {}) as Record<
    string,
    unknown
  >
  const preferences: WirePreferences = {
    ...(stripKeys(rawPrefs, ['syncPasswords', 'syncPrivateKeys']) ?? {}),
    syncPasswords: Boolean(rawPrefs.syncPasswords),
    syncPrivateKeys: Boolean(rawPrefs.syncPrivateKeys)
  }

  const rawServers = Array.isArray(raw.servers) ? raw.servers : []
  const servers: WireServer[] = rawServers
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => {
      const rawProfile = (item.profile && typeof item.profile === 'object' ? item.profile : item) as Record<
        string,
        unknown
      >
      const id = String(rawProfile.id ?? item.id ?? '')
      const profileExtra = stripKeys(rawProfile, [
        'id',
        'name',
        'host',
        'port',
        'username',
        'authType',
        'hostFingerprint',
        'keepalive',
        'groupId'
      ])
      const serverExtra = stripKeys(item, [
        'id',
        'profile',
        'secrets',
        'password',
        'privateKey',
        'keyPassphrase'
      ])
      const rawSecrets =
        item.secrets && typeof item.secrets === 'object' && !Array.isArray(item.secrets)
          ? { ...(item.secrets as Record<string, unknown>) }
          : {}
      // Accept legacy flat secret fields when importing older fixtures while normalizing onto wire `secrets`
      if (rawSecrets.password === undefined && typeof item.password === 'string') {
        rawSecrets.password = item.password
      }
      if (rawSecrets.privateKey === undefined && typeof item.privateKey === 'string') {
        rawSecrets.privateKey = item.privateKey
      }
      if (rawSecrets.passphrase === undefined && typeof item.keyPassphrase === 'string') {
        rawSecrets.passphrase = item.keyPassphrase
      }
      const cleanSecrets = sanitizeSecrets(rawSecrets)
      const port =
        typeof rawProfile.port === 'number' && rawProfile.port >= 1 && rawProfile.port <= 65535
          ? Math.trunc(rawProfile.port)
          : 22
      const keepalive =
        typeof rawProfile.keepalive === 'number' && rawProfile.keepalive >= 0 && rawProfile.keepalive <= 3600
          ? Math.trunc(rawProfile.keepalive)
          : 30
      return {
        ...(serverExtra ?? {}),
        profile: {
          ...(profileExtra ?? {}),
          id,
          name: String(rawProfile.name ?? '未命名主机').slice(0, 80),
          host: String(rawProfile.host ?? rawProfile.address ?? '').trim(),
          port,
          username: String(rawProfile.username ?? 'root').trim() || 'root',
          authType: String(rawProfile.authType ?? 'password'),
          hostFingerprint:
            typeof rawProfile.hostFingerprint === 'string' && rawProfile.hostFingerprint
              ? rawProfile.hostFingerprint
              : null,
          keepalive
        },
        ...(cleanSecrets ? { secrets: cleanSecrets } : {})
      } satisfies WireServer
    })
    .filter((s) => s.profile.id && s.profile.host)

  const rawGroups = Array.isArray(raw.groups) ? raw.groups : []
  const groups: WireGroup[] = rawGroups
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      ...(stripKeys(item, ['id', 'name', 'color']) ?? {}),
      id: String(item.id ?? ''),
      name: String(item.name ?? '默认分组').slice(0, 60),
      color: typeof item.color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(item.color) ? item.color : '#3B82F6'
    }))
    .filter((g) => g.id)

  const rawTunnels = Array.isArray(raw.tunnels) ? raw.tunnels : []
  const tunnels: WireTunnel[] = rawTunnels
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      ...(stripKeys(item, [
        'id',
        'name',
        'serverId',
        'groupId',
        'type',
        'listenHost',
        'listenPort',
        'destHost',
        'destPort',
        'destServerId',
        'autoReconnect',
        'enabled'
      ]) ?? {}),
      id: String(item.id ?? ''),
      name: String(item.name ?? '未命名隧道').slice(0, 80),
      serverId: String(item.serverId ?? ''),
      groupId: typeof item.groupId === 'string' && item.groupId ? item.groupId : null,
      type: String(item.type ?? 'L'),
      listenHost: String(item.listenHost ?? '127.0.0.1'),
      listenPort: typeof item.listenPort === 'number' ? Math.trunc(item.listenPort) : 0,
      destHost: String(item.destHost ?? '127.0.0.1'),
      destPort: typeof item.destPort === 'number' ? Math.trunc(item.destPort) : 0,
      destServerId: typeof item.destServerId === 'string' ? item.destServerId : '',
      autoReconnect: item.autoReconnect !== undefined ? Boolean(item.autoReconnect) : true,
      enabled: Boolean(item.enabled)
    }))
    .filter((t) => t.id)

  const docExtra = stripKeys(raw, [
    'schemaVersion',
    'updatedAt',
    'preferences',
    'servers',
    'tunnels',
    'groups'
  ])
  return {
    ...(docExtra ?? {}),
    schemaVersion: SYNC_SCHEMA_VERSION,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    preferences,
    servers,
    tunnels,
    groups
  }
}

function maskValue(value: unknown, isSecret: boolean): string {
  if (isSecret) {
    if (typeof value !== 'string' || value.length === 0) return '（未设置）'
    return `已设置（••••••，${value.length} 位）`
  }
  if (value === null || value === undefined || value === '') return '（空）'
  if (typeof value === 'boolean') return value ? '开启' : '关闭'
  return String(value)
}

function mergeField<T>(
  ctx: {
    entityType: SyncConflict['entityType']
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
  isSecret = false
): T {
  if (canonicalEquals(localVal, remoteVal)) return localVal
  if (!hasBase) {
    const conflictId = `${ctx.entityType}:${ctx.entityId}:${field}`
    const resolved = ctx.resolutions[conflictId]
    if (resolved === 'local') return localVal
    if (resolved === 'remote') return remoteVal
    ctx.conflicts.push({
      id: conflictId,
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

function mergeServers(
  base: WireServer | undefined,
  local: WireServer,
  remote: WireServer,
  hasBase: boolean,
  conflicts: SyncConflict[],
  resolutions: Record<string, 'local' | 'remote'>
): WireServer {
  const serverId = local.profile.id
  const ctx = {
    entityType: 'server' as const,
    entityId: serverId,
    entityName: local.profile.name || remote.profile.name,
    conflicts,
    resolutions
  }
  const profileExtra = {
    ...(stripKeys(remote.profile, [
      'id',
      'name',
      'host',
      'port',
      'username',
      'authType',
      'hostFingerprint',
      'keepalive',
      'groupId'
    ]) ?? {}),
    ...(stripKeys(local.profile, [
      'id',
      'name',
      'host',
      'port',
      'username',
      'authType',
      'hostFingerprint',
      'keepalive',
      'groupId'
    ]) ?? {})
  }
  const serverExtra = {
    ...(stripKeys(remote, ['id', 'profile', 'secrets', 'password', 'privateKey', 'keyPassphrase']) ?? {}),
    ...(stripKeys(local, ['id', 'profile', 'secrets', 'password', 'privateKey', 'keyPassphrase']) ?? {})
  }
  const mergedPassword = mergeField(
    ctx,
    'password',
    'SSH 密码',
    base?.secrets?.password ?? '',
    local.secrets?.password ?? '',
    remote.secrets?.password ?? '',
    hasBase,
    true
  )
  const mergedPassphrase = mergeField(
    ctx,
    'keyPassphrase',
    '私钥口令',
    base?.secrets?.passphrase ?? '',
    local.secrets?.passphrase ?? '',
    remote.secrets?.passphrase ?? '',
    hasBase,
    true
  )
  const mergedPrivateKey = mergeField(
    ctx,
    'privateKey',
    '远端私钥字段',
    base?.secrets?.privateKey ?? '',
    local.secrets?.privateKey ?? '',
    remote.secrets?.privateKey ?? '',
    hasBase,
    true
  )
  const secretSource =
    mergedPrivateKey && mergedPrivateKey === remote.secrets?.privateKey ? remote.secrets : local.secrets
  const nextSecrets: WireServerSecrets = {
    ...(stripKeys(remote.secrets ?? {}, ['password', 'passphrase', 'privateKey']) ?? {}),
    ...(stripKeys(local.secrets ?? {}, ['password', 'passphrase', 'privateKey']) ?? {}),
    ...(secretSource?.privateKeyEncoding ? { privateKeyEncoding: secretSource.privateKeyEncoding } : {}),
    ...(secretSource?.privateKeyFormat ? { privateKeyFormat: secretSource.privateKeyFormat } : {}),
    ...(secretSource?.privateKeyFingerprint
      ? { privateKeyFingerprint: secretSource.privateKeyFingerprint }
      : {})
  }
  if (mergedPassword) nextSecrets.password = mergedPassword
  if (mergedPassphrase) nextSecrets.passphrase = mergedPassphrase
  if (mergedPrivateKey) nextSecrets.privateKey = mergedPrivateKey
  const cleanSecrets = sanitizeSecrets(nextSecrets)

  return {
    ...serverExtra,
    profile: {
      ...profileExtra,
      id: serverId,
      name: mergeField(
        ctx,
        'profile.name',
        '主机名称',
        base?.profile.name,
        local.profile.name,
        remote.profile.name,
        hasBase
      ),
      host: mergeField(
        ctx,
        'profile.host',
        '服务器地址',
        base?.profile.host,
        local.profile.host,
        remote.profile.host,
        hasBase
      ),
      port: mergeField(
        ctx,
        'profile.port',
        '端口',
        base?.profile.port,
        local.profile.port,
        remote.profile.port,
        hasBase
      ),
      username: mergeField(
        ctx,
        'profile.username',
        '用户名',
        base?.profile.username,
        local.profile.username,
        remote.profile.username,
        hasBase
      ),
      authType: mergeField(
        ctx,
        'profile.authType',
        '认证方式',
        base?.profile.authType,
        local.profile.authType,
        remote.profile.authType,
        hasBase
      ),
      hostFingerprint: mergeField(
        ctx,
        'profile.hostFingerprint',
        '主机指纹',
        base?.profile.hostFingerprint ?? null,
        local.profile.hostFingerprint ?? null,
        remote.profile.hostFingerprint ?? null,
        hasBase
      ),
      keepalive: mergeField(
        ctx,
        'profile.keepalive',
        '保活间隔(秒)',
        base?.profile.keepalive,
        local.profile.keepalive,
        remote.profile.keepalive,
        hasBase
      )
    },
    ...(cleanSecrets ? { secrets: cleanSecrets } : {})
  }
}

function mergeGroups(
  base: WireGroup | undefined,
  local: WireGroup,
  remote: WireGroup,
  hasBase: boolean,
  conflicts: SyncConflict[],
  resolutions: Record<string, 'local' | 'remote'>
): WireGroup {
  const ctx = {
    entityType: 'group' as const,
    entityId: local.id,
    entityName: local.name || remote.name,
    conflicts,
    resolutions
  }
  const extra = {
    ...(stripKeys(remote, ['id', 'name', 'color']) ?? {}),
    ...(stripKeys(local, ['id', 'name', 'color']) ?? {})
  }
  return {
    ...extra,
    id: local.id,
    name: mergeField(ctx, 'name', '分组名称', base?.name, local.name, remote.name, hasBase),
    color: mergeField(ctx, 'color', '分组颜色', base?.color, local.color, remote.color, hasBase)
  }
}

function mergeTunnels(
  base: WireTunnel | undefined,
  local: WireTunnel,
  remote: WireTunnel,
  hasBase: boolean,
  conflicts: SyncConflict[],
  resolutions: Record<string, 'local' | 'remote'>
): WireTunnel {
  const ctx = {
    entityType: 'tunnel' as const,
    entityId: local.id,
    entityName: local.name || remote.name,
    conflicts,
    resolutions
  }
  const extra = {
    ...(stripKeys(remote, [
      'id',
      'name',
      'serverId',
      'groupId',
      'type',
      'listenHost',
      'listenPort',
      'destHost',
      'destPort',
      'destServerId',
      'autoReconnect',
      'enabled'
    ]) ?? {}),
    ...(stripKeys(local, [
      'id',
      'name',
      'serverId',
      'groupId',
      'type',
      'listenHost',
      'listenPort',
      'destHost',
      'destPort',
      'destServerId',
      'autoReconnect',
      'enabled'
    ]) ?? {})
  }
  return {
    ...extra,
    id: local.id,
    name: mergeField(ctx, 'name', '隧道名称', base?.name, local.name, remote.name, hasBase),
    serverId: mergeField(
      ctx,
      'serverId',
      '关联服务器',
      base?.serverId,
      local.serverId,
      remote.serverId,
      hasBase
    ),
    groupId: mergeField(
      ctx,
      'groupId',
      '所属分组',
      base?.groupId ?? null,
      local.groupId ?? null,
      remote.groupId ?? null,
      hasBase
    ),
    type: mergeField(ctx, 'type', '隧道类型', base?.type, local.type, remote.type, hasBase),
    listenHost: mergeField(
      ctx,
      'listenHost',
      '监听地址',
      base?.listenHost,
      local.listenHost,
      remote.listenHost,
      hasBase
    ),
    listenPort: mergeField(
      ctx,
      'listenPort',
      '监听端口',
      base?.listenPort,
      local.listenPort,
      remote.listenPort,
      hasBase
    ),
    destHost: mergeField(
      ctx,
      'destHost',
      '目标地址',
      base?.destHost,
      local.destHost,
      remote.destHost,
      hasBase
    ),
    destPort: mergeField(
      ctx,
      'destPort',
      '目标端口',
      base?.destPort,
      local.destPort,
      remote.destPort,
      hasBase
    ),
    destServerId: mergeField(
      ctx,
      'destServerId',
      '目标服务器',
      base?.destServerId ?? '',
      local.destServerId ?? '',
      remote.destServerId ?? '',
      hasBase
    ),
    autoReconnect: mergeField(
      ctx,
      'autoReconnect',
      '自动重连',
      base?.autoReconnect,
      local.autoReconnect,
      remote.autoReconnect,
      hasBase
    ),
    enabled: mergeField(ctx, 'enabled', '启用状态', base?.enabled, local.enabled, remote.enabled, hasBase)
  }
}

function mergeCollection<T>(
  entityType: 'server' | 'tunnel' | 'group',
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

export function threeWayMerge(params: {
  localSource: LocalSyncSource
  baseDoc: SyncDocumentV1 | null
  remoteDoc: SyncDocumentV1 | null
  resolutions?: Record<string, 'local' | 'remote'>
  nowIso?: string
}): MergeResult {
  const nowIso = params.nowIso ?? new Date().toISOString()
  const resolutions = params.resolutions ?? {}
  const localDoc = buildLocalWireDocument(params.localSource, nowIso)
  const localHostMap = new Map(params.localSource.hosts.map((h) => [h.id, h]))

  if (!params.remoteDoc) {
    return buildResultFromMerged({
      merged: localDoc,
      remoteDoc: null,
      conflicts: [],
      deletedHostIds: [],
      localHostMap,
      source: params.localSource,
      nowIso
    })
  }

  const remote = params.remoteDoc
  const base = params.baseDoc
  const hasBase = Boolean(base)
  const conflicts: SyncConflict[] = []

  const prefCtx = {
    entityType: 'preferences' as const,
    entityId: 'global',
    entityName: '同步偏好',
    conflicts,
    resolutions
  }
  const mergedPrefs: WirePreferences = {
    ...(stripKeys(remote.preferences, ['syncPasswords', 'syncPrivateKeys']) ?? {}),
    ...(stripKeys(localDoc.preferences, ['syncPasswords', 'syncPrivateKeys']) ?? {}),
    syncPasswords: mergeField(
      prefCtx,
      'syncPasswords',
      '密码加密同步',
      base?.preferences.syncPasswords,
      localDoc.preferences.syncPasswords,
      remote.preferences.syncPasswords,
      hasBase
    ),
    syncPrivateKeys: base
      ? !canonicalEquals(remote.preferences.syncPrivateKeys, base.preferences.syncPrivateKeys)
        ? remote.preferences.syncPrivateKeys
        : localDoc.preferences.syncPrivateKeys
      : remote.preferences.syncPrivateKeys || localDoc.preferences.syncPrivateKeys
  }

  const serverRes = mergeCollection(
    'server',
    (s) => s.profile.id,
    (s) => s.profile.name,
    base?.servers ?? [],
    localDoc.servers,
    remote.servers,
    hasBase,
    (b, l, r) => mergeServers(b, l, r, hasBase, conflicts, resolutions),
    conflicts,
    resolutions
  )

  const groupRes = mergeCollection(
    'group',
    (g) => g.id,
    (g) => g.name,
    base?.groups ?? [],
    localDoc.groups,
    remote.groups,
    hasBase,
    (b, l, r) => mergeGroups(b, l, r, hasBase, conflicts, resolutions),
    conflicts,
    resolutions
  )

  const tunnelRes = mergeCollection(
    'tunnel',
    (t) => t.id,
    (t) => t.name,
    base?.tunnels ?? [],
    localDoc.tunnels,
    remote.tunnels,
    hasBase,
    (b, l, r) => mergeTunnels(b, l, r, hasBase, conflicts, resolutions),
    conflicts,
    resolutions
  )

  const merged: SyncDocumentV1 = {
    ...(stripKeys(remote, ['schemaVersion', 'updatedAt', 'preferences', 'servers', 'tunnels', 'groups']) ??
      {}),
    ...(stripKeys(localDoc, ['schemaVersion', 'updatedAt', 'preferences', 'servers', 'tunnels', 'groups']) ??
      {}),
    schemaVersion: SYNC_SCHEMA_VERSION,
    updatedAt: nowIso,
    preferences: mergedPrefs,
    servers: serverRes.items,
    tunnels: tunnelRes.items,
    groups: groupRes.items
  }

  if (!mergedPrefs.syncPasswords) {
    merged.servers = merged.servers.map((server) => {
      const secrets = stripPasswordFromSecrets(server.secrets)
      const next = { ...server }
      if (secrets) next.secrets = secrets
      else delete next.secrets
      return next
    })
  }

  return buildResultFromMerged({
    merged,
    remoteDoc: remote,
    conflicts,
    deletedHostIds: serverRes.deletedLocalIds,
    localHostMap,
    source: params.localSource,
    nowIso
  })
}

function buildResultFromMerged(input: {
  merged: SyncDocumentV1
  remoteDoc: SyncDocumentV1 | null
  conflicts: SyncConflict[]
  deletedHostIds: string[]
  localHostMap: Map<string, Host & { syncExtras?: HostSyncExtras }>
  source: LocalSyncSource
  nowIso: string
}): MergeResult {
  const { merged, remoteDoc, conflicts, deletedHostIds, localHostMap, source, nowIso } = input
  const needsUpload = !remoteDoc || !documentsLogicallyEqual(merged, remoteDoc)
  if (!needsUpload && remoteDoc) {
    merged.updatedAt = remoteDoc.updatedAt
  }

  const remoteHostFingerprints: Array<{ address: string; port: number; fingerprint: string }> = []
  const localHostUpdates: LocalMergedHost[] = merged.servers.map((wireServer) => {
    const serverId = wireServer.profile.id
    const existing = localHostMap.get(serverId)
    const profileExtra = stripKeys(wireServer.profile, [
      'id',
      'name',
      'host',
      'port',
      'username',
      'authType',
      'hostFingerprint',
      'keepalive',
      'groupId'
    ])
    const serverExtra = stripKeys(wireServer, [
      'id',
      'profile',
      'secrets',
      'password',
      'privateKey',
      'keyPassphrase'
    ])
    if (wireServer.profile.hostFingerprint) {
      remoteHostFingerprints.push({
        address: wireServer.profile.host,
        port: wireServer.profile.port,
        fingerprint: wireServer.profile.hostFingerprint
      })
    }
    const auth: 'password' | 'agent' = wireServer.profile.authType === 'password' ? 'password' : 'agent'
    const storedExtrasSecrets = stripPasswordFromSecrets(wireServer.secrets)
    const syncExtras: HostSyncExtras = {
      rawAuthType: wireServer.profile.authType !== 'password' ? wireServer.profile.authType : undefined,
      serverExtra,
      profileExtra: wireServer.profile.hostFingerprint
        ? { ...(profileExtra ?? {}), hostFingerprint: wireServer.profile.hostFingerprint }
        : profileExtra,
      secrets: storedExtrasSecrets
    }
    const wirePassword = wireServer.secrets?.password ?? null
    const wireHasPw = typeof wirePassword === 'string' && wirePassword.length > 0
    const localExistingPlain = source.plaintextPasswords[serverId]
    const effectivePlainPassword = merged.preferences.syncPasswords
      ? wirePassword
      : (localExistingPlain ?? null)
    const passwordTouched = merged.preferences.syncPasswords
      ? wirePassword !== (localExistingPlain ?? null)
      : false

    const host: Host = {
      id: serverId,
      name: wireServer.profile.name,
      address: wireServer.profile.host,
      port: wireServer.profile.port,
      username: wireServer.profile.username,
      auth,
      keepalive: wireServer.profile.keepalive,
      group: existing?.group ?? '',
      notes: existing?.notes ?? '',
      favorite: existing?.favorite ?? false,
      hasPassword:
        Boolean(effectivePlainPassword) ||
        (!merged.preferences.syncPasswords && Boolean(existing?.hasPassword)) ||
        wireHasPw,
      updatedAt: existing?.updatedAt ?? nowIso
    }

    return {
      host,
      syncExtras,
      plaintextPassword: effectivePlainPassword,
      passwordTouched
    }
  })

  const localGroups = merged.groups.map((g) => ({
    id: g.id,
    name: g.name,
    color: g.color,
    updatedAt: nowIso,
    unknownExtra: stripKeys(g, ['id', 'name', 'color'])
  }))

  const localTunnels = merged.tunnels.map((t) => ({
    id: t.id,
    name: t.name,
    serverId: t.serverId,
    groupId: t.groupId ?? null,
    type: t.type,
    listenHost: t.listenHost,
    listenPort: t.listenPort,
    destHost: t.destHost,
    destPort: t.destPort,
    destServerId: t.destServerId ? t.destServerId : null,
    autoReconnect: t.autoReconnect,
    enabled: t.enabled,
    readOnly: !KNOWN_TUNNEL_TYPES.has(t.type),
    updatedAt: nowIso,
    unknownExtra: stripKeys(t, [
      'id',
      'name',
      'serverId',
      'groupId',
      'type',
      'listenHost',
      'listenPort',
      'destHost',
      'destPort',
      'destServerId',
      'autoReconnect',
      'enabled'
    ])
  }))

  return {
    merged,
    conflicts,
    needsUpload,
    localHostUpdates,
    deletedHostIds,
    localGroups,
    localTunnels,
    nextPreferences: {
      syncPasswords: merged.preferences.syncPasswords,
      syncPrivateKeys: merged.preferences.syncPrivateKeys
    },
    remoteHostFingerprints
  }
}
