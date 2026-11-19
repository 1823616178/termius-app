<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, useId, watch } from 'vue'
import { X, Star } from '@lucide/vue'
import type { EncryptionBackend, Host } from '../../../shared/contracts'
import type {
  RdpCertPolicy,
  RdpColorDepth,
  RdpDriveRedirectMode,
  RdpProfile,
  RdpProfileInput,
  RdpProfileLaunchOverride,
  RdpProfileOptions,
  RdpQualityPreset,
  RdpResolutionMode,
  RdpSecurityLayer
} from '../../../shared/rdp'
import { RDP_DEFAULT_PORT } from '../../../shared/rdp'
import { locale, t } from '../services/i18n'
import { protocolSettings } from '../stores/workbench'
import OrbitSelect from './OrbitSelect.vue'

const props = defineProps<{
  mode: 'add' | 'edit' | 'quick'
  profile?: RdpProfile
  prefillFromHost?: Host
  encryptionAvailable: boolean
  encryptionBackend: EncryptionBackend
  busy: boolean
  error: string
}>()

const emit = defineEmits<{
  close: []
  save: [input: RdpProfileInput, connectAfter: boolean]
  connectQuick: [
    payload: {
      name: string
      host: string
      port: number
      domain: string
      username: string
      password: string
      launchMode?: 'external' | 'embedded'
      options: RdpProfileOptions
    }
  ]
}>()

const titleId = useId()
const dialogRef = ref<HTMLDialogElement>()
const nameInputRef = ref<HTMLInputElement>()
const previousFocus = document.activeElement as HTMLElement | null

const form = reactive({
  id: '' as string | undefined,
  name: '',
  host: '',
  port: RDP_DEFAULT_PORT,
  domain: '',
  username: '',
  password: '',
  savePassword: false,
  clearPassword: false,
  linkedHostId: undefined as string | undefined,
  favorite: false,
  notes: '',
  launchMode: 'inherit' as RdpProfileLaunchOverride,
  resolutionMode: 'inherit' as 'inherit' | RdpResolutionMode,
  width: 1280,
  height: 800,
  colorDepth: 'inherit' as 'inherit' | '16' | '24' | '32',
  qualityPreset: 'inherit' as 'inherit' | RdpQualityPreset,
  securityLayer: 'inherit' as 'inherit' | RdpSecurityLayer,
  certPolicy: 'inherit' as 'inherit' | RdpCertPolicy,
  driveRedirect: 'inherit' as 'inherit' | RdpDriveRedirectMode,
  sharedDrivePath: '',
  enableClipboard: true,
  enableAudio: false,
  clipboardOverridden: false,
  audioOverridden: false
})

const validationError = ref('')

watch(
  () => [props.mode, props.profile, props.prefillFromHost] as const,
  ([mode, profile, sshHost]) => {
    validationError.value = ''
    const defaults = protocolSettings.value.rdp
    if (mode === 'edit' && profile) {
      form.id = profile.id
      form.name = profile.name
      form.host = profile.host
      form.port = profile.port
      form.domain = profile.domain
      form.username = profile.username
      form.password = ''
      form.savePassword = profile.hasPassword
      form.clearPassword = false
      form.linkedHostId = profile.linkedHostId
      form.favorite = profile.favorite
      form.notes = profile.notes
      form.launchMode = profile.options.launchMode ?? 'inherit'
      form.resolutionMode = profile.options.resolutionMode ?? 'inherit'
      form.width = profile.options.width ?? defaults.defaultWidth
      form.height = profile.options.height ?? defaults.defaultHeight
      form.colorDepth = profile.options.colorDepth
        ? (String(profile.options.colorDepth) as '16' | '24' | '32')
        : 'inherit'
      form.qualityPreset = profile.options.qualityPreset ?? 'inherit'
      form.securityLayer = profile.options.securityLayer ?? 'inherit'
      form.certPolicy = profile.options.certPolicy ?? 'inherit'
      form.driveRedirect = profile.options.driveRedirect ?? 'inherit'
      form.sharedDrivePath = profile.options.sharedDrivePath ?? defaults.sharedDrivePath
      form.enableClipboard = profile.options.enableClipboard ?? defaults.enableClipboard
      form.enableAudio = profile.options.enableAudio ?? defaults.enableAudio
      form.clipboardOverridden = profile.options.enableClipboard !== undefined
      form.audioOverridden = profile.options.enableAudio !== undefined
      return
    }
    form.id = undefined
    form.name = sshHost ? `${sshHost.name} (RDP)` : ''
    form.host = sshHost?.address ?? ''
    form.port = RDP_DEFAULT_PORT
    form.domain = ''
    form.username = sshHost?.username ?? ''
    form.password = ''
    form.savePassword = false
    form.clearPassword = false
    form.linkedHostId = sshHost?.id
    form.favorite = false
    form.notes = ''
    form.launchMode = 'inherit'
    form.resolutionMode = 'inherit'
    form.width = defaults.defaultWidth
    form.height = defaults.defaultHeight
    form.colorDepth = 'inherit'
    form.qualityPreset = 'inherit'
    form.securityLayer = 'inherit'
    form.certPolicy = 'inherit'
    form.driveRedirect = 'inherit'
    form.sharedDrivePath = defaults.sharedDrivePath
    form.enableClipboard = defaults.enableClipboard
    form.enableAudio = defaults.enableAudio
    form.clipboardOverridden = false
    form.audioOverridden = false
  },
  { immediate: true }
)

