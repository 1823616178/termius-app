<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Edit3,
  Eye,
  EyeOff,
  File as FileIcon,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Home,
  Link2,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  RotateCw,
  Search,
  Settings,
  Shield,
  Star,
  Trash2,
  Upload,
  X,
  Zap
} from '@lucide/vue'
import { instanceClass, safeInstanceToken } from '../../../shared/classes'
import type { Host, HostInput } from '../../../shared/contracts'
import {
  describeFileEndpoint,
  type FileConnectSource,
  type FileProfile,
  type FileProfileInput,
  type FileSecretsInput
} from '../../../shared/files'
import {
  formatBytes,
  formatOctalMode,
  formatSpeed,
  remoteBreadcrumbs,
  type SftpEntry,
  type SftpSortField
} from '../../../shared/sftp'
import FileProfileEditor from '../components/FileProfileEditor.vue'
import OrbitCheckbox from '../components/OrbitCheckbox.vue'
import { markHostUsed, recentHostIds, sortHostsByRecency } from '../services/host-recency'
import { t } from '../services/i18n'
import {
  activeFileTab,
  activeFileTabId,
  activeFilesTransferCount,
  cancelFileTransfer,
  chmodRemoteEntry,
  clearFinishedFileTransfers,
  closeFileTab,
  createRemoteDirectory,
  deleteRemoteEntries,
  deleteRemoteEntry,
  downloadEntriesFromActiveTab,
  fileTabs,
  fileTransfers,
  filesConflictPrompt,
  filesFilter,
  filesSecretPrompt,
  filesShowHidden,
  filesSortAsc,
  filesSortBy,
  findSavedFileProfile,
  findSavedSshHost,
  goHomeDirectory,
  goParentDirectory,
  initFilesWorkspaceListeners,
  openAdhocFileTab,
  openFileProfileTab,
  openSftpHostTab,
  reconnectFileTab,
  refreshFileDirectory,
  renameRemoteEntry,
  retryFileTransfer,
  uploadLocalPathsToActiveTab,
  visibleFileEntries,
  type FileWorkspaceTransfer
} from '../services/files-workspace'
import {
  bootstrap,
  fileProfiles,
  hosts,
  notify,
  openSettingsDomain,
  page,
  protocolSettings,
  removeFileProfile,
  saveFileProfile,
  windowInstance
} from '../stores/workbench'

const tokenCache = new Map<string, string>()
function cachedToken(raw: string): string {
  let tok = tokenCache.get(raw)
  if (tok !== undefined) return tok
  if (tokenCache.size > 4000) tokenCache.clear()
  tok = safeInstanceToken(raw)
  tokenCache.set(raw, tok)
  return tok
}
const c = (base: string, token: string) => instanceClass(base, windowInstance(cachedToken(token)))

const mtimeFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
})

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

const sidebarCollapsed = ref(false)
const inventoryQuery = ref('')
const favOnly = ref(false)
const pathInput = ref('')
const dragActive = ref(false)
const dragDepth = ref(0)
const actionError = ref('')
const queueExpanded = ref(true)
const conflictApplyAll = ref(false)

// Selection & Context menu
const browserBodyEl = ref<HTMLElement>()
const tableScrollEl = ref<HTMLElement>()
const selectedPaths = ref<Set<string>>(new Set())
const lastSelectedPath = ref('')
const contextMenu = ref<{ entry: SftpEntry; x: number; y: number } | null>(null)

// Lightweight virtual windowing for large directories (>150 items)
const VIRTUAL_THRESHOLD = 150
const VIRTUAL_ROW_HEIGHT = 40
const VIRTUAL_OVERSCAN = 12
const tableScrollTop = ref(0)
const tableViewportHeight = ref(560)

// File profile editor state
const editorOpen = ref(false)
const editorMode = ref<'create' | 'edit' | 'quick'>('create')
const editingProfile = ref<FileProfile | undefined>()
const editorBusy = ref(false)
const editorError = ref('')

// Inline secret prompt form
const secretForm = reactive({
  password: '',
  token: '',
  secretAccessKey: '',
  sessionToken: ''
})
const secretInputEl = ref<HTMLInputElement>()
const modalInputEl = ref<HTMLInputElement>()

// Mini modal dialogs
const modal = ref<
  | null
  | { kind: 'mkdir'; value: string }
  | { kind: 'rename'; entry: SftpEntry; value: string }
  | { kind: 'chmod'; entry: SftpEntry; value: string }
  | { kind: 'deleteFile'; entry: SftpEntry }
  | { kind: 'deleteBatch'; entries: SftpEntry[] }
  | { kind: 'deleteProfile'; profile: FileProfile }
>(null)

const filteredFileProfiles = computed(() => {
  const q = inventoryQuery.value.trim().toLowerCase()
  return fileProfiles.value.filter((item) => {
    if (favOnly.value && !item.favorite) return false
    if (!q) return true
    return (
      item.name.toLowerCase().includes(q) ||
      item.protocol.toLowerCase().includes(q) ||
      describeFileEndpoint(item).toLowerCase().includes(q)
    )
  })
})

const filteredSshHosts = computed(() => {
  const q = inventoryQuery.value.trim().toLowerCase()
  return sortHostsByRecency(
    hosts.value.filter((item) => {
      if (favOnly.value && !item.favorite) return false
      if (!q) return true
      return (
        item.name.toLowerCase().includes(q) ||
        item.address.toLowerCase().includes(q) ||
        item.username.toLowerCase().includes(q)
      )
    }),
    recentHostIds.value
  )
})

const breadcrumbs = computed(() =>
  activeFileTab.value ? remoteBreadcrumbs(activeFileTab.value.currentPath) : []
)

const tableColCount = computed(() => (activeFileTab.value?.capabilities.posixMetadata ? 6 : 5))

const selectedEntries = computed(() =>
  visibleFileEntries.value.filter((entry) => selectedPaths.value.has(entry.path))
)

const allVisibleSelected = computed(
  () =>
    visibleFileEntries.value.length > 0 && selectedEntries.value.length === visibleFileEntries.value.length
)
const someVisibleSelected = computed(() => selectedEntries.value.length > 0)

const virtualEnabled = computed(() => visibleFileEntries.value.length > VIRTUAL_THRESHOLD)

const virtualWindow = computed(() => {
  const entries = visibleFileEntries.value
  if (!virtualEnabled.value) {
    return { items: entries, topHeight: 0, bottomHeight: 0 }
  }
  const total = entries.length
  const visibleCount = Math.ceil(tableViewportHeight.value / VIRTUAL_ROW_HEIGHT) + VIRTUAL_OVERSCAN * 2
  const firstVisible = Math.floor(tableScrollTop.value / VIRTUAL_ROW_HEIGHT)
  const start = Math.max(0, Math.min(total - visibleCount, firstVisible - VIRTUAL_OVERSCAN))
  const end = Math.min(total, start + visibleCount)
  return {
    items: entries.slice(start, end),
    topHeight: start * VIRTUAL_ROW_HEIGHT,
    bottomHeight: Math.max(0, (total - end) * VIRTUAL_ROW_HEIGHT)
  }
})

function onTableScroll(): void {
  const el = tableScrollEl.value
  if (!el) return
  tableScrollTop.value = el.scrollTop
  if (el.clientHeight > 0) tableViewportHeight.value = el.clientHeight
}

watch(tableScrollEl, (el, _, onCleanup) => {
  if (!el) return
  onTableScroll()
  const observer = new ResizeObserver(onTableScroll)
  observer.observe(el)
  onCleanup(() => observer.disconnect())
})

watch(
  () => [activeFileTabId.value, activeFileTab.value?.currentPath] as const,
  () => {
    pathInput.value = ''
    actionError.value = ''
    selectedPaths.value = new Set()
    lastSelectedPath.value = ''
    contextMenu.value = null
    tableScrollTop.value = 0
    if (tableScrollEl.value) tableScrollEl.value.scrollTop = 0
  }
)

watch(filesConflictPrompt, () => {
  conflictApplyAll.value = false
})

watch(modal, async (next) => {
  if (!next) return
  if (next.kind === 'mkdir' || next.kind === 'rename' || next.kind === 'chmod') {
    await nextTick()
    modalInputEl.value?.focus()
    if (next.kind === 'rename' || next.kind === 'chmod') {
      modalInputEl.value?.select()
    }
  }
})

watch(filesSecretPrompt, async (next) => {
  if (!next) return
  await nextTick()
  secretInputEl.value?.focus()
})

function onWindowKeydown(event: KeyboardEvent): void {
  if (page.value !== 'files' || event.key !== 'Escape') return
  if (contextMenu.value) {
    contextMenu.value = null
    event.preventDefault()
    return
  }
  if (filesConflictPrompt.value) {
    filesConflictPrompt.value.resolve({ decision: 'cancel', applyAll: true })
    event.preventDefault()
    return
  }
  if (modal.value) {
    modal.value = null
    event.preventDefault()
    return
  }
  if (filesSecretPrompt.value) {
    cancelSecretPrompt()
    event.preventDefault()
  }
}

