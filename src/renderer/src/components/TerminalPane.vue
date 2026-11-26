<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Accessibility,
  Clipboard,
  Copy,
  Eraser,
  ExternalLink,
  FolderOpen,
  GripVertical,
  Network,
  Palette,
  RotateCw,
  Search,
  Sparkles,
  TextSelect,
  X
} from '@lucide/vue'
import { instanceClass } from '../../../shared/classes'
import { MAX_CLIPBOARD_BYTES, type TerminalEvent } from '../../../shared/contracts'
import { matchTerminalShortcut, shouldInterceptInTerminal } from '../../../shared/shortcuts'
import { createTerminal, peekConnectedTerminal, type TerminalHandle } from '../services/terminal-registry'
import { resolveEffectiveTerminalTheme, resolveTerminalFontFamily } from '../services/fonts'
import { locale, t } from '../services/i18n'
import { markHostUsed } from '../services/host-recency'
import { buildShellColorizeCommand, cycleTerminalTheme, getTerminalTheme } from '../services/terminal-themes'
import {
  activeTerminalDimensions,
  copyOnSelect,
  cursorBlink,
  cursorStyle,
  fontSize,
  hosts,
  isPaneTokenMounted,
  lineHeight,
  notify,
  notifyCopiedSelection,
  prompt,
  syncTunnels,
  terminalCustomColors,
  terminalCustomColorsEnabled,
  terminalCustomFont,
  terminalFontId,
  terminalFontWeight,
  terminalFontWeightBold,
  terminalLetterSpacing,
  terminalLigatures,
  terminalMinimumContrast,
  terminalTheme,
  tunnelStatuses
} from '../stores/workbench'
import OrbitStage3D from './OrbitStage3D.vue'
import TerminalTunnelDrawer from './TerminalTunnelDrawer.vue'

const props = defineProps<{
  token: string
  title: string
  kind: 'local' | 'ssh'
  profileId?: string
  hostId?: string
  password?: string
  retrySeq?: number
  authCancelledSeq?: number
  visible: boolean
  focused: boolean
  canUnsplit?: boolean
  isDragging?: boolean
  sftpActive?: boolean
  sftpTransferCount?: number
  fontSize: number
  screenReaderDefault: boolean
}>()
const emit = defineEmits<{
  consumed: []
  state: [state: string]
  session: [sessionId: string | undefined]
  toggleSftp: []
  authFailed: [message: string]
  unsplit: []
  closePane: []
  headerDragStart: [event: DragEvent]
  headerDragEnd: []
}>()

const paneRoot = ref<HTMLElement>()
const surface = ref<HTMLElement>()
const searchInput = ref<HTMLInputElement>()
const pasteDialog = ref<HTMLDialogElement>()
const resumedSession = peekConnectedTerminal(props.token)
const status = ref<'connecting' | 'verifying' | 'authenticating' | 'running' | 'exited' | 'error'>(
  resumedSession?.state.state ?? 'connecting'
)
const message = ref('')
const lastErrorWasAuth = ref(false)
const tunnelDrawerOpen = ref(false)

const paneHost = computed(() =>
  props.hostId ? hosts.value.find((item) => item.id === props.hostId) : undefined
)
const paneTunnels = computed(() =>
  props.hostId ? syncTunnels.value.filter((item) => item.serverId === props.hostId) : syncTunnels.value
)
const activePaneTunnelCount = computed(
  () => paneTunnels.value.filter((t) => tunnelStatuses.value[t.id]?.active).length
)
const hudMounted = ref(props.kind === 'ssh' && !resumedSession)
const hudFading = ref(false)
let hudTimer: number | undefined

const searchOpen = ref(false)
const query = ref('')
const searchCase = ref(false)
const searchRegex = ref(false)
const searchWholeWord = ref(false)
const searchMeta = ref({ index: -1, count: 0 })

const screenReader = ref(props.screenReaderDefault)
const paste = ref<string | undefined>()
const dims = ref({ cols: 120, rows: 32 })
const contextMenu = ref<{ x: number; y: number } | null>(null)
const hasSelection = ref(false)

let handle: TerminalHandle | undefined
let mountSeq = 0
let unmounted = false
let resizeSub: { dispose: () => void } | undefined
let selectionSub: { dispose: () => void } | undefined
let searchSub: { dispose: () => void } | undefined

const c = (base: string, suffix?: string) =>
  instanceClass(base, suffix ? `${props.token}-${suffix}` : props.token)
const labels = computed<Record<string, string>>(() => {
  void locale.value
  return {
    connecting: t('terminal.status.connecting'),
    verifying: t('terminal.status.verifying'),
    authenticating: t('terminal.status.authenticating'),
    running: t('terminal.status.running'),
    exited: t('terminal.status.exited'),
    error: t('terminal.status.error')
  }
})

const effectiveTerminalTheme = computed(() =>
  resolveEffectiveTerminalTheme(
    terminalTheme.value,
    terminalCustomColorsEnabled.value,
    terminalCustomColors.value
  )
)

