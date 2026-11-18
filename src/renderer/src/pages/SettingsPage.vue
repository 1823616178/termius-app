<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  ShieldCheck,
  Minimize2,
  RefreshCw,
  Download,
  ExternalLink,
  FolderOpen,
  Rocket,
  Languages
} from '@lucide/vue'
import { instanceClass } from '../../../shared/classes'
import type { AppLocale, CloseButtonAction, TrayVisibilityMode } from '../../../shared/contracts'
import orbitIcon from '../assets/orbit-icon.svg'
import OrbitSelect from '../components/OrbitSelect.vue'
import TypographySettingsSection from '../components/TypographySettingsSection.vue'
import { locale, setLocale, t, translateMotionReason } from '../services/i18n'
import { TERMINAL_THEMES, type CursorShape } from '../services/terminal-themes'
import { DEFAULT_CUSTOM_COLORS, UI_THEME_PRESETS } from '../services/ui-themes'
import {
  bootstrap,
  cancelUpdateDownload,
  checkForUpdates,
  cursorBlink,
  cursorStyle,
  customUiColors,
  downloadAvailableUpdate,
  focusUpdateSectionToken,
  hideWindowToTray,
  highContrast,
  installDownloadedUpdate,
  motionPreference,
  motionStatus,
  openUpdateReleasePage,
  page,
  patchProtocolSettings,
  protocolSettings,
  refreshMotionPreference,
  revealDownloadedUpdate,
  screenReaderDefault,
  setUiTheme,
  terminalTheme,
  terminalGpuEnabled,
  trayState,
  uiTheme,
  updateCustomUiColors,
  updateState,
  updateTrayPreferences,
  updateUpdaterPreferences,
  windowInstance,
  type MotionPreference
} from '../stores/workbench'

const updateSectionRef = ref<HTMLElement>()
type SettingsDomain = 'general' | 'ssh' | 'files'
const activeDomain = ref<SettingsDomain>('general')

const domainTabs = computed<{ id: SettingsDomain; label: string }[]>(() => {
  void locale.value
  return [
    { id: 'general', label: t('settings.domainGeneral') },
    { id: 'ssh', label: t('settings.domainSsh') },
    { id: 'files', label: t('settings.domainFiles') }
  ]
})

const conflictPolicyOptions = computed(() => {
  void locale.value
  return [
    { value: 'ask', label: t('settings.filesConflictAsk') },
    { value: 'overwrite', label: t('settings.filesConflictOverwrite') },
    { value: 'skip', label: t('settings.filesConflictSkip') },
    { value: 'rename', label: t('settings.filesConflictRename') }
  ]
})

function updateSshSetting(patch: { defaultPort?: number; defaultKeepaliveSec?: number }): void {
  void patchProtocolSettings({ namespace: 'ssh', patch }).catch(() => {})
}

function updateFilesSetting(
  patch: Partial<{
    maxConcurrentTransfers: number
    speedLimitKBps: number
    defaultConflict: 'ask' | 'overwrite' | 'skip' | 'rename'
    showHidden: boolean
    confirmDelete: boolean
    connectTimeoutSec: number
    s3PartSizeMiB: number
    s3DefaultPathStyle: boolean
  }>
): void {
  void patchProtocolSettings({ namespace: 'files', patch }).catch(() => {})
}

watch(focusUpdateSectionToken, async () => {
  activeDomain.value = 'general'
  await nextTick()
  updateSectionRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
})

const isEn = computed(() => locale.value === 'en-US')

const languageOptions = computed<{ id: AppLocale; code: string; title: string; desc: string }[]>(() => [
  {
    id: 'zh-CN',
    code: '中文 · ZH-CN',
    title: t('settings.langZhTitle'),
    desc: t('settings.langZhDesc')
  },
  {
    id: 'en-US',
    code: 'ENGLISH · EN-US',
    title: t('settings.langEnTitle'),
    desc: t('settings.langEnDesc')
  }
])

const updateStatusLabel = computed(() => {
  const phase = updateState.value.phase
  if (phase === 'checking') return t('settings.updateChecking')
  if (phase === 'up-to-date') return t('settings.updateUpToDate')
  if (phase === 'available') {
    return t('settings.updateAvailable', { version: updateState.value.latest?.version ?? '' })
  }
  if (phase === 'downloading') return t('settings.updateDownloading')
  if (phase === 'downloaded') return t('settings.updateDownloaded')
  if (phase === 'error') return t('settings.updateError')
  return t('settings.updateIdle')
})

function formatByteSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return t('settings.updateUnknownSize')
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatIsoTime(iso: string | null | undefined): string {
  if (!iso) return t('settings.updateNeverChecked')
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(locale.value, { hour12: false })
}

const updateMetaItems = computed(() => [
  { key: 'current', label: t('settings.updateMetaCurrent'), value: `v${updateState.value.currentVersion}` },
  {
    key: 'repo',
    label: t('settings.updateMetaRepo'),
    value: `${updateState.value.repository.owner}/${updateState.value.repository.repo}`
  },
  {
    key: 'checked',
    label: t('settings.updateMetaChecked'),
    value: formatIsoTime(updateState.value.checkedAt ?? updateState.value.preferences.lastCheckedAt)
  }
])

const c = (base: string, token: string) => instanceClass(base, windowInstance(token))

const cursorStyleOptions = computed(() => {
  void locale.value
  return [
    { value: 'block', label: t('settings.cursorBlock') },
    { value: 'bar', label: t('settings.cursorBar') },
    { value: 'underline', label: t('settings.cursorUnderline') }
  ]
})

const motionTierOptions = computed(() => {
  void locale.value
  return [
    { value: 'auto', label: t('settings.motionAuto') },
    { value: 'full', label: t('settings.motionFull') },
    { value: 'light', label: t('settings.motionLight') },
    { value: 'off', label: t('settings.motionOff') }
  ]
})

const motionStatusText = computed(() => {
  const status = motionStatus.value
  const tierLabel = t(`motion.tier.${status.tier}`)
  const reasonLabel = translateMotionReason(status.reason)
  const measuredFps =
    status.preference === 'auto' && status.fps !== null && !status.reason.includes('fps')
      ? ` · ${status.fps} fps`
      : ''
  return t('motion.statusPrefix', { tier: tierLabel, reason: reasonLabel, fps: measuredFps })
})

