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
  Laptop,
  History,
  FolderKanban,
  Network,
  LogOut,
  Check
} from 'lucide-vue-next'
import { instanceClass } from '../../../shared/classes'
import type { SyncDevice, SyncRevisionInfo } from '../../../shared/sync'
import {
  groupToken,
  hosts,
  notify,
  page,
  setSyncWriteMode,
  syncGroups,
  syncStatus,
  syncTunnels,
  syncWriteMode,
  windowInstance
} from '../stores/workbench'

const c = (base: string, id: string) => instanceClass(base, windowInstance(groupToken(`sync:${id}`)))

const busy = ref(false)
const actionError = ref('')
const pendingRecoveryKey = ref('')

const authMode = ref<'login' | 'register'>('login')
const serverUrl = ref('')
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

const rotateConfirmVisible = ref(false)
const rotateMasterPassword = ref('')
const rotateAccountPassword = ref('')

const conflictChoices = ref<Record<string, 'local' | 'remote'>>({})

const manageTab = ref<'devices' | 'revisions'>('devices')
const devices = ref<SyncDevice[]>([])
const revisions = ref<SyncRevisionInfo[]>([])
const manageLoading = ref(false)

const phaseText = computed(() => {
  const phase = syncStatus.value?.phase
  if (phase === 'synced') return '已同步'
  if (phase === 'syncing') return '同步中'
  if (phase === 'conflict') return '需要解决冲突'
  if (phase === 'vault-locked') return syncStatus.value?.vaultConfigured ? '保管库已锁定' : '待创建保管库'
  if (phase === 'offline') return '离线模式'
  if (phase === 'read-only-schema') return '高版本只读保护'
  if (phase === 'signed-out') return '未登录'
  if (phase === 'error') return '同步异常'
  return '未配置同步'
})

const allConflictsChosen = computed(() => {
  const list = syncStatus.value?.conflicts ?? []
  return list.length > 0 && list.every((item) => Boolean(conflictChoices.value[item.id]))
})

async function loadFormDefaults() {
  try {
    const defaults = await window.orbit.sync.getDefaults()
    if (!serverUrl.value) serverUrl.value = defaults.serverUrl
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

watch(
  () => syncStatus.value?.conflicts,
  (conflicts) => {
    const next: Record<string, 'local' | 'remote'> = {}
    for (const item of conflicts ?? []) {
      if (conflictChoices.value[item.id]) next[item.id] = conflictChoices.value[item.id]!
    }
    conflictChoices.value = next
  }
)

onMounted(() => {
  void loadFormDefaults()
})

function formatIpcError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '操作失败')
  const stripped = raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '').trim()
  if (stripped.startsWith('[')) {
    try {
      const issues = JSON.parse(stripped) as Array<{ message?: unknown }>
      const messages = issues
        .map((item) => (typeof item?.message === 'string' ? item.message : ''))
        .filter(Boolean)
      if (messages.length > 0) return messages.join('；')
    } catch {
      /* Fallback to stripped text */
    }
  }
  return stripped || '操作失败'
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
  await runAction(async () => {
    const basePayload = {
      serverUrl: serverUrl.value,
      email: email.value,
      password: authPassword.value,
      rememberEmail: rememberEmail.value,
      keepSignedIn: keepSignedIn.value
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
    notify(authMode.value === 'register' ? '已注册并登录同步账号' : '已登录同步账号')
    await loadManageData()
  })
}

async function handleLogout() {
  await runAction(async () => {
    syncStatus.value = await window.orbit.sync.logout()
    devices.value = []
    revisions.value = []
    pendingRecoveryKey.value = ''
    rotateConfirmVisible.value = false
    notify('已退出登录，本机加密配置仍保留')
    await loadFormDefaults()
  })
}

