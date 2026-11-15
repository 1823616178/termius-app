<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue'
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
      <h3 :id="titleId" class="container_app_shortcuts_header_title">常用快捷键</h3>
      <p class="container_app_shortcuts_body_new">Ctrl + Shift + T　新建本地终端</p>
      <p class="container_app_shortcuts_body_close">Ctrl + Shift + W　关闭当前标签</p>
      <p class="container_app_shortcuts_body_switch">Ctrl + Tab / Ctrl + Shift + Tab　切换标签</p>
      <p class="container_app_shortcuts_body_copy">
        Ctrl + Shift + C / V（或 Ctrl/Shift + Insert）　复制 / 粘贴
      </p>
      <p class="container_app_shortcuts_body_search">Ctrl + Shift + F　搜索终端输出</p>
      <p class="container_app_shortcuts_body_hosts">Ctrl + K（非终端区域）　搜索主机</p>
      <p class="container_app_shortcuts_body_interrupt">Ctrl + C、Ctrl + B、Ctrl + A　透传终端</p>
      <button
        class="container_app_shortcuts_footer_close"
        type="button"
        data-primary
        @click="showHelp = false"
      >
        知道了
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
    font-size: 13px;
    margin: 8px 0;
  }
}
.container_app_shortcuts_header_title {
  font-size: 16px;
  margin: 0 0 12px;
}
.container_app_shortcuts_footer_close {
  margin-top: 12px;
}
</style>
