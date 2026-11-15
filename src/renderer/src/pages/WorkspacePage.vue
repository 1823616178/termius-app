<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Columns2,
  Plus,
  Rows2,
  ShieldCheck,
  SquareTerminal,
  Terminal,
  X
} from 'lucide-vue-next'
import { instanceClass } from '../../../shared/classes'
import OrbitSelect from '../components/OrbitSelect.vue'
import OrbitStage3D from '../components/OrbitStage3D.vue'
import TerminalPane from '../components/TerminalPane.vue'
import { TERMINAL_THEMES, type TerminalThemeId } from '../services/terminal-themes'
import {
  activeTab,
  bootstrap,
  closePane,
  closeTab,
  currentTab,
  defaultShellProfile,
  detachPaneToTab,
  dockTabToSplit,
  fontSize,
  getPaneContainer,
  movePaneToSplit,
  openEditor,
  openLocal,
  page,
  registerPaneContainer,
  reorderTab,
  requestPanePassword,
  resolveSplitDropZone,
  screenReaderDefault,
  selectedShellId,
  splitActivePane,
  splitEnteredPaneToken,
  tabs,
  terminalTheme,
  windowInstance,
  type Pane,
  type SplitDropZone,
  type Tab
} from '../stores/workbench'

type DraggedPaneState = {
  tabToken: string
  paneToken: string
  title: string
}

type DragPayload = { kind: 'tab'; tabToken: string } | { kind: 'pane'; tabToken: string; paneToken: string }

type PreviewInsets = {
  top: number
  right: number
  bottom: number
  left: number
}

const draggedTab = ref('')
const draggedPane = ref<DraggedPaneState | null>(null)
const dropTargetTab = ref('')
const dropTargetTabbarEmpty = ref(false)
const splitDropZone = ref<SplitDropZone | null>(null)
const targetPaneToken = ref('')
const previewInsets = ref<PreviewInsets | null>(null)
const dragPointerBlock = ref(false)
const ctaHovered = ref(false)
let dragBlockRaf = 0
let tabHoverSwitchTimer = 0

const shellOptions = computed(() =>
  (bootstrap.value?.shells ?? []).map((shell) => ({
    value: shell.id,
    label: shell.name
  }))
)

const terminalThemeOptions = computed(() =>
  TERMINAL_THEMES.map((preset) => ({
    value: preset.id,
    label: preset.name,
    hint: preset.badge,
    swatch: preset.swatches[1] || preset.swatches[0]
  }))
)

const c = (base: string, token: string) => instanceClass(base, windowInstance(token))
const draggedTabInfo = computed(() => tabs.value.find((item) => item.token === draggedTab.value))
const isDraggingAny = computed(() => Boolean(draggedTab.value || draggedPane.value))
const dragSourceTitle = computed(() => draggedPane.value?.title ?? draggedTabInfo.value?.title ?? '')
const canDetachDraggedPane = computed(() => {
  if (!draggedPane.value) return false
  const sourceTab = tabs.value.find((item) => item.token === draggedPane.value?.tabToken)
  return Boolean(sourceTab && sourceTab.panes.length > 1)
})

function splitOverlayText(targetToken: string): string {
  const zone = splitDropZone.value ?? 'right'
  if (draggedPane.value) {
    const merging = draggedPane.value.tabToken !== targetToken
    if (zone === 'left') return merging ? '并入左侧分屏' : '移至左侧分屏'
    if (zone === 'right') return merging ? '并入右侧分屏' : '移至右侧分屏'
    if (zone === 'top') return merging ? '并入上方分屏' : '移至上方分屏'
    return merging ? '并入下方分屏' : '移至下方分屏'
  }
  const merging = draggedTab.value !== targetToken
  if (zone === 'left') return merging ? '并入左侧分屏' : '向左侧分屏'
  if (zone === 'right') return merging ? '并入右侧分屏' : '向右侧分屏'
  if (zone === 'top') return merging ? '并入上方分屏' : '向上方分屏'
  return merging ? '并入下方分屏' : '向下方分屏'
}

function splitOverlayHintText(): string {
  if (draggedPane.value) {
    if (!splitDropZone.value) {
      return `${draggedPane.value.title} · 拖至其他窗格、上/下边缘或标签栏拆分`
    }
    return `${draggedPane.value.title} · 释放完成位置调整`
  }
  return `${dragSourceTitle.value} · 释放即完成分屏`
}

function splitPreviewStyle(): Record<string, string> {
  if (!previewInsets.value) return {}
  return {
    opacity: '1',
    top: `${previewInsets.value.top}px`,
    right: `${previewInsets.value.right}px`,
    bottom: `${previewInsets.value.bottom}px`,
    left: `${previewInsets.value.left}px`
  }
}

function scheduleDragPointerBlock() {
  if (dragBlockRaf) window.cancelAnimationFrame(dragBlockRaf)
  dragBlockRaf = window.requestAnimationFrame(() => {
    dragBlockRaf = 0
    if (draggedTab.value || draggedPane.value) {
      dragPointerBlock.value = true
    }
  })
}

function clearTabHoverSwitchTimer() {
  if (tabHoverSwitchTimer) {
    window.clearTimeout(tabHoverSwitchTimer)
    tabHoverSwitchTimer = 0
  }
}

function endTabDrag() {
  if (dragBlockRaf) {
    window.cancelAnimationFrame(dragBlockRaf)
    dragBlockRaf = 0
  }
  clearTabHoverSwitchTimer()
  draggedTab.value = ''
  draggedPane.value = null
  dropTargetTab.value = ''
  dropTargetTabbarEmpty.value = false
  splitDropZone.value = null
  targetPaneToken.value = ''
  previewInsets.value = null
  dragPointerBlock.value = false
}

