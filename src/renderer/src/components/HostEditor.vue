<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, useId, watch } from 'vue'
import { X, ShieldCheck } from '@lucide/vue'
import { hostInputSchema, type Host, type HostInput } from '../../../shared/contracts'
import { bootstrap } from '../stores/workbench'
import OrbitSelect from './OrbitSelect.vue'

const isLinux = computed(() => bootstrap.value?.platform === 'linux')

const authOptions = computed(() => [
  { value: 'password', label: '密码' },
  {
    value: 'agent',
    label: isLinux.value ? 'OpenSSH Agent (SSH_AUTH_SOCK)' : 'Windows OpenSSH Agent'
  }
])

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
  port: props.host?.port ?? 22,
  username: props.host?.username ?? '',
  auth: props.host?.auth ?? 'password',
  keepalive: props.host?.keepalive ?? 30,
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
      ? '已输入新密码，请勾选“使用系统凭据保护保存密码”，或清空密码框。'
      : isLinux.value
        ? '当前未检测到可用系统 Keyring（gnome-keyring / kwallet），不能保存密码；请留空并在连接时临时输入。'
        : '系统凭据保护不可用，不能保存密码；请留空并在连接时输入。'
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
          <span class="container_hosts_editor_header_eyebrow">御剑传讯 · 灵脉契约</span>
          <h2 :id="titleId" class="container_hosts_editor_header_title">
            {{ host ? '编辑主机' : '新建主机' }}
          </h2>
        </div>
        <button
          class="container_hosts_editor_header_close"
          type="button"
          aria-label="关闭主机编辑"
          :disabled="busy"
          @click="emit('close')"
        >
          <X :size="18" />
        </button>
      </header>
      <label class="container_hosts_editor_body_name-label">
        主机名称
        <input
          ref="first"
          v-model="form.name"
          class="container_hosts_editor_body_name-input"
          placeholder="例如：开发服务器"
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
          主机地址
          <input
            v-model="form.address"
            class="container_hosts_editor_body_address-input"
            placeholder="IP 地址或域名"
            :aria-invalid="!!errors.address"
            :aria-describedby="addressErrorId"
          />
          <span v-if="errors.address" :id="addressErrorId" class="container_hosts_editor_body_address-error">
            {{ errors.address }}
          </span>
        </label>
        <label class="container_hosts_editor_body_port-label">
          端口
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
        用户名
        <input
          v-model="form.username"
          class="container_hosts_editor_body_username-input"
          autocomplete="username"
          placeholder="例如：ubuntu"
          :aria-invalid="!!errors.username"
          :aria-describedby="usernameErrorId"
        />
        <span v-if="errors.username" :id="usernameErrorId" class="container_hosts_editor_body_username-error">
          {{ errors.username }}
        </span>
      </label>
      <label class="container_hosts_editor_body_auth-label">
        认证方式
        <OrbitSelect
          :model-value="form.auth"
          :options="authOptions"
          aria-label="认证方式"
          block
          instance="host-editor-auth"
          @update:model-value="form.auth = $event as 'password' | 'agent'"
        />
      </label>
      <template v-if="form.auth === 'password'">
        <label class="container_hosts_editor_body_password-label">
          {{ host?.hasPassword ? '替换密码（留空保留已保存密码）' : '连接密码（可在连接时输入）' }}
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
          <input
            v-model="form.savePassword"
            class="container_hosts_editor_body_save-check"
            type="checkbox"
            :disabled="!encryptionAvailable"
          />
          {{
            encryptionAvailable
              ? isLinux
                ? '使用系统 Keyring 安全保存密码（libsecret）'
                : '使用 Windows 系统保护保存密码'
              : isLinux
                ? '保存密码已禁用（未检测到系统 Keyring：gnome-keyring / kwallet）'
                : '保存密码已禁用（系统凭据保护不可用）'
          }}
        </label>
        <label v-if="host?.hasPassword" class="container_hosts_editor_body_clear-label">
          <input
            v-model="form.clearPassword"
            class="container_hosts_editor_body_clear-check"
            type="checkbox"
            :disabled="Boolean(form.password)"
            :aria-describedby="clearPasswordErrorId"
          />
          移除已保存密码
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
        心跳保活间隔（秒，0 表示禁用）
        <input
          v-model.number="form.keepalive"
          class="container_hosts_editor_body_keepalive-input"
          type="number"
          min="0"
          max="3600"
        />
      </label>
      <label class="container_hosts_editor_body_group-label">
        本地分组
        <input
          v-model="form.group"
          class="container_hosts_editor_body_group-input"
          placeholder="可选，例如：开发环境"
          maxlength="60"
          :aria-invalid="!!errors.group"
          :aria-describedby="groupErrorId"
        />
        <span v-if="errors.group" :id="groupErrorId" class="container_hosts_editor_body_group-error">
          {{ errors.group }}
        </span>
      </label>
      <label class="container_hosts_editor_body_notes-label">
        备注
        <textarea
          v-model="form.notes"
          class="container_hosts_editor_body_notes-input"
          rows="2"
          maxlength="2000"
          placeholder="仅保存在这台设备"
          :aria-invalid="!!errors.notes"
          :aria-describedby="notesErrorId"
        />
        <span v-if="errors.notes" :id="notesErrorId" class="container_hosts_editor_body_notes-error">
          {{ errors.notes }}
        </span>
      </label>
      <label class="container_hosts_editor_body_favorite-label">
        <input v-model="form.favorite" class="container_hosts_editor_body_favorite-check" type="checkbox" />
        收藏主机
      </label>
      <p v-if="error || errors._root" class="container_hosts_editor_body_error" role="alert">
        {{ error || errors._root }}
      </p>
      <footer class="container_hosts_editor_footer_base">
        <span class="container_hosts_editor_footer_hint">
          <ShieldCheck :size="14" />
          仅保存在本机
        </span>
        <button
          class="container_hosts_editor_footer_cancel"
          type="button"
          :disabled="busy"
          @click="emit('close')"
        >
          取消
        </button>
        <button class="container_hosts_editor_footer_submit" data-primary type="submit" :disabled="busy">
          {{ busy ? '保存中…' : '保存主机' }}
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
    font-size: 12px;
  }
  input,
  textarea {
    width: 100%;
  }
  input[type='checkbox'] {
    width: auto;
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
  font-size: 12px;
  letter-spacing: 1.5px;
}
.container_hosts_editor_header_title {
  margin: 4px 0;
  font-size: 20px;
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
