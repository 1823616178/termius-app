<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, useId, watch } from 'vue'
import { X, ShieldCheck } from '@lucide/vue'
import { hostInputSchema, type Host, type HostInput } from '../../../shared/contracts'
import { locale, t } from '../services/i18n'
import { bootstrap, protocolSettings } from '../stores/workbench'
import OrbitCheckbox from './OrbitCheckbox.vue'
import OrbitSelect from './OrbitSelect.vue'

const isLinux = computed(() => bootstrap.value?.platform === 'linux')

const authOptions = computed(() => {
  void locale.value
  return [
    { value: 'password', label: t('hostEditor.authPassword') },
    {
      value: 'agent',
      label: isLinux.value ? t('hostEditor.authAgentLinux') : t('hostEditor.authAgentWindows')
    }
  ]
})

const props = defineProps<{ host?: Host; encryptionAvailable: boolean; busy: boolean; error: string }>()
const emit = defineEmits<{ save: [input: HostInput]; close: [] }>()

const titleId = useId()
const nameErrorId = useId()
const addressErrorId = useId()
const portErrorId = useId()
const usernameErrorId = useId()
const passwordErrorId = useId()
const clearPasswordErrorId = useId()
const groupErrorId = useId()
const notesErrorId = useId()

const form = reactive<HostInput>({
  name: props.host?.name ?? '',
  address: props.host?.address ?? '',
  port: props.host?.port ?? protocolSettings.value.ssh.defaultPort,
  username: props.host?.username ?? '',
  auth: props.host?.auth ?? 'password',
  keepalive: props.host?.keepalive ?? protocolSettings.value.ssh.defaultKeepaliveSec,
  group: props.host?.group ?? '',
  notes: props.host?.notes ?? '',
  favorite: props.host?.favorite ?? false,
  password: '',
  savePassword: false,
  clearPassword: false,
  id: props.host?.id
})

const errors = ref<Record<string, string>>({})
const root = ref<HTMLDialogElement>()
const first = ref<HTMLInputElement>()
const previous = document.activeElement as HTMLElement | null

watch(
  () => form.password,
  (value) => {
    if (value) form.clearPassword = false
  }
)

onMounted(async () => {
  root.value?.showModal()
  await nextTick()
  first.value?.focus()
})

onBeforeUnmount(() => {
  form.password = ''
  if (previous?.isConnected) previous.focus()
})

function submit() {
  errors.value = {}
  if (form.auth === 'password' && form.password && !form.savePassword) {
    errors.value.password = props.encryptionAvailable
      ? t('hostEditor.needSavePasswordCheck')
      : isLinux.value
        ? t('hostEditor.cannotSaveLinux')
        : t('hostEditor.cannotSaveWin')
    return
  }
  const normalized: HostInput = {
    ...form,
    port:
      typeof form.port === 'number' && !Number.isNaN(form.port)
        ? form.port
        : (undefined as unknown as number),
    keepalive: typeof form.keepalive === 'number' && !Number.isNaN(form.keepalive) ? form.keepalive : 30
  }
  const result = hostInputSchema.safeParse(normalized)
  if (!result.success) {
    for (const issue of result.error.issues) {
      const key = issue.path[0] ? String(issue.path[0]) : '_root'
      if (!errors.value[key]) errors.value[key] = issue.message
    }
    return
  }
  emit('save', result.data)
}
</script>

