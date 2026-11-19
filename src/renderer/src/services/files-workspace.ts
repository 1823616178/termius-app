import { computed, ref, watch } from 'vue'
import type { Host, TerminalEvent } from '../../../shared/contracts'
import {
  describeFileEndpoint,
  type FileCapabilities,
  type FileConnectSource,
  type FileProfile,
  type FileProgressEvent,
  type FileProtocol,
  type FileSecretsInput
} from '../../../shared/files'
import {
  joinRemotePosixPath,
  parentRemotePosixPath,
  sanitizeDownloadFilename,
  sortSftpEntries,
  type SftpConflictDecision,
  type SftpEntry,
  type SftpProgressEvent,
  type SftpSortField,
  type SftpTransferDirection,
  type SftpTransferItem,
  type SftpTransferStatus
} from '../../../shared/sftp'
import { markHostUsed } from './host-recency'
import { locale, t } from './i18n'
import { planUploads, trimTransferHistory, type UploadConflictChoice } from './file-transfers'
import { fileProfiles, hosts, notify, protocolSettings } from '../stores/workbench'

export type FilesProtocolKind = 'sftp' | FileProtocol

export interface FileWorkspaceTab {
  id: string
  title: string
  subtitle: string
  protocol: FilesProtocolKind
  sourceKind: 'ssh-host' | 'file-profile' | 'adhoc'
  host?: Host
  profileId?: string
  sessionId?: string
  capabilities: FileCapabilities
  state: 'connecting' | 'running' | 'error' | 'exited'
  message?: string
  currentPath: string
  entries: SftpEntry[]
  loading: boolean
  error: string
}

export interface FileWorkspaceTransfer extends SftpTransferItem {
  protocol: FilesProtocolKind
  tabId: string
}

export interface FilesSecretPrompt {
  tabId?: string
  kind: 'ssh-host' | 'file-profile'
  protocol: FilesProtocolKind
  name: string
  endpoint: string
  host?: Host
  profile?: FileProfile
  error?: string
}

export interface FilesConflictPrompt {
  direction: SftpTransferDirection
  name: string
  targetPath: string
  resolve: (choice: UploadConflictChoice) => void
}

const SFTP_CAPABILITIES: FileCapabilities = {
  chmod: true,
  symlinks: true,
  realDirectories: true,
  rename: true,
  resume: false,
  posixMetadata: true
}

export const fileTabs = ref<FileWorkspaceTab[]>([])
export const activeFileTabId = ref('')
export const fileTransfers = ref<FileWorkspaceTransfer[]>([])
export const filesShowHidden = ref(false)
export const filesFilter = ref('')
export const filesSortBy = ref<SftpSortField>('name')
export const filesSortAsc = ref(true)
export const filesSecretPrompt = ref<FilesSecretPrompt | null>(null)
export const filesConflictPrompt = ref<FilesConflictPrompt | null>(null)

const loadedTabsPath = new Map<string, string>()
const listRequestSerials = new Map<string, number>()
const tabRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>()
const sshPorts = new Map<string, MessagePort>()
const activeTransferTabIds = new Map<string, string>()

interface QueuedFileJob {
  id: string
  tabId: string
  sessionId: string
  protocol: FilesProtocolKind
  direction: SftpTransferDirection
  localPath: string
  remotePath: string
  conflict: SftpConflictDecision
}

const pendingJobs: QueuedFileJob[] = []
let runningJobCount = 0
let listenersReady = false
let unsubSftpProgress: (() => void) | undefined
let unsubFilesProgress: (() => void) | undefined
let unsubFilesClosed: (() => void) | undefined
let unsubSessionFailure: (() => void) | undefined

export function syncHiddenDefaultFromSettings(): void {
  filesShowHidden.value = Boolean(protocolSettings.value.files.showHidden)
}

export function findSavedFileProfile(
  list: FileProfile[],
  id?: string,
  name?: string
): FileProfile | undefined {
  if (id) {
    const byId = list.find((p) => p.id === id)
    if (byId) return byId
  }
  if (!name) return undefined
  const matches = list.filter((p) => p.name === name)
  if (matches.length <= 1) return matches[0]
  return [...matches].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
}

export function findSavedSshHost(list: Host[], id?: string, name?: string): Host | undefined {
  if (id) {
    const byId = list.find((h) => h.id === id)
    if (byId) return byId
  }
  if (!name) return undefined
  const matches = list.filter((h) => h.name === name)
  if (matches.length <= 1) return matches[0]
  return [...matches].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
}

