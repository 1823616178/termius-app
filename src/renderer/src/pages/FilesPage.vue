<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  ArrowUp,
  Check,
  Edit3,
  Eye,
  EyeOff,
  File as FileIcon,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Link2,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Star,
  Trash2,
  Upload,
  Download,
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
  goParentDirectory,
  initFilesWorkspaceListeners,
  openAdhocFileTab,
  openFileProfileTab,
  openSftpHostTab,
  refreshFileDirectory,
  renameRemoteEntry,
  uploadLocalPathsToActiveTab,
  visibleFileEntries
} from '../services/files-workspace'
import {
  bootstrap,
  fileProfiles,
  hosts,
  page,
  protocolSettings,
  removeFileProfile,
  saveFileProfile,
  windowInstance
} from '../stores/workbench'

const c = (base: string, token: string) => instanceClass(base, windowInstance(safeInstanceToken(token)))

const inventoryQuery = ref('')
const favOnly = ref(false)
const pathInput = ref('')
const dragActive = ref(false)
const actionError = ref('')

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

// Mini modal dialogs
const modal = ref<
  | null
  | { kind: 'mkdir'; value: string }
  | { kind: 'rename'; entry: SftpEntry; value: string }
  | { kind: 'chmod'; entry: SftpEntry; value: string }
  | { kind: 'deleteFile'; entry: SftpEntry }
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
  return hosts.value.filter((item) => {
    if (favOnly.value && !item.favorite) return false
    if (!q) return true
    return (
      item.name.toLowerCase().includes(q) ||
      item.address.toLowerCase().includes(q) ||
      item.username.toLowerCase().includes(q)
    )
  })
})

const breadcrumbs = computed(() =>
  activeFileTab.value ? remoteBreadcrumbs(activeFileTab.value.currentPath) : []
)

onMounted(() => {
  initFilesWorkspaceListeners()
})

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
      const target =
        (input.id ? updated.find((p) => p.id === input.id) : undefined) ??
        updated.find((p) => p.name === input.name)
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
    const savedList = await window.orbit.hosts.save(input)
    hosts.value = savedList
    editorOpen.value = false
    const created = savedList.find((h) => h.name === input.name)
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
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(undefined, { hour12: false })
}

function toggleSort(field: SftpSortField) {
  if (filesSortBy.value === field) filesSortAsc.value = !filesSortAsc.value
  else {
    filesSortBy.value = field
    filesSortAsc.value = true
  }
}

async function handleEntryDoubleClick(entry: SftpEntry) {
  if (!activeFileTab.value) return
  if (entry.kind === 'directory' || entry.targetKind === 'directory') {
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

async function handleDrop(event: DragEvent) {
  dragActive.value = false
  if (!activeFileTab.value || activeFileTab.value.state !== 'running') return
  const dropped = event.dataTransfer?.files
  if (!dropped) return
  const paths = window.orbit.sftp.getDroppedPaths(dropped)
  if (paths.length) await uploadLocalPathsToActiveTab(paths)
}

async function handleDeleteTrigger(entry: SftpEntry) {
  if (!protocolSettings.value.files.confirmDelete) {
    try {
      await deleteRemoteEntry(entry)
    } catch (error) {
      actionError.value = error instanceof Error ? error.message : String(error)
    }
    return
  }
  modal.value = { kind: 'deleteFile', entry }
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
        throw new Error('请输入有效的 4 位或 3 位八进制权限（如 0755）')
      }
      await chmodRemoteEntry(current.entry, parsed)
    } else if (current.kind === 'deleteFile') {
      await deleteRemoteEntry(current.entry)
    } else if (current.kind === 'deleteProfile') {
      await removeFileProfile(current.profile.id)
    }
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : String(error)
  }
}

function revealTransferLocal(localPath: string) {
  void window.orbit.sftp.revealLocal(localPath)
}

function openExternalSshTrustHint(host: Host) {
  void openSftpHostTab(host)
}
</script>

