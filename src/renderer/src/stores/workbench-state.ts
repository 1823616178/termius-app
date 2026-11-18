import { computed, ref } from 'vue'
import type {
  Bootstrap,
  Host,
  HostTrust,
  KnownHostEntry,
  NetProbeResult,
  PortCheckResult,
  SystemFontInfo,
  TrayState
} from '../../../shared/contracts'
import type { TunnelRuntimeStatus } from '../../../shared/contracts'
import {
  DEFAULT_FILES_SETTINGS,
  DEFAULT_SSH_SETTINGS,
  type AllProtocolSettings,
  type FileProfile
} from '../../../shared/files'
import { DEFAULT_UPDATE_REPOSITORY, type UpdateStatusSnapshot } from '../../../shared/updater'
import type { SyncGroup, SyncStatusSnapshot, SyncTunnel } from '../../../shared/sync'
import {
  DEFAULT_PANEL_DISPLAY_FONT_ID,
  DEFAULT_PANEL_FONT_ID,
  DEFAULT_PANEL_TEXT_COLORS,
  DEFAULT_TERMINAL_CUSTOM_COLORS,
  DEFAULT_TERMINAL_FONT_ID,
  type PanelTextColors,
  type TerminalCustomColors
} from '../services/fonts'
import { type MotionCapability, type MotionPreference, type MotionTier } from '../services/motion-performance'
import type { CursorShape, TerminalThemeId } from '../services/terminal-themes'
import { DEFAULT_CUSTOM_COLORS, type CustomUiColors, type UiThemeId } from '../services/ui-themes'

export type { MotionPreference, MotionTier } from '../services/motion-performance'
export type Page = 'workspace' | 'hosts' | 'local' | 'files' | 'tunnels' | 'identities' | 'sync' | 'settings'
export type SplitDropZone = 'left' | 'right' | 'top' | 'bottom'

export interface Pane {
  token: string
  title: string
  kind: 'local' | 'ssh'
  profileId?: string
  hostId?: string
  sessionId?: string
  password?: string
  retrySeq?: number
  authCancelledSeq?: number
  state: string
}

export interface Tab {
  token: string
  title: string
  panes: Pane[]
  focusedPaneToken: string
  direction: 'horizontal' | 'vertical'
  ratio: number
}

export interface PromptState {
  kind: 'password' | 'trust' | 'delete'
  host?: Host
  trust?: HostTrust
  split?: boolean
  paneToken?: string
  tabToken?: string
  reason?: 'auth-failed'
  message?: string
  attempt?: number
}

export const bootstrap = ref<Bootstrap>()
export const initError = ref('')
export const page = ref<Page>('workspace')
export const homeVisible = ref(false)
export const query = ref('')
export const group = ref('all')
export const favorites = ref(false)
export const hosts = ref<Host[]>([])
export const fileProfiles = ref<FileProfile[]>([])
export const protocolSettings = ref<AllProtocolSettings>({
  ssh: { ...DEFAULT_SSH_SETTINGS },
  files: { ...DEFAULT_FILES_SETTINGS }
})
export const syncGroups = ref<SyncGroup[]>([])
export const syncTunnels = ref<SyncTunnel[]>([])
export const tunnelStatuses = ref<Record<string, TunnelRuntimeStatus>>({})
export const tunnelBusy = ref<Record<string, boolean>>({})
export const probeResults = ref<Record<string, NetProbeResult>>({})
export const portCheckResults = ref<Record<string, PortCheckResult>>({})
export const probeBusy = ref<Record<string, boolean>>({})
export const knownHosts = ref<KnownHostEntry[]>([])
export const syncStatus = ref<SyncStatusSnapshot>()
export const syncWriteMode = ref<'realtime' | 'local-only'>('realtime')
export const tabs = ref<Tab[]>([])
export const activeTab = ref('')
export const selected = ref<string>()
export const notice = ref('')

