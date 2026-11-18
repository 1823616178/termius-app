<script setup lang="ts">
import { computed, ref } from 'vue'
import { Network, Play, Square, Activity, ShieldCheck, Plus, Trash2, Pencil, Server } from '@lucide/vue'
import { instanceClass } from '../../../shared/classes'
import type { SyncTunnel } from '../../../shared/sync'
import OrbitSelect from '../components/OrbitSelect.vue'
import { locale, t } from '../services/i18n'
import {
  checkPortOccupancy,
  hosts,
  notify,
  page,
  portCheckResults,
  probeBusy,
  probeConnectivity,
  probeResults,
  removeSyncTunnel,
  saveSyncTunnel,
  setSyncWriteMode,
  syncGroups,
  syncStatus,
  syncTunnels,
  syncWriteMode,
  toggleTunnelRuntime,
  tunnelBusy,
  tunnelStatuses,
  windowInstance
} from '../stores/workbench'

const c = (base: string, token: string) => instanceClass(base, windowInstance(token))

const editingId = ref<string | null>(null)
const formName = ref('')
const formServerId = ref('')
const formGroupId = ref('')
const formType = ref<'L' | 'R' | 'D'>('L')
const formListenHost = ref('127.0.0.1')
const formListenPort = ref(1080)
const formDestHost = ref('127.0.0.1')
const formDestPort = ref(8080)
const formAutoReconnect = ref(true)
const saving = ref(false)
const formError = ref('')

const probeHost = ref('127.0.0.1')
const probePort = ref(22)
const portCheckHost = ref('127.0.0.1')
const portCheckPort = ref(1080)

const activeCount = computed(() => Object.values(tunnelStatuses.value).filter((item) => item.active).length)

const serverOptions = computed(() => {
  void locale.value
  return hosts.value.length === 0
    ? [{ value: '', label: t('tunnels.noHostsOption') }]
    : hosts.value.map((h) => ({
        value: h.id,
        label: `${h.name} (${h.username}@${h.address}:${h.port})`
      }))
})

const tunnelTypeOptions = computed(() => {
  void locale.value
  return [
    { value: 'L', label: t('tunnels.modeL') },
    { value: 'R', label: t('tunnels.modeR') },
    { value: 'D', label: t('tunnels.modeD') }
  ]
})

const groupOptions = computed(() => {
  void locale.value
  return [
    { value: '', label: t('hosts.ungrouped') },
    ...syncGroups.value.map((g) => ({ value: g.id, label: g.name }))
  ]
})

const hostMap = computed(() => {
  const m = new Map<string, string>()
  for (const h of hosts.value) m.set(h.id, `${h.name} (${h.address})`)
  return m
})

function isTunnelActive(tunnel: SyncTunnel): boolean {
  return Boolean(tunnelStatuses.value[tunnel.id]?.active)
}

function tunnelRuntimeText(tunnel: SyncTunnel): string {
  const st = tunnelStatuses.value[tunnel.id]
  if (st?.active) {
    return t('tunnels.runningConns', { count: st.activeConnections })
  }
  return t('tunnels.stopped')
}

function effectiveServerId(): string {
  if (formServerId.value && hosts.value.some((h) => h.id === formServerId.value)) {
    return formServerId.value
  }
  return hosts.value[0]?.id ?? ''
}

function resetForm(): void {
  editingId.value = null
  formName.value = ''
  formType.value = 'L'
  formListenHost.value = '127.0.0.1'
  formListenPort.value = 1080
  formDestHost.value = '127.0.0.1'
  formDestPort.value = 8080
  formGroupId.value = ''
  formAutoReconnect.value = true
  formError.value = ''
}

function startEdit(tunnel: SyncTunnel): void {
  if (tunnel.readOnly) return
  editingId.value = tunnel.id
  formName.value = tunnel.name
  formServerId.value = tunnel.serverId
  formGroupId.value = tunnel.groupId ?? ''
  formType.value = tunnel.type === 'R' ? 'R' : tunnel.type === 'D' ? 'D' : 'L'
  formListenHost.value = tunnel.listenHost
  formListenPort.value = tunnel.listenPort
  formDestHost.value = tunnel.destHost
  formDestPort.value = tunnel.destPort
  formAutoReconnect.value = tunnel.autoReconnect
  formError.value = ''
}

