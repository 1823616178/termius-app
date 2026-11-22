<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  Cloud,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  KeyRound,
  Lock,
  Unlock,
  Copy,
  AlertTriangle,
  FolderKanban,
  Network,
  LogOut,
  HardDrive,
  Layers
} from '@lucide/vue'
import {
  isInsecureHttpSyncUrl,
  type SyncConflictResolutionItem,
  type SyncDevice,
  type SyncNamespace,
  type SyncRevisionInfo
} from '../../../shared/sync'
import OrbitCheckbox from '../components/OrbitCheckbox.vue'
import SyncConflictSection from '../components/SyncConflictSection.vue'
import SyncManageSection from '../components/SyncManageSection.vue'
import { locale, t } from '../services/i18n'
import {
  bootstrap,
  fileProfiles,
  hosts,
  knownRdpHosts,
  notify,
  page,
  rdpProfiles,
  setSyncWriteMode,
  syncGroups,
  syncStatus,
  syncTunnels,
  syncWriteMode
} from '../stores/workbench'

const busy = ref(false)
const actionError = ref('')
const pendingRecoveryKey = ref('')

const authMode = ref<'login' | 'register'>('login')
const serverUrl = ref('')
const allowInsecureHttp = ref(false)
const email = ref('')
const authPassword = ref('')
const inviteCode = ref('')
const rememberEmail = ref(true)
const keepSignedIn = ref(false)
const encryptionAvailable = ref(true)

const vaultMode = ref<'unlock' | 'recover'>('unlock')
const masterPassword = ref('')
const confirmMasterPassword = ref('')
const recoveryKeyInput = ref('')
const resetMasterPassword = ref('')
const recoverAccountPassword = ref('')

const rotateTarget = ref<'ssh' | 'files' | 'rdp' | null>(null)
const rotateMasterPassword = ref('')
const rotateAccountPassword = ref('')

const devices = ref<SyncDevice[]>([])
const revisions = ref<SyncRevisionInfo[]>([])
const selectedRevisionNamespace = ref<SyncNamespace>('core')
const manageLoading = ref(false)

const serverCapabilities = computed(
  () =>
    syncStatus.value?.serverCapabilities ?? {
      probed: false,
      legacyV1Only: true,
      maxSchemaVersion: 1,
      supportedNamespaces: ['core'] as SyncNamespace[],
      maxDocumentBytes: 2 * 1024 * 1024,
      supportsBatchVaultRotate: false
    }
)
const supportsProtocolsNamespace = computed(() =>
  serverCapabilities.value.supportedNamespaces.includes('protocols')
)
const supportsSettingsNamespace = computed(() =>
  serverCapabilities.value.supportedNamespaces.includes('settings')
)
const maxDocMiB = computed(() => (serverCapabilities.value.maxDocumentBytes / (1024 * 1024)).toFixed(0))

const phaseText = computed(() => {
  const phase = syncStatus.value?.phase
  if (phase === 'synced') return t('sync.phase.synced')
  if (phase === 'syncing') return t('sync.phase.syncing')
  if (phase === 'conflict') return t('sync.phase.conflict')
  if (phase === 'vault-locked') {
    return syncStatus.value?.vaultConfigured ? t('sync.phase.vaultLocked') : t('sync.phase.vaultUnconfigured')
  }
  if (phase === 'offline') return t('sync.phase.offline')
  if (phase === 'read-only-schema') return t('sync.phase.readOnly')
  if (phase === 'signed-out') return t('sync.phase.signedOut')
  if (phase === 'error') return t('sync.phase.error')
  return t('sync.phase.unconfigured')
})

const insecureHttpWarning = computed(() => isInsecureHttpSyncUrl(serverUrl.value))
const signedInInsecureHttp = computed(() =>
  Boolean(
    syncStatus.value?.signedIn &&
      syncStatus.value.serverUrl &&
      isInsecureHttpSyncUrl(syncStatus.value.serverUrl)
  )
)

watch(serverUrl, (next) => {
  if (!isInsecureHttpSyncUrl(next)) {
    allowInsecureHttp.value = false
  }
})

async function loadFormDefaults() {
  try {
    const defaults = await window.orbit.sync.getDefaults()
    if (!serverUrl.value) {
      serverUrl.value = defaults.serverUrl
      allowInsecureHttp.value = Boolean(defaults.allowInsecureHttp)
    }
    if (!email.value) email.value = defaults.email
    rememberEmail.value = defaults.rememberEmail
    keepSignedIn.value = defaults.keepSignedIn
    encryptionAvailable.value = defaults.encryptionAvailable
  } catch {
    /* optional form defaults */
  }
}

watch(
  () => page.value,
  (current) => {
    if (current === 'sync') {
      void loadFormDefaults()
      if (syncStatus.value?.signedIn) {
        void loadManageData()
      }
    }
  }
)

watch(
  () => syncStatus.value?.signedIn,
  (signedIn) => {
    if (signedIn && page.value === 'sync') {
      void loadManageData()
    }
  }
)

onMounted(() => {
  void loadFormDefaults()
  if (syncStatus.value?.signedIn) {
    void loadManageData()
  }
})

function formatIpcError(error: unknown): string {
  const en = locale.value === 'en-US'
  const raw = error instanceof Error ? error.message : String(error ?? (en ? 'Operation failed' : '操作失败'))
  const stripped = raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '').trim()
  if (stripped.startsWith('[')) {
    try {
      const issues = JSON.parse(stripped) as Array<{ message?: unknown }>
      const messages = issues
        .map((item) => (typeof item?.message === 'string' ? item.message : ''))
        .filter(Boolean)
      if (messages.length > 0) return messages.join(en ? '; ' : '；')
    } catch {
      /* Fallback to stripped text */
    }
  }
  return stripped || (en ? 'Operation failed' : '操作失败')
}

async function runAction(fn: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  actionError.value = ''
  try {
    await fn()
  } catch (error) {
    actionError.value = formatIpcError(error)
  } finally {
    busy.value = false
  }
}

