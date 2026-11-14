import { z } from 'zod'
import type {
  SyncConfigFormDefaults,
  SyncConflictResolutionItem,
  SyncDevice,
  SyncGroup,
  SyncGroupInput,
  SyncLoginInput,
  SyncPreferencesResult,
  SyncPreferencesUpdate,
  SyncRegisterInput,
  SyncRevisionInfo,
  SyncStatusSnapshot,
  SyncTunnel,
  SyncTunnelInput,
  SyncVaultCreateInput,
  SyncVaultCreateResult,
  SyncVaultRecoverInput,
  SyncVaultUnlockInput
} from './sync'

export const MAX_SESSIONS = 16
export const MAX_CLIPBOARD_BYTES = 1024 * 1024
export const MAX_INPUT_BYTES_PER_SEC = 1024 * 1024

export const idSchema = z.string().uuid()
export const hostInputSchema = z
  .object({
    id: idSchema.optional(),
    name: z.string().trim().min(1, '请输入主机名称').max(80, '主机名称最多 80 个字符'),
    address: z
      .string()
      .trim()
      .min(1, '请输入地址')
      .max(253, '地址长度不能超过 253 个字符')
      .refine((v) => !/[\s/\\\x00-\x1f]/.test(v), '地址不能包含空格、路径或控制字符')
      .refine((v) => !v.includes('@'), '地址只需填写主机名或 IP，用户名请填在下方字段'),
    port: z
      .number({ message: '请输入 1–65535 的有效端口' })
      .int('端口必须为整数')
      .min(1, '端口不能小于 1')
      .max(65535, '端口不能大于 65535')
      .default(22),
    username: z.string().trim().min(1, '请输入用户名').max(128, '用户名最多 128 个字符'),
    auth: z.enum(['password', 'agent']).default('password'),
    keepalive: z.number().int('保活间隔必须为整数').min(0).max(3600).default(30),
    group: z.string().trim().max(60, '分组名称最多 60 个字符').default(''),
    notes: z.string().max(2000, '备注最多 2000 个字符').default(''),
    favorite: z.boolean().default(false),
    password: z.string().max(16384, '密码长度超出限制').optional(),
    savePassword: z.boolean().default(false),
    clearPassword: z.boolean().default(false)
  })
  .strict()
  .superRefine((value, context) => {
    if (value.clearPassword && value.password) {
      context.addIssue({
        code: 'custom',
        path: ['clearPassword'],
        message: '输入新密码时不能同时勾选移除已保存密码'
      })
    }
  })

export type HostInput = z.input<typeof hostInputSchema>
export interface Host {
  id: string
  name: string
  address: string
  port: number
  username: string
  auth: 'password' | 'agent'
  keepalive?: number
  group: string
  notes: string
  favorite: boolean
  hasPassword: boolean
  updatedAt: string
}
export interface ShellProfile {
  id: string
  name: string
  executable: string
  args: string[]
  kind: 'powershell' | 'cmd' | 'wsl'
  detail: string
}
export type TrayVisibilityMode = 'when-minimized' | 'always'

const trayPreferenceFields = {
  minimizeToTray: z.boolean(),
  closeToTray: z.boolean(),
  trayVisibility: z.enum(['when-minimized', 'always'])
}

export const trayPreferencesSchema = z
  .object({
    minimizeToTray: trayPreferenceFields.minimizeToTray.default(true),
    closeToTray: trayPreferenceFields.closeToTray.default(false),
    trayVisibility: trayPreferenceFields.trayVisibility.default('when-minimized')
  })
  .strict()

export const trayPreferencesPatchSchema = z.object(trayPreferenceFields).partial().strict()

export type TrayPreferences = z.infer<typeof trayPreferencesSchema>
export type TrayPreferencesPatch = z.infer<typeof trayPreferencesPatchSchema>

export interface TrayState extends TrayPreferences {
  trayCreated: boolean
  windowHiddenToTray: boolean
}

export type TrayAction = 'new-local' | 'open-hosts' | 'open-tunnels' | 'open-settings'

export interface Bootstrap {
  windowId: string
  hosts: Host[]
  groups: SyncGroup[]
  tunnels: SyncTunnel[]
  sync: SyncStatusSnapshot
  shells: ShellProfile[]
  home: string
  encryptionAvailable: boolean
  maximized: boolean
  tray: TrayState
  versions: { app: string; electron: string; node: string; chrome: string; modules: string }
}

const sessionBaseFields = {
  requestId: idSchema,
  cols: z.number().int().min(2).max(500),
  rows: z.number().int().min(1).max(300)
}

export const openSessionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      ...sessionBaseFields,
      kind: z.literal('local'),
      profileId: z.string().min(1).max(200)
    })
    .strict(),
  z
    .object({
      ...sessionBaseFields,
      kind: z.literal('ssh'),
      hostId: idSchema,
      password: z.string().max(16384).optional()
    })
    .strict()
])

export type OpenSessionInput = z.infer<typeof openSessionSchema>
export interface SessionInfo {
  id: string
  generation: number
  title: string
  kind: 'local' | 'ssh'
}
export interface HostTrust {
  sessionId: string
  address: string
  port: number
  algorithm: string
  fingerprint: string
  previous?: string
}
export const terminalInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('input'), data: z.string().max(65536) }),
  z.object({
    type: z.literal('resize'),
    cols: z.number().int().min(2).max(500),
    rows: z.number().int().min(1).max(300)
  }),
  z.object({ type: z.literal('ack'), sequence: z.number().int().positive() }),
  z.object({ type: z.literal('close') })
])
export type TerminalEvent =
  | { type: 'data'; sequence: number; data: Uint8Array }
  | {
      type: 'state'
      state: 'connecting' | 'verifying' | 'authenticating' | 'running' | 'exited' | 'error'
      message?: string
      exitCode?: number
    }
