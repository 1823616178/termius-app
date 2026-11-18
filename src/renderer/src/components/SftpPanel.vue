<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  ArrowUp,
  Check,
  Copy,
  Download,
  Edit3,
  Eye,
  EyeOff,
  File,
  Folder,
  FolderPlus,
  FolderUp,
  Home,
  Link2,
  Pencil,
  RefreshCw,
  Shield,
  Terminal,
  Trash2,
  Upload,
  X
} from '@lucide/vue'
import { instanceClass } from '../../../shared/classes'
import {
  formatBytes,
  formatOctalMode,
  joinRemotePosixPath,
  remoteBreadcrumbs,
  type SftpEntry
} from '../../../shared/sftp'
import {
  activeSftpContext,
  allSshPanes,
  availableSshHosts,
  connectStandaloneSftpHost,
  downloadRemoteEntries,
  insertRemotePathIntoTerminal,
  refreshSftpDirectory,
  selectSftpPaneTarget,
  sftpConflictPrompt,
  sftpCurrentPath,
  sftpDrawerOpen,
  sftpError,
  sftpFilter,
  sftpLoading,
  sftpPasswordPrompt,
  sftpShowHidden,
  sftpSortAsc,
  sftpSortBy,
  uploadLocalPathsToCurrentDir,
  visibleSftpEntries
} from '../services/sftp-store'
import { t } from '../services/i18n'
import { notify, windowInstance } from '../stores/workbench'
import OrbitSelect from './OrbitSelect.vue'
import SftpTransferQueue from './SftpTransferQueue.vue'

const chmodPermissions = computed(() => [
  { label: t('sftp.permOwnerRead'), shift: 8 },
  { label: t('sftp.permOwnerWrite'), shift: 7 },
  { label: t('sftp.permOwnerExec'), shift: 6 },
  { label: t('sftp.permGroupRead'), shift: 5 },
  { label: t('sftp.permGroupWrite'), shift: 4 },
  { label: t('sftp.permGroupExec'), shift: 3 },
  { label: t('sftp.permOtherRead'), shift: 2 },
  { label: t('sftp.permOtherWrite'), shift: 1 },
  { label: t('sftp.permOtherExec'), shift: 0 }
])

function safeTokenPart(raw: string): string {
  if (/^[a-z0-9-]+$/.test(raw)) return raw
  let h1 = 0x811c9dc5
  let h2 = 0x9e3779b9
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 0x01000193)
    h2 = Math.imul(h2 ^ code, 0x85ebca6b)
  }
  return `k-${(h1 >>> 0).toString(36)}-${(h2 >>> 0).toString(36)}`
}

const c = (base: string, suffix?: string) =>
  instanceClass(base, windowInstance(suffix ? `sftp-${safeTokenPart(suffix)}` : 'sftp-panel'))

const panelRoot = ref<HTMLElement>()
const pathEditMode = ref(false)
const pathInputValue = ref('')
const pathInputEl = ref<HTMLInputElement>()
const selectedPaths = ref<Set<string>>(new Set())
const dragOverActive = ref(false)
const dragDepth = ref(0)

const mkdirDialogOpen = ref(false)
const mkdirName = ref('')
const mkdirInputEl = ref<HTMLInputElement>()

const renameTarget = ref<SftpEntry | null>(null)
const renameValue = ref('')
const renameInputEl = ref<HTMLInputElement>()

const chmodTarget = ref<SftpEntry | null>(null)
const chmodOctal = ref('0644')
const chmodInputEl = ref<HTMLInputElement>()

const deleteTarget = ref<SftpEntry[] | null>(null)
const conflictApplyAll = ref(false)
const standalonePassword = ref('')
const contextMenu = ref<{ entry: SftpEntry; x: number; y: number } | null>(null)

const breadcrumbs = computed(() => remoteBreadcrumbs(sftpCurrentPath.value))
const isReady = computed(() =>
  Boolean(activeSftpContext.value?.sessionId && activeSftpContext.value.state === 'running')
)
const selectedEntries = computed(() =>
  visibleSftpEntries.value.filter((entry) => selectedPaths.value.has(entry.path))
)

const targetSelectorOptions = computed(() => {
  const options: { value: string; label: string; hint?: string }[] = []
  for (const pane of allSshPanes.value) {
    options.push({
      value: `pane:${pane.token}`,
      label: pane.title,
      hint: pane.state === 'running' ? t('sftp.sessionHint') : t('sftp.connectingHint')
    })
  }
  for (const host of availableSshHosts()) {
    options.push({
      value: `host:${host.id}`,
      label: host.name,
      hint: `${host.username}@${host.address}`
    })
  }
  return options
})

const selectedTargetValue = computed(() => {
  const ctx = activeSftpContext.value
  if (!ctx) return ''
  if (ctx.source === 'pane' && ctx.paneToken) return `pane:${ctx.paneToken}`
  if (ctx.source === 'standalone' && ctx.hostId) return `host:${ctx.hostId}`
  return ''
})

function onTargetChanged(value: string): void {
  selectedPaths.value.clear()
  if (value.startsWith('pane:')) {
    selectSftpPaneTarget(value.slice(5))
    return
  }
  if (value.startsWith('host:')) {
    const hostId = value.slice(5)
    const host = availableSshHosts().find((item) => item.id === hostId)
    if (host) void connectStandaloneSftpHost(host)
  }
}

watch(sftpCurrentPath, () => {
  selectedPaths.value = new Set()
  contextMenu.value = null
})

watch(sftpConflictPrompt, () => {
  conflictApplyAll.value = false
})

async function openPathEdit(): Promise<void> {
  pathInputValue.value = sftpCurrentPath.value
  pathEditMode.value = true
  await nextTick()
  pathInputEl.value?.focus()
  pathInputEl.value?.select()
}

function submitPathEdit(): void {
  const trimmed = pathInputValue.value.trim()
  pathEditMode.value = false
  if (trimmed && trimmed !== sftpCurrentPath.value) {
    void refreshSftpDirectory(trimmed)
  }
}

function navigateTo(path: string): void {
  pathEditMode.value = false
  void refreshSftpDirectory(path)
}