onMounted(() => {
  initFilesWorkspaceListeners()
  window.addEventListener('keydown', onWindowKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onWindowKeydown)
})

function isDirEntry(entry: SftpEntry): boolean {
  return entry.kind === 'directory' || entry.targetKind === 'directory'
}

function openCreateEditor(mode: 'create' | 'quick', profile?: FileProfile) {
  editorMode.value = mode
  editingProfile.value = profile
  editorError.value = ''
  editorOpen.value = true
}

function openEditEditor(profile: FileProfile) {
  editorMode.value = 'edit'
  editingProfile.value = profile
  editorError.value = ''
  editorOpen.value = true
}

async function handleSaveProfile(input: FileProfileInput, connectAfter: boolean) {
  editorBusy.value = true
  editorError.value = ''
  try {
    const updated = await saveFileProfile(input)
    editorOpen.value = false
    if (connectAfter) {
      const target = findSavedFileProfile(updated, input.id, input.name)
      if (target) {
        const inlineSecrets = !input.saveSecrets && input.secrets ? input.secrets : undefined
        await openFileProfileTab(target, inlineSecrets)
      }
    }
  } catch (error) {
    editorError.value = error instanceof Error ? error.message : String(error)
  } finally {
    editorBusy.value = false
  }
}

async function handleAdhocConnect(source: FileConnectSource & { kind: 'adhoc' }) {
  editorOpen.value = false
  await openAdhocFileTab(source)
}

async function handleSaveSshAndConnect(input: HostInput) {
  editorBusy.value = true
  editorError.value = ''
  try {
    const savePayload: HostInput = input.savePassword ? input : { ...input, password: '' }
    const savedList = await window.orbit.hosts.save(savePayload)
    const created = findSavedSshHost(savedList, input.id, input.name)
    if (created && !input.id) {
      markHostUsed(created.id)
    }
    hosts.value = savedList
    editorOpen.value = false
    if (created) {
      await openSftpHostTab(created, input.savePassword ? undefined : input.password)
    }
  } catch (error) {
    editorError.value = error instanceof Error ? error.message : String(error)
  } finally {
    editorBusy.value = false
  }
}

function clearSecretForm() {
  secretForm.password = ''
  secretForm.token = ''
  secretForm.secretAccessKey = ''
  secretForm.sessionToken = ''
}

async function submitSecretPrompt() {
  const prompt = filesSecretPrompt.value
  if (!prompt) return
  if (prompt.kind === 'ssh-host' && prompt.host) {
    const pw = secretForm.password
    clearSecretForm()
    await openSftpHostTab(prompt.host, pw)
    return
  }
  if (prompt.kind === 'file-profile' && prompt.profile) {
    const creds: FileSecretsInput = {}
    if (prompt.protocol === 's3') {
      creds.secretAccessKey = secretForm.secretAccessKey
      if (secretForm.sessionToken) creds.sessionToken = secretForm.sessionToken
    } else if (prompt.protocol === 'webdav' && prompt.profile.options.webdavAuth === 'token') {
      creds.token = secretForm.token
    } else {
      creds.password = secretForm.password
    }
    clearSecretForm()
    await openFileProfileTab(prompt.profile, creds)
  }
}

function cancelSecretPrompt() {
  clearSecretForm()
  filesSecretPrompt.value = null
}

function formatMtime(epochSec: number): string {
  if (!epochSec) return '—'
  const date = new Date(epochSec * 1000)
  return Number.isNaN(date.getTime()) ? '—' : mtimeFormatter.format(date)
}

function toggleSort(field: SftpSortField) {
  if (filesSortBy.value === field) filesSortAsc.value = !filesSortAsc.value
  else {
    filesSortBy.value = field
    filesSortAsc.value = field === 'name'
  }
}

function sortArrow(field: SftpSortField): string {
  if (filesSortBy.value !== field) return ''
  return filesSortAsc.value ? ' ↑' : ' ↓'
}

function onRowClick(entry: SftpEntry, event: MouseEvent) {
  contextMenu.value = null
  const next = new Set(selectedPaths.value)
  if (event.shiftKey && lastSelectedPath.value) {
    const entries = visibleFileEntries.value
    const fromIdx = entries.findIndex((e) => e.path === lastSelectedPath.value)
    const toIdx = entries.findIndex((e) => e.path === entry.path)
    if (fromIdx >= 0 && toIdx >= 0) {
      if (!event.ctrlKey && !event.metaKey) next.clear()
      const start = Math.min(fromIdx, toIdx)
      const end = Math.max(fromIdx, toIdx)
      for (let i = start; i <= end; i++) {
        next.add(entries[i]!.path)
      }
      selectedPaths.value = next
      return
    }
  }
  if (event.ctrlKey || event.metaKey) {
    if (next.has(entry.path)) next.delete(entry.path)
    else next.add(entry.path)
  } else {
    next.clear()
    next.add(entry.path)
  }
  lastSelectedPath.value = entry.path
  selectedPaths.value = next
}

function toggleRowCheckbox(entry: SftpEntry) {
  contextMenu.value = null
  const next = new Set(selectedPaths.value)
  if (next.has(entry.path)) next.delete(entry.path)
  else next.add(entry.path)
  lastSelectedPath.value = entry.path
  selectedPaths.value = next
}

function toggleSelectAll() {
  if (allVisibleSelected.value) {
    selectedPaths.value = new Set()
    lastSelectedPath.value = ''
  } else {
    selectedPaths.value = new Set(visibleFileEntries.value.map((e) => e.path))
    lastSelectedPath.value = visibleFileEntries.value[0]?.path ?? ''
  }
}

function onTableKeydown(event: KeyboardEvent) {
  if (!activeFileTab.value || activeFileTab.value.state !== 'running') return
  const target = event.target as HTMLElement | null
  if (
    target &&
    (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.getAttribute('role') === 'checkbox')
  )
    return

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
    event.preventDefault()
    selectedPaths.value = new Set(visibleFileEntries.value.map((e) => e.path))
    return
  }
  if (event.key === 'Backspace') {
    event.preventDefault()
    void goParentDirectory()
    return
  }
  const chosen = selectedEntries.value
  if (event.key === 'Enter' && chosen.length === 1 && target?.tagName !== 'BUTTON') {
    event.preventDefault()
    void handleEntryDoubleClick(chosen[0]!)
    return
  }
  if (event.key === 'F2' && chosen.length === 1) {
    event.preventDefault()
    modal.value = { kind: 'rename', entry: chosen[0]!, value: chosen[0]!.name }
    return
  }
  if (event.key === 'Delete' && chosen.length > 0) {
    event.preventDefault()
    void handleBatchDeleteTrigger(chosen)
  }
}

function openRowContextMenu(entry: SftpEntry, event: MouseEvent) {
  if (!selectedPaths.value.has(entry.path)) {
    selectedPaths.value = new Set([entry.path])
    lastSelectedPath.value = entry.path
  }
  const container = browserBodyEl.value
  if (!container) return
  const rect = container.getBoundingClientRect()
  const x = Math.min(Math.max(8, event.clientX - rect.left), Math.max(8, rect.width - 188))
  const y = Math.min(Math.max(48, event.clientY - rect.top), Math.max(48, rect.height - 210))
  contextMenu.value = { entry, x, y }
}

function copyRemotePath(path: string) {
  contextMenu.value = null
  void window.orbit.clipboard.writeText(path).then(
    () => notify(t('filesPage.copiedPath', { path })),
    () => notify(t('sftp.clipboardFailed'))
  )
}

async function handleEntryDoubleClick(entry: SftpEntry) {
  if (!activeFileTab.value) return
  if (isDirEntry(entry)) {
    await refreshFileDirectory(activeFileTab.value.id, entry.path)
  } else {
    await downloadEntriesFromActiveTab([entry])
  }
}

async function navigateToInputPath() {
  if (!activeFileTab.value) return
  const target = pathInput.value.trim() || activeFileTab.value.currentPath
  await refreshFileDirectory(activeFileTab.value.id, target)
}

async function handleUploadFiles() {
  const paths = await window.orbit.sftp.pickUploadFiles()
  if (paths.length) await uploadLocalPathsToActiveTab(paths)
}

async function handleUploadDirs() {
  const paths = await window.orbit.sftp.pickUploadDirs()
  if (paths.length) await uploadLocalPathsToActiveTab(paths)
}

function hasFileDragPayload(dataTransfer: DataTransfer | null | undefined): boolean {
  if (!dataTransfer) return false
  return dataTransfer.types.includes('Files') || dataTransfer.types.includes('text/uri-list')
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

function onDragEnter(event: DragEvent) {
  if (!activeFileTab.value || activeFileTab.value.state !== 'running') return
  if (!hasFileDragPayload(event.dataTransfer)) return
  dragDepth.value += 1
  dragActive.value = true
}

function onDragOver(event: DragEvent) {
  const accepts =
    Boolean(activeFileTab.value && activeFileTab.value.state === 'running') &&
    hasFileDragPayload(event.dataTransfer)
  dragActive.value = accepts
  if (accepts && event.dataTransfer) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }
}

