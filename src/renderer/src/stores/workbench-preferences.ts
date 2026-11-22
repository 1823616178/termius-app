import type { TrayPreferencesPatch } from '../../../shared/contracts'
import { parseTerminalFrameRate } from '../../../shared/flow-control'
import type { UpdatePreferencesPatch } from '../../../shared/updater'
import {
  applyPanelTypographyToDocument,
  DEFAULT_PANEL_DISPLAY_FONT_ID,
  DEFAULT_PANEL_FONT_ID,
  DEFAULT_PANEL_TEXT_COLORS,
  DEFAULT_TERMINAL_CUSTOM_COLORS,
  DEFAULT_TERMINAL_FONT_ID,
  mergeAvailableSystemFonts,
  type PanelTextColors,
  type TerminalCustomColors
} from '../services/fonts'
import { loadHostRecency } from '../services/host-recency'
import { applyLocaleToDocument, locale, parseAppLocale } from '../services/i18n'
import {
  assessMotionCapability,
  parseMotionPreference,
  probeMotionGraphics,
  resolveMotionPreference,
  sampleMotionFrame
} from '../services/motion-performance'
import { getTerminalTheme, TERMINAL_THEMES, type TerminalThemeId } from '../services/terminal-themes'
import {
  applyUiThemeToDocument,
  DEFAULT_CUSTOM_COLORS,
  UI_THEME_PRESETS,
  type CustomUiColors,
  type UiThemeId
} from '../services/ui-themes'
import {
  bootstrap,
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
  panelCopyOnSelect,
  panelCustomColors,
  panelCustomColorsEnabled,
  panelCustomDisplayFont,
  panelCustomFont,
  panelDisplayFontId,
  panelFontId,
  panelFontSize,
  panelFontWeight,
  panelLetterSpacing,
  panelLineHeight,
  screenReaderDefault,
  selectedShellId,
  sidebarWidth,
  syncWriteMode,
  systemFonts,
  systemFontsLoading,
  terminalCustomColors,
  terminalCustomColorsEnabled,
  terminalCustomFont,
  terminalFontId,
  terminalFontWeight,
  terminalFontWeightBold,
  terminalFrameRate,
  terminalGpuEnabled,
  terminalLetterSpacing,
  terminalLigatures,
  terminalMinimumContrast,
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
  applyPanelTypographyToDocument({
    fontId: panelFontId.value,
    customFont: panelCustomFont.value,
    displayFontId: panelDisplayFontId.value,
    customDisplayFont: panelCustomDisplayFont.value,
    fontSize: panelFontSize.value,
    fontWeight: panelFontWeight.value,
    lineHeight: panelLineHeight.value,
    letterSpacing: panelLetterSpacing.value,
    customColorsEnabled: panelCustomColorsEnabled.value,
    textColors: panelCustomColors.value
  })
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
  if (preset) {
    notify(locale.value === 'en-US' ? `UI theme switched: ${preset.nameEn}` : `已切换主题：${preset.name}`)
  }
}

export function syncTerminalCustomColorsWithPreset(): void {
  const preset = getTerminalTheme(terminalTheme.value)
  terminalCustomColors.value = {
    foreground: preset.theme.foreground || DEFAULT_TERMINAL_CUSTOM_COLORS.foreground,
    background: preset.background || DEFAULT_TERMINAL_CUSTOM_COLORS.background,
    cursor: preset.theme.cursor || DEFAULT_TERMINAL_CUSTOM_COLORS.cursor,
    selection: DEFAULT_TERMINAL_CUSTOM_COLORS.selection
  }
}

export function resetTerminalTypography(): void {
  terminalFontId.value = DEFAULT_TERMINAL_FONT_ID
  terminalCustomFont.value = ''
  fontSize.value = 14
  lineHeight.value = 1.28
  terminalFontWeight.value = '400'
  terminalFontWeightBold.value = '600'
  terminalLetterSpacing.value = 0
  terminalLigatures.value = true
  terminalMinimumContrast.value = 4.5
  terminalCustomColorsEnabled.value = false
  syncTerminalCustomColorsWithPreset()
}

export function resetPanelTypography(): void {
  panelFontId.value = DEFAULT_PANEL_FONT_ID
  panelCustomFont.value = ''
  panelDisplayFontId.value = DEFAULT_PANEL_DISPLAY_FONT_ID
  panelCustomDisplayFont.value = ''
  panelFontSize.value = 13
  panelFontWeight.value = '400'
  panelLineHeight.value = 1.5
  panelLetterSpacing.value = 0
  panelCustomColorsEnabled.value = false
  panelCustomColors.value = { ...DEFAULT_PANEL_TEXT_COLORS }
  applyVisualPreferences()
}