export const activeFileTab = computed(
  () => fileTabs.value.find((tab) => tab.id === activeFileTabId.value) ?? null
)

export const activeFilesTransferCount = computed(
  () => fileTransfers.value.filter((item) => item.status === 'queued' || item.status === 'running').length
)

export const visibleFileEntries = computed(() => {
  const tab = activeFileTab.value
  if (!tab) return []
  const needle = filesFilter.value.trim().toLowerCase()
  const filtered = tab.entries.filter((entry) => {
    if (!filesShowHidden.value && entry.name.startsWith('.')) return false
    if (needle && !entry.name.toLowerCase().includes(needle)) return false
    return true
  })
  return sortSftpEntries(filtered, filesSortBy.value, filesSortAsc.value)
})

function updateTab(tabId: string, patch: Partial<FileWorkspaceTab>): void {
  const idx = fileTabs.value.findIndex((t) => t.id === tabId)
  if (idx < 0) return
  fileTabs.value[idx] = { ...fileTabs.value[idx]!, ...patch }
}

function getTransferApi(protocol: FilesProtocolKind) {
  return protocol === 'sftp' ? window.orbit.sftp : window.orbit.files
}

function scheduleTabRefresh(tabId: string, expectedDir: string): void {
  const tab = fileTabs.value.find((t) => t.id === tabId)
  if (!tab || tab.currentPath !== expectedDir) return
  const prev = tabRefreshTimers.get(tabId)
  if (prev) clearTimeout(prev)
  tabRefreshTimers.set(
    tabId,
    setTimeout(() => {
      tabRefreshTimers.delete(tabId)
      const latest = fileTabs.value.find((t) => t.id === tabId)
      if (latest && latest.state === 'running' && latest.currentPath === expectedDir) {
        void refreshFileDirectory(tabId, expectedDir)
      }
    }, 300)
  )
}

function applyTransferProgress(event: {
  transferId: string
  sessionId: string
  direction: SftpTransferDirection
  name: string
  localPath: string
  remotePath: string
  totalBytes: number
  transferredBytes: number
  speedBps: number
  status: SftpTransferStatus
  error?: string
  protocol?: FileProtocol
}): void {
  const matchingTab = fileTabs.value.find((t) => t.sessionId === event.sessionId)
  if (!matchingTab && !activeTransferTabIds.has(event.transferId)) return

  const tabId = matchingTab?.id ?? activeTransferTabIds.get(event.transferId) ?? ''
  const protocol: FilesProtocolKind = matchingTab?.protocol ?? event.protocol ?? 'sftp'
  if (event.status === 'completed' || event.status === 'failed' || event.status === 'cancelled') {
    activeTransferTabIds.delete(event.transferId)
  }
  const idx = fileTransfers.value.findIndex((t) => t.id === event.transferId)
  const now = Date.now()
  if (idx === -1) {
    fileTransfers.value = trimTransferHistory([
      {
        id: event.transferId,
        sessionId: event.sessionId,
        tabId,
        protocol,
        direction: event.direction,
        name: event.name,
        localPath: event.localPath,
        remotePath: event.remotePath,
        totalBytes: event.totalBytes,
        transferredBytes: event.transferredBytes,
        speedBps: event.speedBps,
        status: event.status,
        error: event.error,
        startedAt: now,
        updatedAt: now
      },
      ...fileTransfers.value
    ])
    return
  }
  const existing = fileTransfers.value[idx]!
  if (existing.status === 'cancelled') return
  const next: FileWorkspaceTransfer = {
    ...existing,
    localPath: event.localPath,
    remotePath: event.remotePath,
    totalBytes: Math.max(existing.totalBytes, event.totalBytes),
    transferredBytes: event.transferredBytes,
    speedBps: event.speedBps,
    status: event.status,
    error: event.error,
    updatedAt: now
  }
  const list = [...fileTransfers.value]
  list[idx] = next
  fileTransfers.value = trimTransferHistory(list)
}

