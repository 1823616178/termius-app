<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { X, Star } from '@lucide/vue'
import type { EncryptionBackend, Host } from '../../../shared/contracts'
import type {
  RdpCertPolicy,
  RdpColorDepth,
  RdpProfile,
  RdpProfileInput,
  RdpProfileLaunchOverride,
  RdpQualityPreset,
  RdpResolutionMode,
  RdpSecurityLayer
} from '../../../shared/rdp'
import { RDP_DEFAULT_PORT } from '../../../shared/rdp'
import { t } from '../services/i18n'
import { protocolSettings } from '../stores/workbench'

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
      resolutionMode: RdpResolutionMode
      width: number
      height: number
      colorDepth: RdpColorDepth
      qualityPreset: RdpQualityPreset
      securityLayer: RdpSecurityLayer
      certPolicy: RdpCertPolicy
      enableClipboard: boolean
      enableAudio: boolean
    }
  ]
}>()

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
  resolutionMode: 'fit' as RdpResolutionMode,
  width: 1280,
  height: 800,
  colorDepth: 32 as RdpColorDepth,
  qualityPreset: 'balanced' as RdpQualityPreset,
  securityLayer: 'negotiate' as RdpSecurityLayer,
  certPolicy: 'tofu' as RdpCertPolicy,
  enableClipboard: true,
  enableAudio: false
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
      form.resolutionMode = profile.options.resolutionMode ?? defaults.resolutionMode
      form.width = profile.options.width ?? defaults.defaultWidth
      form.height = profile.options.height ?? defaults.defaultHeight
      form.colorDepth = profile.options.colorDepth ?? defaults.colorDepth
      form.qualityPreset = profile.options.qualityPreset ?? defaults.qualityPreset
      form.securityLayer = profile.options.securityLayer ?? defaults.securityLayer
      form.certPolicy = profile.options.certPolicy ?? defaults.certPolicy
      form.enableClipboard = profile.options.enableClipboard ?? defaults.enableClipboard
      form.enableAudio = profile.options.enableAudio ?? defaults.enableAudio
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
    form.resolutionMode = defaults.resolutionMode
    form.width = defaults.defaultWidth
    form.height = defaults.defaultHeight
    form.colorDepth = defaults.colorDepth
    form.qualityPreset = defaults.qualityPreset
    form.securityLayer = defaults.securityLayer
    form.certPolicy = defaults.certPolicy
    form.enableClipboard = defaults.enableClipboard
    form.enableAudio = defaults.enableAudio
  },
  { immediate: true }
)

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
    resolutionMode: form.resolutionMode,
    width: Math.min(7680, Math.max(640, Number(form.width) || 1280)),
    height: Math.min(4320, Math.max(480, Number(form.height) || 800)),
    colorDepth: form.colorDepth,
    qualityPreset: form.qualityPreset,
    securityLayer: form.securityLayer,
    certPolicy: form.certPolicy,
    enableClipboard: form.enableClipboard,
    enableAudio: form.enableAudio
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
      options: {
        launchMode: form.launchMode,
        resolutionMode: form.resolutionMode,
        width: Math.min(7680, Math.max(640, Number(form.width) || 1280)),
        height: Math.min(4320, Math.max(480, Number(form.height) || 800)),
        colorDepth: form.colorDepth,
        qualityPreset: form.qualityPreset,
        securityLayer: form.securityLayer,
        certPolicy: form.certPolicy,
        enableClipboard: form.enableClipboard,
        enableAudio: form.enableAudio
      }
    },
    connectAfter
  )
}
</script>