const badgeInfo = computed(() => {
  if (props.kind === 'ssh') return { text: 'SSH', tone: 'ssh' }
  if (props.profileId === 'pwsh') return { text: 'PS7', tone: 'pwsh' }
  if (props.profileId === 'powershell') return { text: 'PS', tone: 'ps' }
  if (props.profileId === 'cmd') return { text: 'CMD', tone: 'cmd' }
  if (props.profileId?.startsWith('wsl-')) return { text: 'WSL', tone: 'wsl' }
  if (props.profileId === 'zsh' || props.profileId?.startsWith('zsh-')) return { text: 'ZSH', tone: 'wsl' }
  if (props.profileId === 'fish' || props.profileId?.startsWith('fish-')) return { text: 'FISH', tone: 'wsl' }
  if (props.profileId === 'sh' || props.profileId?.startsWith('sh-')) return { text: 'SH', tone: 'wsl' }
  if (props.profileId === 'bash' || props.profileId?.startsWith('bash-')) return { text: 'BASH', tone: 'wsl' }
  return { text: 'PTY', tone: 'wsl' }
})

const searchResultText = computed(() => {
  if (!query.value) return ''
  if (searchMeta.value.count <= 0) return '0 / 0'
  return `${Math.max(1, searchMeta.value.index + 1)} / ${searchMeta.value.count}`
})

const paneCssVars = computed(() => ({
  '--pane-terminal-bg': effectiveTerminalTheme.value.background,
  '--pane-header-bg': effectiveTerminalTheme.value.headerBg,
  '--pane-border-glow': effectiveTerminalTheme.value.borderGlow
}))

const updateState = (event: Extract<TerminalEvent, { type: 'state' }>, silent = false) => {
  if (event.reason === 'auth-failed' && props.kind === 'ssh' && props.hostId) {
    lastErrorWasAuth.value = true
    message.value = event.message ?? t('app.dialog.authFailedAlert')
    if (hudTimer) {
      window.clearTimeout(hudTimer)
      hudTimer = undefined
    }
    hudMounted.value = false
    hudFading.value = false
    if (silent) {
      status.value = 'error'
      emit('state', 'error')
      return
    }
    status.value = 'authenticating'
    emit('state', 'authenticating')
    emit('authFailed', message.value)
    return
  }
  if (event.state === 'running' || event.state === 'connecting' || event.state === 'verifying') {
    lastErrorWasAuth.value = false
  }
  status.value = event.state
  message.value = event.message ?? ''
  if (props.kind === 'ssh') {
    if (hudTimer) {
      window.clearTimeout(hudTimer)
      hudTimer = undefined
    }
    if (event.state === 'connecting' || event.state === 'verifying' || event.state === 'authenticating') {
      hudMounted.value = true
      hudFading.value = false
    } else if (event.state === 'running') {
      hudFading.value = true
      hudTimer = window.setTimeout(() => {
        hudMounted.value = false
        hudTimer = undefined
      }, 190)
    } else {
      hudMounted.value = false
      hudFading.value = false
    }
  }
  emit('state', event.state)
}

function search(backward = false, incremental = false) {
  if (!query.value) {
    handle?.search.clearDecorations()
    searchMeta.value = { index: -1, count: 0 }
    return
  }
  const options = {
    incremental,
    caseSensitive: searchCase.value,
    regex: searchRegex.value,
    wholeWord: searchWholeWord.value,
    decorations: {
      matchBackground: '#4D3F1A',
      matchBorder: '#F5C46B',
      matchOverviewRuler: '#F5C46B',
      activeMatchBackground: '#184C61',
      activeMatchBorder: '#5BDCF4',
      activeMatchColorOverviewRuler: '#5BDCF4'
    }
  }
  if (backward) handle?.search.findPrevious(query.value, options)
  else handle?.search.findNext(query.value, options)
}

async function toggleSearch(open?: boolean) {
  const next = open ?? !searchOpen.value
  searchOpen.value = next
  await nextTick()
  if (next) {
    searchInput.value?.focus()
    searchInput.value?.select()
  } else {
    handle?.search.clearDecorations()
    handle?.terminal.focus()
  }
}

function toggleScreenReader() {
  screenReader.value = !screenReader.value
  if (handle) handle.terminal.options.screenReaderMode = screenReader.value
}

let pointerDragging = false
let pendingSelectionCopy = false
let lastCopiedSelectionText = ''
let lastCopiedSelectionAt = 0

function onSurfacePointerDown(event: PointerEvent): void {
  if (event.button !== 0) return
  pointerDragging = true
  pendingSelectionCopy = false
}

function onWindowPointerUp(event: PointerEvent): void {
  if (event.button !== 0 || !pointerDragging) return
  pointerDragging = false
  if (copyOnSelect.value && (pendingSelectionCopy || handle?.terminal.hasSelection())) {
    pendingSelectionCopy = false
    copySelection(true)
  }
}

function copySelection(fromAuto = false) {
  const selection = handle?.terminal.getSelection() ?? ''
  if (!selection) return
  if (fromAuto) {
    const now = Date.now()
    if (selection === lastCopiedSelectionText && now - lastCopiedSelectionAt < 300) return
    lastCopiedSelectionText = selection
    lastCopiedSelectionAt = now
  }
  void window.orbit.clipboard
    .writeText(selection)
    .then(() => {
      notifyCopiedSelection(selection)
    })
    .catch(() => {
      message.value = t('terminal.clipboardWriteFailed')
    })
}