onMounted(async () => {
  dialogRef.value?.showModal()
  await nextTick()
  nameInputRef.value?.focus()
})

onBeforeUnmount(() => {
  form.password = ''
  if (previousFocus?.isConnected) previousFocus.focus()
})

const globalModeLabel = computed(() =>
  protocolSettings.value.rdp.preferredMode === 'embedded'
    ? t('remotePage.modeBadgeB')
    : t('remotePage.modeBadgeA')
)

const dialogTitle = computed(() =>
  props.mode === 'edit'
    ? t('rdpEditor.titleEdit')
    : props.mode === 'quick'
      ? t('rdpEditor.titleQuick')
      : t('rdpEditor.titleAdd')
)

const launchModeOptions = computed(() => {
  void locale.value
  return [
    { value: 'inherit', label: t('rdpEditor.launchInherit', { mode: globalModeLabel.value }) },
    { value: 'external', label: t('rdpEditor.launchExternal') },
    { value: 'embedded', label: t('rdpEditor.launchEmbedded') }
  ]
})

const securityOptions = computed(() => {
  void locale.value
  return [
    { value: 'inherit', label: t('rdpEditor.inheritGlobal') },
    { value: 'negotiate', label: t('settings.rdpSecNegotiate') },
    { value: 'nla', label: t('settings.rdpSecNla') },
    { value: 'tls', label: t('settings.rdpSecTls') }
  ]
})

const certPolicyOptions = computed(() => {
  void locale.value
  return [
    { value: 'inherit', label: t('rdpEditor.inheritGlobal') },
    { value: 'tofu', label: t('settings.rdpCertTofu') },
    { value: 'strict', label: t('settings.rdpCertStrict') },
    { value: 'warn-allow', label: t('settings.rdpCertWarnAllow') }
  ]
})

const resolutionOptions = computed(() => {
  void locale.value
  return [
    { value: 'inherit', label: t('rdpEditor.inheritGlobal') },
    { value: 'fit', label: t('settings.rdpResolutionFit') },
    { value: 'fixed', label: t('settings.rdpResolutionFixed') }
  ]
})

const colorDepthOptions = computed(() => {
  void locale.value
  return [
    { value: 'inherit', label: t('rdpEditor.inheritGlobal') },
    { value: '32', label: '32-bit TrueColor' },
    { value: '24', label: '24-bit' },
    { value: '16', label: '16-bit HighColor' }
  ]
})

const qualityOptions = computed(() => {
  void locale.value
  return [
    { value: 'inherit', label: t('rdpEditor.inheritGlobal') },
    { value: 'lan', label: t('settings.rdpQualityLan') },
    { value: 'balanced', label: t('settings.rdpQualityBalanced') },
    { value: 'low', label: t('settings.rdpQualityLow') }
  ]
})

const driveRedirectOptions = computed(() => {
  void locale.value
  return [
    { value: 'inherit', label: t('rdpEditor.inheritGlobal') },
    { value: 'none', label: t('settings.rdpDriveNone') },
    { value: 'readonly', label: t('settings.rdpDriveReadonly') },
    { value: 'readwrite', label: t('settings.rdpDriveReadwrite') }
  ]
})

const effectiveFixedResolution = computed(
  () =>
    form.resolutionMode === 'fixed' ||
    (form.resolutionMode === 'inherit' && protocolSettings.value.rdp.resolutionMode === 'fixed')
)