<template>
  <section v-if="page === 'files'" class="container_files_page_root_base" data-testid="files-page">
    <!-- Left Server Inventory Sidebar -->
    <aside class="container_files_inventory_sidebar_base">
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
      <!-- Connected Session Tabs -->
      <div v-if="fileTabs.length" class="container_files_tabs_bar_base" role="tablist">
        <div
          v-for="tab in fileTabs"
          :key="tab.id"
          :class="c('container_files_tabs_item_base', tab.id)"
          role="tab"
          :aria-selected="activeFileTabId === tab.id"
          @click="activeFileTabId = tab.id"
        >
          <span :class="c('container_files_tabs_item_proto', tab.id)">{{ tab.protocol.toUpperCase() }}</span>
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
        class="container_files_browser_body_base"
        :data-drag="dragActive"
        @dragover.prevent="dragActive = true"
        @dragleave.self="dragActive = false"
        @drop.prevent="handleDrop"
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

        <p v-if="activeFileTab.error || actionError" class="container_files_error_banner_text" role="alert">
          {{ actionError || activeFileTab.error }}
        </p>

        <div v-if="activeFileTab.state === 'connecting'" class="container_files_state_connecting_box">
          {{ t('filesPage.connectingState', { name: activeFileTab.title }) }}
        </div>

        <div v-else class="container_files_table_scroll_wrap">
          <table class="container_files_table_grid_base">
            <thead class="container_files_table_head_row">
              <tr class="container_files_table_head_tr">
                <th class="container_files_table_th_name">
                  <button class="container_files_table_sort_name" type="button" @click="toggleSort('name')">
                    {{ t('filesPage.colName') }}
                  </button>
                </th>
                <th class="container_files_table_th_size">
                  <button class="container_files_table_sort_size" type="button" @click="toggleSort('size')">
                    {{ t('filesPage.colSize') }}
                  </button>
                </th>
                <th class="container_files_table_th_mtime">
                  <button class="container_files_table_sort_mtime" type="button" @click="toggleSort('mtime')">
                    {{ t('filesPage.colModified') }}
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
                <td
                  :colspan="activeFileTab.capabilities.posixMetadata ? 5 : 4"
                  class="container_files_table_empty_cell"
                >
                  {{ filesFilter ? t('filesPage.emptyFilter') : t('filesPage.emptyDir') }}
                </td>
              </tr>
              <tr
                v-for="entry in visibleFileEntries"
                :key="entry.path"
                :class="c('container_files_table_entry_row', entry.path)"
                :data-kind="entry.kind"
                @dblclick="handleEntryDoubleClick(entry)"
              >
                <td :class="c('container_files_table_entry_name', entry.path)">
                  <Folder v-if="entry.kind === 'directory' || entry.targetKind === 'directory'" :size="14" />
                  <FileIcon v-else :size="14" />
                  <span :class="c('container_files_table_entry_label', entry.path)">{{ entry.name }}</span>
                </td>
                <td :class="c('container_files_table_entry_size', entry.path)">
                  {{ entry.kind === 'directory' ? '—' : formatBytes(entry.size) }}
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
                <td :class="c('container_files_table_entry_actions', entry.path)">
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
            </tbody>
          </table>
        </div>

        <div v-if="dragActive" class="container_files_drop_overlay_box">
          {{ t('filesPage.dropHint', { path: activeFileTab.currentPath }) }}
        </div>
      </div>

      <!-- Transfer Queue Panel -->
      <section v-if="fileTransfers.length" class="container_files_queue_panel_base">
        <header class="container_files_queue_header_row">
          <strong class="container_files_queue_header_title">
            {{ t('filesPage.queueTitle', { active: activeFilesTransferCount, total: fileTransfers.length }) }}
          </strong>
          <button class="container_files_queue_clear_btn" type="button" @click="clearFinishedFileTransfers">
            {{ t('filesPage.clearDone') }}
          </button>
        </header>
        <div class="container_files_queue_list_scroll">
          <div
            v-for="item in fileTransfers"
            :key="item.id"
            :class="c('container_files_queue_item_row', item.id)"
            :data-status="item.status"
          >
            <span :class="c('container_files_queue_item_dir', item.id)">
              {{ item.protocol.toUpperCase() }} · {{ item.direction === 'upload' ? 'UP' : 'DOWN' }}
            </span>
            <span :class="c('container_files_queue_item_name', item.id)">{{ item.name }}</span>
            <span :class="c('container_files_queue_item_bytes', item.id)">
              {{ formatBytes(item.transferredBytes) }} / {{ formatBytes(item.totalBytes) }}
              <template v-if="item.status === 'running' && item.speedBps > 0">
                · {{ formatSpeed(item.speedBps) }}
              </template>
            </span>
            <span :class="c('container_files_queue_item_status', item.id)">
              {{ item.error || item.status }}
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
              v-else-if="item.direction === 'download' && item.status === 'completed'"
              :class="c('container_files_queue_item_reveal', item.id)"
              type="button"
              @click="revealTransferLocal(item.localPath)"
            >
              {{ t('filesPage.revealLocal') }}
            </button>
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
    <div v-if="filesSecretPrompt" class="container_files_secret_overlay_base" role="dialog" aria-modal="true">
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
          <input v-model="secretForm.token" class="container_files_secret_input_token" type="password" />
        </label>
        <label v-else class="container_files_secret_field_pw">
          {{ t('filesPage.promptPasswordLabel') }}
          <input v-model="secretForm.password" class="container_files_secret_input_pw" type="password" />
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
        <div class="container_files_conflict_dialog_actions">
          <button
            class="container_files_conflict_btn_cancel"
            type="button"
            @click="filesConflictPrompt.resolve('cancel')"
          >
            {{ t('actionDialog.cancel') }}
          </button>
          <button
            class="container_files_conflict_btn_skip"
            type="button"
            @click="filesConflictPrompt.resolve('skip')"
          >
            {{ t('sftp.conflictSkip') }}
          </button>
          <button
            class="container_files_conflict_btn_rename"
            type="button"
            @click="filesConflictPrompt.resolve('rename')"
          >
            {{ t('sftp.conflictRename') }}
          </button>
          <button
            class="container_files_conflict_btn_overwrite"
            type="button"
            data-primary="true"
            @click="filesConflictPrompt.resolve('overwrite')"
          >
            {{ t('sftp.conflictOverwrite') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Action Mini Modal (mkdir / rename / chmod / delete confirmation) -->
    <div v-if="modal" class="container_files_modal_overlay_base" role="dialog" aria-modal="true">
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
        <label
          v-if="modal.kind === 'mkdir' || modal.kind === 'rename' || modal.kind === 'chmod'"
          class="container_files_modal_dialog_field"
        >
          {{
            modal.kind === 'mkdir'
              ? t('filesPage.mkdirPromptLabel')
              : modal.kind === 'rename'
                ? t('filesPage.renamePromptLabel')
                : t('filesPage.chmodPromptLabel')
          }}
          <input v-model="modal.value" class="container_files_modal_dialog_input" type="text" />
        </label>
        <p v-else class="container_files_modal_dialog_desc">
          {{
            modal.kind === 'deleteFile'
              ? modal.entry.kind === 'directory'
                ? t('filesPage.confirmDeleteDir', { name: modal.entry.name })
                : t('filesPage.confirmDeleteFile', { name: modal.entry.name })
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
            :data-danger="modal.kind === 'deleteFile' || modal.kind === 'deleteProfile' ? 'true' : undefined"
            :data-primary="modal.kind !== 'deleteFile' && modal.kind !== 'deleteProfile' ? 'true' : undefined"
          >
            {{
              modal.kind === 'deleteFile' || modal.kind === 'deleteProfile'
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
.container_files_tabs_bar_base {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-1);
  overflow-x: auto;
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
  &[aria-selected='true'] {
    border-color: var(--color-accent-primary);
    background: var(--color-accent-primary-soft);
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
  gap: 10px;
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
  margin-left: auto;
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
.container_files_error_banner_text {
  margin: 0;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.45);
  color: #fca5a5;
  font-size: var(--font-size-ui-xs);
}
.container_files_state_connecting_box {
  padding: 28px;
  text-align: center;
  color: var(--color-text-muted);
}
.container_files_table_scroll_wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface-1);
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
  th {
    padding: 8px 10px;
    font-weight: 600;
    color: var(--color-text-secondary);
  }
}
[class*='container_files_table_entry_row'] {
  border-bottom: 1px solid var(--color-border-subtle);
  cursor: pointer;
  &:hover {
    background: var(--color-surface-2);
  }
  td {
    padding: 7px 10px;
  }
}
[class*='container_files_table_entry_name'] {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text-primary);
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
  display: flex;
  gap: 4px;
  button {
    min-height: 24px;
    padding: 3px 6px;
    font-size: 11px;
    border: 1px solid var(--color-border-control);
  }
}
.container_files_table_empty_cell {
  padding: 28px;
  text-align: center;
  color: var(--color-text-muted);
}
.container_files_drop_overlay_box {
  position: absolute;
  inset: 12px;
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
  max-height: 170px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.container_files_queue_header_row {
  display: flex;
  align-items: center;
  justify-content: space-between;
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
  gap: 4px;
}
[class*='container_files_queue_item_row'] {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--color-surface-2);
  font-size: var(--font-size-ui-xs);
}
[class*='container_files_queue_item_dir'] {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-accent-secondary);
}
[class*='container_files_queue_item_name'] {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[class*='container_files_queue_item_bytes'] {
  font-family: var(--font-term);
  color: var(--color-text-muted);
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
.container_files_secret_dialog_actions,
.container_files_conflict_dialog_actions,
.container_files_modal_dialog_actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}
</style>