<template>
  <div class="container_rdp-editor_overlay_backdrop_base" @click.self="emit('close')">
    <div
      class="container_rdp-editor_modal_panel_base"
      role="dialog"
      aria-modal="true"
      data-testid="rdp-profile-editor"
    >
      <div class="container_rdp-editor_header_row_base">
        <h3 class="container_rdp-editor_header_title_text">{{ dialogTitle }}</h3>
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
            />
          </label>
        </div>

        <div class="container_rdp-editor_overrides_grid_row">
          <label class="container_rdp-editor_override_launch_label">
            {{ t('rdpEditor.launchMode') }}
            <select
              v-model="form.launchMode"
              class="container_rdp-editor_override_launch_select"
              data-testid="rdp-editor-launch-mode"
            >
              <option class="container_rdp-editor_override_launch_optinh" value="inherit">
                {{ t('rdpEditor.launchInherit', { mode: globalModeLabel }) }}
              </option>
              <option class="container_rdp-editor_override_launch_optext" value="external">
                {{ t('rdpEditor.launchExternal') }}
              </option>
              <option class="container_rdp-editor_override_launch_optemb" value="embedded">
                {{ t('rdpEditor.launchEmbedded') }}
              </option>
            </select>
          </label>
          <label class="container_rdp-editor_override_sec_label">
            {{ t('rdpEditor.securityLayer') }}
            <select v-model="form.securityLayer" class="container_rdp-editor_override_sec_select">
              <option class="container_rdp-editor_override_sec_optneg" value="negotiate">
                {{ t('settings.rdpSecNegotiate') }}
              </option>
              <option class="container_rdp-editor_override_sec_optnla" value="nla">
                {{ t('settings.rdpSecNla') }}
              </option>
              <option class="container_rdp-editor_override_sec_opttls" value="tls">
                {{ t('settings.rdpSecTls') }}
              </option>
            </select>
          </label>
          <label class="container_rdp-editor_override_cert_label">
            {{ t('rdpEditor.certPolicy') }}
            <select
              v-model="form.certPolicy"
              class="container_rdp-editor_override_cert_select"
              data-testid="rdp-editor-cert-policy"
            >
              <option class="container_rdp-editor_override_cert_opttofu" value="tofu">
                {{ t('settings.rdpCertTofu') }}
              </option>
              <option class="container_rdp-editor_override_cert_optstrict" value="strict">
                {{ t('settings.rdpCertStrict') }}
              </option>
              <option class="container_rdp-editor_override_cert_optwarn" value="warn-allow">
                {{ t('settings.rdpCertWarnAllow') }}
              </option>
            </select>
          </label>
          <label class="container_rdp-editor_override_res_label">
            {{ t('rdpEditor.resolutionMode') }}
            <select v-model="form.resolutionMode" class="container_rdp-editor_override_res_select">
              <option class="container_rdp-editor_override_res_optfit" value="fit">
                {{ t('settings.rdpResolutionFit') }}
              </option>
              <option class="container_rdp-editor_override_res_optfix" value="fixed">
                {{ t('settings.rdpResolutionFixed') }}
              </option>
            </select>
          </label>
          <label class="container_rdp-editor_override_w_label">
            {{ t('rdpEditor.width') }}
            <input
              v-model.number="form.width"
              class="container_rdp-editor_override_w_input"
              type="number"
              min="640"
              max="7680"
            />
          </label>
          <label class="container_rdp-editor_override_h_label">
            {{ t('rdpEditor.height') }}
            <input
              v-model.number="form.height"
              class="container_rdp-editor_override_h_input"
              type="number"
              min="480"
              max="4320"
            />
          </label>
        </div>

        <div class="container_rdp-editor_checks_row_base">
          <label class="container_rdp-editor_check_clip_label">
            <input
              v-model="form.enableClipboard"
              class="container_rdp-editor_check_clip_input"
              type="checkbox"
            />
            {{ t('rdpEditor.clipboard') }}
          </label>
          <label class="container_rdp-editor_check_audio_label">
            <input
              v-model="form.enableAudio"
              class="container_rdp-editor_check_audio_input"
              type="checkbox"
            />
            {{ t('rdpEditor.audio') }}
          </label>
          <label v-if="mode !== 'quick'" class="container_rdp-editor_check_fav_label">
            <input v-model="form.favorite" class="container_rdp-editor_check_fav_input" type="checkbox" />
            <Star :size="13" />
            {{ t('rdpEditor.favorite') }}
          </label>
        </div>

        <div v-if="mode !== 'quick'" class="container_rdp-editor_secret_box_base">
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
              @change="form.clearPassword && (form.password = '')"
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
    </div>
  </div>
</template>

<style scoped lang="scss">
.container_rdp-editor_overlay_backdrop_base {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: grid;
  place-items: center;
  background: rgba(6, 9, 14, 0.72);
  backdrop-filter: blur(6px);
}
.container_rdp-editor_modal_panel_base {
  width: min(680px, 94vw);
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  border: 1px solid var(--color-border-strong);
  background: var(--color-surface-card);
  box-shadow: var(--shadow-3d-lg);
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
.container_rdp-editor_action_quick_btn,
.container_rdp-editor_action_save_btn,
.container_rdp-editor_action_connect_btn {
  padding: 8px 14px;
  border-radius: 8px;
  font-size: var(--font-size-ui-sm);
}
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
