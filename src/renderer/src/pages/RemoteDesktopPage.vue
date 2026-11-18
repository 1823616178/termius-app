<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  Monitor,
  Plus,
  Zap,
  Star,
  Pencil,
  Trash2,
  X,
  Server,
  ShieldAlert,
  ShieldCheck,
  Settings,
  Copy,
  SquareTerminal,
  RefreshCw
} from '@lucide/vue'
import { instanceClass, safeInstanceToken } from '../../../shared/classes'
import type { Host } from '../../../shared/contracts'
import {
  RDP_DEFAULT_PORT,
  type RdpLaunchMode,
  type RdpProfile,
  type RdpProfileInput
} from '../../../shared/rdp'
import RdpEmbeddedCanvas from '../components/RdpEmbeddedCanvas.vue'
import RdpProfileEditor from '../components/RdpProfileEditor.vue'
import { t } from '../services/i18n'
import {
  activeRdpCertPrompt,
  activeRdpSessionId,
  closeRdpSessionTab,
  connectRdpSession,
  currentRdpSession,
  decideRdpCertPrompt,
  disconnectRdpSession,
  ensureRdpWorkspaceListeners,
  markRdpSessionStatus,
  rdpConnecting,
  rdpConnectError,
  rdpSessions,
  type RdpClientSession
} from '../services/rdp-workspace'
import {
  bootstrap,
  hosts,
  notify,
  openSettingsDomain,
  protocolSettings,
  rdpProbe,
  rdpProfiles,
  refreshRdpProbe,
  removeRdpProfile,
  saveRdpProfile
} from '../stores/workbench'

const c = (base: string, token: string) => instanceClass(base, safeInstanceToken(token))

const search = ref('')
const favoritesOnly = ref(false)
const editorOpen = ref(false)
const editorMode = ref<'add' | 'edit' | 'quick'>('add')
const editingProfile = ref<RdpProfile>()
const editorPrefillHost = ref<Host>()
const editorBusy = ref(false)
const editorError = ref('')
const sessionSeqMap = reactive<Record<string, number>>({})

const inlineQuick = reactive({
  host: '',
  port: RDP_DEFAULT_PORT,
  username: '',
  password: '',
  launchMode: 'inherit' as 'inherit' | RdpLaunchMode
})

onMounted(() => {
  ensureRdpWorkspaceListeners()
  void refreshRdpProbe(false).catch(() => {})
})

const filteredProfiles = computed(() => {
  const q = search.value.trim().toLowerCase()
  return rdpProfiles.value.filter((item) => {
    if (favoritesOnly.value && !item.favorite) return false
    if (!q) return true
    return (
      item.name.toLowerCase().includes(q) ||
      item.host.toLowerCase().includes(q) ||
      item.username.toLowerCase().includes(q)
    )
  })
})

const filteredSshHosts = computed(() => {
  const q = search.value.trim().toLowerCase()
  return hosts.value.filter((item) => {
    if (favoritesOnly.value && !item.favorite) return false
    if (!q) return true
    return (
      item.name.toLowerCase().includes(q) ||
      item.address.toLowerCase().includes(q) ||
      item.username.toLowerCase().includes(q)
    )
  })
})

const globalPreferredLabel = computed(() =>
  protocolSettings.value.rdp.preferredMode === 'embedded'
    ? t('remotePage.modeBadgeB')
    : t('remotePage.modeBadgeA')
)

const needsMissingBanner = computed(
  () => protocolSettings.value.rdp.preferredMode === 'external' && !rdpProbe.value.schemeAAvailable
)

function profileModeLabel(profile: RdpProfile): string {
  if (profile.options.launchMode === 'external') return t('remotePage.modeOverrideA')
  if (profile.options.launchMode === 'embedded') return t('remotePage.modeOverrideB')
  return t('remotePage.modeInherit')
}

function openAddModal(fromHost?: Host): void {
  editorMode.value = 'add'
  editingProfile.value = undefined
  editorPrefillHost.value = fromHost
  editorError.value = ''
  editorOpen.value = true
}

function openEditModal(profile: RdpProfile): void {
  editorMode.value = 'edit'
  editingProfile.value = profile
  editorPrefillHost.value = undefined
  editorError.value = ''
  editorOpen.value = true
}

function openQuickModal(): void {
  editorMode.value = 'quick'
  editingProfile.value = undefined
  editorPrefillHost.value = undefined
  editorError.value = ''
  editorOpen.value = true
}

async function handleConnectProfile(profile: RdpProfile): Promise<void> {
  try {
    await connectRdpSession({ kind: 'profile', profileId: profile.id })
  } catch (err) {
    notify(err instanceof Error ? err.message : '连接 RDP 失败')
  }
}

async function handleQuickConnectFromSshHost(sshHost: Host): Promise<void> {
  try {
    await connectRdpSession({
      kind: 'adhoc',
      name: `${sshHost.name} (RDP)`,
      host: sshHost.address,
      port: RDP_DEFAULT_PORT,
      domain: '',
      username: sshHost.username,
      options: {}
    })
  } catch (err) {
    notify(err instanceof Error ? err.message : '连接 RDP 失败')
  }
}