function onDragLeave() {
  dragDepth.value = Math.max(0, dragDepth.value - 1)
  if (dragDepth.value === 0) dragActive.value = false
}

async function handleDrop(event: DragEvent) {
  dragDepth.value = 0
  dragActive.value = false
  if (!activeFileTab.value || activeFileTab.value.state !== 'running' || !event.dataTransfer) return
  const droppedFiles = extractDroppedFiles(event.dataTransfer)
  const paths = window.orbit.sftp.getDroppedPaths(droppedFiles)
  if (!paths.length) {
    if (droppedFiles.length > 0 || event.dataTransfer.types.includes('text/uri-list')) {
      notify(t('sftp.dropNoLocalPaths'))
    }
    return
  }
  await uploadLocalPathsToActiveTab(paths)
}

async function handleDeleteTrigger(entry: SftpEntry) {
  contextMenu.value = null
  if (!protocolSettings.value.files.confirmDelete) {
    try {
      await deleteRemoteEntry(entry)
      selectedPaths.value = new Set()
    } catch (error) {
      actionError.value = error instanceof Error ? error.message : String(error)
    }
    return
  }
  modal.value = { kind: 'deleteFile', entry }
}

async function handleBatchDeleteTrigger(entries: SftpEntry[]) {
  contextMenu.value = null
  if (!entries.length) return
  if (entries.length === 1) {
    await handleDeleteTrigger(entries[0]!)
    return
  }
  if (!protocolSettings.value.files.confirmDelete) {
    try {
      await deleteRemoteEntries(entries)
      selectedPaths.value = new Set()
    } catch (error) {
      actionError.value = error instanceof Error ? error.message : String(error)
    }
    return
  }
  modal.value = { kind: 'deleteBatch', entries }
}

function chmodBit(shift: number): boolean {
  if (modal.value?.kind !== 'chmod') return false
  const parsed = Number.parseInt(modal.value.value, 8)
  if (!Number.isFinite(parsed)) return false
  return Boolean((parsed >> shift) & 1)
}

function toggleChmodBit(shift: number) {
  if (modal.value?.kind !== 'chmod') return
  const current = Number.parseInt(modal.value.value, 8)
  const base = Number.isFinite(current) ? current : 0o644
  modal.value.value = formatOctalMode(base ^ (1 << shift))
}

async function confirmModal() {
  const current = modal.value
  if (!current) return
  actionError.value = ''
  modal.value = null
  try {
    if (current.kind === 'mkdir') {
      await createRemoteDirectory(current.value)
    } else if (current.kind === 'rename') {
      await renameRemoteEntry(current.entry, current.value)
    } else if (current.kind === 'chmod') {
      const parsed = Number.parseInt(current.value.trim(), 8)
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 0o7777) {
        throw new Error(t('filesPage.invalidOctalMode'))
      }
      await chmodRemoteEntry(current.entry, parsed)
    } else if (current.kind === 'deleteFile') {
      await deleteRemoteEntry(current.entry)
      selectedPaths.value = new Set()
    } else if (current.kind === 'deleteBatch') {
      await deleteRemoteEntries(current.entries)
      selectedPaths.value = new Set()
    } else if (current.kind === 'deleteProfile') {
      await removeFileProfile(current.profile.id)
    }
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : String(error)
  }
}

function transferPercent(item: FileWorkspaceTransfer): number {
  if (item.status === 'completed') return 100
  if (item.totalBytes <= 0) return item.status === 'running' ? 12 : 0
  return Math.min(100, Math.round((item.transferredBytes / item.totalBytes) * 100))
}

function formatTransferStatus(item: FileWorkspaceTransfer): string {
  if (item.error) return item.error
  if (item.status === 'queued') return t('filesPage.statusQueued')
  if (item.status === 'running') return t('filesPage.statusRunning')
  if (item.status === 'completed') return t('filesPage.statusCompleted')
  if (item.status === 'cancelled') return t('filesPage.statusCancelled')
  return t('filesPage.statusFailed')
}

function revealTransferLocal(localPath: string) {
  void window.orbit.sftp.revealLocal(localPath)
}

function openExternalSshTrustHint(host: Host) {
  void openSftpHostTab(host)
}
</script>

