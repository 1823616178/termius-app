<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, useId, watch } from 'vue'
import { AlertTriangle, HardDrive, ShieldCheck, X } from '@lucide/vue'
import { hostInputSchema, type HostInput } from '../../../shared/contracts'
import {
  FILE_DEFAULT_PORTS,
  fileProfileInputSchema,
  type FileConnectSource,
  type FileProfile,
  type FileProfileInput,
  type FileProtocol
} from '../../../shared/files'
import { locale, t } from '../services/i18n'
import { bootstrap, protocolSettings } from '../stores/workbench'
import OrbitSelect from './OrbitSelect.vue'

type EditorProtocol = 'sftp' | FileProtocol

const props = defineProps<{
  profile?: FileProfile
  initialMode: 'create' | 'edit' | 'quick'
  encryptionAvailable: boolean
  busy: boolean
  error: string
}>()

const emit = defineEmits<{
  close: []
  saveProfile: [input: FileProfileInput, connectAfter: boolean]
  connectAdhoc: [source: FileConnectSource & { kind: 'adhoc' }]
  saveSshAndConnect: [input: HostInput]
}>()

const titleId = useId()
const rootRef = ref<HTMLDialogElement>()
const firstInputRef = ref<HTMLInputElement>()
const previousFocus = document.activeElement as HTMLElement | null

const protocol = ref<EditorProtocol>(props.profile?.protocol ?? 'ftp')
const name = ref(props.profile?.name ?? '')
const host = ref(props.profile?.host ?? '')
const port = ref<number>(
  props.profile?.port ?? (props.profile ? FILE_DEFAULT_PORTS[props.profile.protocol] : FILE_DEFAULT_PORTS.ftp)
)
const username = ref(props.profile?.username ?? '')
const initialPath = ref(props.profile?.initialPath ?? '')
const notes = ref(props.profile?.notes ?? '')
const favorite = ref(props.profile?.favorite ?? false)
const saveSecrets = ref(Boolean(props.profile?.hasSecrets))
const clearSecrets = ref(false)

// SSH fields when protocol === 'sftp'
const sshAuth = ref<'password' | 'agent'>('password')
const sshKeepalive = ref<number>(protocolSettings.value.ssh.defaultKeepaliveSec)

// Protocol-specific fields
const ftpsMode = ref<'explicit' | 'implicit'>(props.profile?.options.tlsMode ?? 'explicit')
const tlsVerify = ref<'strict' | 'insecure'>(props.profile?.options.tlsVerify ?? 'strict')
const webdavUrl = ref(props.profile?.options.url ?? '')
const webdavAuth = ref<'basic' | 'digest' | 'token'>(props.profile?.options.webdavAuth ?? 'basic')
const s3Endpoint = ref(props.profile?.options.endpoint ?? '')
const s3Region = ref(props.profile?.options.region ?? 'us-east-1')
const s3Bucket = ref(props.profile?.options.bucket ?? '')
const s3ForcePathStyle = ref<boolean>(
  props.profile
    ? Boolean(props.profile.options.forcePathStyle)
    : protocolSettings.value.files.s3DefaultPathStyle
)

const secrets = reactive({
  password: '',
  token: '',
  secretAccessKey: '',
  sessionToken: ''
})

const errors = ref<Record<string, string>>({})
const isEdit = computed(() => props.initialMode === 'edit' && Boolean(props.profile))
const isQuick = computed(() => props.initialMode === 'quick')
const isLinux = computed(() => bootstrap.value?.platform === 'linux')
const backendLabel = computed(() =>
  bootstrap.value?.platform === 'win32'
    ? 'DPAPI'
    : bootstrap.value?.platform === 'linux'
      ? bootstrap.value.encryptionBackend
      : 'Keyring'
)

const protocolOptions = computed(() => {
  void locale.value
  const list: { value: EditorProtocol; label: string }[] = []
  if (!isEdit.value) {
    list.push({ value: 'sftp', label: 'SFTP (SSH)' })
  }
  list.push(
    { value: 'ftp', label: 'FTP' },
    { value: 'ftps', label: 'FTPS (TLS)' },
    { value: 'webdav', label: 'WebDAV' },
    { value: 's3', label: 'S3 / MinIO / R2' },
    {
      value: 'smb',
      label: locale.value === 'en-US' ? 'SMB / Samba (Coming Soon)' : 'SMB / Samba（即将支持）'
    }
  )
  return list
})