async function handleInlineQuickConnect(): Promise<void> {
  if (!inlineQuick.host.trim()) {
    notify(t('rdpEditor.hostPlaceholder'))
    return
  }
  try {
    await connectRdpSession({
      kind: 'adhoc',
      name: `${inlineQuick.host.trim()}:${inlineQuick.port || RDP_DEFAULT_PORT}`,
      host: inlineQuick.host.trim(),
      port: Number(inlineQuick.port) || RDP_DEFAULT_PORT,
      domain: '',
      username: inlineQuick.username.trim(),
      ...(inlineQuick.password ? { password: inlineQuick.password } : {}),
      ...(inlineQuick.launchMode !== 'inherit' ? { launchModeOverride: inlineQuick.launchMode } : {}),
      options: {}
    })
  } catch (err) {
    notify(err instanceof Error ? err.message : '连接 RDP 失败')
  }
}

async function handleSaveEditor(input: RdpProfileInput, connectAfter: boolean): Promise<void> {
  editorBusy.value = true
  editorError.value = ''
  try {
    const savedList = await saveRdpProfile(input)
    editorOpen.value = false
    if (connectAfter) {
      const target =
        (input.id ? savedList.find((item) => item.id === input.id) : undefined) ??
        savedList.find((item) => item.name === input.name)
      if (target) {
        await connectRdpSession({
          kind: 'profile',
          profileId: target.id,
          ...(input.password && !input.savePassword ? { password: input.password } : {})
        })
      }
    }
  } catch (err) {
    editorError.value = err instanceof Error ? err.message : '保存远程桌面配置失败'
  } finally {
    editorBusy.value = false
  }
}

async function handleConnectQuickModal(payload: {
  name: string
  host: string
  port: number
  domain: string
  username: string
  password: string
  launchMode?: 'external' | 'embedded'
  resolutionMode: 'fit' | 'fixed'
  width: number
  height: number
  colorDepth: 16 | 24 | 32
  qualityPreset: 'lan' | 'balanced' | 'low'
  securityLayer: 'negotiate' | 'nla' | 'tls'
  certPolicy: 'tofu' | 'strict' | 'warn-allow'
  enableClipboard: boolean
  enableAudio: boolean
}): Promise<void> {
  editorBusy.value = true
  editorError.value = ''
  try {
    await connectRdpSession({
      kind: 'adhoc',
      name: payload.name,
      host: payload.host,
      port: payload.port,
      domain: payload.domain,
      username: payload.username,
      ...(payload.password ? { password: payload.password } : {}),
      ...(payload.launchMode ? { launchModeOverride: payload.launchMode } : {}),
      options: {
        resolutionMode: payload.resolutionMode,
        width: payload.width,
        height: payload.height,
        colorDepth: payload.colorDepth,
        qualityPreset: payload.qualityPreset,
        securityLayer: payload.securityLayer,
        certPolicy: payload.certPolicy,
        enableClipboard: payload.enableClipboard,
        enableAudio: payload.enableAudio
      }
    })
    editorOpen.value = false
  } catch (err) {
    editorError.value = err instanceof Error ? err.message : '连接失败'
  } finally {
    editorBusy.value = false
  }
}

async function handleDeleteProfile(profile: RdpProfile): Promise<void> {
  if (!window.confirm(t('remotePage.deleteConfirm', { name: profile.name }))) return
  await removeRdpProfile(profile.id)
}

async function handleSwitchSessionToEmbedded(session: RdpClientSession): Promise<void> {
  const prevProfileId = session.profileId
  const snapshotHost = session.host
  const snapshotPort = session.port
  const snapshotTitle = session.title
  const snapshotDomain = session.domain
  const snapshotUser = session.username
  await disconnectRdpSession(session.sessionId).catch(() => {})
  if (prevProfileId) {
    await connectRdpSession({
      kind: 'profile',
      profileId: prevProfileId,
      launchModeOverride: 'embedded'
    }).catch((err) => notify(err instanceof Error ? err.message : '切换失败'))
  } else {
    await connectRdpSession({
      kind: 'adhoc',
      name: snapshotTitle,
      host: snapshotHost,
      port: snapshotPort,
      domain: snapshotDomain,
      username: snapshotUser,
      launchModeOverride: 'embedded',
      options: {}
    }).catch((err) => notify(err instanceof Error ? err.message : '切换失败'))
  }
}

async function handleReconnectEmbedded(session: RdpClientSession): Promise<void> {
  await closeRdpSessionTab(session.sessionId)
  if (session.profileId) {
    await connectRdpSession({
      kind: 'profile',
      profileId: session.profileId,
      launchModeOverride: session.mode
    }).catch((err) => notify(err instanceof Error ? err.message : '重连失败'))
  } else {
    await connectRdpSession({
      kind: 'adhoc',
      name: session.title,
      host: session.host,
      port: session.port,
      domain: session.domain,
      username: session.username,
      launchModeOverride: session.mode,
      options: {}
    }).catch((err) => notify(err instanceof Error ? err.message : '重连失败'))
  }
}