<template>
  <dialog
    ref="root"
    class="container_hosts_editor_dialog_base"
    :aria-labelledby="titleId"
    @cancel.prevent="!busy && emit('close')"
    @mousedown.self="!busy && emit('close')"
  >
    <form class="container_hosts_editor_body_form" @submit.prevent="submit">
      <header class="container_hosts_editor_header_base">
        <div class="container_hosts_editor_header_copy">
          <span class="container_hosts_editor_header_eyebrow">{{ t('hostEditor.eyebrow') }}</span>
          <h2 :id="titleId" class="container_hosts_editor_header_title">
            {{ host ? t('hostEditor.editTitle') : t('hostEditor.newTitle') }}
          </h2>
        </div>
        <button
          class="container_hosts_editor_header_close"
          type="button"
          :aria-label="t('hostEditor.closeAria')"
          :disabled="busy"
          @click="emit('close')"
        >
          <X :size="18" />
        </button>
      </header>
      <label class="container_hosts_editor_body_name-label">
        {{ t('hostEditor.name') }}
        <input
          ref="first"
          v-model="form.name"
          class="container_hosts_editor_body_name-input"
          :placeholder="t('hostEditor.namePlaceholder')"
          maxlength="80"
          :aria-invalid="!!errors.name"
          :aria-describedby="nameErrorId"
        />
        <span v-if="errors.name" :id="nameErrorId" class="container_hosts_editor_body_name-error">
          {{ errors.name }}
        </span>
      </label>
      <div class="container_hosts_editor_body_endpoint">
        <label class="container_hosts_editor_body_address-label">
          {{ t('hostEditor.address') }}
          <input
            v-model="form.address"
            class="container_hosts_editor_body_address-input"
            :placeholder="t('hostEditor.addressPlaceholder')"
            :aria-invalid="!!errors.address"
            :aria-describedby="addressErrorId"
          />
          <span v-if="errors.address" :id="addressErrorId" class="container_hosts_editor_body_address-error">
            {{ errors.address }}
          </span>
        </label>
        <label class="container_hosts_editor_body_port-label">
          {{ t('hostEditor.port') }}
          <input
            v-model.number="form.port"
            class="container_hosts_editor_body_port-input"
            type="number"
            min="1"
            max="65535"
            :aria-invalid="!!errors.port"
            :aria-describedby="portErrorId"
          />
          <span v-if="errors.port" :id="portErrorId" class="container_hosts_editor_body_port-error">
            {{ errors.port }}
          </span>
        </label>
      </div>
      <label class="container_hosts_editor_body_username-label">
        {{ t('hostEditor.username') }}
        <input
          v-model="form.username"
          class="container_hosts_editor_body_username-input"
          autocomplete="username"
          :placeholder="t('hostEditor.usernamePlaceholder')"
          :aria-invalid="!!errors.username"
          :aria-describedby="usernameErrorId"
        />
        <span v-if="errors.username" :id="usernameErrorId" class="container_hosts_editor_body_username-error">
          {{ errors.username }}
        </span>
      </label>
      <label class="container_hosts_editor_body_auth-label">
        {{ t('hostEditor.auth') }}
        <OrbitSelect
          :model-value="form.auth"
          :options="authOptions"
          :aria-label="t('hostEditor.auth')"
          block
          instance="host-editor-auth"
          @update:model-value="form.auth = $event as 'password' | 'agent'"
        />
      </label>
      <template v-if="form.auth === 'password'">
        <label class="container_hosts_editor_body_password-label">
          {{ host?.hasPassword ? t('hostEditor.passwordReplace') : t('hostEditor.passwordNew') }}
          <input
            v-model="form.password"
            class="container_hosts_editor_body_password-input"
            type="password"
            maxlength="16384"
            autocomplete="new-password"
            :aria-invalid="!!errors.password"
            :aria-describedby="passwordErrorId"
          />
          <span
            v-if="errors.password"
            :id="passwordErrorId"
            class="container_hosts_editor_body_password-error"
          >
            {{ errors.password }}
          </span>
        </label>
        <label class="container_hosts_editor_body_save-label">
          <OrbitCheckbox
            v-model="form.savePassword"
            class="container_hosts_editor_body_save-check"
            :disabled="!encryptionAvailable"
            instance="host-editor-save"
          />
          {{
            encryptionAvailable
              ? isLinux
                ? t('hostEditor.savePasswordLinux')
                : t('hostEditor.savePasswordWin')
              : isLinux
                ? t('hostEditor.savePasswordDisabledLinux')
                : t('hostEditor.savePasswordDisabledWin')
          }}
        </label>
        <label v-if="host?.hasPassword" class="container_hosts_editor_body_clear-label">
          <OrbitCheckbox
            v-model="form.clearPassword"
            class="container_hosts_editor_body_clear-check"
            :disabled="Boolean(form.password)"
            :aria-describedby="clearPasswordErrorId"
            instance="host-editor-clear"
          />
          {{ t('hostEditor.clearPassword') }}
        </label>
        <span
          v-if="errors.clearPassword"
          :id="clearPasswordErrorId"
          class="container_hosts_editor_body_clear-error"
        >
          {{ errors.clearPassword }}
        </span>
      </template>
      <label class="container_hosts_editor_body_keepalive-label">
        {{ t('hostEditor.keepalive') }}
        <input
          v-model.number="form.keepalive"
          class="container_hosts_editor_body_keepalive-input"
          type="number"
          min="0"
          max="3600"
        />
      </label>
      <label class="container_hosts_editor_body_group-label">
        {{ t('hostEditor.group') }}
        <input
          v-model="form.group"
          class="container_hosts_editor_body_group-input"
          :placeholder="t('hostEditor.groupPlaceholder')"
          maxlength="60"
          :aria-invalid="!!errors.group"
          :aria-describedby="groupErrorId"
        />
        <span v-if="errors.group" :id="groupErrorId" class="container_hosts_editor_body_group-error">
          {{ errors.group }}
        </span>
      </label>
      <label class="container_hosts_editor_body_notes-label">
        {{ t('hostEditor.notes') }}
        <textarea
          v-model="form.notes"
          class="container_hosts_editor_body_notes-input"
          rows="2"
          maxlength="2000"
          :placeholder="t('hostEditor.notesPlaceholder')"
          :aria-invalid="!!errors.notes"
          :aria-describedby="notesErrorId"
        />
        <span v-if="errors.notes" :id="notesErrorId" class="container_hosts_editor_body_notes-error">
          {{ errors.notes }}
        </span>
      </label>
      <label class="container_hosts_editor_body_favorite-label">
        <OrbitCheckbox
          v-model="form.favorite"
          class="container_hosts_editor_body_favorite-check"
          instance="host-editor-fav"
        />
        {{ t('hostEditor.favorite') }}
      </label>
      <p v-if="error || errors._root" class="container_hosts_editor_body_error" role="alert">
        {{ error || errors._root }}
      </p>
      <footer class="container_hosts_editor_footer_base">
        <span class="container_hosts_editor_footer_hint">
          <ShieldCheck :size="14" />
          {{ t('hostEditor.localOnlyHint') }}
        </span>
        <button
          class="container_hosts_editor_footer_cancel"
          type="button"
          :disabled="busy"
          @click="emit('close')"
        >
          {{ t('hostEditor.cancel') }}
        </button>
        <button class="container_hosts_editor_footer_submit" data-primary type="submit" :disabled="busy">
          {{ busy ? t('hostEditor.saving') : t('hostEditor.save') }}
        </button>
      </footer>
    </form>
  </dialog>