const effectiveDriveRedirect = computed(() =>
  form.driveRedirect === 'inherit' ? protocolSettings.value.rdp.driveRedirect : form.driveRedirect
)

function buildOptionsPayload(): RdpProfileOptions {
  const defaults = protocolSettings.value.rdp
  const opts: RdpProfileOptions = {}
  if (form.launchMode !== 'inherit') opts.launchMode = form.launchMode
  if (form.resolutionMode !== 'inherit') opts.resolutionMode = form.resolutionMode
  if (
    form.resolutionMode === 'fixed' ||
    Number(form.width) !== defaults.defaultWidth ||
    Number(form.height) !== defaults.defaultHeight
  ) {
    if (effectiveFixedResolution.value) {
      opts.width = Math.min(7680, Math.max(640, Number(form.width) || defaults.defaultWidth))
      opts.height = Math.min(4320, Math.max(480, Number(form.height) || defaults.defaultHeight))
    }
  }
  if (form.colorDepth !== 'inherit') opts.colorDepth = Number(form.colorDepth) as RdpColorDepth
  if (form.qualityPreset !== 'inherit') opts.qualityPreset = form.qualityPreset
  if (form.securityLayer !== 'inherit') opts.securityLayer = form.securityLayer
  if (form.certPolicy !== 'inherit') opts.certPolicy = form.certPolicy
  if (form.driveRedirect !== 'inherit') opts.driveRedirect = form.driveRedirect
  if (effectiveDriveRedirect.value !== 'none' && form.sharedDrivePath.trim()) {
    if (form.driveRedirect !== 'inherit' || form.sharedDrivePath.trim() !== defaults.sharedDrivePath) {
      opts.sharedDrivePath = form.sharedDrivePath.trim()
    }
  }
  if (form.clipboardOverridden || form.enableClipboard !== defaults.enableClipboard) {
    opts.enableClipboard = form.enableClipboard
  }
  if (form.audioOverridden || form.enableAudio !== defaults.enableAudio) {
    opts.enableAudio = form.enableAudio
  }
  return opts
}

function submitQuick(): void {
  validationError.value = ''
  if (!form.host.trim()) {
    validationError.value = t('rdpEditor.hostPlaceholder')
    return
  }
  emit('connectQuick', {
    name: form.name.trim() || `${form.host.trim()}:${form.port}`,
    host: form.host.trim(),
    port: Number(form.port) || RDP_DEFAULT_PORT,
    domain: form.domain.trim(),
    username: form.username.trim(),
    password: form.password,
    launchMode: form.launchMode === 'inherit' ? undefined : form.launchMode,
    options: buildOptionsPayload()
  })
}

function submitSave(connectAfter: boolean): void {
  validationError.value = ''
  if (!form.host.trim()) {
    validationError.value = t('rdpEditor.hostPlaceholder')
    return
  }
  emit(
    'save',
    {
      ...(form.id ? { id: form.id } : {}),
      name: form.name.trim() || `${form.host.trim()}:${form.port}`,
      host: form.host.trim(),
      port: Number(form.port) || RDP_DEFAULT_PORT,
      domain: form.domain.trim(),
      username: form.username.trim(),
      ...(form.password ? { password: form.password } : {}),
      savePassword: form.savePassword,
      clearPassword: form.clearPassword,
      ...(form.linkedHostId ? { linkedHostId: form.linkedHostId } : {}),
      notes: form.notes,
      favorite: form.favorite,
      options: buildOptionsPayload()
    },
    connectAfter
  )
}
</script>