export const editor = ref(false)
export const editing = ref<Host>()
export const saveBusy = ref(false)
export const saveError = ref('')
export const shellsExpanded = ref(true)
export const shellsRefreshing = ref(false)

export const prompt = ref<PromptState>()
export const trustQueue = ref<HostTrust[]>([])
export const passwordQueue = ref<PromptState[]>([])
export const promptBusy = ref(false)
let promptAttempt = 0

export const fontSize = ref(14)
export const terminalGpuEnabled = ref(true)
export const terminalTheme = ref<TerminalThemeId>('orbit-vivid')
export const lineHeight = ref(1.28)
export const cursorStyle = ref<CursorShape>('block')
export const cursorBlink = ref(true)
export const copyOnSelect = ref(false)
export const panelCopyOnSelect = ref(false)
export const copiedFeedback = ref<{ count: number; seq: number } | null>(null)
export const systemFonts = ref<SystemFontInfo[]>([])
export const systemFontsLoading = ref(false)

export const terminalFontId = ref<string>(DEFAULT_TERMINAL_FONT_ID)
export const terminalCustomFont = ref('')
export const terminalFontWeight = ref('400')
export const terminalFontWeightBold = ref('600')
export const terminalLetterSpacing = ref(0)
export const terminalLigatures = ref(true)
export const terminalMinimumContrast = ref(4.5)
export const terminalCustomColorsEnabled = ref(false)
export const terminalCustomColors = ref<TerminalCustomColors>({ ...DEFAULT_TERMINAL_CUSTOM_COLORS })

export const panelFontId = ref<string>(DEFAULT_PANEL_FONT_ID)
export const panelCustomFont = ref('')
export const panelDisplayFontId = ref<string>(DEFAULT_PANEL_DISPLAY_FONT_ID)
export const panelCustomDisplayFont = ref('')
export const panelFontSize = ref(13)
export const panelFontWeight = ref('400')
export const panelLineHeight = ref(1.5)
export const panelLetterSpacing = ref(0)
export const panelCustomColorsEnabled = ref(false)
export const panelCustomColors = ref<PanelTextColors>({ ...DEFAULT_PANEL_TEXT_COLORS })
export const activeTerminalDimensions = ref<{ cols: number; rows: number }>({ cols: 120, rows: 32 })
export const selectedShellId = ref('')
export const motionPreference = ref<MotionPreference>('auto')
export const motionTier = ref<MotionTier>('off')
export const motionCapability = ref<MotionCapability>({
  tier: 'off',
  reason: '正在检测图形与设备性能',
  webgl2Supported: false,
  softwareRenderer: false,
  cpuCores: null,
  memoryGb: null
})
export const motionReason = ref('正在检测图形与设备性能')
export const motionFps = ref<number | null>(null)
export const motionStatus = computed(() => ({
  ...motionCapability.value,
  preference: motionPreference.value,
  tier: motionTier.value,
  reason: motionReason.value,
  fps: motionFps.value
}))
export const highContrast = ref(false)
export const screenReaderDefault = ref(false)
export const uiTheme = ref<UiThemeId>('bagua-taiji')
export const customUiColors = ref<CustomUiColors>({ ...DEFAULT_CUSTOM_COLORS })
export const showHelp = ref(false)
export const maximized = ref(false)
export const trayState = ref<TrayState>({
  minimizeToTray: true,
  closeToTray: false,
  closeAction: 'quit',
  trayVisibility: 'when-minimized',
  trayCreated: false,
  windowHiddenToTray: false
})
export const updateState = ref<UpdateStatusSnapshot>({
  phase: 'idle',
  currentVersion: '1.1.0',
  repository: { ...DEFAULT_UPDATE_REPOSITORY },
  preferences: {
    autoCheckOnStartup: true,
    allowPrerelease: false,
    ignoredVersion: null,
    lastCheckedAt: null
  },
  latest: null,
  progress: null,
  downloadedFilePath: null,
  verifiedHash: null,
  message: '尚未检查更新',
  error: null,
  checkedAt: null
})
export const hasVisibleUpdate = computed(() => {
  const s = updateState.value
  if (s.phase === 'downloading' || s.phase === 'downloaded') return true
  if (s.phase === 'available' && s.latest) {
    return s.preferences.ignoredVersion !== s.latest.version
  }
  return false
})
export const focusUpdateSectionToken = ref(0)