async function handleAuthSubmit() {
  const en = locale.value === 'en-US'
  await runAction(async () => {
    const basePayload = {
      serverUrl: serverUrl.value,
      email: email.value,
      password: authPassword.value,
      rememberEmail: rememberEmail.value,
      keepSignedIn: keepSignedIn.value,
      ...(insecureHttpWarning.value ? { allowInsecureHttp: allowInsecureHttp.value } : {})
    }
    const next =
      authMode.value === 'register'
        ? await window.orbit.sync.register({
            ...basePayload,
            ...(inviteCode.value.trim() ? { inviteCode: inviteCode.value.trim() } : {})
          })
        : await window.orbit.sync.login(basePayload)
    syncStatus.value = next
    authPassword.value = ''
    inviteCode.value = ''
    notify(
      authMode.value === 'register'
        ? en
          ? 'Registered and signed in to sync account'
          : '已注册并登录同步账号'
        : en
          ? 'Signed in to sync account'
          : '已登录同步账号'
    )
    await loadManageData()
  })
}

async function handleLogout() {
  const en = locale.value === 'en-US'
  await runAction(async () => {
    syncStatus.value = await window.orbit.sync.logout()
    devices.value = []
    revisions.value = []
    selectedRevisionNamespace.value = 'core'
    pendingRecoveryKey.value = ''
    rotateTarget.value = null
    notify(en ? 'Signed out (local encrypted config retained)' : '已退出登录，本机加密配置仍保留')
    await loadFormDefaults()
  })
}

async function handleCreateVault() {
  const en = locale.value === 'en-US'
  await runAction(async () => {
    if (masterPassword.value !== confirmMasterPassword.value) {
      throw new Error(en ? 'Master passwords do not match' : '两次输入的主密码不一致')
    }
    const result = await window.orbit.sync.createVault({ masterPassword: masterPassword.value })
    syncStatus.value = result.status
    pendingRecoveryKey.value = result.recoveryKey
    masterPassword.value = ''
    confirmMasterPassword.value = ''
    notify(en ? 'Encrypted vault created and initial sync completed' : '端到端加密保管库已创建并完成初次同步')
    await loadManageData()
  })
}

async function handleUnlockVault() {
  const en = locale.value === 'en-US'
  await runAction(async () => {
    const status = await window.orbit.sync.unlockVault({ masterPassword: masterPassword.value })
    syncStatus.value = status
    masterPassword.value = ''
    notify(en ? 'Vault unlocked' : '保管库已解锁')
    await loadManageData()
  })
}

async function handleRecoverVault() {
  const en = locale.value === 'en-US'
  await runAction(async () => {
    const payload = resetMasterPassword.value
      ? {
          recoveryKey: recoveryKeyInput.value,
          newMasterPassword: resetMasterPassword.value,
          currentAccountPassword: recoverAccountPassword.value
        }
      : { recoveryKey: recoveryKeyInput.value }
    const status = await window.orbit.sync.recoverVault(payload)
    syncStatus.value = status
    recoveryKeyInput.value = ''
    resetMasterPassword.value = ''
    recoverAccountPassword.value = ''
    notify(en ? 'Vault unlocked via recovery key' : '已通过恢复密钥解锁保管库')
    await loadManageData()
  })
}

async function handleLockVault() {
  const en = locale.value === 'en-US'
  await runAction(async () => {
    syncStatus.value = await window.orbit.sync.lockVault()
    rotateTarget.value = null
    notify(en ? 'Vault locked and memory keys cleared' : '已立即锁定保管库并清除内存密钥')
  })
}

async function handleSyncNow() {
  const en = locale.value === 'en-US'
  await runAction(async () => {
    syncStatus.value = await window.orbit.sync.syncNow()
    notify(en ? 'Remote sync completed' : '远程同步完成')
    await loadManageData()
  })
}

async function handleResolveConflicts(resolutions: SyncConflictResolutionItem[]) {
  const en = locale.value === 'en-US'
  await runAction(async () => {
    syncStatus.value = await window.orbit.sync.resolveConflicts(resolutions)
    notify(en ? 'Conflicts resolved and synced' : '冲突已解决并完成同步')
    await loadManageData()
  })
}

async function handleToggleAutoSync() {
  if (!syncStatus.value) return
  await runAction(async () => {
    const res = await window.orbit.sync.updatePreferences({
      autoSync: !syncStatus.value!.autoSync
    })
    syncStatus.value = res.status
  })
}

async function handleToggleKeepSignedIn() {
  if (!syncStatus.value) return
  await runAction(async () => {
    const res = await window.orbit.sync.updatePreferences({
      keepSignedIn: !syncStatus.value!.keepSignedIn
    })
    syncStatus.value = res.status
  })
}

async function handleTogglePasswordSync() {
  if (!syncStatus.value) return
  if (!syncStatus.value.syncPasswords) {
    await runAction(async () => {
      const res = await window.orbit.sync.updatePreferences({ syncPasswords: true })
      syncStatus.value = res.status
      notify(
        locale.value === 'en-US'
          ? 'Enabled E2EE password sync and uploaded current host passwords'
          : '已开启密码加密同步并推送当前主机密码'
      )
    })
  } else {
    rotateTarget.value = rotateTarget.value === 'ssh' ? null : 'ssh'
  }
}

async function handleToggleFileCredsSync() {
  if (!syncStatus.value) return
  if (!syncStatus.value.syncFileCredentials) {
    await runAction(async () => {
      const res = await window.orbit.sync.updatePreferences({ syncFileCredentials: true })
      syncStatus.value = res.status
      notify(
        locale.value === 'en-US' ? 'Enabled E2EE File Server credential sync' : '已开启文件服务器凭据加密同步'
      )
    })
  } else if (!supportsProtocolsNamespace.value) {
    await runAction(async () => {
      const res = await window.orbit.sync.updatePreferences({ syncFileCredentials: false })
      syncStatus.value = res.status
    })
  } else {
    rotateTarget.value = rotateTarget.value === 'files' ? null : 'files'
  }
}

async function handleToggleRdpCredsSync() {
  if (!syncStatus.value) return
  if (!syncStatus.value.syncRdpCredentials) {
    await runAction(async () => {
      const res = await window.orbit.sync.updatePreferences({ syncRdpCredentials: true })
      syncStatus.value = res.status
      notify(
        locale.value === 'en-US' ? 'Enabled E2EE RDP password sync' : '已开启远程桌面（RDP）密码加密同步'
      )
    })
  } else if (!supportsProtocolsNamespace.value) {
    await runAction(async () => {
      const res = await window.orbit.sync.updatePreferences({ syncRdpCredentials: false })
      syncStatus.value = res.status
    })
  } else {
    rotateTarget.value = rotateTarget.value === 'rdp' ? null : 'rdp'
  }
}

