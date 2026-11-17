import { computed } from 'vue'
import type {
  Host,
  HostInput,
  NetProbeResult,
  PortCheckResult,
  TunnelRuntimeStatus
} from '../../../shared/contracts'
import type { SyncGroupInput, SyncTunnelInput } from '../../../shared/sync'
import { recentHostIds, sortHostsByRecency } from '../services/host-recency'
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
  selected,
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

export const selectedHostDetails = computed(() => hosts.value.find((host) => host.id === selected.value))

export async function saveSyncGroup(input: SyncGroupInput): Promise<void> {
  syncGroups.value = await window.orbit.groups.save(input)
  notify('同步分组已保存')
}

export async function removeSyncGroup(id: string): Promise<void> {
  syncGroups.value = await window.orbit.groups.remove(id)
  syncTunnels.value = syncTunnels.value.map((item) =>
    item.groupId === id ? { ...item, groupId: null } : item
  )
  notify('同步分组已移除')
}

export async function saveSyncTunnel(input: SyncTunnelInput): Promise<void> {
  syncTunnels.value = await window.orbit.tunnels.save(input)
  await refreshTunnelStatuses()
  notify('端口转发规则已保存')
}

export async function removeSyncTunnel(id: string): Promise<void> {
  syncTunnels.value = await window.orbit.tunnels.remove(id)
  const nextStatuses = { ...tunnelStatuses.value }
  delete nextStatuses[id]
  tunnelStatuses.value = nextStatuses
  notify('端口转发规则已删除')
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
    notify(active ? '端口转发已启动并监听本地端口' : '端口转发已停止')
  } catch (error) {
    notify(error instanceof Error ? error.message : '切换端口转发状态失败')
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
  notify(`已移除 ${hostKey} 的主机指纹`)
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
      notify(error instanceof Error ? error.message : '更新同步写入模式失败')
      return
    }
  }
  notify(
    mode === 'realtime'
      ? '已切换为实时同步：增删改主机/分组/转发规则后将立即同步至服务端'
      : '已切换为仅保留本地修改：变更将仅保存在本机，不会自动上传到服务端'
  )
}

export async function refreshShells(): Promise<void> {
  if (shellsRefreshing.value || !bootstrap.value) return
  shellsRefreshing.value = true
  try {
    const updated = await window.orbit.shells.refresh()
    if (bootstrap.value) bootstrap.value = { ...bootstrap.value, shells: updated }
    notify(`已刷新本地终端，发现 ${updated.length} 项配置`)
  } catch (error) {
    notify(error instanceof Error ? error.message : '刷新本地终端失败')
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
  try {
    hosts.value = await window.orbit.hosts.save(input)
    editor.value = false
    notify('主机已保存到本机')
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : '保存失败，草稿已保留'
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
    notify(error instanceof Error ? error.message : '收藏保存失败')
  }
}