function confirmPaste() {
  if (paste.value !== undefined) handle?.terminal.paste(paste.value)
  paste.value = undefined
}

async function pasteClipboard() {
  try {
    const text = await window.orbit.clipboard.readText()
    if (!text || !props.visible) return
    if (/[\r\n]/.test(text)) paste.value = text
    else handle?.terminal.paste(text)
  } catch (error) {
    message.value = error instanceof Error ? error.message : t('terminal.clipboardReadFailed')
  }
}

function colorizeShell() {
  contextMenu.value = null
  const script = buildShellColorizeCommand(props.kind, props.profileId)
  handle?.writeInput(script)
  handle?.terminal.focus()
  notify(t('terminal.colorizedNotice'))
}

function clearTerminal() {
  contextMenu.value = null
  handle?.clear()
  handle?.terminal.focus()
}

function selectAllTerminal() {
  contextMenu.value = null
  handle?.selectAll()
  handle?.terminal.focus()
}

function switchThemeNext() {
  contextMenu.value = null
  terminalTheme.value = cycleTerminalTheme(terminalTheme.value)
  const theme = getTerminalTheme(terminalTheme.value)
  notify(t('terminal.themeSwitchedNotice', { name: locale.value === 'en-US' ? theme.nameEn : theme.name }))
}

function closeContextMenu() {
  contextMenu.value = null
}

function onHeaderDragStart(event: DragEvent) {
  const target = event.target as HTMLElement | null
  if (target?.closest('button, input, select, [data-no-drag]')) {
    event.preventDefault()
    return
  }
  emit('headerDragStart', event)
}

function openContextMenu(event: MouseEvent) {
  const host = paneRoot.value
  if (!host) return
  const rect = host.getBoundingClientRect()
  const menuWidth = 200
  const menuHeight = 290
  const x = Math.min(Math.max(8, event.clientX - rect.left), Math.max(8, rect.width - menuWidth - 8))
  const y = Math.min(Math.max(40, event.clientY - rect.top), Math.max(40, rect.height - menuHeight - 8))
  hasSelection.value = Boolean(handle?.terminal.hasSelection())
  contextMenu.value = { x, y }
}

function onSurfaceWheel(event: WheelEvent) {
  if (!event.ctrlKey) return
  event.preventDefault()
  const next = Math.min(24, Math.max(10, fontSize.value + (event.deltaY < 0 ? 1 : -1)))
  if (next !== fontSize.value) fontSize.value = next
}

const interceptPaste = (event: ClipboardEvent) => {
  const text = event.clipboardData?.getData('text/plain')
  if (!text) return
  if (new TextEncoder().encode(text).length > MAX_CLIPBOARD_BYTES) {
    event.preventDefault()
    event.stopImmediatePropagation()
    message.value = t('terminal.pasteTooLarge')
    return
  }
  if (/[\r\n]/.test(text)) {
    event.preventDefault()
    event.stopImmediatePropagation()
    paste.value = text
  }
}

watch(paste, async (value) => {
  if (value === undefined) {
    pasteDialog.value?.close()
    if (props.visible && props.focused) handle?.terminal.focus()
    return
  }
  await nextTick()
  if (props.visible && paste.value !== undefined) pasteDialog.value?.showModal()
})

function detachSubscriptions() {
  resizeSub?.dispose()
  resizeSub = undefined
  selectionSub?.dispose()
  selectionSub = undefined
  searchSub?.dispose()
  searchSub = undefined
}

function disposeHandle() {
  mountSeq += 1
  detachSubscriptions()
  handle?.dispose()
  handle = undefined
  emit('session', undefined)
}