const ftpsModeOptions = computed(() => {
  void locale.value
  return [
    { value: 'explicit', label: t('fileEditor.ftpsExplicit') },
    { value: 'implicit', label: t('fileEditor.ftpsImplicit') }
  ]
})

const tlsVerifyOptions = computed(() => {
  void locale.value
  return [
    { value: 'strict', label: t('fileEditor.tlsStrict') },
    { value: 'insecure', label: t('fileEditor.tlsInsecure') }
  ]
})

const webdavAuthOptions = computed(() => {
  void locale.value
  return [
    { value: 'basic', label: t('fileEditor.webdavBasic') },
    { value: 'digest', label: t('fileEditor.webdavDigest') },
    { value: 'token', label: t('fileEditor.webdavBearer') }
  ]
})

const sshAuthOptions = computed(() => {
  void locale.value
  return [
    { value: 'password', label: t('hostEditor.authPassword') },
    {
      value: 'agent',
      label: isLinux.value ? t('hostEditor.authAgentLinux') : t('hostEditor.authAgentWindows')
    }
  ]
})

const showTlsOptions = computed(
  () => protocol.value === 'ftps' || protocol.value === 'webdav' || protocol.value === 's3'
)

watch(protocol, (next) => {
  errors.value = {}
  if (props.profile && next === props.profile.protocol) return
  if (next === 'sftp') port.value = protocolSettings.value.ssh.defaultPort
  else if (next === 'ftps') port.value = ftpsMode.value === 'implicit' ? 990 : 21
  else port.value = FILE_DEFAULT_PORTS[next]
})

watch(ftpsMode, (mode) => {
  if (protocol.value !== 'ftps' || isEdit.value) return
  port.value = mode === 'implicit' ? 990 : 21
})

watch(
  () => [secrets.password, secrets.token, secrets.secretAccessKey, secrets.sessionToken],
  (vals) => {
    if (vals.some(Boolean)) clearSecrets.value = false
  }
)

onMounted(async () => {
  if (props.profile) {
    port.value = props.profile.port
  } else {
    port.value =
      protocol.value === 'sftp' ? protocolSettings.value.ssh.defaultPort : FILE_DEFAULT_PORTS[protocol.value]
  }
  rootRef.value?.showModal()
  await nextTick()
  firstInputRef.value?.focus()
})

onBeforeUnmount(() => {
  secrets.password = ''
  secrets.token = ''
  secrets.secretAccessKey = ''
  secrets.sessionToken = ''
  if (previousFocus?.isConnected) previousFocus.focus()
})

function buildFileInput(forSave: boolean): FileProfileInput {
  const proto = protocol.value as FileProtocol
  const cleanName =
    name.value.trim() ||
    (forSave
      ? ''
      : proto === 's3'
        ? s3Bucket.value.trim() || 'S3'
        : proto === 'webdav'
          ? webdavUrl.value.trim() || 'WebDAV'
          : host.value.trim() || proto.toUpperCase())
  const options: FileProfileInput['options'] = {}
  if (proto === 'ftps') {
    options.tlsMode = ftpsMode.value
    options.tlsVerify = tlsVerify.value
  } else if (proto === 'webdav') {
    options.url = webdavUrl.value.trim()
    options.webdavAuth = webdavAuth.value
    options.tlsVerify = tlsVerify.value
  } else if (proto === 's3') {
    if (s3Endpoint.value.trim()) options.endpoint = s3Endpoint.value.trim()
    if (s3Region.value.trim()) options.region = s3Region.value.trim()
    options.bucket = s3Bucket.value.trim()
    options.forcePathStyle = s3ForcePathStyle.value
    options.tlsVerify = tlsVerify.value
  }

  const secretPayload: FileProfileInput['secrets'] = {}
  if (proto === 's3') {
    if (secrets.secretAccessKey) secretPayload.secretAccessKey = secrets.secretAccessKey
    if (secrets.sessionToken) secretPayload.sessionToken = secrets.sessionToken
  } else if (proto === 'webdav' && webdavAuth.value === 'token') {
    if (secrets.token) secretPayload.token = secrets.token
  } else if (secrets.password) {
    secretPayload.password = secrets.password
  }

  const hasSecretValues = Object.keys(secretPayload).length > 0
  return {
    ...(props.profile?.id ? { id: props.profile.id } : {}),
    name: cleanName,
    protocol: proto,
    host: host.value.trim(),
    port: Number.isFinite(port.value) ? Math.max(0, Math.trunc(port.value)) : 0,
    username: username.value.trim(),
    initialPath: initialPath.value.trim(),
    notes: notes.value,
    favorite: favorite.value,
    options,
    ...(hasSecretValues ? { secrets: secretPayload } : {}),
    saveSecrets: forSave && saveSecrets.value && hasSecretValues,
    clearSecrets: forSave && clearSecrets.value
  }
}