async function copyInstallCommand(): Promise<void> {
  if (!rdpProbe.value.schemeAInstallHint) return
  await window.orbit.clipboard.writeText(rdpProbe.value.schemeAInstallHint)
  notify(rdpProbe.value.schemeAInstallHint)
}

function statusText(status: RdpClientSession['status']): string {
  if (status === 'active') return t('remotePage.statusActive')
  if (status === 'exited') return t('remotePage.statusExited')
  if (status === 'error') return t('remotePage.statusError')
  return t('remotePage.statusStarting')
}
</script>

<template>
  <section class="container_remote_page_shell_base" data-testid="remote-page">
    <aside class="container_remote_sidebar_panel_base">
      <div class="container_remote_sidebar_header_box">
        <span class="container_remote_sidebar_header_eyebrow">{{ t('remotePage.eyebrow') }}</span>
        <h2 class="container_remote_sidebar_header_title">{{ t('remotePage.title') }}</h2>
        <div class="container_remote_sidebar_actions_row">
          <button
            class="container_remote_sidebar_add_btn"
            type="button"
            data-testid="remote-add-profile-btn"
            @click="openAddModal()"
          >
            <Plus :size="14" />
            {{ t('remotePage.addProfile') }}
          </button>
          <button
            class="container_remote_sidebar_quick_btn"
            type="button"
            data-testid="remote-quick-connect-btn"
            @click="openQuickModal()"
          >
            <Zap :size="14" />
            {{ t('remotePage.quickConnect') }}
          </button>
        </div>
        <div class="container_remote_sidebar_filter_row">
          <input
            v-model="search"
            class="container_remote_sidebar_filter_input"
            type="search"
            :placeholder="t('remotePage.searchPlaceholder')"
          />
          <label class="container_remote_sidebar_fav_label">
            <input v-model="favoritesOnly" class="container_remote_sidebar_fav_check" type="checkbox" />
            {{ t('remotePage.favoritesOnly') }}
          </label>
        </div>
      </div>

      <div class="container_remote_sidebar_list_scroll">
        <div class="container_remote_group_saved_section">
          <h4 class="container_remote_group_saved_title">
            {{ t('remotePage.savedGroup', { count: filteredProfiles.length }) }}
          </h4>
          <p v-if="filteredProfiles.length === 0" class="container_remote_group_saved_empty">
            {{ t('remotePage.noSavedProfiles') }}
          </p>
          <div
            v-for="item in filteredProfiles"
            :key="item.id"
            :class="c('container_remote_card_saved_item', item.id)"
            :data-testid="`rdp-profile-card-${item.name}`"
          >
            <div :class="c('container_remote_card_saved_top', item.id)">
              <strong :class="c('container_remote_card_saved_name', item.id)">
                <Star v-if="item.favorite" :size="12" />
                {{ item.name }}
              </strong>
              <span :class="c('container_remote_card_saved_badge', item.id)">
                {{ profileModeLabel(item) }}
              </span>
            </div>
            <div :class="c('container_remote_card_saved_meta', item.id)">
              {{ item.username ? `${item.username}@` : '' }}{{ item.host }}:{{ item.port }}
            </div>
            <div :class="c('container_remote_card_saved_btns', item.id)">
              <button
                :class="c('container_remote_card_saved_connbtn', item.id)"
                type="button"
                @click="handleConnectProfile(item)"
              >
                {{ t('remotePage.connectBtn') }}
              </button>
              <button
                :class="c('container_remote_card_saved_editbtn', item.id)"
                type="button"
                @click="openEditModal(item)"
              >
                <Pencil :size="12" />
                {{ t('remotePage.editBtn') }}
              </button>
              <button
                :class="c('container_remote_card_saved_delbtn', item.id)"
                type="button"
                @click="handleDeleteProfile(item)"
              >
                <Trash2 :size="12" />
              </button>
            </div>
          </div>
        </div>

        <div class="container_remote_group_ssh_section">
          <h4 class="container_remote_group_ssh_title">
            {{ t('remotePage.sshGroup', { count: filteredSshHosts.length }) }}
          </h4>
          <p v-if="filteredSshHosts.length === 0" class="container_remote_group_ssh_empty">
            {{ t('remotePage.noSshHosts') }}
          </p>
          <div
            v-for="ssh in filteredSshHosts"
            :key="ssh.id"
            :class="c('container_remote_card_ssh_item', ssh.id)"
          >
            <div :class="c('container_remote_card_ssh_top', ssh.id)">
              <strong :class="c('container_remote_card_ssh_name', ssh.id)">
                <Server :size="12" />
                {{ ssh.name }}
              </strong>
              <span :class="c('container_remote_card_ssh_endpoint', ssh.id)">{{ ssh.address }}</span>
            </div>
            <div :class="c('container_remote_card_ssh_btns', ssh.id)">
              <button
                :class="c('container_remote_card_ssh_linkbtn', ssh.id)"
                type="button"
                :data-testid="`rdp-link-ssh-${ssh.name}`"
                @click="openAddModal(ssh)"
              >
                {{ t('remotePage.linkCreateBtn') }}
              </button>
              <button
                :class="c('container_remote_card_ssh_connbtn', ssh.id)"
                type="button"
                @click="handleQuickConnectFromSshHost(ssh)"
              >
                {{ t('remotePage.linkConnectBtn') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </aside>

    <div class="container_remote_stage_panel_base">
      <header class="container_remote_stage_banner_row">
        <div class="container_remote_stage_probe_group">
          <span class="container_remote_stage_mode_pill" data-testid="remote-global-mode-pill">
            {{ globalPreferredLabel }}
          </span>
          <span class="container_remote_stage_env_text">
            {{ rdpProbe.platform }} ({{ rdpProbe.displaySession }}) ·
            {{
              rdpProbe.schemeAAvailable
                ? `${t('settings.rdpProbeSchemeA')}: ${rdpProbe.schemeABinary}`
                : t('settings.rdpProbeMissing')
            }}
          </span>
        </div>
        <div class="container_remote_stage_banner_btns">
          <button
            v-if="rdpProbe.schemeAInstallHint"
            class="container_remote_stage_apt_btn"
            type="button"
            @click="copyInstallCommand"
          >
            <Copy :size="13" />
            {{ t('remotePage.copyAptBtn') }}
          </button>
          <button
            class="container_remote_stage_settings_btn"
            type="button"
            data-testid="remote-open-settings-btn"
            @click="openSettingsDomain('rdp')"
          >
            <Settings :size="13" />
            {{ t('remotePage.openRdpSettings') }}
          </button>
        </div>
      </header>

      <div
        v-if="needsMissingBanner"
        class="container_remote_missing_alert_banner"
        data-testid="remote-scheme-a-missing-banner"
      >
        <span class="container_remote_missing_alert_text">
          {{ rdpProbe.schemeAMissingReason }}
          <code v-if="rdpProbe.schemeAInstallHint" class="container_remote_missing_alert_code">
            {{ rdpProbe.schemeAInstallHint }}
          </code>
        </span>
        <button class="container_remote_missing_alert_btn" type="button" @click="openSettingsDomain('rdp')">
          {{ t('remotePage.missingBannerBtn') }}
        </button>
      </div>

      <p v-if="rdpConnectError" class="container_remote_error_strip_banner" role="alert">
        {{ rdpConnectError }}
      </p>

      <div v-if="rdpSessions.length > 0" class="container_remote_tabs_bar_row">
        <div
          v-for="tab in rdpSessions"
          :key="tab.sessionId"
          :class="c('container_remote_tabs_item_btn', tab.sessionId)"
          :aria-selected="tab.sessionId === currentRdpSession?.sessionId"
          role="tab"
          tabindex="0"
          @click="activeRdpSessionId = tab.sessionId"
          @keydown.enter="activeRdpSessionId = tab.sessionId"
        >
          <span :class="c('container_remote_tabs_scheme_tag', tab.sessionId)">
            {{ tab.mode === 'embedded' ? 'B' : 'A' }}
          </span>
          <span :class="c('container_remote_tabs_title_text', tab.sessionId)">{{ tab.title }}</span>
          <span :class="c('container_remote_tabs_status_dot', tab.sessionId)" :data-status="tab.status" />
          <button
            :class="c('container_remote_tabs_close_btn', tab.sessionId)"
            type="button"
            :aria-label="t('remotePage.tabClose', { name: tab.title })"
            @click.stop="closeRdpSessionTab(tab.sessionId)"
          >
            <X :size="12" />
          </button>
        </div>
      </div>

      <div v-if="currentRdpSession" class="container_remote_active_stage_body">
        <div
          v-if="currentRdpSession.fallbackFromExternal"
          class="container_remote_fallback_info_banner"
          data-testid="remote-fallback-banner"
        >
          {{ t('remotePage.fallbackNotice', { reason: currentRdpSession.fallbackReason ?? '' }) }}
        </div>

        <RdpEmbeddedCanvas
          v-if="currentRdpSession.mode === 'embedded'"
          :key="`${currentRdpSession.sessionId}-${sessionSeqMap[currentRdpSession.sessionId] ?? 0}`"
          :session="currentRdpSession"
          @state-change="(status, msg) => markRdpSessionStatus(currentRdpSession!.sessionId, status, msg)"
          @disconnect="disconnectRdpSession(currentRdpSession!.sessionId)"
          @reconnect="handleReconnectEmbedded(currentRdpSession!)"
        />

        <div v-else class="container_remote_external_card_panel" data-testid="rdp-external-session-card">
          <SquareTerminal :size="28" />
          <h3 class="container_remote_external_card_title">
            {{ t('remotePage.externalRunningTitle') }}
          </h3>
          <dl class="container_remote_external_card_meta">
            <dt class="container_remote_external_meta_keyhost">{{ t('remotePage.inlineHost') }}</dt>
            <dd class="container_remote_external_meta_valhost">
              {{ currentRdpSession.host }}:{{ currentRdpSession.port }}
            </dd>
            <dt class="container_remote_external_meta_keycmd">{{ t('remotePage.externalCommand') }}</dt>
            <dd class="container_remote_external_meta_valcmd">
              {{ currentRdpSession.externalCommand || 'system client' }}
            </dd>
            <dt class="container_remote_external_meta_keypid">{{ t('remotePage.externalPid') }}</dt>
            <dd class="container_remote_external_meta_valpid">
              {{ currentRdpSession.externalPid ?? '-' }}
            </dd>
            <dt class="container_remote_external_meta_keystate">{{ t('remotePage.externalStatus') }}</dt>
            <dd class="container_remote_external_meta_valstate">
              {{ statusText(currentRdpSession.status) }}
            </dd>
          </dl>
          <p v-if="currentRdpSession.lastError" class="container_remote_external_card_error">
            {{ currentRdpSession.lastError }}
          </p>
          <div class="container_remote_external_card_actions">
            <button
              class="container_remote_external_switch_btn"
              type="button"
              data-testid="rdp-switch-embedded-btn"
              @click="handleSwitchSessionToEmbedded(currentRdpSession)"
            >
              <RefreshCw :size="14" />
              {{ t('remotePage.switchToEmbeddedBtn') }}
            </button>
            <button
              v-if="currentRdpSession.status === 'active' || currentRdpSession.status === 'starting'"
              class="container_remote_external_stop_btn"
              type="button"
              data-testid="rdp-stop-external-btn"
              @click="disconnectRdpSession(currentRdpSession.sessionId)"
            >
              {{ t('remotePage.stopExternalBtn') }}
            </button>
          </div>
        </div>
      </div>

      <div v-else class="container_remote_empty_stage_panel">
        <Monitor :size="40" />
        <h3 class="container_remote_empty_stage_title">{{ t('remotePage.emptyTitle') }}</h3>
        <p class="container_remote_empty_stage_desc">{{ t('remotePage.emptyDesc') }}</p>

        <form class="container_remote_inline_quick_form" @submit.prevent="handleInlineQuickConnect">
          <label class="container_remote_inline_host_label">
            {{ t('remotePage.inlineHost') }}
            <input
              v-model="inlineQuick.host"
              class="container_remote_inline_host_input"
              data-testid="remote-inline-host"
              type="text"
              :placeholder="t('rdpEditor.hostPlaceholder')"
            />
          </label>
          <label class="container_remote_inline_port_label">
            {{ t('remotePage.inlinePort') }}
            <input
              v-model.number="inlineQuick.port"
              class="container_remote_inline_port_input"
              data-testid="remote-inline-port"
              type="number"
              min="1"
              max="65535"
            />
          </label>
          <label class="container_remote_inline_user_label">
            {{ t('remotePage.inlineUsername') }}
            <input
              v-model="inlineQuick.username"
              class="container_remote_inline_user_input"
              data-testid="remote-inline-user"
              type="text"
            />
          </label>
          <label class="container_remote_inline_pass_label">
            {{ t('remotePage.inlinePassword') }}
            <input
              v-model="inlineQuick.password"
              class="container_remote_inline_pass_input"
              data-testid="remote-inline-pass"
              type="password"
            />
          </label>
          <label class="container_remote_inline_mode_label">
            {{ t('remotePage.inlineMode') }}
            <select
              v-model="inlineQuick.launchMode"
              class="container_remote_inline_mode_select"
              data-testid="remote-inline-mode"
            >
              <option class="container_remote_inline_mode_optinh" value="inherit">
                {{ globalPreferredLabel }}
              </option>
              <option class="container_remote_inline_mode_optext" value="external">
                {{ t('remotePage.modeBadgeA') }}
              </option>
              <option class="container_remote_inline_mode_optemb" value="embedded">
                {{ t('remotePage.modeBadgeB') }}
              </option>
            </select>
          </label>
          <button
            class="container_remote_inline_connect_btn"
            type="submit"
            data-testid="remote-inline-connect-btn"
            :disabled="rdpConnecting"
          >
            {{ t('remotePage.inlineConnect') }}
          </button>
        </form>
      </div>
    </div>

    <RdpProfileEditor
      v-if="editorOpen"
      :mode="editorMode"
      :profile="editingProfile"
      :prefill-from-host="editorPrefillHost"
      :encryption-available="bootstrap?.encryptionAvailable ?? false"
      :encryption-backend="bootstrap?.encryptionBackend ?? 'unknown'"
      :busy="editorBusy"
      :error="editorError"
      @close="editorOpen = false"
      @save="handleSaveEditor"
      @connect-quick="handleConnectQuickModal"
    />

    <div
      v-if="activeRdpCertPrompt"
      class="container_remote_cert_backdrop_overlay"
      role="dialog"
      aria-modal="true"
      data-testid="rdp-cert-prompt-modal"
    >
      <div class="container_remote_cert_dialog_card" :data-mismatch="activeRdpCertPrompt.mismatch">
        <div class="container_remote_cert_header_row">
          <ShieldAlert v-if="activeRdpCertPrompt.mismatch" :size="20" />
          <ShieldCheck v-else :size="20" />
          <h3 class="container_remote_cert_header_title">
            {{
              activeRdpCertPrompt.mismatch
                ? t('remotePage.certMismatchTitle')
                : t('remotePage.certPromptTitle')
            }}
          </h3>
        </div>
        <p class="container_remote_cert_desc_text">
          {{
            activeRdpCertPrompt.mismatch
              ? t('remotePage.certMismatchDesc', {
                  host: activeRdpCertPrompt.host,
                  port: activeRdpCertPrompt.port
                })
              : t('remotePage.certUnknownDesc', {
                  host: activeRdpCertPrompt.host,
                  port: activeRdpCertPrompt.port
                })
          }}
        </p>
        <dl class="container_remote_cert_meta_list">
          <dt class="container_remote_cert_meta_dtsub">{{ t('remotePage.certSubject') }}</dt>
          <dd class="container_remote_cert_meta_ddsub">{{ activeRdpCertPrompt.subject }}</dd>
          <dt class="container_remote_cert_meta_dtiss">{{ t('remotePage.certIssuer') }}</dt>
          <dd class="container_remote_cert_meta_ddiss">{{ activeRdpCertPrompt.issuer }}</dd>
          <dt class="container_remote_cert_meta_dtval">{{ t('remotePage.certValidity') }}</dt>
          <dd class="container_remote_cert_meta_ddval">
            {{ activeRdpCertPrompt.validFrom }} → {{ activeRdpCertPrompt.validTo }}
          </dd>
          <template v-if="activeRdpCertPrompt.previousFingerprint">
            <dt class="container_remote_cert_meta_dtprev">{{ t('remotePage.certPrevious') }}</dt>
            <dd class="container_remote_cert_meta_prev">{{ activeRdpCertPrompt.previousFingerprint }}</dd>
          </template>
          <dt class="container_remote_cert_meta_dtfp">{{ t('remotePage.certFingerprint') }}</dt>
          <dd class="container_remote_cert_meta_fp" data-testid="rdp-cert-fingerprint">
            {{ activeRdpCertPrompt.fingerprint }}
          </dd>
        </dl>
        <div class="container_remote_cert_actions_row">
          <button
            class="container_remote_cert_reject_btn"
            type="button"
            data-testid="rdp-cert-reject-btn"
            @click="decideRdpCertPrompt(false)"
          >
            {{ t('remotePage.certReject') }}
          </button>
          <button
            class="container_remote_cert_accept_btn"
            type="button"
            data-testid="rdp-cert-accept-btn"
            @click="decideRdpCertPrompt(true)"
          >
            {{ t('remotePage.certTrust') }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
.container_remote_page_shell_base {
  flex: 1;
  min-height: 0;
  display: flex;
  background: var(--color-app-bg);
}
.container_remote_sidebar_panel_base {
  width: 300px;
  flex-shrink: 0;
  border-right: 1px solid var(--color-border);
  background: var(--color-surface-panel);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.container_remote_sidebar_header_box {
  padding: 16px 14px 12px;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.container_remote_sidebar_header_eyebrow {
  font-family: var(--font-term);
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--color-accent-secondary);
}
.container_remote_sidebar_header_title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--font-size-ui-lg);
  color: var(--color-text-heading);
}
.container_remote_sidebar_actions_row {
  display: flex;
  gap: 8px;
}
.container_remote_sidebar_add_btn,
.container_remote_sidebar_quick_btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 7px 8px;
  border-radius: 8px;
  font-size: var(--font-size-ui-xs);
}
.container_remote_sidebar_add_btn {
  border: 1px solid var(--color-accent-primary);
  background: var(--color-accent-primary-soft);
  color: var(--color-accent-primary-bright);
}
.container_remote_sidebar_quick_btn {
  border: 1px solid var(--color-border-control);
  background: var(--color-surface-1);
  color: var(--color-text-primary);
}
.container_remote_sidebar_filter_row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.container_remote_sidebar_fav_label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-ui-xs);
  color: var(--color-text-secondary);
}
.container_remote_sidebar_list_scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.container_remote_group_saved_title,
.container_remote_group_ssh_title {
  margin: 0 0 8px;
  font-size: var(--font-size-ui-xs);
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.container_remote_group_saved_empty,
.container_remote_group_ssh_empty {
  margin: 0;
  font-size: var(--font-size-ui-xs);
  color: var(--color-text-muted);
}
[class*='container_remote_card_saved_item'],
[class*='container_remote_card_ssh_item'] {
  padding: 10px;
  margin-bottom: 8px;
  border-radius: 10px;
  border: 1px solid var(--color-border-subtle);
  background: var(--color-surface-1);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
[class*='container_remote_card_saved_top'],
[class*='container_remote_card_ssh_top'] {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
[class*='container_remote_card_saved_name'],
[class*='container_remote_card_ssh_name'] {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--font-size-ui-sm);
  color: var(--color-text-heading);
}
[class*='container_remote_card_saved_badge'],
[class*='container_remote_card_ssh_endpoint'] {
  font-family: var(--font-term);
  font-size: 11px;
  color: var(--color-text-muted);
}
[class*='container_remote_card_saved_meta'] {
  font-family: var(--font-term);
  font-size: 11px;
  color: var(--color-text-secondary);
}
[class*='container_remote_card_saved_btns'],
[class*='container_remote_card_ssh_btns'] {
  display: flex;
  gap: 6px;
}
[class*='container_remote_card_saved_connbtn'],
[class*='container_remote_card_saved_editbtn'],
[class*='container_remote_card_saved_delbtn'],
[class*='container_remote_card_ssh_linkbtn'],
[class*='container_remote_card_ssh_connbtn'] {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--color-border-control);
  background: var(--color-surface-2);
  color: var(--color-text-primary);
  font-size: 12px;
}
[class*='container_remote_card_saved_connbtn'],
[class*='container_remote_card_ssh_connbtn'] {
  border-color: var(--color-accent-primary-ring);
  color: var(--color-accent-primary-bright);
}
.container_remote_stage_panel_base {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.container_remote_stage_banner_row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-card);
}
.container_remote_stage_probe_group,
.container_remote_stage_banner_btns {
  display: flex;
  align-items: center;
  gap: 8px;
}
.container_remote_stage_mode_pill {
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--color-accent-primary-ring);
  background: var(--color-accent-primary-soft);
  color: var(--color-accent-primary-bright);
  font-size: var(--font-size-ui-xs);
  font-weight: 600;
}
.container_remote_stage_env_text {
  font-family: var(--font-term);
  font-size: var(--font-size-ui-xs);
  color: var(--color-text-secondary);
}
.container_remote_stage_apt_btn,
.container_remote_stage_settings_btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border-radius: 7px;
  border: 1px solid var(--color-border-control);
  background: var(--color-surface-1);
  color: var(--color-text-primary);
  font-size: var(--font-size-ui-xs);
}
.container_remote_missing_alert_banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 16px;
  background: rgba(245, 158, 11, 0.14);
  border-bottom: 1px solid rgba(245, 158, 11, 0.35);
  color: #fde68a;
  font-size: var(--font-size-ui-xs);
}
.container_remote_missing_alert_code {
  margin-left: 8px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.35);
  font-family: var(--font-term);
}
.container_remote_missing_alert_btn {
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid rgba(245, 158, 11, 0.5);
  background: rgba(245, 158, 11, 0.18);
  color: #fef3c7;
  font-size: 12px;
}
.container_remote_error_strip_banner {
  margin: 0;
  padding: 8px 16px;
  background: rgba(239, 68, 68, 0.14);
  border-bottom: 1px solid rgba(239, 68, 68, 0.4);
  color: #fca5a5;
  font-size: var(--font-size-ui-xs);
  white-space: pre-wrap;
}
.container_remote_tabs_bar_row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px 0;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-panel);
  overflow-x: auto;
}
[class*='container_remote_tabs_item_btn'] {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 8px 8px 0 0;
  border: 1px solid transparent;
  color: var(--color-text-secondary);
  font-size: var(--font-size-ui-xs);
  cursor: pointer;
  &[aria-selected='true'] {
    background: var(--color-surface-canvas);
    border-color: var(--color-border);
    border-bottom-color: transparent;
    color: var(--color-text-heading);
  }
}
[class*='container_remote_tabs_scheme_tag'] {
  padding: 1px 5px;
  border-radius: 4px;
  font-family: var(--font-term);
  font-size: 10px;
  font-weight: 700;
  background: var(--color-accent-primary-soft);
  color: var(--color-accent-primary-bright);
}
[class*='container_remote_tabs_status_dot'] {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-text-muted);
  &[data-status='active'] {
    background: var(--color-success);
  }
  &[data-status='error'] {
    background: var(--color-error);
  }
}
[class*='container_remote_tabs_close_btn'] {
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  padding: 2px;
}
.container_remote_active_stage_body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.container_remote_fallback_info_banner {
  padding: 8px 16px;
  background: rgba(56, 189, 248, 0.12);
  border-bottom: 1px solid rgba(56, 189, 248, 0.35);
  color: #bae6fd;
  font-size: var(--font-size-ui-xs);
}
.container_remote_external_card_panel {
  margin: auto;
  width: min(560px, 90%);
  padding: 28px;
  border-radius: 14px;
  border: 1px solid var(--color-border-strong);
  background: var(--color-surface-card);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  text-align: center;
  color: var(--color-text-secondary);
}
.container_remote_external_card_title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--font-size-ui-lg);
  color: var(--color-text-heading);
}
.container_remote_external_card_meta {
  width: 100%;
  margin: 0;
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 6px 12px;
  text-align: left;
  font-size: var(--font-size-ui-xs);
}
[class*='container_remote_external_meta_key'] {
  color: var(--color-text-muted);
}
[class*='container_remote_external_meta_val'] {
  margin: 0;
  font-family: var(--font-term);
  color: var(--color-text-primary);
}
.container_remote_external_card_error {
  margin: 0;
  color: #fca5a5;
  font-size: var(--font-size-ui-xs);
}
.container_remote_external_card_actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
}
.container_remote_external_switch_btn,
.container_remote_external_stop_btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 8px;
  font-size: var(--font-size-ui-xs);
}
.container_remote_external_switch_btn {
  border: 1px solid var(--color-accent-primary);
  background: var(--color-accent-primary-soft);
  color: var(--color-accent-primary-bright);
}
.container_remote_external_stop_btn {
  border: 1px solid rgba(239, 68, 68, 0.45);
  background: rgba(239, 68, 68, 0.14);
  color: #fca5a5;
}
.container_remote_empty_stage_panel {
  margin: auto;
  width: min(640px, 92%);
  padding: 32px;
  border-radius: 16px;
  border: 1px solid var(--color-border);
  background: var(--color-surface-card);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: var(--color-text-secondary);
}
.container_remote_empty_stage_title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--font-size-ui-lg);
  color: var(--color-text-heading);
}
.container_remote_empty_stage_desc {
  margin: 0;
  text-align: center;
  font-size: var(--font-size-ui-sm);
  color: var(--color-text-muted);
}
.container_remote_inline_quick_form {
  width: 100%;
  margin-top: 8px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(175px, 1fr));
  gap: 10px;
  align-items: end;
}
.container_remote_inline_host_label,
.container_remote_inline_port_label,
.container_remote_inline_user_label,
.container_remote_inline_pass_label,
.container_remote_inline_mode_label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: var(--font-size-ui-xs);
  color: var(--color-text-secondary);
}
.container_remote_inline_connect_btn {
  padding: 9px 14px;
  border-radius: 8px;
  border: 1px solid var(--color-accent-primary);
  background: var(--color-accent-primary-soft);
  color: var(--color-accent-primary-bright);
  font-weight: 600;
}
.container_remote_cert_backdrop_overlay {
  position: fixed;
  inset: 0;
  z-index: 95;
  display: grid;
  place-items: center;
  background: rgba(5, 8, 13, 0.78);
  backdrop-filter: blur(6px);
}
.container_remote_cert_dialog_card {
  width: min(560px, 92vw);
  padding: 22px;
  border-radius: 14px;
  border: 1px solid var(--color-border-strong);
  background: var(--color-surface-card);
  box-shadow: var(--shadow-3d-lg);
  display: flex;
  flex-direction: column;
  gap: 12px;
  &[data-mismatch='true'] {
    border-color: rgba(239, 68, 68, 0.7);
  }
}
.container_remote_cert_header_row {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--color-warning);
}
.container_remote_cert_header_title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--font-size-ui-lg);
  color: var(--color-text-heading);
}
.container_remote_cert_desc_text {
  margin: 0;
  font-size: var(--font-size-ui-sm);
  color: var(--color-text-secondary);
}
.container_remote_cert_meta_list {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--color-border-subtle);
  background: var(--color-surface-1);
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: 6px 10px;
  font-size: var(--font-size-ui-xs);
}
[class*='container_remote_cert_meta_dt'] {
  color: var(--color-text-muted);
}
[class*='container_remote_cert_meta_dd'],
.container_remote_cert_meta_prev,
.container_remote_cert_meta_fp {
  margin: 0;
  font-family: var(--font-term);
  word-break: break-all;
  color: var(--color-text-primary);
}
.container_remote_cert_meta_prev {
  color: #fca5a5;
}
.container_remote_cert_actions_row {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
.container_remote_cert_reject_btn,
.container_remote_cert_accept_btn {
  padding: 8px 14px;
  border-radius: 8px;
  font-size: var(--font-size-ui-sm);
}
.container_remote_cert_reject_btn {
  border: 1px solid var(--color-border-control);
  background: var(--color-surface-1);
  color: var(--color-text-secondary);
}
.container_remote_cert_accept_btn {
  border: 1px solid var(--color-accent-primary);
  background: var(--color-accent-primary-soft);
  color: var(--color-accent-primary-bright);
  font-weight: 600;
}
</style>