async function mountAndConnect() {
  disposeHandle()
  const targetSurface = surface.value
  if (!targetSurface || unmounted) return
  const seq = mountSeq
  lastErrorWasAuth.value = false
  // A pane remounted by drag/dock re-adopts its live session; don't flash the "connecting" UI.
  const resuming = Boolean(peekConnectedTerminal(props.token))
  if (!resuming) {
    status.value = 'connecting'
    message.value = ''
    hudMounted.value = props.kind === 'ssh'
    hudFading.value = false
  }

  let connectingHandle: TerminalHandle | undefined
  try {
    const created = await createTerminal(
      props.token,
      targetSurface,
      updateState,
      screenReader.value,
      {
        themeId: terminalTheme.value,
        fontFamily: resolveTerminalFontFamily(terminalFontId.value, terminalCustomFont.value),
        fontSize: props.fontSize,
        fontWeight: terminalFontWeight.value,
        fontWeightBold: terminalFontWeightBold.value,
        lineHeight: lineHeight.value,
        letterSpacing: terminalLetterSpacing.value,
        minimumContrastRatio: terminalMinimumContrast.value,
        ligatures: terminalLigatures.value,
        customColorsEnabled: terminalCustomColorsEnabled.value,
        customColors: { ...terminalCustomColors.value },
        cursorStyle: cursorStyle.value,
        cursorBlink: cursorBlink.value
      },
      {
        presented: props.visible,
        holdGpu: props.kind === 'ssh' && hudMounted.value
      }
    )
    if (unmounted || seq !== mountSeq || surface.value !== targetSurface) {
      if (isPaneTokenMounted(props.token)) {
        created.detachHost(targetSurface)
      } else {
        created.dispose()
      }
      return
    }
    handle = created
    handle.setPresented(props.visible)
    handle.setGpuHeld(props.kind === 'ssh' && hudMounted.value)
    connectingHandle = created
    const alreadyConnected = handle.isConnected()
    if (alreadyConnected) {
      updateState(handle.getLastState(), true)
    }
    dims.value = handle.getDimensions()
    if (props.visible && props.focused) activeTerminalDimensions.value = dims.value

    resizeSub = handle.terminal.onResize(({ cols, rows }) => {
      dims.value = { cols, rows }
      if (props.visible && props.focused) activeTerminalDimensions.value = dims.value
    })
    selectionSub = handle.terminal.onSelectionChange(() => {
      hasSelection.value = Boolean(handle?.terminal.hasSelection())
      if (copyOnSelect.value && hasSelection.value) {
        if (pointerDragging) pendingSelectionCopy = true
        else copySelection(true)
      }
    })
    searchSub = handle.search.onDidChangeResults(({ resultIndex, resultCount }) => {
      searchMeta.value = { index: resultIndex, count: resultCount }
    })

    handle.terminal.attachCustomKeyEventHandler((event) => {
      if (shouldInterceptInTerminal(event)) return false
      const action = matchTerminalShortcut(event)
      if (!action) return true
      if (action === 'copy') {
        event.preventDefault()
        copySelection()
        return false
      }
      if (action === 'paste') {
        event.preventDefault()
        void pasteClipboard()
        return false
      }
      if (action === 'search') {
        event.preventDefault()
        void toggleSearch()
        return false
      }
      return true
    })

    if (alreadyConnected) {
      emit('session', handle.getSessionId())
      handle.refresh()
      await nextTick()
      if (props.visible && props.focused) handle.terminal.focus()
      return
    }

    if (props.kind === 'local') {
      if (!props.profileId) throw new Error(t('terminal.missingLocalProfile'))
      await connectingHandle.connect({ kind: 'local', profileId: props.profileId })
    } else {
      if (!props.hostId) throw new Error(t('terminal.missingHostId'))
      markHostUsed(props.hostId)
      await connectingHandle.connect({ kind: 'ssh', hostId: props.hostId, password: props.password })
    }
    if (handle !== connectingHandle) return
    emit('session', handle.getSessionId())
    if (props.visible && props.focused) handle.terminal.focus()
  } catch (error) {
    if (connectingHandle && handle !== connectingHandle) return
    const errorMessage = error instanceof Error ? error.message : t('terminal.connectFailed')
    if (props.kind === 'ssh' && props.hostId && errorMessage.includes('请输入本次连接密码')) {
      lastErrorWasAuth.value = true
      status.value = 'authenticating'
      message.value = errorMessage
      hudMounted.value = false
      hudFading.value = false
      emit('state', 'authenticating')
      emit('authFailed', errorMessage)
    } else {
      updateState({
        type: 'state',
        state: 'error',
        message: errorMessage
      })
    }
  } finally {
    if (connectingHandle && handle === connectingHandle) emit('consumed')
  }
}

async function reconnectTerminal() {
  contextMenu.value = null
  if (props.kind === 'ssh' && !props.hostId) return
  if (
    props.kind === 'ssh' &&
    (lastErrorWasAuth.value || (paneHost.value?.auth === 'password' && !paneHost.value.hasPassword))
  ) {
    emit('authFailed', message.value || t('terminal.needPasswordPrompt'))
    return
  }
  await mountAndConnect()
}

onMounted(async () => {
  surface.value?.addEventListener('paste', interceptPaste, true)
  window.addEventListener('click', closeContextMenu)
  window.addEventListener('pointerup', onWindowPointerUp)
  await mountAndConnect()
})

watch(
  () => props.visible,
  (visible) => {
    handle?.setPresented(visible)
    if (visible && props.focused) {
      handle?.terminal.focus()
    } else if (!visible) {
      contextMenu.value = null
      paste.value = undefined
    }
  },
  { flush: 'post' }
)

watch(
  () => props.visible && props.focused,
  (active) => {
    if (active) activeTerminalDimensions.value = dims.value
  }
)

watch(hudMounted, (mounted) => {
  handle?.setGpuHeld(props.kind === 'ssh' && mounted)
})

watch(
  () => props.fontSize,
  (value) => {
    if (handle) {
      handle.terminal.options.fontSize = value
      handle.resize()
    }
  }
)

watch(
  () => props.screenReaderDefault,
  (value) => {
    screenReader.value = value
    if (handle) handle.terminal.options.screenReaderMode = value
  }
)

watch(
  () => props.retrySeq,
  (next, prev) => {
    if (next && next !== prev) {
      void mountAndConnect()
    }
  }
)

watch(
  () => props.authCancelledSeq,
  (next, prev) => {
    if (!next || next === prev) return
    if (lastErrorWasAuth.value) {
      updateState({
        type: 'state',
        state: 'error',
        message: t('terminal.authCancelled')
      })
    }
  }
)