<template>
  <section class="container_files_page_root_base" data-testid="files-page" @click="contextMenu = null">
    <!-- Left Server Inventory Sidebar -->
    <aside v-show="!sidebarCollapsed" class="container_files_inventory_sidebar_base">
      <div class="container_files_inventory_header_base">
        <span class="container_files_inventory_header_eyebrow">{{ t('filesPage.eyebrow') }}</span>
        <h2 class="container_files_inventory_header_title">{{ t('filesPage.title') }}</h2>
        <div class="container_files_inventory_header_actions">
          <button
            class="container_files_inventory_action_add"
            type="button"
            data-primary="true"
            data-testid="files-add-server-btn"
            @click="openCreateEditor('create')"
          >
            <Plus :size="14" />
            {{ t('filesPage.addServer') }}
          </button>
          <button
            class="container_files_inventory_action_quick"
            type="button"
            data-testid="files-quick-connect-btn"
            @click="openCreateEditor('quick')"
          >
            <Zap :size="14" />
            {{ t('filesPage.quickConnect') }}
          </button>
        </div>
        <div class="container_files_inventory_search_row">
          <Search :size="13" />
          <input
            v-model="inventoryQuery"
            class="container_files_inventory_search_input"
            type="search"
            :placeholder="t('filesPage.searchPlaceholder')"
          />
          <button
            class="container_files_inventory_fav_toggle"
            type="button"
            :aria-pressed="favOnly"
            :title="t('filesPage.favoritesOnly')"
            @click="favOnly = !favOnly"
          >
            <Star :size="13" />
          </button>
        </div>
      </div>

      <div class="container_files_inventory_scroll_base">
        <!-- Saved FTP / FTPS / WebDAV / S3 Profiles -->
        <div class="container_files_group_files_section">
          <span class="container_files_group_files_title">
            {{ t('filesPage.savedFilesGroup', { count: filteredFileProfiles.length }) }}
          </span>
          <p v-if="!filteredFileProfiles.length" class="container_files_group_files_empty">
            {{ t('filesPage.noSavedFiles') }}
          </p>
          <div
            v-for="profile in filteredFileProfiles"
            :key="profile.id"
            :class="c('container_files_card_profile_base', profile.id)"
            :data-testid="`file-profile-card-${profile.id}`"
          >
            <div :class="c('container_files_card_profile_top', profile.id)">
              <span
                :class="c('container_files_card_profile_badge', profile.id)"
                :data-proto="profile.protocol"
              >
                {{ profile.protocol.toUpperCase() }}
              </span>
              <strong :class="c('container_files_card_profile_name', profile.id)">{{ profile.name }}</strong>
              <Lock v-if="profile.hasSecrets" :size="11" />
            </div>
            <span :class="c('container_files_card_profile_endpoint', profile.id)">
              {{ describeFileEndpoint(profile) }}
            </span>
            <div :class="c('container_files_card_profile_actions', profile.id)">
              <button
                :class="c('container_files_card_profile_connect', profile.id)"
                type="button"
                @click="openFileProfileTab(profile)"
              >
                <Link2 :size="12" />
                {{ t('filesPage.connectBtn') }}
              </button>
              <button
                :class="c('container_files_card_profile_edit', profile.id)"
                type="button"
                :aria-label="t('filesPage.editBtn')"
                @click="openEditEditor(profile)"
              >
                <Edit3 :size="12" />
              </button>
              <button
                :class="c('container_files_card_profile_del', profile.id)"
                type="button"
                :aria-label="t('filesPage.deleteBtn')"
                @click="modal = { kind: 'deleteProfile', profile }"
              >
                <Trash2 :size="12" />
              </button>
            </div>
          </div>
        </div>

        <!-- Existing SSH Hosts for Direct SFTP -->
        <div class="container_files_group_ssh_section">
          <span class="container_files_group_ssh_title">
            {{ t('filesPage.sshHostsGroup', { count: filteredSshHosts.length }) }}
          </span>
          <p v-if="!filteredSshHosts.length" class="container_files_group_ssh_empty">
            {{ t('filesPage.noSshHosts') }}
          </p>
          <div
            v-for="host in filteredSshHosts"
            :key="host.id"
            :class="c('container_files_card_ssh_base', host.id)"
            :data-testid="`ssh-sftp-card-${host.id}`"
          >
            <div :class="c('container_files_card_ssh_top', host.id)">
              <span :class="c('container_files_card_ssh_badge', host.id)">SFTP</span>
              <strong :class="c('container_files_card_ssh_name', host.id)">{{ host.name }}</strong>
            </div>
            <span :class="c('container_files_card_ssh_endpoint', host.id)">
              {{ host.username }}@{{ host.address }}:{{ host.port }}
            </span>
            <div :class="c('container_files_card_ssh_actions', host.id)">
              <button
                :class="c('container_files_card_ssh_connect', host.id)"
                type="button"
                @click="openExternalSshTrustHint(host)"
              >
                <Link2 :size="12" />
                {{ t('filesPage.connectBtn') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </aside>

    <!-- Main Right File Explorer Stage -->
    <div class="container_files_stage_body_base">
      <!-- Top Stage Header with Sidebar Toggle, Session Tabs & Settings -->
      <div class="container_files_stage_topbar_base">
        <button
          class="container_files_stage_sidebar_toggle"
          type="button"
          :title="t('filesPage.toggleSidebar')"
          :aria-label="t('filesPage.toggleSidebar')"
          @click="sidebarCollapsed = !sidebarCollapsed"
        >
          <PanelLeftOpen v-if="sidebarCollapsed" :size="14" />
          <PanelLeftClose v-else :size="14" />
        </button>

        <div v-if="fileTabs.length" class="container_files_tabs_bar_base" role="tablist">
          <div
            v-for="tab in fileTabs"
            :key="tab.id"
            :class="c('container_files_tabs_item_base', tab.id)"
            role="tab"
            tabindex="0"
            :aria-selected="activeFileTabId === tab.id"
            @click="activeFileTabId = tab.id"
            @keydown.enter="activeFileTabId = tab.id"
            @keydown.space.prevent="activeFileTabId = tab.id"
          >
            <span :class="c('container_files_tabs_item_dot', tab.id)" :data-state="tab.state" />
            <span :class="c('container_files_tabs_item_proto', tab.id)">
              {{ tab.protocol.toUpperCase() }}
            </span>
            <span :class="c('container_files_tabs_item_title', tab.id)">{{ tab.title }}</span>
            <button
              :class="c('container_files_tabs_item_close', tab.id)"
              type="button"
              :aria-label="t('filesPage.tabClose', { name: tab.title })"
              @click.stop="closeFileTab(tab.id)"
            >
              <X :size="12" />
            </button>
          </div>
        </div>

        <button
          class="container_files_stage_settings_btn"
          type="button"
          :title="t('filesPage.openSettings')"
          @click="openSettingsDomain('files')"
        >
          <Settings :size="13" />
          {{ t('filesPage.openSettings') }}
        </button>
      </div>

      <!-- Empty Stage -->
      <div v-if="!activeFileTab" class="container_files_empty_stage_base">
        <HardDrive :size="36" />
        <h3 class="container_files_empty_stage_title">{{ t('filesPage.emptyStageTitle') }}</h3>
        <p class="container_files_empty_stage_desc">{{ t('filesPage.emptyStageDesc') }}</p>
        <div class="container_files_empty_stage_buttons">
          <button
            class="container_files_empty_stage_addbtn"
            type="button"
            data-primary="true"
            @click="openCreateEditor('create')"
          >
            <Plus :size="14" />
            {{ t('filesPage.openAddBtn') }}
          </button>
          <button
            class="container_files_empty_stage_quickbtn"
            type="button"
            @click="openCreateEditor('quick')"
          >
            <Zap :size="14" />
            {{ t('filesPage.openQuickBtn') }}
          </button>
        </div>
      </div>

      <!-- Active File Session -->
      <div
        v-else
        ref="browserBodyEl"
        class="container_files_browser_body_base"
        :data-drag="dragActive"
        @dragenter.prevent="onDragEnter"
        @dragover="onDragOver"
        @dragleave.prevent="onDragLeave"
        @drop.prevent.stop="handleDrop"
      >
        <div class="container_files_toolbar_top_row">
          <div class="container_files_toolbar_crumbs_base">
            <button
              class="container_files_toolbar_up_btn"
              type="button"
              :title="t('filesPage.upBtn')"
              :aria-label="t('filesPage.upBtn')"
              :disabled="activeFileTab.state !== 'running'"
              @click="goParentDirectory"
            >
              <ArrowUp :size="14" />
            </button>
            <button
              class="container_files_toolbar_home_btn"
              type="button"
              :title="t('filesPage.homeBtn')"
              :aria-label="t('filesPage.homeBtn')"
              :disabled="activeFileTab.state !== 'running'"
              @click="goHomeDirectory"
            >
              <Home :size="14" />
            </button>
            <div class="container_files_crumbs_trail_row">
              <button
                v-for="crumb in breadcrumbs"
                :key="crumb.path"
                :class="c('container_files_crumbs_item_btn', crumb.path)"
                type="button"
                :disabled="activeFileTab.state !== 'running'"
                @click="refreshFileDirectory(activeFileTab.id, crumb.path)"
              >
                {{ crumb.label }}
              </button>
            </div>
          </div>
          <form class="container_files_toolbar_jump_form" @submit.prevent="navigateToInputPath">
            <input
              v-model="pathInput"
              class="container_files_toolbar_jump_input"
              type="text"
              :placeholder="activeFileTab.currentPath || t('filesPage.pathPlaceholder')"
            />
            <button
              class="container_files_toolbar_jump_btn"
              type="submit"
              :disabled="activeFileTab.state !== 'running'"
            >
              {{ t('filesPage.goPath') }}
            </button>
          </form>
        </div>

        <div class="container_files_toolbar_actions_row">
          <button
            class="container_files_toolbar_refresh_btn"
            type="button"
            :disabled="activeFileTab.state !== 'running' || activeFileTab.loading"
            @click="refreshFileDirectory(activeFileTab.id, activeFileTab.currentPath)"
          >
            <RefreshCw :size="13" />
            {{ t('filesPage.refreshBtn') }}
          </button>
          <button
            class="container_files_toolbar_mkdir_btn"
            type="button"
            :disabled="activeFileTab.state !== 'running'"
            @click="modal = { kind: 'mkdir', value: '' }"
          >
            <FolderPlus :size="13" />
            {{ t('filesPage.mkdirBtn') }}
          </button>
          <button
            class="container_files_toolbar_upfiles_btn"
            type="button"
            :disabled="activeFileTab.state !== 'running'"
            @click="handleUploadFiles"
          >
            <Upload :size="13" />
            {{ t('filesPage.uploadFilesBtn') }}
          </button>
          <button
            class="container_files_toolbar_updirs_btn"
            type="button"
            :disabled="activeFileTab.state !== 'running'"
            @click="handleUploadDirs"
          >
            <FolderOpen :size="13" />
            {{ t('filesPage.uploadDirsBtn') }}
          </button>
          <button
            class="container_files_toolbar_hidden_btn"
            type="button"
            :aria-pressed="filesShowHidden"
            @click="filesShowHidden = !filesShowHidden"
          >
            <Eye v-if="filesShowHidden" :size="13" />
            <EyeOff v-else :size="13" />
            {{ t('filesPage.hiddenToggle') }}
          </button>
          <span class="container_files_toolbar_count_badge">
            {{ t('filesPage.itemCount', { count: visibleFileEntries.length }) }}
          </span>
          <input
            v-model="filesFilter"
            class="container_files_toolbar_filter_input"
            type="search"
            :placeholder="t('filesPage.filterEntries')"
          />
        </div>

        <p v-if="!activeFileTab.capabilities.realDirectories" class="container_files_s3_notice_banner">
          {{ t('filesPage.s3VirtualDirNote') }}
        </p>

        <div v-if="activeFileTab.error || actionError" class="container_files_error_banner_row" role="alert">
          <p class="container_files_error_banner_text">
            {{ actionError || activeFileTab.error }}
          </p>
          <button
            v-if="
              (activeFileTab.state === 'error' || activeFileTab.state === 'exited') &&
              activeFileTab.sourceKind !== 'adhoc'
            "
            class="container_files_error_reconn_btn"
            type="button"
            @click="reconnectFileTab(activeFileTab.id)"
          >
            <RotateCw :size="12" />
            {{ t('filesPage.reconnectBtn') }}
          </button>
        </div>

        <div v-if="activeFileTab.state === 'connecting'" class="container_files_state_connecting_box">
          {{ t('filesPage.connectingState', { name: activeFileTab.title }) }}
        </div>

        <div
          v-else-if="activeFileTab.state === 'error' || activeFileTab.state === 'exited'"
          class="container_files_state_offline_box"
        >
          <p class="container_files_state_offline_title">{{ t('filesPage.emptyDisconnected') }}</p>
          <button
            v-if="activeFileTab.sourceKind !== 'adhoc'"
            class="container_files_state_offline_btn"
            type="button"
            data-primary="true"
            @click="reconnectFileTab(activeFileTab.id)"
          >
            <RotateCw :size="13" />
            {{ t('filesPage.reconnectBtn') }}
          </button>
        </div>

        <div
          v-else
          ref="tableScrollEl"
          class="container_files_table_scroll_wrap"
          tabindex="0"
          @scroll.passive="onTableScroll"
          @keydown="onTableKeydown"
        >
          <table
            class="container_files_table_grid_base"
            :style="{ '--files-row-height': `${VIRTUAL_ROW_HEIGHT}px` }"
          >
            <thead class="container_files_table_head_row">
              <tr class="container_files_table_head_tr">
                <th class="container_files_table_th_check">
                  <OrbitCheckbox
                    class="container_files_table_check_all"
                    size="sm"
                    :model-value="allVisibleSelected"
                    :indeterminate="someVisibleSelected && !allVisibleSelected"
                    :aria-label="t('filesPage.selectAll')"
                    instance="files-select-all"
                    @change="toggleSelectAll"
                  />
                </th>
                <th class="container_files_table_th_name">
                  <button
                    class="container_files_table_sort_name"
                    type="button"
                    :data-active="filesSortBy === 'name'"
                    @click="toggleSort('name')"
                  >
                    {{ t('filesPage.colName') }}{{ sortArrow('name') }}
                  </button>
                </th>
                <th class="container_files_table_th_size">
                  <button
                    class="container_files_table_sort_size"
                    type="button"
                    :data-active="filesSortBy === 'size'"
                    @click="toggleSort('size')"
                  >
                    {{ t('filesPage.colSize') }}{{ sortArrow('size') }}
                  </button>
                </th>
                <th class="container_files_table_th_mtime">
                  <button
                    class="container_files_table_sort_mtime"
                    type="button"
                    :data-active="filesSortBy === 'mtime'"
                    @click="toggleSort('mtime')"
                  >
                    {{ t('filesPage.colModified') }}{{ sortArrow('mtime') }}
                  </button>
                </th>
                <th v-if="activeFileTab.capabilities.posixMetadata" class="container_files_table_th_perms">
                  {{ t('filesPage.colPerms') }}
                </th>
                <th class="container_files_table_th_actions">{{ t('filesPage.colActions') }}</th>
              </tr>
            </thead>
            <tbody class="container_files_table_body_rows">
              <tr v-if="!visibleFileEntries.length" class="container_files_table_empty_row">
                <td :colspan="tableColCount" class="container_files_table_empty_cell">
                  {{ filesFilter ? t('filesPage.emptyFilter') : t('filesPage.emptyDir') }}
                </td>
              </tr>
              <tr v-if="virtualWindow.topHeight > 0" class="container_files_table_spacer_top">
                <td
                  :colspan="tableColCount"
                  class="container_files_table_spcell_top"
                  :style="{ height: `${virtualWindow.topHeight}px` }"
                />
              </tr>
              <tr
                v-for="entry in virtualWindow.items"
                :key="entry.path"
                :class="c('container_files_table_entry_row', entry.path)"
                :data-kind="entry.kind"
                :data-selected="selectedPaths.has(entry.path)"
                @click="onRowClick(entry, $event)"
                @dblclick="handleEntryDoubleClick(entry)"
                @contextmenu.prevent.stop="openRowContextMenu(entry, $event)"
              >
                <td :class="c('container_files_table_entry_check', entry.path)" @click.stop>
                  <OrbitCheckbox
                    :class="c('container_files_table_row_checkbox', entry.path)"
                    size="sm"
                    :model-value="selectedPaths.has(entry.path)"
                    :aria-label="entry.name"
                    :instance="`files-row-${entry.path}`"
                    @change="toggleRowCheckbox(entry)"
                  />
                </td>
                <td :class="c('container_files_table_entry_name', entry.path)">
                  <Link2 v-if="entry.kind === 'symlink'" :size="14" />
                  <Folder v-else-if="isDirEntry(entry)" :size="14" />
                  <FileIcon v-else :size="14" />
                  <span :class="c('container_files_table_entry_label', entry.path)">{{ entry.name }}</span>
                  <em v-if="entry.linkTarget" :class="c('container_files_table_entry_link', entry.path)">
                    → {{ entry.linkTarget }}
                  </em>
                </td>
                <td :class="c('container_files_table_entry_size', entry.path)">
                  {{ isDirEntry(entry) ? '—' : formatBytes(entry.size) }}
                </td>
                <td :class="c('container_files_table_entry_mtime', entry.path)">
                  {{ formatMtime(entry.mtime) }}
                </td>
                <td
                  v-if="activeFileTab.capabilities.posixMetadata"
                  :class="c('container_files_table_entry_perms', entry.path)"
                >
                  {{ entry.permissions }}
                </td>
                <td :class="c('container_files_table_entry_actions', entry.path)" @click.stop>
                  <button
                    :class="c('container_files_row_btn_download', entry.path)"
                    type="button"
                    :title="t('filesPage.download')"
                    @click="downloadEntriesFromActiveTab([entry])"
                  >
                    <Download :size="12" />
                  </button>
                  <button
                    :class="c('container_files_row_btn_rename', entry.path)"
                    type="button"
                    :title="t('filesPage.rename')"
                    @click="modal = { kind: 'rename', entry, value: entry.name }"
                  >
                    <Edit3 :size="12" />
                  </button>
                  <button
                    v-if="activeFileTab.capabilities.chmod"
                    :class="c('container_files_row_btn_chmod', entry.path)"
                    type="button"
                    :title="t('filesPage.chmod')"
                    @click="modal = { kind: 'chmod', entry, value: formatOctalMode(entry.mode) }"
                  >
                    {{ formatOctalMode(entry.mode) }}
                  </button>
                  <button
                    :class="c('container_files_row_btn_delete', entry.path)"
                    type="button"
                    :title="t('filesPage.remove')"
                    @click="handleDeleteTrigger(entry)"
                  >
                    <Trash2 :size="12" />
                  </button>
                </td>
              </tr>
              <tr v-if="virtualWindow.bottomHeight > 0" class="container_files_table_spacer_bot">
                <td
                  :colspan="tableColCount"
                  class="container_files_table_spcell_bot"
                  :style="{ height: `${virtualWindow.bottomHeight}px` }"
                />
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Batch Action Bar -->
        <div
          v-if="selectedEntries.length > 0 && activeFileTab.state === 'running'"
          class="container_files_batch_bar_base"
        >
          <span class="container_files_batch_bar_label">
            {{ t('filesPage.batchSelected', { count: selectedEntries.length }) }}
          </span>
          <button
            class="container_files_batch_btn_download"
            type="button"
            @click="downloadEntriesFromActiveTab(selectedEntries)"
          >
            <Download :size="12" />
            {{ t('filesPage.download') }}
          </button>
          <button
            class="container_files_batch_btn_delete"
            type="button"
            @click="handleBatchDeleteTrigger(selectedEntries)"
          >
            <Trash2 :size="12" />
            {{ t('filesPage.remove') }}
          </button>
          <button class="container_files_batch_btn_clear" type="button" @click="selectedPaths = new Set()">
            {{ t('filesPage.clearSelection') }}
          </button>
        </div>

        <!-- Right-click Context Menu -->
        <div
          v-if="contextMenu"
          class="container_files_context_menu_box"
          :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
          role="menu"
          @click.stop
        >
          <button
            class="container_files_cmenu_btn_download"
            type="button"
            @click="
              () => {
                const target = contextMenu!.entry
                contextMenu = null
                void downloadEntriesFromActiveTab([target])
              }
            "
          >
            <Download :size="13" />
            {{ t('filesPage.download') }}
          </button>
          <button
            class="container_files_cmenu_btn_rename"
            type="button"
            @click="
              () => {
                const target = contextMenu!.entry
                contextMenu = null
                modal = { kind: 'rename', entry: target, value: target.name }
              }
            "
          >
            <Edit3 :size="13" />
            {{ t('filesPage.rename') }}
          </button>
          <button
            v-if="activeFileTab.capabilities.chmod"
            class="container_files_cmenu_btn_chmod"
            type="button"
            @click="
              () => {
                const target = contextMenu!.entry
                contextMenu = null
                modal = { kind: 'chmod', entry: target, value: formatOctalMode(target.mode) }
              }
            "
          >
            <Shield :size="13" />
            {{ t('filesPage.chmod') }}
          </button>
          <button
            class="container_files_cmenu_btn_copypath"
            type="button"
            @click="copyRemotePath(contextMenu.entry.path)"
          >
            <Copy :size="13" />
            {{ t('filesPage.copyPath') }}
          </button>
          <button
            class="container_files_cmenu_btn_delete"
            type="button"
            @click="handleDeleteTrigger(contextMenu.entry)"
          >
            <Trash2 :size="13" />
            {{ t('filesPage.remove') }}
          </button>
        </div>

        <div v-if="dragActive" class="container_files_drop_overlay_box">
          {{ t('filesPage.dropHint', { path: activeFileTab.currentPath }) }}
        </div>
      </div>

      <!-- Transfer Queue Panel -->
      <section v-if="fileTransfers.length" class="container_files_queue_panel_base">
        <header class="container_files_queue_header_row">
          <button
            class="container_files_queue_toggle_btn"
            type="button"
            :title="t('filesPage.queueExpand')"
            @click="queueExpanded = !queueExpanded"
          >
            <ChevronDown v-if="queueExpanded" :size="13" />
            <ChevronRight v-else :size="13" />
            <strong class="container_files_queue_header_title">
              {{
                t('filesPage.queueTitle', { active: activeFilesTransferCount, total: fileTransfers.length })
              }}
            </strong>
          </button>
          <button class="container_files_queue_clear_btn" type="button" @click="clearFinishedFileTransfers">
            {{ t('filesPage.clearDone') }}
          </button>
        </header>
        <div v-if="queueExpanded" class="container_files_queue_list_scroll">
          <div
            v-for="item in fileTransfers"
            :key="item.id"
            :class="c('container_files_queue_item_row', item.id)"
            :data-status="item.status"
          >
            <div :class="c('container_files_queue_item_top', item.id)">
              <span :class="c('container_files_queue_item_dir', item.id)">
                {{ item.protocol.toUpperCase() }} · {{ item.direction === 'upload' ? 'UP' : 'DOWN' }}
              </span>
              <span :class="c('container_files_queue_item_name', item.id)" :title="item.remotePath">
                {{ item.name }}
              </span>
              <span :class="c('container_files_queue_item_bytes', item.id)">
                {{ formatBytes(item.transferredBytes) }} / {{ formatBytes(item.totalBytes) }}
                <template v-if="item.status === 'running' && item.speedBps > 0">
                  · {{ formatSpeed(item.speedBps) }}
                </template>
              </span>
              <span :class="c('container_files_queue_item_status', item.id)">
                {{ formatTransferStatus(item) }}
              </span>
              <button
                v-if="item.status === 'running' || item.status === 'queued'"
                :class="c('container_files_queue_item_cancel', item.id)"
                type="button"
                @click="cancelFileTransfer(item)"
              >
                {{ t('filesPage.cancelTransfer') }}
              </button>
              <button
                v-else-if="item.status === 'failed' || item.status === 'cancelled'"
                :class="c('container_files_queue_item_retry', item.id)"
                type="button"
                @click="retryFileTransfer(item)"
              >
                <RotateCw :size="11" />
                {{ t('filesPage.retryTransfer') }}
              </button>
              <button
                v-else-if="item.direction === 'download' && item.status === 'completed'"
                :class="c('container_files_queue_item_reveal', item.id)"
                type="button"
                @click="revealTransferLocal(item.localPath)"
              >
                {{ t('filesPage.revealLocal') }}
              </button>
            </div>
            <div :class="c('container_files_queue_item_track', item.id)">
              <div
                :class="c('container_files_queue_item_bar', item.id)"
                :style="{ width: `${transferPercent(item)}%` }"
              />
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- Profile Editor / Quick Connect Dialog -->
    <FileProfileEditor
      v-if="editorOpen"
      :profile="editingProfile"
      :initial-mode="editorMode"
      :encryption-available="Boolean(bootstrap?.encryptionAvailable)"
      :busy="editorBusy"
      :error="editorError"
      @close="editorOpen = false"
      @save-profile="handleSaveProfile"
      @connect-adhoc="handleAdhocConnect"
      @save-ssh-and-connect="handleSaveSshAndConnect"
    />

    <!-- Credentials Prompt Dialog (SFTP / FTP / FTPS / WebDAV / S3) -->
    <div
      v-if="filesSecretPrompt"
      class="container_files_secret_overlay_base"
      role="dialog"
      aria-modal="true"
      @click.self="cancelSecretPrompt"
    >
      <form class="container_files_secret_dialog_card" @submit.prevent="submitSecretPrompt">
        <h3 class="container_files_secret_dialog_title">
          {{ t('filesPage.promptSecretTitle', { name: filesSecretPrompt.name }) }}
        </h3>
        <p class="container_files_secret_dialog_desc">
          {{ t('filesPage.promptSecretDesc', { endpoint: filesSecretPrompt.endpoint }) }}
        </p>
        <p v-if="filesSecretPrompt.error" class="container_files_secret_dialog_err" role="alert">
          {{ filesSecretPrompt.error }}
        </p>
        <template v-if="filesSecretPrompt.protocol === 's3'">
          <label class="container_files_secret_field_s3key">
            {{ t('filesPage.promptS3SecretLabel') }}
            <input
              ref="secretInputEl"
              v-model="secretForm.secretAccessKey"
              class="container_files_secret_input_s3key"
              type="password"
            />
          </label>
          <label class="container_files_secret_field_s3tok">
            {{ t('filesPage.promptS3SessionLabel') }}
            <input
              v-model="secretForm.sessionToken"
              class="container_files_secret_input_s3tok"
              type="password"
            />
          </label>
        </template>
        <label
          v-else-if="
            filesSecretPrompt.protocol === 'webdav' &&
            filesSecretPrompt.profile?.options.webdavAuth === 'token'
          "
          class="container_files_secret_field_token"
        >
          {{ t('filesPage.promptTokenLabel') }}
          <input
            ref="secretInputEl"
            v-model="secretForm.token"
            class="container_files_secret_input_token"
            type="password"
          />
        </label>
        <label v-else class="container_files_secret_field_pw">
          {{ t('filesPage.promptPasswordLabel') }}
          <input
            ref="secretInputEl"
            v-model="secretForm.password"
            class="container_files_secret_input_pw"
            type="password"
          />
        </label>
        <div class="container_files_secret_dialog_actions">
          <button class="container_files_secret_btn_cancel" type="button" @click="cancelSecretPrompt">
            {{ t('actionDialog.cancel') }}
          </button>
          <button class="container_files_secret_btn_ok" type="submit" data-primary="true">
            <Check :size="13" />
            {{ t('filesPage.promptConnect') }}
          </button>
        </div>
      </form>
    </div>

    <!-- Conflict Resolution Prompt -->
    <div
      v-if="filesConflictPrompt"
      class="container_files_conflict_overlay_base"
      role="dialog"
      aria-modal="true"
      @click.self="filesConflictPrompt.resolve({ decision: 'cancel', applyAll: true })"
    >
      <div class="container_files_conflict_dialog_card">
        <h3 class="container_files_conflict_dialog_title">{{ t('sftp.conflictTitle') }}</h3>
        <p class="container_files_conflict_dialog_desc">
          {{
            t('sftp.conflictDesc', {
              side:
                filesConflictPrompt.direction === 'upload'
                  ? t('sftp.conflictRemote')
                  : t('sftp.conflictLocal'),
              name: filesConflictPrompt.name
            })
          }}
        </p>
        <label class="container_files_conflict_check_row">
          <OrbitCheckbox
            v-model="conflictApplyAll"
            class="container_files_conflict_check_box"
            size="sm"
            instance="files-conflict-all"
          />
          <span class="container_files_conflict_check_label">{{ t('sftp.conflictApplyAll') }}</span>
        </label>
        <div class="container_files_conflict_dialog_actions">
          <button
            class="container_files_conflict_btn_cancel"
            type="button"
            @click="filesConflictPrompt.resolve({ decision: 'cancel', applyAll: true })"
          >
            {{ t('filesPage.conflictCancelAll') }}
          </button>
          <button
            class="container_files_conflict_btn_skip"
            type="button"
            @click="filesConflictPrompt.resolve({ decision: 'skip', applyAll: conflictApplyAll })"
          >
            {{ t('sftp.conflictSkip') }}
          </button>
          <button
            class="container_files_conflict_btn_rename"
            type="button"
            @click="filesConflictPrompt.resolve({ decision: 'rename', applyAll: conflictApplyAll })"
          >
            {{ t('sftp.conflictRename') }}
          </button>
          <button
            class="container_files_conflict_btn_overwrite"
            type="button"
            data-primary="true"
            @click="filesConflictPrompt.resolve({ decision: 'overwrite', applyAll: conflictApplyAll })"
          >
            {{ t('sftp.conflictOverwrite') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Action Mini Modal (mkdir / rename / chmod / delete confirmation) -->
    <div
      v-if="modal"
      class="container_files_modal_overlay_base"
      role="dialog"
      aria-modal="true"
      @click.self="modal = null"
    >
      <form class="container_files_modal_dialog_card" @submit.prevent="confirmModal">
        <h3 class="container_files_modal_dialog_title">
          {{
            modal.kind === 'mkdir'
              ? t('filesPage.mkdirPromptTitle')
              : modal.kind === 'rename'
                ? t('filesPage.renamePromptTitle', { name: modal.entry.name })
                : modal.kind === 'chmod'
                  ? t('filesPage.chmodPromptTitle', { name: modal.entry.name })
                  : t('filesPage.confirmDeleteTitle')
          }}
        </h3>
        <template v-if="modal.kind === 'mkdir' || modal.kind === 'rename' || modal.kind === 'chmod'">
          <label class="container_files_modal_dialog_field">
            {{
              modal.kind === 'mkdir'
                ? t('filesPage.mkdirPromptLabel')
                : modal.kind === 'rename'
                  ? t('filesPage.renamePromptLabel')
                  : t('filesPage.chmodPromptLabel')
            }}
            <input
              ref="modalInputEl"
              v-model="modal.value"
              class="container_files_modal_dialog_input"
              type="text"
            />
          </label>
          <div v-if="modal.kind === 'chmod'" class="container_files_modal_chmod_grid">
            <label
              v-for="bit in chmodPermissions"
              :key="bit.shift"
              :class="c('container_files_modal_chmod_cell', String(bit.shift))"
            >
              <OrbitCheckbox
                :class="c('container_files_modal_chmod_check', String(bit.shift))"
                size="sm"
                :model-value="chmodBit(bit.shift)"
                :instance="`files-chmod-${bit.shift}`"
                @change="toggleChmodBit(bit.shift)"
              />
              <span :class="c('container_files_modal_chmod_label', String(bit.shift))">
                {{ bit.label }}
              </span>
            </label>
          </div>
        </template>
        <p v-else class="container_files_modal_dialog_desc">
          {{
            modal.kind === 'deleteFile'
              ? isDirEntry(modal.entry)
                ? t('filesPage.confirmDeleteDir', { name: modal.entry.name })
                : t('filesPage.confirmDeleteFile', { name: modal.entry.name })
              : modal.kind === 'deleteBatch'
                ? t('filesPage.confirmDeleteBatch', { count: modal.entries.length })
                : t('filesPage.deleteProfileConfirm', { name: modal.profile.name })
          }}
        </p>
        <div class="container_files_modal_dialog_actions">
          <button class="container_files_modal_btn_cancel" type="button" @click="modal = null">
            {{ t('actionDialog.cancel') }}
          </button>
          <button
            class="container_files_modal_btn_confirm"
            type="submit"
            :data-danger="
              modal.kind === 'deleteFile' || modal.kind === 'deleteBatch' || modal.kind === 'deleteProfile'
                ? 'true'
                : undefined
            "
            :data-primary="
              modal.kind !== 'deleteFile' && modal.kind !== 'deleteBatch' && modal.kind !== 'deleteProfile'
                ? 'true'
                : undefined
            "
          >
            {{
              modal.kind === 'deleteFile' || modal.kind === 'deleteBatch' || modal.kind === 'deleteProfile'
                ? t('filesPage.deleteBtn')
                : t('hostEditor.save')
            }}
          </button>
        </div>
      </form>
    </div>
  </section>
</template>

<style scoped lang="scss">
.container_files_page_root_base {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
  background: var(--color-surface-canvas);
}
.container_files_inventory_sidebar_base {
  width: 300px;
  flex-shrink: 0;
  border-right: 1px solid var(--color-border);
  background: var(--color-surface-1);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.container_files_inventory_header_base {
  padding: 16px 14px 12px;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.container_files_inventory_header_eyebrow {
  font-size: var(--font-size-ui-xs);
  letter-spacing: 1.4px;
  color: var(--color-accent-primary);
}
.container_files_inventory_header_title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--font-size-ui-xl);
  color: var(--color-text-heading);
}
.container_files_inventory_header_actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.container_files_inventory_action_add,
.container_files_inventory_action_quick {
  font-size: var(--font-size-ui-xs);
  padding: 6px 8px;
  border: 1px solid var(--color-border-control);
}
.container_files_inventory_search_row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border-control);
  background: var(--color-app-bg);
}
.container_files_inventory_search_input {
  flex: 1;
  border: none;
  background: transparent;
  padding: 6px 2px;
  font-size: var(--font-size-ui-xs);
}
.container_files_inventory_fav_toggle {
  padding: 4px;
  min-height: 24px;
  &[aria-pressed='true'] {
    color: var(--color-warning);
  }
}
.container_files_inventory_scroll_base {
  flex: 1;
  overflow: auto;
  padding: 12px 10px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.container_files_group_files_section,
.container_files_group_ssh_section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.container_files_group_files_title,
.container_files_group_ssh_title {
  font-size: var(--font-size-ui-xs);
  letter-spacing: 0.6px;
  color: var(--color-text-muted);
  padding: 0 4px;
}
.container_files_group_files_empty,
.container_files_group_ssh_empty {
  margin: 0;
  padding: 8px;
  font-size: var(--font-size-ui-xs);
  color: var(--color-text-muted);
}
[class*='container_files_card_profile_base'],
[class*='container_files_card_ssh_base'] {
  padding: 10px;
  border-radius: var(--radius-card);
  border: 1px solid var(--color-border-subtle);
  background: var(--color-surface-2);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
[class*='container_files_card_profile_top'],
[class*='container_files_card_ssh_top'] {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
[class*='container_files_card_profile_badge'],
[class*='container_files_card_ssh_badge'] {
  padding: 1px 6px;
  border-radius: 5px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  background: var(--color-accent-primary-soft);
  color: var(--color-accent-primary-bright);
  border: 1px solid var(--color-accent-primary-ring);
}
[class*='container_files_card_profile_name'],
[class*='container_files_card_ssh_name'] {
  flex: 1;
  font-size: var(--font-size-ui-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[class*='container_files_card_profile_endpoint'],
[class*='container_files_card_ssh_endpoint'] {
  font-family: var(--font-term);
  font-size: 11px;
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[class*='container_files_card_profile_actions'],
[class*='container_files_card_ssh_actions'] {
  display: flex;
  align-items: center;
  gap: 6px;
}
[class*='container_files_card_profile_connect'],
[class*='container_files_card_ssh_connect'] {
  flex: 1;
  min-height: 26px;
  padding: 3px 8px;
  font-size: var(--font-size-ui-xs);
  border: 1px solid var(--color-accent-primary-ring);
  background: var(--color-accent-primary-soft);
  color: var(--color-accent-primary-bright);
}
[class*='container_files_card_profile_edit'],
[class*='container_files_card_profile_del'] {
  min-height: 26px;
  padding: 3px 7px;
  border: 1px solid var(--color-border-control);
}

.container_files_stage_body_base {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.container_files_stage_topbar_base {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-1);
  flex-shrink: 0;
}
.container_files_stage_sidebar_toggle,
.container_files_stage_settings_btn {
  min-height: 28px;
  padding: 4px 8px;
  font-size: var(--font-size-ui-xs);
  border: 1px solid var(--color-border-control);
  flex-shrink: 0;
}
.container_files_stage_settings_btn {
  margin-left: auto;
}
.container_files_tabs_bar_base {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  min-width: 0;
  flex: 1;
}
[class*='container_files_tabs_item_base'] {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 10px;
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border-control);
  background: var(--color-app-bg);
  cursor: pointer;
  flex-shrink: 0;
  &[aria-selected='true'] {
    border-color: var(--color-accent-primary);
    background: var(--color-accent-primary-soft);
  }
}
[class*='container_files_tabs_item_dot'] {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-text-muted);
  &[data-state='running'] {
    background: var(--color-success);
  }
  &[data-state='connecting'] {
    background: var(--color-warning);
  }
  &[data-state='error'] {
    background: var(--color-error);
  }
}
[class*='container_files_tabs_item_proto'] {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-accent-secondary);
}
[class*='container_files_tabs_item_title'] {
  font-size: var(--font-size-ui-xs);
  color: var(--color-text-primary);
}
[class*='container_files_tabs_item_close'] {
  padding: 2px;
  min-height: 18px;
}

.container_files_empty_stage_base {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 32px;
  text-align: center;
  color: var(--color-text-muted);
}
.container_files_empty_stage_title {
  margin: 0;
  font-size: var(--font-size-ui-xl);
  color: var(--color-text-heading);
}
.container_files_empty_stage_desc {
  margin: 0;
  max-width: 520px;
  font-size: var(--font-size-ui-sm);
  line-height: 1.6;
}
.container_files_empty_stage_buttons {
  display: flex;
  gap: 10px;
  margin-top: 6px;
}
.container_files_empty_stage_quickbtn {
  border: 1px solid var(--color-border-control);
}

.container_files_browser_body_base {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 12px 14px;
  gap: 10px;
  &[data-drag='true'] {
    outline: 2px dashed var(--color-accent-primary);
    outline-offset: -4px;
  }
}
.container_files_toolbar_top_row,
.container_files_toolbar_actions_row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.container_files_toolbar_crumbs_base {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 220px;
}
.container_files_toolbar_up_btn,
.container_files_toolbar_home_btn,
.container_files_toolbar_refresh_btn,
.container_files_toolbar_mkdir_btn,
.container_files_toolbar_upfiles_btn,
.container_files_toolbar_updirs_btn,
.container_files_toolbar_hidden_btn,
.container_files_toolbar_jump_btn {
  border: 1px solid var(--color-border-control);
  font-size: var(--font-size-ui-xs);
  min-height: 28px;
  padding: 4px 10px;
}
.container_files_toolbar_hidden_btn[aria-pressed='true'] {
  color: var(--color-accent-primary-bright);
  background: var(--color-accent-primary-soft);
  border-color: var(--color-accent-primary-ring);
}
.container_files_toolbar_count_badge {
  margin-left: auto;
  font-size: var(--font-size-ui-xs);
  color: var(--color-text-muted);
  white-space: nowrap;
}
.container_files_crumbs_trail_row {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
[class*='container_files_crumbs_item_btn'] {
  padding: 3px 7px;
  min-height: 24px;
  font-family: var(--font-term);
  font-size: 12px;
  border: 1px solid var(--color-border-subtle);
}
.container_files_toolbar_jump_form {
  display: flex;
  gap: 6px;
  min-width: 240px;
}
.container_files_toolbar_jump_input,
.container_files_toolbar_filter_input {
  font-family: var(--font-term);
  font-size: 12px;
  padding: 5px 9px;
}
.container_files_toolbar_filter_input {
  width: 200px;
}
.container_files_s3_notice_banner {
  margin: 0;
  padding: 6px 10px;
  border-radius: 6px;
  background: var(--color-surface-1);
  border: 1px solid var(--color-border-subtle);
  font-size: var(--font-size-ui-xs);
  color: var(--color-text-muted);
}
.container_files_error_banner_row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.45);
}
.container_files_error_banner_text {
  margin: 0;
  color: #fca5a5;
  font-size: var(--font-size-ui-xs);
}
.container_files_error_reconn_btn {
  min-height: 26px;
  padding: 3px 9px;
  font-size: var(--font-size-ui-xs);
  border: 1px solid rgba(239, 68, 68, 0.5);
  flex-shrink: 0;
}
.container_files_state_connecting_box,
.container_files_state_offline_box {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 28px;
  text-align: center;
  color: var(--color-text-muted);
}
.container_files_state_offline_title {
  margin: 0;
  font-size: var(--font-size-ui-sm);
}
.container_files_table_scroll_wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface-1);
  &:focus {
    outline: 1px solid var(--color-accent-primary-ring);
  }
}
.container_files_table_grid_base {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-ui-sm);
}
.container_files_table_head_tr {
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-2);
  text-align: left;
  position: sticky;
  top: 0;
  z-index: 1;
  th {
    padding: 8px 10px;
    font-weight: 600;
    color: var(--color-text-secondary);
  }
}
.container_files_table_th_check {
  width: 32px;
  text-align: center;
}
.container_files_table_sort_name,
.container_files_table_sort_size,
.container_files_table_sort_mtime {
  padding: 2px 6px;
  min-height: 24px;
  font-size: var(--font-size-ui-xs);
  font-weight: 600;
  color: var(--color-text-secondary);
  &[data-active='true'] {
    color: var(--color-accent-primary-bright);
    background: var(--color-accent-primary-soft);
    border-color: var(--color-accent-primary-ring);
  }
}
[class*='container_files_table_entry_row'] {
  height: var(--files-row-height);
  border-bottom: 1px solid var(--color-border-subtle);
  cursor: pointer;
  user-select: none;
  &:hover {
    background: var(--color-surface-2);
  }
  &[data-selected='true'] {
    background: var(--color-accent-primary-soft);
  }
  td {
    padding: 5px 10px;
    white-space: nowrap;
  }
}
[class*='container_files_table_entry_check'] {
  text-align: center;
  width: 32px;
}
[class*='container_files_table_entry_name'] {
  color: var(--color-text-primary);
  > svg {
    margin-inline-end: 8px;
    vertical-align: middle;
  }
}
[class*='container_files_table_entry_link'] {
  font-style: normal;
  font-size: 11px;
  color: var(--color-accent-secondary);
}
[class*='container_files_table_entry_size'],
[class*='container_files_table_entry_mtime'],
[class*='container_files_table_entry_perms'] {
  font-family: var(--font-term);
  font-size: 12px;
  color: var(--color-text-muted);
  white-space: nowrap;
}
[class*='container_files_table_entry_actions'] {
  button {
    min-height: 24px;
    padding: 3px 6px;
    font-size: 11px;
    border: 1px solid var(--color-border-control);
    vertical-align: middle;
  }
  button + button {
    margin-inline-start: 4px;
  }
}
.container_files_table_spcell_top,
.container_files_table_spcell_bot {
  padding: 0;
  border: none;
}
.container_files_table_empty_cell {
  padding: 28px;
  text-align: center;
  color: var(--color-text-muted);
}
.container_files_batch_bar_base {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: var(--radius-control);
  background: var(--color-accent-primary-soft);
  border: 1px solid var(--color-accent-primary-ring);
  flex-shrink: 0;
  > button {
    min-height: 24px;
    padding: 3px 9px;
    font-size: var(--font-size-ui-xs);
    border: 1px solid var(--color-border-control);
  }
}
.container_files_batch_bar_label {
  margin-right: auto;
  font-size: var(--font-size-ui-xs);
  font-weight: 600;
  color: var(--color-accent-primary-bright);
}
.container_files_context_menu_box {
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
    font-size: var(--font-size-ui-xs);
  }
}
.container_files_drop_overlay_box {
  position: absolute;
  inset: 12px;
  z-index: 6;
  display: grid;
  place-items: center;
  border-radius: var(--radius-card);
  background: rgba(11, 13, 18, 0.78);
  border: 2px dashed var(--color-accent-primary);
  color: var(--color-accent-primary-bright);
  font-size: var(--font-size-ui-lg);
  pointer-events: none;
}

