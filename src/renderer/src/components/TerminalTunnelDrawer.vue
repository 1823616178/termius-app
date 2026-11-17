<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Play, Plus, Square, Trash2 } from '@lucide/vue'
import { instanceClass } from '../../../shared/classes'
import type { SyncTunnel } from '../../../shared/sync'
import {
  checkPortOccupancy,
  hosts,
  notify,
  portCheckResults,
  probeConnectivity,
  probeResults,
  removeSyncTunnel,
  saveSyncTunnel,
  toggleTunnelRuntime,
  tunnelBusy,
  tunnelStatuses
} from '../stores/workbench'
import OrbitSelect from './OrbitSelect.vue'

const quickFwdTypeOptions = [
  { value: 'L', label: '-L 本地转发' },
  { value: 'R', label: '-R 远端转发' },
  { value: 'D', label: '-D SOCKS5' }
]

const props = defineProps<{
  token: string
  hostId?: string
  tunnels: SyncTunnel[]
}>()

const quickFwdType = ref<'L' | 'R' | 'D'>('L')
const quickFwdListenPort = ref(1080)
const quickFwdDestHost = ref('127.0.0.1')
const quickFwdDestPort = ref(8080)
const probeHostInput = ref('')
const probePortInput = ref(22)

const paneHost = computed(() =>
  props.hostId ? hosts.value.find((item) => item.id === props.hostId) : undefined
)

const c = (base: string, suffix?: string) =>
  instanceClass(base, suffix ? `${props.token}-${suffix}` : props.token)

watch(
  paneHost,
  (h) => {
    if (h) {
      probeHostInput.value = h.address
      probePortInput.value = h.port
    } else if (!probeHostInput.value) {
      probeHostInput.value = '127.0.0.1'
      probePortInput.value = 22
    }
  },
  { immediate: true }
)

async function runPaneConnectivityTest(): Promise<void> {
  const target = probeHostInput.value.trim() || paneHost.value?.address || '127.0.0.1'
  const port = Number(probePortInput.value) || paneHost.value?.port || 22
  const res = await probeConnectivity(target, port, `pane:${props.token}`)
  notify(res.reachable ? `${target}:${port} 连通 (${res.latencyMs} ms)` : res.message)
}

async function runPanePortCheck(): Promise<void> {
  const res = await checkPortOccupancy('127.0.0.1', Number(quickFwdListenPort.value), `pane:${props.token}`)
  notify(res.message)
}

async function createAndStartPaneTunnel(): Promise<void> {
  const sid = props.hostId ?? hosts.value[0]?.id
  if (!sid) {
    notify('请先在主机库添加 SSH 服务器再创建端口转发')
    return
  }
  await saveSyncTunnel({
    name: `终端转发-${quickFwdType.value}-${quickFwdListenPort.value}`,
    serverId: sid,
    groupId: null,
    type: quickFwdType.value,
    listenHost: '127.0.0.1',
    listenPort: Number(quickFwdListenPort.value),
    destHost: quickFwdType.value === 'D' ? '127.0.0.1' : quickFwdDestHost.value.trim() || '127.0.0.1',
    destPort: quickFwdType.value === 'D' ? 0 : Number(quickFwdDestPort.value),
    autoReconnect: true,
    enabled: false
  })
}
</script>

