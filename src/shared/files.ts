import { z } from 'zod'
import type { SftpEntry, SftpListResult, SftpStatResult } from './sftp'

/**
 * Multi-protocol file profiles and protocol-scoped settings.
 *
 * SFTP is intentionally NOT a file-profile protocol: an SFTP server is an SSH host in the `hosts`
 * table, so it reuses the SSH connection worker, host-key trust and the existing v1 sync document.
 * Everything else (FTP / FTPS / WebDAV / S3 / SMB) is stored as a `FileProfile`.
 */

export const FILE_PROTOCOLS = ['ftp', 'ftps', 'webdav', 's3', 'smb'] as const
export type FileProtocol = (typeof FILE_PROTOCOLS)[number]

/** Protocols whose adapter is shipped in this release. SMB is declared for forward compatibility only. */
export const AVAILABLE_FILE_PROTOCOLS: readonly FileProtocol[] = ['ftp', 'ftps', 'webdav', 's3']

export function isFileProtocolAvailable(protocol: FileProtocol): boolean {
  return AVAILABLE_FILE_PROTOCOLS.includes(protocol)
}

export const FILE_DEFAULT_PORTS: Record<FileProtocol, number> = {
  ftp: 21,
  ftps: 21,
  webdav: 443,
  s3: 443,
  smb: 445
}

const idSchema = z.string().uuid()

const optionalText = (max: number) => z.string().trim().max(max).optional()

export const fileProfileOptionsSchema = z
  .object({
    /** FTPS: explicit (AUTH TLS on port 21) or implicit (TLS from connect, usually port 990). */
    tlsMode: z.enum(['explicit', 'implicit']).optional(),
    /** Applies to ftps / webdav / s3 over https. `insecure` accepts any certificate (shown as a warning). */
    tlsVerify: z.enum(['strict', 'insecure']).optional(),
    /** WebDAV: full base URL including scheme and base path. */
    url: optionalText(2048),
    webdavAuth: z.enum(['basic', 'digest', 'token']).optional(),
    /** S3 */
    endpoint: optionalText(2048),
    region: optionalText(64),
    bucket: optionalText(255),
    forcePathStyle: z.boolean().optional(),
    /** SMB */
    share: optionalText(255),
    domain: optionalText(255)
  })
  .strict()

export type FileProfileOptions = z.infer<typeof fileProfileOptionsSchema>

export const fileSecretsInputSchema = z
  .object({
    password: z.string().max(16384).optional(),
    /** WebDAV bearer token. */
    token: z.string().max(16384).optional(),
    /** S3 */
    secretAccessKey: z.string().max(4096).optional(),
    sessionToken: z.string().max(16384).optional()
  })
  .strict()

export type FileSecretsInput = z.infer<typeof fileSecretsInputSchema>

export const FILE_SECRET_KEYS = ['password', 'token', 'secretAccessKey', 'sessionToken'] as const
export type FileSecretKey = (typeof FILE_SECRET_KEYS)[number]

export const fileProfileInputSchema = z
  .object({
    id: idSchema.optional(),
    name: z.string().trim().min(1, '请输入服务器名称').max(80, '名称最多 80 个字符'),
    protocol: z.enum(FILE_PROTOCOLS),
    host: z
      .string()
      .trim()
      .max(253)
      .refine((v) => !/[\s/\\\x00-\x1f]/.test(v), '地址不能包含空格、路径或控制字符')
      .default(''),
    /** 0 means "use the protocol default". */
    port: z.number().int().min(0).max(65535).default(0),
    /** FTP/FTPS/WebDAV user name, S3 access key id, SMB user. */
    username: z.string().trim().max(256).default(''),
    initialPath: z.string().max(4096).default(''),
    notes: z.string().max(2000).default(''),
    favorite: z.boolean().default(false),
    options: fileProfileOptionsSchema.default({}),
    secrets: fileSecretsInputSchema.optional(),
    /** When true the supplied secrets are encrypted and stored; otherwise they live in memory for this connection only. */
    saveSecrets: z.boolean().default(false),
    clearSecrets: z.boolean().default(false)
  })
  .strict()
  .superRefine((value, ctx) => {
    const issue = (path: string[], message: string) => ctx.addIssue({ code: 'custom', path, message })
    if (value.clearSecrets && value.secrets && Object.values(value.secrets).some(Boolean)) {
      issue(['clearSecrets'], '输入新凭据时不能同时勾选移除已保存凭据')
    }
    const o = value.options
    switch (value.protocol) {
      case 'ftp':
      case 'ftps':
        if (!value.host) issue(['host'], '请输入服务器地址')
        if (value.protocol === 'ftps' && !o.tlsMode) issue(['options', 'tlsMode'], '请选择 FTPS 模式')
        break
      case 'webdav': {
        if (!o.url) {
          issue(['options', 'url'], '请输入 WebDAV 地址')
          break
        }
        try {
          const parsed = new URL(o.url)
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            issue(['options', 'url'], 'WebDAV 地址必须以 http:// 或 https:// 开头')
          }
          if (parsed.username || parsed.password) {
            issue(['options', 'url'], '请不要在地址中嵌入用户名或密码')
          }
        } catch {
          issue(['options', 'url'], 'WebDAV 地址格式无效')
        }
        break
      }
      case 's3':
        if (!o.bucket) issue(['options', 'bucket'], '请输入 Bucket 名称')
        if (!value.username) issue(['username'], '请输入 Access Key ID')
        if (o.endpoint) {
          try {
            const parsed = new URL(o.endpoint)
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
              issue(['options', 'endpoint'], 'Endpoint 必须以 http:// 或 https:// 开头')
            }
          } catch {
            issue(['options', 'endpoint'], 'Endpoint 格式无效')
          }
        } else if (!o.region) {
          issue(['options', 'region'], '未填写 Endpoint 时必须填写 Region')
        }
        break
      case 'smb':
        if (!value.host) issue(['host'], '请输入服务器地址')
        if (!o.share) issue(['options', 'share'], '请输入共享名')
        break
    }
  })