async function handleCreateVault() {
  await runAction(async () => {
    if (masterPassword.value !== confirmMasterPassword.value) {
      throw new Error('两次输入的主密码不一致')
    }
    const result = await window.orbit.sync.createVault({ masterPassword: masterPassword.value })
    syncStatus.value = result.status
    pendingRecoveryKey.value = result.recoveryKey
    masterPassword.value = ''
    confirmMasterPassword.value = ''
    notify('端到端加密保管库已创建并完成初次同步')
    await loadManageData()
  })
}

async function handleUnlockVault() {
  await runAction(async () => {
    const status = await window.orbit.sync.unlockVault({ masterPassword: masterPassword.value })
    syncStatus.value = status
    masterPassword.value = ''
    notify('保管库已解锁')
    await loadManageData()
  })
}

async function handleRecoverVault() {
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
    notify('已通过恢复密钥解锁保管库')
    await loadManageData()
  })
}

async function handleLockVault() {
  await runAction(async () => {
    syncStatus.value = await window.orbit.sync.lockVault()
    rotateConfirmVisible.value = false
    notify('已立即锁定保管库并清除内存密钥')
  })
}

async function handleSyncNow() {
  await runAction(async () => {
    syncStatus.value = await window.orbit.sync.syncNow()
    notify('远程同步完成')
    await loadManageData()
  })
}

function selectConflictChoice(conflictId: string, choice: 'local' | 'remote') {
  conflictChoices.value = { ...conflictChoices.value, [conflictId]: choice }
}

async function handleResolveConflicts() {
  await runAction(async () => {
    const resolutions = (syncStatus.value?.conflicts ?? []).map((item) => ({
      conflictId: item.id,
      choice: conflictChoices.value[item.id] ?? 'local'
    }))
    syncStatus.value = await window.orbit.sync.resolveConflicts(resolutions)
    notify('冲突已解决并完成同步')
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
      notify('已开启密码加密同步并推送当前主机密码')
    })
  } else {
    rotateConfirmVisible.value = !rotateConfirmVisible.value
  }
}

async function handleConfirmDisablePasswordSync() {
  await runAction(async () => {
    const res = await window.orbit.sync.updatePreferences({
      syncPasswords: false,
      masterPassword: rotateMasterPassword.value,
      currentAccountPassword: rotateAccountPassword.value
    })
    syncStatus.value = res.status
    rotateMasterPassword.value = ''
    rotateAccountPassword.value = ''
    rotateConfirmVisible.value = false
    if (res.rotatedRecoveryKey) {
      pendingRecoveryKey.value = res.rotatedRecoveryKey
    }
    notify('已关闭密码同步、轮换保管库密钥并上传剥离密码后的文档')
    await loadManageData()
  })
}

async function copyRecoveryKey() {
  if (!pendingRecoveryKey.value) return
  try {
    await window.orbit.clipboard.writeText(pendingRecoveryKey.value)
    notify('已复制恢复密钥到剪贴板，请离线保存')
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : '复制失败'
  }
}

async function loadManageData() {
  if (!syncStatus.value?.signedIn) return
  manageLoading.value = true
  try {
    const [devList, revList] = await Promise.all([
      window.orbit.sync.listDevices().catch(() => []),
      window.orbit.sync.listRevisions().catch(() => [])
    ])
    devices.value = devList
    revisions.value = revList
  } finally {
    manageLoading.value = false
  }
}

function switchManageTab(tab: 'devices' | 'revisions') {
  manageTab.value = tab
  void loadManageData()
}

async function handleRevokeDevice(deviceId: string) {
  await runAction(async () => {
    devices.value = await window.orbit.sync.revokeDevice(deviceId)
    notify('已吊销目标设备会话')
  })
}

async function handleRestoreRevision(revision: string) {
  await runAction(async () => {
    syncStatus.value = await window.orbit.sync.restoreRevision(revision)
    notify(`已回滚并生成新同步版本（源自 rev-${revision}）`)
    await loadManageData()
  })
}
</script>