function submitFile(mode: 'save' | 'save-connect' | 'adhoc') {
  errors.value = {}
  if (protocol.value === 'smb') {
    errors.value.protocol = t('fileEditor.smbDisabledHint')
    return
  }

  if (protocol.value === 'sftp') {
    if (sshAuth.value === 'password' && secrets.password && saveSecrets.value && !props.encryptionAvailable) {
      errors.value.secrets = isLinux.value ? t('hostEditor.cannotSaveLinux') : t('hostEditor.cannotSaveWin')
      return
    }
    const candidate: HostInput = {
      name: name.value.trim(),
      address: host.value.trim(),
      port:
        Number.isFinite(port.value) && port.value > 0
          ? Math.trunc(port.value)
          : protocolSettings.value.ssh.defaultPort,
      username: username.value.trim(),
      auth: sshAuth.value,
      keepalive: Number.isFinite(sshKeepalive.value)
        ? sshKeepalive.value
        : protocolSettings.value.ssh.defaultKeepaliveSec,
      group: '',
      notes: notes.value,
      favorite: favorite.value,
      ...(secrets.password ? { password: secrets.password } : {}),
      savePassword: saveSecrets.value && Boolean(secrets.password),
      clearPassword: false
    }
    const res = hostInputSchema.safeParse(candidate)
    if (!res.success) {
      for (const issue of res.error.issues) {
        const key = issue.path[0] ? String(issue.path[0]) : '_root'
        const mapped = key === 'address' ? 'host' : key
        if (!errors.value[mapped]) errors.value[mapped] = issue.message
      }
      return
    }
    emit('saveSshAndConnect', res.data)
    return
  }

  const raw = buildFileInput(mode !== 'adhoc')
  if (mode !== 'adhoc' && saveSecrets.value && raw.secrets && !props.encryptionAvailable) {
    errors.value.secrets = isLinux.value ? t('hostEditor.cannotSaveLinux') : t('hostEditor.cannotSaveWin')
    return
  }
  const res = fileProfileInputSchema.safeParse(raw)
  if (!res.success) {
    for (const issue of res.error.issues) {
      const key = issue.path.join('.') || '_root'
      if (!errors.value[key]) errors.value[key] = issue.message
    }
    return
  }
  if (mode === 'adhoc') {
    emit('connectAdhoc', { kind: 'adhoc', profile: raw })
  } else {
    emit('saveProfile', raw, mode === 'save-connect')
  }
}
</script>

