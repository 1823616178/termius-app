import { z } from 'zod'
import { idSchema } from './contracts'
import type { FileProfileOptions, FileProtocol, FileSecretsInput, FilesSettings, SshSettings } from './files'
import { isHttpsOrLoopbackUrl, isLoopbackHostname } from './network'
import type { RdpProfileOptions, RdpSettings } from './rdp'

export const SYNC_SCHEMA_VERSION = 1
export const SYNC_NAMESPACE_SCHEMA_VERSION = 2
export const SYNC_NAMESPACES = ['core', 'protocols', 'settings'] as const
export type SyncNamespace = (typeof SYNC_NAMESPACES)[number]
export const syncNamespaceSchema = z.enum(SYNC_NAMESPACES)

export const MAX_SYNC_DOCUMENT_BYTES = 2 * 1024 * 1024
export const MAX_SYNC_V2_DOCUMENT_BYTES = 8 * 1024 * 1024
export const MAX_SYNC_ALLOWED_DOCUMENT_BYTES = 16 * 1024 * 1024
export const MAX_SYNC_HOSTS = 5000
export const MAX_SYNC_FILE_PROFILES = 5000
export const MAX_SYNC_RDP_PROFILES = 5000
export const MAX_SYNC_KNOWN_RDP_HOSTS = 5000
export const MAX_PRIVATE_KEY_BYTES = 256 * 1024

export const SYNC_AES_ALGORITHM = 'AES-256-GCM'
export const SYNC_A2_MEMORY_KIB = 65536
export const SYNC_A2_ITERATIONS = 3
export const SYNC_A2_PASSES = SYNC_A2_ITERATIONS
export const SYNC_A2_PARALLELISM = 1
export const SYNC_A2_TAG_LENGTH = 32
export const SYNC_SALT_BYTES = 16
export const SYNC_GCM_NONCE_BYTES = 12
export const SYNC_GCM_TAG_BYTES = 16
export const SYNC_RECOVERY_PREFIX = 'SPM1'

export const SYNC_AAD_DOMAIN_DOCUMENT = 'ssh-port-mapper/sync-document/v1'
export const SYNC_AAD_DOMAIN_DOCUMENT_V2 = 'ssh-port-mapper/sync-document/v2'
export const SYNC_AAD_DOMAIN_PASSWORD_WRAP = 'ssh-port-mapper/vault-key/password/v1'
export const SYNC_AAD_DOMAIN_RECOVERY_WRAP = 'ssh-port-mapper/vault-key/recovery/v1'
export const SYNC_HKDF_RECOVERY_INFO = 'ssh-port-mapper/recovery-kek/v1'

export const SYNC_KEY_CAPABILITY_MESSAGE =
  '受跨端私钥往返能力限制，当前仅支持本地 Agent 或本机保存密码；远程同步暂不上传桌面端私钥，但会完整保留其他客户端已有记录。'

export function isInsecureHttpSyncUrl(raw: string): boolean {
  const trimmed = raw.trim()
  if (!trimmed) return false
  try {
    const parsed = new URL(trimmed)
    return parsed.protocol.toLowerCase() === 'http:' && !isLoopbackHostname(parsed.hostname)
  } catch {
    return false
  }
}

export function validateSyncServerUrl(raw: string, options: { allowInsecureHttp?: boolean } = {}): string {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error('请输入同步服务器地址')
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('同步服务器地址格式无效')
  }
  if (parsed.username || parsed.password) {
    throw new Error('同步服务器地址不能包含用户名或密码')
  }
  const protocol = parsed.protocol.toLowerCase()
  if (protocol === 'https:') {
    return parsed.toString().replace(/\/+$/, '')
  }
  if (protocol === 'http:') {
    if (isHttpsOrLoopbackUrl(parsed) || options.allowInsecureHttp) {
      return parsed.toString().replace(/\/+$/, '')
    }
    throw new Error(
      '出于安全限制，非本机地址的同步服务默认仅允许 HTTPS；如确需连接内网明文 HTTP 服务，请勾选确认明文传输风险。'
    )
  }
  throw new Error('同步服务器地址仅支持 HTTP 或 HTTPS 协议')
}

