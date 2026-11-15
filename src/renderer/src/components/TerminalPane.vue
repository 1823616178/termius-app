<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Accessibility,
  Clipboard,
  Copy,
  Eraser,
  ExternalLink,
  GripVertical,
  Network,
  Palette,
  Play,
  Plus,
  RotateCw,
  Search,
  Sparkles,
  Square,
  TextSelect,
  X
} from 'lucide-vue-next'
import { instanceClass } from '../../../shared/classes'
import { MAX_CLIPBOARD_BYTES, type TerminalEvent } from '../../../shared/contracts'
import { matchTerminalShortcut, shouldInterceptInTerminal } from '../../../shared/shortcuts'
import { createTerminal, type TerminalHandle } from '../services/terminal-registry'
import { buildShellColorizeCommand, cycleTerminalTheme, getTerminalTheme } from '../services/terminal-themes'
import {
  activeTerminalDimensions,
  checkPortOccupancy,
  copyOnSelect,
  cursorBlink,
  cursorStyle,
  fontSize,
  hosts,
  isPaneTokenMounted,
  lineHeight,
  notify,
  portCheckResults,
  probeConnectivity,
  probeResults,
  prompt,
  saveSyncTunnel,
  syncTunnels,
  terminalTheme,
  toggleTunnelRuntime,
  tunnelBusy,
  tunnelStatuses
} from '../stores/workbench'
import OrbitSelect from './OrbitSelect.vue'
import OrbitStage3D from './OrbitStage3D.vue'