function goUp(): void {
  const crumbs = breadcrumbs.value
  if (crumbs.length <= 1) return
  const parent = crumbs[crumbs.length - 2]
  if (parent) navigateTo(parent.path)
}

function goHome(): void {
  const sessionId = activeSftpContext.value?.sessionId
  if (!sessionId || !isReady.value) return
  void window.orbit.sftp.home(sessionId).then(
    (homePath) => navigateTo(homePath),
    (error) => notify(error instanceof Error ? error.message : t('sftp.homeLocateFailed'))
  )
}

function toggleSort(field: 'name' | 'size' | 'mtime'): void {
  if (sftpSortBy.value === field) {
    sftpSortAsc.value = !sftpSortAsc.value
  } else {
    sftpSortBy.value = field
    sftpSortAsc.value = field === 'name'
  }
}

function isDirEntry(entry: SftpEntry): boolean {
  return entry.kind === 'directory' || entry.targetKind === 'directory'
}

function onRowClick(entry: SftpEntry, event: MouseEvent): void {
  contextMenu.value = null
  const next = new Set(selectedPaths.value)
  if (event.ctrlKey || event.metaKey) {
    if (next.has(entry.path)) next.delete(entry.path)
    else next.add(entry.path)
  } else {
    next.clear()
    next.add(entry.path)
  }
  selectedPaths.value = next
}

function onRowDoubleClick(entry: SftpEntry): void {
  if (isDirEntry(entry)) {
    navigateTo(entry.path)
  } else {
    void downloadRemoteEntries([entry])
  }
}

function openRowContextMenu(entry: SftpEntry, event: MouseEvent): void {
  if (!selectedPaths.value.has(entry.path)) {
    selectedPaths.value = new Set([entry.path])
  }
  const rootEl = panelRoot.value
  if (!rootEl) return
  const rect = rootEl.getBoundingClientRect()
  const x = Math.min(Math.max(8, event.clientX - rect.left), Math.max(8, rect.width - 188))
  const y = Math.min(Math.max(48, event.clientY - rect.top), Math.max(48, rect.height - 230))
  contextMenu.value = { entry, x, y }
}

async function openMkdirModal(): Promise<void> {
  mkdirName.value = ''
  mkdirDialogOpen.value = true
  await nextTick()
  mkdirInputEl.value?.focus()
}

async function submitMkdir(): Promise<void> {
  const sessionId = activeSftpContext.value?.sessionId
  const name = mkdirName.value.trim()
  if (!sessionId || !name) return
  if (name.includes('/') || name.includes('\\')) {
    notify(t('sftp.invalidSlashName'))
    return
  }
  mkdirDialogOpen.value = false
  try {
    await window.orbit.sftp.mkdir(sessionId, joinRemotePosixPath(sftpCurrentPath.value, name))
    notify(t('sftp.mkdirSuccess', { name }))
    await refreshSftpDirectory(sftpCurrentPath.value)
  } catch (error) {
    notify(error instanceof Error ? error.message : t('sftp.mkdirFailed'))
  }
}

async function openRenameModal(entry: SftpEntry): Promise<void> {
  contextMenu.value = null
  renameTarget.value = entry
  renameValue.value = entry.name
  await nextTick()
  renameInputEl.value?.focus()
  renameInputEl.value?.select()
}

async function submitRename(): Promise<void> {
  const sessionId = activeSftpContext.value?.sessionId
  const target = renameTarget.value
  const nextName = renameValue.value.trim()
  if (!sessionId || !target || !nextName) return
  if (nextName.includes('/') || nextName.includes('\\')) {
    notify(t('sftp.invalidSlashName'))
    return
  }
  renameTarget.value = null
  if (nextName === target.name) return
  try {
    const parent = target.path.slice(0, Math.max(1, target.path.lastIndexOf('/')))
    const nextPath = joinRemotePosixPath(parent === target.path ? '/' : parent, nextName)
    await window.orbit.sftp.rename(sessionId, target.path, nextPath)
    notify(t('sftp.renameSuccess', { name: nextName }))
    await refreshSftpDirectory(sftpCurrentPath.value)
  } catch (error) {
    notify(error instanceof Error ? error.message : t('sftp.renameFailed'))
  }
}

async function openChmodModal(entry: SftpEntry): Promise<void> {
  contextMenu.value = null
  chmodTarget.value = entry
  chmodOctal.value = formatOctalMode(entry.mode)
  await nextTick()
  chmodInputEl.value?.focus()
  chmodInputEl.value?.select()
}

function chmodBit(shift: number): boolean {
  const parsed = Number.parseInt(chmodOctal.value, 8)
  if (!Number.isFinite(parsed)) return false
  return Boolean((parsed >> shift) & 1)
}

function toggleChmodBit(shift: number): void {
  const current = Number.parseInt(chmodOctal.value, 8)
  const base = Number.isFinite(current) ? current : 0o644
  const next = base ^ (1 << shift)
  chmodOctal.value = formatOctalMode(next)
}

async function submitChmod(): Promise<void> {
  const sessionId = activeSftpContext.value?.sessionId
  const target = chmodTarget.value
  if (!sessionId || !target) return
  const parsed = Number.parseInt(chmodOctal.value.trim(), 8)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 0o7777) {
    notify(t('sftp.invalidOctalMode'))
    return
  }
  chmodTarget.value = null
  try {
    await window.orbit.sftp.chmod(sessionId, target.path, parsed)
    notify(t('sftp.chmodSuccess', { name: target.name, mode: formatOctalMode(parsed) }))
    await refreshSftpDirectory(sftpCurrentPath.value)
  } catch (error) {
    notify(error instanceof Error ? error.message : t('sftp.chmodFailed'))
  }
}

function requestDelete(entries: SftpEntry[]): void {
  contextMenu.value = null
  if (!entries.length) return
  deleteTarget.value = entries
}

