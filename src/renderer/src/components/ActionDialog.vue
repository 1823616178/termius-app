<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick, useId } from 'vue'
import { ShieldCheck, TriangleAlert } from '@lucide/vue'
import { t } from '../services/i18n'
import OrbitCheckbox from './OrbitCheckbox.vue'

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
          {{ t('actionDialog.passwordLabel') }}
          <input
            ref="field"
            v-model="password"
            class="container_shared_action_body_password-input"
            type="password"
            autocomplete="current-password"
          />
        </label>
        <label v-if="encryptionAvailable" class="container_shared_action_body_save-label">
          <OrbitCheckbox
            v-model="savePassword"
            class="container_shared_action_body_save-input"
            instance="action-dialog-save"
          />
          {{ hasSavedPassword ? t('actionDialog.updateSavedPassword') : t('actionDialog.savePassword') }}
        </label>
        <p v-else class="container_shared_action_body_nokeyring">
          {{ t('actionDialog.noKeyring') }}
        </p>
      </template>
      <template v-if="kind === 'trust'">
        <span class="container_shared_action_body_fingerprint-label">
          {{ t('actionDialog.fingerprintLabel') }}
        </span>
        <code class="container_shared_action_body_fingerprint">{{ fingerprint }}</code>
        <template v-if="previous">
          <span class="container_shared_action_body_previous-label">
            {{ t('actionDialog.previousLabel') }}
          </span>
          <code class="container_shared_action_body_previous">{{ previous }}</code>
          <label class="container_shared_action_body_acknowledge-label">
            <OrbitCheckbox
              v-model="acknowledge"
              class="container_shared_action_body_acknowledge-input"
              instance="action-dialog-ack"
            />
            {{ t('actionDialog.acknowledgeChangedKey') }}
          </label>
        </template>
        <p class="container_shared_action_body_trust-help">
          {{ t('actionDialog.trustHelp') }}
        </p>
      </template>
      <footer class="container_shared_action_footer_base">
        <button
          class="container_shared_action_footer_cancel"
          type="button"
          :disabled="busy"
          @click="emit('cancel')"
        >
          {{ t('actionDialog.cancel') }}
        </button>
        <button
          class="container_shared_action_footer_confirm"
          type="submit"
          :autofocus="kind === 'trust' && !previous"
          :data-danger="kind === 'delete'"
          :data-primary="kind !== 'delete'"
          :disabled="busy || (!!previous && !acknowledge)"
        >
          {{
            busy
              ? t('actionDialog.processing')
              : kind === 'trust'
                ? t('actionDialog.trustContinue')
                : kind === 'delete'
                  ? t('actionDialog.deleteConfirm')
                  : alertMessage
                    ? t('actionDialog.reconnect')
                    : t('actionDialog.connect')
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
  font-family: var(--font-display);
  font-size: var(--font-size-ui-2xl);
  font-weight: var(--font-ui-heading-weight);
  color: var(--color-text-heading);
}
.container_shared_action_body_description {
  margin: 0;
  font-size: var(--font-size-ui-sm);
  color: var(--color-text-secondary);
  line-height: var(--font-ui-line-height);
  letter-spacing: var(--font-ui-letter-spacing);
  overflow-wrap: anywhere;
}
.container_shared_action_body_alert {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--color-warning-soft);
  border: 1px solid rgba(245, 196, 107, 0.35);
  color: var(--color-warning);
  font-size: var(--font-size-ui-sm);
  line-height: 1.6;
}
.container_shared_action_body_password-label {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: var(--font-size-ui-xs);
  color: var(--color-text-secondary);
}
.container_shared_action_body_save-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--font-size-ui-xs);
  color: var(--color-text-secondary);
  cursor: pointer;
}
.container_shared_action_body_nokeyring {
  margin: 0;
  font-size: var(--font-size-ui-xs);
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
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  line-height: 1.6;
  cursor: pointer;
}
.container_shared_action_footer_base {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 8px;
}
</style>
