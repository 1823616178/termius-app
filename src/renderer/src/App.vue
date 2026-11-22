<script setup lang="ts">
import { defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RefreshCw, Check, X } from '@lucide/vue'
import { matchAppShortcut } from '../../shared/shortcuts'
import TitleBar from './components/TitleBar.vue'
import NavRail from './components/NavRail.vue'
import HostSidebar from './components/HostSidebar.vue'
import StatusBar from './components/StatusBar.vue'
import ShortcutsModal from './components/ShortcutsModal.vue'
import WorkspacePage from './pages/WorkspacePage.vue'
import OrbitStage3D from './components/OrbitStage3D.vue'
import HostEditor from './components/HostEditor.vue'
import ActionDialog from './components/ActionDialog.vue'

const HostsPage = defineAsyncComponent(() => import('./pages/HostsPage.vue'))
const LocalPage = defineAsyncComponent(() => import('./pages/LocalPage.vue'))
const FilesPage = defineAsyncComponent(() => import('./pages/FilesPage.vue'))
const RemoteDesktopPage = defineAsyncComponent(() => import('./pages/RemoteDesktopPage.vue'))
const TunnelsPage = defineAsyncComponent(() => import('./pages/TunnelsPage.vue'))
const IdentitiesPage = defineAsyncComponent(() => import('./pages/IdentitiesPage.vue'))
const SyncPage = defineAsyncComponent(() => import('./pages/SyncPage.vue'))
const SettingsPage = defineAsyncComponent(() => import('./pages/SettingsPage.vue'))
import { updateAllTerminalsAppearance } from './services/terminal-registry'
import { resolveTerminalFontFamily } from './services/fonts'
import { disposeFilesWorkspaceListeners } from './services/files-workspace'
import { disposeRdpWorkspaceListeners } from './services/rdp-workspace'
import { t } from './services/i18n'
import {
  applyVisualPreferences,
  bootstrap,
  cancelAction,
  closeTab,
  confirmAction,
  copyOnSelect,
  currentTab,
  cursorBlink,
  cursorStyle,
  defaultShellProfile,
  disposeWorkbenchListeners,
  editing,
  editor,
  fontSize,
  highContrast,
  initError,
  initialize,
  lineHeight,
  loadSavedPreferences,
  motionPreference,
  refreshMotionPreference,
  notice,
  notifyCopiedSelection,
  openLocal,
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
  prompt,
  promptBusy,
  saveBusy,
  saveError,
  saveHost,
  screenReaderDefault,
  selectedShellId,
  showHelp,
  terminalCustomColors,
  terminalCustomColorsEnabled,
  terminalCustomFont,
  terminalFontId,
  terminalFontWeight,
  terminalFontWeightBold,
  terminalFrameRate,
  terminalTheme,
  terminalGpuEnabled,
  terminalLetterSpacing,
  terminalLigatures,
  terminalMinimumContrast,
  cycleTab
} from './stores/workbench'

const hostSidebar = ref<InstanceType<typeof HostSidebar>>()
const filesPageVisited = ref(false)
const remotePageVisited = ref(false)
watch(
  page,
  (nextPage) => {
    if (nextPage === 'files') filesPageVisited.value = true
    if (nextPage === 'remote') remotePageVisited.value = true
  },
  { immediate: true }
)
let panelCopyTimer: ReturnType<typeof setTimeout> | undefined
let lastPanelCopiedAt = 0
let lastPanelCopiedText = ''

function isInsideTerminalOrInput(node: Node | null): boolean {
  const el = node instanceof Element ? node : node?.parentElement
  if (!el) return false
  return Boolean(
    el.closest(
      '.xterm, input, textarea, select, [contenteditable], iron-remote-desktop, [data-rdp-capture="true"]'
    )
  )
}