const quickFwdTypeOptions = [
  { value: 'L', label: '-L 本地转发' },
  { value: 'R', label: '-R 远端转发' },
  { value: 'D', label: '-D SOCKS5' }
]

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
  canUnsplit?: boolean
  isDragging?: boolean
  fontSize: number
  screenReaderDefault: boolean
}>()
const emit = defineEmits<{
  consumed: []
  state: [state: string]
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
const status = ref<'connecting' | 'verifying' | 'authenticating' | 'running' | 'exited' | 'error'>(
  'connecting'
)
const message = ref('')
const lastErrorWasAuth = ref(false)
const tunnelDrawerOpen = ref(false)
const quickFwdType = ref<'L' | 'R' | 'D'>('L')
const quickFwdListenPort = ref(1080)
const quickFwdDestHost = ref('127.0.0.1')
const quickFwdDestPort = ref(8080)
const probeHostInput = ref('')
const probePortInput = ref(22)

const paneHost = computed(() =>
  props.hostId ? hosts.value.find((item) => item.id === props.hostId) : undefined
)
const paneTunnels = computed(() =>
  props.hostId ? syncTunnels.value.filter((item) => item.serverId === props.hostId) : syncTunnels.value
)
const activePaneTunnelCount = computed(
  () => paneTunnels.value.filter((t) => tunnelStatuses.value[t.id]?.active).length
)

watch(
  paneHost,
  (h) => {
    if (h) {
      probeHostInput.value = h.address
      probePortInput.value = h.port
    } else if (!probeHostInput.value) {
      probeHostInput.value = '127.0.0.1'
      probePortInput.value = 22
    }
  },
  { immediate: true }
)

async function runPaneConnectivityTest(): Promise<void> {
  const target = probeHostInput.value.trim() || paneHost.value?.address || '127.0.0.1'
  const port = Number(probePortInput.value) || paneHost.value?.port || 22
  const res = await probeConnectivity(target, port, `pane:${props.token}`)
  notify(res.reachable ? `${target}:${port} 连通 (${res.latencyMs} ms)` : res.message)
}

async function runPanePortCheck(): Promise<void> {
  const res = await checkPortOccupancy('127.0.0.1', Number(quickFwdListenPort.value), `pane:${props.token}`)
  notify(res.message)
}

async function createAndStartPaneTunnel(): Promise<void> {
  const sid = props.hostId ?? hosts.value[0]?.id
  if (!sid) {
    notify('请先在主机库添加 SSH 服务器再创建端口转发')
    return
  }
  await saveSyncTunnel({
    name: `终端转发-${quickFwdType.value}-${quickFwdListenPort.value}`,
    serverId: sid,
    groupId: null,
    type: quickFwdType.value,
    listenHost: '127.0.0.1',
    listenPort: Number(quickFwdListenPort.value),
    destHost: quickFwdType.value === 'D' ? '127.0.0.1' : quickFwdDestHost.value.trim() || '127.0.0.1',
    destPort: quickFwdType.value === 'D' ? 0 : Number(quickFwdDestPort.value),
    autoReconnect: true,
    enabled: false
  })
}
const hudMounted = ref(props.kind === 'ssh')
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
let resizeSub: { dispose: () => void } | undefined
let selectionSub: { dispose: () => void } | undefined
let searchSub: { dispose: () => void } | undefined

const c = (base: string, suffix?: string) =>
  instanceClass(base, suffix ? `${props.token}-${suffix}` : props.token)
const labels: Record<string, string> = {
  connecting: '连接中',
  verifying: '校验主机',
  authenticating: '认证中',
  running: '运行中',
  exited: '已退出',
  error: '连接失败'
}

const activeThemePreset = computed(() => getTerminalTheme(terminalTheme.value))

const badgeInfo = computed(() => {
  if (props.kind === 'ssh') return { text: 'SSH', tone: 'ssh' }
  if (props.profileId === 'pwsh') return { text: 'PS7', tone: 'pwsh' }
  if (props.profileId === 'powershell') return { text: 'PS', tone: 'ps' }
  if (props.profileId === 'cmd') return { text: 'CMD', tone: 'cmd' }
  return { text: 'WSL', tone: 'wsl' }
})

const searchResultText = computed(() => {
  if (!query.value) return ''
  if (searchMeta.value.count <= 0) return '0 / 0'
  return `${Math.max(1, searchMeta.value.index + 1)} / ${searchMeta.value.count}`
})

const paneCssVars = computed(() => ({
  '--pane-terminal-bg': activeThemePreset.value.background,
  '--pane-header-bg': activeThemePreset.value.headerBg,
  '--pane-border-glow': activeThemePreset.value.borderGlow
}))

const updateState = (event: Extract<TerminalEvent, { type: 'state' }>, silent = false) => {
  if (event.reason === 'auth-failed' && props.kind === 'ssh' && props.hostId) {
    lastErrorWasAuth.value = true
    message.value = event.message ?? 'SSH 密码认证失败，请重新输入登录密码。'
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

function copySelection() {
  const selection = handle?.terminal.getSelection() ?? ''
  if (!selection) return
  void window.orbit.clipboard.writeText(selection).catch(() => {
    message.value = '无法写入剪贴板。'
  })
}

function confirmPaste() {
  if (paste.value !== undefined) handle?.terminal.paste(paste.value)
  paste.value = undefined
  handle?.terminal.focus()
}

async function pasteClipboard() {
  try {
    const text = await window.orbit.clipboard.readText()
    if (!text) return
    if (/[\r\n]/.test(text)) paste.value = text
    else handle?.terminal.paste(text)
  } catch (error) {
    message.value = error instanceof Error ? error.message : '无法读取剪贴板。'
  }
}

function colorizeShell() {
  contextMenu.value = null
  const script = buildShellColorizeCommand(props.kind, props.profileId)
  handle?.writeInput(script)
  handle?.terminal.focus()
  notify('已为当前会话注入彩色提示符与命令高亮')
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
  notify(`已切换终端配色：${getTerminalTheme(terminalTheme.value).name}`)
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
    message.value = '粘贴内容超过 1 MiB 限制，请分批粘贴。'
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
    handle?.terminal.focus()
    return
  }
  await nextTick()
  pasteDialog.value?.showModal()
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
  detachSubscriptions()
  handle?.dispose()
  handle = undefined
}

async function mountAndConnect() {
  disposeHandle()
  if (!surface.value) return
  lastErrorWasAuth.value = false
  status.value = 'connecting'
  message.value = ''
  hudMounted.value = props.kind === 'ssh'
  hudFading.value = false

  handle = createTerminal(props.token, surface.value, updateState, screenReader.value, {
    themeId: terminalTheme.value,
    fontSize: props.fontSize,
    lineHeight: lineHeight.value,
    cursorStyle: cursorStyle.value,
    cursorBlink: cursorBlink.value
  })
  const alreadyConnected = handle.isConnected()
  if (alreadyConnected) {
    updateState(handle.getLastState(), true)
  }
  dims.value = handle.getDimensions()
  if (props.visible) activeTerminalDimensions.value = dims.value

  resizeSub = handle.terminal.onResize(({ cols, rows }) => {
    dims.value = { cols, rows }
    if (props.visible) activeTerminalDimensions.value = { cols, rows }
  })
  selectionSub = handle.terminal.onSelectionChange(() => {
    hasSelection.value = Boolean(handle?.terminal.hasSelection())
    if (copyOnSelect.value && hasSelection.value) {
      copySelection()
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
    handle.refresh()
    await nextTick()
    if (props.visible) handle.terminal.focus()
    return
  }

  try {
    if (props.kind === 'local') {
      if (!props.profileId) throw new Error('缺少本地终端配置标识')
      await handle.connect({ kind: 'local', profileId: props.profileId })
    } else {
      if (!props.hostId) throw new Error('缺少主机配置标识')
      await handle.connect({ kind: 'ssh', hostId: props.hostId, password: props.password })
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '连接失败'
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
    emit('consumed')
  }
}

async function reconnectTerminal() {
  contextMenu.value = null
  if (props.kind === 'ssh' && !props.hostId) return
  if (
    props.kind === 'ssh' &&
    (lastErrorWasAuth.value || (paneHost.value?.auth === 'password' && !paneHost.value.hasPassword))
  ) {
    emit('authFailed', message.value || '请重新输入 SSH 登录密码。')
    return
  }
  await mountAndConnect()
}

onMounted(async () => {
  surface.value?.addEventListener('paste', interceptPaste, true)
  window.addEventListener('click', closeContextMenu)
  await mountAndConnect()
})

watch(
  () => props.visible,
  async (visible) => {
    if (visible) {
      await nextTick()
      handle?.refresh()
      handle?.terminal.focus()
      if (handle) activeTerminalDimensions.value = handle.getDimensions()
    } else {
      contextMenu.value = null
    }
  }
)

watch(
  () => props.fontSize,
  (value) => {
    if (handle) {
      handle.terminal.options.fontSize = value
      handle.terminal.clearTextureAtlas()
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
        message: '已取消输入密码，SSH 密码认证未完成，请点击右侧按钮重新输入密码。'
      })
    }
  }
)

onBeforeUnmount(() => {
  if (hudTimer) window.clearTimeout(hudTimer)
  surface.value?.removeEventListener('paste', interceptPaste, true)
  window.removeEventListener('click', closeContextMenu)
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
      title="拖动窗格标题栏可调整分屏位置，或拖至标签栏拆分为独立标签"
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
        :class="c('container_workspace_terminal_toolbar_tunnels')"
        type="button"
        aria-label="端口转发与网络探测"
        title="展开端口转发、连通测速与本地端口占用检测"
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
        aria-label="注入彩色提示符与命令配色"
        title="一键注入彩色提示符与命令高亮"
        @click="colorizeShell"
      >
        <Sparkles :size="14" />
      </button>
      <button
        :class="c('container_workspace_terminal_toolbar_search')"
        type="button"
        aria-label="搜索终端输出"
        title="搜索终端输出 · Ctrl+Shift+F"
        :aria-pressed="searchOpen"
        @click="toggleSearch()"
      >
        <Search :size="14" />
      </button>
      <button
        :class="c('container_workspace_terminal_toolbar_paste')"
        type="button"
        aria-label="粘贴到终端"
        title="粘贴到终端 · Ctrl+Shift+V"
        @click="pasteClipboard"
      >
        <Clipboard :size="14" />
      </button>
      <button
        :class="c('container_workspace_terminal_toolbar_clear')"
        type="button"
        aria-label="清空终端输出"
        title="清空终端屏幕"
        @click="clearTerminal"
      >
        <Eraser :size="14" />
      </button>
      <button
        :class="c('container_workspace_terminal_toolbar_reconnect')"
        type="button"
        aria-label="重新连接当前终端"
        title="重新连接当前会话"
        @click="reconnectTerminal"
      >
        <RotateCw :size="14" />
      </button>
      <button
        :class="c('container_workspace_terminal_toolbar_accessibility')"
        type="button"
        aria-label="切换终端屏幕阅读器模式"
        title="切换无障碍阅读器模式"
        :aria-pressed="screenReader"
        @click="toggleScreenReader"
      >
        <Accessibility :size="14" />
      </button>
      <button
        v-if="canUnsplit"
        :class="c('container_workspace_terminal_toolbar_unsplit')"
        type="button"
        aria-label="拆分为独立标签页"
        title="拆分为独立标签页"
        @click="emit('unsplit')"
      >
        <ExternalLink :size="14" />
      </button>
      <button
        v-if="canUnsplit"
        :class="c('container_workspace_terminal_toolbar_close-pane')"
        type="button"
        aria-label="关闭此分屏"
        title="关闭此分屏窗格"
        @click="emit('closePane')"
      >
        <X :size="14" />
      </button>
    </header>
    <div v-if="tunnelDrawerOpen" :class="c('container_workspace_terminal_tunnel_drawer')">
      <div :class="c('container_workspace_terminal_tunnel_proberow')">
        <span :class="c('container_workspace_terminal_tunnel_label')">连通/端口检测</span>
        <input
          v-model="probeHostInput"
          :class="c('container_workspace_terminal_tunnel_probehost')"
          type="text"
          placeholder="目标地址"
        />
        <input
          v-model.number="probePortInput"
          :class="c('container_workspace_terminal_tunnel_probeport')"
          type="number"
          min="1"
          max="65535"
        />
        <button
          :class="c('container_workspace_terminal_tunnel_probebtn')"
          type="button"
          @click="runPaneConnectivityTest"
        >
          测试连通
        </button>
        <button
          :class="c('container_workspace_terminal_tunnel_checkport')"
          type="button"
          @click="runPanePortCheck"
        >
          测本地端口 {{ quickFwdListenPort }}
        </button>
        <span v-if="probeResults[`pane:${token}`]" :class="c('container_workspace_terminal_tunnel_proberes')">
          {{ probeResults[`pane:${token}`]?.message }}
        </span>
        <span
          v-if="portCheckResults[`pane:${token}`]"
          :class="c('container_workspace_terminal_tunnel_portres')"
        >
          {{ portCheckResults[`pane:${token}`]?.message }}
        </span>
      </div>
      <div :class="c('container_workspace_terminal_tunnel_quickadd')">
        <OrbitSelect
          :model-value="quickFwdType"
          :options="quickFwdTypeOptions"
          aria-label="转发模式"
          size="sm"
          width="132px"
          :instance="`pane-fwd-${token}`"
          @update:model-value="quickFwdType = $event as 'L' | 'R' | 'D'"
        />
        <input
          v-model.number="quickFwdListenPort"
          :class="c('container_workspace_terminal_tunnel_lport')"
          type="number"
          min="1"
          max="65535"
          placeholder="本地端口"
        />
        <input
          v-if="quickFwdType !== 'D'"
          v-model="quickFwdDestHost"
          :class="c('container_workspace_terminal_tunnel_dhost')"
          type="text"
          placeholder="目标地址"
        />
        <input
          v-if="quickFwdType !== 'D'"
          v-model.number="quickFwdDestPort"
          :class="c('container_workspace_terminal_tunnel_dport')"
          type="number"
          min="1"
          max="65535"
          placeholder="目标端口"
        />
        <button
          :class="c('container_workspace_terminal_tunnel_addbtn')"
          type="button"
          data-primary="true"
          @click="createAndStartPaneTunnel"
        >
          <Plus :size="12" />
          添加转发
        </button>
      </div>
      <div v-if="paneTunnels.length" :class="c('container_workspace_terminal_tunnel_list')">
        <div
          v-for="t in paneTunnels"
          :key="t.id"
          :class="c('container_workspace_terminal_tunnel_item', t.id)"
        >
          <span :class="c('container_workspace_terminal_tunnel_badge', t.id)">-{{ t.type }}</span>
          <span :class="c('container_workspace_terminal_tunnel_name', t.id)">
            {{ t.name }}
          </span>
          <code :class="c('container_workspace_terminal_tunnel_route', t.id)">
            {{ t.listenHost }}:{{ t.listenPort }} →
            {{ t.type === 'D' ? 'SOCKS5' : `${t.destHost}:${t.destPort}` }}
          </code>
          <button
            :class="c('container_workspace_terminal_tunnel_toggle', t.id)"
            type="button"
            :data-primary="!tunnelStatuses[t.id]?.active"
            :data-danger="Boolean(tunnelStatuses[t.id]?.active)"
            :disabled="Boolean(tunnelBusy[t.id])"
            @click="toggleTunnelRuntime(t.id, !tunnelStatuses[t.id]?.active)"
          >
            <Square v-if="tunnelStatuses[t.id]?.active" :size="11" />
            <Play v-else :size="11" />
            {{ tunnelStatuses[t.id]?.active ? '停止' : '启动' }}
          </button>
          <button
            :class="c('container_workspace_terminal_tunnel_portbtn', t.id)"
            type="button"
            @click="
              checkPortOccupancy(t.listenHost, t.listenPort, `pane:${token}`).then((r) => notify(r.message))
            "
          >
            测端口
          </button>
        </div>
      </div>
    </div>
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
        aria-label="终端搜索内容"
        placeholder="搜索输出…"
        @input="search(false, true)"
      />
      <span v-if="searchResultText" :class="c('container_workspace_terminal_toolbar_search-count')">
        {{ searchResultText }}
      </span>
      <button
        :class="c('container_workspace_terminal_toolbar_search-case')"
        type="button"
        title="区分大小写"
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
        title="全字匹配"
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
        title="正则表达式"
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
        上一个
      </button>
      <button :class="c('container_workspace_terminal_toolbar_next')" type="submit">下一个</button>
      <button
        :class="c('container_workspace_terminal_toolbar_close-search')"
        type="button"
        aria-label="关闭搜索"
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
        {{ lastErrorWasAuth ? '输入密码重试' : '重新连接' }}
      </button>
    </div>
    <div
      ref="surface"
      :class="c('container_workspace_terminal_body_surface')"
      :data-terminal-token="token"
      @contextmenu.prevent.stop="openContextMenu"
      @wheel="onSurfaceWheel"
    />
    <div
      v-if="contextMenu"
      :class="c('container_workspace_terminal_overlay_context')"
      :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
      role="menu"
      aria-label="终端操作菜单"
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
        复制选中内容
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
        粘贴剪贴板
      </button>
      <button :class="c('container_workspace_terminal_menu_colorize')" type="button" @click="colorizeShell">
        <Sparkles :size="13" />
        注入彩色环境
      </button>
      <button
        :class="c('container_workspace_terminal_menu_select-all')"
        type="button"
        @click="selectAllTerminal"
      >
        <TextSelect :size="13" />
        全选缓冲区
      </button>
      <button :class="c('container_workspace_terminal_menu_clear')" type="button" @click="clearTerminal">
        <Eraser :size="13" />
        清空屏幕
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
        搜索终端输出
      </button>
      <button :class="c('container_workspace_terminal_menu_theme')" type="button" @click="switchThemeNext">
        <Palette :size="13" />
        切换终端配色
      </button>
      <button
        :class="c('container_workspace_terminal_menu_reconnect')"
        type="button"
        @click="reconnectTerminal"
      >
        <RotateCw :size="13" />
        重新连接
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
              ? '等待确认主机指纹'
              : status === 'authenticating'
                ? '正在完成 SSH 认证…'
                : status === 'running'
                  ? '加密通道已就绪'
                  : '正在建立 SSH 连接…'
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
      aria-label="确认多行粘贴"
      @cancel.prevent="paste = undefined"
    >
      <strong :class="c('container_workspace_terminal_dialog_paste-title')">确认粘贴多行内容</strong>
      <p :class="c('container_workspace_terminal_dialog_paste-help')">
        换行可能触发命令执行。请检查内容及当前终端。
      </p>
      <pre :class="c('container_workspace_terminal_dialog_paste-preview')">{{ paste }}</pre>
      <footer :class="c('container_workspace_terminal_dialog_footer')">
        <button
          :class="c('container_workspace_terminal_dialog_cancel-paste')"
          type="button"
          @click="paste = undefined"
        >
          取消
        </button>
        <button
          :class="c('container_workspace_terminal_dialog_confirm-paste')"
          type="button"
          data-primary
          @click="confirmPaste"
        >
          确认粘贴
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
    border-bottom-color: rgba(167, 139, 250, 0.34);
  }
  &[data-dragging='true'] {
    opacity: 0.62;
    cursor: grabbing;
    background: rgba(167, 139, 250, 0.14);
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
  border-radius: 4px;
  border: 1px solid rgba(167, 139, 250, 0.28);
  background: rgba(167, 139, 250, 0.12);
  color: var(--color-accent-primary-hover);
  &[data-tone='pwsh'],
  &[data-tone='ps'] {
    border-color: rgba(91, 220, 244, 0.34);
    background: rgba(91, 220, 244, 0.14);
    color: #7af2ff;
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
.container_workspace_terminal_body_surface {
  flex: 1;
  min-height: 0;
  padding: 0;
  overflow: hidden;
  background: radial-gradient(circle at 50% 0%, rgba(167, 139, 250, 0.045), transparent 60%);
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
  border-radius: 14px;
  background: var(--surface-card-gradient);
  border: 1px solid rgba(167, 139, 250, 0.25);
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
  background: rgba(20, 24, 34, 0.92);
  backdrop-filter: blur(12px);
  border: 1px solid var(--pane-border-glow, rgba(167, 139, 250, 0.35));
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
[class*='container_workspace_terminal_tunnel_drawer'] {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 9px 12px;
  background: var(--color-surface-1);
  border-bottom: 1px solid var(--color-border);
  font-size: 12px;
  input {
    padding: 4px 8px;
    font-size: 12px;
  }
  button:not([role='combobox']):not([role='option']) {
    min-height: 26px;
    padding: 3px 8px;
    font-size: 11px;
  }
}
[class*='container_workspace_terminal_tunnel_proberow'],
[class*='container_workspace_terminal_tunnel_quickadd'] {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
[class*='container_workspace_terminal_tunnel_probeport'],
[class*='container_workspace_terminal_tunnel_lport'],
[class*='container_workspace_terminal_tunnel_dport'] {
  width: 78px;
}
[class*='container_workspace_terminal_tunnel_list'] {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
[class*='container_workspace_terminal_tunnel_item'] {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 6px;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border-subtle);
  flex-wrap: wrap;
}
[class*='container_workspace_terminal_tunnel_route'] {
  font-family: var(--font-mono);
  color: var(--color-accent-secondary);
}
</style>