onBeforeUnmount(() => {
  unmounted = true
  mountSeq += 1
  pointerDragging = false
  pendingSelectionCopy = false
  if (hudTimer) window.clearTimeout(hudTimer)
  surface.value?.removeEventListener('paste', interceptPaste, true)
  window.removeEventListener('click', closeContextMenu)
  window.removeEventListener('pointerup', onWindowPointerUp)
  if (isPaneTokenMounted(props.token)) {
    detachSubscriptions()
    if (surface.value) handle?.detachHost(surface.value)
    handle = undefined
  } else {
    disposeHandle()
  }
})
</script>

<template>
  <section
    ref="paneRoot"
    :class="c('container_workspace_terminal_root_base')"
    :data-state="status"
    :style="paneCssVars"
    @keydown.esc="contextMenu && closeContextMenu()"
  >
    <header
      :class="c('container_workspace_terminal_header_base')"
      :data-dragging="Boolean(isDragging)"
      draggable="true"
      :title="t('terminal.headerDragTitle')"
      @dragstart="onHeaderDragStart($event)"
      @dragend="emit('headerDragEnd')"
    >
      <span :class="c('container_workspace_terminal_header_grip')" aria-hidden="true">
        <GripVertical :size="13" />
      </span>
      <span :class="c('container_workspace_terminal_header_dot')" :data-state="status" />
      <span :class="c('container_workspace_terminal_header_badge')" :data-tone="badgeInfo.tone">
        {{ badgeInfo.text }}
      </span>
      <span :class="c('container_workspace_terminal_header_title')">{{ title }}</span>
      <span :class="c('container_workspace_terminal_header_status')" :data-state="status">
        {{ labels[status] }}
      </span>
      <span :class="c('container_workspace_terminal_header_dims')">{{ dims.cols }}×{{ dims.rows }}</span>
      <button
        :class="c('container_workspace_terminal_toolbar_sftp')"
        type="button"
        :aria-label="t('terminal.sftpAria')"
        :title="t('terminal.sftpTitle')"
        :aria-pressed="Boolean(sftpActive)"
        @click="emit('toggleSftp')"
      >
        <FolderOpen :size="14" />
        <span
          v-if="(sftpTransferCount ?? 0) > 0"
          :class="c('container_workspace_terminal_toolbar_sftp-count')"
        >
          {{ sftpTransferCount }}
        </span>
      </button>
      <button
        :class="c('container_workspace_terminal_toolbar_tunnels')"
        type="button"
        :aria-label="t('terminal.tunnelsAria')"
        :title="t('terminal.tunnelsTitle')"
        :aria-pressed="tunnelDrawerOpen"
        @click="tunnelDrawerOpen = !tunnelDrawerOpen"
      >
        <Network :size="14" />
        <span
          v-if="activePaneTunnelCount > 0"
          :class="c('container_workspace_terminal_toolbar_tunnel-count')"
        >
          {{ activePaneTunnelCount }}
        </span>
      </button>
      <button
        :class="c('container_workspace_terminal_toolbar_colorize')"
        type="button"
        :aria-label="t('terminal.colorizeAria')"
        :title="t('terminal.colorizeTitle')"
        @click="colorizeShell"
      >
        <Sparkles :size="14" />
      </button>
      <button
        :class="c('container_workspace_terminal_toolbar_search')"
        type="button"
        :aria-label="t('terminal.searchAria')"
        :title="t('terminal.searchTitle')"
        :aria-pressed="searchOpen"
        @click="toggleSearch()"
      >
        <Search :size="14" />
      </button>
      <button
        :class="c('container_workspace_terminal_toolbar_paste')"
        type="button"
        :aria-label="t('terminal.pasteAria')"
        :title="t('terminal.pasteTitle')"
        @click="pasteClipboard"
      >
        <Clipboard :size="14" />
      </button>
      <button
        :class="c('container_workspace_terminal_toolbar_clear')"
        type="button"
        :aria-label="t('terminal.clearAria')"
        :title="t('terminal.clearTitle')"
        @click="clearTerminal"
      >
        <Eraser :size="14" />
      </button>
      <button
        :class="c('container_workspace_terminal_toolbar_reconnect')"
        type="button"
        :aria-label="t('terminal.reconnectAria')"
        :title="t('terminal.reconnectTitle')"
        @click="reconnectTerminal"
      >
        <RotateCw :size="14" />
      </button>
      <button
        :class="c('container_workspace_terminal_toolbar_accessibility')"
        type="button"
        :aria-label="t('terminal.a11yAria')"
        :title="t('terminal.a11yTitle')"
        :aria-pressed="screenReader"
        @click="toggleScreenReader"
      >
        <Accessibility :size="14" />
      </button>
      <button
        v-if="canUnsplit"
        :class="c('container_workspace_terminal_toolbar_unsplit')"
        type="button"
        :aria-label="t('terminal.unsplitAria')"
        :title="t('terminal.unsplitAria')"
        @click="emit('unsplit')"
      >
        <ExternalLink :size="14" />
      </button>
      <button
        v-if="canUnsplit"
        :class="c('container_workspace_terminal_toolbar_close-pane')"
        type="button"
        :aria-label="t('terminal.closePaneAria')"
        :title="t('terminal.closePaneTitle')"
        @click="emit('closePane')"
      >
        <X :size="14" />
      </button>
    </header>
    <TerminalTunnelDrawer v-if="tunnelDrawerOpen" :token="token" :host-id="hostId" :tunnels="paneTunnels" />
    <form
      v-if="searchOpen"
      :class="c('container_workspace_terminal_toolbar_search-form')"
      @submit.prevent="search()"
      @keydown.esc.prevent="toggleSearch(false)"
    >
      <input
        ref="searchInput"
        v-model="query"
        :class="c('container_workspace_terminal_toolbar_search-input')"
        :aria-label="t('terminal.searchInputAria')"
        :placeholder="t('terminal.searchPlaceholder')"
        @input="search(false, true)"
      />
      <span v-if="searchResultText" :class="c('container_workspace_terminal_toolbar_search-count')">
        {{ searchResultText }}
      </span>
      <button
        :class="c('container_workspace_terminal_toolbar_search-case')"
        type="button"
        :title="t('terminal.searchCaseTitle')"
        :aria-pressed="searchCase"
        @click="
          () => {
            searchCase = !searchCase
            search(false, true)
          }
        "
      >
        Aa
      </button>
      <button
        :class="c('container_workspace_terminal_toolbar_search-word')"
        type="button"
        :title="t('terminal.searchWordTitle')"
        :aria-pressed="searchWholeWord"
        @click="
          () => {
            searchWholeWord = !searchWholeWord
            search(false, true)
          }
        "
      >
        W
      </button>
      <button
        :class="c('container_workspace_terminal_toolbar_search-regex')"
        type="button"
        :title="t('terminal.searchRegexTitle')"
        :aria-pressed="searchRegex"
        @click="
          () => {
            searchRegex = !searchRegex
            search(false, true)
          }
        "
      >
        .*
      </button>
      <button :class="c('container_workspace_terminal_toolbar_previous')" type="button" @click="search(true)">
        {{ t('terminal.searchPrev') }}
      </button>
      <button :class="c('container_workspace_terminal_toolbar_next')" type="submit">
        {{ t('terminal.searchNext') }}
      </button>
      <button
        :class="c('container_workspace_terminal_toolbar_close-search')"
        type="button"
        :aria-label="t('terminal.searchCloseAria')"
        @click="toggleSearch(false)"
      >
        <X :size="14" />
      </button>
    </form>
    <div v-if="message" :class="c('container_workspace_terminal_body_message')" role="status">
      <span :class="c('container_workspace_terminal_body_message-text')">{{ message }}</span>
      <button
        v-if="status === 'exited' || status === 'error'"
        :class="c('container_workspace_terminal_body_message-retry')"
        type="button"
        @click="reconnectTerminal"
      >
        <RotateCw :size="12" />
        {{ lastErrorWasAuth ? t('terminal.retryAuth') : t('terminal.retryConnect') }}
      </button>
    </div>
    <div
      ref="surface"
      :class="c('container_workspace_terminal_body_surface')"
      :data-terminal-token="token"
      @pointerdown="onSurfacePointerDown"
      @contextmenu.prevent.stop="openContextMenu"
      @wheel="onSurfaceWheel"
    />
    <div
      v-if="contextMenu"
      :class="c('container_workspace_terminal_overlay_context')"
      :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
      role="menu"
      :aria-label="t('terminal.menuAria')"
      @click.stop
    >
      <button
        :class="c('container_workspace_terminal_menu_copy')"
        type="button"
        :disabled="!hasSelection"
        @click="
          () => {
            copySelection()
            closeContextMenu()
          }
        "
      >
        <Copy :size="13" />
        {{ t('terminal.menuCopy') }}
      </button>
      <button
        :class="c('container_workspace_terminal_menu_paste')"
        type="button"
        @click="
          () => {
            closeContextMenu()
            void pasteClipboard()
          }
        "
      >
        <Clipboard :size="13" />
        {{ t('terminal.menuPaste') }}
      </button>
      <button :class="c('container_workspace_terminal_menu_colorize')" type="button" @click="colorizeShell">
        <Sparkles :size="13" />
        {{ t('terminal.menuColorize') }}
      </button>
      <button
        :class="c('container_workspace_terminal_menu_select-all')"
        type="button"
        @click="selectAllTerminal"
      >
        <TextSelect :size="13" />
        {{ t('terminal.menuSelectAll') }}
      </button>
      <button :class="c('container_workspace_terminal_menu_clear')" type="button" @click="clearTerminal">
        <Eraser :size="13" />
        {{ t('terminal.menuClear') }}
      </button>
      <button
        :class="c('container_workspace_terminal_menu_search')"
        type="button"
        @click="
          () => {
            closeContextMenu()
            void toggleSearch(true)
          }
        "
      >
        <Search :size="13" />
        {{ t('terminal.menuSearch') }}
      </button>
      <button :class="c('container_workspace_terminal_menu_theme')" type="button" @click="switchThemeNext">
        <Palette :size="13" />
        {{ t('terminal.menuTheme') }}
      </button>
      <button
        :class="c('container_workspace_terminal_menu_reconnect')"
        type="button"
        @click="reconnectTerminal"
      >
        <RotateCw :size="13" />
        {{ t('terminal.menuReconnect') }}
      </button>
    </div>
    <div
      v-if="hudMounted"
      :class="c('container_workspace_terminal_hud_base')"
      :data-fading="hudFading"
      :data-paused="status === 'verifying' || Boolean(prompt)"
      aria-hidden="true"
    >
      <div :class="c('container_workspace_terminal_hud_card')">
        <OrbitStage3D
          variant="compact"
          :state="status"
          :active="visible && !hudFading"
          :paused="status === 'verifying' || Boolean(prompt)"
          :instance="token"
        />
        <span :class="c('container_workspace_terminal_hud_stage')">
          {{
            status === 'verifying'
              ? t('terminal.hudVerifying')
              : status === 'authenticating'
                ? t('terminal.hudAuth')
                : status === 'running'
                  ? t('terminal.hudRunning')
                  : t('terminal.hudConnecting')
          }}
        </span>
      </div>
    </div>
    <dialog
      v-if="paste !== undefined"
      ref="pasteDialog"
      :class="c('container_workspace_terminal_overlay_paste')"
      role="dialog"
      aria-modal="true"
      :aria-label="t('terminal.pasteDialogAria')"
      @cancel.prevent="paste = undefined"
    >
      <strong :class="c('container_workspace_terminal_dialog_paste-title')">
        {{ t('terminal.pasteDialogTitle') }}
      </strong>
      <p :class="c('container_workspace_terminal_dialog_paste-help')">
        {{ t('terminal.pasteDialogHelp') }}
      </p>
      <pre :class="c('container_workspace_terminal_dialog_paste-preview')">{{ paste }}</pre>
      <footer :class="c('container_workspace_terminal_dialog_footer')">
        <button
          :class="c('container_workspace_terminal_dialog_cancel-paste')"
          type="button"
          @click="paste = undefined"
        >
          {{ t('actionDialog.cancel') }}
        </button>
        <button
          :class="c('container_workspace_terminal_dialog_confirm-paste')"
          type="button"
          autofocus
          data-primary
          @click="confirmPaste"
        >
          {{ t('terminal.pasteConfirm') }}
        </button>
      </footer>
    </dialog>
  </section>