</template>

<style scoped lang="scss">
.container_hosts_editor_dialog_base {
  width: 500px;
  padding: 0;
  border: 1px solid var(--color-border-control);
  border-radius: 6px;
  background: var(--surface-card-gradient);
  color: var(--color-text-primary);
  box-shadow: var(--shadow-3d-dialog);
  max-height: 90vh;
  &::backdrop {
    background: var(--color-backdrop);
    backdrop-filter: blur(4px);
  }
}
.container_hosts_editor_body_form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 24px;
  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    color: var(--color-text-secondary);
    font-size: var(--font-size-ui-xs);
  }
  input,
  textarea {
    width: 100%;
  }
  span[id] {
    color: var(--color-error);
  }
}
.container_hosts_editor_header_base {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.container_hosts_editor_header_eyebrow {
  color: var(--color-accent-primary);
  font-size: var(--font-size-ui-xs);
  letter-spacing: 1.5px;
}
.container_hosts_editor_header_title {
  margin: 4px 0;
  font-family: var(--font-display);
  font-size: var(--font-size-ui-2xl);
  font-weight: var(--font-ui-heading-weight);
  color: var(--color-text-heading);
}
.container_hosts_editor_body_endpoint {
  display: grid;
  grid-template-columns: 1fr 92px;
  gap: 12px;
}
.container_hosts_editor_body_save-label,
.container_hosts_editor_body_clear-label,
.container_hosts_editor_body_favorite-label {
  flex-direction: row !important;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}
.container_hosts_editor_body_clear-error {
  color: var(--color-error);
  font-size: 12px;
}
.container_hosts_editor_footer_base {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 14px;
  border-top: 1px solid var(--color-border);
}
.container_hosts_editor_footer_hint {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-right: auto;
  color: var(--color-text-muted);
  font-size: 12px;
}
.container_hosts_editor_body_error {
  margin: 0;
  color: var(--color-error);
  font-size: 12px;
}
</style>