onBeforeUnmount(() => {
  endTabDrag()
})

function resolveDragPayload(event: DragEvent): DragPayload | null {
  if (draggedPane.value) {
    return {
      kind: 'pane',
      tabToken: draggedPane.value.tabToken,
      paneToken: draggedPane.value.paneToken
    }
  }
  if (draggedTab.value) {
    return { kind: 'tab', tabToken: draggedTab.value }
  }
  const raw = event.dataTransfer?.getData('text/plain') ?? ''
  if (raw.startsWith('pane:')) {
    const [sourceTabToken, ...rest] = raw.slice(5).split(':')
    const sourcePaneToken = rest.join(':')
    const tab = tabs.value.find((item) => item.token === sourceTabToken)
    const pane = tab?.panes.find((item) => item.token === sourcePaneToken)
    if (tab && pane) {
      return { kind: 'pane', tabToken: tab.token, paneToken: pane.token }
    }
  }
  if (tabs.value.some((item) => item.token === raw)) {
    return { kind: 'tab', tabToken: raw }
  }
  return null
}

function wouldPaneMoveChangeLayout(
  tab: Tab,
  sourcePaneToken: string,
  hoveredPaneToken: string,
  zone: SplitDropZone
): boolean {
  const direction: Tab['direction'] = zone === 'top' || zone === 'bottom' ? 'vertical' : 'horizontal'
  if (tab.panes.length <= 1) return false
  if (!hoveredPaneToken || hoveredPaneToken === sourcePaneToken) {
    return tab.direction !== direction
  }
  if (tab.direction !== direction) return true
  const sourceIndex = tab.panes.findIndex((item) => item.token === sourcePaneToken)
  if (sourceIndex < 0) return false
  const remaining = tab.panes.filter((item) => item.token !== sourcePaneToken)
  const anchorIdx = remaining.findIndex((item) => item.token === hoveredPaneToken)
  if (anchorIdx < 0) return false
  const insertAt = zone === 'left' || zone === 'top' ? anchorIdx : anchorIdx + 1
  return insertAt !== sourceIndex
}

function computePanePreviewInsets(tab: Tab, paneEl: HTMLElement, zone: SplitDropZone): PreviewInsets | null {
  const zoneAxis: Tab['direction'] = zone === 'top' || zone === 'bottom' ? 'vertical' : 'horizontal'
  if (tab.panes.length <= 1 || tab.direction !== zoneAxis) return null
  const container = getPaneContainer(tab.token)
  if (!container) return null
  const wsRect = container.getBoundingClientRect()
  const paneRect = paneEl.getBoundingClientRect()
  if (wsRect.width <= 0 || wsRect.height <= 0 || paneRect.width <= 0 || paneRect.height <= 0) {
    return null
  }
  const paneLeft = Math.max(0, paneRect.left - wsRect.left)
  const paneTop = Math.max(0, paneRect.top - wsRect.top)
  const paneRight = Math.max(0, wsRect.right - paneRect.right)
  const paneBottom = Math.max(0, wsRect.bottom - paneRect.bottom)
  const halfW = paneRect.width / 2
  const halfH = paneRect.height / 2
  const pad = 10
  if (zone === 'left') {
    return {
      top: Math.round(paneTop + pad),
      bottom: Math.round(paneBottom + pad),
      left: Math.round(paneLeft + pad),
      right: Math.round(paneRight + halfW + 5)
    }
  }
  if (zone === 'right') {
    return {
      top: Math.round(paneTop + pad),
      bottom: Math.round(paneBottom + pad),
      left: Math.round(paneLeft + halfW + 5),
      right: Math.round(paneRight + pad)
    }
  }
  if (zone === 'top') {
    return {
      left: Math.round(paneLeft + pad),
      right: Math.round(paneRight + pad),
      top: Math.round(paneTop + pad),
      bottom: Math.round(paneBottom + halfH + 5)
    }
  }
  return {
    left: Math.round(paneLeft + pad),
    right: Math.round(paneRight + pad),
    top: Math.round(paneTop + halfH + 5),
    bottom: Math.round(paneBottom + pad)
  }
}

function onTabDragStart(event: DragEvent, tab: Tab) {
  draggedTab.value = tab.token
  draggedPane.value = null
  dropTargetTab.value = ''
  dropTargetTabbarEmpty.value = false
  splitDropZone.value = null
  targetPaneToken.value = ''
  previewInsets.value = null
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', tab.token)
  }
  scheduleDragPointerBlock()
}

function onPaneHeaderDragStart(event: DragEvent, tab: Tab, pane: Pane) {
  draggedPane.value = { tabToken: tab.token, paneToken: pane.token, title: pane.title }
  draggedTab.value = ''
  dropTargetTab.value = ''
  dropTargetTabbarEmpty.value = false
  splitDropZone.value = null
  targetPaneToken.value = ''
  previewInsets.value = null
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', `pane:${tab.token}:${pane.token}`)
  }
  scheduleDragPointerBlock()
}

function onTabDragOver(event: DragEvent, targetToken: string) {
  const payload = resolveDragPayload(event)
  if (!payload) return
  if (payload.kind === 'tab' && !draggedTab.value) draggedTab.value = payload.tabToken
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  splitDropZone.value = null
  targetPaneToken.value = ''
  previewInsets.value = null
  dropTargetTabbarEmpty.value = false
  if (dropTargetTab.value !== targetToken) {
    clearTabHoverSwitchTimer()
    if (payload.kind === 'pane' && payload.tabToken !== targetToken) {
      tabHoverSwitchTimer = window.setTimeout(() => {
        if (draggedPane.value && dropTargetTab.value === targetToken) {
          activeTab.value = targetToken
        }
      }, 420)
    }
  }
  dropTargetTab.value = targetToken
}

