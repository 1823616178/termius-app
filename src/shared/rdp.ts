import { z } from 'zod'

export const RDP_DEFAULT_PORT = 3389

export const RDP_LAUNCH_MODES = ['external', 'embedded'] as const
export type RdpLaunchMode = (typeof RDP_LAUNCH_MODES)[number]

export const RDP_PROFILE_LAUNCH_OVERRIDES = ['inherit', 'external', 'embedded'] as const
export type RdpProfileLaunchOverride = (typeof RDP_PROFILE_LAUNCH_OVERRIDES)[number]

export const RDP_RESOLUTION_MODES = ['fit', 'fixed'] as const
export type RdpResolutionMode = (typeof RDP_RESOLUTION_MODES)[number]

export const RDP_COLOR_DEPTHS = [16, 24, 32] as const
export type RdpColorDepth = (typeof RDP_COLOR_DEPTHS)[number]

export const RDP_QUALITY_PRESETS = ['lan', 'balanced', 'low'] as const
export type RdpQualityPreset = (typeof RDP_QUALITY_PRESETS)[number]

export const RDP_SECURITY_LAYERS = ['negotiate', 'nla', 'tls'] as const
export type RdpSecurityLayer = (typeof RDP_SECURITY_LAYERS)[number]

export const RDP_CERT_POLICIES = ['tofu', 'strict', 'warn-allow'] as const
export type RdpCertPolicy = (typeof RDP_CERT_POLICIES)[number]

export const RDP_DRIVE_REDIRECT_MODES = ['none', 'readonly', 'readwrite'] as const
export type RdpDriveRedirectMode = (typeof RDP_DRIVE_REDIRECT_MODES)[number]

const idSchema = z.string().uuid()

const noControlOrNewline = (label: string) => (value: string) => !/[\r\n\x00-\x1f]/.test(value) || label

const safeRdpHost = z
  .string()
  .trim()
  .min(1, '请输入远程主机地址')
  .max(253, '主机地址过长')
  .refine((v) => !/[\s/\\\r\n\x00-\x1f]/.test(v), '主机地址不能包含空格、斜杠或控制字符')

