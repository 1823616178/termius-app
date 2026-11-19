import {
  bootstrap,
  clearWorkbenchStateTimers,
  dismissStaleTrust,
  fileProfiles,
  hosts,
  initError,
  knownRdpHosts,
  maximized,
  nextPromptAttempt,
  notify,
  page,
  prompt,
  protocolSettings,
  rdpProbe,
  rdpProfiles,
  settingsDomain,
  syncGroups,
  syncStatus,
  syncTunnels,
  syncWriteMode,
  trayState,
  trustQueue,
  updateState
} from './workbench-state'
import type { FileProfile, FileProfileInput, ProtocolSettingsPatch } from '../../../shared/files'
import type { KnownRdpHostEntry, RdpEnvironmentProbe, RdpProfile, RdpProfileInput } from '../../../shared/rdp'
import { locale } from '../services/i18n'
import { disposeMotionMediaListener, loadSystemFonts } from './workbench-preferences'
import { refreshKnownHosts, refreshTunnelStatuses } from './workbench-hosts'
import { defaultShellProfile, openLocal } from './workbench-tabs'

export * from './workbench-state'
export * from './workbench-preferences'
export * from './workbench-hosts'
export * from './workbench-tabs'

let removeTrust: (() => void) | undefined
let removeSessionFailure: (() => void) | undefined
let removeMaximized: (() => void) | undefined
let removeSyncStatus: (() => void) | undefined
let removeSyncData: (() => void) | undefined
let removeTrayStateChanged: (() => void) | undefined
let removeTrayAction: (() => void) | undefined
let removeUpdateStateChanged: (() => void) | undefined

function listStamp(items: ReadonlyArray<{ id: string; updatedAt?: string | number }> | undefined): string {
  if (!items) return ''
  let stamp = String(items.length)
  for (const item of items) stamp += `\n${item.id}\t${item.updatedAt ?? ''}`
  return stamp
}

function assignStamped<T>(target: { value: T }, next: T, stamp: string, previous: { stamp: string }): void {
  if (previous.stamp === stamp) return
  previous.stamp = stamp
  target.value = next
}

export async function initialize(): Promise<void> {
  initError.value = ''
  try {
    bootstrap.value = await window.orbit.bootstrap()
    hosts.value = bootstrap.value.hosts
    fileProfiles.value = bootstrap.value.fileProfiles ?? []
    rdpProfiles.value = bootstrap.value.rdpProfiles ?? []
    knownRdpHosts.value = bootstrap.value.knownRdpHosts ?? []
    if (bootstrap.value.rdpProbe) rdpProbe.value = bootstrap.value.rdpProbe
    if (bootstrap.value.protocolSettings) protocolSettings.value = bootstrap.value.protocolSettings
    syncGroups.value = bootstrap.value.groups
    syncTunnels.value = bootstrap.value.tunnels
    syncStatus.value = bootstrap.value.sync
    if (bootstrap.value.sync?.writeMode) {
      syncWriteMode.value = bootstrap.value.sync.writeMode
    }
    maximized.value = bootstrap.value.maximized
    if (bootstrap.value.tray) trayState.value = bootstrap.value.tray
    if (bootstrap.value.update) updateState.value = bootstrap.value.update
    void window.orbit?.locale?.set?.(locale.value).catch(() => {})
    void loadSystemFonts(false)
    void refreshTunnelStatuses()
    void refreshKnownHosts()
    if (!removeTrust) {
      removeTrust = window.orbit.onTrust((trust) => {
        if (prompt.value) {
          trustQueue.value.push(trust)
          return
        }
        prompt.value = { kind: 'trust', trust, attempt: nextPromptAttempt() }
      })
    }
    if (!removeSessionFailure) {
      removeSessionFailure = window.orbit.onSessionFailure((event) => {
        dismissStaleTrust(event.id)
      })
    }
    if (!removeMaximized) {
      removeMaximized = window.orbit.window.onMaximized((state) => {
        maximized.value = state
      })
    }
    if (!removeSyncStatus) {
      removeSyncStatus = window.orbit.sync.onStatusChanged((status) => {
        syncStatus.value = status
        if (status?.writeMode) syncWriteMode.value = status.writeMode
      })
    }
    if (!removeSyncData) {
      const seen = {
        hosts: { stamp: listStamp(hosts.value) },
        groups: { stamp: listStamp(syncGroups.value) },
        tunnels: { stamp: listStamp(syncTunnels.value) },
        files: { stamp: listStamp(fileProfiles.value) },
        rdp: { stamp: listStamp(rdpProfiles.value) },
        known: {
          stamp: knownRdpHosts.value
            .map((item) => `${item.id}\t${item.fingerprint}\t${item.acceptedAt}`)
            .join('\n')
        },
        settings: { stamp: JSON.stringify(protocolSettings.value) }
      }
      removeSyncData = window.orbit.sync.onDataChanged((data) => {
        assignStamped(hosts, data.hosts, listStamp(data.hosts), seen.hosts)
        assignStamped(syncGroups, data.groups, listStamp(data.groups), seen.groups)
        assignStamped(syncTunnels, data.tunnels, listStamp(data.tunnels), seen.tunnels)
        if (data.fileProfiles !== undefined) {
          assignStamped(fileProfiles, data.fileProfiles, listStamp(data.fileProfiles), seen.files)
        }
        if (data.rdpProfiles !== undefined) {
          assignStamped(rdpProfiles, data.rdpProfiles, listStamp(data.rdpProfiles), seen.rdp)
        }
        if (data.knownRdpHosts !== undefined) {
          const stamp = data.knownRdpHosts
            .map((item) => `${item.id}\t${item.fingerprint}\t${item.acceptedAt}`)
            .join('\n')
          assignStamped(knownRdpHosts, data.knownRdpHosts, stamp, seen.known)
        }
        if (data.protocolSettings !== undefined) {
          assignStamped(
            protocolSettings,
            data.protocolSettings,
            JSON.stringify(data.protocolSettings),
            seen.settings
          )
        }
      })
    }
    if (!removeTrayStateChanged) {
      removeTrayStateChanged = window.orbit.tray.onStateChanged((state) => {
        trayState.value = state
      })
    }
    if (!removeTrayAction) {
      removeTrayAction = window.orbit.tray.onAction((action) => {
        if (action === 'new-local') {
          if (defaultShellProfile.value) openLocal(defaultShellProfile.value)
          else page.value = 'local'
        } else if (action === 'open-hosts') {
          page.value = 'hosts'
        } else if (action === 'open-tunnels') {
          page.value = 'tunnels'
        } else if (action === 'open-settings') {
          page.value = 'settings'
        }
      })
    }
    if (!removeUpdateStateChanged) {
      removeUpdateStateChanged = window.orbit.update.onStateChanged((next) => {
        const previousPhase = updateState.value.phase
        updateState.value = next
        if (previousPhase !== 'downloaded' && next.phase === 'downloaded' && next.latest) {
          notify(
            locale.value === 'en-US'
              ? `Update v${next.latest.version} downloaded & verified. Open Settings to install.`
              : `新版本 v${next.latest.version} 已下载并校验完成，前往设置即可安装`
          )
        }
      })
    }
  } catch (error) {
    initError.value =
      error instanceof Error
        ? error.message
        : locale.value === 'en-US'
          ? 'Failed to read local data'
          : '读取本地数据失败'
  }
}

