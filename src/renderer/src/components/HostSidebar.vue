<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  Plus,
  Search,
  Star,
  Server,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  SquareTerminal,
  ShieldCheck,
  PanelLeftClose,
  PanelLeftOpen
} from 'lucide-vue-next'
import { instanceClass } from '../../../shared/classes'
import type { Host } from '../../../shared/contracts'
import OrbitSelect from './OrbitSelect.vue'
import { recentHostIds } from '../services/host-recency'
import {
  bootstrap,
  connectHost,
  favorites,
  filteredHosts,
  group,
  groups,
  hosts,
  openEditor,
  openLocal,
  page,
  query,
  selected,
  shellsExpanded,
  sidebarCollapsed,
  sidebarWidth,
  windowInstance
} from '../stores/workbench'

const groupFilterOptions = computed(() => [
  { value: 'all', label: '所有分组' },
  ...groups.value.map((item) => ({ value: item, label: item }))
])

const searchInput = ref<HTMLInputElement>()
const listRef = ref<HTMLElement>()
const scrollTop = ref(0)
const viewportHeight = ref(420)
watch(recentHostIds, () => {
  scrollTop.value = 0
  if (listRef.value) listRef.value.scrollTop = 0
})
let clickTimer: ReturnType<typeof setTimeout> | undefined

const VIRTUAL_THRESHOLD = 150
const ROW_HEIGHT = 50
const OVERSCAN = 6

const useVirtual = computed(() => filteredHosts.value.length > VIRTUAL_THRESHOLD)
const visibleRange = computed(() => {
  if (!useVirtual.value) return { start: 0, end: filteredHosts.value.length, topPad: 0, bottomPad: 0 }
  const start = Math.max(0, Math.floor(scrollTop.value / ROW_HEIGHT) - OVERSCAN)
  const visibleCount = Math.ceil(viewportHeight.value / ROW_HEIGHT) + OVERSCAN * 2
  const end = Math.min(filteredHosts.value.length, start + visibleCount)
  return {
    start,
    end,
    topPad: start * ROW_HEIGHT,
    bottomPad: Math.max(0, (filteredHosts.value.length - end) * ROW_HEIGHT)
  }
})
const renderedHosts = computed(() =>
  filteredHosts.value.slice(visibleRange.value.start, visibleRange.value.end)
)

const c = (base: string, token: string) => instanceClass(base, windowInstance(token))

function onListScroll() {
  if (!listRef.value) return
  scrollTop.value = listRef.value.scrollTop
  viewportHeight.value = listRef.value.clientHeight || 420
}

function handleHostRowClick(host: Host) {
  selected.value = host.id
  clearTimeout(clickTimer)
  if (page.value === 'hosts') return
  clickTimer = setTimeout(() => {
    page.value = 'hosts'
  }, 220)
}

function handleHostRowDoubleClick(host: Host) {
  clearTimeout(clickTimer)
  selected.value = host.id
  connectHost(host)
}