function onTabListDragOver(event: DragEvent) {
  const payload = resolveDragPayload(event)
  if (!payload) return
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  clearTabHoverSwitchTimer()
  dropTargetTab.value = ''
  splitDropZone.value = null
  targetPaneToken.value = ''
  previewInsets.value = null
  dropTargetTabbarEmpty.value = true
}

function onTabListDrop(event: DragEvent) {
  const payload = resolveDragPayload(event)
  if (payload?.kind === 'pane') {
    detachPaneToTab(payload.tabToken, payload.paneToken)
  } else if (payload?.kind === 'tab' && tabs.value.length > 1) {
    const lastTab = tabs.value[tabs.value.length - 1]
    if (lastTab) reorderTab(payload.tabToken, lastTab.token)
  }
  endTabDrag()
}

function onDropTab(event: DragEvent, targetToken: string) {
  const payload = resolveDragPayload(event)
  if (payload?.kind === 'tab') {
    reorderTab(payload.tabToken, targetToken)
  } else if (payload?.kind === 'pane') {
    if (payload.tabToken === targetToken) {
      detachPaneToTab(payload.tabToken, payload.paneToken)
    } else {
      movePaneToSplit(payload.tabToken, payload.paneToken, targetToken, 'right')
    }
  }
  endTabDrag()
}

function onPaneDragOver(event: DragEvent, tab: Tab, pane: Pane) {
  const payload = resolveDragPayload(event)
  if (!payload) return
  if (payload.kind === 'tab' && !draggedTab.value) draggedTab.value = payload.tabToken
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  clearTabHoverSwitchTimer()
  dropTargetTab.value = ''
  dropTargetTabbarEmpty.value = false
  const paneEl = event.currentTarget as HTMLElement | null
  if (!paneEl) return
  const rect = paneEl.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  const zone = resolveSplitDropZone(
    (event.clientX - rect.left) / rect.width,
    (event.clientY - rect.top) / rect.height
  )
  targetPaneToken.value = pane.token
  if (
    payload.kind === 'pane' &&
    payload.tabToken === tab.token &&
    !wouldPaneMoveChangeLayout(tab, payload.paneToken, pane.token, zone)
  ) {
    splitDropZone.value = null
    previewInsets.value = null
    return
  }
  if (payload.kind === 'pane' && payload.tabToken === tab.token && tab.panes.length <= 1) {
    splitDropZone.value = null
    previewInsets.value = null
    return
  }
  splitDropZone.value = zone
  previewInsets.value = computePanePreviewInsets(tab, paneEl, zone)
}

function onPaneDrop(event: DragEvent, tab: Tab, pane: Pane) {
  const payload = resolveDragPayload(event)
  const paneEl = event.currentTarget as HTMLElement | null
  let zone = splitDropZone.value
  if (!zone && paneEl) {
    const rect = paneEl.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      zone = resolveSplitDropZone(
        (event.clientX - rect.left) / rect.width,
        (event.clientY - rect.top) / rect.height
      )
    }
  }
  if (payload && zone) {
    if (payload.kind === 'tab') {
      dockTabToSplit(payload.tabToken, tab.token, zone, pane.token)
    } else if (
      payload.tabToken !== tab.token ||
      wouldPaneMoveChangeLayout(tab, payload.paneToken, pane.token, zone)
    ) {
      movePaneToSplit(payload.tabToken, payload.paneToken, tab.token, zone, pane.token)
    }
  }
  endTabDrag()
}

function onWorkspaceDragOver(event: DragEvent, tab: Tab) {
  const payload = resolveDragPayload(event)
  if (!payload) return
  if (payload.kind === 'tab' && !draggedTab.value) draggedTab.value = payload.tabToken
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  clearTabHoverSwitchTimer()
  dropTargetTab.value = ''
  dropTargetTabbarEmpty.value = false
  targetPaneToken.value = ''
  previewInsets.value = null
  const container = event.currentTarget as HTMLElement | null
  if (!container) return
  const rect = container.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  const zone = resolveSplitDropZone(
    (event.clientX - rect.left) / rect.width,
    (event.clientY - rect.top) / rect.height
  )
  if (
    payload.kind === 'pane' &&
    payload.tabToken === tab.token &&
    !wouldPaneMoveChangeLayout(tab, payload.paneToken, '', zone)
  ) {
    splitDropZone.value = null
    return
  }
  splitDropZone.value = zone
}

function onWorkspaceDragLeave(event: DragEvent) {
  const container = event.currentTarget as HTMLElement | null
  const related = event.relatedTarget as Node | null
  if (container && related && container.contains(related)) return
  if (container) {
    const rect = container.getBoundingClientRect()
    if (
      event.clientX > rect.left &&
      event.clientX < rect.right &&
      event.clientY > rect.top &&
      event.clientY < rect.bottom
    ) {
      return
    }
  }
  splitDropZone.value = null
  targetPaneToken.value = ''
  previewInsets.value = null
}