export const netProbeSchema = z
  .object({
    host: z.string().trim().min(1, '请输入目标主机地址').max(253),
    port: z.number().int().min(1).max(65535),
    timeoutMs: z.number().int().min(200).max(15000).optional()
  })
  .strict()

export const portCheckSchema = z
  .object({
    listenHost: z.string().trim().min(1).max(253).default('127.0.0.1'),
    listenPort: z.number().int().min(1).max(65535)
  })
  .strict()

export const tunnelToggleSchema = z
  .object({
    id: idSchema,
    active: z.boolean()
  })
  .strict()

export const knownHostRemoveSchema = z
  .object({
    hostKey: z.string().min(1).max(512)
  })
  .strict()

export interface NetProbeResult {
  host: string
  port: number
  reachable: boolean
  latencyMs: number | null
  message: string
  checkedAt: number
}

export interface PortCheckResult {
  listenHost: string
  listenPort: number
  available: boolean
  occupiedByOrbit: boolean
  tunnelId?: string
  message: string
  checkedAt: number
}

export interface TunnelRuntimeStatus {
  tunnelId: string
  active: boolean
  status: 'stopped' | 'active' | 'error'
  listenHost: string
  listenPort: number
  activeConnections: number
  message: string
  updatedAt: number
}

export interface KnownHostEntry {
  hostKey: string
  fingerprint: string
  updatedAt: number
}

export interface SyncDataUpdate {
  hosts: Host[]
  groups: SyncGroup[]
  tunnels: SyncTunnel[]
}
export interface Bridge {
  bootstrap(): Promise<Bootstrap>
  hosts: { save(input: HostInput): Promise<Host[]>; remove(id: string): Promise<Host[]> }
  groups: { save(input: SyncGroupInput): Promise<SyncGroup[]>; remove(id: string): Promise<SyncGroup[]> }
  tunnels: {
    save(input: SyncTunnelInput): Promise<SyncTunnel[]>
    remove(id: string): Promise<SyncTunnel[]>
    toggle(input: { id: string; active: boolean }): Promise<TunnelRuntimeStatus[]>
    statuses(): Promise<TunnelRuntimeStatus[]>
  }
  net: {
    probe(input: { host: string; port: number; timeoutMs?: number }): Promise<NetProbeResult>
    checkPort(input: { listenHost: string; listenPort: number }): Promise<PortCheckResult>
  }
  knownHosts: {
    list(): Promise<KnownHostEntry[]>
    remove(hostKey: string): Promise<KnownHostEntry[]>
  }
  sync: {
    getStatus(): Promise<SyncStatusSnapshot>
    getDefaults(): Promise<SyncConfigFormDefaults>
    register(input: SyncRegisterInput): Promise<SyncStatusSnapshot>
    login(input: SyncLoginInput): Promise<SyncStatusSnapshot>
    logout(): Promise<SyncStatusSnapshot>
    createVault(input: SyncVaultCreateInput): Promise<SyncVaultCreateResult>
    unlockVault(input: SyncVaultUnlockInput): Promise<SyncStatusSnapshot>
    recoverVault(input: SyncVaultRecoverInput): Promise<SyncStatusSnapshot>
    lockVault(): Promise<SyncStatusSnapshot>
    syncNow(): Promise<SyncStatusSnapshot>
    resolveConflicts(resolutions: SyncConflictResolutionItem[]): Promise<SyncStatusSnapshot>
    updatePreferences(input: SyncPreferencesUpdate): Promise<SyncPreferencesResult>
    listDevices(): Promise<SyncDevice[]>
    revokeDevice(deviceId: string): Promise<SyncDevice[]>
    listRevisions(): Promise<SyncRevisionInfo[]>
    restoreRevision(revision: string): Promise<SyncStatusSnapshot>
    onStatusChanged(callback: (status: SyncStatusSnapshot) => void): () => void
    onDataChanged(callback: (data: SyncDataUpdate) => void): () => void
  }
  shells: { refresh(): Promise<ShellProfile[]> }
  sessions: {
    open(input: OpenSessionInput): Promise<SessionInfo>
    close(id: string): Promise<void>
    trust(sessionId: string, accept: boolean): Promise<void>
  }
  onTrust(callback: (request: HostTrust) => void): () => void
  onSessionFailure(callback: (request: { id: string; message: string }) => void): () => void
  clipboard: { readText(): Promise<string>; writeText(text: string): Promise<void> }
  shell: { openExternal(url: string): Promise<void> }
  window: {
    minimize(): void
    maximize(): void
    close(): void
    hideToTray(): void
    restoreFromTray(): void
    isMaximized(): Promise<boolean>
    onMaximized(callback: (maximized: boolean) => void): () => void
  }
  tray: {
    getState(): Promise<TrayState>
    updatePreferences(patch: TrayPreferencesPatch): Promise<TrayState>
    onStateChanged(callback: (state: TrayState) => void): () => void
    onAction(callback: (action: TrayAction) => void): () => void
  }
}
export { IPC } from './channels'