<template>
  <section v-if="page === 'sync'" class="container_sync_page_body_base">
    <header class="container_sync_page_header_base">
      <div class="container_sync_page_header_info">
        <span class="container_sync_page_header_eyebrow">万里传书 · 玄密归真</span>
        <h2 class="container_sync_page_header_title">
          端到端加密远程同步
          <span class="container_sync_page_header_badge" :data-phase="syncStatus?.phase ?? 'unconfigured'">
            {{ phaseText }}
          </span>
        </h2>
        <p class="container_sync_page_header_description">
          <template v-if="syncStatus?.lastSyncAt">
            最近同步：{{ new Date(syncStatus.lastSyncAt).toLocaleString() }} · 版本 rev-{{
              syncStatus.lastRevision ?? '0'
            }}
            <template v-if="syncStatus.pendingChanges">· 有待上传本地变更</template>
          </template>
          <template v-else>
            本地优先，可离线使用；连接同步服务器并解锁保管库后自动使用 Argon2id + AES-256-GCM
            同步主机与隧道规则。
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
          {{ syncStatus.phase === 'syncing' ? '同步中…' : '立即同步' }}
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
        远端文档版本（schemaVersion={{
          syncStatus.remoteSchemaVersion
        }}）高于当前桌面客户端支持版本，已自动锁定写入以免丢失新版字段。请升级应用后再上传更改。
      </span>
    </div>

    <div v-if="pendingRecoveryKey" class="container_sync_recovery_body_banner" role="status">
      <div class="container_sync_recovery_body_head">
        <KeyRound :size="17" />
        <strong class="container_sync_recovery_body_title">一次性 SPM1 恢复密钥（关闭后不再显示）</strong>
      </div>
      <p class="container_sync_recovery_body_hint">
        如忘记主密码，可使用下方恢复密钥解封 Vault Key。请复制并存放在安全位置，切勿泄露给他人。
      </p>
      <div class="container_sync_recovery_body_code-row">
        <code class="container_sync_recovery_body_code">{{ pendingRecoveryKey }}</code>
        <button class="container_sync_recovery_body_copy" type="button" @click="copyRecoveryKey">
          <Copy :size="14" />
          复制恢复密钥
        </button>
        <button class="container_sync_recovery_body_dismiss" type="button" @click="pendingRecoveryKey = ''">
          我已保存，关闭
        </button>
      </div>
    </div>

    <section
      v-if="syncStatus?.conflicts.length"
      class="container_sync_conflict_body_section"
      aria-label="同步冲突处理"
    >
      <header class="container_sync_conflict_header_base">
        <h3 class="container_sync_conflict_header_title">
          检测到 {{ syncStatus.conflicts.length }} 处三方合并冲突
        </h3>
        <button
          class="container_sync_conflict_header_apply"
          type="button"
          data-primary
          :disabled="busy || !allConflictsChosen"
          @click="handleResolveConflicts"
        >
          <Check :size="14" />
          应用选择并完成同步
        </button>
      </header>
      <div class="container_sync_conflict_body_list">
        <article
          v-for="item in syncStatus.conflicts"
          :key="item.id"
          :class="c('container_sync_conflict_body_item', item.id)"
        >
          <div :class="c('container_sync_conflict_body_item-head', item.id)">
            <strong :class="c('container_sync_conflict_body_item-name', item.id)">
              {{ item.entityName }}
            </strong>
            <span :class="c('container_sync_conflict_body_item-field', item.id)">{{ item.fieldLabel }}</span>
          </div>
          <div :class="c('container_sync_conflict_body_choices', item.id)">
            <button
              :class="c('container_sync_conflict_body_choice-local', item.id)"
              type="button"
              :data-selected="conflictChoices[item.id] === 'local' ? 'true' : 'false'"
              @click="selectConflictChoice(item.id, 'local')"
            >
              保留本地：{{ item.localDisplay }}
            </button>
            <button
              :class="c('container_sync_conflict_body_choice-remote', item.id)"
              type="button"
              :data-selected="conflictChoices[item.id] === 'remote' ? 'true' : 'false'"
              @click="selectConflictChoice(item.id, 'remote')"
            >
              采用远端：{{ item.remoteDisplay }}
            </button>
          </div>
        </article>
      </div>
    </section>

    <div class="container_sync_grid_body_base">
      <section class="container_sync_account_body_card">
        <div class="container_sync_account_header_base">
          <Cloud :size="18" />
          <h3 class="container_sync_account_header_title">同步服务器与账号</h3>
        </div>

        <template v-if="!syncStatus?.signedIn">
          <div class="container_sync_account_body_tabs">
            <button
              class="container_sync_account_body_tab-login"
              type="button"
              :data-active="authMode === 'login' ? 'true' : 'false'"
              @click="authMode = 'login'"
            >
              登录已有账号
            </button>
            <button
              class="container_sync_account_body_tab-register"
              type="button"
              :data-active="authMode === 'register' ? 'true' : 'false'"
              @click="authMode = 'register'"
            >
              注册新账号
            </button>
          </div>
          <form class="container_sync_account_body_form" @submit.prevent="handleAuthSubmit">
            <label class="container_sync_account_body_url-label">
              同步服务地址（支持 HTTP / HTTPS）
              <input
                v-model="serverUrl"
                class="container_sync_account_body_url-input"
                type="url"
                placeholder="https://sync.example.com"
                required
              />
            </label>
            <label class="container_sync_account_body_email-label">
              账号邮箱
              <input
                v-model="email"
                class="container_sync_account_body_email-input"
                type="email"
                placeholder="name@example.com"
                required
              />
            </label>
            <label class="container_sync_account_body_password-label">
              {{
                authMode === 'register'
                  ? '账号密码（至少 10 位，仅用于服务端认证）'
                  : '账号密码（仅用于服务端认证，不用于数据加密）'
              }}
              <input
                v-model="authPassword"
                class="container_sync_account_body_password-input"
                type="password"
                :minlength="authMode === 'register' ? 10 : 1"
                required
              />
            </label>
            <label v-if="authMode === 'register'" class="container_sync_account_body_invite-label">
              注册邀请码（如服务端启用邀请制则必填）
              <input
                v-model="inviteCode"
                class="container_sync_account_body_invite-input"
                type="text"
                minlength="8"
                maxlength="64"
                placeholder="选填，至少 8 位"
              />
            </label>
            <label class="container_sync_account_body_remember-label">
              <input
                v-model="rememberEmail"
                class="container_sync_account_body_remember-check"
                type="checkbox"
              />
              记住邮箱（非敏感标识）
            </label>
            <label class="container_sync_account_body_keep-label">
              <input
                v-model="keepSignedIn"
                class="container_sync_account_body_keep-check"
                type="checkbox"
                :disabled="!encryptionAvailable"
              />
              保持登录状态（刷新令牌通过系统 DPAPI 加密保存）
            </label>
            <button class="container_sync_account_body_submit" type="submit" data-primary :disabled="busy">
              {{ busy ? '连接中…' : authMode === 'register' ? '注册并连接' : '登录并连接' }}
            </button>
          </form>
        </template>

        <template v-else>
          <dl class="container_sync_account_body_meta">
            <dt class="container_sync_account_body_meta-url-label">服务器</dt>
            <dd class="container_sync_account_body_meta-url">{{ syncStatus.serverUrl }}</dd>
            <dt class="container_sync_account_body_meta-email-label">账号邮箱</dt>
            <dd class="container_sync_account_body_meta-email">{{ syncStatus.email }}</dd>
            <dt class="container_sync_account_body_meta-device-label">当前设备</dt>
            <dd class="container_sync_account_body_meta-device">
              {{ syncStatus.deviceName }} ({{ syncStatus.deviceId.slice(0, 8) }})
            </dd>
          </dl>
          <div class="container_sync_account_body_toggles">
            <label class="container_sync_account_body_autosync-label">
              <input
                class="container_sync_account_body_autosync-check"
                type="checkbox"
                :checked="syncStatus.autoSync"
                :disabled="busy"
                @change="handleToggleAutoSync"
              />
              启用 3 秒防抖自动同步
            </label>
            <label class="container_sync_account_body_persist-label">
              <input
                class="container_sync_account_body_persist-check"
                type="checkbox"
                :checked="syncStatus.keepSignedIn"
                :disabled="busy || !encryptionAvailable"
                @change="handleToggleKeepSignedIn"
              />
              保持登录状态（刷新令牌与保管库解锁凭据由系统 DPAPI 记忆）
            </label>
            <div class="container_sync_account_body_mode-row">
              <span class="container_sync_account_body_mode-label">主机/规则变更策略：</span>
              <button
                class="container_sync_account_body_mode-realtime"
                type="button"
                :data-active="syncWriteMode === 'realtime'"
                @click="setSyncWriteMode('realtime')"
              >
                增删改实时同步到服务端
              </button>
              <button
                class="container_sync_account_body_mode-local"
                type="button"
                :data-active="syncWriteMode === 'local-only'"
                @click="setSyncWriteMode('local-only')"
              >
                仅保存在本地修改
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
            退出登录（保留本机主机数据）
          </button>
        </template>
      </section>

      <section class="container_sync_vault_body_card">
        <div class="container_sync_vault_header_base">
          <Lock v-if="!syncStatus?.vaultUnlocked" :size="18" />
          <Unlock v-else :size="18" />
          <h3 class="container_sync_vault_header_title">端到端加密保管库 (Vault)</h3>
        </div>

        <p v-if="!syncStatus?.signedIn" class="container_sync_vault_body_placeholder">
          请先在左侧登录同步账号，随后可在此创建或解锁端到端加密保管库。主密码仅留在本地派生密钥，绝不发送到服务端。
        </p>

        <template v-else-if="!syncStatus.vaultConfigured">
          <p class="container_sync_vault_body_hint">
            该账号尚未创建云端保管库。请设置至少 8 位主密码，客户端将使用 Argon2id + AES-256-GCM 包裹随机
            Vault Key，并生成一次性 SPM1 恢复密钥。
          </p>
          <form class="container_sync_vault_body_create-form" @submit.prevent="handleCreateVault">
            <label class="container_sync_vault_body_create-pw-label">
              设置保管库主密码
              <input
                v-model="masterPassword"
                class="container_sync_vault_body_create-pw-input"
                type="password"
                minlength="8"
                required
              />
            </label>
            <label class="container_sync_vault_body_create-confirm-label">
              确认保管库主密码
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
              创建加密保管库并上传初始文档
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
              主密码解锁
            </button>
            <button
              class="container_sync_vault_body_unlock-tab-recovery"
              type="button"
              :data-active="vaultMode === 'recover' ? 'true' : 'false'"
              @click="vaultMode = 'recover'"
            >
              SPM1 恢复密钥恢复
            </button>
          </div>
          <form
            v-if="vaultMode === 'unlock'"
            key="unlock-form"
            class="container_sync_vault_body_unlock-form"
            @submit.prevent="handleUnlockVault"
          >
            <label class="container_sync_vault_body_unlock-pw-label">
              保管库主密码（Vault v{{ syncStatus.keyVersion }}）
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
              解锁保管库并拉取同步
            </button>
          </form>
          <form
            v-else
            key="recover-form"
            class="container_sync_vault_body_recover-form"
            @submit.prevent="handleRecoverVault"
          >
            <label class="container_sync_vault_body_recover-key-label">
              SPM1 恢复密钥
              <input
                v-model="recoveryKeyInput"
                class="container_sync_vault_body_recover-key-input"
                type="text"
                placeholder="SPM1-..."
                required
              />
            </label>
            <label class="container_sync_vault_body_recover-newpw-label">
              重设主密码（可选，留空仅临时解锁）
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
              当前账号登录密码（重设主密码时用于更新云端信封）
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
              校验恢复密钥并解锁
            </button>
          </form>
        </template>

        <template v-else>
          <dl class="container_sync_vault_body_active-meta">
            <dt class="container_sync_vault_body_id-label">保管库 ID</dt>
            <dd class="container_sync_vault_body_id">{{ syncStatus.vaultId }}</dd>
            <dt class="container_sync_vault_body_kv-label">密钥版本</dt>
            <dd class="container_sync_vault_body_kv">v{{ syncStatus.keyVersion }}</dd>
          </dl>
          <label class="container_sync_vault_body_pwsync-label">
            <input
              class="container_sync_vault_body_pwsync-check"
              type="checkbox"
              :checked="syncStatus.syncPasswords && !rotateConfirmVisible"
              :disabled="busy"
              @change="handleTogglePasswordSync"
            />
            允许将主机保存密码纳入 E2EE 同步文档（默认关闭）
          </label>
          <div v-if="rotateConfirmVisible" class="container_sync_vault_body_rotate-box">
            <p class="container_sync_vault_body_rotate-hint">
              关闭密码同步将执行保管库密钥轮换（Vault Key
              Rotation）并上传剥离密码后的新版本文档，防止历史密文被旧密钥读取：
            </p>
            <input
              v-model="rotateAccountPassword"
              class="container_sync_vault_body_rotate-acctpw-input"
              type="password"
              placeholder="请输入当前账号登录密码（用于服务端身份校验）"
              aria-label="输入当前账号登录密码以确认密钥轮换"
            />
            <input
              v-model="rotateMasterPassword"
              class="container_sync_vault_body_rotate-input"
              type="password"
              placeholder="请输入保管库新主密码（至少 8 位，用于加密新密钥）"
              aria-label="输入保管库新主密码以加密新密钥"
            />
            <div class="container_sync_vault_body_rotate-actions">
              <button
                class="container_sync_vault_body_rotate-confirm"
                type="button"
                data-primary
                :disabled="busy || rotateAccountPassword.length < 1 || rotateMasterPassword.length < 8"
                @click="handleConfirmDisablePasswordSync"
              >
                确认轮换密钥并关闭密码同步
              </button>
              <button
                class="container_sync_vault_body_rotate-cancel"
                type="button"
                @click="rotateConfirmVisible = false"
              >
                取消
              </button>
            </div>
          </div>
          <div class="container_sync_vault_body_capability">
            <ShieldCheck :size="15" />
            <span class="container_sync_vault_body_capability-text">
              {{ syncStatus.capabilities.keySyncReason }} · 已启用本机 DPAPI
              解锁记忆，下次重启自动保持已解锁状态。
            </span>
          </div>
          <button
            class="container_sync_vault_body_lock"
            type="button"
            :disabled="busy"
            @click="handleLockVault"
          >
            <Lock :size="14" />
            立即锁定保管库
          </button>
        </template>
      </section>
    </div>

    <section v-if="syncStatus?.signedIn" class="container_sync_manage_body_section">
      <div class="container_sync_manage_header_base">
        <div class="container_sync_manage_header_tabs">
          <button
            class="container_sync_manage_header_tab-devices"
            type="button"
            :data-active="manageTab === 'devices' ? 'true' : 'false'"
            @click="switchManageTab('devices')"
          >
            <Laptop :size="15" />
            授权设备 ({{ devices.length }})
          </button>
          <button
            class="container_sync_manage_header_tab-revisions"
            type="button"
            :data-active="manageTab === 'revisions' ? 'true' : 'false'"
            @click="switchManageTab('revisions')"
          >
            <History :size="15" />
            历史版本 ({{ revisions.length }})
          </button>
        </div>
        <button
          class="container_sync_manage_header_refresh"
          type="button"
          :disabled="manageLoading"
          @click="loadManageData"
        >
          <RefreshCw :size="14" />
          刷新列表
        </button>
      </div>

      <div v-if="manageTab === 'devices'" class="container_sync_manage_body_devices">
        <p v-if="!devices.length" class="container_sync_manage_body_empty-devices">
          暂无服务端返回的设备会话信息。
        </p>
        <div v-else class="container_sync_manage_body_device-list">
          <div
            v-for="device in devices"
            :key="device.id"
            :class="c('container_sync_manage_body_device-row', device.id)"
          >
            <div :class="c('container_sync_manage_body_device-info', device.id)">
              <strong :class="c('container_sync_manage_body_device-name', device.id)">
                {{ device.name }}
                <template v-if="device.current">（当前设备）</template>
              </strong>
              <span :class="c('container_sync_manage_body_device-meta', device.id)">
                {{ device.platform }} · v{{ device.appVersion }} · 最近活跃：{{
                  new Date(device.lastSeenAt).toLocaleString()
                }}
              </span>
            </div>
            <button
              :class="c('container_sync_manage_body_device-revoke', device.id)"
              type="button"
              :disabled="busy"
              @click="device.current ? handleLogout() : handleRevokeDevice(device.id)"
            >
              {{ device.current ? '注销本机' : '下线该设备' }}
            </button>
          </div>
        </div>
      </div>

      <div v-else class="container_sync_manage_body_revisions">
        <p v-if="!revisions.length" class="container_sync_manage_body_empty-revisions">
          暂无历史版本记录。完成首次同步上传后会记录历史修订快照。
        </p>
        <div v-else class="container_sync_manage_body_revision-list">
          <div
            v-for="rev in revisions"
            :key="rev.revision"
            :class="c('container_sync_manage_body_revision-row', rev.revision)"
          >
            <div :class="c('container_sync_manage_body_revision-info', rev.revision)">
              <strong :class="c('container_sync_manage_body_revision-id', rev.revision)">
                rev-{{ rev.revision }} (v{{ rev.keyVersion }})
              </strong>
              <span :class="c('container_sync_manage_body_revision-meta', rev.revision)">
                {{ new Date(rev.createdAt).toLocaleString() }}
                <template v-if="rev.createdByDeviceName">· 设备 {{ rev.createdByDeviceName }}</template>
              </span>
            </div>
            <button
              :class="c('container_sync_manage_body_revision-restore', rev.revision)"
              type="button"
              :disabled="busy || !syncStatus.vaultUnlocked"
              @click="handleRestoreRevision(rev.revision)"
            >
              恢复此版本
            </button>
          </div>
        </div>
      </div>
    </section>

    <section class="container_sync_entities_body_section">
      <div class="container_sync_overview_card_hosts">
        <div class="container_sync_groups_header_base">
          <FolderKanban :size="17" />
          <h3 class="container_sync_groups_header_title">主机与同步分组 ({{ syncGroups.length }})</h3>
        </div>
        <p class="container_sync_groups_body_hint">
          当前已纳管 {{ hosts.length }} 台主机、{{ syncGroups.length }}
          个同步分组。分组筛选、增删与凭据管理已归位至「主机库」与左侧导航「凭据与分组」页面。
        </p>
        <div class="container_sync_overview_nav_actions">
          <button class="container_sync_overview_go_hosts" type="button" @click="page = 'hosts'">
            管理主机与分组
          </button>
          <button class="container_sync_overview_go_identities" type="button" @click="page = 'identities'">
            前往凭据与分组中心
          </button>
        </div>
      </div>

      <div class="container_sync_overview_card_tunnels">
        <div class="container_sync_tunnels_header_base">
          <Network :size="17" />
          <h3 class="container_sync_tunnels_header_title">端口转发与隧道规则 ({{ syncTunnels.length }})</h3>
        </div>
        <p class="container_sync_tunnels_body_hint">
          端口转发 (-L / -R / -D)、TCP
          连通探测与本地端口占用检测已接入「端口转发中心」、每台服务器行与终端工具栏。
        </p>
        <div class="container_sync_overview_tunnel_actions">
          <button
            class="container_sync_overview_go_tunnels"
            type="button"
            data-primary="true"
            @click="page = 'tunnels'"
          >
            打开端口转发中心
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
  font-size: 12px;
  letter-spacing: 1.5px;
  color: var(--color-accent-primary);
}
.container_sync_page_header_title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 22px;
  font-weight: 500;
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
.container_sync_conflict_body_section {
  border: 1px solid rgba(239, 68, 68, 0.4);
  background: var(--surface-card-gradient);
  border-radius: 10px;
  padding: 18px;
  margin-bottom: 20px;
}
.container_sync_conflict_header_base {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}
.container_sync_conflict_header_title {
  margin: 0;
  font-size: 15px;
  font-weight: 500;
}
.container_sync_conflict_header_apply {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.container_sync_conflict_body_list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.container_sync_conflict_body_item {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 12px;
  background: var(--color-surface-canvas);
}
.container_sync_conflict_body_item-head {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 13px;
}
.container_sync_conflict_body_item-field {
  color: var(--color-text-muted);
}
.container_sync_conflict_body_choices {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 8px;
}
.container_sync_conflict_body_choice-local,
.container_sync_conflict_body_choice-remote {
  text-align: left;
  font-size: 12px;
  &[data-selected='true'] {
    border-color: var(--color-accent-primary);
    background: var(--color-accent-primary-soft);
    color: var(--color-text-primary);
  }
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
.container_sync_manage_body_section,
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
.container_sync_tunnels_header_base {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  color: var(--color-accent-primary);
}
.container_sync_account_header_title,
.container_sync_vault_header_title,
.container_sync_groups_header_title,
.container_sync_tunnels_header_title {
  margin: 0;
  font-size: 15px;
  font-weight: 500;
  color: var(--color-text-primary);
}
.container_sync_account_body_tabs,
.container_sync_vault_body_unlock-tabs,
.container_sync_manage_header_tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
}
.container_sync_account_body_tab-login,
.container_sync_account_body_tab-register,
.container_sync_vault_body_unlock-tab-pw,
.container_sync_vault_body_unlock-tab-recovery,
.container_sync_manage_header_tab-devices,
.container_sync_manage_header_tab-revisions {
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
.container_sync_vault_body_pwsync-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--color-text-secondary);
}
.container_sync_account_body_remember-check,
.container_sync_account_body_keep-check,
.container_sync_account_body_autosync-check,
.container_sync_account_body_persist-check,
.container_sync_vault_body_pwsync-check {
  width: auto;
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
.container_sync_tunnels_body_hint {
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
.container_sync_manage_body_section {
  margin-bottom: 20px;
}
.container_sync_manage_header_base {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.container_sync_manage_header_refresh {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.container_sync_manage_body_device-list,
.container_sync_manage_body_revision-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.container_sync_manage_body_device-row,
.container_sync_manage_body_revision-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-surface-canvas);
}
.container_sync_manage_body_device-info,
.container_sync_manage_body_revision-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
}
.container_sync_manage_body_device-meta,
.container_sync_manage_body_revision-meta,
.container_sync_manage_body_empty-devices,
.container_sync_manage_body_empty-revisions {
  font-size: 12px;
  color: var(--color-text-muted);
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
.container_sync_overview_card_tunnels {
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 16px;
  background: var(--surface-card-gradient);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.container_sync_overview_nav_actions,
.container_sync_overview_tunnel_actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: auto;
}
</style>
