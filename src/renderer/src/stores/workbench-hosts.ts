import { computed } from 'vue'
import type {
  Host,
  HostInput,
  NetProbeResult,
  PortCheckResult,
  TunnelRuntimeStatus
} from '../../../shared/contracts'
import type { SyncGroupInput, SyncTunnelInput } from '../../../shared/sync'
import { locale } from '../services/i18n'
import { markHostUsed, recentHostIds, sortHostsByRecency } from '../services/host-recency'
import {
  bootstrap,
  editing,
  editor,
  favorites,
  group,
  hosts,
  knownHosts,
  notify,
  portCheckResults,
  probeBusy,
  probeResults,
  query,
  saveBusy,
  saveError,
  shellsRefreshing,
  syncGroups,
  syncStatus,
  syncTunnels,
  syncWriteMode,
  tunnelBusy,
  tunnelStatuses
} from './workbench-state'

export const filteredHosts = computed(() => {
  const q = query.value.trim().toLowerCase()
  return sortHostsByRecency(
    hosts.value.filter(
      (host) =>
        (!favorites.value || host.favorite) &&
        (group.value === 'all' || host.group === group.value) &&
        (!q ||
          `${host.name} ${host.address}:${host.port} ${host.username} ${host.group} ${host.notes}`
            .toLowerCase()
            .includes(q))
    ),
    recentHostIds.value
  )
})

export const groups = computed(() =>
  [...new Set(hosts.value.map((host) => host.group).filter(Boolean))].sort()
)

export async function saveSyncGroup(input: SyncGroupInput): Promise<void> {
  syncGroups.value = await window.orbit.groups.save(input)
  notify(locale.value === 'en-US' ? 'Sync group saved' : '同步分组已保存')
}

export async function removeSyncGroup(id: string): Promise<void> {
  syncGroups.value = await window.orbit.groups.remove(id)
  syncTunnels.value = syncTunnels.value.map((item) =>
    item.groupId === id ? { ...item, groupId: null } : item
  )
  notify(locale.value === 'en-US' ? 'Sync group removed' : '同步分组已移除')
}

export async function saveSyncTunnel(input: SyncTunnelInput): Promise<void> {
  syncTunnels.value = await window.orbit.tunnels.save(input)
  await refreshTunnelStatuses()
  notify(locale.value === 'en-US' ? 'Port forwarding rule saved' : '端口转发规则已保存')
}

export async function removeSyncTunnel(id: string): Promise<void> {
  syncTunnels.value = await window.orbit.tunnels.remove(id)
  const nextStatuses = { ...tunnelStatuses.value }
  delete nextStatuses[id]
  tunnelStatuses.value = nextStatuses
  notify(locale.value === 'en-US' ? 'Port forwarding rule deleted' : '端口转发规则已删除')
}

export async function refreshTunnelStatuses(): Promise<void> {
  try {
    const list = await window.orbit.tunnels.statuses()
    const map: Record<string, TunnelRuntimeStatus> = {}
    for (const item of list) map[item.tunnelId] = item
    tunnelStatuses.value = map
  } catch {
    /* ignore background status refresh error */
  }
}

export async function toggleTunnelRuntime(id: string, active: boolean): Promise<void> {
  tunnelBusy.value = { ...tunnelBusy.value, [id]: true }
  try {
    const list = await window.orbit.tunnels.toggle({ id, active })
    const map: Record<string, TunnelRuntimeStatus> = {}
    for (const item of list) map[item.tunnelId] = item
    tunnelStatuses.value = map
    syncTunnels.value = syncTunnels.value.map((t) => (t.id === id ? { ...t, enabled: active } : t))
    notify(
      active
        ? locale.value === 'en-US'
          ? 'Port forwarding started and listening locally'
          : '端口转发已启动并监听本地端口'
        : locale.value === 'en-US'
          ? 'Port forwarding stopped'
          : '端口转发已停止'
    )
  } catch (error) {
    notify(
      error instanceof Error
        ? error.message
        : locale.value === 'en-US'
          ? 'Failed to toggle tunnel state'
          : '切换端口转发状态失败'
    )
  } finally {
    tunnelBusy.value = { ...tunnelBusy.value, [id]: false }
  }
}

export async function probeConnectivity(
  host: string,
  port: number,
  key = `${host}:${port}`
): Promise<NetProbeResult> {
  probeBusy.value = { ...probeBusy.value, [`net:${key}`]: true }
  try {
    const result = await window.orbit.net.probe({ host, port })
    probeResults.value = { ...probeResults.value, [key]: result }
    return result
  } finally {
    probeBusy.value = { ...probeBusy.value, [`net:${key}`]: false }
  }
}