async function handleSaveTunnel(): Promise<void> {
  const en = locale.value === 'en-US'
  formError.value = ''
  const sid = effectiveServerId()
  if (!sid) {
    formError.value = en
      ? 'Add at least one SSH server before creating a forwarding rule'
      : '请先添加至少一台 SSH 服务器，再创建端口转发规则'
    return
  }
  if (!formName.value.trim()) {
    formError.value = en ? 'Enter a forwarding rule name' : '请输入转发规则名称'
    return
  }
  saving.value = true
  try {
    await saveSyncTunnel({
      id: editingId.value ?? undefined,
      name: formName.value.trim(),
      serverId: sid,
      groupId: formGroupId.value || null,
      type: formType.value,
      listenHost: formListenHost.value.trim() || '127.0.0.1',
      listenPort: Number(formListenPort.value),
      destHost: formType.value === 'D' ? '127.0.0.1' : formDestHost.value.trim() || '127.0.0.1',
      destPort: formType.value === 'D' ? 0 : Number(formDestPort.value),
      autoReconnect: formAutoReconnect.value,
      enabled: editingId.value
        ? Boolean(syncTunnels.value.find((t) => t.id === editingId.value)?.enabled)
        : false
    })
    resetForm()
  } catch (err) {
    formError.value =
      err instanceof Error ? err.message : en ? 'Failed to save forwarding rule' : '保存端口转发规则失败'
  } finally {
    saving.value = false
  }
}

async function runManualProbe(): Promise<void> {
  const en = locale.value === 'en-US'
  try {
    const res = await probeConnectivity(probeHost.value.trim(), Number(probePort.value), 'manual')
    notify(
      res.reachable
        ? en
          ? `Reachable: ${res.latencyMs} ms`
          : `连通正常：${res.latencyMs} ms`
        : en
          ? `Probe failed: ${res.message}`
          : `探测失败：${res.message}`
    )
  } catch (err) {
    notify(err instanceof Error ? err.message : en ? 'Connectivity probe failed' : '连通性探测失败')
  }
}

async function runManualPortCheck(): Promise<void> {
  const en = locale.value === 'en-US'
  try {
    const res = await checkPortOccupancy(
      portCheckHost.value.trim() || '127.0.0.1',
      Number(portCheckPort.value),
      'manual'
    )
    notify(res.message)
  } catch (err) {
    notify(err instanceof Error ? err.message : en ? 'Port check failed' : '端口占用检测失败')
  }
}

async function checkTunnelPort(tunnel: SyncTunnel): Promise<void> {
  const en = locale.value === 'en-US'
  try {
    const res = await checkPortOccupancy(tunnel.listenHost, tunnel.listenPort, `tunnel:${tunnel.id}`)
    notify(res.message)
  } catch (err) {
    notify(err instanceof Error ? err.message : en ? 'Port check failed' : '端口检测失败')
  }
}

async function probeTunnelTarget(tunnel: SyncTunnel): Promise<void> {
  const en = locale.value === 'en-US'
  const host = hosts.value.find((h) => h.id === tunnel.serverId)
  const targetHost = tunnel.type === 'D' ? (host?.address ?? '127.0.0.1') : tunnel.destHost
  const targetPort = tunnel.type === 'D' ? (host?.port ?? 22) : tunnel.destPort
  try {
    const res = await probeConnectivity(targetHost, targetPort, `tunnel:${tunnel.id}`)
    notify(
      res.reachable
        ? en
          ? `${targetHost}:${targetPort} reachable (${res.latencyMs} ms)`
          : `${targetHost}:${targetPort} 连通 (${res.latencyMs} ms)`
        : `${targetHost}:${targetPort} ${res.message}`
    )
  } catch (err) {
    notify(err instanceof Error ? err.message : en ? 'Connectivity test failed' : '连通性测试失败')
  }
}
</script>

