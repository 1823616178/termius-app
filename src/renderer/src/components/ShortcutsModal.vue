<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { t } from '../services/i18n'
import { showHelp } from '../stores/workbench'

const dialogRef = ref<HTMLDialogElement>()
const titleId = useId()
const previousFocus = document.activeElement as HTMLElement | null

onMounted(async () => {
  dialogRef.value?.showModal()
  await nextTick()
})

onBeforeUnmount(() => {
  if (previousFocus?.isConnected) previousFocus.focus()
})
</script>

<template>
  <dialog
    ref="dialogRef"
    class="container_app_shortcuts_overlay_base"
    :aria-labelledby="titleId"
    @cancel.prevent="showHelp = false"
    @mousedown.self="showHelp = false"
  >
    <div class="container_app_shortcuts_body_card">
      <h3 :id="titleId" class="container_app_shortcuts_header_title">{{ t('shortcuts.title') }}</h3>
      <p class="container_app_shortcuts_body_new">{{ t('shortcuts.newLocal') }}</p>
      <p class="container_app_shortcuts_body_close">{{ t('shortcuts.closeTab') }}</p>
      <p class="container_app_shortcuts_body_switch">{{ t('shortcuts.switchTab') }}</p>
      <p class="container_app_shortcuts_body_copy">{{ t('shortcuts.copyPaste') }}</p>
      <p class="container_app_shortcuts_body_search">{{ t('shortcuts.search') }}</p>
      <p class="container_app_shortcuts_body_hosts">{{ t('shortcuts.searchHosts') }}</p>
      <p class="container_app_shortcuts_body_interrupt">{{ t('shortcuts.passthrough') }}</p>
      <button
        class="container_app_shortcuts_footer_close"
        type="button"
        data-primary
        @click="showHelp = false"
      >
        {{ t('shortcuts.ack') }}
      </button>
    </div>
  </dialog>
</template>

<style scoped lang="scss">
.container_app_shortcuts_overlay_base {
  padding: 0;
  border: 1px solid var(--color-border-control);
  background: var(--surface-card-gradient);
  color: var(--color-text-primary);
  border-radius: 6px;
  box-shadow: var(--shadow-3d-dialog);
  &::backdrop {
    background: var(--color-backdrop);
  }
}
.container_app_shortcuts_body_card {
  padding: 22px 24px;
  p {
    color: var(--color-text-secondary);
    font-size: var(--font-size-ui-sm);
    margin: 8px 0;
  }
}
.container_app_shortcuts_header_title {
  font-family: var(--font-display);
  font-size: var(--font-size-ui-xl);
  color: var(--color-text-heading);
  margin: 0 0 12px;
}
.container_app_shortcuts_footer_close {
  margin-top: 12px;
}
</style>