<template>
  <dialog
    ref="dialogRef"
    class="container_rdp-editor_modal_panel_base"
    :aria-labelledby="titleId"
    data-testid="rdp-profile-editor"
    @cancel.prevent="emit('close')"
    @click.self="emit('close')"
  >
    <form
      class="container_rdp-editor_form_root_base"
      novalidate
      @submit.prevent="mode === 'quick' ? submitQuick() : submitSave(true)"
    >
      <div class="container_rdp-editor_header_row_base">
        <h3 :id="titleId" class="container_rdp-editor_header_title_text">{{ dialogTitle }}</h3>
        <button
          class="container_rdp-editor_header_close_btn"
          type="button"
          :aria-label="t('app.closeNotice')"
          @click="emit('close')"
        >
          <X :size="15" />
        </button>
      </div>

      <div class="container_rdp-editor_body_scroll_base">
        <div class="container_rdp-editor_form_grid_row">
          <label class="container_rdp-editor_field_name_label">
            {{ t('rdpEditor.name') }}
            <input
              ref="nameInputRef"
              v-model="form.name"
              class="container_rdp-editor_field_name_input"
              data-testid="rdp-editor-name"
              type="text"
              :placeholder="t('rdpEditor.namePlaceholder')"
            />
          </label>
          <label class="container_rdp-editor_field_host_label">
            {{ t('rdpEditor.host') }}
            <input
              v-model="form.host"
              class="container_rdp-editor_field_host_input"
              data-testid="rdp-editor-host"
              type="text"
              :placeholder="t('rdpEditor.hostPlaceholder')"
            />
          </label>
          <label class="container_rdp-editor_field_port_label">
            {{ t('rdpEditor.port') }}
            <input
              v-model.number="form.port"
              class="container_rdp-editor_field_port_input"
              data-testid="rdp-editor-port"
              type="number"
              min="1"
              max="65535"
            />
          </label>
          <label class="container_rdp-editor_field_domain_label">
            {{ t('rdpEditor.domain') }}
            <input
              v-model="form.domain"
              class="container_rdp-editor_field_domain_input"
              data-testid="rdp-editor-domain"
              type="text"
            />
          </label>
          <label class="container_rdp-editor_field_user_label">
            {{ t('rdpEditor.username') }}
            <input
              v-model="form.username"
              class="container_rdp-editor_field_user_input"
              data-testid="rdp-editor-username"
              type="text"
            />
          </label>
          <label class="container_rdp-editor_field_pass_label">
            {{ t('rdpEditor.password') }}
            <input
              v-model="form.password"
              class="container_rdp-editor_field_pass_input"
              data-testid="rdp-editor-password"
              type="password"
              autocomplete="new-password"
              @input="form.password && (form.clearPassword = false)"
            />
          </label>
        </div>

        <div class="container_rdp-editor_overrides_grid_row">
          <div class="container_rdp-editor_override_launch_label" data-testid="rdp-editor-launch-mode">
            <span class="container_rdp-editor_override_launch_text">{{ t('rdpEditor.launchMode') }}</span>
            <OrbitSelect
              :model-value="form.launchMode"
              :options="launchModeOptions"
              :aria-label="t('rdpEditor.launchMode')"
              width="100%"
              instance="rdp-editor-launch"
              @update:model-value="form.launchMode = $event as RdpProfileLaunchOverride"
            />
          </div>
          <div class="container_rdp-editor_override_sec_label">
            <span class="container_rdp-editor_override_sec_text">{{ t('rdpEditor.securityLayer') }}</span>
            <OrbitSelect
              :model-value="form.securityLayer"
              :options="securityOptions"
              :aria-label="t('rdpEditor.securityLayer')"
              width="100%"
              instance="rdp-editor-sec"
              @update:model-value="form.securityLayer = $event as 'inherit' | RdpSecurityLayer"
            />
          </div>
          <div class="container_rdp-editor_override_cert_label" data-testid="rdp-editor-cert-policy">
            <span class="container_rdp-editor_override_cert_text">{{ t('rdpEditor.certPolicy') }}</span>
            <OrbitSelect
              :model-value="form.certPolicy"
              :options="certPolicyOptions"
              :aria-label="t('rdpEditor.certPolicy')"
              width="100%"
              instance="rdp-editor-cert"
              @update:model-value="form.certPolicy = $event as 'inherit' | RdpCertPolicy"
            />
          </div>
          <div class="container_rdp-editor_override_res_label">
            <span class="container_rdp-editor_override_res_text">{{ t('rdpEditor.resolutionMode') }}</span>
            <OrbitSelect
              :model-value="form.resolutionMode"
              :options="resolutionOptions"
              :aria-label="t('rdpEditor.resolutionMode')"
              width="100%"
              instance="rdp-editor-res"
              @update:model-value="form.resolutionMode = $event as 'inherit' | RdpResolutionMode"
            />
          </div>
          <label class="container_rdp-editor_override_w_label" :title="t('rdpEditor.fixedSizeHint')">
            {{ t('rdpEditor.width') }}
            <input
              v-model.number="form.width"
              class="container_rdp-editor_override_w_input"
              type="number"
              min="640"
              max="7680"
              :disabled="!effectiveFixedResolution"
            />
          </label>
          <label class="container_rdp-editor_override_h_label" :title="t('rdpEditor.fixedSizeHint')">
            {{ t('rdpEditor.height') }}
            <input
              v-model.number="form.height"
              class="container_rdp-editor_override_h_input"
              type="number"
              min="480"
              max="4320"
              :disabled="!effectiveFixedResolution"
            />
          </label>
          <div class="container_rdp-editor_override_bpp_label">
            <span class="container_rdp-editor_override_bpp_text">{{ t('rdpEditor.colorDepth') }}</span>
            <OrbitSelect
              :model-value="form.colorDepth"
              :options="colorDepthOptions"
              :aria-label="t('rdpEditor.colorDepth')"
              width="100%"
              instance="rdp-editor-bpp"
              @update:model-value="form.colorDepth = $event as 'inherit' | '16' | '24' | '32'"
            />
          </div>
          <div class="container_rdp-editor_override_qual_label">
            <span class="container_rdp-editor_override_qual_text">{{ t('rdpEditor.qualityPreset') }}</span>
            <OrbitSelect
              :model-value="form.qualityPreset"
              :options="qualityOptions"
              :aria-label="t('rdpEditor.qualityPreset')"
              width="100%"
              instance="rdp-editor-qual"
              @update:model-value="form.qualityPreset = $event as 'inherit' | RdpQualityPreset"
            />
          </div>
          <div class="container_rdp-editor_override_drv_label">
            <span class="container_rdp-editor_override_drv_text">{{ t('rdpEditor.driveRedirect') }}</span>
            <OrbitSelect
              :model-value="form.driveRedirect"
              :options="driveRedirectOptions"
              :aria-label="t('rdpEditor.driveRedirect')"
              width="100%"
              instance="rdp-editor-drv"
              @update:model-value="form.driveRedirect = $event as 'inherit' | RdpDriveRedirectMode"
            />
          </div>
        </div>

        <label v-if="effectiveDriveRedirect !== 'none'" class="container_rdp-editor_override_share_label">
          {{ t('rdpEditor.sharedDrivePath') }}
          <input
            v-model="form.sharedDrivePath"
            class="container_rdp-editor_override_share_input"
            type="text"
            :placeholder="t('settings.rdpSharedDrivePlaceholder')"
          />
        </label>

        <div class="container_rdp-editor_checks_row_base">
          <label class="container_rdp-editor_check_clip_label">
            <input
              v-model="form.enableClipboard"
              class="container_rdp-editor_check_clip_input"
              type="checkbox"
              @change="form.clipboardOverridden = true"
            />
            {{ t('rdpEditor.clipboard') }}
          </label>
          <label class="container_rdp-editor_check_audio_label">
            <input
              v-model="form.enableAudio"
              class="container_rdp-editor_check_audio_input"
              type="checkbox"
              @change="form.audioOverridden = true"
            />
            {{ t('rdpEditor.audio') }}
          </label>
          <label class="container_rdp-editor_check_fav_label">
            <input v-model="form.favorite" class="container_rdp-editor_check_fav_input" type="checkbox" />
            <Star :size="13" />
            {{ t('rdpEditor.favorite') }}
          </label>
        </div>

        <div class="container_rdp-editor_secret_box_base">
          <label v-if="encryptionAvailable" class="container_rdp-editor_secret_save_label">
            <input
              v-model="form.savePassword"
              class="container_rdp-editor_secret_save_input"
              data-testid="rdp-editor-save-secret"
              type="checkbox"
              :disabled="form.clearPassword"
            />
            {{ t('rdpEditor.savePassword', { backend: encryptionBackend }) }}
          </label>
          <label
            v-if="mode === 'edit' && profile?.hasPassword"
            class="container_rdp-editor_secret_clear_label"
          >
            <input
              v-model="form.clearPassword"
              class="container_rdp-editor_secret_clear_input"
              type="checkbox"
              @change="form.clearPassword && ((form.password = ''), (form.savePassword = false))"
            />
            {{ t('rdpEditor.clearPassword') }}
          </label>
        </div>

        <label v-if="mode !== 'quick'" class="container_rdp-editor_notes_field_label">
          {{ t('rdpEditor.notes') }}
          <textarea v-model="form.notes" class="container_rdp-editor_notes_field_textarea" rows="2" />
        </label>

        <p v-if="validationError || error" class="container_rdp-editor_error_banner_text" role="alert">
          {{ validationError || error }}
        </p>
      </div>

      <div class="container_rdp-editor_footer_actions_row">
        <button class="container_rdp-editor_action_cancel_btn" type="button" @click="emit('close')">
          {{ t('actionDialog.cancel') }}
        </button>
        <button
          v-if="mode === 'quick'"
          class="container_rdp-editor_action_quick_btn"
          type="button"
          data-testid="rdp-editor-connect-only"
          :disabled="busy"
          @click="submitQuick"
        >
          {{ t('rdpEditor.connectOnly') }}
        </button>
        <button
          v-if="mode !== 'quick'"
          class="container_rdp-editor_action_save_btn"
          type="button"
          data-testid="rdp-editor-save-only"
          :disabled="busy"
          @click="submitSave(false)"
        >
          {{ t('rdpEditor.saveOnly') }}
        </button>
        <button
          class="container_rdp-editor_action_connect_btn"
          type="button"
          data-testid="rdp-editor-save-connect"
          :disabled="busy"
          @click="submitSave(true)"
        >
          {{ t('rdpEditor.saveAndConnect') }}
        </button>
      </div>
    </form>
  </dialog>