async function confirmDelete(): Promise<void> {
  const sessionId = activeSftpContext.value?.sessionId
  const targets = deleteTarget.value
  deleteTarget.value = null
  if (!sessionId || !targets?.length) return
  try {
    for (const entry of targets) {
      await window.orbit.sftp.remove(sessionId, entry.path, entry.kind === 'directory')
    }
    notify(t('sftp.deletedItems', { count: targets.length }))
    selectedPaths.value = new Set()
    await refreshSftpDirectory(sftpCurrentPath.value)
  } catch (error) {
    notify(error instanceof Error ? error.message : t('sftp.deleteFailed'))
  }
}

async function pickAndUploadFiles(): Promise<void> {
  const paths = await window.orbit.sftp.pickUploadFiles()
  if (paths.length) await uploadLocalPathsToCurrentDir(paths)
}

async function pickAndUploadDirs(): Promise<void> {
  const paths = await window.orbit.sftp.pickUploadDirs()
  if (paths.length) await uploadLocalPathsToCurrentDir(paths)
}

function hasFileDragPayload(dataTransfer: DataTransfer | null | undefined): boolean {
  if (!dataTransfer) return false
  return dataTransfer.types.includes('Files') || dataTransfer.types.includes('text/uri-list')
}

function onDragEnter(event: DragEvent): void {
  if (!isReady.value) return
  if (!hasFileDragPayload(event.dataTransfer)) return
  dragDepth.value += 1
  dragOverActive.value = true
}

function onDragLeave(): void {
  dragDepth.value = Math.max(0, dragDepth.value - 1)
  if (dragDepth.value === 0) dragOverActive.value = false
}

function onDragOver(event: DragEvent): void {
  const acceptsFiles = isReady.value && hasFileDragPayload(event.dataTransfer)
  dragOverActive.value = acceptsFiles
  if (acceptsFiles && event.dataTransfer) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }
}

function extractDroppedFiles(dataTransfer: DataTransfer): File[] {
  if (dataTransfer.files.length > 0) {
    return Array.from(dataTransfer.files)
  }
  const files: File[] = []
  for (const item of Array.from(dataTransfer.items ?? [])) {
    if (item.kind !== 'file') continue
    const file = item.getAsFile()
    if (file) files.push(file)
  }
  return files
}

async function onDropFiles(event: DragEvent): Promise<void> {
  dragDepth.value = 0
  dragOverActive.value = false
  if (!isReady.value || !event.dataTransfer) return
  // Convert FileList to File[] before crossing contextBridge; FileList loses indexed items over IPC boundary.
  const droppedFiles = extractDroppedFiles(event.dataTransfer)
  const paths = window.orbit.sftp.getDroppedPaths(droppedFiles)
  if (!paths.length) {
    if (droppedFiles.length > 0 || event.dataTransfer.types.includes('text/uri-list')) {
      notify(t('sftp.dropNoLocalPaths'))
    }
    return
  }
  await uploadLocalPathsToCurrentDir(paths)
}

function copyRemotePath(path: string): void {
  contextMenu.value = null
  void window.orbit.clipboard.writeText(path).then(
    () => notify(t('sftp.copiedPath', { path })),
    () => notify(t('sftp.clipboardFailed'))
  )
}

function submitStandalonePassword(): void {
  const prompt = sftpPasswordPrompt.value
  if (!prompt) return
  const pw = standalonePassword.value
  standalonePassword.value = ''
  void connectStandaloneSftpHost(prompt.host, pw)
}