.container_files_queue_panel_base {
  border-top: 1px solid var(--color-border);
  background: var(--color-surface-1);
  padding: 8px 14px;
  max-height: 190px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
}
.container_files_queue_header_row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--font-size-ui-xs);
}
.container_files_queue_toggle_btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 6px;
  min-height: 24px;
  font-size: var(--font-size-ui-xs);
}
.container_files_queue_clear_btn {
  min-height: 24px;
  padding: 2px 8px;
  font-size: var(--font-size-ui-xs);
  border: 1px solid var(--color-border-control);
}
.container_files_queue_list_scroll {
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
[class*='container_files_queue_item_row'] {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 5px 8px;
  border-radius: 6px;
  background: var(--color-surface-2);
  font-size: var(--font-size-ui-xs);
}
[class*='container_files_queue_item_top'] {
  display: flex;
  align-items: center;
  gap: 10px;
}
[class*='container_files_queue_item_dir'] {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-accent-secondary);
}
[class*='container_files_queue_item_name'] {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[class*='container_files_queue_item_bytes'] {
  font-family: var(--font-term);
  color: var(--color-text-muted);
  white-space: nowrap;
}
[class*='container_files_queue_item_status'] {
  color: var(--color-text-secondary);
  white-space: nowrap;
}
[class*='container_files_queue_item_cancel'],
[class*='container_files_queue_item_retry'],
[class*='container_files_queue_item_reveal'] {
  min-height: 22px;
  padding: 2px 7px;
  font-size: 11px;
  border: 1px solid var(--color-border-control);
}
[class*='container_files_queue_item_track'] {
  height: 3px;
  border-radius: 2px;
  background: var(--color-surface-1);
  overflow: hidden;
}
[class*='container_files_queue_item_bar'] {
  height: 100%;
  background: linear-gradient(90deg, var(--color-accent-secondary), var(--color-accent-primary));
  transition: width 120ms linear;
}

.container_files_secret_overlay_base,
.container_files_conflict_overlay_base,
.container_files_modal_overlay_base {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: grid;
  place-items: center;
  background: rgba(5, 7, 11, 0.72);
  backdrop-filter: blur(4px);
}
.container_files_secret_dialog_card,
.container_files_conflict_dialog_card,
.container_files_modal_dialog_card {
  width: min(460px, 92vw);
  padding: 18px 20px;
  border-radius: 14px;
  border: 1px solid var(--color-border-control);
  background: var(--color-surface-1);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.container_files_secret_dialog_title,
.container_files_conflict_dialog_title,
.container_files_modal_dialog_title {
  margin: 0;
  font-size: var(--font-size-ui-lg);
}
.container_files_secret_dialog_desc,
.container_files_conflict_dialog_desc,
.container_files_modal_dialog_desc {
  margin: 0;
  font-size: var(--font-size-ui-sm);
  color: var(--color-text-secondary);
}
.container_files_secret_dialog_err {
  margin: 0;
  color: var(--color-error);
  font-size: var(--font-size-ui-xs);
}
.container_files_secret_field_s3key,
.container_files_secret_field_s3tok,
.container_files_secret_field_token,
.container_files_secret_field_pw,
.container_files_modal_dialog_field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: var(--font-size-ui-sm);
}
.container_files_conflict_check_row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-ui-xs);
  color: var(--color-text-secondary);
  cursor: pointer;
}
.container_files_modal_chmod_grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
[class*='container_files_modal_chmod_cell'] {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-ui-xs);
  color: var(--color-text-secondary);
  cursor: pointer;
}
.container_files_secret_dialog_actions,
.container_files_conflict_dialog_actions,
.container_files_modal_dialog_actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
  flex-wrap: wrap;
}
</style>