export function initFilesWorkspaceListeners(): void {
  if (listenersReady || typeof window === 'undefined' || !window.orbit) return
  listenersReady = true
  syncHiddenDefaultFromSettings()

  unsubSftpProgress = window.orbit.sftp?.onProgress?.((evt: SftpProgressEvent) => {
    applyTransferProgress(evt)
  })
  unsubFilesProgress = window.orbit.files?.onProgress?.((evt: FileProgressEvent) => {
    applyTransferProgress(evt)
  })
  unsubFilesClosed = window.orbit.files?.onSessionClosed?.(({ sessionId, reason }) => {
    const tab = fileTabs.value.find((t) => t.sessionId === sessionId)
    if (tab) {
      updateTab(tab.id, {
        state: 'exited',
        loading: false,
        error: reason || (locale.value === 'en-US' ? 'Connection closed' : '连接已断开')
      })
    }
  })
  unsubSessionFailure = window.orbit.onSessionFailure?.(({ id, message }) => {
    const tab = fileTabs.value.find((t) => t.sessionId === id && t.protocol === 'sftp')
    if (tab) {
      updateTab(tab.id, { state: 'error', loading: false, error: message })
    }
  })
}

export function disposeFilesWorkspaceListeners(): void {
  for (const timer of tabRefreshTimers.values()) clearTimeout(timer)
  tabRefreshTimers.clear()
  unsubSftpProgress?.()
  unsubSftpProgress = undefined
  unsubFilesProgress?.()
  unsubFilesProgress = undefined
  unsubFilesClosed?.()
  unsubFilesClosed = undefined
  unsubSessionFailure?.()
  unsubSessionFailure = undefined
  listenersReady = false
}