</template>

<style scoped lang="scss">
.container_workspace_terminal_root_base {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  background: var(--pane-terminal-bg, var(--color-terminal-bg));
}
.container_workspace_terminal_header_base {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  flex-shrink: 0;
  padding: 0 10px;
  background: var(--pane-header-bg, var(--color-surface-tab));
  border-bottom: 1px solid var(--color-border);
  cursor: grab;
  user-select: none;
  transition:
    opacity 160ms ease,
    background 160ms ease,
    border-color 160ms ease;
  &:hover {
    border-bottom-color: var(--color-accent-primary-ring);
  }
  &[data-dragging='true'] {
    opacity: 0.62;
    cursor: grabbing;
    background: var(--color-accent-primary-soft);
  }
  > button {
    min-height: 24px;
    padding: 4px 6px;
    border-radius: 5px;
    cursor: pointer;
  }
}
.container_workspace_terminal_header_grip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
  margin-left: -4px;
  margin-right: -2px;
  opacity: 0.65;
  flex-shrink: 0;
  transition:
    color 140ms ease,
    opacity 140ms ease;
  .container_workspace_terminal_header_base:hover & {
    color: var(--color-accent-primary-hover);
    opacity: 1;
  }
}
.container_workspace_terminal_header_dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--color-warning);
  box-shadow: 0 0 8px rgba(245, 196, 107, 0.45);
  &[data-state='running'] {
    background: var(--color-success);
    box-shadow: 0 0 9px rgba(89, 214, 160, 0.65);
  }
  &[data-state='error'] {
    background: var(--color-error);
    box-shadow: 0 0 9px rgba(255, 125, 147, 0.55);
  }
  &[data-state='exited'] {
    background: var(--color-text-muted);
    box-shadow: none;
  }
}
.container_workspace_terminal_header_badge {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.4px;
  padding: 2px 6px;
  border-radius: 3px;
  border: 1px solid var(--color-accent-primary-ring);
  background: var(--color-accent-primary-soft);
  color: var(--color-accent-primary-hover);
  &[data-tone='pwsh'],
  &[data-tone='ps'] {
    border-color: var(--color-accent-secondary-ring);
    background: var(--color-accent-secondary-soft);
    color: var(--color-accent-secondary);
  }
  &[data-tone='wsl'] {
    border-color: rgba(245, 196, 107, 0.34);
    background: rgba(245, 196, 107, 0.14);
    color: #ffd166;
  }
  &[data-tone='cmd'] {
    border-color: rgba(165, 175, 194, 0.28);
    background: rgba(165, 175, 194, 0.12);
    color: #cbd5e1;
  }
}
.container_workspace_terminal_header_title {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.container_workspace_terminal_header_status {
  margin-right: auto;
  font-size: 11px;
  color: var(--color-text-muted);
  white-space: nowrap;
  &[data-state='running'] {
    color: var(--color-success);
  }
  &[data-state='error'] {
    color: var(--color-error);
  }
}
.container_workspace_terminal_header_dims {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-text-muted);
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
}
.container_workspace_terminal_toolbar_colorize {
  color: var(--color-accent-secondary);
}
.container_workspace_terminal_toolbar_unsplit:hover {
  color: var(--color-accent-secondary);
}
.container_workspace_terminal_toolbar_close-pane:hover {
  color: var(--color-error);
  background: var(--color-error-soft);
}
.container_workspace_terminal_toolbar_sftp,
.container_workspace_terminal_toolbar_search,
.container_workspace_terminal_toolbar_accessibility,
.container_workspace_terminal_toolbar_search-case,
.container_workspace_terminal_toolbar_search-word,
.container_workspace_terminal_toolbar_search-regex {
  &[aria-pressed='true'] {
    color: var(--color-accent-primary-hover);
    background: var(--color-accent-primary-soft);
    border-color: var(--color-accent-primary-ring);
  }
}
[class*='container_workspace_terminal_toolbar_sftp-count'] {
  font-size: 10px;
  font-weight: 700;
  color: var(--color-accent-secondary);
}
.container_workspace_terminal_body_surface {
  flex: 1;
  min-height: 0;
  padding: 0;
  overflow: hidden;
  background: radial-gradient(circle at 50% 0%, var(--color-accent-primary-soft), transparent 60%);
  box-shadow:
    inset 0 2px 14px rgba(0, 0, 0, 0.42),
    inset 0 0 0 1px rgba(255, 255, 255, 0.025);
}
.container_workspace_terminal_hud_base {
  position: absolute;
  inset: 34px 0 0;
  display: grid;
  place-items: center;
  pointer-events: none;
  opacity: 1;
  transition:
    opacity 180ms ease,
    transform 180ms ease;
  &[data-fading='true'] {
    opacity: 0;
    transform: translateY(-4px) scale(0.97);
  }
  &[data-paused='true'] {
    opacity: 0.35;
  }
}
.container_workspace_terminal_hud_card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 14px 20px 16px;
  border-radius: 6px;
  background: var(--surface-card-gradient);
  border: 1px solid var(--color-accent-primary-ring);
  box-shadow: var(--shadow-3d-dialog);
}
.container_workspace_terminal_hud_stage {
  font-size: 12px;
  color: var(--color-text-secondary);
  letter-spacing: 0.3px;
}
.container_workspace_terminal_body_message {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 12px;
  font-size: 12px;
  color: var(--color-warning);
  background: var(--color-warning-soft);
  border-bottom: 1px solid rgba(245, 196, 107, 0.18);
}
.container_workspace_terminal_body_message-retry {
  min-height: 24px;
  padding: 3px 9px;
  font-size: 11px;
  color: var(--color-accent-primary-hover);
  border: 1px solid var(--color-accent-primary-ring);
  background: var(--color-accent-primary-soft);
}
.container_workspace_terminal_toolbar_search-form {
  position: absolute;
  top: 42px;
  right: 14px;
  z-index: var(--z-floating);
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border-radius: 10px;
  background: var(--color-surface-1);
  backdrop-filter: blur(12px);
  border: 1px solid var(--pane-border-glow, var(--color-accent-primary-ring));
  box-shadow: var(--shadow-3d-card);
  > button {
    min-height: 26px;
    padding: 3px 7px;
    font-size: 11px;
  }
}
.container_workspace_terminal_toolbar_search-input {
  width: 170px;
  padding: 4px 8px;
  font-size: 12px;
}
.container_workspace_terminal_toolbar_search-count {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-text-muted);
  padding: 0 4px;
  white-space: nowrap;
}
.container_workspace_terminal_overlay_context {
  position: absolute;
  z-index: var(--z-dropdown);
  width: 196px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-radius: 10px;
  background: rgba(20, 24, 34, 0.96);
  backdrop-filter: blur(12px);
  border: 1px solid var(--pane-border-glow, var(--color-border-control));
  box-shadow: var(--shadow-3d-dialog);
  > button {
    justify-content: flex-start;
    min-height: 28px;
    padding: 5px 10px;
    font-size: 12px;
    color: var(--color-text-secondary);
  }
}
.container_workspace_terminal_overlay_paste {
  position: fixed;
  z-index: var(--z-modal);
  padding: 20px;
  background: var(--color-surface-2);
  border: 1px solid var(--color-accent-primary);
  border-radius: 10px;
  box-shadow: 0 16px 50px #0009;
  color: var(--color-text-primary);
  width: min(620px, 85vw);
  margin: auto;
  &::backdrop {
    background: var(--color-backdrop);
  }
}
.container_workspace_terminal_dialog_paste-help {
  color: var(--color-text-secondary);
  font-size: 12px;
}
.container_workspace_terminal_dialog_paste-preview {
  max-height: 240px;
  overflow: auto;
  padding: 12px;
  background: var(--color-app-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.container_workspace_terminal_dialog_footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}
[class*='container_workspace_terminal_toolbar_tunnel-count'] {
  font-size: 10px;
  font-weight: 700;
  color: var(--color-success);
}
</style>
