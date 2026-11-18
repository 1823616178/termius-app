<script setup lang="ts">
import { ref } from 'vue'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  RotateCw,
  X
} from '@lucide/vue'
import { formatBytes, formatSpeed, type SftpTransferItem } from '../../../shared/sftp'
import { t } from '../services/i18n'
import {
  activeTransferCount,
  cancelSftpTransfer,
  clearFinishedSftpTransfers,
  retrySftpTransfer,
  sftpTransfers
} from '../services/sftp-store'

defineProps<{
  instanceClassFor: (base: string, suffix?: string) => string[]
}>()

const emit = defineEmits<{
  revealLocal: [localPath: string]
}>()

const queueExpanded = ref(true)

function transferPercent(item: SftpTransferItem): number {
  if (item.status === 'completed') return 100
  if (item.totalBytes <= 0) return item.status === 'running' ? 12 : 0
  return Math.min(100, Math.round((item.transferredBytes / item.totalBytes) * 100))
}
</script>

<template>
  <section
    v-if="sftpTransfers.length"
    class="container_workspace_sftp_queue_base"
    :aria-label="t('sftp.queueAria')"
  >
    <header class="container_workspace_sftp_queue_header">
      <button
        class="container_workspace_sftp_queue_toggle"
        type="button"
        @click="queueExpanded = !queueExpanded"
      >
        <ChevronDown v-if="queueExpanded" :size="13" />
        <ChevronRight v-else :size="13" />
        {{ t('sftp.queueSummary', { active: activeTransferCount, total: sftpTransfers.length }) }}
      </button>
      <button class="container_workspace_sftp_queue_clear" type="button" @click="clearFinishedSftpTransfers">
        {{ t('sftp.queueClearFinished') }}
      </button>
    </header>
    <div v-if="queueExpanded" class="container_workspace_sftp_queue_list">
      <div
        v-for="item in sftpTransfers"
        :key="item.id"
        :class="instanceClassFor('container_workspace_sftp_queue_item', item.id)"
        :data-status="item.status"
      >
        <div :class="instanceClassFor('container_workspace_sftp_queue_row', item.id)">
          <span :class="instanceClassFor('container_workspace_sftp_queue_dir', item.id)">
            <ArrowUpFromLine v-if="item.direction === 'upload'" :size="12" />
            <ArrowDownToLine v-else :size="12" />
          </span>
          <span
            :class="instanceClassFor('container_workspace_sftp_queue_name', item.id)"
            :title="item.remotePath"
          >
            {{ item.name }}
          </span>
          <span :class="instanceClassFor('container_workspace_sftp_queue_stats', item.id)">
            <template v-if="item.status === 'running'">
              {{ formatBytes(item.transferredBytes) }} / {{ formatBytes(item.totalBytes) }} ·
              {{ formatSpeed(item.speedBps) }}
            </template>
            <template v-else-if="item.status === 'completed'">
              {{ t('sftp.queueCompleted', { size: formatBytes(item.totalBytes) }) }}
            </template>
            <template v-else-if="item.status === 'queued'">{{ t('sftp.queueWaiting') }}</template>
            <template v-else-if="item.status === 'cancelled'">{{ t('sftp.queueCancelled') }}</template>
            <template v-else>{{ item.error || t('sftp.queueFailed') }}</template>
          </span>
          <button
            v-if="item.status === 'running' || item.status === 'queued'"
            :class="instanceClassFor('container_workspace_sftp_queue_cancel', item.id)"
            type="button"
            :aria-label="t('sftp.queueCancelAria')"
            @click="cancelSftpTransfer(item)"
          >
            <X :size="12" />
          </button>
          <button
            v-else-if="item.status === 'failed' || item.status === 'cancelled'"
            :class="instanceClassFor('container_workspace_sftp_queue_retry', item.id)"
            type="button"
            :aria-label="t('sftp.queueRetryAria')"
            @click="retrySftpTransfer(item)"
          >
            <RotateCw :size="12" />
          </button>
          <button
            v-else-if="item.status === 'completed' && item.direction === 'download'"
            :class="instanceClassFor('container_workspace_sftp_queue_reveal', item.id)"
            type="button"
            :aria-label="t('sftp.queueRevealAria')"
            :title="t('sftp.queueRevealTitle')"
            @click="emit('revealLocal', item.localPath)"
          >
            <FolderOpen :size="12" />
          </button>
        </div>
        <div :class="instanceClassFor('container_workspace_sftp_queue_track', item.id)">
          <div
            :class="instanceClassFor('container_workspace_sftp_queue_bar', item.id)"
            :style="{ width: `${transferPercent(item)}%` }"
          />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
.container_workspace_sftp_queue_base {
  border-top: 1px solid var(--color-border);
  background: var(--color-surface-chrome);
  display: flex;
  flex-direction: column;
  max-height: 210px;
  flex-shrink: 0;
}
.container_workspace_sftp_queue_header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 8px;
  border-bottom: 1px solid var(--color-border-subtle);
}
.container_workspace_sftp_queue_toggle,
.container_workspace_sftp_queue_clear {
  min-height: 22px;
  padding: 2px 6px;
  font-size: 11px;
}
.container_workspace_sftp_queue_list {
  overflow: auto;
  padding: 5px 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  animation: sftp-queue-enter 160ms ease-out;
}
@keyframes sftp-queue-enter {
  from {
    opacity: 0;
    transform: translateY(5px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
[class*='container_workspace_sftp_queue_item'] {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 5px 7px;
  border-radius: 5px;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border-subtle);
}
[class*='container_workspace_sftp_queue_row'] {
  display: flex;
  align-items: center;
  gap: 6px;
  > button {
    min-height: 20px;
    padding: 2px 5px;
  }
}
[class*='container_workspace_sftp_queue_dir'] {
  color: var(--color-accent-primary-hover);
  display: inline-flex;
}
[class*='container_workspace_sftp_queue_name'] {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 11px;
}
[class*='container_workspace_sftp_queue_stats'] {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-text-muted);
  white-space: nowrap;
}
[class*='container_workspace_sftp_queue_track'] {
  height: 3px;
  border-radius: 2px;
  background: var(--color-surface-1);
  overflow: hidden;
}
[class*='container_workspace_sftp_queue_bar'] {
  height: 100%;
  background: linear-gradient(90deg, var(--color-accent-secondary), var(--color-accent-primary));
  transition: width 120ms linear;
}
</style>
