<script setup lang="ts">
import { computed, ref } from 'vue'
import { KeyRound, FolderKanban, ShieldAlert, Trash2, Plus, RefreshCw, Pencil } from '@lucide/vue'
import { instanceClass } from '../../../shared/classes'
import type { SyncGroup } from '../../../shared/sync'
import {
  bootstrap,
  group as hostFilterGroup,
  groupToken,
  hosts,
  knownHosts,
  openEditor,
  page,
  refreshKnownHosts,
  removeKnownHostEntry,
  removeSyncGroup,
  saveSyncGroup,
  setSyncWriteMode,
  syncGroups,
  syncStatus,
  syncWriteMode,
  windowInstance
} from '../stores/workbench'

const c = (base: string, token: string) => instanceClass(base, windowInstance(token))

const editingGroupId = ref<string | null>(null)
const groupName = ref('')
const groupColor = ref('#d4af63')
const groupSaving = ref(false)
const knownHostFilter = ref('')

const hostCountByGroup = computed(() => {
  const counts = new Map<string, number>()
  for (const h of hosts.value) {
    if (h.group) counts.set(h.group, (counts.get(h.group) ?? 0) + 1)
  }
  return counts
})

const filteredKnownHosts = computed(() => {
  const needle = knownHostFilter.value.trim().toLowerCase()
  if (!needle) return knownHosts.value
  return knownHosts.value.filter(
    (entry) =>
      entry.hostKey.toLowerCase().includes(needle) || entry.fingerprint.toLowerCase().includes(needle)
  )
})

function startEditGroup(item: SyncGroup): void {
  editingGroupId.value = item.id
  groupName.value = item.name
  groupColor.value = item.color || '#d4af63'
}

function resetGroupForm(): void {
  editingGroupId.value = null
  groupName.value = ''
  groupColor.value = '#d4af63'
}

async function handleSaveGroup(): Promise<void> {
  if (!groupName.value.trim()) return
  groupSaving.value = true
  try {
    await saveSyncGroup({
      id: editingGroupId.value ?? undefined,
      name: groupName.value.trim(),
      color: groupColor.value
    })
    resetGroupForm()
  } finally {
    groupSaving.value = false
  }
}

function jumpToHostsGroup(groupNameText: string): void {
  hostFilterGroup.value = groupNameText
  page.value = 'hosts'
}
</script>