function onWorkspaceDrop(event: DragEvent, targetTabToken: string) {
  const payload = resolveDragPayload(event)
  const targetTab = tabs.value.find((item) => item.token === targetTabToken)
  const container = event.currentTarget as HTMLElement | null
  let zone = splitDropZone.value
  if (!zone && container) {
    const rect = container.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      zone = resolveSplitDropZone(
        (event.clientX - rect.left) / rect.width,
        (event.clientY - rect.top) / rect.height
      )
    }
  }
  if (payload && zone && targetTab) {
    const anchorPane = targetPaneToken.value || undefined
    if (payload.kind === 'tab') {
      dockTabToSplit(payload.tabToken, targetTabToken, zone, anchorPane)
    } else if (
      payload.tabToken !== targetTabToken ||
      wouldPaneMoveChangeLayout(targetTab, payload.paneToken, targetPaneToken.value, zone)
    ) {
      movePaneToSplit(payload.tabToken, payload.paneToken, targetTabToken, zone, anchorPane)
    }
  }
  endTabDrag()
}

function getRatioBounds(tab: Tab): [number, number] {
  const container = getPaneContainer(tab.token)
  if (!container) return [20, 80]
  const vertical = tab.direction === 'vertical'
  const size = vertical ? container.clientHeight : container.clientWidth
  if (size <= 0) return [20, 80]
  const minPercent = ((vertical ? 180 : 320) / size) * 100
  if (minPercent >= 50) return [50, 50]
  return [Math.ceil(minPercent), Math.floor(100 - minPercent)]
}

function adjustRatio(tab: Tab, delta: number) {
  const [min, max] = getRatioBounds(tab)
  tab.ratio = Math.min(max, Math.max(min, Math.round(tab.ratio + delta)))
}

function resizePanes(event: PointerEvent, tab: Tab) {
  const el = event.currentTarget as HTMLElement
  const parent = el.parentElement
  if (!parent) return
  const vertical = tab.direction === 'vertical'
  el.setPointerCapture(event.pointerId)
  const update = (move: PointerEvent) => {
    const rect = parent.getBoundingClientRect()
    const size = vertical ? rect.height : rect.width
    if (size <= 0) return
    const min = ((vertical ? 180 : 320) / size) * 100
    if (min >= 50) return
    tab.ratio = Math.min(
      100 - min,
      Math.max(min, ((vertical ? move.clientY - rect.top : move.clientX - rect.left) / size) * 100)
    )
  }
  const finish = () => {
    el.removeEventListener('pointermove', update)
    el.removeEventListener('pointerup', finish)
    el.removeEventListener('lostpointercapture', finish)
  }
  el.addEventListener('pointermove', update)
  el.addEventListener('pointerup', finish)
  el.addEventListener('lostpointercapture', finish)
}
</script>