const safeOptionalLine = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label}过长`)
    .refine(
      (v) => noControlOrNewline(`${label}不能包含换行或控制字符`)(v) === true,
      `${label}不能包含换行或控制字符`
    )

export const rdpSettingsSchema = z
  .object({
    /** Scheme A = 'external' (preferred default), Scheme B = 'embedded'. */
    preferredMode: z.enum(RDP_LAUNCH_MODES),
    /** When preferredMode is 'external' and native binary is unavailable, fall back to embedded IronRDP canvas. */
    autoFallbackToEmbedded: z.boolean(),
    /** Optional override path for system RDP client (Scheme A). Empty string triggers auto-detection. */
    externalClientPath: safeOptionalLine(1024, '客户端路径'),
    resolutionMode: z.enum(RDP_RESOLUTION_MODES),
    defaultWidth: z.number().int().min(640).max(7680),
    defaultHeight: z.number().int().min(480).max(4320),
    colorDepth: z.union([z.literal(16), z.literal(24), z.literal(32)]),
    qualityPreset: z.enum(RDP_QUALITY_PRESETS),
    securityLayer: z.enum(RDP_SECURITY_LAYERS),
    certPolicy: z.enum(RDP_CERT_POLICIES),
    enableClipboard: z.boolean(),
    enableAudio: z.boolean(),
    driveRedirect: z.enum(RDP_DRIVE_REDIRECT_MODES),
    sharedDrivePath: safeOptionalLine(1024, '共享目录路径'),
    connectTimeoutSec: z.number().int().min(5).max(120)
  })
  .strict()

export type RdpSettings = z.infer<typeof rdpSettingsSchema>

export const DEFAULT_RDP_SETTINGS: RdpSettings = {
  preferredMode: 'external',
  autoFallbackToEmbedded: true,
  externalClientPath: '',
  resolutionMode: 'fit',
  defaultWidth: 1280,
  defaultHeight: 800,
  colorDepth: 32,
  qualityPreset: 'balanced',
  securityLayer: 'negotiate',
  certPolicy: 'tofu',
  enableClipboard: true,
  enableAudio: false,
  driveRedirect: 'none',
  sharedDrivePath: '',
  connectTimeoutSec: 15
}

export const rdpProfileOptionsSchema = z
  .object({
    launchMode: z.enum(RDP_PROFILE_LAUNCH_OVERRIDES).optional(),
    resolutionMode: z.enum(RDP_RESOLUTION_MODES).optional(),
    width: z.number().int().min(640).max(7680).optional(),
    height: z.number().int().min(480).max(4320).optional(),
    colorDepth: z.union([z.literal(16), z.literal(24), z.literal(32)]).optional(),
    qualityPreset: z.enum(RDP_QUALITY_PRESETS).optional(),
    securityLayer: z.enum(RDP_SECURITY_LAYERS).optional(),
    certPolicy: z.enum(RDP_CERT_POLICIES).optional(),
    enableClipboard: z.boolean().optional(),
    enableAudio: z.boolean().optional(),
    driveRedirect: z.enum(RDP_DRIVE_REDIRECT_MODES).optional(),
    sharedDrivePath: safeOptionalLine(1024, '共享目录路径').optional()
  })
  .strict()

export type RdpProfileOptions = z.infer<typeof rdpProfileOptionsSchema>

export const rdpProfileInputSchema = z
  .object({
    id: idSchema.optional(),
    name: z
      .string()
      .trim()
      .min(1, '请输入远程桌面名称')
      .max(80, '名称最多 80 个字符')
      .refine((v) => !/[\r\n\x00-\x1f]/.test(v), '名称不能包含换行或控制字符'),
    host: safeRdpHost,
    port: z.number().int().min(1).max(65535).default(RDP_DEFAULT_PORT),
    domain: safeOptionalLine(128, '域').default(''),
    username: safeOptionalLine(256, '用户名').default(''),
    password: z.string().max(16384).optional(),
    savePassword: z.boolean().default(false),
    clearPassword: z.boolean().default(false),
    linkedHostId: idSchema.optional(),
    notes: z.string().max(2000).default(''),
    favorite: z.boolean().default(false),
    options: rdpProfileOptionsSchema.default({})
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.clearPassword && value.password) {
      ctx.addIssue({
        code: 'custom',
        path: ['clearPassword'],
        message: '输入新密码时不能同时勾选移除已保存密码'
      })
    }
  })

export type RdpProfileInput = z.input<typeof rdpProfileInputSchema>

export interface RdpProfile {
  id: string
  name: string
  host: string
  port: number
  domain: string
  username: string
  linkedHostId?: string
  notes: string
  favorite: boolean
  options: RdpProfileOptions
  hasPassword: boolean
  updatedAt: string
}

export interface KnownRdpHostEntry {
  id: string
  host: string
  port: number
  fingerprint: string
  subject: string
  issuer: string
  validFrom: string
  validTo: string
  acceptedAt: string
}

export type RdpDisplaySessionType = 'windows' | 'wayland' | 'x11' | 'headless' | 'unknown'

export interface RdpExternalCandidate {
  id: 'mstsc' | 'xfreerdp3' | 'xfreerdp' | 'wlfreerdp3' | 'wlfreerdp' | 'custom'
  label: string
  command: string
  found: boolean
  resolvedPath?: string
  version?: string
  recommendedForSession: boolean
}

export interface RdpEnvironmentProbe {
  platform: string
  displaySession: RdpDisplaySessionType
  schemeAAvailable: boolean
  schemeABinary?: string
  schemeABinaryPath?: string
  schemeAVersion?: string
  schemeACmdkeyAvailable: boolean
  schemeAMissingReason?: string
  schemeAInstallHint?: string
  schemeBAvailable: boolean
  schemeBEngine: 'ironrdp-wasm'
  candidates: RdpExternalCandidate[]
}

export const rdpConnectSourceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('profile'),
      profileId: idSchema,
      password: z.string().max(16384).optional(),
      launchModeOverride: z.enum(RDP_LAUNCH_MODES).optional()
    })
    .strict(),
  z
    .object({
      kind: z.literal('adhoc'),
      name: safeOptionalLine(80, '连接名称').optional(),
      host: safeRdpHost,
      port: z.number().int().min(1).max(65535).default(RDP_DEFAULT_PORT),
      domain: safeOptionalLine(128, '域').default(''),
      username: safeOptionalLine(256, '用户名').default(''),
      password: z.string().max(16384).optional(),
      launchModeOverride: z.enum(RDP_LAUNCH_MODES).optional(),
      options: rdpProfileOptionsSchema.default({})
    })
    .strict()
])

export type RdpConnectSource = z.input<typeof rdpConnectSourceSchema>

export const rdpSessionIdSchema = z.object({ sessionId: idSchema }).strict()

export const rdpCertDecisionSchema = z
  .object({
    promptId: idSchema,
    accept: z.boolean()
  })
  .strict()

export const rdpKnownHostRemoveSchema = z.object({ id: z.string().min(1).max(300) }).strict()

export interface RdpResolvedConfigSummary {
  effectiveMode: RdpLaunchMode
  fallbackFromExternal: boolean
  fallbackReason?: string
  width: number
  height: number
  resolutionMode: RdpResolutionMode
  colorDepth: RdpColorDepth
  qualityPreset: RdpQualityPreset
  securityLayer: RdpSecurityLayer
  certPolicy: RdpCertPolicy
  enableClipboard: boolean
  enableAudio: boolean
  driveRedirect: RdpDriveRedirectMode
  sharedDrivePath: string
}

export interface RdpEmbeddedConnectParams {
  proxyAddress: string
  authToken: string
  destination: string
  username: string
  password: string
  serverDomain: string
  width: number
  height: number
  enableCredssp: boolean
  enableClipboard: boolean
  enableDisplayControl: boolean
}

export interface RdpSessionInfo {
  sessionId: string
  title: string
  host: string
  port: number
  username: string
  domain: string
  profileId?: string
  mode: RdpLaunchMode
  fallbackFromExternal: boolean
  fallbackReason?: string
  status: 'starting' | 'active' | 'exited' | 'error'
  externalCommand?: string
  externalPid?: number
  embeddedParams?: RdpEmbeddedConnectParams
  resolved: RdpResolvedConfigSummary
  createdAt: string
}

export interface RdpSessionStateEvent {
  sessionId: string
  status: 'active' | 'exited' | 'error'
  exitCode?: number | null
  message?: string
}

export interface RdpCertPromptRequest {
  promptId: string
  sessionId: string
  host: string
  port: number
  fingerprint: string
  previousFingerprint?: string
  subject: string
  issuer: string
  validFrom: string
  validTo: string
  mismatch: boolean
}