export type FileProfileInput = z.input<typeof fileProfileInputSchema>
export type FileProfileParsed = z.output<typeof fileProfileInputSchema>

/** What the renderer sees: never contains secret values. */
export interface FileProfile {
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
  hasSecrets: boolean
  updatedAt: string
}

export type FileConnectSource =
  | { kind: 'profile'; profileId: string; secrets?: FileSecretsInput }
  | { kind: 'adhoc'; profile: FileProfileInput }

export const fileConnectSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('profile'),
      profileId: idSchema,
      secrets: fileSecretsInputSchema.optional()
    })
    .strict(),
  z.object({ kind: z.literal('adhoc'), profile: fileProfileInputSchema }).strict()
])

export const fileProfileIdSchema = z.object({ id: idSchema }).strict()

export interface FileCapabilities {
  chmod: boolean
  symlinks: boolean
  /** Folders are real objects (false for S3 where they are key prefixes). */
  realDirectories: boolean
  rename: boolean
  /** Server-side recursive delete is emulated client-side when false. */
  resume: boolean
  /** Whether listings carry meaningful POSIX modes/owners. */
  posixMetadata: boolean
}

export interface FileSessionInfo {
  sessionId: string
  profileId?: string
  protocol: FileProtocol
  title: string
  home: string
  capabilities: FileCapabilities
}

export type FileEntry = SftpEntry
export type FileListResult = SftpListResult
export type FileStatResult = SftpStatResult

/** Adapter-resolved connection (secrets decrypted, defaults applied). Lives only in main + worker memory. */
export interface FileConnectConfig {
  protocol: FileProtocol
  host: string
  port: number
  username: string
  initialPath: string
  options: FileProfileOptions
  secrets: FileSecretsInput
  connectTimeoutMs: number
  s3PartSizeMiB: number
}

export function describeFileEndpoint(
  profile: Pick<FileProfile, 'protocol' | 'host' | 'port' | 'options'>
): string {
  const o = profile.options
  switch (profile.protocol) {
    case 'webdav':
      return o.url ?? ''
    case 's3':
      return `${o.endpoint ?? `s3.${o.region ?? 'us-east-1'}.amazonaws.com`}/${o.bucket ?? ''}`
    case 'smb':
      return `\\\\${profile.host}\\${o.share ?? ''}`
    default: {
      const port = profile.port || FILE_DEFAULT_PORTS[profile.protocol]
      return `${profile.host}:${port}`
    }
  }
}

export function capabilitiesFor(protocol: FileProtocol): FileCapabilities {
  switch (protocol) {
    case 'ftp':
    case 'ftps':
      return {
        chmod: true,
        symlinks: false,
        realDirectories: true,
        rename: true,
        resume: false,
        posixMetadata: false
      }
    case 'webdav':
      return {
        chmod: false,
        symlinks: false,
        realDirectories: true,
        rename: true,
        resume: false,
        posixMetadata: false
      }
    case 's3':
      return {
        chmod: false,
        symlinks: false,
        realDirectories: false,
        rename: true,
        resume: false,
        posixMetadata: false
      }
    case 'smb':
      return {
        chmod: false,
        symlinks: false,
        realDirectories: true,
        rename: true,
        resume: false,
        posixMetadata: false
      }
  }
}

/* ------------------------------------------------------------------ */
/* Protocol-scoped settings (persisted in SQLite `protocol_settings`)  */
/* ------------------------------------------------------------------ */

export const PROTOCOL_NAMESPACES = ['ssh', 'files'] as const
export type ProtocolNamespace = (typeof PROTOCOL_NAMESPACES)[number]

/**
 * Note: keep base schemas free of `.default(...)` so `.partial()` never
 * overwrites omitted fields during `protocolSettingsPatch` updates.
 */
export const sshSettingsSchema = z
  .object({
    defaultPort: z.number().int().min(1).max(65535),
    defaultKeepaliveSec: z.number().int().min(0).max(3600)
  })
  .strict()

