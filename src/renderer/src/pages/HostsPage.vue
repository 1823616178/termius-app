<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  Server,
  Plus,
  ArrowUpRight,
  Star,
  Folder,
  Pencil,
  Trash2,
  ShieldCheck,
  Network,
  Activity,
  Columns2,
  Play,
  Square,
  FolderPlus
} from 'lucide-vue-next'
import { instanceClass } from '../../../shared/classes'
import type { Host } from '../../../shared/contracts'
import type { SyncTunnel } from '../../../shared/sync'
import OrbitSelect from '../components/OrbitSelect.vue'
import {
  checkPortOccupancy,
  connectHost,
  filteredHosts,
  group as filterGroup,
  hosts,
  notify,
  openEditor,
  page,
  portCheckResults,
  probeBusy,
  probeConnectivity,
  probeResults,
  prompt,
  query as filterQuery,
  removeSyncGroup,
  removeSyncTunnel,
  saveSyncGroup,
  saveSyncTunnel,
  selected,
  selectedHostDetails,
  setSyncWriteMode,
  syncGroups,
  syncStatus,
  syncTunnels,
  syncWriteMode,
  toggleFavorite,
  toggleTunnelRuntime,
  tunnelBusy,
  groupToken,
  tunnelStatuses,
  windowInstance
} from '../stores/workbench'

const pageLimit = ref(120)
const renderedHosts = computed(() => filteredHosts.value.slice(0, pageLimit.value))
const c = (base: string, token: string) => instanceClass(base, windowInstance(token))

const expandedTunnelHostId = ref<string | null>(null)
const quickTunnelName = ref('')
const quickTunnelType = ref<'L' | 'R' | 'D'>('L')
const quickListenHost = ref('127.0.0.1')
const quickListenPort = ref(1080)
const quickDestHost = ref('127.0.0.1')
const quickDestPort = ref(8080)
const quickSaving = ref(false)

const showGroupManager = ref(false)
const newGroupName = ref('')
const tunnelTypeOptions = [
  { value: 'L', label: '-L 本地转发' },
  { value: 'R', label: '-R 远端转发' },
  { value: 'D', label: '-D SOCKS5' }
]
const newGroupColor = ref('#a78bfa')

const distinctGroups = computed(() => {
  const names = new Set<string>()
  for (const sg of syncGroups.value) names.add(sg.name)
  for (const h of hosts.value) {
    if (h.group) names.add(h.group)
  }
  return [...names]
})

watch(filteredHosts, () => {
  pageLimit.value = 120
})

function onScroll(event: Event) {
  const target = event.currentTarget as HTMLElement
  if (
    pageLimit.value < filteredHosts.value.length &&
    target.scrollTop + target.clientHeight >= target.scrollHeight - 240
  ) {
    pageLimit.value += 120
  }
}

function hostTunnels(hostId: string): SyncTunnel[] {
  return syncTunnels.value.filter((item) => item.serverId === hostId)
}

function activeTunnelCountForHost(hostId: string): number {
  return hostTunnels(hostId).filter((t) => tunnelStatuses.value[t.id]?.active).length
}

function toggleTunnelDrawer(host: Host): void {
  selected.value = host.id
  if (expandedTunnelHostId.value === host.id) {
    expandedTunnelHostId.value = null
    return
  }
  expandedTunnelHostId.value = host.id
  quickTunnelName.value = `${host.name}-转发`
  quickTunnelType.value = 'L'
  quickListenHost.value = '127.0.0.1'
  quickListenPort.value = 1080
  quickDestHost.value = '127.0.0.1'
  quickDestPort.value = 8080
}

async function handleProbeHost(host: Host): Promise<void> {
  try {
    const res = await probeConnectivity(host.address, host.port, `host:${host.id}`)
    notify(
      res.reachable
        ? `${host.name} (${host.address}:${host.port}) 连通正常 · ${res.latencyMs} ms`
        : `${host.name} 探测不可达：${res.message}`
    )
  } catch (err) {
    notify(err instanceof Error ? err.message : '测速失败')
  }
}