export async function refreshFileDirectory(tabId?: string, targetPath?: string): Promise<void> {
  const id = tabId ?? activeFileTabId.value
  const tab = fileTabs.value.find((t) => t.id === id)
  if (!tab || !tab.sessionId || tab.state !== 'running') return

  const serial = (listRequestSerials.get(tab.id) ?? 0) + 1
  listRequestSerials.set(tab.id, serial)
  const previousPath = tab.currentPath
  const api = getTransferApi(tab.protocol)
  updateTab(tab.id, { loading: true, error: '' })
  try {
    const desiredPath = targetPath ?? (loadedTabsPath.get(tab.id) || (await api.home(tab.sessionId)))
    const res = await api.list(tab.sessionId, desiredPath)
    if (listRequestSerials.get(tab.id) !== serial) return
    if (!fileTabs.value.some((t) => t.id === tab.id)) return
    loadedTabsPath.set(tab.id, res.path)
    if (tab.id === activeFileTabId.value && res.path !== previousPath) {
      filesFilter.value = ''
    }
    updateTab(tab.id, {
      currentPath: res.path,
      entries: res.entries,
      loading: false,
      error: ''
    })
  } catch (error) {
    if (listRequestSerials.get(tab.id) !== serial) return
    updateTab(tab.id, {
      loading: false,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

watch(
  () => activeFileTab.value?.state,
  (state) => {
    const tab = activeFileTab.value
    if (!tab || state !== 'running' || !tab.sessionId) return
    if (!loadedTabsPath.has(tab.id)) {
      void refreshFileDirectory(tab.id)
    }
  }
)

export async function closeFileTab(tabId: string): Promise<void> {
  const tab = fileTabs.value.find((t) => t.id === tabId)
  if (!tab) return

  const refreshTimer = tabRefreshTimers.get(tabId)
  if (refreshTimer) {
    clearTimeout(refreshTimer)
    tabRefreshTimers.delete(tabId)
  }

  // Cancel queued transfers for this tab AND update their visible queue state.
  const cancelledIds = new Set<string>()
  for (let i = pendingJobs.length - 1; i >= 0; i--) {
    if (pendingJobs[i]!.tabId === tabId) {
      cancelledIds.add(pendingJobs[i]!.id)
      activeTransferTabIds.delete(pendingJobs[i]!.id)
      pendingJobs.splice(i, 1)
    }
  }

  const now = Date.now()
  const cancelMsg = t('filesPage.statusCancelled')
  let transferMutated = false
  const nextTransfers = fileTransfers.value.map((item) => {
    if (item.tabId !== tabId) return item
    if (cancelledIds.has(item.id) || item.status === 'queued') {
      activeTransferTabIds.delete(item.id)
      transferMutated = true
      return { ...item, status: 'cancelled' as const, speedBps: 0, error: cancelMsg, updatedAt: now }
    }
    if (item.status === 'running') {
      const api = getTransferApi(item.protocol)
      void api.cancelTransfer(item.sessionId, item.id).catch(() => {})
      activeTransferTabIds.delete(item.id)
      transferMutated = true
      return { ...item, status: 'cancelled' as const, speedBps: 0, error: cancelMsg, updatedAt: now }
    }
    return item
  })
  if (transferMutated) fileTransfers.value = trimTransferHistory(nextTransfers)

  const port = sshPorts.get(tabId)
  if (port) {
    try {
      port.postMessage({ type: 'close' })
      port.close()
    } catch {
      /* ignore */
    }
    sshPorts.delete(tabId)
  }

  if (tab.sessionId) {
    if (tab.protocol === 'sftp') {
      void window.orbit.sessions.close(tab.sessionId).catch(() => {})
    } else {
      void window.orbit.files.close(tab.sessionId).catch(() => {})
    }
  }
  loadedTabsPath.delete(tabId)
  listRequestSerials.delete(tabId)
  fileTabs.value = fileTabs.value.filter((t) => t.id !== tabId)
  if (activeFileTabId.value === tabId) {
    activeFileTabId.value = fileTabs.value[0]?.id ?? ''
  }
}

export async function reconnectFileTab(tabId: string): Promise<void> {
  const tab = fileTabs.value.find((t) => t.id === tabId)
  if (!tab) return
  if (tab.sourceKind === 'ssh-host' && tab.host) {
    const latestHost = hosts.value.find((h) => h.id === tab.host!.id) ?? tab.host
    await closeFileTab(tabId)
    await openSftpHostTab(latestHost)
    return
  }
  if (tab.sourceKind === 'file-profile' && tab.profileId) {
    const latestProfile = fileProfiles.value.find((p) => p.id === tab.profileId)
    if (latestProfile) {
      await closeFileTab(tabId)
      await openFileProfileTab(latestProfile)
    }
  }
}

export async function openSftpHostTab(host: Host, password?: string): Promise<void> {
  initFilesWorkspaceListeners()
  if (host.auth === 'password' && !host.hasPassword && password === undefined) {
    filesSecretPrompt.value = {
      kind: 'ssh-host',
      protocol: 'sftp',
      name: host.name,
      endpoint: `${host.username}@${host.address}:${host.port}`,
      host
    }
    return
  }
  filesSecretPrompt.value = null
  markHostUsed(host.id)

  const tabId = `ft-${crypto.randomUUID()}`
  const tab: FileWorkspaceTab = {
    id: tabId,
    title: host.name,
    subtitle: `${host.username}@${host.address}:${host.port}`,
    protocol: 'sftp',
    sourceKind: 'ssh-host',
    host,
    capabilities: SFTP_CAPABILITIES,
    state: 'connecting',
    currentPath: '~',
    entries: [],
    loading: true,
    error: ''
  }
  fileTabs.value = [...fileTabs.value, tab]
  activeFileTabId.value = tabId

  const requestId = crypto.randomUUID()
  let listener: ((event: MessageEvent) => void) | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  const delivered = new Promise<MessagePort>((resolve, reject) => {
    listener = (event) => {
      const expectedOrigin = window.location.protocol === 'file:' ? 'null' : window.location.origin
      if (
        event.source !== window ||
        event.origin !== expectedOrigin ||
        event.data?.type !== 'orbit:terminal-port' ||
        event.data.requestId !== requestId ||
        !event.ports[0]
      ) {
        return
      }
      resolve(event.ports[0])
    }
    window.addEventListener('message', listener)
    timeout = setTimeout(() => reject(new Error('建立 SFTP 控制通道超时')), 20_000)
  })
  void delivered.catch(() => {})

  try {
    const opened = await window.orbit.sessions.open({
      kind: 'ssh',
      hostId: host.id,
      ...(password !== undefined ? { password } : {}),
      mode: 'sftp',
      requestId,
      cols: 80,
      rows: 24
    })
    const port = await delivered
    if (!fileTabs.value.some((t) => t.id === tabId)) {
      try {
        port.postMessage({ type: 'close' })
        port.close()
      } catch {
        /* ignore */
      }
      void window.orbit.sessions.close(opened.id).catch(() => {})
      return
    }
    sshPorts.set(tabId, port)
    updateTab(tabId, { sessionId: opened.id, state: 'connecting' })
    port.onmessage = ({ data }: MessageEvent<TerminalEvent>) => {
      if (data.type !== 'state') return
      if (data.reason === 'auth-failed') {
        void closeFileTab(tabId)
        filesSecretPrompt.value = {
          kind: 'ssh-host',
          protocol: 'sftp',
          name: host.name,
          endpoint: `${host.username}@${host.address}:${host.port}`,
          host,
          error: data.message ?? 'SSH 认证失败，请重新输入密码'
        }
        return
      }
      updateTab(tabId, {
        state:
          data.state === 'running'
            ? 'running'
            : data.state === 'error'
              ? 'error'
              : data.state === 'exited'
                ? 'exited'
                : 'connecting',
        loading: data.state !== 'error' && data.state !== 'exited',
        error: data.state === 'error' ? (data.message ?? '') : '',
        message: data.message
      })
      if (data.state === 'running') {
        void refreshFileDirectory(tabId)
      }
    }
    port.start()
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes('请输入本次连接密码')) {
      await closeFileTab(tabId)
      filesSecretPrompt.value = {
        kind: 'ssh-host',
        protocol: 'sftp',
        name: host.name,
        endpoint: `${host.username}@${host.address}:${host.port}`,
        host,
        error: msg
      }
    } else {
      updateTab(tabId, { state: 'error', loading: false, error: msg })
    }
  } finally {
    if (listener) window.removeEventListener('message', listener)
    clearTimeout(timeout)
  }
}

export async function openFileProfileTab(
  profile: FileProfile,
  ephemeralSecrets?: FileSecretsInput
): Promise<void> {
  initFilesWorkspaceListeners()
  const needsCredentialPrompt =
    !profile.hasSecrets &&
    !ephemeralSecrets &&
    ((profile.protocol === 's3' && Boolean(profile.username)) ||
      (profile.protocol === 'webdav' && profile.options.webdavAuth !== undefined) ||
      ((profile.protocol === 'ftp' || profile.protocol === 'ftps') &&
        Boolean(profile.username.trim()) &&
        profile.username.trim().toLowerCase() !== 'anonymous'))

  if (needsCredentialPrompt) {
    filesSecretPrompt.value = {
      kind: 'file-profile',
      protocol: profile.protocol,
      name: profile.name,
      endpoint: describeFileEndpoint(profile),
      profile
    }
    return
  }
  await connectFileSource({
    title: profile.name,
    subtitle: describeFileEndpoint(profile),
    protocol: profile.protocol,
    sourceKind: 'file-profile',
    profileId: profile.id,
    profile,
    source: {
      kind: 'profile',
      profileId: profile.id,
      ...(ephemeralSecrets ? { secrets: ephemeralSecrets } : {})
    }
  })
}

export async function openAdhocFileTab(source: FileConnectSource & { kind: 'adhoc' }): Promise<void> {
  initFilesWorkspaceListeners()
  const p = source.profile
  const endpoint = describeFileEndpoint({
    protocol: p.protocol,
    host: p.host ?? '',
    port: p.port ?? 0,
    options: p.options ?? {}
  })
  await connectFileSource({
    title: p.name || endpoint,
    subtitle: endpoint,
    protocol: p.protocol,
    sourceKind: 'adhoc',
    source
  })
}

async function connectFileSource(input: {
  title: string
  subtitle: string
  protocol: FileProtocol
  sourceKind: 'file-profile' | 'adhoc'
  profileId?: string
  profile?: FileProfile
  source: FileConnectSource
}): Promise<void> {
  filesSecretPrompt.value = null
  const tabId = `ft-${crypto.randomUUID()}`
  const tab: FileWorkspaceTab = {
    id: tabId,
    title: input.title,
    subtitle: input.subtitle,
    protocol: input.protocol,
    sourceKind: input.sourceKind,
    profileId: input.profileId,
    capabilities: {
      chmod: false,
      symlinks: false,
      realDirectories: true,
      rename: true,
      resume: false,
      posixMetadata: false
    },
    state: 'connecting',
    currentPath: '/',
    entries: [],
    loading: true,
    error: ''
  }
  fileTabs.value = [...fileTabs.value, tab]
  activeFileTabId.value = tabId

  try {
    const connected = await window.orbit.files.connect(input.source)
    if (!fileTabs.value.some((t) => t.id === tabId)) {
      void window.orbit.files.close(connected.sessionId).catch(() => {})
      return
    }
    updateTab(tabId, {
      sessionId: connected.sessionId,
      capabilities: connected.capabilities,
      currentPath: connected.home,
      state: 'running',
      loading: false
    })
    await refreshFileDirectory(tabId, connected.home)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (input.profile && /认证或权限校验失败|无法解锁已保存的凭据/i.test(msg)) {
      await closeFileTab(tabId)
      filesSecretPrompt.value = {
        kind: 'file-profile',
        protocol: input.profile.protocol,
        name: input.profile.name,
        endpoint: describeFileEndpoint(input.profile),
        profile: input.profile,
        error: msg
      }
      return
    }
    updateTab(tabId, { state: 'error', loading: false, error: msg })
  }
}

export async function goParentDirectory(): Promise<void> {
  const tab = activeFileTab.value
  if (!tab || tab.state !== 'running') return
  const next = parentRemotePosixPath(tab.currentPath)
  await refreshFileDirectory(tab.id, next)
}

export async function goHomeDirectory(): Promise<void> {
  const tab = activeFileTab.value
  if (!tab || !tab.sessionId || tab.state !== 'running') return
  const api = getTransferApi(tab.protocol)
  const home = await api.home(tab.sessionId)
  await refreshFileDirectory(tab.id, home)
}

export async function createRemoteDirectory(name: string): Promise<void> {
  const tab = activeFileTab.value
  if (!tab || !tab.sessionId || tab.state !== 'running') return
  const clean = name.trim()
  if (!clean) return
  if (clean.includes('/') || clean.includes('\\')) {
    throw new Error(t('filesPage.invalidNameSlash'))
  }
  const api = getTransferApi(tab.protocol)
  await api.mkdir(tab.sessionId, joinRemotePosixPath(tab.currentPath, clean))
  await refreshFileDirectory(tab.id, tab.currentPath)
}

export async function renameRemoteEntry(entry: SftpEntry, nextName: string): Promise<void> {
  const tab = activeFileTab.value
  if (!tab || !tab.sessionId || tab.state !== 'running') return
  const clean = nextName.trim()
  if (!clean || clean === entry.name) return
  if (clean.includes('/') || clean.includes('\\')) {
    throw new Error(t('filesPage.invalidNameSlash'))
  }
  const api = getTransferApi(tab.protocol)
  const parent = parentRemotePosixPath(entry.path)
  await api.rename(tab.sessionId, entry.path, joinRemotePosixPath(parent, clean))
  await refreshFileDirectory(tab.id, tab.currentPath)
}

export async function chmodRemoteEntry(entry: SftpEntry, mode: number): Promise<void> {
  const tab = activeFileTab.value
  if (!tab || !tab.sessionId || tab.state !== 'running' || !tab.capabilities.chmod) return
  const api = getTransferApi(tab.protocol)
  await api.chmod(tab.sessionId, entry.path, mode)
  await refreshFileDirectory(tab.id, tab.currentPath)
}

export async function deleteRemoteEntry(entry: SftpEntry): Promise<void> {
  await deleteRemoteEntries([entry])
}

export async function deleteRemoteEntries(entries: SftpEntry[]): Promise<void> {
  const tab = activeFileTab.value
  if (!tab || !tab.sessionId || tab.state !== 'running' || !entries.length) return
  const api = getTransferApi(tab.protocol)
  for (const entry of entries) {
    const recursive = entry.kind === 'directory' || entry.targetKind === 'directory'
    await api.remove(tab.sessionId, entry.path, recursive)
  }
  await refreshFileDirectory(tab.id, tab.currentPath)
}

function askConflictDecision(
  direction: SftpTransferDirection,
  name: string,
  targetPath: string
): Promise<UploadConflictChoice> {
  return new Promise((resolve) => {
    filesConflictPrompt.value = {
      direction,
      name,
      targetPath,
      resolve: (choice) => {
        filesConflictPrompt.value = null
        resolve(choice)
      }
    }
  })
}

function enqueueTransfer(job: QueuedFileJob, totalBytes: number): void {
  const name = job.remotePath.split('/').pop() || job.localPath.split(/[/\\]/).pop() || 'file'
  const now = Date.now()
  activeTransferTabIds.set(job.id, job.tabId)
  const entry: FileWorkspaceTransfer = {
    id: job.id,
    sessionId: job.sessionId,
    tabId: job.tabId,
    protocol: job.protocol,
    direction: job.direction,
    name,
    localPath: job.localPath,
    remotePath: job.remotePath,
    totalBytes,
    transferredBytes: 0,
    speedBps: 0,
    status: 'queued',
    startedAt: now,
    updatedAt: now
  }
  fileTransfers.value = trimTransferHistory([entry, ...fileTransfers.value])
  pendingJobs.push(job)
  pumpQueue()
}

function pumpQueue(): void {
  const maxConcurrent = Math.max(1, Math.min(8, protocolSettings.value.files.maxConcurrentTransfers || 3))
  while (runningJobCount < maxConcurrent && pendingJobs.length > 0) {
    const job = pendingJobs.shift()!
    const item = fileTransfers.value.find((transfer) => transfer.id === job.id)
    if (item) item.status = 'running'
    runningJobCount++
    const api = getTransferApi(job.protocol)
    const call =
      job.direction === 'upload'
        ? api.upload({
            transferId: job.id,
            sessionId: job.sessionId,
            localPath: job.localPath,
            remotePath: job.remotePath,
            conflict: job.conflict
          })
        : api.download({
            transferId: job.id,
            sessionId: job.sessionId,
            remotePath: job.remotePath,
            localPath: job.localPath,
            conflict: job.conflict
          })

    void call
      .then((item) => {
        applyTransferProgress({
          transferId: item.id,
          sessionId: item.sessionId,
          direction: item.direction,
          name: item.name,
          localPath: item.localPath,
          remotePath: item.remotePath,
          totalBytes: item.totalBytes,
          transferredBytes: item.transferredBytes,
          speedBps: 0,
          status: item.status
        })
        if (job.direction === 'upload') {
          const parentDir = parentRemotePosixPath(item.remotePath)
          scheduleTabRefresh(job.tabId, parentDir)
        }
      })
      .catch((error) => {
        const msg = error instanceof Error ? error.message : String(error)
        const existing = fileTransfers.value.find((t) => t.id === job.id)
        const aborted = /取消|cancel/i.test(msg)
        applyTransferProgress({
          transferId: job.id,
          sessionId: job.sessionId,
          direction: job.direction,
          name: existing?.name ?? 'file',
          localPath: job.localPath,
          remotePath: job.remotePath,
          totalBytes: existing?.totalBytes ?? 0,
          transferredBytes: existing?.transferredBytes ?? 0,
          speedBps: 0,
          status: aborted ? 'cancelled' : 'failed',
          error: msg
        })
      })
      .finally(() => {
        activeTransferTabIds.delete(job.id)
        runningJobCount = Math.max(0, runningJobCount - 1)
        pumpQueue()
      })
  }
}

export async function uploadLocalPathsToActiveTab(localPaths: string[]): Promise<void> {
  const tab = activeFileTab.value
  if (!tab || !tab.sessionId || tab.state !== 'running' || !localPaths.length) return
  const sessionId = tab.sessionId
  const api = getTransferApi(tab.protocol)
  const baseDir = tab.currentPath
  const knownRootPaths = new Set(tab.entries.map((entry) => entry.path))
  const manifest = await window.orbit.sftp.expandLocalUploads(localPaths)
  if (manifest.skippedSymlinks > 0) {
    notify(t('sftp.skippedLocalSymlinks', { count: manifest.skippedSymlinks }))
  }
  const uploads = await planUploads(
    manifest.files,
    baseDir,
    protocolSettings.value.files.defaultConflict,
    async (file, path) => {
      if (!file.relativePath.includes('/')) return knownRootPaths.has(path)
      const result = await api.stat(sessionId, path).catch(() => ({ exists: false }))
      return result.exists
    },
    (file, path) => askConflictDecision('upload', file.name, path)
  )
  const sessionIsOpen = () =>
    fileTabs.value.some(
      (item) => item.id === tab.id && item.sessionId === sessionId && item.state === 'running'
    )
  if (!uploads || !sessionIsOpen()) return

  if (tab.capabilities.realDirectories) {
    for (const relDir of manifest.dirs) {
      await api.mkdir(sessionId, joinRemotePosixPath(baseDir, relDir))
    }
  }

  if (!sessionIsOpen()) return
  for (const file of uploads) {
    enqueueTransfer(
      {
        id: crypto.randomUUID(),
        tabId: tab.id,
        sessionId,
        protocol: tab.protocol,
        direction: 'upload',
        localPath: file.localPath,
        remotePath: file.remotePath,
        conflict: file.conflict
      },
      file.size
    )
  }

  if (manifest.dirs.length > 0) {
    scheduleTabRefresh(tab.id, baseDir)
  }
}

export async function downloadEntriesFromActiveTab(entries: SftpEntry[]): Promise<void> {
  const tab = activeFileTab.value
  if (!tab || !tab.sessionId || tab.state !== 'running' || !entries.length) return
  const sessionId = tab.sessionId
  const api = getTransferApi(tab.protocol)

  if (entries.length === 1 && entries[0]!.kind !== 'directory' && entries[0]!.targetKind !== 'directory') {
    const single = entries[0]!
    const targetFile = await window.orbit.sftp.pickDownloadFile(single.name)
    if (!targetFile) return
    enqueueTransfer(
      {
        id: crypto.randomUUID(),
        tabId: tab.id,
        sessionId,
        protocol: tab.protocol,
        direction: 'download',
        localPath: targetFile,
        remotePath: single.path,
        conflict: 'overwrite'
      },
      single.size
    )
    return
  }

  const destDir = await window.orbit.sftp.pickDownloadDir()
  if (!destDir) return
  const sep = destDir.includes('\\') ? '\\' : '/'
  const joinLocal = (root: string, rel: string) =>
    root.endsWith(sep) ? `${root}${rel.replaceAll('/', sep)}` : `${root}${sep}${rel.replaceAll('/', sep)}`
  const decision: SftpConflictDecision =
    protocolSettings.value.files.defaultConflict === 'ask'
      ? 'rename'
      : protocolSettings.value.files.defaultConflict
  let skippedSymlinks = 0

  for (const entry of entries) {
    const safeName = sanitizeDownloadFilename(entry.name)
    if (entry.kind === 'directory' || entry.targetKind === 'directory') {
      const manifest = await api.collectTree(sessionId, entry.path)
      skippedSymlinks += manifest.skippedSymlinks
      for (const file of manifest.files) {
        const safeRel = file.relativePath
          .split('/')
          .map((seg) => sanitizeDownloadFilename(seg))
          .join('/')
        enqueueTransfer(
          {
            id: crypto.randomUUID(),
            tabId: tab.id,
            sessionId,
            protocol: tab.protocol,
            direction: 'download',
            localPath: joinLocal(destDir, `${safeName}/${safeRel}`),
            remotePath: file.remotePath,
            conflict: decision
          },
          file.size
        )
      }
    } else {
      enqueueTransfer(
        {
          id: crypto.randomUUID(),
          tabId: tab.id,
          sessionId,
          protocol: tab.protocol,
          direction: 'download',
          localPath: joinLocal(destDir, safeName),
          remotePath: entry.path,
          conflict: decision
        },
        entry.size
      )
    }
  }
  if (skippedSymlinks > 0) {
    notify(t('sftp.skippedRemoteSymlinks', { count: skippedSymlinks }))
  }
}

export async function cancelFileTransfer(item: FileWorkspaceTransfer): Promise<void> {
  const pendingIdx = pendingJobs.findIndex((j) => j.id === item.id)
  if (pendingIdx >= 0) {
    pendingJobs.splice(pendingIdx, 1)
    applyTransferProgress({
      transferId: item.id,
      sessionId: item.sessionId,
      direction: item.direction,
      name: item.name,
      localPath: item.localPath,
      remotePath: item.remotePath,
      totalBytes: item.totalBytes,
      transferredBytes: item.transferredBytes,
      speedBps: 0,
      status: 'cancelled',
      error: t('filesPage.statusCancelled')
    })
    return
  }
  const api = getTransferApi(item.protocol)
  await api.cancelTransfer(item.sessionId, item.id).catch(() => {})
}

export function retryFileTransfer(item: FileWorkspaceTransfer): void {
  const matchingTab =
    fileTabs.value.find((t) => t.id === item.tabId && t.state === 'running' && t.sessionId) ??
    activeFileTab.value
  const sessionId =
    matchingTab?.state === 'running' && matchingTab.sessionId && matchingTab.protocol === item.protocol
      ? matchingTab.sessionId
      : item.sessionId
  const tabId = matchingTab?.id ?? item.tabId
  const newId = crypto.randomUUID()
  fileTransfers.value = fileTransfers.value.filter((t) => t.id !== item.id)
  enqueueTransfer(
    {
      id: newId,
      tabId,
      sessionId,
      protocol: item.protocol,
      direction: item.direction,
      localPath: item.localPath,
      remotePath: item.remotePath,
      conflict: 'overwrite'
    },
    item.totalBytes
  )
}

export function clearFinishedFileTransfers(): void {
  for (const item of fileTransfers.value) {
    if (item.status !== 'queued' && item.status !== 'running') {
      activeTransferTabIds.delete(item.id)
    }
  }
  fileTransfers.value = fileTransfers.value.filter(
    (item) => item.status === 'queued' || item.status === 'running'
  )
}