<template>
  <section v-if="page === 'identities'" class="container_identities_page_body_base">
    <header class="container_identities_page_header_base">
      <div class="container_identities_page_header_copy">
        <span class="container_identities_page_header_eyebrow">令符玉牒 · 宗门印鉴</span>
        <h2 class="container_identities_page_header_title">凭据、同步分组与主机指纹库</h2>
        <p class="container_identities_page_header_description">
          集中管理服务器同步分组、每台主机的本地系统凭据（{{
            bootstrap?.platform === 'linux' ? 'Keyring / Secret Service' : 'DPAPI'
          }}）与 SSH Agent 认证状态及可信指纹。
        </p>
      </div>
      <div class="container_identities_page_header_actions">
        <div class="container_identities_sync_mode_switch" role="group" aria-label="修改同步策略">
          <button
            class="container_identities_sync_mode_realtime"
            type="button"
            :data-active="syncWriteMode === 'realtime'"
            @click="setSyncWriteMode('realtime')"
          >
            实时同步服务端
          </button>
          <button
            class="container_identities_sync_mode_local"
            type="button"
            :data-active="syncWriteMode === 'local-only'"
            @click="setSyncWriteMode('local-only')"
          >
            仅本地修改
          </button>
        </div>
        <button class="container_identities_refresh_known_btn" type="button" @click="refreshKnownHosts">
          <RefreshCw :size="14" />
          刷新指纹库
        </button>
      </div>
    </header>

    <article class="container_identities_groups_card_base">
      <div class="container_identities_groups_card_head">
        <FolderKanban :size="16" />
        <h3 class="container_identities_groups_card_title">服务器同步分组 ({{ syncGroups.length }})</h3>
      </div>
      <div class="container_identities_groups_form_row">
        <input
          v-model="groupName"
          class="container_identities_groups_input_name"
          type="text"
          placeholder="输入分组名称（例如：生产环境 / GPU 集群）"
        />
        <input
          v-model="groupColor"
          class="container_identities_groups_input_color"
          type="color"
          aria-label="分组标识颜色"
        />
        <button
          v-if="editingGroupId"
          class="container_identities_groups_cancel_btn"
          type="button"
          @click="resetGroupForm"
        >
          取消
        </button>
        <button
          class="container_identities_groups_save_btn"
          type="button"
          data-primary="true"
          :disabled="groupSaving || !groupName.trim()"
          @click="handleSaveGroup"
        >
          <Plus :size="14" />
          {{ editingGroupId ? '更新分组' : '添加分组' }}
        </button>
      </div>

      <div v-if="syncGroups.length === 0" class="container_identities_groups_empty_text">
        暂无服务器同步分组，上方输入名称即可添加。
      </div>
      <div v-else class="container_identities_groups_list_grid">
        <div
          v-for="item in syncGroups"
          :key="item.id"
          :class="c('container_identities_group_row_item', item.id)"
        >
          <span
            :class="c('container_identities_group_row_dot', item.id)"
            :style="{ background: item.color }"
          />
          <strong :class="c('container_identities_group_row_name', item.id)">{{ item.name }}</strong>
          <span :class="c('container_identities_group_row_count', item.id)">
            {{ hostCountByGroup.get(item.name) ?? 0 }} 台主机
          </span>
          <div :class="c('container_identities_group_row_actions', item.id)">
            <button
              :class="c('container_identities_group_row_view', item.id)"
              type="button"
              @click="jumpToHostsGroup(item.name)"
            >
              查看主机
            </button>
            <button
              :class="c('container_identities_group_row_edit', item.id)"
              type="button"
              :aria-label="`编辑分组 ${item.name}`"
              @click="startEditGroup(item)"
            >
              <Pencil :size="13" />
            </button>
            <button
              :class="c('container_identities_group_row_delete', item.id)"
              type="button"
              data-danger="true"
              :aria-label="`删除分组 ${item.name}`"
              @click="removeSyncGroup(item.id)"
            >
              <Trash2 :size="13" />
            </button>
          </div>
        </div>
      </div>
    </article>

    <article class="container_identities_creds_card_base">
      <div class="container_identities_creds_card_head">
        <KeyRound :size="16" />
        <h3 class="container_identities_creds_card_title">主机认证凭据安全审计</h3>
        <span class="container_identities_creds_dpapi_badge">
          {{
            bootstrap?.encryptionAvailable
              ? bootstrap.platform === 'linux'
                ? '系统 Keyring 凭据加密可用（Secret Service）'
                : '系统 DPAPI 凭据加密可用'
              : bootstrap?.platform === 'linux'
                ? '未检测到系统 Keyring（gnome-keyring / kwallet），凭据仅临时使用'
                : '系统凭据加密不可用（会话临时密码）'
          }}
        </span>
      </div>
      <div v-if="hosts.length === 0" class="container_identities_creds_empty_text">
        尚未配置任何 SSH 主机。
      </div>
      <div v-else class="container_identities_creds_list_base">
        <div v-for="host in hosts" :key="host.id" :class="c('container_identities_cred_row_base', host.id)">
          <div :class="c('container_identities_cred_row_info', host.id)">
            <strong :class="c('container_identities_cred_row_name', host.id)">{{ host.name }}</strong>
            <span :class="c('container_identities_cred_row_addr', host.id)">
              {{ host.username }}@{{ host.address }}:{{ host.port }}
            </span>
          </div>
          <div :class="c('container_identities_cred_row_badges', host.id)">
            <span :class="c('container_identities_cred_row_auth', host.id)">
              {{ host.auth === 'agent' ? 'OpenSSH Agent' : '密码认证' }}
            </span>
            <span
              :class="c('container_identities_cred_row_storage', host.id)"
              :data-saved="host.hasPassword ? 'true' : 'false'"
            >
              {{
                host.auth === 'agent'
                  ? 'Agent 签名托管'
                  : host.hasPassword
                    ? syncStatus?.syncPasswords
                      ? bootstrap?.platform === 'linux'
                        ? '本地 Keyring + 云端 E2EE 已保护'
                        : '本地 DPAPI + 云端 E2EE 已保护'
                      : bootstrap?.platform === 'linux'
                        ? '本机 Keyring 已安全保存'
                        : '本机 DPAPI 已安全保存'
                    : '未保存（连接时输入）'
              }}
            </span>
            <button
              :class="c('container_identities_cred_row_edit', host.id)"
              type="button"
              @click="openEditor(host)"
            >
              修改凭据
            </button>
          </div>
        </div>
      </div>
    </article>

    <article class="container_identities_knownhosts_card_base">
      <div class="container_identities_knownhosts_card_head">
        <ShieldAlert :size="16" />
        <h3 class="container_identities_knownhosts_card_title">
          SSH 已知主机指纹库 ({{ knownHosts.length }})
        </h3>
        <input
          v-model="knownHostFilter"
          class="container_identities_knownhosts_search_input"
          type="search"
          placeholder="筛选主机或指纹…"
          aria-label="筛选已知主机指纹"
        />
      </div>
      <div v-if="filteredKnownHosts.length === 0" class="container_identities_knownhosts_empty_text">
        暂无匹配的 SSH 已知主机指纹记录（首次连接远程服务器并信任后将自动记录）。
      </div>
      <div v-else class="container_identities_knownhosts_list_base">
        <div
          v-for="entry in filteredKnownHosts"
          :key="entry.hostKey"
          :class="c('container_identities_knownhost_row_base', `kh${groupToken(entry.hostKey)}`)"
        >
          <div :class="c('container_identities_knownhost_row_info', `kh${groupToken(entry.hostKey)}`)">
            <strong :class="c('container_identities_knownhost_row_host', `kh${groupToken(entry.hostKey)}`)">
              {{ entry.hostKey }}
            </strong>
            <code :class="c('container_identities_knownhost_row_fp', `kh${groupToken(entry.hostKey)}`)">
              {{ entry.fingerprint }}
            </code>
          </div>
          <div :class="c('container_identities_knownhost_row_actions', `kh${groupToken(entry.hostKey)}`)">
            <span :class="c('container_identities_knownhost_row_time', `kh${groupToken(entry.hostKey)}`)">
              {{ new Date(entry.updatedAt).toLocaleString() }}
            </span>
            <button
              :class="c('container_identities_knownhost_row_remove', `kh${groupToken(entry.hostKey)}`)"
              type="button"
              data-danger="true"
              @click="removeKnownHostEntry(entry.hostKey)"
            >
              <Trash2 :size="13" />
              移除信任
            </button>
          </div>
        </div>
      </div>
    </article>
  </section>