function tryCopyPanelSelection(target: EventTarget | null): void {
  if (!panelCopyOnSelect.value) return
  if (target instanceof Node && isInsideTerminalOrInput(target)) return
  clearTimeout(panelCopyTimer)
  panelCopyTimer = setTimeout(() => {
    if (!panelCopyOnSelect.value) return
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) return
    if (isInsideTerminalOrInput(selection.anchorNode) || isInsideTerminalOrInput(selection.focusNode)) {
      return
    }
    const text = selection.toString()
    if (!text.trim()) return
    const now = Date.now()
    if (text === lastPanelCopiedText && now - lastPanelCopiedAt < 400) return
    lastPanelCopiedText = text
    lastPanelCopiedAt = now
    void window.orbit?.clipboard
      ?.writeText(text)
      .then(() => {
        notifyCopiedSelection(text)
      })
      .catch(() => {})
  }, 15)
}

function handlePanelPointerUp(event: PointerEvent): void {
  if (event.button !== 0) return
  tryCopyPanelSelection(event.target)
}

function handlePanelKeyUp(event: KeyboardEvent): void {
  if (!event.shiftKey && !((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a')) return
  tryCopyPanelSelection(event.target)
}

function handleShortcut(event: KeyboardEvent) {
  if (editor.value || prompt.value) return
  const action = matchAppShortcut(event)
  if (!action) return
  event.preventDefault()
  if (action === 'new-local-tab') {
    if (defaultShellProfile.value) openLocal(defaultShellProfile.value)
  } else if (action === 'close-tab') {
    if (currentTab.value) closeTab(currentTab.value.token)
  } else if (action === 'next-tab') {
    cycleTab(1)
  } else if (action === 'prev-tab') {
    cycleTab(-1)
  } else if (action === 'focus-host-search') {
    page.value = 'hosts'
    hostSidebar.value?.focusSearch()
  }
}

onMounted(() => {
  loadSavedPreferences()
  applyVisualPreferences()
  void initialize()
  document.addEventListener('keydown', handleShortcut)
  document.addEventListener('pointerup', handlePanelPointerUp)
  document.addEventListener('keyup', handlePanelKeyUp)
})

watch(
  [
    fontSize,
    terminalTheme,
    lineHeight,
    cursorStyle,
    cursorBlink,
    terminalFontId,
    terminalCustomFont,
    terminalFontWeight,
    terminalFontWeightBold,
    terminalLetterSpacing,
    terminalLigatures,
    terminalMinimumContrast,
    terminalCustomColorsEnabled,
    terminalCustomColors
  ],
  ([
    size,
    themeId,
    lh,
    cStyle,
    cBlink,
    fontId,
    customFont,
    weight,
    boldWeight,
    letterSp,
    ligatures,
    minContrast,
    customColorsOn,
    customColors
  ]) => {
    updateAllTerminalsAppearance({
      themeId,
      fontFamily: resolveTerminalFontFamily(fontId, customFont),
      fontSize: size,
      fontWeight: weight,
      fontWeightBold: boldWeight,
      lineHeight: lh,
      letterSpacing: letterSp,
      minimumContrastRatio: minContrast,
      ligatures,
      customColorsEnabled: customColorsOn,
      customColors: { ...customColors },
      cursorStyle: cStyle,
      cursorBlink: cBlink
    })
    try {
      localStorage.setItem('orbit:font-size', String(size))
      localStorage.setItem('orbit:terminal-theme', themeId)
      localStorage.setItem('orbit:line-height', String(lh))
      localStorage.setItem('orbit:cursor-style', cStyle)
      localStorage.setItem('orbit:cursor-blink', String(cBlink))
      localStorage.setItem('orbit:terminal-font-id', fontId)
      localStorage.setItem('orbit:terminal-custom-font', customFont)
      localStorage.setItem('orbit:terminal-font-weight', weight)
      localStorage.setItem('orbit:terminal-font-weight-bold', boldWeight)
      localStorage.setItem('orbit:terminal-letter-spacing', String(letterSp))
      localStorage.setItem('orbit:terminal-ligatures', String(ligatures))
      localStorage.setItem('orbit:terminal-min-contrast', String(minContrast))
      localStorage.setItem('orbit:terminal-custom-colors-enabled', String(customColorsOn))
      localStorage.setItem('orbit:terminal-custom-colors', JSON.stringify(customColors))
    } catch {
      /* storage unavailable */
    }
  },
  { deep: true }
)

watch(
  [
    panelFontId,
    panelCustomFont,
    panelDisplayFontId,
    panelCustomDisplayFont,
    panelFontSize,
    panelFontWeight,
    panelLineHeight,
    panelLetterSpacing,
    panelCustomColorsEnabled,
    panelCustomColors
  ],
  ([
    fontId,
    customFont,
    displayFontId,
    customDisplayFont,
    pSize,
    pWeight,
    pLh,
    pLetterSp,
    pCustomColorsOn,
    pCustomColors
  ]) => {
    applyVisualPreferences()
    try {
      localStorage.setItem('orbit:panel-font-id', fontId)
      localStorage.setItem('orbit:panel-custom-font', customFont)
      localStorage.setItem('orbit:panel-display-font-id', displayFontId)
      localStorage.setItem('orbit:panel-custom-display-font', customDisplayFont)
      localStorage.setItem('orbit:panel-font-size', String(pSize))
      localStorage.setItem('orbit:panel-font-weight', pWeight)
      localStorage.setItem('orbit:panel-line-height', String(pLh))
      localStorage.setItem('orbit:panel-letter-spacing', String(pLetterSp))
      localStorage.setItem('orbit:panel-custom-colors-enabled', String(pCustomColorsOn))
      localStorage.setItem('orbit:panel-custom-colors', JSON.stringify(pCustomColors))
    } catch {
      /* storage unavailable */
    }
  },
  { deep: true }
)

watch(panelCopyOnSelect, (value) => {
  try {
    localStorage.setItem('orbit:panel-copy-on-select', String(value))
  } catch {
    /* storage unavailable */
  }
})

watch(terminalFrameRate, (value) => {
  try {
    localStorage.setItem('orbit:terminal-frame-rate', String(value))
  } catch {
    /* storage unavailable */
  }
})

watch(terminalGpuEnabled, (enabled) => {
  try {
    localStorage.setItem('orbit:terminal-gpu', String(enabled))
  } catch {
    /* storage unavailable */
  }
})

watch(copyOnSelect, (value) => {
  try {
    localStorage.setItem('orbit:copy-on-select', String(value))
  } catch {
    /* storage unavailable */
  }
})

watch(selectedShellId, (value) => {
  try {
    if (value) localStorage.setItem('orbit:default-shell', value)
    else localStorage.removeItem('orbit:default-shell')
  } catch {
    /* storage unavailable */
  }
})

watch(motionPreference, (preference) => {
  refreshMotionPreference()
  try {
    localStorage.setItem('orbit:motion-tier', preference)
  } catch {
    /* storage unavailable */
  }
})

watch(highContrast, (contrast) => {
  applyVisualPreferences()
  try {
    localStorage.setItem('orbit:high-contrast', String(contrast))
  } catch {
    /* storage unavailable */
  }
})

watch(screenReaderDefault, (value) => {
  try {
    localStorage.setItem('orbit:screen-reader', String(value))
  } catch {
    /* storage unavailable */
  }
})

onBeforeUnmount(() => {
  clearTimeout(panelCopyTimer)
  disposeFilesWorkspaceListeners()
  disposeRdpWorkspaceListeners()
  disposeWorkbenchListeners()
  document.removeEventListener('keydown', handleShortcut)
  document.removeEventListener('pointerup', handlePanelPointerUp)
  document.removeEventListener('keyup', handlePanelKeyUp)
})
</script>

<template>
  <div class="container_app_shell_root_base">
    <TitleBar />
    <div class="container_app_layout_body_base">
      <NavRail />
      <HostSidebar ref="hostSidebar" />
      <main class="container_app_content_body_base">
        <div v-if="initError" class="container_app_loading_body_error" role="alert">
          <h2 class="container_app_loading_body_title">{{ t('app.loadErrorTitle') }}</h2>
          <p class="container_app_loading_body_description">{{ initError }}</p>
          <button class="container_app_loading_body_retry" type="button" @click="initialize">
            <RefreshCw :size="14" />
            {{ t('app.retry') }}
          </button>
        </div>
        <div v-else-if="!bootstrap" class="container_app_loading_body_pending" role="status">
          <OrbitStage3D variant="welcome" state="connecting" instance="app-boot" />
          <span class="container_app_loading_body_text">{{ t('app.booting') }}</span>
        </div>
        <template v-else>
          <WorkspacePage />
          <HostsPage v-if="page === 'hosts'" />
          <LocalPage v-if="page === 'local'" />
          <FilesPage v-if="filesPageVisited" v-show="page === 'files'" />
          <RemoteDesktopPage v-if="remotePageVisited" v-show="page === 'remote'" />
          <TunnelsPage v-if="page === 'tunnels'" />
          <IdentitiesPage v-if="page === 'identities'" />
          <SyncPage v-if="page === 'sync'" />
          <SettingsPage v-if="page === 'settings'" />
        </template>
      </main>
    </div>
    <StatusBar />
    <div v-if="notice" class="container_app_notification_overlay_base" role="status">
      <Check :size="15" />
      {{ notice }}
      <button
        class="container_app_notification_overlay_close"
        type="button"
        :aria-label="t('app.closeNotice')"
        @click="notice = ''"
      >
        <X :size="14" />
      </button>
    </div>
    <ShortcutsModal v-if="showHelp" />
    <HostEditor
      v-if="editor"
      :host="editing"
      :encryption-available="bootstrap?.encryptionAvailable ?? false"
      :busy="saveBusy"
      :error="saveError"
      @close="editor = false"
      @save="saveHost"
    />
    <ActionDialog
      v-if="prompt"
      :key="`${prompt.trust?.sessionId ?? prompt.paneToken ?? prompt.host?.id ?? ''}-${prompt.attempt ?? 0}`"
      :kind="prompt.kind"
      :title="
        prompt.kind === 'trust'
          ? prompt.trust?.previous
            ? t('app.dialog.trustChangedTitle')
            : t('app.dialog.trustConfirmTitle')
          : prompt.kind === 'delete'
            ? t('app.dialog.deleteHostTitle')
            : prompt.reason === 'auth-failed'
              ? t('app.dialog.reauthTitle', { name: prompt.host?.name ?? '' })
              : t('app.dialog.connectTitle', { name: prompt.host?.name ?? '' })
      "
      :description="
        prompt.kind === 'trust'
          ? `${prompt.trust?.address}:${prompt.trust?.port} · ${prompt.trust?.algorithm}${prompt.trust?.previous ? t('app.dialog.trustChangedSuffix') : ''}`
          : prompt.kind === 'delete'
            ? t('app.dialog.deleteHostDesc', { name: prompt.host?.name ?? '' })
            : prompt.reason === 'auth-failed'
              ? t('app.dialog.reauthDesc', {
                  user: prompt.host?.username ?? '',
                  host: prompt.host?.address ?? '',
                  port: prompt.host?.port ?? 22
                })
              : t('app.dialog.connectDesc', {
                  user: prompt.host?.username ?? '',
                  host: prompt.host?.address ?? '',
                  port: prompt.host?.port ?? 22
                })
      "
      :alert-message="
        prompt.kind === 'password' && prompt.reason === 'auth-failed'
          ? prompt.message || t('app.dialog.authFailedAlert')
          : undefined
      "
      :fingerprint="prompt.trust?.fingerprint"
      :previous="prompt.trust?.previous"
      :encryption-available="bootstrap?.encryptionAvailable ?? false"
      :has-saved-password="Boolean(prompt.host?.hasPassword)"
      :busy="promptBusy"
      @confirm="confirmAction"
      @cancel="cancelAction"
    />
  </div>
</template>