async function handleCreateQuickTunnel(host: Host): Promise<void> {
  quickSaving.value = true
  try {
    await saveSyncTunnel({
      name: quickTunnelName.value.trim() || `${host.name}-转发`,
      serverId: host.id,
      groupId: null,
      type: quickTunnelType.value,
      listenHost: quickListenHost.value.trim() || '127.0.0.1',
      listenPort: Number(quickListenPort.value),
      destHost: quickTunnelType.value === 'D' ? '127.0.0.1' : quickDestHost.value.trim() || '127.0.0.1',
      destPort: quickTunnelType.value === 'D' ? 0 : Number(quickDestPort.value),
      autoReconnect: true,
      enabled: false
    })
  } catch (err) {
    notify(err instanceof Error ? err.message : '添加端口转发失败')
  } finally {
    quickSaving.value = false
  }
}

async function handleCheckHostTunnelPort(tunnel: SyncTunnel): Promise<void> {
  const res = await checkPortOccupancy(tunnel.listenHost, tunnel.listenPort, `tunnel:${tunnel.id}`)
  notify(res.message)
}

async function handleCreateGroup(): Promise<void> {
  if (!newGroupName.value.trim()) return
  await saveSyncGroup({ name: newGroupName.value.trim(), color: newGroupColor.value })
  newGroupName.value = ''
}
</script>

