<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check } from '@lucide/vue'
import { instanceClass } from '../../../shared/classes'
import type { SyncConflict, SyncConflictResolutionItem } from '../../../shared/sync'
import { t } from '../services/i18n'
import { groupToken, windowInstance } from '../stores/workbench'

const props = defineProps<{
  conflicts: SyncConflict[]
  busy: boolean
}>()

const emit = defineEmits<{
  resolve: [resolutions: SyncConflictResolutionItem[]]
}>()

const c = (base: string, id: string) => instanceClass(base, windowInstance(groupToken(`sync:${id}`)))
const conflictChoices = ref<Record<string, 'local' | 'remote'>>({})

function entityTypeLabel(entityType: SyncConflict['entityType']): string {
  return t(`sync.entity.${entityType}`)
}

const allConflictsChosen = computed(
  () => props.conflicts.length > 0 && props.conflicts.every((item) => Boolean(conflictChoices.value[item.id]))
)

watch(
  () => props.conflicts,
  (conflicts) => {
    const next: Record<string, 'local' | 'remote'> = {}
    for (const item of conflicts) {
      if (conflictChoices.value[item.id]) next[item.id] = conflictChoices.value[item.id]!
    }
    conflictChoices.value = next
  }
)

function selectConflictChoice(conflictId: string, choice: 'local' | 'remote') {
  conflictChoices.value = { ...conflictChoices.value, [conflictId]: choice }
}

function submitResolutions() {
  emit(
    'resolve',
    props.conflicts.map((item) => ({
      conflictId: item.id,
      choice: conflictChoices.value[item.id] ?? 'local'
    }))
  )
}
</script>

<template>
  <section
    v-if="conflicts.length"
    class="container_sync_conflict_body_section"
    :aria-label="t('sync.conflictAria')"
  >
    <header class="container_sync_conflict_header_base">
      <h3 class="container_sync_conflict_header_title">
        {{ t('sync.conflictTitle', { count: conflicts.length }) }}
      </h3>
      <button
        class="container_sync_conflict_header_apply"
        type="button"
        data-primary
        :disabled="busy || !allConflictsChosen"
        @click="submitResolutions"
      >
        <Check :size="14" />
        {{ t('sync.conflictApply') }}
      </button>
    </header>
    <div class="container_sync_conflict_body_list">
      <article
        v-for="item in conflicts"
        :key="item.id"
        :class="c('container_sync_conflict_body_item', item.id)"
      >
        <div :class="c('container_sync_conflict_body_item-head', item.id)">
          <div :class="c('container_sync_conflict_body_item-title', item.id)">
            <span :class="c('container_sync_conflict_body_item-kind', item.id)">
              {{ entityTypeLabel(item.entityType) }}
            </span>
            <strong :class="c('container_sync_conflict_body_item-name', item.id)">
              {{ item.entityName }}
            </strong>
          </div>
          <span :class="c('container_sync_conflict_body_item-field', item.id)">{{ item.fieldLabel }}</span>
        </div>
        <div :class="c('container_sync_conflict_body_choices', item.id)">
          <button
            :class="c('container_sync_conflict_body_choice-local', item.id)"
            type="button"
            :data-selected="conflictChoices[item.id] === 'local' ? 'true' : 'false'"
            @click="selectConflictChoice(item.id, 'local')"
          >
            {{ t('sync.conflictKeepLocal', { val: item.localDisplay }) }}
          </button>
          <button
            :class="c('container_sync_conflict_body_choice-remote', item.id)"
            type="button"
            :data-selected="conflictChoices[item.id] === 'remote' ? 'true' : 'false'"
            @click="selectConflictChoice(item.id, 'remote')"
          >
            {{ t('sync.conflictUseRemote', { val: item.remoteDisplay }) }}
          </button>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped lang="scss">
.container_sync_conflict_body_section {
  border: 1px solid rgba(239, 68, 68, 0.4);
  background: var(--surface-card-gradient);
  border-radius: 10px;
  padding: 18px;
  margin-bottom: 20px;
}
.container_sync_conflict_header_base {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}
.container_sync_conflict_header_title {
  margin: 0;
  font-size: 15px;
  font-weight: 500;
}
.container_sync_conflict_header_apply {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.container_sync_conflict_body_list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.container_sync_conflict_body_item {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 12px;
  background: var(--color-surface-canvas);
}
.container_sync_conflict_body_item-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 13px;
}
.container_sync_conflict_body_item-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.container_sync_conflict_body_item-kind {
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid var(--color-border-control);
  background: var(--color-surface-elevated);
  color: var(--color-accent-primary);
  white-space: nowrap;
}
.container_sync_conflict_body_item-field {
  color: var(--color-text-muted);
}
.container_sync_conflict_body_choices {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 8px;
}
.container_sync_conflict_body_choice-local,
.container_sync_conflict_body_choice-remote {
  text-align: left;
  font-size: 12px;
  &[data-selected='true'] {
    border-color: var(--color-accent-primary);
    background: var(--color-accent-primary-soft);
    color: var(--color-text-primary);
  }
}
</style>