</template>

<style scoped lang="scss">
.container_identities_page_body_base {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 28px 32px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.container_identities_page_header_base {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
}
.container_identities_page_header_eyebrow {
  font-size: 11px;
  letter-spacing: 1.4px;
  color: var(--color-accent-primary);
}
.container_identities_page_header_title {
  margin: 6px 0 6px;
  font-size: 22px;
}
.container_identities_page_header_description {
  margin: 0;
  color: var(--color-text-muted);
}
.container_identities_page_header_actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.container_identities_sync_mode_switch {
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
.container_identities_groups_card_base,
.container_identities_creds_card_base,
.container_identities_knownhosts_card_base {
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 16px;
  background: var(--surface-card-gradient);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.container_identities_groups_card_head,
.container_identities_creds_card_head,
.container_identities_knownhosts_card_head {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-accent-secondary);
  flex-wrap: wrap;
}
.container_identities_groups_card_title,
.container_identities_creds_card_title,
.container_identities_knownhosts_card_title {
  margin: 0;
  font-size: 14px;
  color: var(--color-text-primary);
}
.container_identities_creds_dpapi_badge {
  margin-left: auto;
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
}
.container_identities_knownhosts_search_input {
  margin-left: auto;
  width: 220px;
}
.container_identities_groups_form_row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.container_identities_groups_input_name {
  flex: 1;
  min-width: 200px;
}
.container_identities_groups_input_color {
  width: 44px;
  height: 34px;
  padding: 2px;
}
.container_identities_groups_empty_text,
.container_identities_creds_empty_text,
.container_identities_knownhosts_empty_text {
  color: var(--color-text-muted);
  font-size: 12px;
}
.container_identities_groups_list_grid,
.container_identities_creds_list_base,
.container_identities_knownhosts_list_base {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
[class*='container_identities_group_row_item'],
[class*='container_identities_cred_row_base'],
[class*='container_identities_knownhost_row_base'] {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 9px;
  border: 1px solid var(--color-border-subtle);
  background: var(--color-surface-1);
  flex-wrap: wrap;
}
[class*='container_identities_group_row_dot'] {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
[class*='container_identities_group_row_name'] {
  font-size: 13px;
}
[class*='container_identities_group_row_count'] {
  font-size: 12px;
  color: var(--color-text-muted);
}
[class*='container_identities_group_row_actions'],
[class*='container_identities_cred_row_badges'],
[class*='container_identities_knownhost_row_actions'] {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  flex-wrap: wrap;
}
[class*='container_identities_cred_row_info'],
[class*='container_identities_knownhost_row_info'] {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
[class*='container_identities_cred_row_addr'],
[class*='container_identities_knownhost_row_time'] {
  font-size: 12px;
  color: var(--color-text-muted);
}
[class*='container_identities_knownhost_row_fp'] {
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--color-accent-secondary);
}
[class*='container_identities_cred_row_auth'],
[class*='container_identities_cred_row_storage'] {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  &[data-saved='true'] {
    border-color: rgba(89, 214, 160, 0.45);
    color: var(--color-success);
  }
}
</style>