export async function saveFileProfile(input: FileProfileInput): Promise<FileProfile[]> {
  const next = await window.orbit.fileProfiles.save(input)
  fileProfiles.value = next
  return next
}

export async function removeFileProfile(id: string): Promise<FileProfile[]> {
  const next = await window.orbit.fileProfiles.remove(id)
  fileProfiles.value = next
  return next
}

export async function patchProtocolSettings(patch: ProtocolSettingsPatch): Promise<void> {
  protocolSettings.value = await window.orbit.protocolSettings.patch(patch)
  if (patch.namespace === 'rdp') {
    void refreshRdpProbe(true)
  }
}

export async function saveRdpProfile(input: RdpProfileInput): Promise<RdpProfile[]> {
  const next = await window.orbit.rdp.saveProfile(input)
  rdpProfiles.value = next
  return next
}

export async function removeRdpProfile(id: string): Promise<RdpProfile[]> {
  const next = await window.orbit.rdp.removeProfile(id)
  rdpProfiles.value = next
  return next
}

export async function refreshRdpProbe(refresh = true): Promise<RdpEnvironmentProbe> {
  const next = await window.orbit.rdp.probe(refresh)
  rdpProbe.value = next
  return next
}

export async function refreshKnownRdpHosts(): Promise<KnownRdpHostEntry[]> {
  const next = await window.orbit.rdp.listKnownHosts()
  knownRdpHosts.value = next
  return next
}

export async function removeKnownRdpHost(id: string): Promise<KnownRdpHostEntry[]> {
  const next = await window.orbit.rdp.removeKnownHost(id)
  knownRdpHosts.value = next
  return next
}

export function openSettingsDomain(domain: 'general' | 'ssh' | 'files' | 'rdp'): void {
  settingsDomain.value = domain
  page.value = 'settings'
}

export function disposeWorkbenchListeners(): void {
  removeTrust?.()
  removeTrust = undefined
  removeSessionFailure?.()
  removeSessionFailure = undefined
  removeMaximized?.()
  removeMaximized = undefined
  removeSyncStatus?.()
  removeSyncStatus = undefined
  removeSyncData?.()
  removeSyncData = undefined
  removeTrayStateChanged?.()
  removeTrayStateChanged = undefined
  removeTrayAction?.()
  removeTrayAction = undefined
  removeUpdateStateChanged?.()
  removeUpdateStateChanged = undefined
  disposeMotionMediaListener()
  clearWorkbenchStateTimers()
}
