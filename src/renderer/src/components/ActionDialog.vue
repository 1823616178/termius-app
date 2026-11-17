<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick, useId } from 'vue'
import { ShieldCheck, TriangleAlert } from '@lucide/vue'

defineProps<{
  kind: 'password' | 'trust' | 'delete'
  title: string
  description: string
  alertMessage?: string
  fingerprint?: string
  previous?: string
  encryptionAvailable?: boolean
  hasSavedPassword?: boolean
  busy?: boolean
}>()
const emit = defineEmits<{ confirm: [value: string, savePassword?: boolean]; cancel: [] }>()

const titleId = useId()
const root = ref<HTMLDialogElement>()
const password = ref('')
const savePassword = ref(false)
const field = ref<HTMLInputElement>()
const acknowledge = ref(false)
const previousFocus = document.activeElement as HTMLElement | null

onMounted(async () => {
  root.value?.showModal()
  await nextTick()
  field.value?.focus()
})

onBeforeUnmount(() => {
  password.value = ''
  savePassword.value = false
  if (previousFocus?.isConnected) previousFocus.focus()
})
</script>

<template>
  <dialog
    ref="root"
    class="container_shared_action_dialog_base"
    :aria-labelledby="titleId"
    @cancel.prevent="!busy && emit('cancel')"
  >
    <form class="container_shared_action_body_form" @submit.prevent="emit('confirm', password, savePassword)">
      <span class="container_shared_action_header_icon">
        <TriangleAlert v-if="kind === 'delete' || previous || alertMessage" :size="24" />
        <ShieldCheck v-else :size="24" />
      </span>
      <h2 :id="titleId" class="container_shared_action_header_title">{{ title }}</h2>
      <p v-if="alertMessage" class="container_shared_action_body_alert" role="alert">
        {{ alertMessage }}
      </p>
      <p class="container_shared_action_body_description">{{ description }}</p>
      <template v-if="kind === 'password'">
        <label class="container_shared_action_body_password-label">
          本次连接密码
          <input
            ref="field"
            v-model="password"
            class="container_shared_action_body_password-input"
            type="password"
            autocomplete="current-password"
          />
        </label>
        <label v-if="encryptionAvailable" class="container_shared_action_body_save-label">
          <input v-model="savePassword" class="container_shared_action_body_save-input" type="checkbox" />
          {{
            hasSavedPassword ? '更新并保存密码到此主机（系统凭据保护）' : '保存密码到此主机（系统凭据保护）'
          }}
        </label>
        <p v-else class="container_shared_action_body_nokeyring">
          当前环境未检测到可用系统 Keyring，本次密码仅在会话内存中临时使用，不会落盘保存。
        </p>
      </template>
      <template v-if="kind === 'trust'">
        <span class="container_shared_action_body_fingerprint-label">服务器公钥指纹</span>
        <code class="container_shared_action_body_fingerprint">{{ fingerprint }}</code>
        <template v-if="previous">
          <span class="container_shared_action_body_previous-label">之前信任的指纹</span>
          <code class="container_shared_action_body_previous">{{ previous }}</code>
          <label class="container_shared_action_body_acknowledge-label">
            <input
              v-model="acknowledge"
              class="container_shared_action_body_acknowledge-input"
              type="checkbox"
            />
            我已通过独立渠道核实主机密钥变更
          </label>
        </template>
        <p class="container_shared_action_body_trust-help">
          请与服务器管理员或可信渠道提供的 SHA256 指纹核对。
        </p>
      </template>
      <footer class="container_shared_action_footer_base">
        <button
          class="container_shared_action_footer_cancel"
          type="button"
          :disabled="busy"
          @click="emit('cancel')"
        >
          取消
        </button>
        <button
          class="container_shared_action_footer_confirm"
          :data-danger="kind === 'delete'"
          :data-primary="kind !== 'delete'"
          :disabled="busy || (!!previous && !acknowledge)"
        >
          {{
            busy
              ? '处理中…'
              : kind === 'trust'
                ? '信任并继续'
                : kind === 'delete'
                  ? '删除配置'
                  : alertMessage
                    ? '重新连接'
                    : '连接'
          }}
        </button>
      </footer>
    </form>
  </dialog>
</template>

<style scoped lang="scss">
.container_shared_action_dialog_base {
  width: 470px;
  padding: 0;
  background: var(--surface-card-gradient);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-control);
  border-radius: 6px;
  box-shadow: var(--shadow-3d-dialog);
  &::backdrop {
    background: var(--color-backdrop);
    backdrop-filter: blur(4px);
  }
}
.container_shared_action_body_form {
  padding: 28px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.container_shared_action_header_icon {
  color: var(--color-accent-primary);
}
.container_shared_action_header_title {
  margin: 0;
  font-size: 20px;
}
.container_shared_action_body_description {
  margin: 0;
  color: var(--color-text-secondary);
  line-height: 1.8;
  overflow-wrap: anywhere;
}
.container_shared_action_body_alert {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--color-warning-soft);
  border: 1px solid rgba(245, 196, 107, 0.35);
  color: var(--color-warning);
  font-size: 13px;
  line-height: 1.6;
}
.container_shared_action_body_password-label {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 12px;
  color: var(--color-text-secondary);
}
.container_shared_action_body_save-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--color-text-secondary);
  cursor: pointer;
}
.container_shared_action_body_nokeyring {
  margin: 0;
  font-size: 12px;
  color: var(--color-text-muted);
  line-height: 1.6;
}
.container_shared_action_body_fingerprint,
.container_shared_action_body_previous {
  padding: 12px;
  background: var(--color-app-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  overflow-wrap: anywhere;
  color: var(--color-accent-secondary);
  font-size: 12px;
}
.container_shared_action_body_fingerprint-label,
.container_shared_action_body_previous-label {
  color: var(--color-text-muted);
  font-size: 12px;
}
.container_shared_action_body_trust-help {
  font-size: 12px;
  color: var(--color-warning);
}
.container_shared_action_body_acknowledge-label {
  font-size: 12px;
  line-height: 1.8;
}
.container_shared_action_footer_base {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 8px;
}
</style>