export async function checkPortOccupancy(
  listenHost: string,
  listenPort: number,
  key = `${listenHost}:${listenPort}`
): Promise<PortCheckResult> {
  probeBusy.value = { ...probeBusy.value, [`port:${key}`]: true }
  try {
    const result = await window.orbit.net.checkPort({ listenHost, listenPort })
    portCheckResults.value = { ...portCheckResults.value, [key]: result }
    return result
  } finally {
    probeBusy.value = { ...probeBusy.value, [`port:${key}`]: false }
  }
}

export async function refreshKnownHosts(): Promise<void> {
  try {
    knownHosts.value = await window.orbit.knownHosts.list()
  } catch {
    /* ignore */
  }
}

export async function removeKnownHostEntry(hostKey: string): Promise<void> {
  knownHosts.value = await window.orbit.knownHosts.remove(hostKey)
  notify(
    locale.value === 'en-US' ? `Removed host fingerprint for ${hostKey}` : `已移除 ${hostKey} 的主机指纹`
  )
}

export async function setSyncWriteMode(mode: 'realtime' | 'local-only'): Promise<void> {
  syncWriteMode.value = mode
  try {
    localStorage.setItem('orbit:sync-write-mode', mode)
  } catch {
    /* ignore */
  }
  if (syncStatus.value?.signedIn) {
    try {
      const res = await window.orbit.sync.updatePreferences({
        writeMode: mode,
        ...(mode === 'realtime' ? { autoSync: true } : {})
      })
      syncStatus.value = res.status
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : locale.value === 'en-US'
            ? 'Failed to update sync write mode'
            : '更新同步写入模式失败'
      )
      return
    }
  }
  const en = locale.value === 'en-US'
  notify(
    mode === 'realtime'
      ? en
        ? 'Switched to Live Sync: host, group, and tunnel changes sync automatically'
        : '已切换为实时同步：增删改主机/分组/转发规则后将立即同步至服务端'
      : en
        ? 'Switched to Local-Only: changes stay on this device until synced manually'
        : '已切换为仅保留本地修改：变更将仅保存在本机，不会自动上传到服务端'
  )
}

export async function refreshShells(): Promise<void> {
  if (shellsRefreshing.value || !bootstrap.value) return
  shellsRefreshing.value = true
  const en = locale.value === 'en-US'
  try {
    const updated = await window.orbit.shells.refresh()
    if (bootstrap.value) bootstrap.value = { ...bootstrap.value, shells: updated }
    notify(
      en
        ? `Refreshed local shells: found ${updated.length} profile(s)`
        : `已刷新本地终端，发现 ${updated.length} 项配置`
    )
  } catch (error) {
    notify(
      error instanceof Error ? error.message : en ? 'Failed to refresh local shells' : '刷新本地终端失败'
    )
  } finally {
    shellsRefreshing.value = false
  }
}

export function openEditor(host?: Host): void {
  editing.value = host
  saveError.value = ''
  editor.value = true
}

export async function saveHost(input: HostInput): Promise<void> {
  if (saveBusy.value) return
  saveBusy.value = true
  saveError.value = ''
  const en = locale.value === 'en-US'
  const isNew = !input.id
  const previousIds = new Set(hosts.value.map((host) => host.id))
  try {
    const nextHosts = await window.orbit.hosts.save(input)
    if (isNew) {
      const normalizedName = input.name.trim().toLowerCase()
      const created =
        nextHosts.find((host) => !previousIds.has(host.id)) ??
        nextHosts.find((host) => host.name.toLowerCase() === normalizedName)
      if (created) markHostUsed(created.id)
    }
    hosts.value = nextHosts
    editor.value = false
    notify(en ? 'Host saved locally' : '主机已保存到本机')
  } catch (error) {
    saveError.value =
      error instanceof Error ? error.message : en ? 'Failed to save; draft kept' : '保存失败，草稿已保留'
  } finally {
    input.password = ''
    saveBusy.value = false
  }
}

export async function toggleFavorite(host: Host): Promise<void> {
  try {
    hosts.value = await window.orbit.hosts.save({
      id: host.id,
      name: host.name,
      address: host.address,
      port: host.port,
      username: host.username,
      auth: host.auth,
      keepalive: host.keepalive ?? 30,
      group: host.group,
      notes: host.notes,
      favorite: !host.favorite
    })
  } catch (error) {
    notify(
      error instanceof Error
        ? error.message
        : locale.value === 'en-US'
          ? 'Failed to update favorite'
          : '收藏保存失败'
    )
  }
}