async function handleToggleProtocolSettingsSync() {
  if (!syncStatus.value) return
  await runAction(async () => {
    const res = await window.orbit.sync.updatePreferences({
      syncProtocolSettings: !syncStatus.value!.syncProtocolSettings
    })
    syncStatus.value = res.status
  })
}

async function handleConfirmDisableCredentialSync() {
  if (!rotateTarget.value) return
  const en = locale.value === 'en-US'
  const target = rotateTarget.value
  await runAction(async () => {
    const payload =
      target === 'files'
        ? {
            syncFileCredentials: false,
            masterPassword: rotateMasterPassword.value,
            currentAccountPassword: rotateAccountPassword.value
          }
        : target === 'rdp'
          ? {
              syncRdpCredentials: false,
              masterPassword: rotateMasterPassword.value,
              currentAccountPassword: rotateAccountPassword.value
            }
          : {
              syncPasswords: false,
              masterPassword: rotateMasterPassword.value,
              currentAccountPassword: rotateAccountPassword.value
            }
    const res = await window.orbit.sync.updatePreferences(payload)
    syncStatus.value = res.status
    rotateMasterPassword.value = ''
    rotateAccountPassword.value = ''
    rotateTarget.value = null
    if (res.rotatedRecoveryKey) {
      pendingRecoveryKey.value = res.rotatedRecoveryKey
    }
    notify(
      en
        ? 'Disabled credential sync, rotated vault key, and uploaded clean document'
        : '已关闭凭据同步、轮换保管库密钥并上传剥离凭据后的文档'
    )
    await loadManageData()
  })
}

async function copyRecoveryKey() {
  if (!pendingRecoveryKey.value) return
  const en = locale.value === 'en-US'
  try {
    await window.orbit.clipboard.writeText(pendingRecoveryKey.value)
    notify(
      en ? 'Recovery key copied to clipboard; keep it safe offline' : '已复制恢复密钥到剪贴板，请离线保存'
    )
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : en ? 'Copy failed' : '复制失败'
  }
}

async function loadManageData() {
  if (!syncStatus.value?.signedIn) return
  manageLoading.value = true
  try {
    const ns = serverCapabilities.value.supportedNamespaces.includes(selectedRevisionNamespace.value)
      ? selectedRevisionNamespace.value
      : 'core'
    selectedRevisionNamespace.value = ns
    const [devList, revList] = await Promise.all([
      window.orbit.sync.listDevices().catch(() => []),
      window.orbit.sync.listRevisions(ns).catch(() => [])
    ])
    devices.value = devList
    revisions.value = revList
  } finally {
    manageLoading.value = false
  }
}

async function handleSelectRevisionNamespace(ns: SyncNamespace) {
  selectedRevisionNamespace.value = ns
  await loadManageData()
}

async function handleRevokeDevice(deviceId: string) {
  await runAction(async () => {
    devices.value = await window.orbit.sync.revokeDevice(deviceId)
    notify(locale.value === 'en-US' ? 'Device session revoked' : '已吊销目标设备会话')
  })
}

async function handleRestoreRevision(revision: string, namespace: SyncNamespace = 'core') {
  await runAction(async () => {
    syncStatus.value = await window.orbit.sync.restoreRevision(revision, namespace)
    notify(
      locale.value === 'en-US'
        ? `Restored ${namespace} revision from rev-${revision}`
        : `已回滚 ${namespace} 并生成新同步版本（源自 rev-${revision}）`
    )
    await loadManageData()
  })
}
</script>