<template>
  <section v-if="page === 'hosts'" class="container_hosts_page_body_base" @scroll.passive="onScroll">
    <header class="container_hosts_page_header_base">
      <div class="container_hosts_page_header_copy">
        <span class="container_hosts_page_header_eyebrow">CONNECTION LIBRARY · HORIZONTAL LIST</span>
        <h2 class="container_hosts_page_header_title">
          主机库
          <span class="container_hosts_page_header_count">{{ hosts.length }}</span>
        </h2>
        <p class="container_hosts_page_header_description">
          横向高密度服务器清单：直接测速、管理分组、配置并启停每台主机的端口转发与端口占用检测。
        </p>
      </div>
      <div class="container_hosts_page_header_actions">
        <div class="container_hosts_sync_mode_switch" role="group" aria-label="增删改同步选项">
          <button
            class="container_hosts_sync_mode_realtime"
            type="button"
            :data-active="syncWriteMode === 'realtime'"
            @click="setSyncWriteMode('realtime')"
          >
            实时同步到服务端
          </button>
          <button
            class="container_hosts_sync_mode_local"
            type="button"
            :data-active="syncWriteMode === 'local-only'"
            @click="setSyncWriteMode('local-only')"
          >
            仅保留本地修改
          </button>
        </div>
        <button class="container_hosts_page_header_create" type="button" data-primary @click="openEditor()">
          <Plus :size="15" />
          新建主机
        </button>
      </div>
    </header>

    <div class="container_hosts_toolbar_bar_base">
      <input
        v-model="filterQuery"
        class="container_hosts_toolbar_search_input"
        type="search"
        placeholder="搜索主机名称、地址、用户名或标签…"
        aria-label="筛选主机列表"
      />
      <div class="container_hosts_toolbar_groups_wrap">
        <button
          class="container_hosts_toolbar_group_all"
          type="button"
          :data-active="filterGroup === 'all'"
          @click="filterGroup = 'all'"
        >
          全部分组
        </button>
        <button
          v-for="gName in distinctGroups"
          :key="gName"
          :class="c('container_hosts_toolbar_group_pill', `g${groupToken(gName)}`)"
          type="button"
          :data-active="filterGroup === gName"
          @click="filterGroup = gName"
        >
          {{ gName }}
        </button>
        <button
          class="container_hosts_toolbar_group_manage"
          type="button"
          :aria-expanded="showGroupManager"
          @click="showGroupManager = !showGroupManager"
        >
          <FolderPlus :size="14" />
          管理分组 ({{ syncGroups.length }})
        </button>
      </div>
    </div>

    <div v-if="showGroupManager" class="container_hosts_groupmgr_panel_base">
      <div class="container_hosts_groupmgr_form_row">
        <input
          v-model="newGroupName"
          class="container_hosts_groupmgr_input_name"
          type="text"
          placeholder="新建同步分组名称…"
        />
        <input
          v-model="newGroupColor"
          class="container_hosts_groupmgr_input_color"
          type="color"
          aria-label="同步分组颜色"
        />
        <button
          class="container_hosts_groupmgr_save_btn"
          type="button"
          data-primary="true"
          :disabled="!newGroupName.trim()"
          @click="handleCreateGroup"
        >
          <Plus :size="14" />
          添加分组
        </button>
      </div>
      <div v-if="syncGroups.length" class="container_hosts_groupmgr_list_wrap">
        <span v-for="sg in syncGroups" :key="sg.id" :class="c('container_hosts_groupmgr_chip_item', sg.id)">
          <span :class="c('container_hosts_groupmgr_chip_dot', sg.id)" :style="{ background: sg.color }" />
          {{ sg.name }}
          <button
            :class="c('container_hosts_groupmgr_chip_del', sg.id)"
            type="button"
            :aria-label="`删除分组 ${sg.name}`"
            @click="removeSyncGroup(sg.id)"
          >
            ×
          </button>
        </span>
      </div>
    </div>

    <div v-if="!hosts.length" class="container_hosts_page_body_empty">
      <Server :size="36" :stroke-width="1" />
      <h3 class="container_hosts_page_body_empty-title">你的第一台主机</h3>
      <p class="container_hosts_page_body_empty-description">保存服务器地址与认证信息，随时建立连接。</p>
      <button class="container_hosts_page_body_empty-create" type="button" @click="openEditor()">
        添加 SSH 主机
        <ArrowUpRight :size="15" />
      </button>
    </div>

    <div v-else class="container_hosts_library_body_base">
      <div class="container_hosts_library_body_list">
        <article
          v-for="host in renderedHosts"
          :key="host.id"
          :class="c('container_hosts_card_body_base', host.id)"
          :data-selected="selected === host.id"
          @click="selected = host.id"
        >
          <div :class="c('container_hosts_row_main_bar', host.id)">
            <div :class="c('container_hosts_row_identity_block', host.id)">
              <span :class="c('container_hosts_card_header_icon', host.id)"><Server :size="18" /></span>
              <button
                :class="c('container_hosts_card_header_favorite', host.id)"
                type="button"
                :aria-label="`${host.favorite ? '取消收藏' : '收藏'} ${host.name}`"
                :aria-pressed="host.favorite"
                @click.stop="toggleFavorite(host)"
              >
                <Star :size="14" />
              </button>
              <div :class="c('container_hosts_row_title_stack', host.id)">
                <div :class="c('container_hosts_row_title_line', host.id)">
                  <h3 :class="c('container_hosts_card_body_name', host.id)">{{ host.name }}</h3>
                  <span :class="c('container_hosts_card_body_group', host.id)">
                    <Folder :size="11" />
                    {{ host.group || '未分组' }}
                  </span>
                </div>
                <p :class="c('container_hosts_card_body_address', host.id)">
                  {{ host.username }}@{{ host.address }}:{{ host.port }}
                </p>
              </div>
            </div>

            <div :class="c('container_hosts_row_status_pills', host.id)">
              <span :class="c('container_hosts_row_auth_pill', host.id)">
                {{ host.auth === 'agent' ? 'Agent' : host.hasPassword ? '已存密码' : '临时密码' }}
              </span>
              <span
                :class="c('container_hosts_row_tunnel_pill', host.id)"
                :data-active="activeTunnelCountForHost(host.id) > 0"
              >
                端口转发 {{ hostTunnels(host.id).length }}
                <template v-if="activeTunnelCountForHost(host.id) > 0">
                  ({{ activeTunnelCountForHost(host.id) }} 运行)
                </template>
              </span>
              <span
                v-if="probeResults[`host:${host.id}`]"
                :class="c('container_hosts_row_latency_pill', host.id)"
                :data-ok="probeResults[`host:${host.id}`]?.reachable"
              >
                {{
                  probeResults[`host:${host.id}`]?.reachable
                    ? `${probeResults[`host:${host.id}`]?.latencyMs} ms`
                    : '不可达'
                }}
              </span>
            </div>

            <footer :class="c('container_hosts_card_footer_base', host.id)">
              <button
                :class="c('container_hosts_card_footer_connect', host.id)"
                type="button"
                data-primary="true"
                @click.stop="connectHost(host)"
              >
                连接
                <ArrowUpRight :size="14" />
              </button>
              <button
                :class="c('container_hosts_row_footer_split', host.id)"
                type="button"
                title="在当前标签页分屏连接"
                @click.stop="connectHost(host, true)"
              >
                <Columns2 :size="13" />
                分屏
              </button>
              <button
                :class="c('container_hosts_row_footer_probe', host.id)"
                type="button"
                :disabled="Boolean(probeBusy[`net:host:${host.id}`])"
                title="测试主机 SSH 端口连通性与延迟"
                @click.stop="handleProbeHost(host)"
              >
                <Activity :size="13" />
                {{ probeBusy[`net:host:${host.id}`] ? '探测中' : '测速' }}
              </button>
              <button
                :class="c('container_hosts_row_footer_tunnels', host.id)"
                type="button"
                :data-expanded="expandedTunnelHostId === host.id"
                @click.stop="toggleTunnelDrawer(host)"
              >
                <Network :size="13" />
                端口转发
              </button>
              <button
                :class="c('container_hosts_card_footer_edit', host.id)"
                type="button"
                :aria-label="`编辑 ${host.name}`"
                @click.stop="openEditor(host)"
              >
                <Pencil :size="14" />
              </button>
              <button
                :class="c('container_hosts_card_footer_delete', host.id)"
                type="button"
                :aria-label="`删除 ${host.name}`"
                @click.stop="prompt = { kind: 'delete', host }"
              >
                <Trash2 :size="14" />
              </button>
            </footer>
          </div>

          <div
            v-if="expandedTunnelHostId === host.id"
            :class="c('container_hosts_row_tunnel_drawer', host.id)"
            @click.stop
          >
            <div :class="c('container_hosts_drawer_head_row', host.id)">
              <strong :class="c('container_hosts_drawer_head_title', host.id)">
                {{ host.name }} · 端口转发与端口占用检测
              </strong>
              <span :class="c('container_hosts_drawer_head_hint', host.id)">
                SSH 主端口 {{ host.address }}:{{ host.port }}
              </span>
            </div>

            <div v-if="hostTunnels(host.id).length" :class="c('container_hosts_drawer_rules_list', host.id)">
              <div
                v-for="t in hostTunnels(host.id)"
                :key="t.id"
                :class="c('container_hosts_drawer_rule_item', t.id)"
              >
                <span :class="c('container_hosts_drawer_rule_type', t.id)">-{{ t.type }}</span>
                <span :class="c('container_hosts_drawer_rule_name', t.id)">{{ t.name }}</span>
                <code :class="c('container_hosts_drawer_rule_route', t.id)">
                  {{ t.listenHost }}:{{ t.listenPort }} →
                  {{ t.type === 'D' ? 'SOCKS5 动态代理' : `${t.destHost}:${t.destPort}` }}
                </code>
                <span
                  v-if="portCheckResults[`tunnel:${t.id}`]"
                  :class="c('container_hosts_drawer_port_status', t.id)"
                >
                  {{ portCheckResults[`tunnel:${t.id}`]?.message }}
                </span>
                <div :class="c('container_hosts_drawer_rule_btns', t.id)">
                  <button
                    :class="c('container_hosts_drawer_rule_toggle', t.id)"
                    type="button"
                    :data-primary="!tunnelStatuses[t.id]?.active"
                    :data-danger="Boolean(tunnelStatuses[t.id]?.active)"
                    :disabled="Boolean(tunnelBusy[t.id])"
                    @click="toggleTunnelRuntime(t.id, !tunnelStatuses[t.id]?.active)"
                  >
                    <Square v-if="tunnelStatuses[t.id]?.active" :size="12" />
                    <Play v-else :size="12" />
                    {{ tunnelStatuses[t.id]?.active ? '停止' : '启动' }}
                  </button>
                  <button
                    :class="c('container_hosts_drawer_rule_check', t.id)"
                    type="button"
                    @click="handleCheckHostTunnelPort(t)"
                  >
                    检测端口占用
                  </button>
                  <button
                    :class="c('container_hosts_drawer_rule_del', t.id)"
                    type="button"
                    data-danger="true"
                    @click="removeSyncTunnel(t.id)"
                  >
                    <Trash2 :size="12" />
                  </button>
                </div>
              </div>
            </div>
            <p v-else :class="c('container_hosts_drawer_empty_hint', host.id)">
              该服务器暂无绑定端口转发规则，可在下方快速添加一条：
            </p>

            <div :class="c('container_hosts_drawer_quick_form', host.id)">
              <input
                v-model="quickTunnelName"
                :class="c('container_hosts_drawer_input_name', host.id)"
                type="text"
                placeholder="规则名称"
              />
              <OrbitSelect
                :model-value="quickTunnelType"
                :options="tunnelTypeOptions"
                aria-label="转发模式"
                size="sm"
                width="132px"
                :instance="`hosts-tunnel-${host.id}`"
                @update:model-value="quickTunnelType = $event as 'L' | 'R' | 'D'"
              />
              <input
                v-model="quickListenHost"
                :class="c('container_hosts_drawer_input_lhost', host.id)"
                type="text"
                placeholder="本地监听地址"
              />
              <input
                v-model.number="quickListenPort"
                :class="c('container_hosts_drawer_input_lport', host.id)"
                type="number"
                min="1"
                max="65535"
                placeholder="本地端口"
              />
              <input
                v-if="quickTunnelType !== 'D'"
                v-model="quickDestHost"
                :class="c('container_hosts_drawer_input_dhost', host.id)"
                type="text"
                placeholder="目标地址"
              />
              <input
                v-if="quickTunnelType !== 'D'"
                v-model.number="quickDestPort"
                :class="c('container_hosts_drawer_input_dport', host.id)"
                type="number"
                min="1"
                max="65535"
                placeholder="目标端口"
              />
              <button
                :class="c('container_hosts_drawer_btn_checkport', host.id)"
                type="button"
                @click="
                  checkPortOccupancy(quickListenHost, Number(quickListenPort), `quick:${host.id}`).then((r) =>
                    notify(r.message)
                  )
                "
              >
                测端口
              </button>
              <button
                :class="c('container_hosts_drawer_btn_save', host.id)"
                type="button"
                data-primary="true"
                :disabled="quickSaving"
                @click="handleCreateQuickTunnel(host)"
              >
                <Plus :size="12" />
                新增转发
              </button>
            </div>
            <p
              v-if="portCheckResults[`quick:${host.id}`]"
              :class="c('container_hosts_drawer_quick_portmsg', host.id)"
            >
              端口检测结果：{{ portCheckResults[`quick:${host.id}`]?.message }}
            </p>
          </div>
        </article>

        <p v-if="!filteredHosts.length" class="container_hosts_library_body_no-results">
          没有符合筛选条件的主机。
        </p>
      </div>

      <aside v-if="selectedHostDetails" class="container_hosts_detail_body_base">
        <span class="container_hosts_detail_header_label">主机详情</span>
        <h3 class="container_hosts_detail_header_name">{{ selectedHostDetails.name }}</h3>
        <dl class="container_hosts_detail_body_fields">
          <dt class="container_hosts_detail_body_address-label">地址</dt>
          <dd class="container_hosts_detail_body_address">
            {{ selectedHostDetails.address }}:{{ selectedHostDetails.port }}
          </dd>
          <dt class="container_hosts_detail_body_user-label">用户名</dt>
          <dd class="container_hosts_detail_body_user">{{ selectedHostDetails.username }}</dd>
          <dt class="container_hosts_detail_body_auth-label">认证</dt>
          <dd class="container_hosts_detail_body_auth">
            {{
              selectedHostDetails.auth === 'agent'
                ? 'OpenSSH Agent'
                : selectedHostDetails.hasPassword
                  ? '密码 · 已系统加密保存'
                  : '密码 · 连接时输入'
            }}
          </dd>
          <dt class="container_hosts_detail_body_notes-label">备注</dt>
          <dd class="container_hosts_detail_body_notes">{{ selectedHostDetails.notes || '无' }}</dd>
        </dl>
        <p class="container_hosts_detail_footer_scope">
          <ShieldCheck :size="13" />
          {{
            syncStatus?.phase === 'synced'
              ? syncWriteMode === 'realtime'
                ? '已启用 E2EE 实时同步（增删改实时上传）'
                : 'E2EE 已解锁 · 当前设为仅本地修改模式'
              : syncStatus?.signedIn
                ? '已配置云同步账号（当前待解锁或待同步）'
                : '本地配置，尚未云同步'
          }}
        </p>
      </aside>
    </div>
  </section>