<template>
  <section v-if="page === 'tunnels'" class="container_tunnels_page_body_base">
    <header class="container_tunnels_page_header_base">
      <div class="container_tunnels_page_header_copy">
        <span class="container_tunnels_page_header_eyebrow">{{ t('tunnels.eyebrow') }}</span>
        <h2 class="container_tunnels_page_header_title">{{ t('tunnels.title') }}</h2>
        <p class="container_tunnels_page_header_description">
          {{ t('tunnels.description') }}
        </p>
      </div>
      <div class="container_tunnels_page_header_controls">
        <div class="container_tunnels_sync_mode_switch" role="group" :aria-label="t('hosts.syncModeAria')">
          <button
            class="container_tunnels_sync_mode_realtime"
            type="button"
            :data-active="syncWriteMode === 'realtime'"
            @click="setSyncWriteMode('realtime')"
          >
            {{ t('hosts.syncRealtime') }}
          </button>
          <button
            class="container_tunnels_sync_mode_local"
            type="button"
            :data-active="syncWriteMode === 'local-only'"
            @click="setSyncWriteMode('local-only')"
          >
            {{ t('hosts.syncLocalOnly') }}
          </button>
        </div>
        <div class="container_tunnels_header_stats_box">
          <span class="container_tunnels_header_stat_total">
            {{ t('tunnels.statsTotal', { count: syncTunnels.length }) }}
          </span>
          <span class="container_tunnels_header_stat_active" :data-has-active="activeCount > 0">
            {{ t('tunnels.statsActive', { count: activeCount }) }}
          </span>
        </div>
      </div>
    </header>

    <div class="container_tunnels_probe_workbench_grid">
      <article class="container_tunnels_probe_card_base">
        <div class="container_tunnels_probe_card_head">
          <Activity :size="16" />
          <h3 class="container_tunnels_probe_card_title">{{ t('tunnels.probeTitle') }}</h3>
        </div>
        <div class="container_tunnels_probe_form_row">
          <input
            v-model="probeHost"
            class="container_tunnels_probe_input_host"
            type="text"
            :placeholder="t('tunnels.probeHostPlaceholder')"
            :aria-label="t('tunnels.probeHostAria')"
          />
          <input
            v-model.number="probePort"
            class="container_tunnels_probe_input_port"
            type="number"
            min="1"
            max="65535"
            :placeholder="t('tunnels.probePortPlaceholder')"
            :aria-label="t('tunnels.probePortAria')"
          />
          <button
            class="container_tunnels_probe_action_btn"
            type="button"
            data-primary="true"
            :disabled="Boolean(probeBusy['net:manual'])"
            @click="runManualProbe"
          >
            {{ probeBusy['net:manual'] ? t('tunnels.testing') : t('tunnels.testConnectivity') }}
          </button>
        </div>
        <div
          v-if="probeResults['manual']"
          class="container_tunnels_probe_result_banner"
          :data-ok="probeResults['manual'].reachable"
        >
          <span class="container_tunnels_probe_result_badge">
            {{
              probeResults['manual'].reachable
                ? `${probeResults['manual'].latencyMs} ms`
                : t('hosts.unreachable')
            }}
          </span>
          <span class="container_tunnels_probe_result_msg">{{ probeResults['manual'].message }}</span>
        </div>
      </article>

      <article class="container_tunnels_portcheck_card_base">
        <div class="container_tunnels_portcheck_card_head">
          <ShieldCheck :size="16" />
          <h3 class="container_tunnels_portcheck_card_title">{{ t('tunnels.portCheckTitle') }}</h3>
        </div>
        <div class="container_tunnels_portcheck_form_row">
          <input
            v-model="portCheckHost"
            class="container_tunnels_portcheck_input_host"
            type="text"
            :placeholder="t('tunnels.portCheckHostPlaceholder')"
            :aria-label="t('tunnels.portCheckHostAria')"
          />
          <input
            v-model.number="portCheckPort"
            class="container_tunnels_portcheck_input_port"
            type="number"
            min="1"
            max="65535"
            :placeholder="t('tunnels.probePortPlaceholder')"
            :aria-label="t('tunnels.portCheckPortAria')"
          />
          <button
            class="container_tunnels_portcheck_action_btn"
            type="button"
            data-primary="true"
            :disabled="Boolean(probeBusy['port:manual'])"
            @click="runManualPortCheck"
          >
            {{ probeBusy['port:manual'] ? t('tunnels.checking') : t('hosts.checkPortOccupancy') }}
          </button>
        </div>
        <div
          v-if="portCheckResults['manual']"
          class="container_tunnels_portcheck_result_banner"
          :data-free="portCheckResults['manual'].available"
        >
          <span class="container_tunnels_portcheck_result_badge">
            {{
              portCheckResults['manual'].available
                ? t('tunnels.portFree')
                : portCheckResults['manual'].occupiedByOrbit
                  ? t('tunnels.portOrbit')
                  : t('tunnels.portBusy')
            }}
          </span>
          <span class="container_tunnels_portcheck_result_msg">{{ portCheckResults['manual'].message }}</span>
        </div>
      </article>
    </div>

    <article class="container_tunnels_editor_card_base">
      <div class="container_tunnels_editor_card_head">
        <Network :size="16" />
        <h3 class="container_tunnels_editor_card_title">
          {{ editingId ? t('tunnels.editRule') : t('tunnels.newRule') }}
        </h3>
        <span v-if="syncStatus?.signedIn" class="container_tunnels_editor_sync_hint">
          {{ syncWriteMode === 'realtime' ? t('tunnels.syncHintRealtime') : t('tunnels.syncHintLocal') }}
        </span>
      </div>
      <div class="container_tunnels_editor_form_grid">
        <label class="container_tunnels_editor_field_name">
          <span class="container_tunnels_editor_label_name">{{ t('tunnels.ruleName') }}</span>
          <input
            v-model="formName"
            class="container_tunnels_editor_input_name"
            type="text"
            :placeholder="t('tunnels.ruleNamePlaceholder')"
          />
        </label>
        <label class="container_tunnels_editor_field_server">
          <span class="container_tunnels_editor_label_server">{{ t('tunnels.jumpHost') }}</span>
          <OrbitSelect
            v-model="formServerId"
            :options="serverOptions"
            :aria-label="t('tunnels.jumpHost')"
            block
            instance="tunnels-server"
          />
        </label>
        <label class="container_tunnels_editor_field_type">
          <span class="container_tunnels_editor_label_type">{{ t('tunnels.mode') }}</span>
          <OrbitSelect
            :model-value="formType"
            :options="tunnelTypeOptions"
            :aria-label="t('tunnels.mode')"
            block
            instance="tunnels-type"
            @update:model-value="formType = $event as 'L' | 'R' | 'D'"
          />
        </label>
        <label class="container_tunnels_editor_field_group">
          <span class="container_tunnels_editor_label_group">{{ t('tunnels.group') }}</span>
          <OrbitSelect
            v-model="formGroupId"
            :options="groupOptions"
            :aria-label="t('tunnels.group')"
            block
            instance="tunnels-group"
          />
        </label>
        <label class="container_tunnels_editor_field_lhost">
          <span class="container_tunnels_editor_label_lhost">{{ t('tunnels.listenHost') }}</span>
          <input v-model="formListenHost" class="container_tunnels_editor_input_lhost" type="text" />
        </label>
        <label class="container_tunnels_editor_field_lport">
          <span class="container_tunnels_editor_label_lport">{{ t('tunnels.listenPort') }}</span>
          <input
            v-model.number="formListenPort"
            class="container_tunnels_editor_input_lport"
            type="number"
            min="1"
            max="65535"
          />
        </label>
        <label v-if="formType !== 'D'" class="container_tunnels_editor_field_dhost">
          <span class="container_tunnels_editor_label_dhost">{{ t('tunnels.destHost') }}</span>
          <input v-model="formDestHost" class="container_tunnels_editor_input_dhost" type="text" />
        </label>
        <label v-if="formType !== 'D'" class="container_tunnels_editor_field_dport">
          <span class="container_tunnels_editor_label_dport">{{ t('tunnels.destPort') }}</span>
          <input
            v-model.number="formDestPort"
            class="container_tunnels_editor_input_dport"
            type="number"
            min="1"
            max="65535"
          />
        </label>
      </div>
      <div v-if="formError" class="container_tunnels_editor_error_banner" role="alert">
        {{ formError }}
      </div>
      <div class="container_tunnels_editor_footer_actions">
        <button
          class="container_tunnels_editor_checkport_btn"
          type="button"
          @click="
            checkPortOccupancy(formListenHost, Number(formListenPort), 'manual').then((r) =>
              notify(r.message)
            )
          "
        >
          <ShieldCheck :size="14" />
          {{ t('tunnels.checkListenPort') }}
        </button>
        <button v-if="editingId" class="container_tunnels_editor_cancel_btn" type="button" @click="resetForm">
          {{ t('tunnels.cancelEdit') }}
        </button>
        <button
          class="container_tunnels_editor_save_btn"
          type="button"
          data-primary="true"
          :disabled="saving || hosts.length === 0"
          @click="handleSaveTunnel"
        >
          <Plus :size="14" />
          {{ saving ? t('hostEditor.saving') : editingId ? t('tunnels.updateRule') : t('tunnels.saveRule') }}
        </button>
      </div>
    </article>

    <div v-if="syncTunnels.length === 0" class="container_tunnels_list_empty_card">
      <Server :size="28" />
      <p class="container_tunnels_list_empty_title">{{ t('tunnels.emptyTitle') }}</p>
      <p class="container_tunnels_list_empty_desc">
        {{ t('tunnels.emptyDesc') }}
      </p>
      <button
        v-if="hosts.length === 0"
        class="container_tunnels_list_empty_gohosts"
        type="button"
        data-primary="true"
        @click="page = 'hosts'"
      >
        {{ t('tunnels.goAddHost') }}
      </button>
    </div>

    <div v-else class="container_tunnels_rules_list_base">
      <article
        v-for="tunnel in syncTunnels"
        :key="tunnel.id"
        :class="c('container_tunnels_rule_row_base', tunnel.id)"
        :data-active="isTunnelActive(tunnel)"
      >
        <div :class="c('container_tunnels_rule_row_main', tunnel.id)">
          <span :class="c('container_tunnels_rule_type_pill', tunnel.id)" :data-type="tunnel.type">
            -{{ tunnel.type }}
          </span>
          <div :class="c('container_tunnels_rule_row_copy', tunnel.id)">
            <div :class="c('container_tunnels_rule_title_line', tunnel.id)">
              <strong :class="c('container_tunnels_rule_row_name', tunnel.id)">{{ tunnel.name }}</strong>
              <span
                :class="c('container_tunnels_rule_status_badge', tunnel.id)"
                :data-active="isTunnelActive(tunnel)"
              >
                {{ tunnelRuntimeText(tunnel) }}
              </span>
            </div>
            <div :class="c('container_tunnels_rule_meta_line', tunnel.id)">
              <span :class="c('container_tunnels_rule_host_ref', tunnel.id)">
                {{ t('tunnels.jumpHostRef', { host: hostMap.get(tunnel.serverId) ?? tunnel.serverId }) }}
              </span>
              <code :class="c('container_tunnels_rule_route_code', tunnel.id)">
                {{ tunnel.listenHost }}:{{ tunnel.listenPort }} →
                {{ tunnel.type === 'D' ? t('hosts.socks5Proxy') : `${tunnel.destHost}:${tunnel.destPort}` }}
              </code>
            </div>
            <div
              v-if="portCheckResults[`tunnel:${tunnel.id}`] || probeResults[`tunnel:${tunnel.id}`]"
              :class="c('container_tunnels_rule_probe_line', tunnel.id)"
            >
              <span
                v-if="portCheckResults[`tunnel:${tunnel.id}`]"
                :class="c('container_tunnels_rule_port_result', tunnel.id)"
              >
                {{
                  t('tunnels.portResultLabel', {
                    msg: portCheckResults[`tunnel:${tunnel.id}`]?.message ?? ''
                  })
                }}
              </span>
              <span
                v-if="probeResults[`tunnel:${tunnel.id}`]"
                :class="c('container_tunnels_rule_net_result', tunnel.id)"
              >
                {{ t('tunnels.netResultLabel', { msg: probeResults[`tunnel:${tunnel.id}`]?.message ?? '' }) }}
              </span>
            </div>
          </div>
        </div>
        <div :class="c('container_tunnels_rule_row_actions', tunnel.id)">
          <button
            :class="c('container_tunnels_rule_toggle_btn', tunnel.id)"
            type="button"
            :data-primary="!isTunnelActive(tunnel)"
            :data-danger="isTunnelActive(tunnel)"
            :disabled="Boolean(tunnelBusy[tunnel.id]) || tunnel.readOnly"
            @click="toggleTunnelRuntime(tunnel.id, !isTunnelActive(tunnel))"
          >
            <Square v-if="isTunnelActive(tunnel)" :size="13" />
            <Play v-else :size="13" />
            {{ isTunnelActive(tunnel) ? t('tunnels.stopTunnel') : t('tunnels.startTunnel') }}
          </button>
          <button
            :class="c('container_tunnels_rule_checkport_btn', tunnel.id)"
            type="button"
            :title="t('hosts.checkPortOccupancy')"
            @click="checkTunnelPort(tunnel)"
          >
            {{ t('tunnelDrawer.testPortShort') }}
          </button>
          <button
            :class="c('container_tunnels_rule_probe_btn', tunnel.id)"
            type="button"
            :title="t('tunnels.testConnTitle')"
            @click="probeTunnelTarget(tunnel)"
          >
            {{ t('tunnels.testConnShort') }}
          </button>
          <button
            :class="c('container_tunnels_rule_edit_btn', tunnel.id)"
            type="button"
            :disabled="tunnel.readOnly"
            :aria-label="t('hosts.editAria', { name: tunnel.name })"
            @click="startEdit(tunnel)"
          >
            <Pencil :size="13" />
          </button>
          <button
            :class="c('container_tunnels_rule_delete_btn', tunnel.id)"
            type="button"
            data-danger="true"
            :aria-label="t('hosts.deleteAria', { name: tunnel.name })"
            @click="removeSyncTunnel(tunnel.id)"
          >
            <Trash2 :size="13" />
          </button>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped lang="scss">