<template>
  <div :class="c('container_workspace_terminal_tunnel_drawer')">
    <div :class="c('container_workspace_terminal_tunnel_proberow')">
      <span :class="c('container_workspace_terminal_tunnel_label')">连通/端口检测</span>
      <input
        v-model="probeHostInput"
        :class="c('container_workspace_terminal_tunnel_probehost')"
        type="text"
        placeholder="目标地址"
      />
      <input
        v-model.number="probePortInput"
        :class="c('container_workspace_terminal_tunnel_probeport')"
        type="number"
        min="1"
        max="65535"
      />
      <button
        :class="c('container_workspace_terminal_tunnel_probebtn')"
        type="button"
        @click="runPaneConnectivityTest"
      >
        测试连通
      </button>
      <button
        :class="c('container_workspace_terminal_tunnel_checkport')"
        type="button"
        @click="runPanePortCheck"
      >
        测本地端口 {{ quickFwdListenPort }}
      </button>
      <span v-if="probeResults[`pane:${token}`]" :class="c('container_workspace_terminal_tunnel_proberes')">
        {{ probeResults[`pane:${token}`]?.message }}
      </span>
      <span
        v-if="portCheckResults[`pane:${token}`]"
        :class="c('container_workspace_terminal_tunnel_portres')"
      >
        {{ portCheckResults[`pane:${token}`]?.message }}
      </span>
    </div>
    <div :class="c('container_workspace_terminal_tunnel_quickadd')">
      <OrbitSelect
        :model-value="quickFwdType"
        :options="quickFwdTypeOptions"
        aria-label="转发模式"
        size="sm"
        width="132px"
        :instance="`pane-fwd-${token}`"
        @update:model-value="quickFwdType = $event as 'L' | 'R' | 'D'"
      />
      <input
        v-model.number="quickFwdListenPort"
        :class="c('container_workspace_terminal_tunnel_lport')"
        type="number"
        min="1"
        max="65535"
        placeholder="本地端口"
      />
      <input
        v-if="quickFwdType !== 'D'"
        v-model="quickFwdDestHost"
        :class="c('container_workspace_terminal_tunnel_dhost')"
        type="text"
        placeholder="目标地址"
      />
      <input
        v-if="quickFwdType !== 'D'"
        v-model.number="quickFwdDestPort"
        :class="c('container_workspace_terminal_tunnel_dport')"
        type="number"
        min="1"
        max="65535"
        placeholder="目标端口"
      />
      <button
        :class="c('container_workspace_terminal_tunnel_addbtn')"
        type="button"
        data-primary="true"
        @click="createAndStartPaneTunnel"
      >
        <Plus :size="12" />
        添加转发
      </button>
    </div>
    <div v-if="tunnels.length" :class="c('container_workspace_terminal_tunnel_list')">
      <div v-for="t in tunnels" :key="t.id" :class="c('container_workspace_terminal_tunnel_item', t.id)">
        <span :class="c('container_workspace_terminal_tunnel_badge', t.id)">-{{ t.type }}</span>
        <span :class="c('container_workspace_terminal_tunnel_name', t.id)">
          {{ t.name }}
        </span>
        <code :class="c('container_workspace_terminal_tunnel_route', t.id)">
          {{ t.listenHost }}:{{ t.listenPort }} →
          {{ t.type === 'D' ? 'SOCKS5' : `${t.destHost}:${t.destPort}` }}
        </code>
        <button
          :class="c('container_workspace_terminal_tunnel_toggle', t.id)"
          type="button"
          :data-primary="!tunnelStatuses[t.id]?.active"
          :data-danger="Boolean(tunnelStatuses[t.id]?.active)"
          :disabled="Boolean(tunnelBusy[t.id])"
          @click="toggleTunnelRuntime(t.id, !tunnelStatuses[t.id]?.active)"
        >
          <Square v-if="tunnelStatuses[t.id]?.active" :size="11" />
          <Play v-else :size="11" />
          {{ tunnelStatuses[t.id]?.active ? '停止' : '启动' }}
        </button>
        <button
          :class="c('container_workspace_terminal_tunnel_portbtn', t.id)"
          type="button"
          @click="
            checkPortOccupancy(t.listenHost, t.listenPort, `pane:${token}`).then((r) => notify(r.message))
          "
        >
          测端口
        </button>
        <button
          :class="c('container_workspace_terminal_tunnel_del', t.id)"
          type="button"
          data-danger="true"
          :disabled="Boolean(tunnelBusy[t.id])"
          :aria-label="`删除 ${t.name}`"
          title="删除转发规则"
          @click="removeSyncTunnel(t.id)"
        >
          <Trash2 :size="11" />
          删除
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
[class*='container_workspace_terminal_tunnel_drawer'] {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 9px 12px;
  background: var(--color-surface-1);
  border-bottom: 1px solid var(--color-border);
  font-size: 12px;
  input {
    padding: 4px 8px;
    font-size: 12px;
  }
  button:not([role='combobox']):not([role='option']) {
    min-height: 26px;
    padding: 3px 8px;
    font-size: 11px;
  }
}
[class*='container_workspace_terminal_tunnel_proberow'],
[class*='container_workspace_terminal_tunnel_quickadd'] {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
[class*='container_workspace_terminal_tunnel_probeport'],
[class*='container_workspace_terminal_tunnel_lport'],
[class*='container_workspace_terminal_tunnel_dport'] {
  width: 78px;
}
[class*='container_workspace_terminal_tunnel_list'] {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
[class*='container_workspace_terminal_tunnel_item'] {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 6px;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border-subtle);
  flex-wrap: wrap;
}
[class*='container_workspace_terminal_tunnel_route'] {
  font-family: var(--font-mono);
  color: var(--color-accent-secondary);
}
</style>