const trayVisibilityOptions = computed(() => {
  void locale.value
  return [
    { value: 'when-minimized', label: t('settings.trayVisibilityWhenMin') },
    { value: 'always', label: t('settings.trayVisibilityAlways') }
  ]
})

const closeActionOptions = computed<{ value: CloseButtonAction; label: string; desc: string }[]>(() => {
  void locale.value
  return [
    {
      value: 'quit',
      label: t('settings.trayCloseQuit'),
      desc: t('settings.trayCloseQuitDesc')
    },
    {
      value: 'tray',
      label: t('settings.trayCloseTray'),
      desc: t('settings.trayCloseTrayDesc')
    },
    {
      value: 'minimize',
      label: t('settings.trayCloseMin'),
      desc: t('settings.trayCloseMinDesc')
    }
  ]
})

function patchCustomColor(key: keyof typeof DEFAULT_CUSTOM_COLORS, value: string): void {
  updateCustomUiColors({
    ...customUiColors.value,
    [key]: value
  })
}

function resetCustomUiTheme(): void {
  updateCustomUiColors({ ...DEFAULT_CUSTOM_COLORS })
  setUiTheme('bagua-taiji')
}
</script>

<template>
  <section v-if="page === 'settings'" class="container_settings_page_body_base">
    <span class="container_settings_page_header_eyebrow">{{ t('settings.eyebrow') }}</span>
    <h2 class="container_settings_page_header_title">{{ t('settings.title') }}</h2>

    <div
      class="container_settings_domains_tab_bar"
      role="tablist"
      data-testid="settings-domain-tabs"
      :aria-label="t('settings.domainTabsAria')"
    >
      <button
        v-for="dom in domainTabs"
        :key="dom.id"
        :class="c('container_settings_domains_tab_btn', dom.id)"
        type="button"
        role="tab"
        :aria-selected="activeDomain === dom.id"
        :data-testid="`settings-tab-${dom.id}`"
        @click="activeDomain = dom.id"
      >
        {{ dom.label }}
      </button>
    </div>

    <template v-if="activeDomain === 'general'">
      <section class="container_settings_lang_body_section" data-testid="language-settings-section">
        <div class="container_settings_lang_header_row">
          <Languages :size="16" />
          <h3 class="container_settings_lang_header_title">{{ t('settings.langSectionTitle') }}</h3>
        </div>
        <p class="container_settings_lang_header_desc">{{ t('settings.langSectionDesc') }}</p>
        <div
          class="container_settings_lang_grid_row"
          role="radiogroup"
          :aria-label="t('settings.langSectionTitle')"
        >
          <button
            v-for="opt in languageOptions"
            :key="opt.id"
            :class="c('container_settings_lang_card_base', opt.id.toLowerCase())"
            type="button"
            role="radio"
            :aria-checked="locale === opt.id"
            :data-testid="`lang-card-${opt.id}`"
            @click="setLocale(opt.id)"
          >
            <span :class="c('container_settings_lang_card_code', opt.id.toLowerCase())">{{ opt.code }}</span>
            <strong :class="c('container_settings_lang_card_title', opt.id.toLowerCase())">
              {{ opt.title }}
            </strong>
            <span :class="c('container_settings_lang_card_desc', opt.id.toLowerCase())">{{ opt.desc }}</span>
          </button>
        </div>
      </section>

      <TypographySettingsSection section="panel" />

      <section class="container_settings_uitheme_body_section">
        <h3 class="container_settings_uitheme_header_title">{{ t('settings.uiThemeTitle') }}</h3>
        <p class="container_settings_uitheme_header_desc">
          {{ t('settings.uiThemeDesc') }}
        </p>
        <div class="container_settings_uitheme_grid_base">
          <button
            v-for="preset in UI_THEME_PRESETS"
            :key="preset.id"
            :class="c('container_settings_uitheme_card_base', preset.id)"
            type="button"
            :aria-pressed="uiTheme === preset.id"
            @click="setUiTheme(preset.id)"
          >
            <div :class="c('container_settings_uitheme_card_head', preset.id)">
              <span :class="c('container_settings_uitheme_card_trigram', preset.id)">
                {{ preset.trigram }}
              </span>
              <strong :class="c('container_settings_uitheme_card_name', preset.id)">
                {{ isEn ? preset.nameEn : preset.name }}
              </strong>
              <span :class="c('container_settings_uitheme_card_elem', preset.id)">
                {{ isEn ? preset.elementEn : preset.element }}
              </span>
            </div>
            <p :class="c('container_settings_uitheme_card_desc', preset.id)">
              {{ isEn ? preset.taglineEn : preset.tagline }}
            </p>
            <div :class="c('container_settings_uitheme_card_swatches', preset.id)">
              <span
                :class="c('container_settings_uitheme_swatch_bg', preset.id)"
                :style="{ backgroundColor: preset.colors.appBg }"
              />
              <span
                :class="c('container_settings_uitheme_swatch_panel', preset.id)"
                :style="{ backgroundColor: preset.colors.surface2 }"
              />
              <span
                :class="c('container_settings_uitheme_swatch_primary', preset.id)"
                :style="{ backgroundColor: preset.colors.accentPrimary }"
              />
              <span
                :class="c('container_settings_uitheme_swatch_secondary', preset.id)"
                :style="{ backgroundColor: preset.colors.accentSecondary }"
              />
            </div>
          </button>
        </div>

        <div class="container_settings_customui_panel_base" :data-active="uiTheme === 'custom'">
          <div class="container_settings_customui_header_row">
            <strong class="container_settings_customui_header_title">
              {{ t('settings.customUiTitle') }}
            </strong>
            <button
              class="container_settings_customui_apply_btn"
              type="button"
              @click="updateCustomUiColors(customUiColors)"
            >
              {{ t('settings.customUiEnable') }}
            </button>
            <button class="container_settings_customui_reset_btn" type="button" @click="resetCustomUiTheme">
              {{ t('settings.customUiReset') }}
            </button>
          </div>
          <div class="container_settings_customui_pickers_grid">
            <label class="container_settings_customui_picker_appbg">
              {{ t('settings.customUiAppBg') }}
              <input
                type="color"
                class="container_settings_customui_input_appbg"
                :value="customUiColors.appBg"
                @input="patchCustomColor('appBg', ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label class="container_settings_customui_picker_surface1">
              {{ t('settings.customUiSurface1') }}
              <input
                type="color"
                class="container_settings_customui_input_surface1"
                :value="customUiColors.surface1"
                @input="patchCustomColor('surface1', ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label class="container_settings_customui_picker_surface2">
              {{ t('settings.customUiSurface2') }}
              <input
                type="color"
                class="container_settings_customui_input_surface2"
                :value="customUiColors.surface2"
                @input="patchCustomColor('surface2', ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label class="container_settings_customui_picker_accent">
              {{ t('settings.customUiAccent1') }}
              <input
                type="color"
                class="container_settings_customui_input_accent"
                :value="customUiColors.accentPrimary"
                @input="patchCustomColor('accentPrimary', ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label class="container_settings_customui_picker_accent2">
              {{ t('settings.customUiAccent2') }}
              <input
                type="color"
                class="container_settings_customui_input_accent2"
                :value="customUiColors.accentSecondary"
                @input="patchCustomColor('accentSecondary', ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label class="container_settings_customui_picker_text">
              {{ t('settings.customUiText') }}
              <input
                type="color"
                class="container_settings_customui_input_text"
                :value="customUiColors.textPrimary"
                @input="patchCustomColor('textPrimary', ($event.target as HTMLInputElement).value)"
              />
            </label>
          </div>
        </div>
      </section>

      <section class="container_settings_motion_body_section">
        <label class="container_settings_terminal_body_motion-label">
          {{ t('settings.motionTier') }}
          <OrbitSelect
            :model-value="motionPreference"
            :options="motionTierOptions"
            :aria-label="t('settings.motionTier')"
            width="190px"
            instance="settings-motion"
            @update:model-value="motionPreference = $event as MotionPreference"
          />
        </label>
        <p class="container_settings_motion_body_status" :data-tier="motionStatus.tier">
          {{ motionStatusText }}
        </p>
        <p class="container_settings_motion_body_description">
          {{ t('settings.motionDesc') }}
          <span v-if="motionPreference === 'full'" class="container_settings_motion_body_warning">
            {{ t('settings.motionWarning') }}
          </span>
        </p>
        <button
          v-if="motionPreference === 'auto'"
          class="container_settings_motion_body_recheck"
          type="button"
          :aria-label="t('settings.motionRecheckAria')"
          @click="refreshMotionPreference"
        >
          <RefreshCw :size="12" />
          {{ t('settings.motionRecheck') }}
        </button>
        <label class="container_settings_terminal_body_contrast-label">
          <input
            v-model="highContrast"
            class="container_settings_terminal_body_contrast-check"
            type="checkbox"
          />
          {{ t('settings.highContrast') }}
        </label>
      </section>

      <section class="container_settings_tray_body_section">
        <div class="container_settings_tray_header_row">
          <h3 class="container_settings_tray_header_title">{{ t('settings.trayTitle') }}</h3>
          <span class="container_settings_tray_header_badge" :data-active="trayState.trayCreated">
            {{
              trayState.trayCreated
                ? t('settings.trayCreated')
                : bootstrap?.platform === 'linux'
                  ? t('settings.trayPendingLinux')
                  : t('settings.trayPendingWin')
            }}
          </span>
        </div>
        <label class="container_settings_tray_minimize_label">
          <input
            class="container_settings_tray_minimize_check"
            type="checkbox"
            :checked="trayState.minimizeToTray"
            @change="updateTrayPreferences({ minimizeToTray: ($event.target as HTMLInputElement).checked })"
          />
          {{ t('settings.trayMinimizeCheck') }}
        </label>
        <div
          class="container_settings_tray_close_group"
          role="radiogroup"
          :aria-label="t('settings.trayCloseAria')"
        >
          <span class="container_settings_tray_close_heading">{{ t('settings.trayCloseHeading') }}</span>
          <div class="container_settings_tray_close_grid">
            <button
              v-for="opt in closeActionOptions"
              :key="opt.value"
              :class="c('container_settings_tray_closeopt_base', opt.value)"
              type="button"
              role="radio"
              :aria-checked="trayState.closeAction === opt.value"
              @click="updateTrayPreferences({ closeAction: opt.value })"
            >
              <strong :class="c('container_settings_tray_closeopt_title', opt.value)">{{ opt.label }}</strong>
              <span :class="c('container_settings_tray_closeopt_desc', opt.value)">{{ opt.desc }}</span>
            </button>
          </div>
        </div>
        <label class="container_settings_tray_visibility_label">
          {{ t('settings.trayVisibilityLabel') }}
          <OrbitSelect
            :model-value="trayState.trayVisibility"
            :options="trayVisibilityOptions"
            :aria-label="t('settings.trayVisibilityLabel')"
            width="276px"
            instance="settings-tray-visibility"
            @update:model-value="updateTrayPreferences({ trayVisibility: $event as TrayVisibilityMode })"
          />
        </label>
        <div class="container_settings_tray_actions_row">
          <button class="container_settings_tray_actions_hide" type="button" @click="hideWindowToTray">
            <Minimize2 :size="13" />
            {{ t('settings.trayHideNow') }}
          </button>
          <span class="container_settings_tray_actions_hint">
            {{ bootstrap?.platform === 'linux' ? t('settings.trayHintLinux') : t('settings.trayHintWin') }}
          </span>
        </div>
      </section>

      <section class="container_settings_security_body_base">
        <h3 class="container_settings_security_header_title">{{ t('settings.securityTitle') }}</h3>
        <p class="container_settings_security_body_status">
          <ShieldCheck :size="15" />
          {{
            bootstrap?.encryptionAvailable
              ? bootstrap.platform === 'linux'
                ? t('settings.secAvailLinux', { backend: bootstrap.encryptionBackend })
                : t('settings.secAvailWin')
              : bootstrap?.platform === 'linux'
                ? t('settings.secUnavailLinux')
                : t('settings.secUnavailWin')
          }}
        </p>
        <p class="container_settings_security_body_description">
          {{
            bootstrap?.platform === 'linux'
              ? bootstrap?.encryptionAvailable
                ? t('settings.secDescLinuxAvail')
                : t('settings.secDescLinuxUnavail')
              : t('settings.secDescWin')
          }}
        </p>
      </section>

      <section ref="updateSectionRef" class="container_settings_update_body_section">
        <div class="container_settings_update_header_row">
          <h3 class="container_settings_update_header_title">{{ t('settings.updateTitle') }}</h3>
          <span class="container_settings_update_header_badge" :data-phase="updateState.phase">
            {{ updateStatusLabel }}
          </span>
        </div>
        <div class="container_settings_update_meta_grid">
          <div
            v-for="item in updateMetaItems"
            :key="item.key"
            :class="c('container_settings_update_meta_item', item.key)"
          >
            <span :class="c('container_settings_update_meta_label', item.key)">{{ item.label }}</span>
            <strong :class="c('container_settings_update_meta_value', item.key)">{{ item.value }}</strong>
          </div>
        </div>

        <p class="container_settings_update_status_text" :data-phase="updateState.phase">
          {{ updateState.message }}
        </p>

        <div
          v-if="updateState.phase === 'downloading' && updateState.progress"
          class="container_settings_update_progress_box"
        >
          <div class="container_settings_update_progress_track">
            <div
              class="container_settings_update_progress_fill"
              :style="{ width: `${updateState.progress.percent ?? 15}%` }"
            />
          </div>
          <span class="container_settings_update_progress_text">
            {{ updateState.progress.percent ?? 0 }}% ·
            {{ formatByteSize(updateState.progress.transferredBytes) }} /
            {{ formatByteSize(updateState.progress.totalBytes) }}
          </span>
        </div>

        <div v-if="updateState.latest" class="container_settings_update_release_card">
          <div class="container_settings_update_release_head">
            <strong class="container_settings_update_release_version">
              {{ updateState.latest.title || updateState.latest.tagName }}
            </strong>
            <span v-if="updateState.latest.prerelease" class="container_settings_update_release_pretag">
              {{ t('settings.updatePrerelease') }}
            </span>
            <span class="container_settings_update_release_date">
              {{ formatIsoTime(updateState.latest.publishedAt) }}
            </span>
          </div>
          <div class="container_settings_update_release_assetrow">
            <span class="container_settings_update_release_assetname">
              {{
                t('settings.updateInstallerLine', {
                  name: updateState.latest.assetName,
                  size: formatByteSize(updateState.latest.sizeBytes)
                })
              }}
            </span>
            <span v-if="updateState.verifiedHash" class="container_settings_update_release_verified">
              {{ t('settings.updateVerified', { hash: updateState.verifiedHash.slice(0, 22) }) }}
            </span>
          </div>
          <pre class="container_settings_update_release_notes">{{
            updateState.latest.notes || t('settings.updateEmptyNotes')
          }}</pre>
        </div>

        <div class="container_settings_update_actions_row">
          <button
            class="container_settings_update_actions_check"
            type="button"
            :disabled="updateState.phase === 'checking' || updateState.phase === 'downloading'"
            @click="checkForUpdates"
          >
            <RefreshCw :size="13" />
            {{
              updateState.phase === 'checking'
                ? t('settings.updateCheckingBtn')
                : t('settings.updateCheckBtn')
            }}
          </button>

          <button
            v-if="updateState.phase === 'available' && updateState.latest?.downloadUrl"
            class="container_settings_update_actions_download"
            type="button"
            data-primary="true"
            @click="downloadAvailableUpdate"
          >
            <Download :size="13" />
            {{ t('settings.updateDownloadBtn', { size: formatByteSize(updateState.latest.sizeBytes) }) }}
          </button>

          <button
            v-if="updateState.phase === 'downloading'"
            class="container_settings_update_actions_cancel"
            type="button"
            @click="cancelUpdateDownload"
          >
            {{ t('settings.updateCancelDownload') }}
          </button>

          <button
            v-if="updateState.phase === 'downloaded' && updateState.latest?.packageKind !== 'deb'"
            class="container_settings_update_actions_install"
            type="button"
            data-primary="true"
            @click="installDownloadedUpdate"
          >
            <Rocket :size="13" />
            {{
              updateState.latest?.packageKind === 'appimage'
                ? t('settings.updateInstallAppImage')
                : t('settings.updateInstallNow')
            }}
          </button>

          <button
            v-if="updateState.phase === 'downloaded' && updateState.latest?.packageKind === 'deb'"
            class="container_settings_update_actions_debinstall"
            type="button"
            data-primary="true"
            @click="installDownloadedUpdate"
          >
            <Rocket :size="13" />
            {{ t('settings.updateInstallDeb') }}
          </button>

          <button
            v-if="updateState.phase === 'downloaded'"
            class="container_settings_update_actions_reveal"
            type="button"
            @click="revealDownloadedUpdate"
          >
            <FolderOpen :size="13" />
            {{ t('settings.updateRevealFile') }}
          </button>

          <button
            class="container_settings_update_actions_github"
            type="button"
            @click="openUpdateReleasePage"
          >
            <ExternalLink :size="13" />
            {{ t('settings.updateOpenGithub') }}
          </button>

          <button
            v-if="
              updateState.phase === 'available' &&
              updateState.latest &&
              updateState.preferences.ignoredVersion !== updateState.latest.version
            "
            class="container_settings_update_actions_ignore"
            type="button"
            @click="updateUpdaterPreferences({ ignoredVersion: updateState.latest.version })"
          >
            {{ t('settings.updateIgnoreVersion') }}
          </button>
        </div>

        <div
          v-if="
            updateState.phase === 'downloaded' &&
            updateState.latest?.packageKind === 'deb' &&
            updateState.downloadedFilePath
          "
          class="container_settings_update_debhint_box"
        >
          <span class="container_settings_update_debhint_label">{{ t('settings.updateDebHint') }}</span>
          <code class="container_settings_update_debhint_cmd">
            sudo apt install "{{ updateState.downloadedFilePath }}"
          </code>
        </div>

        <label class="container_settings_update_autocheck_label">
          <input
            class="container_settings_update_autocheck_check"
            type="checkbox"
            :checked="updateState.preferences.autoCheckOnStartup"
            @change="
              updateUpdaterPreferences({ autoCheckOnStartup: ($event.target as HTMLInputElement).checked })
            "
          />
          {{ t('settings.updateAutoCheck') }}
        </label>

        <label class="container_settings_update_prerelease_label">
          <input
            class="container_settings_update_prerelease_check"
            type="checkbox"
            :checked="updateState.preferences.allowPrerelease"
            @change="
              updateUpdaterPreferences({ allowPrerelease: ($event.target as HTMLInputElement).checked })
            "
          />
          {{ t('settings.updateAllowPre') }}
        </label>
      </section>

      <section class="container_settings_about_body_base">
        <h3 class="container_settings_about_header_title">{{ t('settings.aboutTitle') }}</h3>
        <div class="container_settings_about_body_brand">
          <img class="container_settings_about_body_icon" :src="orbitIcon" alt="" />
          <div class="container_settings_about_body_meta">
            <p class="container_settings_about_body_version">
              {{ t('titlebar.brand') }} {{ bootstrap?.versions.app }} · Electron
              {{ bootstrap?.versions.electron }} · Node {{ bootstrap?.versions.node }}
            </p>
            <p class="container_settings_about_body_scope">
              {{ t('settings.aboutScope') }}
            </p>
          </div>
        </div>
      </section>
    </template>

    <template v-else-if="activeDomain === 'ssh'">
      <section class="container_settings_sshproto_body_section" data-testid="ssh-protocol-settings-section">
        <h3 class="container_settings_sshproto_header_title">{{ t('settings.sshProtoTitle') }}</h3>
        <p class="container_settings_sshproto_header_desc">{{ t('settings.sshProtoDesc') }}</p>
        <div class="container_settings_sshproto_grid_row">
          <label class="container_settings_sshproto_port_label">
            {{ t('settings.sshDefaultPort') }}
            <input
              class="container_settings_sshproto_port_input"
              type="number"
              min="1"
              max="65535"
              :value="protocolSettings.ssh.defaultPort"
              @change="
                updateSshSetting({
                  defaultPort: Math.min(
                    65535,
                    Math.max(1, Number(($event.target as HTMLInputElement).value) || 22)
                  )
                })
              "
            />
          </label>
          <label class="container_settings_sshproto_keepalive_label">
            {{ t('settings.sshDefaultKeepalive') }}
            <input
              class="container_settings_sshproto_keepalive_input"
              type="number"
              min="0"
              max="3600"
              :value="protocolSettings.ssh.defaultKeepaliveSec"
              @change="
                updateSshSetting({
                  defaultKeepaliveSec: Math.min(
                    3600,
                    Math.max(0, Number(($event.target as HTMLInputElement).value) || 0)
                  )
                })
              "
            />
          </label>
        </div>
      </section>

      <TypographySettingsSection section="terminal" />

      <section class="container_settings_terminal_body_base">
        <h3 class="container_settings_terminal_header_title">{{ t('settings.termVisualTitle') }}</h3>
        <label class="container_settings_terminal_body_gpu-label">
          <input
            v-model="terminalGpuEnabled"
            class="container_settings_terminal_body_gpu-check"
            type="checkbox"
          />
          {{ t('settings.termGpuLabel') }}
        </label>
        <p class="container_settings_terminal_body_gpu-description">
          {{ t('settings.termGpuDesc') }}
        </p>
        <label class="container_settings_terminal_body_cursor-label">
          {{ t('settings.cursorStyle') }}
          <OrbitSelect
            :model-value="cursorStyle"
            :options="cursorStyleOptions"
            :aria-label="t('settings.cursorStyle')"
            width="190px"
            instance="settings-cursor"
            @update:model-value="cursorStyle = $event as CursorShape"
          />
        </label>
        <label class="container_settings_terminal_body_blink-label">
          <input v-model="cursorBlink" class="container_settings_terminal_body_blink-check" type="checkbox" />
          {{ t('settings.cursorBlink') }}
        </label>
        <label class="container_settings_terminal_body_reader-label">
          <input
            v-model="screenReaderDefault"
            class="container_settings_terminal_body_reader-check"
            type="checkbox"
          />
          {{ t('settings.screenReader') }}
        </label>
        <div class="container_settings_theme_body_section">
          <span class="container_settings_theme_body_heading">{{ t('settings.termThemesHeading') }}</span>
          <div class="container_settings_theme_body_grid">
            <button
              v-for="preset in TERMINAL_THEMES"
              :key="preset.id"
              :class="c('container_settings_theme_card_base', preset.id)"
              type="button"
              :aria-pressed="terminalTheme === preset.id"
              @click="terminalTheme = preset.id"
            >
              <span
                :class="c('container_settings_theme_card_preview', preset.id)"
                :style="{ background: preset.background, color: preset.theme.foreground }"
              >
                <span
                  :class="c('container_settings_theme_card_prompt', preset.id)"
                  :style="{ color: preset.theme.magenta }"
                >
                  ●
                </span>
                <span
                  :class="c('container_settings_theme_card_path', preset.id)"
                  :style="{ color: preset.theme.cyan }"
                >
                  ~/app
                </span>
                <span
                  :class="c('container_settings_theme_card_cursor', preset.id)"
                  :style="{ background: preset.theme.cursor }"
                />
              </span>
              <span :class="c('container_settings_theme_card_meta', preset.id)">
                <strong :class="c('container_settings_theme_card_name', preset.id)">
                  {{ isEn ? preset.nameEn : preset.name }}
                </strong>
                <span :class="c('container_settings_theme_card_badge', preset.id)">
                  {{ isEn ? preset.badgeEn : preset.badge }}
                </span>
              </span>
              <span :class="c('container_settings_theme_card_swatches', preset.id)">
                <span
                  v-for="(swatch, idx) in preset.swatches"
                  :key="idx"
                  :class="c('container_settings_theme_card_swatch', `${preset.id}-s${idx}`)"
                  :style="{ backgroundColor: swatch }"
                />
              </span>
            </button>
          </div>
        </div>
      </section>
    </template>

    <template v-else-if="activeDomain === 'files'">
      <section
        class="container_settings_fileproto_body_section"
        data-testid="files-protocol-settings-section"
      >
        <h3 class="container_settings_fileproto_header_title">{{ t('settings.filesProtoTitle') }}</h3>
        <p class="container_settings_fileproto_header_desc">{{ t('settings.filesProtoDesc') }}</p>
        <div class="container_settings_fileproto_grid_row">
          <label class="container_settings_fileproto_conc_label">
            {{ t('settings.filesMaxConcurrent') }}
            <input
              class="container_settings_fileproto_conc_input"
              type="number"
              min="1"
              max="8"
              :value="protocolSettings.files.maxConcurrentTransfers"
              @change="
                updateFilesSetting({
                  maxConcurrentTransfers: Math.min(
                    8,
                    Math.max(1, Number(($event.target as HTMLInputElement).value) || 3)
                  )
                })
              "
            />
          </label>
          <label class="container_settings_fileproto_speed_label">
            {{ t('settings.filesSpeedLimit') }}
            <input
              class="container_settings_fileproto_speed_input"
              type="number"
              min="0"
              max="1048576"
              :value="protocolSettings.files.speedLimitKBps"
              @change="
                updateFilesSetting({
                  speedLimitKBps: Math.max(0, Number(($event.target as HTMLInputElement).value) || 0)
                })
              "
            />
          </label>
          <label class="container_settings_fileproto_timeout_label">
            {{ t('settings.filesTimeoutSec') }}
            <input
              class="container_settings_fileproto_timeout_input"
              type="number"
              min="5"
              max="120"
              :value="protocolSettings.files.connectTimeoutSec"
              @change="
                updateFilesSetting({
                  connectTimeoutSec: Math.min(
                    120,
                    Math.max(5, Number(($event.target as HTMLInputElement).value) || 20)
                  )
                })
              "
            />
          </label>
          <label class="container_settings_fileproto_s3part_label">
            {{ t('settings.filesS3PartSize') }}
            <input
              class="container_settings_fileproto_s3part_input"
              type="number"
              min="5"
              max="128"
              :value="protocolSettings.files.s3PartSizeMiB"
              @change="
                updateFilesSetting({
                  s3PartSizeMiB: Math.min(
                    128,
                    Math.max(5, Number(($event.target as HTMLInputElement).value) || 8)
                  )
                })
              "
            />
          </label>
        </div>

        <label class="container_settings_fileproto_conflict_label">
          {{ t('settings.filesConflictDefault') }}
          <OrbitSelect
            :model-value="protocolSettings.files.defaultConflict"
            :options="conflictPolicyOptions"
            :aria-label="t('settings.filesConflictDefault')"
            width="260px"
            instance="settings-files-conflict"
            @update:model-value="
              updateFilesSetting({ defaultConflict: $event as 'ask' | 'overwrite' | 'skip' | 'rename' })
            "
          />
        </label>

        <label class="container_settings_fileproto_hidden_label">
          <input
            class="container_settings_fileproto_hidden_check"
            type="checkbox"
            :checked="protocolSettings.files.showHidden"
            @change="updateFilesSetting({ showHidden: ($event.target as HTMLInputElement).checked })"
          />
          {{ t('settings.filesShowHidden') }}
        </label>
        <label class="container_settings_fileproto_del_label">
          <input
            class="container_settings_fileproto_del_check"
            type="checkbox"
            :checked="protocolSettings.files.confirmDelete"
            @change="updateFilesSetting({ confirmDelete: ($event.target as HTMLInputElement).checked })"
          />
          {{ t('settings.filesConfirmDelete') }}
        </label>
        <label class="container_settings_fileproto_pathstyle_label">
          <input
            class="container_settings_fileproto_pathstyle_check"
            type="checkbox"
            :checked="protocolSettings.files.s3DefaultPathStyle"
            @change="updateFilesSetting({ s3DefaultPathStyle: ($event.target as HTMLInputElement).checked })"
          />
          {{ t('settings.filesS3PathStyle') }}
        </label>
        <p class="container_settings_fileproto_note_text">{{ t('settings.filesProtoNote') }}</p>
      </section>
    </template>
  </section>
