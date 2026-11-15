import { computed, ref } from 'vue'
import type {
  Bootstrap,
  Host,
  HostInput,
  HostTrust,
  KnownHostEntry,
  NetProbeResult,
  PortCheckResult,
  ShellProfile,
  TrayPreferencesPatch,
  TrayState,
  TunnelRuntimeStatus
} from '../../../shared/contracts'
import {
  DEFAULT_UPDATE_REPOSITORY,
  type UpdatePreferencesPatch,
  type UpdateStatusSnapshot
} from '../../../shared/updater'
import { disposeTerminalByToken } from '../services/terminal-registry'
import { TERMINAL_THEMES, type CursorShape, type TerminalThemeId } from '../services/terminal-themes'
import {
  applyUiThemeToDocument,
  DEFAULT_CUSTOM_COLORS,
  UI_THEME_PRESETS,
  type CustomUiColors,
  type UiThemeId
} from '../services/ui-themes'
import type {
  SyncGroup,
  SyncGroupInput,
  SyncStatusSnapshot,
  SyncTunnel,
  SyncTunnelInput
} from '../../../shared/sync'

export type Page = 'workspace' | 'hosts' | 'local' | 'tunnels' | 'identities' | 'sync' | 'settings'
export type MotionTier = 'full' | 'light' | 'off'
export type SplitDropZone = 'left' | 'right' | 'top' | 'bottom'