<template>
  <dialog
    ref="rootRef"
    class="container_files_editor_dialog_base"
    data-testid="file-profile-editor"
    :aria-labelledby="titleId"
    @cancel.prevent="emit('close')"
  >
    <form
      class="container_files_editor_form_base"
      novalidate
      @submit.prevent="submitFile(isQuick ? 'adhoc' : 'save-connect')"
    >
      <header class="container_files_editor_header_base">
        <div class="container_files_editor_header_titlewrap">
          <HardDrive :size="16" />
          <h3 :id="titleId" class="container_files_editor_header_title">
            {{
              isEdit
                ? t('fileEditor.titleEdit')
                : isQuick
                  ? t('fileEditor.titleQuick')
                  : t('fileEditor.titleAdd')
            }}
          </h3>
        </div>
        <button
          class="container_files_editor_header_close"
          type="button"
          :aria-label="t('hostEditor.closeAria')"
          @click="emit('close')"
        >
          <X :size="16" />
        </button>
      </header>

      <div class="container_files_editor_body_base">
        <label class="container_files_editor_field_protocol">
          <span class="container_files_editor_label_protocol">{{ t('fileEditor.protocol') }}</span>
          <OrbitSelect
            :model-value="protocol"
            :options="protocolOptions"
            :aria-label="t('fileEditor.protocol')"
            width="100%"
            instance="file-editor-protocol"
            :disabled="isEdit"
            @update:model-value="protocol = $event as EditorProtocol"
          />
          <span v-if="errors.protocol" class="container_files_editor_err_protocol">
            {{ errors.protocol }}
          </span>
        </label>

        <p v-if="protocol === 'sftp'" class="container_files_editor_hint_sftp">
          {{ t('fileEditor.sftpRedirectHint') }}
        </p>

        <div v-if="protocol === 'smb'" class="container_files_editor_hint_smb">
          {{ t('fileEditor.smbDisabledHint') }}
        </div>

        <template v-else>
          <label class="container_files_editor_field_name">
            <span class="container_files_editor_label_name">{{ t('fileEditor.name') }}</span>
            <input
              ref="firstInputRef"
              v-model="name"
              class="container_files_editor_input_name"
              type="text"
              :placeholder="t('fileEditor.namePlaceholder')"
              :aria-invalid="Boolean(errors.name)"
            />
            <span v-if="errors.name" class="container_files_editor_err_name">{{ errors.name }}</span>
          </label>

          <!-- FTP / FTPS / SFTP host + port -->
          <div
            v-if="protocol === 'ftp' || protocol === 'ftps' || protocol === 'sftp'"
            class="container_files_editor_row_host"
          >
            <label class="container_files_editor_field_host">
              <span class="container_files_editor_label_host">{{ t('fileEditor.host') }}</span>
              <input
                v-model="host"
                class="container_files_editor_input_host"
                type="text"
                :placeholder="t('fileEditor.hostPlaceholder')"
                :aria-invalid="Boolean(errors.host)"
              />
              <span v-if="errors.host" class="container_files_editor_err_host">{{ errors.host }}</span>
            </label>
            <label class="container_files_editor_field_port">
              <span class="container_files_editor_label_port">{{ t('fileEditor.port') }}</span>
              <input
                v-model.number="port"
                class="container_files_editor_input_port"
                type="number"
                min="0"
                max="65535"
                :aria-invalid="Boolean(errors.port)"
              />
              <span v-if="errors.port" class="container_files_editor_err_port">{{ errors.port }}</span>
            </label>
          </div>

          <!-- FTPS mode -->
          <label v-if="protocol === 'ftps'" class="container_files_editor_field_ftps">
            <span class="container_files_editor_label_ftps">{{ t('fileEditor.ftpsMode') }}</span>
            <OrbitSelect
              :model-value="ftpsMode"
              :options="ftpsModeOptions"
              :aria-label="t('fileEditor.ftpsMode')"
              width="100%"
              instance="file-editor-ftps"
              @update:model-value="ftpsMode = $event as 'explicit' | 'implicit'"
            />
          </label>

          <!-- WebDAV URL + Auth -->
          <template v-if="protocol === 'webdav'">
            <label class="container_files_editor_field_davurl">
              <span class="container_files_editor_label_davurl">{{ t('fileEditor.webdavUrl') }}</span>
              <input
                v-model="webdavUrl"
                class="container_files_editor_input_davurl"
                type="url"
                :placeholder="t('fileEditor.webdavUrlPlaceholder')"
                :aria-invalid="Boolean(errors['options.url'])"
              />
              <span v-if="errors['options.url']" class="container_files_editor_err_davurl">
                {{ errors['options.url'] }}
              </span>
            </label>
            <label class="container_files_editor_field_davauth">
              <span class="container_files_editor_label_davauth">{{ t('fileEditor.webdavAuth') }}</span>
              <OrbitSelect
                :model-value="webdavAuth"
                :options="webdavAuthOptions"
                :aria-label="t('fileEditor.webdavAuth')"
                width="100%"
                instance="file-editor-davauth"
                @update:model-value="webdavAuth = $event as 'basic' | 'digest' | 'token'"
              />
            </label>
          </template>

          <!-- S3 Endpoint + Region + Bucket + PathStyle -->
          <template v-if="protocol === 's3'">
            <label class="container_files_editor_field_s3ep">
              <span class="container_files_editor_label_s3ep">{{ t('fileEditor.s3Endpoint') }}</span>
              <input
                v-model="s3Endpoint"
                class="container_files_editor_input_s3ep"
                type="url"
                :placeholder="t('fileEditor.s3EndpointPlaceholder')"
                :aria-invalid="Boolean(errors['options.endpoint'])"
              />
              <span v-if="errors['options.endpoint']" class="container_files_editor_err_s3ep">
                {{ errors['options.endpoint'] }}
              </span>
            </label>
            <div class="container_files_editor_row_s3meta">
              <label class="container_files_editor_field_s3region">
                <span class="container_files_editor_label_s3region">{{ t('fileEditor.s3Region') }}</span>
                <input
                  v-model="s3Region"
                  class="container_files_editor_input_s3region"
                  type="text"
                  :aria-invalid="Boolean(errors['options.region'])"
                />
                <span v-if="errors['options.region']" class="container_files_editor_err_s3region">
                  {{ errors['options.region'] }}
                </span>
              </label>
              <label class="container_files_editor_field_s3bucket">
                <span class="container_files_editor_label_s3bucket">{{ t('fileEditor.s3Bucket') }}</span>
                <input
                  v-model="s3Bucket"
                  class="container_files_editor_input_s3bucket"
                  type="text"
                  :aria-invalid="Boolean(errors['options.bucket'])"
                />
                <span v-if="errors['options.bucket']" class="container_files_editor_err_s3bucket">
                  {{ errors['options.bucket'] }}
                </span>
              </label>
            </div>
            <label class="container_files_editor_check_pathstyle">
              <input
                v-model="s3ForcePathStyle"
                class="container_files_editor_input_pathstyle"
                type="checkbox"
              />
              {{ t('fileEditor.s3PathStyle') }}
            </label>
          </template>

          <!-- SSH auth selector when SFTP -->
          <div v-if="protocol === 'sftp'" class="container_files_editor_row_sshauth">
            <label class="container_files_editor_field_sshauth">
              <span class="container_files_editor_label_sshauth">{{ t('hostEditor.auth') }}</span>
              <OrbitSelect
                :model-value="sshAuth"
                :options="sshAuthOptions"
                :aria-label="t('hostEditor.auth')"
                width="100%"
                instance="file-editor-sshauth"
                @update:model-value="sshAuth = $event as 'password' | 'agent'"
              />
            </label>
            <label class="container_files_editor_field_keepalive">
              <span class="container_files_editor_label_keepalive">{{ t('hostEditor.keepalive') }}</span>
              <input
                v-model.number="sshKeepalive"
                class="container_files_editor_input_keepalive"
                type="number"
                min="0"
                max="3600"
              />
            </label>
          </div>

          <!-- Username / Access Key -->
          <label
            v-if="!(protocol === 'webdav' && webdavAuth === 'token')"
            class="container_files_editor_field_user"
          >
            <span class="container_files_editor_label_user">
              {{ protocol === 's3' ? t('fileEditor.accessKeyId') : t('fileEditor.username') }}
            </span>
            <input
              v-model="username"
              class="container_files_editor_input_user"
              type="text"
              :aria-invalid="Boolean(errors.username)"
            />
            <span v-if="errors.username" class="container_files_editor_err_user">{{ errors.username }}</span>
          </label>

          <!-- Secrets per protocol -->
          <template v-if="protocol === 's3'">
            <label class="container_files_editor_field_s3secret">
              <span class="container_files_editor_label_s3secret">{{ t('fileEditor.secretAccessKey') }}</span>
              <input
                v-model="secrets.secretAccessKey"
                class="container_files_editor_input_s3secret"
                type="password"
                autocomplete="new-password"
              />
            </label>
            <label class="container_files_editor_field_s3session">
              <span class="container_files_editor_label_s3session">{{ t('fileEditor.sessionToken') }}</span>
              <input
                v-model="secrets.sessionToken"
                class="container_files_editor_input_s3session"
                type="password"
                autocomplete="off"
              />
            </label>
          </template>
          <label
            v-else-if="protocol === 'webdav' && webdavAuth === 'token'"
            class="container_files_editor_field_token"
          >
            <span class="container_files_editor_label_token">{{ t('fileEditor.bearerToken') }}</span>
            <input
              v-model="secrets.token"
              class="container_files_editor_input_token"
              type="password"
              autocomplete="new-password"
            />
          </label>
          <label
            v-else-if="!(protocol === 'sftp' && sshAuth === 'agent')"
            class="container_files_editor_field_password"
          >
            <span class="container_files_editor_label_password">{{ t('fileEditor.password') }}</span>
            <input
              v-model="secrets.password"
              class="container_files_editor_input_password"
              type="password"
              autocomplete="new-password"
            />
          </label>

          <span v-if="errors.secrets" class="container_files_editor_err_secrets">{{ errors.secrets }}</span>

          <label v-if="protocol !== 'sftp'" class="container_files_editor_field_initpath">
            <span class="container_files_editor_label_initpath">{{ t('fileEditor.initialPath') }}</span>
            <input
              v-model="initialPath"
              class="container_files_editor_input_initpath"
              type="text"
              :placeholder="t('fileEditor.initialPathPlaceholder')"
            />
          </label>

          <template v-if="showTlsOptions">
            <label class="container_files_editor_field_tlsverify">
              <span class="container_files_editor_label_tlsverify">{{ t('fileEditor.tlsVerify') }}</span>
              <OrbitSelect
                :model-value="tlsVerify"
                :options="tlsVerifyOptions"
                :aria-label="t('fileEditor.tlsVerify')"
                width="100%"
                instance="file-editor-tls"
                @update:model-value="tlsVerify = $event as 'strict' | 'insecure'"
              />
            </label>
            <p v-if="tlsVerify === 'insecure'" class="container_files_editor_warn_tls">
              <AlertTriangle :size="14" />
              {{ t('fileEditor.tlsInsecureWarn') }}
            </p>
          </template>

          <label
            v-if="!(protocol === 'sftp' && sshAuth === 'agent')"
            class="container_files_editor_check_savepw"
          >
            <input
              v-model="saveSecrets"
              class="container_files_editor_input_savepw"
              type="checkbox"
              :disabled="!encryptionAvailable"
            />
            <ShieldCheck :size="14" />
            {{ t('fileEditor.saveSecrets', { backend: backendLabel }) }}
          </label>

          <label v-if="isEdit && profile?.hasSecrets" class="container_files_editor_check_clearpw">
            <input v-model="clearSecrets" class="container_files_editor_input_clearpw" type="checkbox" />
            {{ t('fileEditor.clearSecrets') }}
          </label>

          <label class="container_files_editor_check_fav">
            <input v-model="favorite" class="container_files_editor_input_fav" type="checkbox" />
            {{ t('fileEditor.favorite') }}
          </label>
        </template>

        <p v-if="error" class="container_files_editor_err_submit" role="alert">{{ error }}</p>
      </div>

      <footer class="container_files_editor_footer_base">
        <button class="container_files_editor_btn_cancel" type="button" @click="emit('close')">
          {{ t('actionDialog.cancel') }}
        </button>
        <template v-if="protocol === 'smb'" />
        <button
          v-else-if="protocol === 'sftp'"
          class="container_files_editor_btn_sftpgo"
          type="button"
          data-primary="true"
          :disabled="busy"
          @click="submitFile('save-connect')"
        >
          {{ t('fileEditor.saveSshAndConnect') }}
        </button>
        <template v-else>
          <button
            v-if="isQuick"
            class="container_files_editor_btn_adhoc"
            type="button"
            data-primary="true"
            :disabled="busy"
            @click="submitFile('adhoc')"
          >
            {{ t('fileEditor.connectOnly') }}
          </button>
          <button
            class="container_files_editor_btn_saveonly"
            type="button"
            :data-primary="isEdit ? 'true' : undefined"
            :disabled="busy"
            @click="submitFile('save')"
          >
            {{ t('fileEditor.saveOnly') }}
          </button>
          <button
            v-if="!isQuick"
            class="container_files_editor_btn_savego"
            type="submit"
            data-primary="true"
            :disabled="busy"
          >
            {{ t('fileEditor.saveAndConnect') }}
          </button>
        </template>
      </footer>
    </form>
  </dialog>