</template>

<style scoped lang="scss">
.container_settings_page_body_base {
  padding: 36px;
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.container_settings_page_header_eyebrow {
  font-size: var(--font-size-ui-xs);
  letter-spacing: 1.5px;
  color: var(--color-accent-primary);
}
.container_settings_page_header_title {
  font-family: var(--font-display);
  font-size: var(--font-size-ui-title);
  font-weight: var(--font-ui-heading-weight);
  color: var(--color-text-heading);
  margin: 10px 0 18px;
}
.container_settings_lang_body_section {
  padding: 16px 0 22px;
  border-bottom: 1px solid var(--color-border);
  margin-bottom: 18px;
  max-width: 900px;
}
.container_settings_lang_header_row {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-accent-primary-hover);
}
.container_settings_lang_header_title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--font-size-ui-lg);
  font-weight: var(--font-ui-heading-weight);
  color: var(--color-text-heading);
}
.container_settings_lang_header_desc {
  margin: 6px 0 14px;
  font-size: var(--font-size-ui-xs);
  color: var(--color-text-muted);
}
.container_settings_lang_grid_row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
}
[class*='container_settings_lang_card_base'] {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 12px 14px;
  border-radius: var(--radius-card);
  border: 1px solid var(--color-border-subtle);
  background: var(--color-surface-1);
  text-align: left;
  cursor: pointer;
  transition:
    border-color 140ms ease,
    background 140ms ease,
    box-shadow 140ms ease;
  &:hover {
    border-color: var(--color-accent-primary-ring);
    background: var(--color-surface-2);
  }
  &[aria-checked='true'] {
    border-color: var(--color-accent-primary);
    box-shadow: 0 0 0 1px var(--color-accent-primary-ring);
    background: var(--color-accent-primary-soft);
  }
}
[class*='container_settings_lang_card_code'] {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  color: var(--color-accent-primary-hover);
}
[class*='container_settings_lang_card_title'] {
  font-family: var(--font-display);
  font-size: var(--font-size-ui-md);
  color: var(--color-text-heading);
}
[class*='container_settings_lang_card_desc'] {
  font-size: var(--font-size-ui-xs);
  color: var(--color-text-muted);
  line-height: 1.45;
}
.container_settings_terminal_body_base,
.container_settings_tray_body_section,
.container_settings_security_body_base,
.container_settings_update_body_section,
.container_settings_about_body_base {
  padding: 22px 0;
  border-bottom: 1px solid var(--color-border);
  max-width: 820px;
  h3 {
    font-family: var(--font-display);
    font-size: var(--font-size-ui-lg);
    font-weight: var(--font-ui-heading-weight);
    color: var(--color-text-heading);
    margin: 0 0 18px;
  }
  p {
    font-size: var(--font-size-ui-sm);
    line-height: var(--font-ui-line-height);
    letter-spacing: var(--font-ui-letter-spacing);
    color: var(--color-text-secondary);
  }
}
.container_settings_tray_header_row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
  h3 {
    margin: 0;
  }
}
.container_settings_tray_header_badge {
  font-size: 11px;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid var(--color-border);
  background: var(--color-surface-1);
  color: var(--color-text-muted);
  &[data-active='true'] {
    border-color: rgba(89, 214, 160, 0.4);
    background: rgba(89, 214, 160, 0.1);
    color: #6ee7b7;
  }
}
.container_settings_tray_minimize_label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  font-size: 13px;
  color: var(--color-text-secondary);
}
.container_settings_tray_close_group {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.container_settings_tray_close_heading {
  font-size: 13px;
  color: var(--color-text-primary);
}
.container_settings_tray_close_grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
[class*='container_settings_tray_closeopt_base'] {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-start;
  gap: 5px;
  padding: 10px 12px;
  text-align: left;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-surface-1);
  transition:
    border-color 140ms ease,
    background 140ms ease,
    box-shadow 140ms ease;
  &:hover {
    border-color: var(--color-accent-primary-ring);
    background: var(--color-surface-2);
  }
  &[aria-checked='true'] {
    border-color: var(--color-accent-primary);
    box-shadow: 0 0 0 1px var(--color-accent-primary-ring);
    background: var(--color-accent-primary-soft);
  }
}
[class*='container_settings_tray_closeopt_title'] {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-primary);
}
[class*='container_settings_tray_closeopt_desc'] {
  font-size: 11px;
  line-height: 1.45;
  color: var(--color-text-muted);
}
.container_settings_tray_visibility_label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 16px;
  font-size: 13px;
}
.container_settings_tray_actions_row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 16px;
}
.container_settings_tray_actions_hide {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.container_settings_tray_actions_hint {
  font-size: 12px;
  color: var(--color-text-muted);
}
.container_settings_terminal_body_cursor-label,
.container_settings_terminal_body_motion-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 18px;
  font-size: var(--font-size-ui-sm);
}
.container_settings_motion_body_status {
  margin: 10px 0 0;
  color: var(--color-accent-primary-hover);
  font-size: var(--font-size-ui-xs);
  line-height: 1.6;
  &[data-tier='off'] {
    color: var(--color-text-muted);
  }
}
.container_settings_terminal_body_gpu-description,
.container_settings_motion_body_description {
  margin: 5px 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-xs);
  line-height: 1.65;
}
.container_settings_motion_body_warning {
  color: var(--color-warning, #f5c46b);
}
.container_settings_motion_body_recheck {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 26px;
  margin-top: 8px;
  padding: 3px 8px;
  color: var(--color-accent-primary-hover);
  background: transparent;
  border: 1px solid var(--color-accent-primary-ring);
  border-radius: var(--radius-control);
  font-size: var(--font-size-ui-xs);
  &:hover {
    background: var(--color-accent-primary-soft);
  }
}
.container_settings_terminal_body_gpu-label,
.container_settings_terminal_body_blink-label,
.container_settings_terminal_body_contrast-label,
.container_settings_terminal_body_reader-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
  font-size: var(--font-size-ui-sm);
  color: var(--color-text-secondary);
}
.container_settings_theme_body_section {
  margin-top: 24px;
}
.container_settings_theme_body_heading {
  display: block;
  font-size: 13px;
  color: var(--color-text-primary);
  margin-bottom: 12px;
}
.container_settings_theme_body_grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 10px;
}
.container_settings_theme_card_base {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  padding: 10px;
  text-align: left;
  border-radius: 10px;
  border: 1px solid var(--color-border);
  background: var(--color-surface-1);
  &[aria-pressed='true'] {
    border-color: var(--color-accent-primary);
    box-shadow: 0 0 0 1px var(--color-accent-primary-ring);
    background: var(--color-surface-2);
  }
}
.container_settings_theme_card_preview {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 6px;
  font-family: var(--font-mono);
  font-size: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.container_settings_theme_card_cursor {
  display: inline-block;
  width: 7px;
  height: 13px;
  border-radius: 1px;
}
.container_settings_theme_card_meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.container_settings_theme_card_name {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-primary);
}
.container_settings_theme_card_badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--color-accent-primary-soft);
  border: 1px solid var(--color-accent-primary-ring);
  color: var(--color-accent-primary-hover);
}
.container_settings_theme_card_swatches {
  display: flex;
  gap: 5px;
}
.container_settings_theme_card_swatch {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.14);
}
.container_settings_security_body_status {
  display: flex;
  align-items: center;
  gap: 7px;
}
.container_settings_uitheme_body_section {
  padding: 20px 0 24px;
  border-bottom: 1px solid var(--color-border);
  max-width: 820px;
}
.container_settings_uitheme_header_title {
  font-family: var(--font-display);
  font-size: var(--font-size-ui-lg);
  font-weight: var(--font-ui-heading-weight);
  color: var(--color-text-heading);
  margin: 0 0 8px;
}
.container_settings_uitheme_header_desc {
  margin: 0 0 14px;
  font-size: var(--font-size-ui-xs);
  color: var(--color-text-muted);
}
.container_settings_uitheme_grid_base {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(235px, 1fr));
  gap: 10px;
}
[class*='container_settings_uitheme_card_base'] {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 7px;
  padding: 11px 12px;
  text-align: left;
  border-radius: 6px;
  border: 1px solid var(--color-border);
  background: var(--color-surface-1);
  &[aria-pressed='true'] {
    border-color: var(--color-accent-primary);
    box-shadow: 0 0 0 1px var(--color-accent-primary-ring);
    background: var(--color-surface-2);
  }
}
[class*='container_settings_uitheme_card_head'] {
  display: flex;
  align-items: center;
  gap: 6px;
}
[class*='container_settings_uitheme_card_trigram'] {
  color: var(--color-accent-secondary);
  font-size: 14px;
}
[class*='container_settings_uitheme_card_name'] {
  font-size: 12px;
  color: var(--color-text-primary);
}
[class*='container_settings_uitheme_card_elem'] {
  margin-left: auto;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  border: 1px solid var(--color-seal-ring);
  background: var(--color-seal-soft);
  color: #f3c6be;
}
[class*='container_settings_uitheme_card_desc'] {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-text-muted);
}
[class*='container_settings_uitheme_card_swatches'] {
  display: flex;
  gap: 6px;
  margin-top: 2px;
  > span {
    width: 16px;
    height: 16px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.16);
  }
}
.container_settings_customui_panel_base {
  margin-top: 14px;
  padding: 14px;
  border-radius: 10px;
  border: 1px solid var(--color-border);
  background: var(--color-surface-1);
  display: flex;
  flex-direction: column;
  gap: 12px;
  &[data-active='true'] {
    border-color: var(--color-accent-primary);
  }
}
.container_settings_customui_header_row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.container_settings_customui_apply_btn {
  margin-left: auto;
}
.container_settings_customui_pickers_grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: 10px;
  label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    font-size: 12px;
    color: var(--color-text-secondary);
    padding: 6px 8px;
    border-radius: 8px;
    border: 1px solid var(--color-border-subtle);
    background: var(--color-surface-2);
    input {
      width: 30px;
      height: 24px;
      padding: 0;
      border: none;
      background: transparent;
    }
  }
}
.container_settings_about_body_brand {
  display: flex;
  align-items: flex-start;
  gap: 18px;
}
.container_settings_about_body_icon {
  width: 64px;
  height: 64px;
  flex-shrink: 0;
  border-radius: 10px;
  filter: drop-shadow(0 8px 18px var(--color-accent-primary-glow));
  transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
  &:hover {
    transform: perspective(400px) rotateY(-12deg) rotateX(8deg) scale(1.04);
  }
}
.container_settings_about_body_meta {
  min-width: 0;
  p:first-child {
    margin-top: 0;
  }
}
.container_settings_update_header_row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
  h3 {
    margin: 0;
  }
}
.container_settings_update_header_badge {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--color-border);
  background: var(--color-surface-1);
  color: var(--color-text-muted);
  &[data-phase='up-to-date'],
  &[data-phase='downloaded'] {
    border-color: rgba(89, 214, 160, 0.42);
    background: rgba(89, 214, 160, 0.1);
    color: #86efac;
  }
  &[data-phase='available'],
  &[data-phase='downloading'] {
    border-color: var(--color-accent-primary-ring);
    background: var(--color-accent-primary-soft);
    color: var(--color-accent-primary-hover);
  }
  &[data-phase='error'] {
    border-color: var(--color-seal-ring);
    background: var(--color-seal-soft);
    color: #f4d9cf;
  }
}
.container_settings_update_meta_grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}
.container_settings_update_meta_item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border);
  background: var(--color-surface-1);
}
.container_settings_update_meta_label {
  font-size: 11px;
  color: var(--color-text-muted);
}
.container_settings_update_meta_value {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-primary);
  font-family: var(--font-mono);
}
.container_settings_update_status_text {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--color-text-secondary);
  &[data-phase='error'] {
    color: #fca5a5;
  }
}
.container_settings_update_progress_box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 14px;
}
.container_settings_update_progress_track {
  width: 100%;
  height: 7px;
  border-radius: 999px;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  overflow: hidden;
}
.container_settings_update_progress_fill {
  height: 100%;
  background: linear-gradient(90deg, var(--color-accent-primary), var(--color-accent-secondary));
  transition: width 140ms ease;
}
.container_settings_update_progress_text {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-text-muted);
}
.container_settings_update_release_card {
  padding: 12px 14px;
  border-radius: var(--radius-card);
  border: 1px solid var(--color-border);
  background: var(--color-surface-1);
  margin-bottom: 14px;
}
.container_settings_update_release_head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.container_settings_update_release_version {
  font-size: 13px;
  color: var(--color-accent-primary-hover);
}
.container_settings_update_release_pretag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  border: 1px solid var(--color-seal-ring);
  background: var(--color-seal-soft);
  color: #f4d9cf;
}
.container_settings_update_release_date {
  margin-left: auto;
  font-size: 11px;
  color: var(--color-text-muted);
}
.container_settings_update_release_assetrow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 11px;
  color: var(--color-text-muted);
  margin-bottom: 8px;
}
.container_settings_update_release_verified {
  font-family: var(--font-mono);
  color: #86efac;
}
.container_settings_update_release_notes {
  margin: 0;
  padding: 10px;
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border-subtle);
  background: var(--color-surface-2);
  color: var(--color-text-secondary);
  font-family: var(--font-sans);
  font-size: 12px;
  line-height: 1.65;
  white-space: pre-wrap;
  max-height: 160px;
  overflow: auto;
}
.container_settings_update_actions_row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 14px;
  button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
}
.container_settings_update_debhint_box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  margin-bottom: 12px;
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border-subtle);
  background: var(--color-surface-1);
}
.container_settings_update_debhint_label {
  font-size: 12px;
  color: var(--color-text-secondary);
}
.container_settings_update_debhint_cmd {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--color-accent-primary-hover);
  overflow-wrap: anywhere;
  user-select: text;
}
.container_settings_update_autocheck_label,
.container_settings_update_prerelease_label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  font-size: 13px;
  color: var(--color-text-secondary);
}
.container_settings_domains_tab_bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-bottom: 14px;
  margin-bottom: 18px;
  border-bottom: 1px solid var(--color-border);
  max-width: 900px;
}
[class*='container_settings_domains_tab_btn'] {
  padding: 7px 14px;
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border-control);
  background: var(--color-surface-1);
  color: var(--color-text-secondary);
  font-size: var(--font-size-ui-sm);
  &[aria-selected='true'] {
    border-color: var(--color-accent-primary);
    background: var(--color-accent-primary-soft);
    color: var(--color-accent-primary-bright);
    box-shadow: 0 0 0 1px var(--color-accent-primary-ring);
  }
}
.container_settings_motion_body_section,
.container_settings_sshproto_body_section,
.container_settings_fileproto_body_section {
  max-width: 900px;
  padding: 18px 0 22px;
  border-bottom: 1px solid var(--color-border);
  margin-bottom: 18px;
}
.container_settings_sshproto_header_title,
.container_settings_fileproto_header_title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--font-size-ui-lg);
  color: var(--color-text-heading);
}
.container_settings_sshproto_header_desc,
.container_settings_fileproto_header_desc {
  margin: 6px 0 14px;
  font-size: var(--font-size-ui-xs);
  color: var(--color-text-muted);
}
.container_settings_sshproto_grid_row,
.container_settings_fileproto_grid_row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}
.container_settings_sshproto_port_label,
.container_settings_sshproto_keepalive_label,
.container_settings_fileproto_conc_label,
.container_settings_fileproto_speed_label,
.container_settings_fileproto_timeout_label,
.container_settings_fileproto_s3part_label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: var(--font-size-ui-xs);
  color: var(--color-text-secondary);
}
.container_settings_fileproto_conflict_label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 16px;
  font-size: var(--font-size-ui-sm);
}
.container_settings_fileproto_hidden_label,
.container_settings_fileproto_del_label,
.container_settings_fileproto_pathstyle_label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  font-size: var(--font-size-ui-sm);
  color: var(--color-text-secondary);
}
.container_settings_fileproto_note_text {
  margin: 14px 0 0;
  padding: 9px 12px;
  border-radius: 8px;
  border: 1px solid var(--color-border-subtle);
  background: var(--color-surface-1);
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-xs);
  line-height: 1.55;
}
</style>
