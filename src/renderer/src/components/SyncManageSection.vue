<script setup lang="ts">
import { ref } from 'vue'
import { History, Laptop, RefreshCw } from '@lucide/vue'
import { instanceClass } from '../../../shared/classes'
import type { SyncDevice, SyncNamespace, SyncRevisionInfo } from '../../../shared/sync'
import { locale, t } from '../services/i18n'
import { groupToken, windowInstance } from '../stores/workbench'

defineProps<{
  devices: SyncDevice[]
  revisions: SyncRevisionInfo[]
  supportedNamespaces: SyncNamespace[]
  selectedNamespace: SyncNamespace
  loading: boolean
  busy: boolean
  vaultUnlocked: boolean
}>()

const emit = defineEmits<{
  refresh: []
  logout: []
  revokeDevice: [deviceId: string]
  restoreRevision: [revision: string, namespace: SyncNamespace]
  selectNamespace: [namespace: SyncNamespace]
}>()

const c = (base: string, id: string) => instanceClass(base, windowInstance(groupToken(`sync:${id}`)))
const manageTab = ref<'devices' | 'revisions'>('devices')

function switchManageTab(tab: 'devices' | 'revisions') {
  manageTab.value = tab
  emit('refresh')
}

function namespaceLabel(ns: SyncNamespace): string {
  if (ns === 'protocols') return t('sync.nsProtocols')
  if (ns === 'settings') return t('sync.nsSettings')
  return t('sync.nsCore')
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
          {{ t('sync.manageDevicesTab', { count: devices.length }) }}
        </button>
        <button
          class="container_sync_manage_header_tab-revisions"
          type="button"
          :data-active="manageTab === 'revisions' ? 'true' : 'false'"
          @click="switchManageTab('revisions')"
        >
          <History :size="15" />
          {{ t('sync.manageRevisionsTab', { count: revisions.length }) }}
        </button>
      </div>
      <button
        class="container_sync_manage_header_refresh"
        type="button"
        :disabled="loading"
        @click="emit('refresh')"
      >
        <RefreshCw :size="14" />
        {{ t('sync.manageRefresh') }}
      </button>
    </div>

    <div v-if="manageTab === 'devices'" class="container_sync_manage_body_devices">
      <p v-if="!devices.length" class="container_sync_manage_body_empty-devices">
        {{ t('sync.manageNoDevices') }}
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
              <template v-if="device.current">{{ t('sync.manageCurrentDevice') }}</template>
            </strong>
            <span :class="c('container_sync_manage_body_device-meta', device.id)">
              {{ device.platform }} · v{{ device.appVersion }} · {{ t('sync.manageLastSeen')
              }}{{ new Date(device.lastSeenAt).toLocaleString(locale) }}
            </span>
          </div>
          <button
            :class="c('container_sync_manage_body_device-revoke', device.id)"
            type="button"
            :disabled="busy"
            @click="device.current ? emit('logout') : emit('revokeDevice', device.id)"
          >
            {{ device.current ? t('sync.manageLogoutDevice') : t('sync.manageRevokeDevice') }}
          </button>
        </div>
      </div>
    </div>

    <div v-else class="container_sync_manage_body_revisions">
      <div v-if="supportedNamespaces.length > 1" class="container_sync_manage_body_ns-tabs">
        <button
          v-for="ns in supportedNamespaces"
          :key="ns"
          :class="c('container_sync_manage_body_ns-tab', ns)"
          type="button"
          :data-active="selectedNamespace === ns ? 'true' : 'false'"
          @click="emit('selectNamespace', ns)"
        >
          {{ namespaceLabel(ns) }}
        </button>
      </div>
      <p v-if="!revisions.length" class="container_sync_manage_body_empty-revisions">
        {{ t('sync.manageNoRevisions') }}
      </p>
      <div v-else class="container_sync_manage_body_revision-list">
        <div
          v-for="rev in revisions"
          :key="`${selectedNamespace}:${rev.revision}`"
          :class="c('container_sync_manage_body_revision-row', `${selectedNamespace}-${rev.revision}`)"
        >
          <div :class="c('container_sync_manage_body_revision-info', `${selectedNamespace}-${rev.revision}`)">
            <strong
              :class="c('container_sync_manage_body_revision-id', `${selectedNamespace}-${rev.revision}`)"
            >
              rev-{{ rev.revision }} (v{{ rev.keyVersion }})
            </strong>
            <span
              :class="c('container_sync_manage_body_revision-meta', `${selectedNamespace}-${rev.revision}`)"
            >
              {{ new Date(rev.createdAt).toLocaleString(locale) }}
              <template v-if="rev.createdByDeviceName">
                {{ t('sync.manageDevicePrefix', { name: rev.createdByDeviceName }) }}
              </template>
            </span>
          </div>
          <button
            :class="c('container_sync_manage_body_revision-restore', `${selectedNamespace}-${rev.revision}`)"
            type="button"
            :disabled="busy || !vaultUnlocked"
            @click="emit('restoreRevision', rev.revision, selectedNamespace)"
          >
            {{ t('sync.manageRestoreRevision') }}
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
.container_sync_manage_body_ns-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.container_sync_manage_body_ns-tab {
  font-size: 12px;
  padding: 4px 10px;
  &[data-active='true'] {
    border-color: var(--color-accent-primary);
    background: var(--color-accent-primary-soft);
    color: var(--color-text-primary);
  }
}
.container_sync_manage_body_device-meta,
.container_sync_manage_body_revision-meta,
.container_sync_manage_body_empty-devices,
.container_sync_manage_body_empty-revisions {
  font-size: 12px;
  color: var(--color-text-muted);
}
</style>
