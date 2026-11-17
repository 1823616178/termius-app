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
const TunnelsPage = defineAsyncComponent(() => import('./pages/TunnelsPage.vue'))
const IdentitiesPage = defineAsyncComponent(() => import('./pages/IdentitiesPage.vue'))
const SyncPage = defineAsyncComponent(() => import('./pages/SyncPage.vue'))
const SettingsPage = defineAsyncComponent(() => import('./pages/SettingsPage.vue'))
import { updateAllTerminalsAppearance } from './services/terminal-registry'
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
  openLocal,
  page,
  prompt,
  promptBusy,
  saveBusy,
  saveError,
  saveHost,
  screenReaderDefault,
  selectedShellId,
  showHelp,
  terminalTheme,
  cycleTab
} from './stores/workbench'

const hostSidebar = ref<InstanceType<typeof HostSidebar>>()

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
  void initialize()
  document.addEventListener('keydown', handleShortcut)
})

watch(
  [fontSize, terminalTheme, lineHeight, cursorStyle, cursorBlink],
  ([size, themeId, lh, cStyle, cBlink]) => {
    updateAllTerminalsAppearance({
      themeId,
      fontSize: size,
      lineHeight: lh,
      cursorStyle: cStyle,
      cursorBlink: cBlink
    })
    try {
      localStorage.setItem('orbit:font-size', String(size))
      localStorage.setItem('orbit:terminal-theme', themeId)
      localStorage.setItem('orbit:line-height', String(lh))
      localStorage.setItem('orbit:cursor-style', cStyle)
      localStorage.setItem('orbit:cursor-blink', String(cBlink))
    } catch {
      /* storage unavailable */
    }
  }
)

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
  disposeWorkbenchListeners()
  document.removeEventListener('keydown', handleShortcut)
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
          <h2 class="container_app_loading_body_title">无法读取本地工作区</h2>
          <p class="container_app_loading_body_description">{{ initError }}</p>
          <button class="container_app_loading_body_retry" type="button" @click="initialize">
            <RefreshCw :size="14" />
            重试
          </button>
        </div>
        <div v-else-if="!bootstrap" class="container_app_loading_body_pending" role="status">
          <OrbitStage3D variant="welcome" state="connecting" instance="app-boot" />
          <span class="container_app_loading_body_text">正在凝神开启青冥剑阁工作区…</span>
        </div>
        <template v-else>
          <WorkspacePage />
          <HostsPage v-if="page === 'hosts'" />
          <LocalPage v-if="page === 'local'" />
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
        aria-label="关闭通知"
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
            ? '主机指纹已变化'
            : '确认服务器身份'
          : prompt.kind === 'delete'
            ? '删除主机配置？'
            : prompt.reason === 'auth-failed'
              ? `重新输入密码 · ${prompt.host?.name}`
              : `连接 ${prompt.host?.name}`
      "
      :description="
        prompt.kind === 'trust'
          ? `${prompt.trust?.address}:${prompt.trust?.port} · ${prompt.trust?.algorithm}${prompt.trust?.previous ? '。密钥变更可能表示服务器重装或连接被拦截。' : ''}`
          : prompt.kind === 'delete'
            ? `删除 ${prompt.host?.name} 及其保存的密码。已经建立的终端会话会继续运行。`
            : prompt.reason === 'auth-failed'
              ? `${prompt.host?.username}@${prompt.host?.address}:${prompt.host?.port}。如不勾选保存，新密码仅用于本次重连。`
              : `${prompt.host?.username}@${prompt.host?.address}:${prompt.host?.port}。本次输入的密码默认不会保存到磁盘。`
      "
      :alert-message="
        prompt.kind === 'password' && prompt.reason === 'auth-failed'
          ? prompt.message || 'SSH 密码认证失败，请重新输入登录密码。'
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