export const sidebarWidth = ref(240)
export const sidebarCollapsed = ref(false)
export const splitEnteredPaneToken = ref('')

export const paneContainers = new Map<string, HTMLElement>()
const groupTokens = new Map<string, string>()
let noticeTimeout: ReturnType<typeof setTimeout> | undefined
let splitAnimationTimer: ReturnType<typeof setTimeout> | undefined
let copiedFeedbackTimer: ReturnType<typeof setTimeout> | undefined
let copiedSeq = 0

export function registerPaneContainer(tabToken: string, el: HTMLElement | null): void {
  if (el) paneContainers.set(tabToken, el)
  else paneContainers.delete(tabToken)
}

export function getPaneContainer(tabToken: string): HTMLElement | undefined {
  return paneContainers.get(tabToken)
}

export function instanceToken(): string {
  return `p${crypto.randomUUID()}`
}

export function groupToken(name: string): string {
  if (!groupTokens.has(name)) groupTokens.set(name, instanceToken())
  return groupTokens.get(name)!
}

export function windowInstance(token: string): string {
  return `${bootstrap.value?.windowId ?? 'w0'}-${token}`
}

export function markSplitAnimation(paneToken: string): void {
  if (!paneToken) return
  splitEnteredPaneToken.value = paneToken
  clearTimeout(splitAnimationTimer)
  splitAnimationTimer = setTimeout(() => {
    if (splitEnteredPaneToken.value === paneToken) splitEnteredPaneToken.value = ''
  }, 460)
}

export function nextPromptAttempt(): number {
  return ++promptAttempt
}

export function notify(message: string): void {
  notice.value = message
  clearTimeout(noticeTimeout)
  noticeTimeout = setTimeout(() => {
    notice.value = ''
  }, 6000)
}

export function notifyCopiedSelection(text: string): void {
  const length = text.length
  if (!length) return
  const seq = ++copiedSeq
  copiedFeedback.value = { count: length, seq }
  clearTimeout(copiedFeedbackTimer)
  copiedFeedbackTimer = setTimeout(() => {
    if (copiedFeedback.value?.seq === seq) copiedFeedback.value = null
  }, 2200)
}

export function advancePromptQueue(): void {
  if (prompt.value) return
  const nextTrust = trustQueue.value.shift()
  if (nextTrust) {
    prompt.value = { kind: 'trust', trust: nextTrust, attempt: nextPromptAttempt() }
    return
  }
  const nextPassword = passwordQueue.value.shift()
  if (nextPassword) {
    prompt.value = nextPassword
  }
}

export function dismissStaleTrust(sessionId: string): void {
  trustQueue.value = trustQueue.value.filter((item) => item.sessionId !== sessionId)
  if (prompt.value?.kind === 'trust' && prompt.value.trust?.sessionId === sessionId) {
    prompt.value = undefined
    advancePromptQueue()
  }
}

export function dismissStalePanePrompts(paneToken: string): void {
  passwordQueue.value = passwordQueue.value.filter((item) => item.paneToken !== paneToken)
  if (prompt.value?.kind === 'password' && prompt.value.paneToken === paneToken) {
    prompt.value = undefined
    advancePromptQueue()
  }
}

export function clearWorkbenchStateTimers(): void {
  clearTimeout(noticeTimeout)
  clearTimeout(splitAnimationTimer)
  clearTimeout(copiedFeedbackTimer)
}