function createSyncServerUrlSchema(allowInsecureHttp: boolean) {
  return z
    .string()
    .trim()
    .min(1, '请输入同步服务器地址')
    .max(512, '服务器地址过长')
    .transform((value, ctx) => {
      try {
        return validateSyncServerUrl(value, { allowInsecureHttp })
      } catch (error) {
        ctx.addIssue({
          code: 'custom',
          message: error instanceof Error ? error.message : '同步服务器地址无效'
        })
        return z.NEVER
      }
    })
}

export const syncServerUrlSchema = createSyncServerUrlSchema(false)
const rawSyncServerUrlSchema = createSyncServerUrlSchema(true)

export const syncEmailSchema = z
  .string()
  .trim()
  .min(3, '请输入有效邮箱')
  .max(254, '邮箱长度超出限制')
  .email('请输入有效邮箱地址')
  .transform((value) => value.toLowerCase())

export const syncAuthPasswordSchema = z
  .string()
  .min(8, '账号密码至少需要 8 个字符')
  .max(1024, '账号密码长度超出限制')

export const syncMasterPasswordSchema = z
  .string()
  .min(8, '主密码至少需要 8 个字符')
  .max(1024, '主密码长度超出限制')

export const syncRecoveryKeySchema = z.string().trim().min(20, '恢复密钥格式无效').max(256, '恢复密钥过长')

const blankToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value

export const syncLoginInputSchema = z
  .object({
    serverUrl: rawSyncServerUrlSchema,
    email: syncEmailSchema,
    password: syncAuthPasswordSchema,
    rememberEmail: z.boolean().default(true),
    keepSignedIn: z.boolean().default(false),
    allowInsecureHttp: z.boolean().optional(),
    deviceName: z.string().trim().min(1).max(80).optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    try {
      validateSyncServerUrl(value.serverUrl, { allowInsecureHttp: Boolean(value.allowInsecureHttp) })
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        path: ['serverUrl'],
        message: error instanceof Error ? error.message : '同步服务器地址无效'
      })
    }
  })

export const syncRegisterInputSchema = z
  .object({
    serverUrl: rawSyncServerUrlSchema,
    email: syncEmailSchema,
    password: z.string().min(10, '注册账号密码至少需要 10 个字符').max(128, '账号密码长度超出限制'),
    inviteCode: z.preprocess(
      blankToUndefined,
      z.string().trim().min(8, '邀请码至少 8 个字符').max(64, '邀请码过长').optional()
    ),
    rememberEmail: z.boolean().default(true),
    keepSignedIn: z.boolean().default(false),
    allowInsecureHttp: z.boolean().optional(),
    deviceName: z.string().trim().min(1).max(80).optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    try {
      validateSyncServerUrl(value.serverUrl, { allowInsecureHttp: Boolean(value.allowInsecureHttp) })
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        path: ['serverUrl'],
        message: error instanceof Error ? error.message : '同步服务器地址无效'
      })
    }
  })

export const syncVaultCreateInputSchema = z
  .object({
    masterPassword: syncMasterPasswordSchema
  })
  .strict()

export const syncVaultUnlockInputSchema = z
  .object({
    masterPassword: z.string().min(1, '请输入主密码').max(1024, '主密码过长')
  })
  .strict()

export const syncVaultRecoverInputSchema = z
  .object({
    recoveryKey: syncRecoveryKeySchema,
    newMasterPassword: z.preprocess(blankToUndefined, syncMasterPasswordSchema.optional()),
    currentAccountPassword: z.preprocess(
      blankToUndefined,
      z.string().min(1, '请输入当前账号登录密码').max(1024, '账号密码长度超出限制').optional()
    )
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.newMasterPassword && !val.currentAccountPassword) {
      ctx.addIssue({
        code: 'custom',
        path: ['currentAccountPassword'],
        message: '重设主密码需同时填写当前账号登录密码，以同步更新云端密钥信封'
      })
    }
  })