<template>
  <section v-if="page === 'sync'" class="container_sync_page_body_base">
    <header class="container_sync_page_header_base">
      <div class="container_sync_page_header_info">
        <span class="container_sync_page_header_eyebrow">{{ t('sync.eyebrow') }}</span>
        <h2 class="container_sync_page_header_title">
          {{ t('sync.title') }}
          <span class="container_sync_page_header_badge" :data-phase="syncStatus?.phase ?? 'unconfigured'">
            {{ phaseText }}
          </span>
        </h2>
        <p class="container_sync_page_header_description">
          <template v-if="syncStatus?.lastSyncAt">
            {{
              t('sync.lastSyncMeta', {
                time: new Date(syncStatus.lastSyncAt).toLocaleString(locale),
                rev: syncStatus.lastRevision ?? '0'
              })
            }}
            <template v-if="syncStatus.pendingChanges">{{ t('sync.pendingMeta') }}</template>
          </template>
          <template v-else>
            {{ t('sync.defaultDesc') }}
          </template>
        </p>
      </div>
      <div class="container_sync_page_header_actions">
        <button
          v-if="syncStatus?.signedIn && syncStatus.vaultUnlocked"
          class="container_sync_page_header_run"
          type="button"
          data-primary
          :disabled="busy || syncStatus.phase === 'syncing' || syncStatus.readOnlyRemoteSchema"
          @click="handleSyncNow"
        >
          <RefreshCw :size="15" />
          {{ syncStatus.phase === 'syncing' ? t('status.syncing') : t('sync.syncNow') }}
        </button>
      </div>
    </header>

    <div v-if="actionError || syncStatus?.lastError" class="container_sync_alert_body_error" role="alert">
      <ShieldAlert :size="16" />
      <span class="container_sync_alert_body_error-text">{{ actionError || syncStatus?.lastError }}</span>
    </div>

    <div v-if="syncStatus?.readOnlyRemoteSchema" class="container_sync_alert_body_readonly" role="status">
      <AlertTriangle :size="16" />
      <span class="container_sync_alert_body_readonly-text">
        {{ t('sync.readonlyBanner', { version: syncStatus.remoteSchemaVersion ?? '' }) }}
      </span>
    </div>

    <div
      v-if="syncStatus?.signedIn"
      class="container_sync_servercap_body_banner"
      data-testid="sync-capability-banner"
      :data-mode="serverCapabilities.legacyV1Only ? 'legacy-v1' : 'multi-namespace'"
      role="status"
    >
      <Layers :size="16" />
      <div class="container_sync_servercap_body_copy">
        <strong class="container_sync_servercap_body_title">
          {{
            serverCapabilities.legacyV1Only
              ? t('sync.capBannerV1Title')
              : t('sync.capBannerV2Title', {
                  namespaces: serverCapabilities.supportedNamespaces.join(' · ')
                })
          }}
        </strong>
        <span class="container_sync_servercap_body_desc">
          {{
            serverCapabilities.legacyV1Only
              ? t('sync.capBannerV1Desc')
              : t('sync.capBannerV2Desc', {
                  maxMiB: maxDocMiB,
                  batch: serverCapabilities.supportsBatchVaultRotate
                    ? t('sync.capBatchYes')
                    : t('sync.capBatchNo'),
                  coreRev: syncStatus.namespaces?.core?.lastRevision ?? '0',
                  protoRev: syncStatus.namespaces?.protocols?.lastRevision ?? '0',
                  settingsRev: syncStatus.namespaces?.settings?.lastRevision ?? '0'
                })
          }}
        </span>
      </div>
    </div>

    <div v-if="pendingRecoveryKey" class="container_sync_recovery_body_banner" role="status">
      <div class="container_sync_recovery_body_head">
        <KeyRound :size="17" />
        <strong class="container_sync_recovery_body_title">{{ t('sync.recoveryTitle') }}</strong>
      </div>
      <p class="container_sync_recovery_body_hint">
        {{ t('sync.recoveryHint') }}
      </p>
      <div class="container_sync_recovery_body_code-row">
        <code class="container_sync_recovery_body_code">{{ pendingRecoveryKey }}</code>
        <button class="container_sync_recovery_body_copy" type="button" @click="copyRecoveryKey">
          <Copy :size="14" />
          {{ t('sync.copyRecoveryKey') }}
        </button>
        <button class="container_sync_recovery_body_dismiss" type="button" @click="pendingRecoveryKey = ''">
          {{ t('sync.dismissRecoveryKey') }}
        </button>
      </div>
    </div>

    <SyncConflictSection
      v-if="syncStatus?.conflicts.length"
      :conflicts="syncStatus.conflicts"
      :busy="busy"
      @resolve="handleResolveConflicts"
    />

    <div class="container_sync_grid_body_base">
      <section class="container_sync_account_body_card">
        <div class="container_sync_account_header_base">
          <Cloud :size="18" />
          <h3 class="container_sync_account_header_title">{{ t('sync.accountCardTitle') }}</h3>
        </div>

        <template v-if="!syncStatus?.signedIn">
          <div class="container_sync_account_body_tabs">
            <button
              class="container_sync_account_body_tab-login"
              type="button"
              :data-active="authMode === 'login' ? 'true' : 'false'"
              @click="authMode = 'login'"
            >
              {{ t('sync.tabLogin') }}
            </button>
            <button
              class="container_sync_account_body_tab-register"
              type="button"
              :data-active="authMode === 'register' ? 'true' : 'false'"
              @click="authMode = 'register'"
            >
              {{ t('sync.tabRegister') }}
            </button>
          </div>
          <form class="container_sync_account_body_form" @submit.prevent="handleAuthSubmit">
            <label class="container_sync_account_body_url-label">
              {{ t('sync.serverUrlLabel') }}
              <input
                v-model="serverUrl"
                class="container_sync_account_body_url-input"
                type="url"
                placeholder="https://sync.example.com"
                required
              />
            </label>
            <div v-if="insecureHttpWarning" class="container_sync_account_body_http-warn" role="alert">
              <div class="container_sync_account_body_http-warn-head">
                <AlertTriangle :size="15" />
                <strong class="container_sync_account_body_http-warn-title">
                  {{ t('sync.httpWarnTitle') }}
                </strong>
              </div>
              <p class="container_sync_account_body_http-warn-desc">
                {{ t('sync.httpWarnDesc') }}
              </p>
              <label class="container_sync_account_body_insecure-label">
                <OrbitCheckbox
                  v-model="allowInsecureHttp"
                  class="container_sync_account_body_insecure-check"
                  instance="sync-insecure-http"
                />
                {{ t('sync.allowHttpLabel') }}
              </label>
            </div>
            <label class="container_sync_account_body_email-label">
              {{ t('sync.emailLabel') }}
              <input
                v-model="email"
                class="container_sync_account_body_email-input"
                type="email"
                placeholder="name@example.com"
                required
              />
            </label>
            <label class="container_sync_account_body_password-label">
              {{ authMode === 'register' ? t('sync.pwRegisterLabel') : t('sync.pwLoginLabel') }}
              <input
                v-model="authPassword"
                class="container_sync_account_body_password-input"
                type="password"
                :minlength="authMode === 'register' ? 10 : 1"
                required
              />
            </label>
            <label v-if="authMode === 'register'" class="container_sync_account_body_invite-label">
              {{ t('sync.inviteLabel') }}
              <input
                v-model="inviteCode"
                class="container_sync_account_body_invite-input"
                type="text"
                minlength="8"
                maxlength="64"
                :placeholder="t('sync.invitePlaceholder')"
              />
            </label>
            <label class="container_sync_account_body_remember-label">
              <OrbitCheckbox
                v-model="rememberEmail"
                class="container_sync_account_body_remember-check"
                instance="sync-remember-email"
              />
              {{ t('sync.rememberEmail') }}
            </label>
            <label class="container_sync_account_body_keep-label">
              <OrbitCheckbox
                v-model="keepSignedIn"
                class="container_sync_account_body_keep-check"
                :disabled="!encryptionAvailable"
                instance="sync-keep-signed-in"
              />
              {{ encryptionAvailable ? t('sync.keepSignedInAvail') : t('sync.keepSignedInUnavail') }}
            </label>
            <button class="container_sync_account_body_submit" type="submit" data-primary :disabled="busy">
              {{
                busy
                  ? t('sync.connecting')
                  : authMode === 'register'
                    ? t('sync.registerAndConnect')
                    : t('sync.loginAndConnect')
              }}
            </button>
          </form>
        </template>

        <template v-else>
          <div v-if="signedInInsecureHttp" class="container_sync_account_body_http-active" role="status">
            <AlertTriangle :size="15" />
            <span class="container_sync_account_body_http-active-text">
              {{ t('sync.activeHttpWarn') }}
            </span>
          </div>
          <dl class="container_sync_account_body_meta">
            <dt class="container_sync_account_body_meta-url-label">{{ t('sync.metaServer') }}</dt>
            <dd class="container_sync_account_body_meta-url">{{ syncStatus.serverUrl }}</dd>
            <dt class="container_sync_account_body_meta-email-label">{{ t('sync.metaEmail') }}</dt>
            <dd class="container_sync_account_body_meta-email">{{ syncStatus.email }}</dd>
            <dt class="container_sync_account_body_meta-device-label">{{ t('sync.metaDevice') }}</dt>
            <dd class="container_sync_account_body_meta-device">
              {{ syncStatus.deviceName }} ({{ syncStatus.deviceId.slice(0, 8) }})
            </dd>
          </dl>
          <div class="container_sync_account_body_toggles">
            <label class="container_sync_account_body_autosync-label">
              <OrbitCheckbox
                class="container_sync_account_body_autosync-check"
                :model-value="syncStatus.autoSync"
                :disabled="busy"
                instance="sync-autosync"
                @change="handleToggleAutoSync"
              />
              {{ t('sync.autoSyncLabel') }}
            </label>
            <label class="container_sync_account_body_persist-label">
              <OrbitCheckbox
                class="container_sync_account_body_persist-check"
                :model-value="syncStatus.keepSignedIn"
                :disabled="busy || !encryptionAvailable"
                instance="sync-persist-session"
                @change="handleToggleKeepSignedIn"
              />
              {{ encryptionAvailable ? t('sync.keepSignedInLabel') : t('sync.keepSignedInUnavail') }}
            </label>
            <div class="container_sync_account_body_mode-row">
              <span class="container_sync_account_body_mode-label">{{ t('sync.writeModeLabel') }}</span>
              <button
                class="container_sync_account_body_mode-realtime"
                type="button"
                :data-active="syncWriteMode === 'realtime'"
                @click="setSyncWriteMode('realtime')"
              >
                {{ t('hosts.syncRealtime') }}
              </button>
              <button
                class="container_sync_account_body_mode-local"
                type="button"
                :data-active="syncWriteMode === 'local-only'"
                @click="setSyncWriteMode('local-only')"
              >
                {{ t('hosts.syncLocalOnly') }}
              </button>
            </div>
          </div>
          <button
            class="container_sync_account_body_logout"
            type="button"
            :disabled="busy"
            @click="handleLogout"
          >
            <LogOut :size="14" />
            {{ t('sync.logoutBtn') }}
          </button>
        </template>
      </section>

      <section class="container_sync_vault_body_card">
        <div class="container_sync_vault_header_base">
          <Lock v-if="!syncStatus?.vaultUnlocked" :size="18" />
          <Unlock v-else :size="18" />
          <h3 class="container_sync_vault_header_title">{{ t('sync.vaultTitle') }}</h3>
        </div>

        <p v-if="!syncStatus?.signedIn" class="container_sync_vault_body_placeholder">
          {{ t('sync.vaultNotSignedIn') }}
        </p>

        <template v-else-if="!syncStatus.vaultConfigured">
          <p class="container_sync_vault_body_hint">
            {{ t('sync.vaultCreateHint') }}
          </p>
          <form class="container_sync_vault_body_create-form" @submit.prevent="handleCreateVault">
            <label class="container_sync_vault_body_create-pw-label">
              {{ t('sync.masterPwLabel') }}
              <input
                v-model="masterPassword"
                class="container_sync_vault_body_create-pw-input"
                type="password"
                minlength="8"
                required
              />
            </label>
            <label class="container_sync_vault_body_create-confirm-label">
              {{ t('sync.confirmMasterPwLabel') }}
              <input
                v-model="confirmMasterPassword"
                class="container_sync_vault_body_create-confirm-input"
                type="password"
                minlength="8"
                required
              />
            </label>
            <button
              class="container_sync_vault_body_create-submit"
              type="submit"
              data-primary
              :disabled="busy"
            >
              {{ t('sync.createVaultBtn') }}
            </button>
          </form>
        </template>

        <template v-else-if="!syncStatus.vaultUnlocked">
          <div class="container_sync_vault_body_unlock-tabs">
            <button
              class="container_sync_vault_body_unlock-tab-pw"
              type="button"
              :data-active="vaultMode === 'unlock' ? 'true' : 'false'"
              @click="vaultMode = 'unlock'"
            >
              {{ t('sync.unlockTabPw') }}
            </button>
            <button
              class="container_sync_vault_body_unlock-tab-recovery"
              type="button"
              :data-active="vaultMode === 'recover' ? 'true' : 'false'"
              @click="vaultMode = 'recover'"
            >
              {{ t('sync.unlockTabRecovery') }}
            </button>
          </div>
          <form
            v-if="vaultMode === 'unlock'"
            key="unlock-form"
            class="container_sync_vault_body_unlock-form"
            @submit.prevent="handleUnlockVault"
          >
            <label class="container_sync_vault_body_unlock-pw-label">
              {{ t('sync.unlockPwLabel', { version: syncStatus.keyVersion }) }}
              <input
                v-model="masterPassword"
                class="container_sync_vault_body_unlock-pw-input"
                type="password"
                required
              />
            </label>
            <button
              class="container_sync_vault_body_unlock-submit"
              type="submit"
              data-primary
              :disabled="busy"
            >
              {{ t('sync.unlockBtn') }}
            </button>
          </form>
          <form
            v-else
            key="recover-form"
            class="container_sync_vault_body_recover-form"
            @submit.prevent="handleRecoverVault"
          >
            <label class="container_sync_vault_body_recover-key-label">
              {{ t('sync.recoveryKeyLabel') }}
              <input
                v-model="recoveryKeyInput"
                class="container_sync_vault_body_recover-key-input"
                type="text"
                placeholder="SPM1-..."
                required
              />
            </label>
            <label class="container_sync_vault_body_recover-newpw-label">
              {{ t('sync.resetMasterPwLabel') }}
              <input
                v-model="resetMasterPassword"
                class="container_sync_vault_body_recover-newpw-input"
                type="password"
                minlength="8"
              />
            </label>
            <label
              v-if="resetMasterPassword.length > 0"
              class="container_sync_vault_body_recover-acctpw-label"
            >
              {{ t('sync.recoverAccountPwLabel') }}
              <input
                v-model="recoverAccountPassword"
                class="container_sync_vault_body_recover-acctpw-input"
                type="password"
                required
              />
            </label>
            <button
              class="container_sync_vault_body_recover-submit"
              type="submit"
              data-primary
              :disabled="busy"
            >
              {{ t('sync.recoverBtn') }}
            </button>
          </form>
        </template>

        <template v-else>
          <dl class="container_sync_vault_body_active-meta">
            <dt class="container_sync_vault_body_id-label">{{ t('sync.vaultIdLabel') }}</dt>
            <dd class="container_sync_vault_body_id">{{ syncStatus.vaultId }}</dd>
            <dt class="container_sync_vault_body_kv-label">{{ t('sync.keyVersionLabel') }}</dt>
            <dd class="container_sync_vault_body_kv">v{{ syncStatus.keyVersion }}</dd>
          </dl>
          <label class="container_sync_vault_body_pwsync-label">
            <OrbitCheckbox
              class="container_sync_vault_body_pwsync-check"
              :model-value="syncStatus.syncPasswords && rotateTarget !== 'ssh'"
              :disabled="busy"
              instance="sync-pwsync"
              @change="handleTogglePasswordSync"
            />
            {{ t('sync.pwSyncLabel') }}
          </label>
          <label class="container_sync_vault_body_filecreds-label">
            <OrbitCheckbox
              class="container_sync_vault_body_filecreds-check"
              :model-value="syncStatus.syncFileCredentials && rotateTarget !== 'files'"
              :disabled="busy"
              instance="sync-filecreds"
              @change="handleToggleFileCredsSync"
            />
            {{ t('sync.fileCredsSyncLabel') }}
          </label>
          <label class="container_sync_vault_body_rdpcreds-label">
            <OrbitCheckbox
              class="container_sync_vault_body_rdpcreds-check"
              :model-value="syncStatus.syncRdpCredentials && rotateTarget !== 'rdp'"
              :disabled="busy"
              instance="sync-rdpcreds"
              @change="handleToggleRdpCredsSync"
            />
            {{ t('sync.rdpCredsSyncLabel') }}
          </label>
          <label class="container_sync_vault_body_protoset-label">
            <OrbitCheckbox
              class="container_sync_vault_body_protoset-check"
              :model-value="syncStatus.syncProtocolSettings"
              :disabled="busy || (!supportsSettingsNamespace && !syncStatus.syncProtocolSettings)"
              instance="sync-protoset"
              @change="handleToggleProtocolSettingsSync"
            />
            {{ t('sync.protoSettingsSyncLabel') }}
          </label>
          <div v-if="rotateTarget" class="container_sync_vault_body_rotate-box">
            <p class="container_sync_vault_body_rotate-hint">
              {{
                rotateTarget === 'files'
                  ? t('sync.rotateHintFile')
                  : rotateTarget === 'rdp'
                    ? t('sync.rotateHintRdp')
                    : t('sync.rotateHint')
              }}
            </p>
            <input
              v-model="rotateAccountPassword"
              class="container_sync_vault_body_rotate-acctpw-input"
              type="password"
              :placeholder="t('sync.rotateAcctPwPlaceholder')"
              :aria-label="t('sync.rotateAcctPwAria')"
            />
            <input
              v-model="rotateMasterPassword"
              class="container_sync_vault_body_rotate-input"
              type="password"
              :placeholder="t('sync.rotateMasterPwPlaceholder')"
              :aria-label="t('sync.rotateMasterPwAria')"
            />
            <div class="container_sync_vault_body_rotate-actions">
              <button
                class="container_sync_vault_body_rotate-confirm"
                type="button"
                data-primary
                :disabled="busy || rotateAccountPassword.length < 1 || rotateMasterPassword.length < 8"
                @click="handleConfirmDisableCredentialSync"
              >
                {{
                  rotateTarget === 'files'
                    ? t('sync.rotateConfirmFile')
                    : rotateTarget === 'rdp'
                      ? t('sync.rotateConfirmRdp')
                      : t('sync.rotateConfirm')
                }}
              </button>
              <button
                class="container_sync_vault_body_rotate-cancel"
                type="button"
                @click="rotateTarget = null"
              >
                {{ t('actionDialog.cancel') }}
              </button>
            </div>
          </div>
          <div class="container_sync_vault_body_capability">
            <ShieldCheck :size="15" />
            <span class="container_sync_vault_body_capability-text">
              {{ syncStatus.capabilities.keySyncReason }} ·
              {{
                encryptionAvailable
                  ? bootstrap?.platform === 'linux'
                    ? t('sync.capAvailLinux')
                    : t('sync.capAvailWin')
                  : t('sync.capUnavail')
              }}
            </span>
          </div>
          <button
            class="container_sync_vault_body_lock"
            type="button"
            :disabled="busy"
            @click="handleLockVault"
          >
            <Lock :size="14" />
            {{ t('sync.lockVaultBtn') }}
          </button>
        </template>
      </section>
    </div>

    <SyncManageSection
      v-if="syncStatus?.signedIn"
      :devices="devices"
      :revisions="revisions"
      :supported-namespaces="serverCapabilities.supportedNamespaces"
      :selected-namespace="selectedRevisionNamespace"
      :loading="manageLoading"
      :busy="busy"
      :vault-unlocked="Boolean(syncStatus.vaultUnlocked)"
      @refresh="loadManageData"
      @logout="handleLogout"
      @revoke-device="handleRevokeDevice"
      @restore-revision="handleRestoreRevision"
      @select-namespace="handleSelectRevisionNamespace"
    />

    <section class="container_sync_entities_body_section">
      <div class="container_sync_overview_card_hosts">
        <div class="container_sync_groups_header_base">
          <FolderKanban :size="17" />
          <h3 class="container_sync_groups_header_title">
            {{ t('sync.overviewHostsTitle', { count: syncGroups.length }) }}
          </h3>
        </div>
        <p class="container_sync_groups_body_hint">
          {{ t('sync.overviewHostsDesc', { hosts: hosts.length, groups: syncGroups.length }) }}
        </p>
        <div class="container_sync_overview_nav_actions">
          <button class="container_sync_overview_go_hosts" type="button" @click="page = 'hosts'">
            {{ t('sync.goHosts') }}
          </button>
          <button class="container_sync_overview_go_identities" type="button" @click="page = 'identities'">
            {{ t('sync.goIdentities') }}
          </button>
        </div>
      </div>

      <div class="container_sync_overview_card_tunnels">
        <div class="container_sync_tunnels_header_base">
          <Network :size="17" />
          <h3 class="container_sync_tunnels_header_title">
            {{ t('sync.overviewTunnelsTitle', { count: syncTunnels.length }) }}
          </h3>
        </div>
        <p class="container_sync_tunnels_body_hint">
          {{ t('sync.overviewTunnelsDesc') }}
        </p>
        <div class="container_sync_overview_tunnel_actions">
          <button
            class="container_sync_overview_go_tunnels"
            type="button"
            data-primary="true"
            @click="page = 'tunnels'"
          >
            {{ t('sync.goTunnels') }}
          </button>
        </div>
      </div>

      <div class="container_sync_overview_card_protocols">
        <div class="container_sync_protocols_header_base">
          <HardDrive :size="17" />
          <h3 class="container_sync_protocols_header_title">
            {{ t('sync.overviewProtocolsTitle', { count: fileProfiles.length + rdpProfiles.length }) }}
          </h3>
        </div>
        <p class="container_sync_protocols_body_hint">
          {{
            t('sync.overviewProtocolsDesc', {
              files: fileProfiles.length,
              rdp: rdpProfiles.length,
              certs: knownRdpHosts.length
            })
          }}
        </p>
        <div class="container_sync_overview_proto_actions">
          <button class="container_sync_overview_go_files" type="button" @click="page = 'files'">
            {{ t('sync.goFiles') }}
          </button>
          <button class="container_sync_overview_go_remote" type="button" @click="page = 'remote'">
            {{ t('sync.goRemote') }}
          </button>
        </div>
      </div>
    </section>
  </section>