</template>

<style scoped lang="scss">
.container_hosts_page_body_base {
  padding: 28px 32px;
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.container_hosts_page_header_base {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
}
.container_hosts_page_header_eyebrow {
  font-size: 11px;
  letter-spacing: 1.5px;
  color: var(--color-accent-primary);
}
.container_hosts_page_header_title {
  font-size: 22px;
  font-weight: 500;
  margin: 6px 0;
}
.container_hosts_page_header_count {
  margin-left: 10px;
  font-size: 14px;
  color: var(--color-text-muted);
}
.container_hosts_page_header_description {
  color: var(--color-text-muted);
  font-size: 13px;
  margin: 0;
}
.container_hosts_page_header_actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.container_hosts_sync_mode_switch {
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
.container_hosts_page_header_create {
  font-size: 12px;
}
.container_hosts_toolbar_bar_base {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.container_hosts_toolbar_search_input {
  width: 260px;
}
.container_hosts_toolbar_groups_wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.container_hosts_toolbar_group_all,
[class*='container_hosts_toolbar_group_pill'] {
  min-height: 28px;
  padding: 4px 10px;
  font-size: 12px;
  border: 1px solid var(--color-border);
  background: var(--color-surface-1);
  &[data-active='true'] {
    border-color: var(--color-accent-primary);
    background: var(--color-accent-primary-soft);
    color: var(--color-accent-primary-hover);
  }
}
.container_hosts_toolbar_group_manage {
  min-height: 28px;
  padding: 4px 10px;
  font-size: 12px;
  border: 1px dashed var(--color-border-control);
}
.container_hosts_groupmgr_panel_base {
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid var(--color-border);
  background: var(--color-surface-1);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.container_hosts_groupmgr_form_row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.container_hosts_groupmgr_input_name {
  width: 220px;
}
.container_hosts_groupmgr_input_color {
  width: 40px;
  height: 32px;
  padding: 2px;
}
.container_hosts_groupmgr_list_wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
[class*='container_hosts_groupmgr_chip_item'] {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid var(--color-border);
  background: var(--color-surface-2);
  font-size: 12px;
}
[class*='container_hosts_groupmgr_chip_dot'] {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
[class*='container_hosts_groupmgr_chip_del'] {
  min-height: 18px;
  padding: 0 4px;
  font-size: 13px;
}
.container_hosts_page_body_empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 90px 20px;
  color: var(--color-text-muted);
}
.container_hosts_page_body_empty-title {
  color: var(--color-text-primary);
  margin: 20px 0 6px;
  font-weight: 500;
}
.container_hosts_page_body_empty-description {
  font-size: 13px;
}
.container_hosts_page_body_empty-create {
  margin-top: 10px;
  color: var(--color-accent-primary);
}
.container_hosts_library_body_base {
  display: flex;
  align-items: flex-start;
  gap: 18px;
}
.container_hosts_library_body_list {
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: 8px;
  min-width: 0;
}
[class*='container_hosts_card_body_base'] {
  border: 1px solid var(--color-border-control);
  background: var(--surface-card-gradient);
  border-radius: 10px;
  padding: 11px 14px;
  min-width: 0;
  transition:
    border-color 140ms,
    background 140ms;
  &:hover {
    border-color: var(--color-accent-primary-ring);
  }
  &[data-selected='true'] {
    border-color: var(--color-accent-primary);
    box-shadow: 0 0 0 1px var(--color-accent-primary-ring);
  }
}
[class*='container_hosts_row_main_bar'] {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
[class*='container_hosts_row_identity_block'] {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 240px;
  flex: 1;
}
[class*='container_hosts_card_header_icon'] {
  color: var(--color-accent-primary);
  padding: 7px;
  background: var(--color-accent-primary-soft);
  border: 1px solid var(--color-accent-primary-ring);
  border-radius: 8px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}
[class*='container_hosts_card_header_favorite'] {
  padding: 5px;
  min-height: 26px;
  color: var(--color-text-muted);
  &[aria-pressed='true'] {
    color: var(--color-warning);
  }
}
[class*='container_hosts_row_title_stack'] {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
[class*='container_hosts_row_title_line'] {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
[class*='container_hosts_card_body_name'] {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
}
[class*='container_hosts_card_body_address'] {
  margin: 0;
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--color-text-muted);
}
[class*='container_hosts_card_body_group'] {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 999px;
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
}
[class*='container_hosts_row_status_pills'] {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
[class*='container_hosts_row_auth_pill'],
[class*='container_hosts_row_tunnel_pill'],
[class*='container_hosts_row_latency_pill'] {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
}
[class*='container_hosts_row_tunnel_pill'][data-active='true'],
[class*='container_hosts_row_latency_pill'][data-ok='true'] {
  border-color: rgba(89, 214, 160, 0.45);
  color: var(--color-success);
  background: rgba(89, 214, 160, 0.1);
}
[class*='container_hosts_row_latency_pill'][data-ok='false'] {
  border-color: rgba(255, 125, 147, 0.45);
  color: var(--color-error);
}
[class*='container_hosts_card_footer_base'] {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
[class*='container_hosts_row_footer_tunnels'][data-expanded='true'] {
  border-color: var(--color-accent-primary);
  color: var(--color-accent-primary-hover);
  background: var(--color-accent-primary-soft);
}
[class*='container_hosts_row_tunnel_drawer'] {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--color-border-subtle);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
[class*='container_hosts_drawer_head_row'] {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
}
[class*='container_hosts_drawer_head_hint'],
[class*='container_hosts_drawer_empty_hint'] {
  margin: 0;
  font-size: 12px;
  color: var(--color-text-muted);
}
[class*='container_hosts_drawer_rules_list'] {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
[class*='container_hosts_drawer_rule_item'] {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 7px;
  background: var(--color-surface-1);
  border: 1px solid var(--color-border-subtle);
  flex-wrap: wrap;
}
[class*='container_hosts_drawer_rule_type'] {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  color: var(--color-accent-primary-hover);
}
[class*='container_hosts_drawer_rule_route'] {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-accent-secondary);
}
[class*='container_hosts_drawer_port_status'],
[class*='container_hosts_drawer_quick_portmsg'] {
  margin: 0;
  font-size: 11px;
  color: var(--color-text-secondary);
}
[class*='container_hosts_drawer_rule_btns'] {
  margin-left: auto;
  display: flex;
  gap: 6px;
}
[class*='container_hosts_drawer_quick_form'] {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  input {
    padding: 5px 8px;
    font-size: 12px;
  }
}
[class*='container_hosts_drawer_input_lport'],
[class*='container_hosts_drawer_input_dport'] {
  width: 84px;
}
.container_hosts_detail_body_base {
  width: 260px;
  flex-shrink: 0;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 16px;
  background: var(--surface-card-gradient);
}
.container_hosts_detail_header_label {
  font-size: 11px;
  color: var(--color-accent-primary);
}
.container_hosts_detail_header_name {
  margin: 6px 0 12px;
  font-size: 16px;
}
.container_hosts_detail_body_fields {
  margin: 0;
  display: grid;
  gap: 6px;
  dt {
    font-size: 11px;
    color: var(--color-text-muted);
  }
  dd {
    margin: 0 0 6px;
    font-size: 12px;
    word-break: break-all;
  }
}
.container_hosts_detail_footer_scope {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 10px 0 0;
  font-size: 11px;
  color: var(--color-text-muted);
}
.container_hosts_library_body_no-results {
  color: var(--color-text-muted);
  font-size: 13px;
}
</style>