export const syncPreferencesUpdateSchema = z
  .object({
    syncPasswords: z.boolean().optional(),
    syncFileCredentials: z.boolean().optional(),
    syncRdpCredentials: z.boolean().optional(),
    syncProtocolSettings: z.boolean().optional(),
    masterPassword: z.preprocess(blankToUndefined, z.string().min(1).max(1024).optional()),
    currentAccountPassword: z.preprocess(blankToUndefined, z.string().min(1).max(1024).optional()),
    autoSync: z.boolean().optional(),
    writeMode: z.enum(['realtime', 'local-only']).optional(),
    keepSignedIn: z.boolean().optional(),
    rememberEmail: z.boolean().optional(),
    allowInsecureHttp: z.boolean().optional(),
    serverUrl: rawSyncServerUrlSchema.optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.serverUrl) return
    try {
      validateSyncServerUrl(value.serverUrl, { allowInsecureHttp: Boolean(value.allowInsecureHttp) })
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        path: ['serverUrl'],
        message: error instanceof Error ? error.message : '同步服务器地址无效'
      })
    }
  })

export const syncConflictResolutionItemSchema = z
  .object({
    conflictId: z.string().min(1).max(200),
    choice: z.enum(['local', 'remote'])
  })
  .strict()

export const syncResolveConflictsSchema = z
  .object({
    resolutions: z.array(syncConflictResolutionItemSchema).min(1).max(2000)
  })
  .strict()