export async function loadSystemFonts(forceRefresh = false): Promise<void> {
  if (systemFontsLoading.value) return
  systemFontsLoading.value = true
  try {
    const discovered = (await window.orbit?.fonts?.listSystem?.(forceRefresh).catch(() => [])) ?? []
    systemFonts.value = mergeAvailableSystemFonts(discovered, bootstrap.value?.platform)
  } finally {
    systemFontsLoading.value = false
  }
}

export function loadSavedPreferences(): void {
  loadHostRecency()
  try {
    const savedLocale = parseAppLocale(localStorage.getItem('orbit:locale'))
    locale.value = savedLocale
    applyLocaleToDocument(savedLocale)
    try {
      void window.orbit?.locale?.set?.(savedLocale).catch(() => {})
    } catch {
      /* bridge optional */
    }

    const savedSize = Number(localStorage.getItem('orbit:font-size'))
    if (savedSize >= 10 && savedSize <= 28) fontSize.value = savedSize
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
    if (savedLineHeight >= 1.0 && savedLineHeight <= 1.8) {
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
    panelCopyOnSelect.value = localStorage.getItem('orbit:panel-copy-on-select') === 'true'
    terminalGpuEnabled.value = localStorage.getItem('orbit:terminal-gpu') !== 'false'
    terminalFrameRate.value = parseTerminalFrameRate(localStorage.getItem('orbit:terminal-frame-rate'))
    const savedShell = localStorage.getItem('orbit:default-shell')
    if (savedShell) selectedShellId.value = savedShell
    motionPreference.value = parseMotionPreference(localStorage.getItem('orbit:motion-tier'))
    highContrast.value = localStorage.getItem('orbit:high-contrast') === 'true'
    screenReaderDefault.value = localStorage.getItem('orbit:screen-reader') === 'true'
    const savedSidebar = Number(localStorage.getItem('orbit:sidebar-width'))
    if (savedSidebar >= 200 && savedSidebar <= 360) sidebarWidth.value = savedSidebar

    const savedTermFontId = localStorage.getItem('orbit:terminal-font-id')
    if (savedTermFontId) terminalFontId.value = savedTermFontId
    const savedTermCustomFont = localStorage.getItem('orbit:terminal-custom-font')
    if (savedTermCustomFont !== null) terminalCustomFont.value = savedTermCustomFont
    const savedTermWeight = localStorage.getItem('orbit:terminal-font-weight')
    if (savedTermWeight) terminalFontWeight.value = savedTermWeight
    const savedTermBoldWeight = localStorage.getItem('orbit:terminal-font-weight-bold')
    if (savedTermBoldWeight) terminalFontWeightBold.value = savedTermBoldWeight
    const savedTermLetterSpacing = Number(localStorage.getItem('orbit:terminal-letter-spacing'))
    if (
      Number.isFinite(savedTermLetterSpacing) &&
      savedTermLetterSpacing >= -1 &&
      savedTermLetterSpacing <= 4
    ) {
      terminalLetterSpacing.value = savedTermLetterSpacing
    }
    const savedTermLigatures = localStorage.getItem('orbit:terminal-ligatures')
    if (savedTermLigatures === 'true' || savedTermLigatures === 'false') {
      terminalLigatures.value = savedTermLigatures === 'true'
    }
    const savedMinContrast = Number(localStorage.getItem('orbit:terminal-min-contrast'))
    if (Number.isFinite(savedMinContrast) && savedMinContrast >= 1 && savedMinContrast <= 21) {
      terminalMinimumContrast.value = savedMinContrast
    }
    terminalCustomColorsEnabled.value =
      localStorage.getItem('orbit:terminal-custom-colors-enabled') === 'true'
    const savedTermColorsRaw = localStorage.getItem('orbit:terminal-custom-colors')
    if (savedTermColorsRaw) {
      const parsed = JSON.parse(savedTermColorsRaw) as Partial<TerminalCustomColors>
      terminalCustomColors.value = {
        foreground: parsed.foreground || DEFAULT_TERMINAL_CUSTOM_COLORS.foreground,
        background: parsed.background || DEFAULT_TERMINAL_CUSTOM_COLORS.background,
        cursor: parsed.cursor || DEFAULT_TERMINAL_CUSTOM_COLORS.cursor,
        selection: parsed.selection || DEFAULT_TERMINAL_CUSTOM_COLORS.selection
      }
    }

    const savedPanelFontId = localStorage.getItem('orbit:panel-font-id')
    if (savedPanelFontId) panelFontId.value = savedPanelFontId
    const savedPanelCustomFont = localStorage.getItem('orbit:panel-custom-font')
    if (savedPanelCustomFont !== null) panelCustomFont.value = savedPanelCustomFont
    const savedPanelDisplayFontId = localStorage.getItem('orbit:panel-display-font-id')
    if (savedPanelDisplayFontId) panelDisplayFontId.value = savedPanelDisplayFontId
    const savedPanelCustomDisplayFont = localStorage.getItem('orbit:panel-custom-display-font')
    if (savedPanelCustomDisplayFont !== null) panelCustomDisplayFont.value = savedPanelCustomDisplayFont
    const savedPanelFontSize = Number(localStorage.getItem('orbit:panel-font-size'))
    if (savedPanelFontSize >= 11 && savedPanelFontSize <= 20) panelFontSize.value = savedPanelFontSize
    const savedPanelWeight = localStorage.getItem('orbit:panel-font-weight')
    if (savedPanelWeight) panelFontWeight.value = savedPanelWeight
    const savedPanelLineHeight = Number(localStorage.getItem('orbit:panel-line-height'))
    if (savedPanelLineHeight >= 1.15 && savedPanelLineHeight <= 1.9) {
      panelLineHeight.value = Number(savedPanelLineHeight.toFixed(2))
    }
    const savedPanelLetterSpacing = Number(localStorage.getItem('orbit:panel-letter-spacing'))
    if (
      Number.isFinite(savedPanelLetterSpacing) &&
      savedPanelLetterSpacing >= -0.5 &&
      savedPanelLetterSpacing <= 3
    ) {
      panelLetterSpacing.value = savedPanelLetterSpacing
    }
    panelCustomColorsEnabled.value = localStorage.getItem('orbit:panel-custom-colors-enabled') === 'true'
    const savedPanelColorsRaw = localStorage.getItem('orbit:panel-custom-colors')
    if (savedPanelColorsRaw) {
      const parsed = JSON.parse(savedPanelColorsRaw) as Partial<PanelTextColors>
      panelCustomColors.value = {
        primary: parsed.primary || DEFAULT_PANEL_TEXT_COLORS.primary,
        secondary: parsed.secondary || DEFAULT_PANEL_TEXT_COLORS.secondary,
        muted: parsed.muted || DEFAULT_PANEL_TEXT_COLORS.muted,
        heading: parsed.heading || DEFAULT_PANEL_TEXT_COLORS.heading
      }
    }
  } catch {
    /* preferences are optional */
  }
  systemFonts.value = mergeAvailableSystemFonts([], bootstrap.value?.platform)
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
  const en = locale.value === 'en-US'
  try {
    const next = await window.orbit.update.checkForUpdates()
    updateState.value = next
    if (next.phase === 'available' && next.latest) {
      notify(en ? `New release found: v${next.latest.version}` : `发现新版本 v${next.latest.version}`)
    } else if (next.phase === 'up-to-date') {
      notify(next.message)
    } else if (next.phase === 'error' && next.error) {
      notify(en ? `Update check failed: ${next.error}` : `检查更新失败：${next.error}`)
    }
  } catch (error) {
    notify(error instanceof Error ? error.message : en ? 'Update check failed' : '检查更新失败')
  }
}

export async function downloadAvailableUpdate(): Promise<void> {
  const en = locale.value === 'en-US'
  try {
    updateState.value = await window.orbit.update.downloadUpdate()
  } catch (error) {
    notify(error instanceof Error ? error.message : en ? 'Failed to download update' : '下载更新失败')
  }
}

export async function cancelUpdateDownload(): Promise<void> {
  updateState.value = await window.orbit.update.cancelDownload()
  notify(locale.value === 'en-US' ? 'Update download cancelled' : '已取消更新下载')
}

export async function installDownloadedUpdate(): Promise<void> {
  const en = locale.value === 'en-US'
  try {
    await window.orbit.update.installUpdate()
  } catch (error) {
    notify(error instanceof Error ? error.message : en ? 'Failed to launch installer' : '启动安装程序失败')
  }
}

export async function revealDownloadedUpdate(): Promise<void> {
  const revealed = await window.orbit.update.revealDownloadedFile()
  if (!revealed) {
    notify(locale.value === 'en-US' ? 'Downloaded installer file not found' : '未找到已下载的安装包文件')
  }
}

export async function openUpdateReleasePage(): Promise<void> {
  const en = locale.value === 'en-US'
  try {
    await window.orbit.update.openReleasePage()
  } catch (error) {
    notify(
      error instanceof Error
        ? error.message
        : en
          ? 'Failed to open GitHub release page'
          : '打开 GitHub 发布页失败'
    )
  }
}

export async function updateUpdaterPreferences(patch: UpdatePreferencesPatch): Promise<void> {
  updateState.value = await window.orbit.update.updatePreferences(patch)
}