export const filesSettingsSchema = z
  .object({
    maxConcurrentTransfers: z.number().int().min(1).max(8),
    /** 0 = unlimited. */
    speedLimitKBps: z.number().int().min(0).max(1_048_576),
    defaultConflict: z.enum(['ask', 'overwrite', 'skip', 'rename']),
    showHidden: z.boolean(),
    confirmDelete: z.boolean(),
    connectTimeoutSec: z.number().int().min(5).max(120),
    s3PartSizeMiB: z.number().int().min(5).max(128),
    s3DefaultPathStyle: z.boolean()
  })
  .strict()

export type SshSettings = z.infer<typeof sshSettingsSchema>
export type FilesSettings = z.infer<typeof filesSettingsSchema>

export interface ProtocolSettingsMap {
  ssh: SshSettings
  files: FilesSettings
}

export const protocolSettingsSchemas = {
  ssh: sshSettingsSchema,
  files: filesSettingsSchema
} as const

export const DEFAULT_SSH_SETTINGS: SshSettings = {
  defaultPort: 22,
  defaultKeepaliveSec: 30
}

export const DEFAULT_FILES_SETTINGS: FilesSettings = {
  maxConcurrentTransfers: 3,
  speedLimitKBps: 0,
  defaultConflict: 'ask',
  showHidden: false,
  confirmDelete: true,
  connectTimeoutSec: 20,
  s3PartSizeMiB: 8,
  s3DefaultPathStyle: false
}

export const DEFAULT_PROTOCOL_SETTINGS: ProtocolSettingsMap = {
  ssh: DEFAULT_SSH_SETTINGS,
  files: DEFAULT_FILES_SETTINGS
}

export const protocolSettingsPatchSchema = z.discriminatedUnion('namespace', [
  z.object({ namespace: z.literal('ssh'), patch: sshSettingsSchema.partial() }).strict(),
  z.object({ namespace: z.literal('files'), patch: filesSettingsSchema.partial() }).strict()
])

export type ProtocolSettingsPatch = z.infer<typeof protocolSettingsPatchSchema>

/** Parse a stored document, falling back to defaults field-by-field for invalid or missing keys. */
export function normalizeProtocolSettings<N extends ProtocolNamespace>(
  namespace: N,
  raw: unknown
): ProtocolSettingsMap[N] {
  const schema = protocolSettingsSchemas[namespace] as unknown as z.ZodType<ProtocolSettingsMap[N]>
  const defaults = { ...(DEFAULT_PROTOCOL_SETTINGS[namespace] as Record<string, unknown>) }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return schema.parse(defaults)
  }
  const merged: Record<string, unknown> = { ...defaults }
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(key in defaults)) continue
    const attempt = schema.safeParse({ ...merged, [key]: value })
    if (attempt.success) merged[key] = value
  }
  return schema.parse(merged)
}

export interface AllProtocolSettings {
  ssh: SshSettings
  files: FilesSettings
}

/* ------------------------------------------------------------------ */
/* IPC payloads for the Files bridge                                   */
/* ------------------------------------------------------------------ */

export const fileSessionIdSchema = z.object({ sessionId: idSchema }).strict()

export const filePathSchema = z
  .string()
  .min(1, '路径不能为空')
  .max(4096, '路径过长')
  .refine((v) => !v.includes('\0'), '路径不能包含空字符')

export const fileLocalPathSchema = z
  .string()
  .min(1, '本地路径不能为空')
  .max(4096, '本地路径过长')
  .refine((v) => !v.includes('\0'), '本地路径不能包含空字符')

export const filePathRequestSchema = z.object({ sessionId: idSchema, path: filePathSchema }).strict()
export const fileRenameRequestSchema = z
  .object({ sessionId: idSchema, oldPath: filePathSchema, newPath: filePathSchema })
  .strict()
export const fileChmodRequestSchema = z
  .object({ sessionId: idSchema, path: filePathSchema, mode: z.number().int().min(0).max(0o7777) })
  .strict()
export const fileDeleteRequestSchema = z
  .object({ sessionId: idSchema, path: filePathSchema, recursive: z.boolean().optional() })
  .strict()
export const fileUploadRequestSchema = z
  .object({
    transferId: idSchema,
    sessionId: idSchema,
    localPath: fileLocalPathSchema,
    remotePath: filePathSchema,
    conflict: z.enum(['overwrite', 'skip', 'rename']).default('overwrite')
  })
  .strict()
export const fileDownloadRequestSchema = z
  .object({
    transferId: idSchema,
    sessionId: idSchema,
    remotePath: filePathSchema,
    localPath: fileLocalPathSchema,
    conflict: z.enum(['overwrite', 'skip', 'rename']).default('overwrite')
  })
  .strict()
export const fileCancelTransferSchema = z.object({ sessionId: idSchema, transferId: idSchema }).strict()

export interface FileProgressEvent {
  transferId: string
  sessionId: string
  protocol: FileProtocol
  direction: 'upload' | 'download'
  name: string
  localPath: string
  remotePath: string
  totalBytes: number
  transferredBytes: number
  speedBps: number
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  error?: string
}
