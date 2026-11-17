<script setup lang="ts">
import { ref } from 'vue'
import { History, Laptop, RefreshCw } from '@lucide/vue'
import { instanceClass } from '../../../shared/classes'
import type { SyncDevice, SyncRevisionInfo } from '../../../shared/sync'
import { groupToken, windowInstance } from '../stores/workbench'

defineProps<{
  devices: SyncDevice[]
  revisions: SyncRevisionInfo[]
  loading: boolean
  busy: boolean
  vaultUnlocked: boolean
}>()

const emit = defineEmits<{
  refresh: []
  logout: []
  revokeDevice: [deviceId: string]
  restoreRevision: [revision: string]
}>()

const c = (base: string, id: string) => instanceClass(base, windowInstance(groupToken(`sync:${id}`)))
const manageTab = ref<'devices' | 'revisions'>('devices')

function switchManageTab(tab: 'devices' | 'revisions') {
  manageTab.value = tab
  emit('refresh')
}
</script>

<template>
  <section class="container_sync_manage_body_section">
    <div class="container_sync_manage_header_base">
      <div class="container_sync_manage_header_tabs">
        <button
          class="container_sync_manage_header_tab-devices"
          type="button"
          :data-active="manageTab === 'devices' ? 'true' : 'false'"
          @click="switchManageTab('devices')"
        >
          <Laptop :size="15" />
          授权设备 ({{ devices.length }})
        </button>
        <button
          class="container_sync_manage_header_tab-revisions"
          type="button"
          :data-active="manageTab === 'revisions' ? 'true' : 'false'"
          @click="switchManageTab('revisions')"
        >
          <History :size="15" />
          历史版本 ({{ revisions.length }})
        </button>
      </div>
      <button
        class="container_sync_manage_header_refresh"
        type="button"
        :disabled="loading"
        @click="emit('refresh')"
      >
        <RefreshCw :size="14" />
        刷新列表
      </button>
    </div>

    <div v-if="manageTab === 'devices'" class="container_sync_manage_body_devices">
      <p v-if="!devices.length" class="container_sync_manage_body_empty-devices">
        暂无服务端返回的设备会话信息。
      </p>
      <div v-else class="container_sync_manage_body_device-list">
        <div
          v-for="device in devices"
          :key="device.id"
          :class="c('container_sync_manage_body_device-row', device.id)"
        >
          <div :class="c('container_sync_manage_body_device-info', device.id)">
            <strong :class="c('container_sync_manage_body_device-name', device.id)">
              {{ device.name }}
              <template v-if="device.current">（当前设备）</template>
            </strong>
            <span :class="c('container_sync_manage_body_device-meta', device.id)">
              {{ device.platform }} · v{{ device.appVersion }} · 最近活跃：{{
                new Date(device.lastSeenAt).toLocaleString()
              }}
            </span>
          </div>
          <button
            :class="c('container_sync_manage_body_device-revoke', device.id)"
            type="button"
            :disabled="busy"
            @click="device.current ? emit('logout') : emit('revokeDevice', device.id)"
          >
            {{ device.current ? '注销本机' : '下线该设备' }}
          </button>
        </div>
      </div>
    </div>

    <div v-else class="container_sync_manage_body_revisions">
      <p v-if="!revisions.length" class="container_sync_manage_body_empty-revisions">
        暂无历史版本记录。完成首次同步上传后会记录历史修订快照。
      </p>
      <div v-else class="container_sync_manage_body_revision-list">
        <div
          v-for="rev in revisions"
          :key="rev.revision"
          :class="c('container_sync_manage_body_revision-row', rev.revision)"
        >
          <div :class="c('container_sync_manage_body_revision-info', rev.revision)">
            <strong :class="c('container_sync_manage_body_revision-id', rev.revision)">
              rev-{{ rev.revision }} (v{{ rev.keyVersion }})
            </strong>
            <span :class="c('container_sync_manage_body_revision-meta', rev.revision)">
              {{ new Date(rev.createdAt).toLocaleString() }}
              <template v-if="rev.createdByDeviceName">· 设备 {{ rev.createdByDeviceName }}</template>
            </span>
          </div>
          <button
            :class="c('container_sync_manage_body_revision-restore', rev.revision)"
            type="button"
            :disabled="busy || !vaultUnlocked"
            @click="emit('restoreRevision', rev.revision)"
          >
            恢复此版本
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
.container_sync_manage_body_section {
  border: 1px solid var(--color-border-control);
  background: var(--surface-card-gradient);
  border-radius: 10px;
  padding: 20px;
  box-shadow: var(--shadow-3d-sm);
  margin-bottom: 20px;
}
.container_sync_manage_header_base {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.container_sync_manage_header_tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
}
.container_sync_manage_header_tab-devices,
.container_sync_manage_header_tab-revisions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  &[data-active='true'] {
    border-color: var(--color-accent-primary);
    background: var(--color-accent-primary-soft);
    color: var(--color-text-primary);
  }
}
.container_sync_manage_header_refresh {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.container_sync_manage_body_device-list,
.container_sync_manage_body_revision-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.container_sync_manage_body_device-row,
.container_sync_manage_body_revision-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-surface-canvas);
}
.container_sync_manage_body_device-info,
.container_sync_manage_body_revision-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
}
.container_sync_manage_body_device-meta,
.container_sync_manage_body_revision-meta,
.container_sync_manage_body_empty-devices,
.container_sync_manage_body_empty-revisions {
  font-size: 12px;
  color: var(--color-text-muted);
}
</style>