.container_tunnels_page_body_base {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 28px 32px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.container_tunnels_page_header_base {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
}
.container_tunnels_page_header_eyebrow {
  font-size: 11px;
  letter-spacing: 1.4px;
  color: var(--color-accent-primary);
}
.container_tunnels_page_header_title {
  margin: 6px 0 6px;
  font-size: 22px;
}
.container_tunnels_page_header_description {
  margin: 0;
  color: var(--color-text-muted);
}
.container_tunnels_page_header_controls {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.container_tunnels_sync_mode_switch {
  display: inline-flex;
  padding: 3px;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-surface-1);
  button {
    min-height: 28px;
    padding: 4px 10px;
    font-size: 12px;
    &[data-active='true'] {
      background: var(--color-accent-primary-soft);
      border-color: var(--color-accent-primary-ring);
      color: var(--color-accent-primary-hover);
      font-weight: 600;
    }
  }
}
.container_tunnels_header_stats_box {
  display: inline-flex;
  gap: 8px;
  align-items: center;
}
.container_tunnels_header_stat_total,
.container_tunnels_header_stat_active {
  font-size: 12px;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid var(--color-border);
  background: var(--color-surface-1);
  color: var(--color-text-secondary);
}
.container_tunnels_header_stat_active[data-has-active='true'] {
  border-color: rgba(89, 214, 160, 0.45);
  color: var(--color-success);
  background: rgba(89, 214, 160, 0.1);
}
.container_tunnels_probe_workbench_grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 14px;
}
.container_tunnels_probe_card_base,
.container_tunnels_portcheck_card_base,
.container_tunnels_editor_card_base {
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 16px;
  background: var(--surface-card-gradient);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.container_tunnels_probe_card_head,
.container_tunnels_portcheck_card_head,
.container_tunnels_editor_card_head {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-accent-secondary);
}
.container_tunnels_probe_card_title,
.container_tunnels_portcheck_card_title,
.container_tunnels_editor_card_title {
  margin: 0;
  font-size: 14px;
  color: var(--color-text-primary);
}
.container_tunnels_editor_sync_hint {
  margin-left: auto;
  font-size: 12px;
  color: var(--color-text-muted);
}
.container_tunnels_probe_form_row,
.container_tunnels_portcheck_form_row {
  display: grid;
  grid-template-columns: 1fr 92px auto;
  gap: 8px;
}
.container_tunnels_probe_result_banner,
.container_tunnels_portcheck_result_banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 12px;
  border: 1px solid var(--color-border);
  background: var(--color-surface-1);
  &[data-ok='true'],
  &[data-free='true'] {
    border-color: rgba(89, 214, 160, 0.4);
    color: var(--color-success);
  }
  &[data-ok='false'],
  &[data-free='false'] {
    border-color: rgba(255, 125, 147, 0.45);
    color: var(--color-error);
  }
}
.container_tunnels_probe_result_badge,
.container_tunnels_portcheck_result_badge {
  font-weight: 600;
  white-space: nowrap;
}
.container_tunnels_editor_form_grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 10px;
  label {
    display: flex;
    flex-direction: column;
    gap: 5px;
    font-size: 12px;
    color: var(--color-text-secondary);
  }
}
.container_tunnels_editor_error_banner {
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--color-danger-soft);
  color: var(--color-error);
  font-size: 12px;
}
.container_tunnels_editor_footer_actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}
.container_tunnels_list_empty_card {
  border: 1px dashed var(--color-border);
  border-radius: 12px;
  padding: 36px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--color-text-muted);
}
.container_tunnels_list_empty_title {
  margin: 0;
  color: var(--color-text-primary);
  font-weight: 600;
}
.container_tunnels_list_empty_desc {
  margin: 0;
  font-size: 12px;
}
.container_tunnels_rules_list_base {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
[class*='container_tunnels_rule_row_base'] {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 14px;
  padding: 13px 16px;
  border-radius: 11px;
  border: 1px solid var(--color-border);
  background: var(--surface-card-gradient);
  flex-wrap: wrap;
  &[data-active='true'] {
    border-color: rgba(89, 214, 160, 0.55);
    box-shadow: 0 0 0 1px rgba(89, 214, 160, 0.16);
  }
}
[class*='container_tunnels_rule_row_main'] {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 280px;
}
[class*='container_tunnels_rule_type_pill'] {
  min-width: 36px;
  height: 30px;
  padding: 0 8px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 12px;
  background: var(--color-accent-primary-soft);
  color: var(--color-accent-primary-hover);
  border: 1px solid var(--color-accent-primary-ring);
}
[class*='container_tunnels_rule_row_copy'] {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
[class*='container_tunnels_rule_title_line'] {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
[class*='container_tunnels_rule_status_badge'] {
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid var(--color-border);
  color: var(--color-text-muted);
  &[data-active='true'] {
    border-color: rgba(89, 214, 160, 0.45);
    color: var(--color-success);
    background: rgba(89, 214, 160, 0.1);
  }
}
[class*='container_tunnels_rule_meta_line'] {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: var(--font-size-ui-xs);
  color: var(--color-text-muted);
  flex-wrap: wrap;
}
[class*='container_tunnels_rule_route_code'] {
  font-family: var(--font-mono);
  color: var(--color-accent-secondary);
}
[class*='container_tunnels_rule_probe_line'] {
  display: flex;
  gap: 12px;
  font-size: var(--font-size-ui-2xs);
  color: var(--color-text-secondary);
  flex-wrap: wrap;
}
[class*='container_tunnels_rule_row_actions'] {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
</style>