</template>

<style scoped lang="scss">
.container_rdp-editor_modal_panel_base {
  margin: auto;
  padding: 0;
  width: min(700px, 94vw);
  max-height: 88vh;
  border-radius: 14px;
  border: 1px solid var(--color-border-strong);
  background: var(--color-surface-card);
  color: var(--color-text-primary);
  box-shadow: var(--shadow-3d-lg);
  overflow: hidden;
  &::backdrop {
    background: rgba(6, 9, 14, 0.72);
    backdrop-filter: blur(6px);
  }
}
.container_rdp-editor_form_root_base {
  display: flex;
  flex-direction: column;
  max-height: 88vh;
}
.container_rdp-editor_header_row_base {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border);
}
.container_rdp-editor_header_title_text {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--font-size-ui-lg);
  color: var(--color-text-heading);
}
.container_rdp-editor_header_close_btn {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 1px solid var(--color-border-control);
  background: var(--color-surface-1);
  color: var(--color-text-secondary);
}
.container_rdp-editor_body_scroll_base {
  padding: 18px 20px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.container_rdp-editor_form_grid_row,
.container_rdp-editor_overrides_grid_row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(195px, 1fr));
  gap: 12px;
}
.container_rdp-editor_field_name_label,
.container_rdp-editor_field_host_label,
.container_rdp-editor_field_port_label,
.container_rdp-editor_field_domain_label,
.container_rdp-editor_field_user_label,
.container_rdp-editor_field_pass_label,
.container_rdp-editor_override_launch_label,
.container_rdp-editor_override_sec_label,
.container_rdp-editor_override_cert_label,
.container_rdp-editor_override_res_label,
.container_rdp-editor_override_w_label,
.container_rdp-editor_override_h_label,
.container_rdp-editor_override_bpp_label,
.container_rdp-editor_override_qual_label,
.container_rdp-editor_override_drv_label,
.container_rdp-editor_override_share_label,
.container_rdp-editor_notes_field_label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: var(--font-size-ui-xs);
  color: var(--color-text-secondary);
}
.container_rdp-editor_checks_row_base,
.container_rdp-editor_secret_box_base {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}
.container_rdp-editor_check_clip_label,
.container_rdp-editor_check_audio_label,
.container_rdp-editor_check_fav_label,
.container_rdp-editor_secret_save_label,
.container_rdp-editor_secret_clear_label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-ui-sm);
  color: var(--color-text-secondary);
}
.container_rdp-editor_error_banner_text {
  margin: 0;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(239, 68, 68, 0.14);
  border: 1px solid rgba(239, 68, 68, 0.4);
  color: #fca5a5;
  font-size: var(--font-size-ui-xs);
}
.container_rdp-editor_footer_actions_row {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 20px;
  border-top: 1px solid var(--color-border);
}
.container_rdp-editor_action_cancel_btn,
.container_rdp-editor_action_quick_btn,
.container_rdp-editor_action_save_btn,
.container_rdp-editor_action_connect_btn {
  padding: 8px 14px;
  border-radius: 8px;
  font-size: var(--font-size-ui-sm);
}
.container_rdp-editor_action_cancel_btn,
.container_rdp-editor_action_quick_btn,
.container_rdp-editor_action_save_btn {
  border: 1px solid var(--color-border-control);
  background: var(--color-surface-1);
  color: var(--color-text-primary);
}
.container_rdp-editor_action_connect_btn {
  border: 1px solid var(--color-accent-primary);
  background: var(--color-accent-primary-soft);
  color: var(--color-accent-primary-bright);
  font-weight: 600;
}
</style>
