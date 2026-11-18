import {
  bootstrap,
  clearWorkbenchStateTimers,
  dismissStaleTrust,
  fileProfiles,
  hosts,
  initError,
  maximized,
  nextPromptAttempt,
  notify,
  page,
  prompt,
  protocolSettings,
  syncGroups,
  syncStatus,
  syncTunnels,
  syncWriteMode,
  trayState,
  trustQueue,
  updateState
} from './workbench-state'
import type { FileProfile, FileProfileInput, ProtocolSettingsPatch } from '../../../shared/files'
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

export async function initialize(): Promise<void> {
  initError.value = ''
  try {
    bootstrap.value = await window.orbit.bootstrap()
    hosts.value = bootstrap.value.hosts
    fileProfiles.value = bootstrap.value.fileProfiles ?? []
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
      removeSyncData = window.orbit.sync.onDataChanged((data) => {
        hosts.value = data.hosts
        syncGroups.value = data.groups
        syncTunnels.value = data.tunnels
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