function formatMtime(epochSec: number): string {
  if (!epochSec) return '—'
  const date = new Date(epochSec * 1000)
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${mm}-${dd} ${hh}:${min}`
}

function revealLocalFile(localPath: string): void {
  void window.orbit.sftp.revealLocal(localPath)
}
</script>

<template>
  <aside
    ref="panelRoot"
    class="container_workspace_sftp_panel_base"
    :aria-label="t('sftp.panelAria')"
    @click="contextMenu = null"
    @dragenter.prevent="onDragEnter"
    @dragover="onDragOver"
    @dragleave.prevent="onDragLeave"
    @drop.prevent.stop="onDropFiles"
  >
    <header class="container_workspace_sftp_header_base">
      <div class="container_workspace_sftp_header_title">
        <span class="container_workspace_sftp_header_badge">SFTP</span>
        <span class="container_workspace_sftp_header_dot" :data-state="activeSftpContext?.state ?? 'idle'" />
        <OrbitSelect
          v-if="targetSelectorOptions.length"
          :model-value="selectedTargetValue"
          :options="targetSelectorOptions"
          :aria-label="t('sftp.selectTargetAria')"
          :placeholder="t('sftp.selectTargetPlaceholder')"
          size="sm"
          width="176px"
          instance="workspace-sftp-target"
          @update:model-value="onTargetChanged"
        />
        <span v-else class="container_workspace_sftp_header_empty-host">{{ t('sftp.noHostSelected') }}</span>
      </div>
      <button
        class="container_workspace_sftp_header_close"
        type="button"
        :aria-label="t('sftp.closeAria')"
        :title="t('sftp.closeTitle')"
        @click="sftpDrawerOpen = false"
      >
        <X :size="14" />
      </button>
    </header>

    <div class="container_workspace_sftp_toolbar_base">
      <button
        class="container_workspace_sftp_toolbar_up"
        type="button"
        :aria-label="t('sftp.upAria')"
        :title="t('sftp.upTitle')"
        :disabled="!isReady || breadcrumbs.length <= 1"
        @click="goUp"
      >
        <ArrowUp :size="14" />
      </button>
      <button
        class="container_workspace_sftp_toolbar_home"
        type="button"
        :aria-label="t('sftp.homeAria')"
        :title="t('sftp.homeTitle')"
        :disabled="!isReady"
        @click="goHome"
      >
        <Home :size="14" />
      </button>
      <button
        class="container_workspace_sftp_toolbar_refresh"
        type="button"
        :aria-label="t('sftp.refreshAria')"
        :title="t('sftp.refreshTitle')"
        :disabled="!isReady || sftpLoading"
        @click="refreshSftpDirectory(sftpCurrentPath)"
      >
        <RefreshCw :size="14" />
      </button>
      <button
        class="container_workspace_sftp_toolbar_hidden"
        type="button"
        :aria-label="t('sftp.hiddenAria')"
        :title="t('sftp.hiddenTitle')"
        :aria-pressed="sftpShowHidden"
        @click="sftpShowHidden = !sftpShowHidden"
      >
        <Eye v-if="sftpShowHidden" :size="14" />
        <EyeOff v-else :size="14" />
      </button>
      <button
        class="container_workspace_sftp_toolbar_mkdir"
        type="button"
        :aria-label="t('sftp.mkdirAria')"
        :title="t('sftp.mkdirAria')"
        :disabled="!isReady"
        @click="openMkdirModal"
      >
        <FolderPlus :size="14" />
      </button>
      <button
        class="container_workspace_sftp_toolbar_upload-file"
        type="button"
        data-primary
        :disabled="!isReady"
        :title="t('sftp.uploadFileTitle')"
        @click="pickAndUploadFiles"
      >
        <Upload :size="13" />
        {{ t('sftp.uploadFile') }}
      </button>
      <button
        class="container_workspace_sftp_toolbar_upload-dir"
        type="button"
        :disabled="!isReady"
        :title="t('sftp.uploadDirTitle')"
        @click="pickAndUploadDirs"
      >
        <FolderUp :size="13" />
        {{ t('sftp.uploadDir') }}
      </button>
    </div>

    <div class="container_workspace_sftp_path_bar">
      <form v-if="pathEditMode" class="container_workspace_sftp_path_form" @submit.prevent="submitPathEdit">
        <input
          ref="pathInputEl"
          v-model="pathInputValue"
          class="container_workspace_sftp_path_input"
          :aria-label="t('sftp.remotePathAria')"
          @keydown.esc="pathEditMode = false"
        />
        <button class="container_workspace_sftp_path_go" type="submit" :aria-label="t('sftp.jumpPathAria')">
          <Check :size="13" />
        </button>
      </form>
      <div v-else class="container_workspace_sftp_path_crumbs">
        <button
          v-for="(crumb, idx) in breadcrumbs"
          :key="crumb.path"
          :class="c('container_workspace_sftp_path_crumb', String(idx))"
          type="button"
          @click="navigateTo(crumb.path)"
        >
          {{ crumb.label }}
        </button>
        <button
          class="container_workspace_sftp_path_edit"
          type="button"
          :aria-label="t('sftp.editPathAria')"
          :title="t('sftp.editPathTitle')"
          :disabled="!isReady"
          @click="openPathEdit"
        >
          <Edit3 :size="12" />
        </button>
      </div>
    </div>

    <div class="container_workspace_sftp_filter_bar">
      <input
        v-model="sftpFilter"
        class="container_workspace_sftp_filter_input"
        type="text"
        :aria-label="t('sftp.filterAria')"
        :placeholder="t('sftp.filterPlaceholder')"
      />
      <button
        class="container_workspace_sftp_sort_name"
        type="button"
        :data-active="sftpSortBy === 'name'"
        @click="toggleSort('name')"
      >
        {{ t('sftp.sortName') }}
      </button>
      <button
        class="container_workspace_sftp_sort_size"
        type="button"
        :data-active="sftpSortBy === 'size'"
        @click="toggleSort('size')"
      >
        {{ t('sftp.sortSize') }}
      </button>
      <button
        class="container_workspace_sftp_sort_mtime"
        type="button"
        :data-active="sftpSortBy === 'mtime'"
        @click="toggleSort('mtime')"
      >
        {{ t('sftp.sortTime') }}
      </button>
      <span class="container_workspace_sftp_filter_count">
        {{ t('sftp.itemCount', { count: visibleSftpEntries.length }) }}
      </span>
    </div>

    <div class="container_workspace_sftp_body_main" :aria-busy="sftpLoading">
      <div v-if="sftpPasswordPrompt" class="container_workspace_sftp_auth_box">
        <p class="container_workspace_sftp_auth_title">
          {{
            t('sftp.authConnectTitle', {
              name: sftpPasswordPrompt.host.name,
              user: sftpPasswordPrompt.host.username,
              host: sftpPasswordPrompt.host.address
            })
          }}
        </p>
        <p v-if="sftpPasswordPrompt.error" class="container_workspace_sftp_auth_error">
          {{ sftpPasswordPrompt.error }}
        </p>
        <form class="container_workspace_sftp_auth_form" @submit.prevent="submitStandalonePassword">
          <input
            v-model="standalonePassword"
            class="container_workspace_sftp_auth_input"
            type="password"
            :aria-label="t('sftp.passwordInputAria')"
            :placeholder="t('sftp.passwordPlaceholder')"
          />
          <button class="container_workspace_sftp_auth_submit" type="submit" data-primary>
            {{ t('sftp.connectAction') }}
          </button>
        </form>
      </div>

      <div v-else-if="!activeSftpContext" class="container_workspace_sftp_nohost_base">
        <p class="container_workspace_sftp_nohost_title">{{ t('sftp.noHostTitle') }}</p>
        <p class="container_workspace_sftp_nohost_desc">
          {{ t('sftp.noHostDesc') }}
        </p>
        <div v-if="availableSshHosts().length" class="container_workspace_sftp_host_quicklist">
          <button
            v-for="host in availableSshHosts().slice(0, 6)"
            :key="host.id"
            :class="c('container_workspace_sftp_host_quickbtn', host.id)"
            type="button"
            @click="connectStandaloneSftpHost(host)"
          >
            {{ host.name }} · {{ host.username }}@{{ host.address }}
          </button>
        </div>
      </div>

      <div v-else-if="!isReady" class="container_workspace_sftp_pending_base">
        <p class="container_workspace_sftp_pending_title">
          {{
            activeSftpContext.state === 'error'
              ? t('sftp.notReadyError')
              : activeSftpContext.state === 'exited'
                ? t('sftp.notReadyExited')
                : t('sftp.notReadyEstablishing')
          }}
        </p>
        <p v-if="activeSftpContext.message" class="container_workspace_sftp_pending_desc">
          {{ activeSftpContext.message }}
        </p>
      </div>

      <div v-else-if="sftpError" class="container_workspace_sftp_error_box" role="alert">
        <span class="container_workspace_sftp_error_text">{{ sftpError }}</span>
        <button
          class="container_workspace_sftp_error_retry"
          type="button"
          @click="refreshSftpDirectory(sftpCurrentPath)"
        >
          {{ t('sftp.retryAction') }}
        </button>
      </div>

      <div
        v-else-if="sftpLoading && !visibleSftpEntries.length"
        class="container_workspace_sftp_loading_base"
      >
        <p class="container_workspace_sftp_loading_title">{{ t('sftp.loadingDir') }}</p>
      </div>

      <div v-else-if="!visibleSftpEntries.length" class="container_workspace_sftp_empty_base">
        <p class="container_workspace_sftp_empty_title">{{ t('sftp.emptyDirTitle') }}</p>
        <p class="container_workspace_sftp_empty_desc">
          {{ t('sftp.emptyDirDesc') }}
        </p>
      </div>

      <div v-else class="container_workspace_sftp_list_scroll" role="list">
        <div
          v-for="entry in visibleSftpEntries"
          :key="entry.path"
          :class="c('container_workspace_sftp_row_item', entry.path)"
          :data-selected="selectedPaths.has(entry.path)"
          :data-kind="isDirEntry(entry) ? 'directory' : entry.kind"
          role="listitem"
          @click="onRowClick(entry, $event)"
          @dblclick="onRowDoubleClick(entry)"
          @contextmenu.prevent.stop="openRowContextMenu(entry, $event)"
        >
          <span :class="c('container_workspace_sftp_row_icon', entry.path)">
            <Link2 v-if="entry.kind === 'symlink'" :size="14" />
            <Folder v-else-if="isDirEntry(entry)" :size="14" />
            <File v-else :size="14" />
          </span>
          <div :class="c('container_workspace_sftp_row_main', entry.path)">
            <span :class="c('container_workspace_sftp_row_name', entry.path)" :title="entry.path">
              {{ entry.name }}
              <em v-if="entry.linkTarget" :class="c('container_workspace_sftp_row_link', entry.path)">
                → {{ entry.linkTarget }}
              </em>
            </span>
            <span :class="c('container_workspace_sftp_row_meta', entry.path)">
              {{ isDirEntry(entry) ? t('sftp.dirLabel') : formatBytes(entry.size) }} ·
              {{ formatOctalMode(entry.mode) }} ·
              {{ formatMtime(entry.mtime) }}
            </span>
          </div>
          <div :class="c('container_workspace_sftp_row_actions', entry.path)">
            <button
              :class="c('container_workspace_sftp_row_download', entry.path)"
              type="button"
              :aria-label="t('sftp.downloadAria', { name: entry.name })"
              :title="t('sftp.downloadTitle')"
              @click.stop="downloadRemoteEntries([entry])"
            >
              <Download :size="12" />
            </button>
            <button
              :class="c('container_workspace_sftp_row_rename', entry.path)"
              type="button"
              :aria-label="t('sftp.renameAria', { name: entry.name })"
              :title="t('sftp.rename')"
              @click.stop="openRenameModal(entry)"
            >
              <Pencil :size="12" />
            </button>
            <button
              :class="c('container_workspace_sftp_row_delete', entry.path)"
              type="button"
              :aria-label="t('sftp.deleteAria', { name: entry.name })"
              :title="t('sftp.delete')"
              @click.stop="requestDelete([entry])"
            >
              <Trash2 :size="12" />
            </button>
          </div>
        </div>
      </div>

      <div v-if="dragOverActive" class="container_workspace_sftp_drop_overlay">
        <Upload :size="24" />
        <span class="container_workspace_sftp_drop_text">
          {{ t('sftp.dropToUpload', { path: sftpCurrentPath }) }}
        </span>
      </div>
    </div>

    <div v-if="selectedEntries.length > 0 && isReady" class="container_workspace_sftp_batch_bar">
      <span class="container_workspace_sftp_batch_label">
        {{ t('sftp.selectedCount', { count: selectedEntries.length }) }}
      </span>
      <button
        class="container_workspace_sftp_batch_download"
        type="button"
        @click="downloadRemoteEntries(selectedEntries)"
      >
        <Download :size="12" />
        {{ t('sftp.download') }}
      </button>
      <button
        class="container_workspace_sftp_batch_delete"
        type="button"
        @click="requestDelete(selectedEntries)"
      >
        <Trash2 :size="12" />
        {{ t('sftp.delete') }}
      </button>
      <button class="container_workspace_sftp_batch_clear" type="button" @click="selectedPaths = new Set()">
        {{ t('sftp.clearSelection') }}
      </button>
    </div>

    <SftpTransferQueue :instance-class-for="c" @reveal-local="revealLocalFile" />

    <div
      v-if="contextMenu"
      class="container_workspace_sftp_context_menu"
      :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
      role="menu"
      @click.stop
    >
      <button
        class="container_workspace_sftp_menu_download"
        type="button"
        @click="
          () => {
            const target = contextMenu!.entry
            contextMenu = null
            void downloadRemoteEntries([target])
          }
        "
      >
        <Download :size="13" />
        {{ t('sftp.menuDownload') }}
      </button>
      <button
        class="container_workspace_sftp_menu_rename"
        type="button"
        @click="openRenameModal(contextMenu.entry)"
      >
        <Pencil :size="13" />
        {{ t('sftp.rename') }}
      </button>
      <button
        class="container_workspace_sftp_menu_chmod"
        type="button"
        @click="openChmodModal(contextMenu.entry)"
      >
        <Shield :size="13" />
        {{ t('sftp.menuChmod') }}
      </button>
      <button
        class="container_workspace_sftp_menu_copypath"
        type="button"
        @click="copyRemotePath(contextMenu.entry.path)"
      >
        <Copy :size="13" />
        {{ t('sftp.menuCopyPath') }}
      </button>
      <button
        class="container_workspace_sftp_menu_insertpath"
        type="button"
        @click="
          () => {
            const p = contextMenu!.entry.path
            contextMenu = null
            insertRemotePathIntoTerminal(p)
          }
        "
      >
        <Terminal :size="13" />
        {{ t('sftp.menuInsertPath') }}
      </button>
      <button
        class="container_workspace_sftp_menu_delete"
        type="button"
        @click="requestDelete([contextMenu.entry])"
      >
        <Trash2 :size="13" />
        {{ t('sftp.delete') }}
      </button>
    </div>

    <div v-if="mkdirDialogOpen" class="container_workspace_sftp_mkdir_backdrop">
      <form class="container_workspace_sftp_mkdir_card" @submit.prevent="submitMkdir">
        <strong class="container_workspace_sftp_mkdir_title">{{ t('sftp.mkdirTitle') }}</strong>
        <input
          ref="mkdirInputEl"
          v-model="mkdirName"
          class="container_workspace_sftp_mkdir_input"
          :aria-label="t('sftp.mkdirAriaInput')"
          :placeholder="t('sftp.mkdirPlaceholder')"
          @keydown.esc="mkdirDialogOpen = false"
        />
        <div class="container_workspace_sftp_mkdir_actions">
          <button
            class="container_workspace_sftp_mkdir_cancel"
            type="button"
            @click="mkdirDialogOpen = false"
          >
            {{ t('actionDialog.cancel') }}
          </button>
          <button class="container_workspace_sftp_mkdir_confirm" type="submit" data-primary>
            {{ t('sftp.create') }}
          </button>
        </div>
      </form>
    </div>

    <div v-if="renameTarget" class="container_workspace_sftp_rename_backdrop">
      <form class="container_workspace_sftp_rename_card" @submit.prevent="submitRename">
        <strong class="container_workspace_sftp_rename_title">
          {{ t('sftp.renameTitle', { name: renameTarget.name }) }}
        </strong>
        <input
          ref="renameInputEl"
          v-model="renameValue"
          class="container_workspace_sftp_rename_input"
          :aria-label="t('sftp.renameAriaInput')"
          @keydown.esc="renameTarget = null"
        />
        <div class="container_workspace_sftp_rename_actions">
          <button class="container_workspace_sftp_rename_cancel" type="button" @click="renameTarget = null">
            {{ t('actionDialog.cancel') }}
          </button>
          <button class="container_workspace_sftp_rename_confirm" type="submit" data-primary>
            {{ t('sftp.confirm') }}
          </button>
        </div>
      </form>
    </div>

    <div v-if="chmodTarget" class="container_workspace_sftp_chmod_backdrop">
      <form class="container_workspace_sftp_chmod_card" @submit.prevent="submitChmod">
        <strong class="container_workspace_sftp_chmod_title">
          {{ t('sftp.chmodTitle', { name: chmodTarget.name }) }}
        </strong>
        <input
          ref="chmodInputEl"
          v-model="chmodOctal"
          class="container_workspace_sftp_chmod_input"
          :aria-label="t('sftp.chmodAriaInput')"
          placeholder="0755"
        />
        <div class="container_workspace_sftp_chmod_grid">
          <label
            v-for="bit in chmodPermissions"
            :key="bit.shift"
            :class="c('container_workspace_sftp_chmod_cell', String(bit.shift))"
          >
            <input
              :class="c('container_workspace_sftp_chmod_check', String(bit.shift))"
              type="checkbox"
              :checked="chmodBit(bit.shift)"
              @change="toggleChmodBit(bit.shift)"
            />
            <span :class="c('container_workspace_sftp_chmod_label', String(bit.shift))">{{ bit.label }}</span>
          </label>
        </div>
        <div class="container_workspace_sftp_chmod_actions">
          <button class="container_workspace_sftp_chmod_cancel" type="button" @click="chmodTarget = null">
            {{ t('actionDialog.cancel') }}
          </button>
          <button class="container_workspace_sftp_chmod_confirm" type="submit" data-primary>
            {{ t('sftp.apply') }}
          </button>
        </div>
      </form>
    </div>

    <div v-if="deleteTarget" class="container_workspace_sftp_delete_backdrop">
      <div
        class="container_workspace_sftp_delete_card"
        role="dialog"
        :aria-label="t('sftp.deleteDialogAria')"
      >
        <strong class="container_workspace_sftp_delete_title">
          {{ t('sftp.deleteTitle', { count: deleteTarget.length }) }}
        </strong>
        <p class="container_workspace_sftp_delete_desc">
          {{ t('sftp.deleteDesc') }}
        </p>
        <ul class="container_workspace_sftp_delete_list">
          <li
            v-for="item in deleteTarget"
            :key="item.path"
            :class="c('container_workspace_sftp_delete_item', item.path)"
          >
            {{ item.path }}
          </li>
        </ul>
        <div class="container_workspace_sftp_delete_actions">
          <button class="container_workspace_sftp_delete_cancel" type="button" @click="deleteTarget = null">
            {{ t('actionDialog.cancel') }}
          </button>
          <button
            class="container_workspace_sftp_delete_confirm"
            type="button"
            data-danger
            @click="confirmDelete"
          >
            {{ t('sftp.deleteConfirmBtn') }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="sftpConflictPrompt" class="container_workspace_sftp_conflict_backdrop">
      <div
        class="container_workspace_sftp_conflict_card"
        role="dialog"
        :aria-label="t('sftp.conflictDialogAria')"
      >
        <strong class="container_workspace_sftp_conflict_title">{{ t('sftp.conflictTitle') }}</strong>
        <p class="container_workspace_sftp_conflict_desc">
          {{
            t('sftp.conflictDesc', {
              side:
                sftpConflictPrompt.direction === 'upload'
                  ? t('sftp.conflictRemote')
                  : t('sftp.conflictLocal'),
              name: sftpConflictPrompt.name
            })
          }}
        </p>
        <label class="container_workspace_sftp_conflict_check">
          <input v-model="conflictApplyAll" class="container_workspace_sftp_conflict_box" type="checkbox" />
          <span class="container_workspace_sftp_conflict_label">{{ t('sftp.conflictApplyAll') }}</span>
        </label>
        <div class="container_workspace_sftp_conflict_actions">
          <button
            class="container_workspace_sftp_conflict_cancel"
            type="button"
            @click="sftpConflictPrompt.resolve({ decision: 'skip', applyAll: conflictApplyAll })"
          >
            {{ t('sftp.conflictSkip') }}
          </button>
          <button
            class="container_workspace_sftp_conflict_rename"
            type="button"
            @click="sftpConflictPrompt.resolve({ decision: 'rename', applyAll: conflictApplyAll })"
          >
            {{ t('sftp.conflictRename') }}
          </button>
          <button
            class="container_workspace_sftp_conflict_confirm"
            type="button"
            data-primary
            @click="sftpConflictPrompt.resolve({ decision: 'overwrite', applyAll: conflictApplyAll })"
          >
            {{ t('sftp.conflictOverwrite') }}
          </button>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped lang="scss">
.container_workspace_sftp_panel_base {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  min-height: 0;
  background: var(--color-surface-1);
  border-left: 1px solid var(--color-border);
  font-size: 12px;
  color: var(--color-text-primary);
}
.container_workspace_sftp_body_main[aria-busy='true']::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 35%;
  height: 2px;
  background: var(--color-accent-primary);
  animation: sftp-directory-loading 1s ease-in-out infinite alternate;
  pointer-events: none;
}
@keyframes sftp-directory-loading {
  from {
    transform: translateX(0);
    opacity: 0.45;
  }
  to {
    transform: translateX(185%);
    opacity: 1;
  }
}
.container_workspace_sftp_drop_overlay {
  animation: sftp-content-enter 160ms ease-out;
}
@keyframes sftp-content-enter {
  from {
    opacity: 0;
    transform: translateY(5px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.container_workspace_sftp_header_base {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 34px;
  flex-shrink: 0;
  padding: 0 10px;
  background: var(--color-surface-tab);
  border-bottom: 1px solid var(--color-border);
}
.container_workspace_sftp_header_title {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}
.container_workspace_sftp_header_badge {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.6px;
  padding: 2px 6px;
  border-radius: 3px;
  border: 1px solid var(--color-accent-primary-ring);
  background: var(--color-accent-primary-soft);
  color: var(--color-accent-primary-hover);
}
.container_workspace_sftp_header_dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--color-text-muted);
  &[data-state='running'] {
    background: var(--color-success);
    box-shadow: 0 0 8px rgba(89, 214, 160, 0.55);
  }
  &[data-state='connecting'],
  &[data-state='verifying'],
  &[data-state='authenticating'] {
    background: var(--color-warning);
  }
  &[data-state='error'] {
    background: var(--color-error);
  }
}
.container_workspace_sftp_header_empty-host {
  font-size: 11px;
  color: var(--color-text-muted);
}
.container_workspace_sftp_header_close {
  min-height: 24px;
  padding: 4px 6px;
}
.container_workspace_sftp_toolbar_base {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--color-border-subtle);
  background: var(--color-surface-chrome);
  > button {
    min-height: 26px;
    padding: 4px 7px;
    font-size: 11px;
  }
}
.container_workspace_sftp_toolbar_hidden[aria-pressed='true'] {
  color: var(--color-accent-primary-hover);
  background: var(--color-accent-primary-soft);
  border-color: var(--color-accent-primary-ring);
}
.container_workspace_sftp_toolbar_upload-file {
  margin-left: auto;
}
.container_workspace_sftp_path_bar {
  padding: 5px 8px;
  border-bottom: 1px solid var(--color-border-subtle);
  background: var(--color-surface-1);
}
.container_workspace_sftp_path_form {
  display: flex;
  align-items: center;
  gap: 4px;
}
.container_workspace_sftp_path_input {
  flex: 1;
  min-width: 0;
  padding: 4px 8px;
  font-family: var(--font-mono);
  font-size: 11px;
}
.container_workspace_sftp_path_go {
  min-height: 24px;
  padding: 4px 7px;
}
.container_workspace_sftp_path_crumbs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 3px;
}
[class*='container_workspace_sftp_path_crumb'] {
  min-height: 22px;
  padding: 2px 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-text-secondary);
  background: var(--color-surface-2);
  border: 1px solid var(--color-border-subtle);
  border-radius: 4px;
  &:hover {
    color: var(--color-accent-primary-hover);
    border-color: var(--color-accent-primary-ring);
  }
}
.container_workspace_sftp_path_edit {
  margin-left: auto;
  min-height: 22px;
  padding: 2px 6px;
}
.container_workspace_sftp_filter_bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 8px;
  border-bottom: 1px solid var(--color-border-subtle);
}
.container_workspace_sftp_filter_input {
  flex: 1;
  min-width: 0;
  padding: 4px 8px;
  font-size: 11px;
}
.container_workspace_sftp_sort_name,
.container_workspace_sftp_sort_size,
.container_workspace_sftp_sort_mtime {
  min-height: 24px;
  padding: 2px 6px;
  font-size: 10px;
  color: var(--color-text-muted);
  &[data-active='true'] {
    color: var(--color-accent-primary-hover);
    border-color: var(--color-accent-primary-ring);
    background: var(--color-accent-primary-soft);
  }
}
.container_workspace_sftp_filter_count {
  font-size: 10px;
  color: var(--color-text-muted);
  white-space: nowrap;
}
.container_workspace_sftp_batch_bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  background: var(--color-accent-primary-soft);
  border-top: 1px solid var(--color-accent-primary-ring);
  flex-shrink: 0;
  > button {
    min-height: 22px;
    padding: 2px 7px;
    font-size: 11px;
  }
}
.container_workspace_sftp_batch_label {
  margin-right: auto;
  font-size: 11px;
  color: var(--color-accent-primary-hover);
}
.container_workspace_sftp_body_main {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.container_workspace_sftp_list_scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
[class*='container_workspace_sftp_row_item'] {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 5px;
  border: 1px solid transparent;
  cursor: pointer;
  user-select: none;
  &:hover {
    background: var(--color-surface-2);
    border-color: var(--color-border-subtle);
  }
  &[data-selected='true'] {
    background: var(--color-accent-primary-soft);
    border-color: var(--color-accent-primary-ring);
  }
}
[class*='container_workspace_sftp_row_icon'] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
  flex-shrink: 0;
  [data-kind='directory'] & {
    color: var(--color-accent-primary-hover);
  }
  [data-kind='symlink'] & {
    color: var(--color-accent-secondary);
  }
}
[class*='container_workspace_sftp_row_main'] {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
[class*='container_workspace_sftp_row_name'] {
  font-size: 12px;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
[class*='container_workspace_sftp_row_link'] {
  font-style: normal;
  font-size: 11px;
  color: var(--color-accent-secondary);
}
[class*='container_workspace_sftp_row_meta'] {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-text-muted);
}
[class*='container_workspace_sftp_row_actions'] {
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0.72;
  > button {
    min-height: 22px;
    padding: 3px 5px;
  }
}
[class*='container_workspace_sftp_row_item']:hover [class*='container_workspace_sftp_row_actions'] {
  opacity: 1;
}
.container_workspace_sftp_nohost_base,
.container_workspace_sftp_pending_base,
.container_workspace_sftp_loading_base,
.container_workspace_sftp_empty_base,
.container_workspace_sftp_auth_box {
  padding: 20px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.container_workspace_sftp_nohost_title,
.container_workspace_sftp_pending_title,
.container_workspace_sftp_loading_title,
.container_workspace_sftp_empty_title,
.container_workspace_sftp_auth_title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
}
.container_workspace_sftp_nohost_desc,
.container_workspace_sftp_pending_desc,
.container_workspace_sftp_empty_desc,
.container_workspace_sftp_auth_error {
  margin: 0;
  font-size: 11px;
  color: var(--color-text-muted);
  line-height: 1.6;
}
.container_workspace_sftp_auth_error {
  color: var(--color-error);
}
.container_workspace_sftp_auth_form {
  display: flex;
  gap: 6px;
}
.container_workspace_sftp_auth_input {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
}
.container_workspace_sftp_auth_submit {
  min-height: 28px;
  padding: 4px 12px;
}
.container_workspace_sftp_host_quicklist {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 4px;
}
[class*='container_workspace_sftp_host_quickbtn'] {
  justify-content: flex-start;
  text-align: left;
  min-height: 30px;
  padding: 6px 10px;
  font-size: 11px;
}
.container_workspace_sftp_error_box {
  margin: 10px;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--color-error-soft);
  border: 1px solid rgba(224, 106, 100, 0.35);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.container_workspace_sftp_error_text {
  font-size: 11px;
  color: var(--color-error);
}
.container_workspace_sftp_error_retry {
  min-height: 24px;
  padding: 3px 8px;
  font-size: 11px;
}
.container_workspace_sftp_drop_overlay {
  position: absolute;
  inset: 8px;
  z-index: 6;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 8px;
  border: 2px dashed var(--color-accent-secondary);
  background: color-mix(in srgb, var(--color-surface-1) 88%, transparent);
  color: var(--color-accent-secondary);
  pointer-events: none;
}
.container_workspace_sftp_drop_text {
  font-size: 12px;
  font-weight: 600;
}
.container_workspace_sftp_context_menu {
  position: absolute;
  z-index: var(--z-dropdown);
  width: 180px;
  padding: 5px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-radius: 8px;
  background: var(--color-surface-2);
  border: 1px solid var(--color-accent-primary-ring);
  box-shadow: var(--shadow-3d-dialog);
  > button {
    justify-content: flex-start;
    min-height: 26px;
    padding: 4px 8px;
    font-size: 11px;
  }
}
.container_workspace_sftp_mkdir_backdrop,
.container_workspace_sftp_rename_backdrop,
.container_workspace_sftp_chmod_backdrop,
.container_workspace_sftp_delete_backdrop,
.container_workspace_sftp_conflict_backdrop {
  position: absolute;
  inset: 0;
  z-index: var(--z-modal);
  display: grid;
  place-items: center;
  padding: 14px;
  background: rgba(6, 9, 8, 0.72);
  backdrop-filter: blur(4px);
}
.container_workspace_sftp_mkdir_card,
.container_workspace_sftp_rename_card,
.container_workspace_sftp_chmod_card,
.container_workspace_sftp_delete_card,
.container_workspace_sftp_conflict_card {
  width: 100%;
  max-width: 320px;
  padding: 14px;
  border-radius: 8px;
  background: var(--color-surface-2);
  border: 1px solid var(--color-accent-primary-ring);
  box-shadow: var(--shadow-3d-dialog);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.container_workspace_sftp_mkdir_title,
.container_workspace_sftp_rename_title,
.container_workspace_sftp_chmod_title,
.container_workspace_sftp_delete_title,
.container_workspace_sftp_conflict_title {
  font-size: 13px;
  color: var(--color-text-primary);
}
.container_workspace_sftp_delete_desc,
.container_workspace_sftp_conflict_desc {
  margin: 0;
  font-size: 11px;
  color: var(--color-text-secondary);
  line-height: 1.5;
}
.container_workspace_sftp_mkdir_input,
.container_workspace_sftp_rename_input,
.container_workspace_sftp_chmod_input {
  padding: 6px 8px;
  font-family: var(--font-mono);
  font-size: 12px;
}
.container_workspace_sftp_chmod_grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
[class*='container_workspace_sftp_chmod_cell'] {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--color-text-secondary);
}
.container_workspace_sftp_delete_list {
  margin: 0;
  padding: 6px 10px;
  max-height: 120px;
  overflow: auto;
  list-style: none;
  border-radius: 5px;
  background: var(--color-app-bg);
  border: 1px solid var(--color-border);
  font-family: var(--font-mono);
  font-size: 11px;
}
.container_workspace_sftp_conflict_check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--color-text-secondary);
}
.container_workspace_sftp_mkdir_actions,
.container_workspace_sftp_rename_actions,
.container_workspace_sftp_chmod_actions,
.container_workspace_sftp_delete_actions,
.container_workspace_sftp_conflict_actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  > button {
    min-height: 28px;
    padding: 4px 10px;
    font-size: 11px;
  }
}
</style>