</template>

<style scoped lang="scss">
.container_files_editor_dialog_base {
  margin: auto;
  width: min(560px, 94vw);
  max-height: 90vh;
  padding: 0;
  border: 1px solid var(--color-border-control);
  border-radius: 14px;
  background: var(--color-surface-1);
  color: var(--color-text-primary);
  box-shadow: var(--shadow-dialog);
  overflow: hidden;
  &::backdrop {
    background: rgba(5, 7, 11, 0.72);
    backdrop-filter: blur(5px);
  }
}
.container_files_editor_form_base {
  display: flex;
  flex-direction: column;
  max-height: 90vh;
}
.container_files_editor_header_base {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--color-border);
}
.container_files_editor_header_titlewrap {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--color-accent-primary);
}
.container_files_editor_header_title {
  margin: 0;
  font-size: var(--font-size-ui-lg);
}
.container_files_editor_header_close {
  padding: 4px;
  min-height: 28px;
}
.container_files_editor_body_base {
  padding: 16px 18px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.container_files_editor_row_host,
.container_files_editor_row_s3meta,
.container_files_editor_row_sshauth {
  display: grid;
  grid-template-columns: 1fr 140px;
  gap: 10px;
}
.container_files_editor_row_s3meta,
.container_files_editor_row_sshauth {
  grid-template-columns: 1fr 1fr;
}
.container_files_editor_field_protocol,
.container_files_editor_field_name,
.container_files_editor_field_host,
.container_files_editor_field_port,
.container_files_editor_field_ftps,
.container_files_editor_field_davurl,
.container_files_editor_field_davauth,
.container_files_editor_field_s3ep,
.container_files_editor_field_s3region,
.container_files_editor_field_s3bucket,
.container_files_editor_field_sshauth,
.container_files_editor_field_keepalive,
.container_files_editor_field_user,
.container_files_editor_field_s3secret,
.container_files_editor_field_s3session,
.container_files_editor_field_token,
.container_files_editor_field_password,
.container_files_editor_field_initpath,
.container_files_editor_field_tlsverify {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: var(--font-size-ui-sm);
}
.container_files_editor_hint_sftp {
  margin: 0;
  padding: 8px 11px;
  border-radius: 8px;
  background: var(--color-accent-primary-soft);
  border: 1px solid var(--color-accent-primary-ring);
  font-size: var(--font-size-ui-xs);
  color: var(--color-text-secondary);
}
.container_files_editor_hint_smb,
.container_files_editor_warn_tls {
  margin: 0;
  padding: 9px 12px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.45);
  color: #fca5a5;
  font-size: var(--font-size-ui-xs);
}
.container_files_editor_check_pathstyle,
.container_files_editor_check_savepw,
.container_files_editor_check_clearpw,
.container_files_editor_check_fav {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--font-size-ui-sm);
  color: var(--color-text-secondary);
}
.container_files_editor_err_protocol,
.container_files_editor_err_name,
.container_files_editor_err_host,
.container_files_editor_err_port,
.container_files_editor_err_davurl,
.container_files_editor_err_s3ep,
.container_files_editor_err_s3region,
.container_files_editor_err_s3bucket,
.container_files_editor_err_user,
.container_files_editor_err_secrets,
.container_files_editor_err_submit {
  margin: 0;
  color: var(--color-error);
  font-size: var(--font-size-ui-xs);
}
.container_files_editor_footer_base {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--color-border);
  background: var(--color-surface-2);
}
</style>