<template>
  <section v-show="page === 'workspace'" class="container_workspace_page_body_base">
    <header class="container_workspace_tabs_header_base">
      <div
        class="container_workspace_tabs_header_list"
        role="tablist"
        aria-label="终端会话"
        :data-detach-ready="dropTargetTabbarEmpty && Boolean(draggedPane) && canDetachDraggedPane"
        @dragover.prevent="onTabListDragOver($event)"
        @dragleave="dropTargetTabbarEmpty = false"
        @drop.prevent="onTabListDrop($event)"
      >
        <div
          v-for="tab in tabs"
          :key="tab.token"
          :class="c('container_workspace_tabs_header_item', tab.token)"
          :data-active="activeTab === tab.token"
          :data-dragging="draggedTab === tab.token"
          :data-drop-target="
            dropTargetTab === tab.token &&
            draggedTab !== tab.token &&
            !(draggedPane?.tabToken === tab.token && !canDetachDraggedPane)
          "
          draggable="true"
          title="拖动标签可排序；拖入下方终端工作区可触发四向磁吸分屏"
          @dragstart="onTabDragStart($event, tab)"
          @dragover.prevent.stop="onTabDragOver($event, tab.token)"
          @dragleave="dropTargetTab === tab.token && (dropTargetTab = '')"
          @drop.prevent.stop="onDropTab($event, tab.token)"
          @dragend="endTabDrag"
        >
          <button
            :class="c('container_workspace_tabs_header_select', tab.token)"
            type="button"
            role="tab"
            :aria-selected="activeTab === tab.token"
            @click="activeTab = tab.token"
          >
            <span
              :class="c('container_workspace_tabs_header_dot', tab.token)"
              :data-state="tab.panes[0]?.state ?? 'connecting'"
            />
            <Terminal :size="14" />
            <span :class="c('container_workspace_tabs_header_label', tab.token)">{{ tab.title }}</span>
            <span
              v-if="tab.panes.length > 1"
              :class="c('container_workspace_tabs_header_split-badge', tab.token)"
            >
              {{ tab.panes.length }}分屏
            </span>
          </button>
          <button
            :class="c('container_workspace_tabs_header_close', tab.token)"
            type="button"
            :aria-label="`关闭标签 ${tab.title}`"
            @click="closeTab(tab.token)"
          >
            <X :size="12" />
          </button>
        </div>
        <span v-if="!tabs.length" class="container_workspace_tabs_header_empty">工作台</span>
        <span
          v-if="draggedPane && canDetachDraggedPane"
          class="container_workspace_tabs_header_detach-pill"
          :data-active="dropTargetTabbarEmpty"
        >
          + 释放拆分为独立标签
        </span>
      </div>
      <div v-if="bootstrap?.shells.length" class="container_workspace_tabs_header_shell-select">
        <OrbitSelect
          :model-value="selectedShellId || bootstrap.shells[0]?.id"
          :options="shellOptions"
          aria-label="选择新建本地终端类型"
          title="选择新建本地终端类型"
          size="sm"
          width="146px"
          instance="workspace-shell"
          @update:model-value="selectedShellId = $event"
        />
      </div>
      <button
        class="container_workspace_tabs_header_add"
        type="button"
        aria-label="新建本地会话"
        title="新建本地会话 · Ctrl+Shift+T"
        :disabled="!defaultShellProfile"
        @click="defaultShellProfile && openLocal(defaultShellProfile)"
      >
        <Plus :size="16" />
      </button>
      <div class="container_workspace_tabs_header_theme-select">
        <OrbitSelect
          :model-value="terminalTheme"
          :options="terminalThemeOptions"
          aria-label="切换终端配色主题"
          title="快速切换所有终端的配色主题"
          size="sm"
          width="156px"
          instance="workspace-theme"
          @update:model-value="terminalTheme = $event as TerminalThemeId"
        />
      </div>
      <button
        class="container_workspace_tabs_header_split-horizontal"
        type="button"
        aria-label="左右分屏"
        title="左右分屏"
        :disabled="!currentTab"
        @click="splitActivePane('horizontal')"
      >
        <Columns2 :size="16" />
      </button>
      <button
        class="container_workspace_tabs_header_split-vertical"
        type="button"
        aria-label="上下分屏"
        title="上下分屏"
        :disabled="!currentTab"
        @click="splitActivePane('vertical')"
      >
        <Rows2 :size="16" />
      </button>
    </header>
    <div v-if="!tabs.length && bootstrap" class="container_workspace_welcome_body_base">
      <div class="container_workspace_orbit_body_grid" aria-hidden="true" />
      <div class="container_workspace_welcome_header_kicker">
        <span class="container_workspace_welcome_header_dot" />
        YOUR CONNECTIONS. YOUR SPACE.
      </div>
      <OrbitStage3D
        :active="!tabs.length && page === 'workspace'"
        :boost="ctaHovered"
        :instance="windowInstance('welcome')"
      />
      <h2 class="container_workspace_welcome_body_title">让连接，井然有序。</h2>
      <p class="container_workspace_welcome_body_description">
        远程主机与本地终端，一个专注的工作空间。
        <br class="container_workspace_welcome_body_line-break" />
        从一条真实连接开始。
      </p>
      <div
        class="container_workspace_welcome_body_actions"
        @mouseenter="ctaHovered = true"
        @mouseleave="ctaHovered = false"
      >
        <button
          class="container_workspace_welcome_body_create"
          type="button"
          data-primary
          @click="openEditor()"
        >
          <Plus :size="16" />
          新建 SSH 主机
        </button>
        <button
          class="container_workspace_welcome_body_local"
          type="button"
          :disabled="!defaultShellProfile"
          @click="defaultShellProfile && openLocal(defaultShellProfile)"
        >
          <SquareTerminal :size="16" />
          打开本地终端
        </button>
      </div>
      <div class="container_workspace_welcome_footer_base">
        <span class="container_workspace_welcome_footer_hint">
          <ShieldCheck :size="13" />
          离线可用
        </span>
        <span class="container_workspace_welcome_footer_separator">·</span>
        <span class="container_workspace_welcome_footer_keyboard">Ctrl + Shift + T 新建终端</span>
      </div>
      <div class="container_workspace_welcome_footer_phase">
        <span class="container_workspace_welcome_footer_phase-label">BUILDING IN THE OPEN</span>
        <span class="container_workspace_welcome_footer_phase-copy">
          M0 / M1 基础开发阶段 · SFTP、监控与云同步尚未开放
        </span>
      </div>
    </div>
    <div
      v-for="tab in tabs"
      v-show="activeTab === tab.token"
      :key="tab.token"
      :ref="(el) => registerPaneContainer(tab.token, el as HTMLElement | null)"
      :class="c('container_workspace_panes_body_base', tab.token)"
      :data-direction="tab.direction"
      :data-tab-dragging="isDraggingAny"
      :data-drag-pointer-block="dragPointerBlock"
      @dragover.prevent="onWorkspaceDragOver($event, tab)"
      @dragleave="onWorkspaceDragLeave($event)"
      @drop.prevent="onWorkspaceDrop($event, tab.token)"
    >
      <template v-for="(pane, index) in tab.panes" :key="pane.token">
        <div
          :class="c('container_workspace_panes_body_pane', pane.token)"
          :data-focused="tab.focusedPaneToken === pane.token && tab.panes.length > 1"
          :data-split-enter="splitEnteredPaneToken === pane.token"
          :data-drop-target-pane="targetPaneToken === pane.token && Boolean(splitDropZone)"
          :data-pane-count="tab.panes.length"
          :style="
            tab.panes.length === 2
              ? { flex: index === 0 ? `0 0 calc(${tab.ratio}% - 3px)` : '1' }
              : { flex: '1' }
          "
          @focusin="tab.focusedPaneToken = pane.token"
          @dragover.prevent.stop="onPaneDragOver($event, tab, pane)"
          @drop.prevent.stop="onPaneDrop($event, tab, pane)"
        >
          <TerminalPane
            :token="windowInstance(pane.token)"
            :title="pane.title"
            :kind="pane.kind"
            :profile-id="pane.profileId"
            :host-id="pane.hostId"
            :password="pane.password"
            :retry-seq="pane.retrySeq ?? 0"
            :auth-cancelled-seq="pane.authCancelledSeq ?? 0"
            :visible="activeTab === tab.token && page === 'workspace'"
            :can-unsplit="tab.panes.length > 1"
            :is-dragging="draggedPane?.paneToken === pane.token"
            :font-size="fontSize"
            :screen-reader-default="screenReaderDefault"
            @consumed="pane.password = undefined"
            @state="pane.state = $event"
            @auth-failed="requestPanePassword(tab.token, pane.token, $event)"
            @unsplit="detachPaneToTab(tab.token, pane.token)"
            @close-pane="closePane(tab.token, pane.token)"
            @header-drag-start="onPaneHeaderDragStart($event, tab, pane)"
            @header-drag-end="endTabDrag"
          />
        </div>
        <div
          v-if="index === 0 && tab.panes.length === 2"
          :class="c('container_workspace_panes_body_resize', tab.token)"
          role="separator"
          tabindex="0"
          :aria-orientation="tab.direction === 'vertical' ? 'horizontal' : 'vertical'"
          :aria-valuenow="Math.round(tab.ratio)"
          :aria-valuemin="getRatioBounds(tab)[0]"
          :aria-valuemax="getRatioBounds(tab)[1]"
          aria-label="调整分屏比例"
          @pointerdown="resizePanes($event, tab)"
          @keydown.left.prevent="tab.direction === 'horizontal' && adjustRatio(tab, -5)"
          @keydown.right.prevent="tab.direction === 'horizontal' && adjustRatio(tab, 5)"
          @keydown.up.prevent="tab.direction === 'vertical' && adjustRatio(tab, -5)"
          @keydown.down.prevent="tab.direction === 'vertical' && adjustRatio(tab, 5)"
        />
      </template>
      <div
        v-if="isDraggingAny && activeTab === tab.token"
        :class="c('container_workspace_split_overlay_base', tab.token)"
        :data-zone="splitDropZone ?? 'idle'"
        aria-hidden="true"
      >
        <div
          :class="c('container_workspace_split_overlay_preview', tab.token)"
          :data-zone="splitDropZone ?? 'idle'"
          :style="splitPreviewStyle()"
        >
          <div :class="c('container_workspace_split_overlay_badge', tab.token)">
            <span :class="c('container_workspace_split_overlay_label', tab.token)">
              {{ splitOverlayText(tab.token) }}
            </span>
            <span :class="c('container_workspace_split_overlay_hint', tab.token)">
              {{ splitOverlayHintText() }}
            </span>
          </div>
        </div>
        <div :class="c('container_workspace_split_overlay_compass', tab.token)">
          <div
            :class="c('container_workspace_split_compass_top', tab.token)"
            :data-active="splitDropZone === 'top'"
          >
            <ArrowUp :size="14" />
            上分屏
          </div>
          <div
            :class="c('container_workspace_split_compass_left', tab.token)"
            :data-active="splitDropZone === 'left'"
          >
            <ArrowLeft :size="14" />
            左分屏
          </div>
          <div
            :class="c('container_workspace_split_compass_right', tab.token)"
            :data-active="splitDropZone === 'right'"
          >
            右分屏
            <ArrowRight :size="14" />
          </div>
          <div
            :class="c('container_workspace_split_compass_bottom', tab.token)"
            :data-active="splitDropZone === 'bottom'"
          >
            <ArrowDown :size="14" />
            下分屏
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
.container_workspace_page_body_base {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.container_workspace_tabs_header_base {
  display: flex;
  height: 37px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-tab);
  align-items: center;
  padding-right: 7px;
  > button {
    width: 30px;
    padding: 5px;
    min-height: 26px;
    margin-left: 2px;
  }
}
.container_workspace_tabs_header_shell-select,
.container_workspace_tabs_header_theme-select {
  margin-left: 4px;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}
