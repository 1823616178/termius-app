import type { TrayPreferencesPatch } from '../../../shared/contracts'
import type { UpdatePreferencesPatch } from '../../../shared/updater'
import { loadHostRecency } from '../services/host-recency'
import {
  assessMotionCapability,
  parseMotionPreference,
  probeMotionGraphics,
  resolveMotionPreference,
  sampleMotionFrame
} from '../services/motion-performance'
import { TERMINAL_THEMES, type TerminalThemeId } from '../services/terminal-themes'
import {
  applyUiThemeToDocument,
  DEFAULT_CUSTOM_COLORS,
  UI_THEME_PRESETS,
  type CustomUiColors,
  type UiThemeId
} from '../services/ui-themes'
import {
  copyOnSelect,
  cursorBlink,
  cursorStyle,
  customUiColors,
  focusUpdateSectionToken,
  fontSize,
  highContrast,
  lineHeight,
  motionCapability,
  motionFps,
  motionPreference,
  motionReason,
  motionTier,
  notify,
  page,
  screenReaderDefault,
  selectedShellId,
  sidebarWidth,
  syncWriteMode,
  terminalTheme,
  trayState,
  uiTheme,
  updateState
} from './workbench-state'

let motionMediaQuery: MediaQueryList | null = null
let motionGeneration = 0
let slowMotionWindows = 0

function applyMotionPreferences(): void {
  const root = document.documentElement
  if (root.dataset.motion !== motionTier.value) root.dataset.motion = motionTier.value
  if (root.dataset.motionPreference !== motionPreference.value) {
    root.dataset.motionPreference = motionPreference.value
  }
  if (root.dataset.motionReason !== motionReason.value) root.dataset.motionReason = motionReason.value
  const generation = String(motionGeneration)
  if (root.dataset.motionGeneration !== generation) root.dataset.motionGeneration = generation
}

export function applyVisualPreferences(): void {
  applyMotionPreferences()
  document.documentElement.dataset.contrast = highContrast.value ? 'high' : 'standard'
  applyUiThemeToDocument(uiTheme.value, customUiColors.value)
}

export function refreshMotionPreference(): void {
  const reducedMotion =
    motionMediaQuery?.matches ?? window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const graphics =
    motionPreference.value === 'auto'
      ? probeMotionGraphics(document.createElement('canvas'))
      : { webgl2Supported: true }
  const navigatorHints = navigator as Navigator & { deviceMemory?: number }
  motionCapability.value = assessMotionCapability({
    ...graphics,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigatorHints.deviceMemory,
    reducedMotion
  })
  const decision = resolveMotionPreference(motionPreference.value, motionCapability.value)
  motionGeneration += 1
  motionTier.value = decision.tier
  motionReason.value = decision.reason
  motionFps.value = null
  slowMotionWindows = 0
  applyVisualPreferences()
}

function handleSystemMotionChange(): void {
  refreshMotionPreference()
}

export function disposeMotionMediaListener(): void {
  motionMediaQuery?.removeEventListener('change', handleSystemMotionChange)
  motionMediaQuery = null
}

export function recordMotionFrameRate(fps: number): void {
  if (motionPreference.value !== 'auto' || motionTier.value === 'off' || !Number.isFinite(fps) || fps <= 0) {
    return
  }
  const sample = sampleMotionFrame({ tier: motionTier.value, fps, slowWindows: slowMotionWindows })
  slowMotionWindows = sample.slowWindows
  motionTier.value = sample.tier
  motionReason.value = sample.reason
  motionFps.value = sample.fps
  applyMotionPreferences()
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
  loadHostRecency()
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
    motionPreference.value = parseMotionPreference(localStorage.getItem('orbit:motion-tier'))
    highContrast.value = localStorage.getItem('orbit:high-contrast') === 'true'
    screenReaderDefault.value = localStorage.getItem('orbit:screen-reader') === 'true'
    const savedSidebar = Number(localStorage.getItem('orbit:sidebar-width'))
    if (savedSidebar >= 200 && savedSidebar <= 360) sidebarWidth.value = savedSidebar
  } catch {
    /* preferences are optional */
  }
  if (!motionMediaQuery) {
    motionMediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    motionMediaQuery.addEventListener('change', handleSystemMotionChange)
  }
  refreshMotionPreference()
}

export async function updateTrayPreferences(patch: TrayPreferencesPatch): Promise<void> {
  trayState.value = await window.orbit.tray.updatePreferences(patch)
}

export function hideWindowToTray(): void {
  window.orbit.window.hideToTray()
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