function resizeSidebar(event: PointerEvent) {
  const handle = event.currentTarget as HTMLElement
  const startX = event.clientX
  const startWidth = sidebarWidth.value
  handle.setPointerCapture(event.pointerId)
  const move = (ev: PointerEvent) => {
    sidebarWidth.value = Math.min(360, Math.max(200, Math.round(startWidth + ev.clientX - startX)))
  }
  const done = () => {
    try {
      localStorage.setItem('orbit:sidebar-width', String(sidebarWidth.value))
    } catch {
      /* optional */
    }
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', done)
    handle.removeEventListener('lostpointercapture', done)
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', done)
  handle.addEventListener('lostpointercapture', done)
}

function adjustSidebarWidth(delta: number) {
  sidebarWidth.value = Math.min(360, Math.max(200, sidebarWidth.value + delta))
  try {
    localStorage.setItem('orbit:sidebar-width', String(sidebarWidth.value))
  } catch {
    /* optional */
  }
}

function focusSearch() {
  if (sidebarCollapsed.value) sidebarCollapsed.value = false
  requestAnimationFrame(() => searchInput.value?.focus())
}

defineExpose({ focusSearch })

onBeforeUnmount(() => clearTimeout(clickTimer))
</script>

<template>
  <div v-if="sidebarCollapsed" class="container_hosts_collapsed_rail_base">
    <button
      class="container_hosts_collapsed_rail_expand"
      type="button"
      aria-label="展开连接侧栏"
      title="展开连接侧栏"
      @click="sidebarCollapsed = false"
    >
      <PanelLeftOpen :size="16" />
    </button>
  </div>
  <aside v-else class="container_hosts_sidebar_body_base" :style="{ width: `${sidebarWidth}px` }">
    <header class="container_hosts_sidebar_header_base">
      <h1 class="container_hosts_sidebar_header_title">连接</h1>
      <div class="container_hosts_sidebar_header_actions">
        <button
          class="container_hosts_sidebar_header_add"
          type="button"
          aria-label="新建主机"
          title="新建主机"
          :disabled="!bootstrap"
          @click="openEditor()"
        >
          <Plus :size="18" />
        </button>
        <button
          class="container_hosts_sidebar_header_collapse"
          type="button"
          aria-label="收起连接侧栏"
          title="收起连接侧栏"
          @click="sidebarCollapsed = true"
        >
          <PanelLeftClose :size="16" />
        </button>
      </div>
    </header>
    <label class="container_hosts_search_body_base">
      <Search :size="14" />
      <input
        ref="searchInput"
        v-model="query"
        class="container_hosts_search_body_input"
        aria-label="搜索主机"
        placeholder="搜索主机…"
      />
      <span class="container_hosts_search_body_shortcut">Ctrl+K</span>
    </label>
    <div class="container_hosts_filter_toolbar_base">
      <button
        class="container_hosts_filter_toolbar_all"
        type="button"
        :aria-pressed="!favorites"
        @click="favorites = false"
      >
        全部主机
        <span class="container_hosts_filter_toolbar_count">{{ hosts.length }}</span>
      </button>
      <button
        class="container_hosts_filter_toolbar_favorite"
        type="button"
        :aria-pressed="favorites"
        aria-label="仅显示收藏主机"
        @click="favorites = !favorites"
      >
        <Star :size="13" />
      </button>
    </div>
    <div v-if="groups.length" class="container_hosts_filter_toolbar_group">
      <OrbitSelect
        v-model="group"
        :options="groupFilterOptions"
        aria-label="按分组筛选"
        size="md"
        block
        instance="sidebar-group"
      />
    </div>
    <div ref="listRef" class="container_hosts_list_body_base" @scroll.passive="onListScroll">
      <div
        v-if="visibleRange.topPad"
        class="container_hosts_list_body_top-spacer"
        :style="{ height: `${visibleRange.topPad}px` }"
      />
      <div
        v-for="host in renderedHosts"
        :key="host.id"
        :class="c('container_hosts_list_row_base', host.id)"
        :data-selected="selected === host.id"
      >
        <button
          :class="c('container_hosts_list_row_select', host.id)"
          type="button"
          :aria-label="`选择主机 ${host.name}`"
          @click="handleHostRowClick(host)"
          @dblclick="handleHostRowDoubleClick(host)"
          @keydown.enter.prevent="connectHost(host)"
        >
          <span :class="c('container_hosts_list_row_icon', host.id)"><Server :size="15" /></span>
          <span :class="c('container_hosts_list_row_copy', host.id)">
            <strong :class="c('container_hosts_list_row_name', host.id)">{{ host.name }}</strong>
            <span :class="c('container_hosts_list_row_address', host.id)">
              {{ host.username }}@{{ host.address }}
            </span>
          </span>
          <span v-if="host.favorite" :class="c('container_hosts_list_row_star', host.id)" aria-hidden="true">
            <Star :size="12" />
          </span>
        </button>
        <button
          :class="c('container_hosts_list_row_connect', host.id)"
          type="button"
          :aria-label="`连接 ${host.name}`"
          title="新建 SSH 会话"
          @click="connectHost(host)"
        >
          <ArrowUpRight :size="15" />
        </button>
      </div>
      <div
        v-if="visibleRange.bottomPad"
        class="container_hosts_list_body_bottom-spacer"
        :style="{ height: `${visibleRange.bottomPad}px` }"
      />
      <p v-if="!filteredHosts.length" class="container_hosts_list_body_empty">
        {{ query || favorites || group !== 'all' ? '没有符合条件的主机' : '还没有主机，从新建连接开始。' }}
      </p>
    </div>
    <section class="container_local_shells_sidebar_base">
      <button
        class="container_local_shells_header_toggle"
        type="button"
        :aria-expanded="shellsExpanded"
        @click="shellsExpanded = !shellsExpanded"
      >
        <ChevronDown v-if="shellsExpanded" :size="13" />
        <ChevronRight v-else :size="13" />
        <span class="container_local_shells_header_title">本地终端</span>
        <span class="container_local_shells_header_count">{{ bootstrap?.shells.length ?? 0 }}</span>
      </button>
      <div v-show="shellsExpanded" class="container_local_shells_body_list">
        <button
          v-for="profile in bootstrap?.shells"
          :key="profile.id"
          :class="c('container_local_shells_row_open', profile.id)"
          type="button"
          @click="openLocal(profile)"
        >
          <SquareTerminal :size="15" />
          <span :class="c('container_local_shells_row_name', profile.id)">{{ profile.name }}</span>
          <Plus :size="13" />
        </button>
        <p v-if="bootstrap && !bootstrap.shells.length" class="container_local_shells_body_empty">
          未发现可用 Shell
        </p>
      </div>
    </section>
    <footer class="container_hosts_sidebar_footer_base">
      <ShieldCheck :size="13" />
      <span class="container_hosts_sidebar_footer_text">本地优先 · 配置保存在此设备</span>
    </footer>
    <div
      class="container_hosts_sidebar_resize_handle"
      role="slider"
      tabindex="0"
      aria-label="调整连接侧栏宽度"
      :aria-valuenow="sidebarWidth"
      aria-valuemin="200"
      aria-valuemax="360"
      @pointerdown="resizeSidebar"
      @keydown.left.prevent="adjustSidebarWidth(-16)"
      @keydown.right.prevent="adjustSidebarWidth(16)"
    />
  </aside>
</template>

<style scoped lang="scss">
.container_hosts_collapsed_rail_base {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 34px;
  flex-shrink: 0;
  padding-top: 12px;
  background: var(--color-surface-1);
  border-right: 1px solid var(--color-border);
}
.container_hosts_collapsed_rail_expand {
  padding: 4px;
  min-height: 28px;
}
.container_hosts_sidebar_body_base {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 240px;
  flex-shrink: 0;
  background: var(--color-surface-1);
  border-right: 1px solid var(--color-border);
}
.container_hosts_sidebar_resize_handle {
  position: absolute;
  top: 0;
  right: -3px;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  touch-action: none;
  z-index: var(--z-sticky);
  &:hover,
  &:focus-visible {
    background: var(--color-accent-primary-ring);
  }
}
.container_hosts_sidebar_header_base {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 14px 12px 17px;
}
.container_hosts_sidebar_header_title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.container_hosts_sidebar_header_actions {
  display: flex;
  align-items: center;
  gap: 2px;
}
.container_hosts_sidebar_header_add,
.container_hosts_sidebar_header_collapse {
  padding: 4px;
  min-height: 26px;
}
.container_hosts_search_body_base {
  display: flex;
  gap: 7px;
  align-items: center;
  margin: 0 14px 14px;
  padding: 0 9px;
  color: var(--color-text-muted);
  border: 1px solid var(--color-border-control);
  border-radius: 6px;
  background: var(--color-surface-input);
  transition:
    border-color 140ms ease,
    box-shadow 140ms ease;
  &:focus-within {
    border-color: var(--color-accent-primary);
    box-shadow: 0 0 0 2px var(--color-accent-primary-ring);
  }
}
.container_hosts_search_body_input {
  width: 100%;
  border: 0;
  padding: 7px 0;
  background: transparent;
  font-size: 12px;
  outline: 0 none;
  &:focus,
  &:focus-visible {
    outline: 0 none;
    box-shadow: none;
  }
}
.container_hosts_search_body_shortcut {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--color-text-muted);
}
.container_hosts_filter_toolbar_base {
  display: flex;
  align-items: center;
  padding: 0 13px 8px;
}
.container_hosts_filter_toolbar_all {
  margin-right: auto;
  font-size: 12px;
  padding: 4px 6px;
  &[aria-pressed='true'] {
    color: var(--color-text-primary);
  }
}
.container_hosts_filter_toolbar_count {
  margin-left: 4px;
  color: var(--color-text-muted);
  font-size: 12px;
}
.container_hosts_filter_toolbar_favorite {
  padding: 4px;
  min-height: 26px;
  &[aria-pressed='true'] {
    color: var(--color-warning);
  }
}
.container_hosts_filter_toolbar_group {
  margin: 0 14px 8px;
}
.container_hosts_list_body_base {
  flex: 1;
  min-height: 90px;
  overflow: auto;
  padding: 0 7px;
}
.container_hosts_list_row_base {
  display: flex;
  align-items: center;
  border-radius: 6px;
  margin-bottom: 3px;
  border: 1px solid transparent;
  &:hover {
    background: #ffffff06;
  }
  &[data-selected='true'] {
    background: var(--color-accent-primary-soft);
    border-color: var(--color-accent-primary-ring);
  }
}
.container_hosts_list_row_select {
  flex: 1;
  min-width: 0;
  justify-content: flex-start;
  padding: 8px 5px 8px 7px;
  text-align: left;
  gap: 9px;
}
.container_hosts_list_row_icon {
  display: flex;
  flex-shrink: 0;
  color: var(--color-text-muted);
}
.container_hosts_list_row_copy {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.container_hosts_list_row_name {
  font-size: 13px;
  color: var(--color-text-primary);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.container_hosts_list_row_address {
  font-size: 12px;
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.container_hosts_list_row_star {
  display: flex;
  flex-shrink: 0;
  color: var(--color-warning);
}
.container_hosts_list_row_connect {
  padding: 4px;
  margin-right: 3px;
  color: var(--color-accent-primary);
}
.container_hosts_list_body_empty {
  padding: 16px 13px;
  margin: 0;
  font-size: 12px;
  line-height: 1.8;
  color: var(--color-text-muted);
  text-align: center;
}
.container_local_shells_sidebar_base {
  border-top: 1px solid var(--color-border);
  padding: 10px 12px 12px;
}
.container_local_shells_header_toggle {
  width: 100%;
  padding: 4px 1px 8px;
  font-size: 12px;
  justify-content: flex-start;
}
.container_local_shells_header_count {
  margin-left: auto;
  font-size: 12px;
  color: var(--color-text-muted);
}
.container_local_shells_body_list {
  max-height: 220px;
  overflow-y: auto;
}
.container_local_shells_row_open {
  width: 100%;
  justify-content: flex-start;
  padding: 7px;
  font-size: 12px;
  gap: 10px;
}
.container_local_shells_row_name {
  margin-right: auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.container_local_shells_body_empty {
  font-size: 12px;
  color: var(--color-text-muted);
}
.container_hosts_sidebar_footer_base {
  display: flex;
  gap: 6px;
  justify-content: center;
  align-items: center;
  padding: 10px 6px;
  border-top: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-size: 12px;
}
</style>