.container_workspace_tabs_header_dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--color-warning);
  &[data-state='running'] {
    background: var(--color-success);
    box-shadow: 0 0 6px rgba(89, 214, 160, 0.55);
  }
  &[data-state='error'] {
    background: var(--color-error);
  }
  &[data-state='exited'] {
    background: var(--color-text-muted);
  }
}
.container_workspace_tabs_header_list {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  height: 100%;
  overflow-x: auto;
  &[data-detach-ready='true'] {
    background: rgba(91, 220, 244, 0.08);
    box-shadow: inset 0 0 0 1px rgba(91, 220, 244, 0.4);
  }
}
.container_workspace_tabs_header_empty {
  display: flex;
  align-items: center;
  padding-left: 18px;
  font-size: 12px;
  color: var(--color-text-muted);
}
.container_workspace_tabs_header_detach-pill {
  display: inline-flex;
  align-items: center;
  margin-left: 8px;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px dashed rgba(91, 220, 244, 0.45);
  font-size: 11px;
  color: var(--color-text-secondary);
  background: rgba(91, 220, 244, 0.08);
  white-space: nowrap;
  flex-shrink: 0;
  pointer-events: none;
  transition:
    border-color 140ms ease,
    background 140ms ease,
    color 140ms ease,
    transform 140ms ease;
  &[data-active='true'] {
    color: #e8faff;
    border-color: rgba(91, 220, 244, 0.92);
    background: linear-gradient(135deg, rgba(91, 220, 244, 0.24), rgba(167, 139, 250, 0.24));
    transform: scale(1.03);
  }
}
.container_workspace_tabs_header_item {
  position: relative;
  display: flex;
  align-items: center;
  height: 100%;
  padding: 0 7px 0 4px;
  max-width: 260px;
  flex-shrink: 0;
  border-right: 1px solid var(--color-border);
  cursor: grab;
  transition:
    transform 180ms cubic-bezier(0.22, 1, 0.36, 1),
    background 180ms ease,
    box-shadow 180ms ease,
    opacity 180ms ease;
  &::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    height: 2px;
    background: var(--color-accent-primary);
    pointer-events: none;
    z-index: 3;
    opacity: 0;
  }
  &:hover:not([data-active='true']) {
    background: rgba(255, 255, 255, 0.04);
  }
  &[data-active='true'] {
    background: linear-gradient(180deg, var(--color-surface-2), var(--color-terminal-bg));
    box-shadow: inset 0 -1px 0 var(--color-terminal-bg);
    &::after {
      opacity: 1;
    }
    .container_workspace_tabs_header_select {
      color: var(--color-text-primary);
    }
  }
  &[data-dragging='true'] {
    opacity: 0.56;
    cursor: grabbing;
    transform: translateY(-1px) scale(0.96);
    box-shadow:
      inset 0 0 0 1px rgba(167, 139, 250, 0.7),
      0 8px 20px rgba(0, 0, 0, 0.45);
  }
  &[data-drop-target='true'] {
    background: rgba(91, 220, 244, 0.08);
    box-shadow:
      inset 3px 0 0 var(--color-accent-secondary),
      inset 0 0 18px rgba(91, 220, 244, 0.14);
    transform: translateX(2px);
  }
}
.container_workspace_tabs_header_split-badge {
  margin-left: 5px;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10px;
  line-height: 1.4;
  font-family: var(--font-mono);
  color: #7af2ff;
  background: rgba(91, 220, 244, 0.14);
  border: 1px solid rgba(91, 220, 244, 0.34);
  white-space: nowrap;
  flex-shrink: 0;
}
.container_workspace_tabs_header_select {
  height: 100%;
  border-radius: 0;
  border: none;
  background: transparent;
  font-size: 12px;
  min-width: 100px;
  justify-content: flex-start;
  &:hover:not(:disabled),
  &:active:not(:disabled) {
    background: transparent;
    color: var(--color-text-primary);
  }
  &:focus-visible {
    outline-offset: -3px;
  }
}
.container_workspace_tabs_header_label {
  max-width: 150px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.container_workspace_tabs_header_close {
  padding: 2px;
  min-height: 20px;
}
.container_workspace_welcome_body_base {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
  background: radial-gradient(ellipse at 50% 38%, rgba(167, 139, 250, 0.08), transparent 62%);
}
.container_workspace_orbit_body_grid {
  position: absolute;
  left: 50%;
  top: 46%;
  width: 680px;
  height: 360px;
  transform: translate(-50%, -18%) perspective(540px) rotateX(68deg);
  background-image:
    linear-gradient(to right, rgba(167, 139, 250, 0.09) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(91, 220, 244, 0.07) 1px, transparent 1px);
  background-size: 36px 36px;
  mask-image: radial-gradient(ellipse 68% 64% at 50% 50%, #000 18%, transparent 78%);
  pointer-events: none;
}
.container_workspace_welcome_header_kicker {
  font-size: 12px;
  letter-spacing: 2px;
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 20px;
  position: relative;
}
.container_workspace_welcome_header_dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--color-accent-secondary);
  box-shadow: 0 0 9px #5bdcf455;
}
.container_workspace_welcome_body_title {
  font-size: 30px;
  font-weight: 500;
  letter-spacing: 2px;
  margin: 9px 0 16px;
}
.container_workspace_welcome_body_description {
  font-size: 13px;
  color: var(--color-text-secondary);
  text-align: center;
  line-height: 2;
  margin: 0;
}
.container_workspace_welcome_body_actions {
  display: flex;
  gap: 12px;
  margin-top: 28px;
  button {
    font-size: 13px;
    min-height: 36px;
    padding: 9px 16px;
    border: 1px solid var(--color-border-control);
  }
}
.container_workspace_welcome_footer_base {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--color-text-muted);
  font-size: 12px;
  margin-top: 25px;
}
.container_workspace_welcome_footer_hint {
  display: flex;
  align-items: center;
  gap: 5px;
}
.container_workspace_welcome_footer_phase {
  margin: 56px 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
}
.container_workspace_welcome_footer_phase-label {
  font-size: 12px;
  letter-spacing: 1.6px;
  color: var(--color-text-muted);
}
.container_workspace_welcome_footer_phase-copy {
  font-size: 12px;
  color: var(--color-text-muted);
  text-align: center;
}
.container_workspace_panes_body_base {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  &[data-direction='vertical'] {
    flex-direction: column;
  }
  &[data-drag-pointer-block='true'] {
    :deep(.container_workspace_terminal_root_base > :not(.container_workspace_terminal_header_base)) {
      pointer-events: none;
    }
  }
}
.container_workspace_panes_body_pane {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  outline: 1px solid transparent;
  transition: outline-color 160ms ease;
  &[data-focused='true'],
  &:focus-within {
    outline-color: var(--color-accent-primary-ring);
    outline-offset: -1px;
  }
  &[data-pane-count='3']:not(:first-child),
  &[data-pane-count='4']:not(:first-child) {
    border-left: 1px solid var(--color-border);
  }
  &[data-split-enter='true'] {
    animation: orbit-split-enter 420ms cubic-bezier(0.22, 1, 0.36, 1) both;
  }
}
.container_workspace_panes_body_base[data-direction='vertical'] > .container_workspace_panes_body_pane {
  &[data-pane-count='3']:not(:first-child),
  &[data-pane-count='4']:not(:first-child) {
    border-left: none;
    border-top: 1px solid var(--color-border);
  }
}
.container_workspace_split_overlay_base {
  position: absolute;
  inset: 0;
  z-index: var(--z-floating);
  pointer-events: none;
  background: radial-gradient(circle at 50% 50%, rgba(167, 139, 250, 0.08), rgba(10, 12, 18, 0.44));
  backdrop-filter: blur(2px);
  animation: orbit-split-overlay-in 180ms ease-out both;
}
.container_workspace_split_overlay_preview {
  position: absolute;
  inset: 12px;
  border-radius: 14px;
  border: 2px dashed rgba(91, 220, 244, 0.8);
  background: linear-gradient(135deg, rgba(91, 220, 244, 0.16), rgba(167, 139, 250, 0.18));
  box-shadow:
    0 0 36px rgba(91, 220, 244, 0.22),
    inset 0 0 28px rgba(167, 139, 250, 0.18);
  display: grid;
  place-items: center;
  opacity: 0;
  transition:
    top 220ms cubic-bezier(0.22, 1, 0.36, 1),
    right 220ms cubic-bezier(0.22, 1, 0.36, 1),
    bottom 220ms cubic-bezier(0.22, 1, 0.36, 1),
    left 220ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 160ms ease;
  &[data-zone='left'] {
    opacity: 1;
    top: 12px;
    bottom: 12px;
    left: 12px;
    right: calc(50% + 6px);
  }
  &[data-zone='right'] {
    opacity: 1;
    top: 12px;
    bottom: 12px;
    left: calc(50% + 6px);
    right: 12px;
  }
  &[data-zone='top'] {
    opacity: 1;
    top: 12px;
    left: 12px;
    right: 12px;
    bottom: calc(50% + 6px);
  }
  &[data-zone='bottom'] {
    opacity: 1;
    left: 12px;
    right: 12px;
    bottom: 12px;
    top: calc(50% + 6px);
  }
}
.container_workspace_split_overlay_badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 18px;
  border-radius: 12px;
  background: rgba(16, 20, 30, 0.92);
  border: 1px solid rgba(91, 220, 244, 0.45);
  box-shadow: var(--shadow-3d-dialog);
}
.container_workspace_split_overlay_label {
  font-size: 13px;
  font-weight: 600;
  color: #e8faff;
  letter-spacing: 0.4px;
}
.container_workspace_split_overlay_hint {
  font-size: 11px;
  color: var(--color-text-secondary);
}
.container_workspace_split_overlay_compass {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 210px;
  height: 150px;
  transform: translate(-50%, -50%);
}
.container_workspace_split_compass_top,
.container_workspace_split_compass_left,
.container_workspace_split_compass_right,
.container_workspace_split_compass_bottom {
  position: absolute;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 11px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  color: var(--color-text-secondary);
  background: rgba(18, 22, 32, 0.88);
  border: 1px solid rgba(167, 139, 250, 0.28);
  box-shadow: var(--shadow-3d-card);
  white-space: nowrap;
  transition:
    transform 180ms cubic-bezier(0.22, 1, 0.36, 1),
    background 160ms ease,
    border-color 160ms ease,
    color 160ms ease,
    box-shadow 160ms ease;
  &[data-active='true'] {
    color: #ffffff;
    background: linear-gradient(135deg, rgba(91, 220, 244, 0.32), rgba(167, 139, 250, 0.34));
    border-color: rgba(91, 220, 244, 0.9);
    box-shadow: 0 0 22px rgba(91, 220, 244, 0.38);
  }
}
.container_workspace_split_compass_top {
  left: 50%;
  top: 0;
  transform: translateX(-50%);
  &[data-active='true'] {
    transform: translateX(-50%) scale(1.08);
  }
}
.container_workspace_split_compass_bottom {
  left: 50%;
  bottom: 0;
  transform: translateX(-50%);
  &[data-active='true'] {
    transform: translateX(-50%) scale(1.08);
  }
}
.container_workspace_split_compass_left {
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  &[data-active='true'] {
    transform: translateY(-50%) scale(1.08);
  }
}
.container_workspace_split_compass_right {
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  &[data-active='true'] {
    transform: translateY(-50%) scale(1.08);
  }
}
@keyframes orbit-split-overlay-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@keyframes orbit-split-enter {
  0% {
    opacity: 0.38;
    transform: scale(0.955) translateY(6px);
    box-shadow:
      inset 0 0 0 2px rgba(91, 220, 244, 0.72),
      0 0 28px rgba(167, 139, 250, 0.34);
  }
  60% {
    opacity: 1;
    transform: scale(1.006) translateY(0);
    box-shadow:
      inset 0 0 0 1px rgba(167, 139, 250, 0.5),
      0 0 18px rgba(91, 220, 244, 0.18);
  }
  100% {
    opacity: 1;
    transform: scale(1) translateY(0);
    box-shadow: none;
  }
}
.container_workspace_panes_body_resize {
  position: relative;
  flex: 0 0 6px;
  cursor: col-resize;
  background: transparent;
  touch-action: none;
  &::after {
    content: '';
    position: absolute;
    inset: 0 2.5px;
    background: var(--color-border);
    transition: background 120ms;
  }
  &:hover::after,
  &:focus-visible::after {
    background: var(--color-accent-primary);
  }
}
.container_workspace_panes_body_base[data-direction='vertical'] > .container_workspace_panes_body_resize {
  cursor: row-resize;
  &::after {
    inset: 2.5px 0;
  }
}
@media (max-height: 750px) {
  .container_workspace_welcome_footer_phase {
    margin-top: 28px;
  }
  .container_workspace_orbit_body_stage {
    margin-top: 12px;
    height: 150px;
  }
}
</style>