</template>

<style scoped lang="scss">
.container_sync_page_body_base {
  padding: 36px;
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.container_sync_page_header_base {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 24px;
}
.container_sync_page_header_eyebrow {
  font-size: var(--font-size-ui-xs);
  letter-spacing: 1.5px;
  color: var(--color-accent-primary);
}
.container_sync_page_header_title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  font-family: var(--font-display);
  font-size: var(--font-size-ui-title);
  font-weight: var(--font-ui-heading-weight);
  color: var(--color-text-heading);
  margin: 10px 0;
}
.container_sync_page_header_badge {
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--color-border-control);
  background: var(--color-surface-elevated);
  color: var(--color-text-secondary);
  &[data-phase='synced'] {
    border-color: var(--color-success);
    color: var(--color-success);
    background: rgba(52, 211, 153, 0.12);
  }
  &[data-phase='conflict'],
  &[data-phase='error'] {
    border-color: #ef4444;
    color: #fca5a5;
    background: rgba(239, 68, 68, 0.14);
  }
  &[data-phase='vault-locked'],
  &[data-phase='offline'],
  &[data-phase='read-only-schema'] {
    border-color: var(--color-warning);
    color: var(--color-warning);
    background: rgba(251, 191, 36, 0.12);
  }
}
.container_sync_page_header_description {
  margin: 0;
  font-size: 13px;
  color: var(--color-text-muted);
}
.container_sync_page_header_run {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.container_sync_alert_body_error,
.container_sync_alert_body_readonly {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-radius: 10px;
  margin-bottom: 18px;
  font-size: 13px;
}
.container_sync_alert_body_error {
  border: 1px solid rgba(239, 68, 68, 0.45);
  background: rgba(239, 68, 68, 0.1);
  color: #fca5a5;
}
.container_sync_alert_body_readonly {
  border: 1px solid rgba(251, 191, 36, 0.45);
  background: rgba(251, 191, 36, 0.1);
  color: var(--color-warning);
}
.container_sync_servercap_body_banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 16px;
  border-radius: 10px;
  margin-bottom: 18px;
  font-size: 13px;
  border: 1px solid var(--color-border-control);
  background: var(--surface-card-gradient);
  &[data-mode='multi-namespace'] {
    border-color: rgba(52, 211, 153, 0.45);
    background: rgba(52, 211, 153, 0.08);
    color: var(--color-success);
  }
  &[data-mode='legacy-v1'] {
    border-color: rgba(251, 191, 36, 0.45);
    background: rgba(251, 191, 36, 0.08);
    color: var(--color-warning);
  }
}
.container_sync_servercap_body_copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.container_sync_servercap_body_title {
  font-size: 13px;
  font-weight: 600;
}
.container_sync_servercap_body_desc {
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.5;
}
.container_sync_recovery_body_banner {
  border: 1px solid var(--color-accent-primary-ring);
  background: linear-gradient(155deg, var(--color-accent-primary-soft), var(--color-surface-1));
  border-radius: 6px;
  padding: 16px 18px;
  margin-bottom: 20px;
  box-shadow: var(--shadow-3d-sm);
}
.container_sync_recovery_body_head {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-accent-primary);
}
.container_sync_recovery_body_hint {
  margin: 8px 0 12px;
  font-size: 12px;
  color: var(--color-text-secondary);
}
.container_sync_recovery_body_code-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.container_sync_recovery_body_code {
  flex: 1;
  min-width: 240px;
  padding: 8px 12px;
  border-radius: 6px;
  background: var(--color-surface-canvas);
  border: 1px solid var(--color-border-control);
  color: var(--color-text-primary);
  font-family: var(--font-mono);
  font-size: 12px;
  user-select: all;
}
.container_sync_recovery_body_copy {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.container_sync_grid_body_base {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  gap: 18px;
  margin-bottom: 20px;
  perspective: 1200px;
}
.container_sync_account_body_card,
.container_sync_vault_body_card,
.container_sync_groups_body_panel,
.container_sync_tunnels_body_panel {
  border: 1px solid var(--color-border-control);
  background: var(--surface-card-gradient);
  border-radius: 10px;
  padding: 20px;
  box-shadow: var(--shadow-3d-sm);
}
.container_sync_account_body_card,
.container_sync_vault_body_card {
  transition:
    box-shadow 180ms cubic-bezier(0.22, 1, 0.36, 1),
    border-color 140ms;
  &:hover {
    box-shadow: var(--shadow-3d-card);
    border-color: var(--color-accent-primary-ring);
  }
}
.container_sync_account_header_base,
.container_sync_vault_header_base,
.container_sync_groups_header_base,
.container_sync_tunnels_header_base,
.container_sync_protocols_header_base {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  color: var(--color-accent-primary);
}
.container_sync_account_header_title,
.container_sync_vault_header_title,
.container_sync_groups_header_title,
.container_sync_tunnels_header_title,
.container_sync_protocols_header_title {
  margin: 0;
  font-size: 15px;
  font-weight: 500;
  color: var(--color-text-primary);
}
.container_sync_account_body_tabs,
.container_sync_vault_body_unlock-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
}
.container_sync_account_body_tab-login,
.container_sync_account_body_tab-register,
.container_sync_vault_body_unlock-tab-pw,
.container_sync_vault_body_unlock-tab-recovery {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  &[data-active='true'] {
    border-color: var(--color-accent-primary);
    background: var(--color-accent-primary-soft);
    color: var(--color-text-primary);
  }
}
.container_sync_account_body_form,
.container_sync_vault_body_create-form,
.container_sync_vault_body_unlock-form,
.container_sync_vault_body_recover-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.container_sync_account_body_url-label,
.container_sync_account_body_email-label,
.container_sync_account_body_password-label,
.container_sync_account_body_invite-label,
.container_sync_vault_body_create-pw-label,
.container_sync_vault_body_create-confirm-label,
.container_sync_vault_body_unlock-pw-label,
.container_sync_vault_body_recover-key-label,
.container_sync_vault_body_recover-newpw-label,
.container_sync_vault_body_recover-acctpw-label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--color-text-secondary);
}
.container_sync_account_body_remember-label,
.container_sync_account_body_keep-label,
.container_sync_account_body_autosync-label,
.container_sync_account_body_persist-label,
.container_sync_vault_body_pwsync-label,
.container_sync_vault_body_filecreds-label,
.container_sync_vault_body_rdpcreds-label,
.container_sync_vault_body_protoset-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--color-text-secondary);
  margin-bottom: 6px;
  cursor: pointer;
}
.container_sync_account_body_http-warn,
.container_sync_account_body_http-active {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid rgba(251, 191, 36, 0.45);
  background: rgba(251, 191, 36, 0.08);
  color: var(--color-warning);
  font-size: 12px;
}
.container_sync_account_body_http-active {
  flex-direction: row;
  align-items: center;
  margin-bottom: 12px;
}
.container_sync_account_body_http-warn-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.container_sync_account_body_http-warn-desc {
  margin: 0;
  line-height: 1.5;
  color: var(--color-text-secondary);
}
.container_sync_account_body_insecure-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--color-text-primary);
  cursor: pointer;
}
.container_sync_account_body_meta,
.container_sync_vault_body_active-meta {
  display: grid;
  grid-template-columns: 92px 1fr;
  gap: 8px 12px;
  margin: 0 0 14px;
  font-size: 13px;
  dt {
    color: var(--color-text-muted);
  }
  dd {
    margin: 0;
    color: var(--color-text-primary);
    word-break: break-all;
  }
}
.container_sync_account_body_toggles {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 14px;
}
.container_sync_account_body_logout,
.container_sync_vault_body_lock {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.container_sync_vault_body_placeholder,
.container_sync_vault_body_hint,
.container_sync_groups_body_hint,
.container_sync_tunnels_body_hint,
.container_sync_protocols_body_hint {
  margin: 0 0 12px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-text-muted);
}
.container_sync_vault_body_rotate-box {
  margin: 12px 0;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid rgba(251, 191, 36, 0.4);
  background: rgba(251, 191, 36, 0.08);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.container_sync_vault_body_rotate-hint {
  margin: 0;
  font-size: 12px;
  color: var(--color-warning);
}
.container_sync_vault_body_rotate-actions {
  display: flex;
  gap: 8px;
}
.container_sync_vault_body_capability {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 14px 0;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-surface-canvas);
  font-size: 12px;
  color: var(--color-text-muted);
  line-height: 1.5;
}
.container_sync_entities_body_section {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  gap: 18px;
}
.container_sync_groups_body_form {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.container_sync_groups_body_color-input {
  width: 46px;
  padding: 3px;
}
.container_sync_groups_body_list,
.container_sync_tunnels_body_list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.container_sync_groups_body_item,
.container_sync_tunnels_body_item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-surface-canvas);
  font-size: 13px;
}
.container_sync_groups_body_swatch {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.container_sync_groups_body_item-name,
.container_sync_tunnels_body_item-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.container_sync_tunnels_body_item-route {
  font-size: 12px;
  color: var(--color-text-muted);
}
.container_sync_tunnels_body_form {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
  margin-bottom: 12px;
}
.container_sync_tunnels_body_submit {
  grid-column: 1 / -1;
}
.container_sync_account_body_mode-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 4px;
  button {
    min-height: 28px;
    padding: 4px 10px;
    font-size: 12px;
    border: 1px solid var(--color-border);
    &[data-active='true'] {
      background: var(--color-accent-primary-soft);
      border-color: var(--color-accent-primary-ring);
      color: var(--color-accent-primary-hover);
      font-weight: 600;
    }
  }
}
.container_sync_account_body_mode-label {
  font-size: 12px;
  color: var(--color-text-muted);
}
.container_sync_overview_card_hosts,
.container_sync_overview_card_tunnels,
.container_sync_overview_card_protocols {
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 16px;
  background: var(--surface-card-gradient);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.container_sync_overview_nav_actions,
.container_sync_overview_tunnel_actions,
.container_sync_overview_proto_actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: auto;
}
</style>