export const syncGroupInputSchema = z
  .object({
    id: idSchema.optional(),
    name: z.string().trim().min(1, '请输入分组名称').max(60, '分组名称最多 60 个字符'),
    color: z
      .string()
      .trim()
      .regex(/^#[0-9A-Fa-f]{6}$/, '分组颜色必须为 6 位十六进制颜色，例如 #3B82F6')
      .default('#3B82F6')
  })
  .strict()

export const syncTunnelInputSchema = z
  .object({
    id: idSchema.optional(),
    name: z.string().trim().min(1, '请输入隧道名称').max(80, '隧道名称最多 80 个字符'),
    serverId: idSchema,
    groupId: idSchema.nullable().default(null),
    type: z.enum(['L', 'R', 'D']),
    listenHost: z
      .string()
      .trim()
      .min(1, '请输入监听地址')
      .max(253)
      .refine((v) => !/[\s\x00-\x1f]/.test(v), '监听地址格式无效')
      .default('127.0.0.1'),
    listenPort: z.number().int().min(1, '监听端口 1-65535').max(65535, '监听端口 1-65535'),
    destHost: z.string().trim().max(253).default('127.0.0.1'),
    destPort: z.number().int().min(0).max(65535).default(0),
    destServerId: idSchema.nullable().optional().default(null),
    autoReconnect: z.boolean().default(true),
    enabled: z.boolean().default(false)
  })
  .strict()

export type SyncLoginInput = z.infer<typeof syncLoginInputSchema>
export type SyncRegisterInput = z.infer<typeof syncRegisterInputSchema>
export type SyncVaultCreateInput = z.infer<typeof syncVaultCreateInputSchema>
export type SyncVaultUnlockInput = z.infer<typeof syncVaultUnlockInputSchema>
export type SyncVaultRecoverInput = z.infer<typeof syncVaultRecoverInputSchema>
export type SyncPreferencesUpdate = z.infer<typeof syncPreferencesUpdateSchema>
export type SyncConflictResolutionItem = z.infer<typeof syncConflictResolutionItemSchema>
export type SyncGroupInput = z.input<typeof syncGroupInputSchema>
export type SyncTunnelInput = z.input<typeof syncTunnelInputSchema>

export interface VaultKdfParameters {
  algorithm: 'argon2id'
  memory: number
  iterations: number
  parallelism: number
}

export interface VaultMetadataWire {
  id?: string
  keyVersion: number
  passwordWrappedKey: string
  passwordWrapNonce: string
  recoveryWrappedKey: string
  recoveryWrapNonce: string
  kdfSalt: string
  kdfParameters: VaultKdfParameters
}

export interface SyncDocumentEnvelope {
  revision?: string
  schemaVersion: number
  keyVersion: number
  algorithm: 'AES-256-GCM'
  nonce: string
  ciphertext: string
  ciphertextHash: string
  updatedByDeviceId?: string
  updatedAt?: string
}

export interface WirePreferences {
  syncPasswords: boolean
  syncPrivateKeys: boolean
  [key: string]: unknown
}

export interface WireServerProfile {
  id: string
  name: string
  host: string
  port: number
  username: string
  authType: string
  hostFingerprint?: string | null
  keepalive: number
  [key: string]: unknown
}

export interface WireServerSecrets {
  password?: string
  passphrase?: string
  privateKey?: string
  privateKeyEncoding?: string
  privateKeyFormat?: string
  privateKeyFingerprint?: string
  [key: string]: unknown
}

export interface WireServer {
  profile: WireServerProfile
  secrets?: WireServerSecrets
  [key: string]: unknown
}

export interface WireGroup {
  id: string
  name: string
  color: string
  [key: string]: unknown
}

export interface WireTunnel {
  id: string
  name: string
  serverId: string
  groupId: string | null
  type: string
  listenHost: string
  listenPort: number
  destHost: string
  destPort: number
  destServerId: string
  autoReconnect: boolean
  enabled: boolean
  [key: string]: unknown
}

export interface SyncDocumentV1 {
  schemaVersion: 1
  updatedAt: string
  preferences: WirePreferences
  servers: WireServer[]
  tunnels: WireTunnel[]
  groups: WireGroup[]
  [key: string]: unknown
}

export interface WireFileProfile {
  id: string
  name: string
  protocol: FileProtocol
  host: string
  port: number
  username: string
  initialPath: string
  notes: string
  favorite: boolean
  options: FileProfileOptions
  secrets?: FileSecretsInput
  updatedAt?: string
  [key: string]: unknown
}

export interface WireRdpProfileSecrets {
  password?: string
  [key: string]: unknown
}

export interface WireRdpProfile {
  id: string
  name: string
  host: string
  port: number
  domain: string
  username: string
  linkedHostId?: string | null
  notes: string
  favorite: boolean
  options: RdpProfileOptions
  secrets?: WireRdpProfileSecrets
  updatedAt?: string
  [key: string]: unknown
}

export interface WireKnownRdpHost {
  id: string
  host: string
  port: number
  fingerprint: string
  subject: string
  issuer: string
  validFrom: string
  validTo: string
  acceptedAt: string
  [key: string]: unknown
}

export interface WireProtocolsPreferences {
  syncFileCredentials: boolean
  syncRdpCredentials: boolean
  [key: string]: unknown
}

export interface SyncDocumentProtocolsV2 {
  schemaVersion: 2
  updatedAt: string
  preferences: WireProtocolsPreferences
  fileProfiles: WireFileProfile[]
  rdpProfiles: WireRdpProfile[]
  knownRdpHosts: WireKnownRdpHost[]
  [key: string]: unknown
}

/** Machine-local OS binary / shared drive paths are intentionally excluded from cross-device settings sync. */
export type SyncedRdpSettings = Omit<RdpSettings, 'externalClientPath' | 'sharedDrivePath'>

export interface WireSettingsPreferences {
  syncProtocolSettings: boolean
  [key: string]: unknown
}

export interface SyncDocumentSettingsV2 {
  schemaVersion: 2
  updatedAt: string
  preferences: WireSettingsPreferences
  protocolSettings: {
    ssh: SshSettings
    files: FilesSettings
    rdp: SyncedRdpSettings
  }
  [key: string]: unknown
}

export type SyncNamespaceDocument = SyncDocumentV1 | SyncDocumentProtocolsV2 | SyncDocumentSettingsV2

export interface SyncServerCapabilities {
  probed: boolean
  legacyV1Only: boolean
  maxSchemaVersion: number
  supportedNamespaces: SyncNamespace[]
  maxDocumentBytes: number
  supportsBatchVaultRotate: boolean
}

export const DEFAULT_LEGACY_SERVER_CAPABILITIES: SyncServerCapabilities = {
  probed: false,
  legacyV1Only: true,
  maxSchemaVersion: SYNC_SCHEMA_VERSION,
  supportedNamespaces: ['core'],
  maxDocumentBytes: MAX_SYNC_DOCUMENT_BYTES,
  supportsBatchVaultRotate: false
}

export interface SyncNamespaceState {
  namespace: SyncNamespace
  lastRevision: string | null
  lastSyncAt: string | null
  pendingChanges: boolean
  readOnlyRemoteSchema: boolean
  remoteSchemaVersion?: number
}

export const syncListRevisionsInputSchema = z.union([
  z.undefined(),
  syncNamespaceSchema,
  z.object({ namespace: syncNamespaceSchema.optional() }).strict()
])

export const syncRestoreRevisionInputSchema = z.union([
  z.string().regex(/^\d+$/, '无效版本号').max(32),
  z
    .object({
      revision: z.string().regex(/^\d+$/, '无效版本号').max(32),
      namespace: syncNamespaceSchema.optional()
    })
    .strict()
])

export interface SyncGroup {
  id: string
  name: string
  color: string
  updatedAt: string
}

export interface SyncTunnel {
  id: string
  name: string
  serverId: string
  groupId: string | null
  type: string
  listenHost: string
  listenPort: number
  destHost: string
  destPort: number
  destServerId?: string | null
  autoReconnect: boolean
  enabled: boolean
  readOnly: boolean
  updatedAt: string
}

export interface HostSyncExtras {
  rawAuthType?: string
  serverExtra?: Record<string, unknown>
  profileExtra?: Record<string, unknown>
  secrets?: WireServerSecrets
}

export interface SyncDevice {
  id: string
  name: string
  platform: string
  appVersion: string
  createdAt: string
  lastSeenAt: string
  current: boolean
}

export interface SyncRevisionInfo {
  namespace?: SyncNamespace
  revision: string
  schemaVersion: number
  keyVersion: number
  algorithm: string
  ciphertextHash: string
  createdAt: string
  createdByDeviceId?: string | null
  createdByDeviceName?: string | null
}

export type SyncConflictEntityType =
  | 'server'
  | 'tunnel'
  | 'group'
  | 'preferences'
  | 'fileProfile'
  | 'rdpProfile'
  | 'knownRdpHost'
  | 'protocolSettings'

export interface SyncConflict {
  id: string
  namespace?: SyncNamespace
  entityType: SyncConflictEntityType
  entityId: string
  entityName: string
  field: string
  fieldLabel: string
  isSecret: boolean
  localDisplay: string
  remoteDisplay: string
}

export type SyncStatePhase =
  | 'unconfigured'
  | 'signed-out'
  | 'vault-locked'
  | 'syncing'
  | 'synced'
  | 'conflict'
  | 'offline'
  | 'read-only-schema'
  | 'error'

export interface SyncCapabilities {
  passwordSyncSupported: boolean
  privateKeySyncSupported: boolean
  keySyncReason: string
}

export interface SyncStatusSnapshot {
  phase: SyncStatePhase
  serverUrl: string
  allowInsecureHttp?: boolean
  email: string
  rememberEmail: boolean
  keepSignedIn: boolean
  autoSync: boolean
  writeMode: 'realtime' | 'local-only'
  signedIn: boolean
  vaultConfigured: boolean
  vaultUnlocked: boolean
  vaultId: string | null
  keyVersion: number
  deviceId: string
  deviceName: string
  syncPasswords: boolean
  syncPrivateKeys: boolean
  syncFileCredentials: boolean
  syncRdpCredentials: boolean
  syncProtocolSettings: boolean
  lastRevision: string | null
  lastSyncAt: string | null
  pendingChanges: boolean
  readOnlyRemoteSchema: boolean
  remoteSchemaVersion?: number
  lastError: string | null
  conflicts: SyncConflict[]
  capabilities: SyncCapabilities
  serverCapabilities: SyncServerCapabilities
  namespaces: Record<SyncNamespace, SyncNamespaceState>
}

export interface SyncVaultCreateResult {
  status: SyncStatusSnapshot
  recoveryKey: string
}

export interface SyncPreferencesResult {
  status: SyncStatusSnapshot
  rotatedRecoveryKey?: string
}

export interface SyncConfigFormDefaults {
  serverUrl: string
  allowInsecureHttp?: boolean
  email: string
  rememberEmail: boolean
  keepSignedIn: boolean
  encryptionAvailable: boolean
}