export interface Pane {
  token: string
  title: string
  kind: 'local' | 'ssh'
  profileId?: string
  hostId?: string
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
export const query = ref('')
export const group = ref('all')
export const favorites = ref(false)
export const hosts = ref<Host[]>([])
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
export const terminalTheme = ref<TerminalThemeId>('orbit-vivid')
export const lineHeight = ref(1.28)
export const cursorStyle = ref<CursorShape>('block')
export const cursorBlink = ref(true)
export const copyOnSelect = ref(false)
export const activeTerminalDimensions = ref<{ cols: number; rows: number }>({ cols: 120, rows: 32 })
export const selectedShellId = ref('')
export const motionTier = ref<MotionTier>('full')
export const highContrast = ref(false)
export const screenReaderDefault = ref(false)
export const uiTheme = ref<UiThemeId>('bagua-taiji')
export const customUiColors = ref<CustomUiColors>({ ...DEFAULT_CUSTOM_COLORS })
export const showHelp = ref(false)
export const maximized = ref(false)
export const trayState = ref<TrayState>({
  minimizeToTray: true,
  closeToTray: false,
  trayVisibility: 'when-minimized',
  trayCreated: false,
  windowHiddenToTray: false
})
export const updateState = ref<UpdateStatusSnapshot>({
  phase: 'idle',
  currentVersion: '0.1.0',
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

const paneContainers = new Map<string, HTMLElement>()
const groupTokens = new Map<string, string>()
let noticeTimeout: ReturnType<typeof setTimeout> | undefined
let splitAnimationTimer: ReturnType<typeof setTimeout> | undefined
let removeTrust: (() => void) | undefined
let removeSessionFailure: (() => void) | undefined
let removeMaximized: (() => void) | undefined
let removeSyncStatus: (() => void) | undefined
let removeSyncData: (() => void) | undefined
let removeTrayStateChanged: (() => void) | undefined
let removeTrayAction: (() => void) | undefined
let removeUpdateStateChanged: (() => void) | undefined

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

export function isPaneTokenMounted(windowPaneToken: string): boolean {
  return tabs.value.some((tab) => tab.panes.some((pane) => windowInstance(pane.token) === windowPaneToken))
}

export function resolveSplitDropZone(relX: number, relY: number): SplitDropZone {
  const x = Math.min(1, Math.max(0, relX))
  const y = Math.min(1, Math.max(0, relY))
  const topDist = y
  const bottomDist = 1 - y
  const leftDist = x
  const rightDist = 1 - x
  if (y < 0.28 && topDist <= leftDist && topDist <= rightDist && topDist <= bottomDist) {
    return 'top'
  }
  if (y > 0.72 && bottomDist <= leftDist && bottomDist <= rightDist && bottomDist < topDist) {
    return 'bottom'
  }
  return x < 0.5 ? 'left' : 'right'
}

export function markSplitAnimation(paneToken: string): void {
  if (!paneToken) return
  splitEnteredPaneToken.value = paneToken
  clearTimeout(splitAnimationTimer)
  splitAnimationTimer = setTimeout(() => {
    if (splitEnteredPaneToken.value === paneToken) splitEnteredPaneToken.value = ''
  }, 460)
}

export const filteredHosts = computed(() => {
  const q = query.value.trim().toLowerCase()
  return hosts.value.filter(
    (host) =>
      (!favorites.value || host.favorite) &&
      (group.value === 'all' || host.group === group.value) &&
      (!q ||
        `${host.name} ${host.address}:${host.port} ${host.username} ${host.group} ${host.notes}`
          .toLowerCase()
          .includes(q))
  )
})

export const groups = computed(() =>
  [...new Set(hosts.value.map((host) => host.group).filter(Boolean))].sort()
)

export const currentTab = computed(() => tabs.value.find((tab) => tab.token === activeTab.value))

export const focusedPane = computed(() => {
  const tab = currentTab.value
  if (!tab) return undefined
  return tab.panes.find((pane) => pane.token === tab.focusedPaneToken) ?? tab.panes[0]
})

export const selectedHostDetails = computed(() => hosts.value.find((host) => host.id === selected.value))

export const defaultShellProfile = computed(
  () =>
    bootstrap.value?.shells.find((item) => item.id === selectedShellId.value) ?? bootstrap.value?.shells[0]
)

export const runningCount = computed(
  () => tabs.value.flatMap((tab) => tab.panes).filter((pane) => pane.state === 'running').length
)

export function notify(message: string): void {
  notice.value = message
  clearTimeout(noticeTimeout)
  noticeTimeout = setTimeout(() => {
    notice.value = ''
  }, 6000)
}

function advancePromptQueue(): void {
  if (prompt.value) return
  const nextTrust = trustQueue.value.shift()
  if (nextTrust) {
    prompt.value = { kind: 'trust', trust: nextTrust, attempt: ++promptAttempt }
    return
  }
  const nextPassword = passwordQueue.value.shift()
  if (nextPassword) {
    prompt.value = nextPassword
  }
}

function dismissStaleTrust(sessionId: string): void {
  trustQueue.value = trustQueue.value.filter((item) => item.sessionId !== sessionId)
  if (prompt.value?.kind === 'trust' && prompt.value.trust?.sessionId === sessionId) {
    prompt.value = undefined
    advancePromptQueue()
  }
}

function dismissStalePanePrompts(paneToken: string): void {
  passwordQueue.value = passwordQueue.value.filter((item) => item.paneToken !== paneToken)
  if (prompt.value?.kind === 'password' && prompt.value.paneToken === paneToken) {
    prompt.value = undefined
    advancePromptQueue()
  }
}

export function requestPanePassword(tabToken: string, paneToken: string, errorMessage?: string): void {
  const tab = tabs.value.find((item) => item.token === tabToken)
  const pane = tab?.panes.find((item) => item.token === paneToken)
  if (!tab || !pane || pane.kind !== 'ssh' || !pane.hostId) return
  const host = hosts.value.find((item) => item.id === pane.hostId)
  if (!host) return
  if (
    (prompt.value?.kind === 'password' && prompt.value.paneToken === paneToken) ||
    passwordQueue.value.some((item) => item.paneToken === paneToken)
  ) {
    return
  }
  const nextPrompt: PromptState = {
    kind: 'password',
    host,
    tabToken,
    paneToken,
    reason: 'auth-failed',
    message: errorMessage || 'SSH 密码认证失败，请重新输入登录密码。',
    attempt: ++promptAttempt
  }
  if (prompt.value) {
    passwordQueue.value.push(nextPrompt)
  } else {
    prompt.value = nextPrompt
  }
}

export function applyVisualPreferences(): void {
  document.documentElement.dataset.motion = motionTier.value
  document.documentElement.dataset.contrast = highContrast.value ? 'high' : 'standard'
  applyUiThemeToDocument(uiTheme.value, customUiColors.value)
}

export function setUiTheme(themeId: UiThemeId): void {
  uiTheme.value = themeId
  applyVisualPreferences()
  try {
    localStorage.setItem('orbit:ui-theme', themeId)
  } catch {
    /* storage unavailable */
  }
}

export function updateCustomUiColors(next: CustomUiColors): void {
  customUiColors.value = { ...next }
  uiTheme.value = 'custom'
  applyVisualPreferences()
  try {
    localStorage.setItem('orbit:ui-theme', 'custom')
    localStorage.setItem('orbit:custom-ui-colors', JSON.stringify(customUiColors.value))
  } catch {
    /* storage unavailable */
  }
}

export function cycleUiTheme(): void {
  const order: UiThemeId[] = UI_THEME_PRESETS.map((item) => item.id)
  const idx = order.indexOf(uiTheme.value)
  const next = order[(idx + 1) % order.length]!
  setUiTheme(next)
  const preset = UI_THEME_PRESETS.find((item) => item.id === next)
  if (preset) notify(`已切换主题：${preset.name}`)
}

export function loadSavedPreferences(): void {
  try {
    const savedSize = Number(localStorage.getItem('orbit:font-size'))
    if (savedSize >= 10 && savedSize <= 24) fontSize.value = savedSize
    const savedTheme = localStorage.getItem('orbit:terminal-theme')
    if (TERMINAL_THEMES.some((item) => item.id === savedTheme)) {
      terminalTheme.value = savedTheme as TerminalThemeId
    }
    const savedUiTheme = localStorage.getItem('orbit:ui-theme') as UiThemeId | null
    if (
      savedUiTheme &&
      (savedUiTheme === 'custom' || UI_THEME_PRESETS.some((item) => item.id === savedUiTheme))
    ) {
      uiTheme.value = savedUiTheme
    }
    const savedCustomRaw = localStorage.getItem('orbit:custom-ui-colors')
    if (savedCustomRaw) {
      const parsed = JSON.parse(savedCustomRaw) as Partial<CustomUiColors>
      customUiColors.value = {
        appBg: parsed.appBg || DEFAULT_CUSTOM_COLORS.appBg,
        surface1: parsed.surface1 || DEFAULT_CUSTOM_COLORS.surface1,
        surface2: parsed.surface2 || DEFAULT_CUSTOM_COLORS.surface2,
        accentPrimary: parsed.accentPrimary || DEFAULT_CUSTOM_COLORS.accentPrimary,
        accentSecondary: parsed.accentSecondary || DEFAULT_CUSTOM_COLORS.accentSecondary,
        textPrimary: parsed.textPrimary || DEFAULT_CUSTOM_COLORS.textPrimary
      }
    }
    const savedWriteMode = localStorage.getItem('orbit:sync-write-mode')
    if (savedWriteMode === 'realtime' || savedWriteMode === 'local-only') {
      syncWriteMode.value = savedWriteMode
    }
    const savedLineHeight = Number(localStorage.getItem('orbit:line-height'))
    if (savedLineHeight >= 1.1 && savedLineHeight <= 1.6) {
      lineHeight.value = Number(savedLineHeight.toFixed(2))
    }
    const savedCursorStyle = localStorage.getItem('orbit:cursor-style')
    if (savedCursorStyle === 'block' || savedCursorStyle === 'bar' || savedCursorStyle === 'underline') {
      cursorStyle.value = savedCursorStyle
    }
    const savedCursorBlink = localStorage.getItem('orbit:cursor-blink')
    if (savedCursorBlink === 'true' || savedCursorBlink === 'false') {
      cursorBlink.value = savedCursorBlink === 'true'
    }
    copyOnSelect.value = localStorage.getItem('orbit:copy-on-select') === 'true'
    const savedShell = localStorage.getItem('orbit:default-shell')
    if (savedShell) selectedShellId.value = savedShell
    const savedMotion = localStorage.getItem('orbit:motion-tier')
    if (savedMotion === 'full' || savedMotion === 'light' || savedMotion === 'off') {
      motionTier.value = savedMotion
    }
    highContrast.value = localStorage.getItem('orbit:high-contrast') === 'true'
    screenReaderDefault.value = localStorage.getItem('orbit:screen-reader') === 'true'
    const savedSidebar = Number(localStorage.getItem('orbit:sidebar-width'))
    if (savedSidebar >= 200 && savedSidebar <= 360) sidebarWidth.value = savedSidebar
  } catch {
    /* preferences are optional */
  }
  applyVisualPreferences()
}

export async function initialize(): Promise<void> {
  initError.value = ''
  try {
    bootstrap.value = await window.orbit.bootstrap()
    hosts.value = bootstrap.value.hosts
    syncGroups.value = bootstrap.value.groups
    syncTunnels.value = bootstrap.value.tunnels
    syncStatus.value = bootstrap.value.sync
    if (bootstrap.value.sync?.writeMode) {
      syncWriteMode.value = bootstrap.value.sync.writeMode
    }
    maximized.value = bootstrap.value.maximized
    if (bootstrap.value.tray) trayState.value = bootstrap.value.tray
    if (bootstrap.value.update) updateState.value = bootstrap.value.update
    void refreshTunnelStatuses()
    void refreshKnownHosts()
    if (!removeTrust) {
      removeTrust = window.orbit.onTrust((trust) => {
        if (prompt.value) {
          trustQueue.value.push(trust)
          return
        }
        prompt.value = { kind: 'trust', trust, attempt: ++promptAttempt }
      })
    }
    if (!removeSessionFailure) {
      removeSessionFailure = window.orbit.onSessionFailure((event) => {
        dismissStaleTrust(event.id)
      })
    }
    if (!removeMaximized) {
      removeMaximized = window.orbit.window.onMaximized((state) => {
        maximized.value = state
      })
    }
    if (!removeSyncStatus) {
      removeSyncStatus = window.orbit.sync.onStatusChanged((status) => {
        syncStatus.value = status
        if (status?.writeMode) syncWriteMode.value = status.writeMode
      })
    }
    if (!removeSyncData) {
      removeSyncData = window.orbit.sync.onDataChanged((data) => {
        hosts.value = data.hosts
        syncGroups.value = data.groups
        syncTunnels.value = data.tunnels
      })
    }
    if (!removeTrayStateChanged) {
      removeTrayStateChanged = window.orbit.tray.onStateChanged((state) => {
        trayState.value = state
      })
    }
    if (!removeTrayAction) {
      removeTrayAction = window.orbit.tray.onAction((action) => {
        if (action === 'new-local') {
          if (defaultShellProfile.value) openLocal(defaultShellProfile.value)
          else page.value = 'local'
        } else if (action === 'open-hosts') {
          page.value = 'hosts'
        } else if (action === 'open-tunnels') {
          page.value = 'tunnels'
        } else if (action === 'open-settings') {
          page.value = 'settings'
        }
      })
    }
    if (!removeUpdateStateChanged) {
      removeUpdateStateChanged = window.orbit.update.onStateChanged((next) => {
        const previousPhase = updateState.value.phase
        updateState.value = next
        if (previousPhase !== 'downloaded' && next.phase === 'downloaded' && next.latest) {
          notify(`新版本 v${next.latest.version} 已下载并校验完成，前往设置即可安装`)
        }
      })
    }
  } catch (error) {
    initError.value = error instanceof Error ? error.message : '读取本地数据失败'
  }
}

export async function updateTrayPreferences(patch: TrayPreferencesPatch): Promise<void> {
  trayState.value = await window.orbit.tray.updatePreferences(patch)
}

export function hideWindowToTray(): void {
  window.orbit.window.hideToTray()
}

export function disposeWorkbenchListeners(): void {
  removeTrust?.()
  removeTrust = undefined
  removeSessionFailure?.()
  removeSessionFailure = undefined
  removeMaximized?.()
  removeMaximized = undefined
  removeSyncStatus?.()
  removeSyncStatus = undefined
  removeSyncData?.()
  removeSyncData = undefined
  removeTrayStateChanged?.()
  removeTrayStateChanged = undefined
  removeTrayAction?.()
  removeTrayAction = undefined
  removeUpdateStateChanged?.()
  removeUpdateStateChanged = undefined
  clearTimeout(noticeTimeout)
  clearTimeout(splitAnimationTimer)
}

export function openUpdateSettings(): void {
  page.value = 'settings'
  focusUpdateSectionToken.value++
}

export async function checkForUpdates(): Promise<void> {
  try {
    const next = await window.orbit.update.checkForUpdates()
    updateState.value = next
    if (next.phase === 'available' && next.latest) {
      notify(`发现新版本 v${next.latest.version}`)
    } else if (next.phase === 'up-to-date') {
      notify(next.message)
    } else if (next.phase === 'error' && next.error) {
      notify(`检查更新失败：${next.error}`)
    }
  } catch (error) {
    notify(error instanceof Error ? error.message : '检查更新失败')
  }
}

export async function downloadAvailableUpdate(): Promise<void> {
  try {
    updateState.value = await window.orbit.update.downloadUpdate()
  } catch (error) {
    notify(error instanceof Error ? error.message : '下载更新失败')
  }
}

export async function cancelUpdateDownload(): Promise<void> {
  updateState.value = await window.orbit.update.cancelDownload()
  notify('已取消更新下载')
}

export async function installDownloadedUpdate(): Promise<void> {
  try {
    await window.orbit.update.installUpdate()
  } catch (error) {
    notify(error instanceof Error ? error.message : '启动安装程序失败')
  }
}

export async function revealDownloadedUpdate(): Promise<void> {
  const revealed = await window.orbit.update.revealDownloadedFile()
  if (!revealed) notify('未找到已下载的安装包文件')
}

export async function openUpdateReleasePage(): Promise<void> {
  try {
    await window.orbit.update.openReleasePage()
  } catch (error) {
    notify(error instanceof Error ? error.message : '打开 GitHub 发布页失败')
  }
}

export async function updateUpdaterPreferences(patch: UpdatePreferencesPatch): Promise<void> {
  updateState.value = await window.orbit.update.updatePreferences(patch)
}

export async function saveSyncGroup(input: SyncGroupInput): Promise<void> {
  syncGroups.value = await window.orbit.groups.save(input)
  notify('同步分组已保存')
}

export async function removeSyncGroup(id: string): Promise<void> {
  syncGroups.value = await window.orbit.groups.remove(id)
  syncTunnels.value = syncTunnels.value.map((item) =>
    item.groupId === id ? { ...item, groupId: null } : item
  )
  notify('同步分组已移除')
}

export async function saveSyncTunnel(input: SyncTunnelInput): Promise<void> {
  syncTunnels.value = await window.orbit.tunnels.save(input)
  await refreshTunnelStatuses()
  notify('端口转发规则已保存')
}

export async function removeSyncTunnel(id: string): Promise<void> {
  syncTunnels.value = await window.orbit.tunnels.remove(id)
  const nextStatuses = { ...tunnelStatuses.value }
  delete nextStatuses[id]
  tunnelStatuses.value = nextStatuses
  notify('端口转发规则已删除')
}

export async function refreshTunnelStatuses(): Promise<void> {
  try {
    const list = await window.orbit.tunnels.statuses()
    const map: Record<string, TunnelRuntimeStatus> = {}
    for (const item of list) map[item.tunnelId] = item
    tunnelStatuses.value = map
  } catch {
    /* ignore background status refresh error */
  }
}

export async function toggleTunnelRuntime(id: string, active: boolean): Promise<void> {
  tunnelBusy.value = { ...tunnelBusy.value, [id]: true }
  try {
    const list = await window.orbit.tunnels.toggle({ id, active })
    const map: Record<string, TunnelRuntimeStatus> = {}
    for (const item of list) map[item.tunnelId] = item
    tunnelStatuses.value = map
    syncTunnels.value = syncTunnels.value.map((t) => (t.id === id ? { ...t, enabled: active } : t))
    notify(active ? '端口转发已启动并监听本地端口' : '端口转发已停止')
  } catch (error) {
    notify(error instanceof Error ? error.message : '切换端口转发状态失败')
  } finally {
    tunnelBusy.value = { ...tunnelBusy.value, [id]: false }
  }
}

export async function probeConnectivity(
  host: string,
  port: number,
  key = `${host}:${port}`
): Promise<NetProbeResult> {
  probeBusy.value = { ...probeBusy.value, [`net:${key}`]: true }
  try {
    const result = await window.orbit.net.probe({ host, port })
    probeResults.value = { ...probeResults.value, [key]: result }
    return result
  } finally {
    probeBusy.value = { ...probeBusy.value, [`net:${key}`]: false }
  }
}

export async function checkPortOccupancy(
  listenHost: string,
  listenPort: number,
  key = `${listenHost}:${listenPort}`
): Promise<PortCheckResult> {
  probeBusy.value = { ...probeBusy.value, [`port:${key}`]: true }
  try {
    const result = await window.orbit.net.checkPort({ listenHost, listenPort })
    portCheckResults.value = { ...portCheckResults.value, [key]: result }
    return result
  } finally {
    probeBusy.value = { ...probeBusy.value, [`port:${key}`]: false }
  }
}

export async function refreshKnownHosts(): Promise<void> {
  try {
    knownHosts.value = await window.orbit.knownHosts.list()
  } catch {
    /* ignore */
  }
}

export async function removeKnownHostEntry(hostKey: string): Promise<void> {
  knownHosts.value = await window.orbit.knownHosts.remove(hostKey)
  notify(`已移除 ${hostKey} 的主机指纹`)
}

export async function setSyncWriteMode(mode: 'realtime' | 'local-only'): Promise<void> {
  syncWriteMode.value = mode
  try {
    localStorage.setItem('orbit:sync-write-mode', mode)
  } catch {
    /* ignore */
  }
  if (syncStatus.value?.signedIn) {
    try {
      const res = await window.orbit.sync.updatePreferences({
        writeMode: mode,
        ...(mode === 'realtime' ? { autoSync: true } : {})
      })
      syncStatus.value = res.status
    } catch (error) {
      notify(error instanceof Error ? error.message : '更新同步写入模式失败')
      return
    }
  }
  notify(
    mode === 'realtime'
      ? '已切换为实时同步：增删改主机/分组/转发规则后将立即同步至服务端'
      : '已切换为仅保留本地修改：变更将仅保存在本机，不会自动上传到服务端'
  )
}

export async function refreshShells(): Promise<void> {
  if (shellsRefreshing.value || !bootstrap.value) return
  shellsRefreshing.value = true
  try {
    const updated = await window.orbit.shells.refresh()
    if (bootstrap.value) bootstrap.value = { ...bootstrap.value, shells: updated }
    notify(`已刷新本地终端，发现 ${updated.length} 项配置`)
  } catch (error) {
    notify(error instanceof Error ? error.message : '刷新本地终端失败')
  } finally {
    shellsRefreshing.value = false
  }
}

export function openEditor(host?: Host): void {
  editing.value = host
  saveError.value = ''
  editor.value = true
}

export async function saveHost(input: HostInput): Promise<void> {
  if (saveBusy.value) return
  saveBusy.value = true
  saveError.value = ''
  try {
    hosts.value = await window.orbit.hosts.save(input)
    editor.value = false
    notify('主机已保存到本机')
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : '保存失败，草稿已保留'
  } finally {
    input.password = ''
    saveBusy.value = false
  }
}

export async function toggleFavorite(host: Host): Promise<void> {
  try {
    hosts.value = await window.orbit.hosts.save({
      id: host.id,
      name: host.name,
      address: host.address,
      port: host.port,
      username: host.username,
      auth: host.auth,
      keepalive: host.keepalive ?? 30,
      group: host.group,
      notes: host.notes,
      favorite: !host.favorite
    })
  } catch (error) {
    notify(error instanceof Error ? error.message : '收藏保存失败')
  }
}

function canTabAccommodatePanes(
  tab: Tab | undefined,
  additionalPanes = 1,
  direction?: Tab['direction']
): { ok: boolean; reason?: string } {
  if (!tab) return { ok: false }
  const totalPanes = tab.panes.length + additionalPanes
  if (totalPanes > 4) {
    return { ok: false, reason: '当前开发版每个标签最多 4 个窗格。' }
  }
  const container = getPaneContainer(tab.token)
  const effectiveDirection = direction ?? tab.direction
  const vertical = effectiveDirection === 'vertical'
  if (
    container &&
    container.clientWidth > 0 &&
    container.clientHeight > 0 &&
    ((vertical && container.clientHeight / totalPanes < 180) ||
      (!vertical && container.clientWidth / totalPanes < 320))
  ) {
    return { ok: false, reason: '窗格空间不足，请放大窗口或新建标签。' }
  }
  return { ok: true }
}

export function canSplitCurrentTab(direction?: Tab['direction']): { ok: boolean; reason?: string } {
  return canTabAccommodatePanes(currentTab.value, 1, direction)
}

export function addPane(pane: Pane, split = false, placement: 'before' | 'after' = 'after'): boolean {
  if (split && currentTab.value) {
    const check = canSplitCurrentTab()
    if (!check.ok) {
      if (check.reason) notify(check.reason)
      return false
    }
    if (placement === 'before') currentTab.value.panes.unshift(pane)
    else currentTab.value.panes.push(pane)
    currentTab.value.focusedPaneToken = pane.token
    markSplitAnimation(pane.token)
  } else {
    const tab: Tab = {
      token: instanceToken(),
      title: pane.title,
      panes: [pane],
      focusedPaneToken: pane.token,
      direction: 'horizontal',
      ratio: 50
    }
    tabs.value.push(tab)
    activeTab.value = tab.token
  }
  page.value = 'workspace'
  return true
}

export function openLocal(
  profile: ShellProfile,
  split = false,
  placement: 'before' | 'after' = 'after'
): boolean {
  return addPane(
    {
      token: instanceToken(),
      title: profile.name,
      kind: 'local',
      profileId: profile.id,
      state: 'connecting'
    },
    split,
    placement
  )
}

export function connectHost(
  host: Host,
  split = false,
  password?: string,
  placement: 'before' | 'after' = 'after'
): boolean {
  if (split) {
    const check = canSplitCurrentTab()
    if (!check.ok) {
      if (check.reason) notify(check.reason)
      return false
    }
  }
  if (host.auth === 'password' && !host.hasPassword && password === undefined) {
    prompt.value = { kind: 'password', host, split, attempt: ++promptAttempt }
    return false
  }
  return addPane(
    { token: instanceToken(), title: host.name, kind: 'ssh', hostId: host.id, password, state: 'connecting' },
    split,
    placement
  )
}

export function splitActivePane(
  direction: Tab['direction'],
  placement: 'before' | 'after' = 'after'
): boolean {
  const tab = currentTab.value
  const source = focusedPane.value
  if (!tab || !source) return false
  const check = canSplitCurrentTab(direction)
  if (!check.ok) {
    if (check.reason) notify(check.reason)
    return false
  }
  tab.direction = direction
  tab.ratio = 50
  if (source.kind === 'local') {
    const profile = bootstrap.value?.shells.find((item) => item.id === source.profileId)
    if (profile) return openLocal(profile, true, placement)
    notify('原本地终端配置已不可用，请刷新后重试。')
    return false
  }
  const host = hosts.value.find((item) => item.id === source.hostId)
  if (host) return connectHost(host, true, undefined, placement)
  notify('原主机配置已删除，请新建连接。')
  return false
}

export function dockTabToSplit(
  sourceTabToken: string,
  targetTabToken: string,
  zone: SplitDropZone,
  targetPaneToken?: string
): boolean {
  if (!sourceTabToken || !targetTabToken) return false
  const direction: Tab['direction'] = zone === 'top' || zone === 'bottom' ? 'vertical' : 'horizontal'
  const placement: 'before' | 'after' = zone === 'left' || zone === 'top' ? 'before' : 'after'

  if (sourceTabToken === targetTabToken) {
    activeTab.value = targetTabToken
    return splitActivePane(direction, placement)
  }

  const sourceTab = tabs.value.find((tab) => tab.token === sourceTabToken)
  const targetTab = tabs.value.find((tab) => tab.token === targetTabToken)
  if (!sourceTab || !targetTab) return false

  const check = canTabAccommodatePanes(targetTab, sourceTab.panes.length, direction)
  if (!check.ok) {
    if (check.reason) notify(check.reason)
    return false
  }

  const movedFocus = sourceTab.focusedPaneToken || sourceTab.panes[0]?.token || ''
  targetTab.direction = direction
  targetTab.ratio = 50
  const anchorIdx = targetPaneToken ? targetTab.panes.findIndex((pane) => pane.token === targetPaneToken) : -1
  if (anchorIdx >= 0) {
    const insertAt = placement === 'before' ? anchorIdx : anchorIdx + 1
    targetTab.panes.splice(insertAt, 0, ...sourceTab.panes)
  } else if (placement === 'before') {
    targetTab.panes.unshift(...sourceTab.panes)
  } else {
    targetTab.panes.push(...sourceTab.panes)
  }

  tabs.value = tabs.value.filter((tab) => tab.token !== sourceTabToken)
  paneContainers.delete(sourceTabToken)
  if (movedFocus) targetTab.focusedPaneToken = movedFocus
  activeTab.value = targetTab.token
  page.value = 'workspace'
  if (movedFocus) markSplitAnimation(movedFocus)

  const zoneLabel = zone === 'left' ? '左侧' : zone === 'right' ? '右侧' : zone === 'top' ? '上方' : '下方'
  notify(`已将「${sourceTab.title}」并入${zoneLabel}分屏`)
  return true
}

export function movePaneToSplit(
  sourceTabToken: string,
  sourcePaneToken: string,
  targetTabToken: string,
  zone: SplitDropZone,
  targetPaneToken?: string
): boolean {
  if (!sourceTabToken || !sourcePaneToken || !targetTabToken) return false
  const sourceTab = tabs.value.find((tab) => tab.token === sourceTabToken)
  const targetTab = tabs.value.find((tab) => tab.token === targetTabToken)
  if (!sourceTab || !targetTab) return false
  const sourceIndex = sourceTab.panes.findIndex((pane) => pane.token === sourcePaneToken)
  if (sourceIndex < 0) return false

  const direction: Tab['direction'] = zone === 'top' || zone === 'bottom' ? 'vertical' : 'horizontal'
  const placement: 'before' | 'after' = zone === 'left' || zone === 'top' ? 'before' : 'after'
  const zoneLabel = zone === 'left' ? '左侧' : zone === 'right' ? '右侧' : zone === 'top' ? '上方' : '下方'

  // Same-tab split pane repositioning or direction flip
  if (sourceTabToken === targetTabToken) {
    if (sourceTab.panes.length <= 1) return false
    const prevDirection = sourceTab.direction
    const samePane = !targetPaneToken || targetPaneToken === sourcePaneToken
    if (samePane && prevDirection === direction) return false

    const [movedPane] = sourceTab.panes.splice(sourceIndex, 1)
    if (!movedPane) return false

    const anchorIdx =
      !samePane && targetPaneToken ? sourceTab.panes.findIndex((pane) => pane.token === targetPaneToken) : -1
    let insertAt: number
    if (anchorIdx >= 0) {
      insertAt = placement === 'before' ? anchorIdx : anchorIdx + 1
    } else {
      insertAt = placement === 'before' ? 0 : sourceTab.panes.length
    }
    sourceTab.panes.splice(insertAt, 0, movedPane)
    sourceTab.direction = direction
    if (prevDirection !== direction) {
      sourceTab.ratio = 50
    } else if (sourceTab.panes.length === 2 && sourceIndex !== insertAt) {
      sourceTab.ratio = 100 - sourceTab.ratio
    }
    sourceTab.focusedPaneToken = movedPane.token
    activeTab.value = sourceTab.token
    page.value = 'workspace'
    markSplitAnimation(movedPane.token)
    notify(`已将「${movedPane.title}」移动至${zoneLabel}分屏`)
    return true
  }

  // Cross-tab single pane migration into another tab's split layout
  const check = canTabAccommodatePanes(targetTab, 1, direction)
  if (!check.ok) {
    if (check.reason) notify(check.reason)
    return false
  }

  const [movedPane] = sourceTab.panes.splice(sourceIndex, 1)
  if (!movedPane) return false
  if (sourceTab.panes.length === 0) {
    tabs.value = tabs.value.filter((tab) => tab.token !== sourceTabToken)
    paneContainers.delete(sourceTabToken)
  } else {
    sourceTab.ratio = 50
    if (sourceTab.focusedPaneToken === sourcePaneToken) {
      sourceTab.focusedPaneToken =
        sourceTab.panes[Math.min(sourceIndex, sourceTab.panes.length - 1)]?.token ?? ''
    }
    if (sourceTab.panes.length === 1) {
      sourceTab.title = sourceTab.panes[0]!.title
    }
  }

  const anchorIdx = targetPaneToken ? targetTab.panes.findIndex((pane) => pane.token === targetPaneToken) : -1
  if (anchorIdx >= 0) {
    const insertAt = placement === 'before' ? anchorIdx : anchorIdx + 1
    targetTab.panes.splice(insertAt, 0, movedPane)
  } else if (placement === 'before') {
    targetTab.panes.unshift(movedPane)
  } else {
    targetTab.panes.push(movedPane)
  }
  targetTab.direction = direction
  targetTab.ratio = 50
  targetTab.focusedPaneToken = movedPane.token
  activeTab.value = targetTab.token
  page.value = 'workspace'
  markSplitAnimation(movedPane.token)
  notify(`已将「${movedPane.title}」移入目标${zoneLabel}分屏`)
  return true
}

export function detachPaneToTab(tabToken: string, paneToken: string): boolean {
  const tabIndex = tabs.value.findIndex((tab) => tab.token === tabToken)
  if (tabIndex < 0) return false
  const tab = tabs.value[tabIndex]!
  if (tab.panes.length <= 1) return false
  const paneIndex = tab.panes.findIndex((pane) => pane.token === paneToken)
  if (paneIndex < 0) return false

  const [pane] = tab.panes.splice(paneIndex, 1)
  tab.ratio = 50
  if (tab.focusedPaneToken === paneToken) {
    tab.focusedPaneToken = tab.panes[Math.min(paneIndex, tab.panes.length - 1)]?.token ?? ''
  }
  if (tab.panes.length === 1) {
    tab.title = tab.panes[0]!.title
  }

  const detachedTab: Tab = {
    token: instanceToken(),
    title: pane!.title,
    panes: [pane!],
    focusedPaneToken: pane!.token,
    direction: 'horizontal',
    ratio: 50
  }
  tabs.value.splice(tabIndex + 1, 0, detachedTab)
  activeTab.value = detachedTab.token
  page.value = 'workspace'
  markSplitAnimation(pane!.token)
  notify(`已将「${pane!.title}」拆分为独立标签页`)
  return true
}

export function closePane(tabToken: string, paneToken: string): void {
  const tab = tabs.value.find((item) => item.token === tabToken)
  if (!tab) return
  if (tab.panes.length <= 1) {
    closeTab(tabToken)
    return
  }
  const paneIndex = tab.panes.findIndex((pane) => pane.token === paneToken)
  if (paneIndex < 0) return
  tab.panes.splice(paneIndex, 1)
  tab.ratio = 50
  if (tab.focusedPaneToken === paneToken) {
    tab.focusedPaneToken = tab.panes[Math.min(paneIndex, tab.panes.length - 1)]?.token ?? ''
  }
  if (tab.panes.length === 1) {
    tab.title = tab.panes[0]!.title
  }
  dismissStalePanePrompts(paneToken)
  disposeTerminalByToken(windowInstance(paneToken))
}

export function closeTab(id: string): void {
  const index = tabs.value.findIndex((tab) => tab.token === id)
  const closing = index >= 0 ? tabs.value[index] : undefined
  tabs.value = tabs.value.filter((tab) => tab.token !== id)
  paneContainers.delete(id)
  if (closing) {
    for (const pane of closing.panes) {
      dismissStalePanePrompts(pane.token)
      disposeTerminalByToken(windowInstance(pane.token))
    }
  }
  if (activeTab.value === id) activeTab.value = tabs.value[Math.max(0, index - 1)]?.token ?? ''
}

export function reorderTab(sourceToken: string, targetToken: string): void {
  if (!sourceToken || sourceToken === targetToken) return
  const sourceIndex = tabs.value.findIndex((tab) => tab.token === sourceToken)
  const targetIndex = tabs.value.findIndex((tab) => tab.token === targetToken)
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return
  const [tab] = tabs.value.splice(sourceIndex, 1)
  tabs.value.splice(targetIndex, 0, tab!)
}

export function cycleTab(step: 1 | -1): void {
  if (!tabs.value.length) return
  const index = tabs.value.findIndex((tab) => tab.token === activeTab.value)
  const nextIndex = (index + step + tabs.value.length) % tabs.value.length
  activeTab.value = tabs.value[nextIndex]!.token
  page.value = 'workspace'
}

export async function confirmAction(password: string, savePassword = false): Promise<void> {
  const action = prompt.value
  if (!action || promptBusy.value) return
  promptBusy.value = true
  try {
    if (action.kind === 'password' && action.host) {
      if (savePassword && password && action.host.auth === 'password') {
        try {
          hosts.value = await window.orbit.hosts.save({
            id: action.host.id,
            name: action.host.name,
            address: action.host.address,
            port: action.host.port,
            username: action.host.username,
            auth: 'password',
            keepalive: action.host.keepalive ?? 30,
            group: action.host.group,
            notes: action.host.notes,
            favorite: action.host.favorite,
            password,
            savePassword: true
          })
          notify(`已更新「${action.host.name}」的保存密码`)
        } catch (error) {
          notify(error instanceof Error ? error.message : '密码保存失败，将仅用于本次连接')
        }
      }
      if (action.paneToken) {
        const targetPane = tabs.value
          .flatMap((tab) => tab.panes)
          .find((pane) => pane.token === action.paneToken)
        if (targetPane) {
          targetPane.password = password
          targetPane.state = 'connecting'
          targetPane.retrySeq = (targetPane.retrySeq ?? 0) + 1
        }
      } else {
        connectHost(action.host, action.split, password)
      }
    }
    if (action.kind === 'delete' && action.host) {
      hosts.value = await window.orbit.hosts.remove(action.host.id)
      if (selected.value === action.host.id) selected.value = undefined
      notify('主机配置已删除')
    }
    if (action.kind === 'trust' && action.trust) {
      await window.orbit.sessions.trust(action.trust.sessionId, true)
    }
    prompt.value = undefined
    advancePromptQueue()
  } catch (error) {
    notify(error instanceof Error ? error.message : '操作失败，请重试')
  } finally {
    promptBusy.value = false
    password = ''
  }
}

export function cancelAction(): void {
  if (prompt.value?.trust) {
    void window.orbit.sessions.trust(prompt.value.trust.sessionId, false).catch(() => {})
  }
  if (prompt.value?.kind === 'password' && prompt.value.paneToken) {
    const targetPane = tabs.value
      .flatMap((tab) => tab.panes)
      .find((pane) => pane.token === prompt.value?.paneToken)
    if (targetPane) {
      targetPane.password = undefined
      targetPane.state = 'error'
      targetPane.authCancelledSeq = (targetPane.authCancelledSeq ?? 0) + 1
    }
  }
  prompt.value = undefined
  advancePromptQueue()
}
