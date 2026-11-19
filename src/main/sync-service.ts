import { app, safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { AUTO_SYNC_RESUME_MS, resolveAutoSyncDelay } from './sync-schedule'
import { hostname } from 'node:os'
import type { Host, SyncDataUpdate } from '../shared/contracts'
import type { AllProtocolSettings, FileProfile, FileSecretsInput } from '../shared/files'
import type { KnownRdpHostEntry, RdpProfile } from '../shared/rdp'
import {
  DEFAULT_LEGACY_SERVER_CAPABILITIES,
  MAX_SYNC_ALLOWED_DOCUMENT_BYTES,
  MAX_SYNC_DOCUMENT_BYTES,
  SYNC_KEY_CAPABILITY_MESSAGE,
  SYNC_NAMESPACES,
  SYNC_NAMESPACE_SCHEMA_VERSION,
  SYNC_SCHEMA_VERSION,
  syncLoginInputSchema,
  syncPreferencesUpdateSchema,
  syncRegisterInputSchema,
  syncVaultCreateInputSchema,
  syncVaultRecoverInputSchema,
  syncVaultUnlockInputSchema,
  validateSyncServerUrl,
  type SyncConfigFormDefaults,
  type SyncConflict,
  type SyncConflictResolutionItem,
  type SyncDevice,
  type SyncDocumentEnvelope,
  type SyncGroup,
  type SyncLoginInput,
  type SyncNamespace,
  type SyncNamespaceState,
  type SyncPreferencesResult,
  type SyncPreferencesUpdate,
  type SyncRegisterInput,
  type SyncRevisionInfo,
  type SyncServerCapabilities,
  type SyncStatePhase,
  type SyncStatusSnapshot,
  type SyncTunnel,
  type SyncVaultCreateInput,
  type SyncVaultCreateResult,
  type SyncVaultRecoverInput,
  type SyncVaultUnlockInput,
  type VaultMetadataWire
} from '../shared/sync'
import type { DataClient } from './data-client'
import type {
  SyncAccountRecord,
  SyncEvaluateOutput,
  SyncEvaluateProtocolsOutput,
  SyncEvaluateSettingsOutput,
  SyncNamespaceRecord
} from '../workers/data-crypto/database'

const REQUEST_TIMEOUT_MS = 12_000
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}
const MAX_RETRY_429 = 2
const MAX_CONFLICT_RACE_RETRIES = 5

async function isSystemEncryptionAvailable(): Promise<boolean> {
  try {
    const available = await safeStorage.isAsyncEncryptionAvailable()
    if (!available) return false
    if (
      process.platform === 'linux' &&
      typeof safeStorage.getSelectedStorageBackend === 'function' &&
      safeStorage.getSelectedStorageBackend() === 'basic_text'
    ) {
      return false
    }
    return true
  } catch {
    return false
  }
}

function unavailableEncryptionMessage(actionText: string): string {
  if (process.platform === 'linux') {
    return `当前 Linux 系统未检测到可用的 Keyring（gnome-keyring / kwallet），${actionText}。`
  }
  return `系统凭据保护不可用，${actionText}。`
}

class SyncHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly retryAfterMs?: number
  ) {
    super(message)
  }
}

class SyncNetworkError extends Error {
  constructor(message: string) {
    super(message)
  }
}

interface PendingConflictContext {
  remoteEnvelope: SyncDocumentEnvelope | null
  remoteRevision: string | null
  remoteEtag: string | null
  conflicts: SyncConflict[]
}

export class SyncService {
  private account: SyncAccountRecord | undefined
  private namespaceRecords: Partial<Record<SyncNamespace, SyncNamespaceRecord>> = {}
  private serverCapabilities: SyncServerCapabilities = { ...DEFAULT_LEGACY_SERVER_CAPABILITIES }
  private accessToken: string | null = null
  private refreshToken: string | null = null
  private vaultMetadata: VaultMetadataWire | null = null
  private vaultUnlocked = false
  private syncing = false
  private offline = false
  private lastError: string | null = null
  private pendingConflict: PendingConflictContext | null = null
  private pendingNamespaceConflicts: Partial<Record<SyncNamespace, SyncConflict[]>> = {}
  private refreshPromise: Promise<void> | null = null
  private syncQueue: Promise<unknown> = Promise.resolve()
  private autoSyncRequest?: { immediate: boolean }
  private autoSyncTimer: NodeJS.Timeout | undefined
  private rerunRequested = false
  private localMutationEpoch = 0
  private disposed = false
  private uiBackgrounded = false
  private syncDeferredByBackground = false
  private syncDeferredImmediate = false
  private autoSyncNotBefore = 0

  constructor(
    private readonly repository: DataClient,
    private readonly emitStatus: (status: SyncStatusSnapshot) => void,
    private readonly emitData: (data: SyncDataUpdate) => void,
    private readonly onDiagnostic?: (message: string) => void
  ) {}

  async initFromDb(): Promise<void> {
    this.account = await this.repository.call<SyncAccountRecord | undefined>('syncAccountGet')
    await this.refreshNamespaceRecords()
    let unlocked = this.account?.vaultId ? await this.repository.call<boolean>('vaultHasUnlockedKey') : false
    if (!unlocked && this.account?.vaultId && this.account.encryptedVaultKey) {
      unlocked = await this.tryRestoreVaultKeyFromDisk()
    }
    this.vaultUnlocked = unlocked
  }

  private async refreshNamespaceRecords(): Promise<void> {
    const list = await this.repository.call<SyncNamespaceRecord[]>('syncNamespacesList')
    const next: Partial<Record<SyncNamespace, SyncNamespaceRecord>> = {}
    for (const item of list) {
      next[item.namespace] = item
    }
    this.namespaceRecords = next
  }

  private supportsNamespace(namespace: SyncNamespace): boolean {
    return this.serverCapabilities.supportedNamespaces.includes(namespace)
  }

  private getAllPendingConflicts(): SyncConflict[] {
    return [
      ...(this.pendingConflict?.conflicts ?? []),
      ...(this.pendingNamespaceConflicts.protocols ?? []),
      ...(this.pendingNamespaceConflicts.settings ?? [])
    ]
  }

  private clearAllPendingConflicts(): void {
    this.pendingConflict = null
    this.pendingNamespaceConflicts = {}
  }

  async resumeSession(): Promise<void> {
    if (this.disposed) return
    return this.runExclusive(async () => {
      if (this.disposed) return
      await this.initFromDb()
      const account = this.account
      if (!account || !account.keepSignedIn || !account.encryptedRefreshToken) {
        if (account?.encryptedRefreshToken && !account.keepSignedIn) {
          this.account = await this.repository.call<SyncAccountRecord>('syncAccountClearAuth')
        }
        this.emitStatus(this.buildStatus())
        return
      }
      try {
        validateSyncServerUrl(account.serverUrl, { allowInsecureHttp: account.allowInsecureHttp })
      } catch (error) {
        await this.clearLocalAuthState()
        this.lastError = error instanceof Error ? error.message : '同步服务器地址未通过安全校验，请重新登录。'
        this.emitStatus(this.buildStatus())
        return
      }
      try {
        const available = await isSystemEncryptionAvailable()
        if (!available) {
          this.account = await this.repository.call<SyncAccountRecord | undefined>('syncAccountClearAuth')
          this.lastError = '系统凭据保护不可用，请重新登录。'
          this.emitStatus(this.buildStatus())
          return
        }
        const decrypted = await safeStorage.decryptStringAsync(Buffer.from(account.encryptedRefreshToken))
        this.refreshToken = decrypted.result
        await this.refreshAccessTokenSingleFlight()
        await this.fetchMeAndVaultStatus()
        if (
          this.vaultUnlocked &&
          this.accessToken &&
          this.account?.autoSync &&
          this.account.writeMode !== 'local-only' &&
          !this.account.readOnlyRemoteSchema
        ) {
          await this.performSyncCycle()
        }
        this.offline = false
        this.lastError = null
      } catch (error) {
        if (error instanceof SyncNetworkError) {
          this.offline = true
          this.lastError = error.message
        } else if (error instanceof SyncHttpError && (error.status === 401 || error.status === 403)) {
          await this.clearLocalAuthState()
          this.lastError = '保持登录会话已失效，请重新登录。'
        } else {
          this.lastError = error instanceof Error ? error.message : '恢复同步会话失败'
          this.onDiagnostic?.(`resumeSession failed: ${this.lastError}`)
        }
      }
      this.emitStatus(this.buildStatus())
    })
  }

  async getStatus(): Promise<SyncStatusSnapshot> {
    if (!this.account) await this.initFromDb()
    return this.buildStatus()
  }

  async getDefaults(): Promise<SyncConfigFormDefaults> {
    if (!this.account) await this.initFromDb()
    const encryptionAvailable = await isSystemEncryptionAvailable()
    return {
      serverUrl: this.account?.serverUrl ?? '',
      allowInsecureHttp: this.account?.allowInsecureHttp ?? false,
      email: this.account?.rememberEmail ? (this.account.email ?? '') : '',
      rememberEmail: this.account?.rememberEmail ?? true,
      keepSignedIn: this.account?.keepSignedIn ?? false,
      encryptionAvailable
    }
  }

  async register(raw: SyncRegisterInput): Promise<SyncStatusSnapshot> {
    const input = syncRegisterInputSchema.parse(raw)
    return this.runExclusive(() => this.authenticate('register', input))
  }

  async login(raw: SyncLoginInput): Promise<SyncStatusSnapshot> {
    const input = syncLoginInputSchema.parse(raw)
    return this.runExclusive(() => this.authenticate('login', input))
  }

  async logout(): Promise<SyncStatusSnapshot> {
    return this.runExclusive(async () => {
      this.clearAutoSyncTimer()
      const current = this.account
      if (current?.serverUrl && this.accessToken) {
        try {
          await this.requestJson(current.serverUrl, '/api/v1/auth/logout', {
            method: 'POST',
            body: {},
            withAuth: true,
            allowRetryAuth: false
          })
        } catch {
          /* Best-effort remote revoke; local wipe is authoritative */
        }
      }
      await this.clearLocalAuthState()
      this.lastError = null
      this.offline = false
      const status = this.buildStatus()
      this.emitStatus(status)
      return status
    })
  }

  async createVault(raw: SyncVaultCreateInput): Promise<SyncVaultCreateResult> {
    const input = syncVaultCreateInputSchema.parse(raw)
    return this.runExclusive(async () => {
      this.requireSignedIn()
      const serverUrl = this.account!.serverUrl
      const existingRemote = await this.tryFetchVaultMetadata(serverUrl)
      if (existingRemote) {
        this.vaultMetadata = existingRemote
        throw new Error('云端已存在保管库，请使用主密码解锁或使用恢复密钥恢复。')
      }
      const created = await this.repository.call<{ envelope: VaultMetadataWire; recoveryKey: string }>(
        'vaultCreate',
        { keyVersion: 1, masterPassword: input.masterPassword }
      )
      let savedMeta: { id: string; keyVersion: number }
      try {
        savedMeta = await this.requestJson<{ id: string; keyVersion: number }>(serverUrl, '/api/v1/vault', {
          method: 'POST',
          headers: { 'Idempotency-Key': randomUUID() },
          body: created.envelope,
          withAuth: true
        })
      } catch (error) {
        await this.repository.call('vaultLock').catch(() => {})
        throw error
      }
      this.vaultMetadata = {
        ...created.envelope,
        id: savedMeta.id,
        keyVersion: savedMeta.keyVersion
      }
      this.account = await this.repository.call<SyncAccountRecord>('syncAccountUpsert', {
        serverUrl: this.account!.serverUrl,
        email: this.account!.email,
        rememberEmail: this.account!.rememberEmail,
        keepSignedIn: this.account!.keepSignedIn,
        autoSync: this.account!.autoSync,
        deviceId: this.account!.deviceId,
        deviceName: this.account!.deviceName,
        vaultId: savedMeta.id,
        keyVersion: savedMeta.keyVersion,
        resetSyncCursor: true
      })
      this.vaultUnlocked = true
      await this.persistUnlockedVaultKey()
      this.lastError = null
      await this.performSyncCycle()
      const status = this.buildStatus()
      this.emitStatus(status)
      return { status, recoveryKey: created.recoveryKey }
    })
  }

  async unlockVault(raw: SyncVaultUnlockInput): Promise<SyncStatusSnapshot> {
    const input = syncVaultUnlockInputSchema.parse(raw)
    return this.runExclusive(async () => {
      this.requireSignedIn()
      const metadata = await this.ensureVaultMetadata()
      await this.repository.call<boolean>('vaultUnlock', {
        metadata,
        masterPassword: input.masterPassword
      })
      this.vaultUnlocked = true
      this.account = await this.repository.call<SyncAccountRecord>('syncAccountGet')
      await this.persistUnlockedVaultKey()
      this.lastError = null
      await this.performSyncCycle()
      const status = this.buildStatus()
      this.emitStatus(status)
      return status
    })
  }

  async recoverVault(raw: SyncVaultRecoverInput): Promise<SyncStatusSnapshot> {
    const input = syncVaultRecoverInputSchema.parse(raw)
    return this.runExclusive(async () => {
      this.requireSignedIn()
      const metadata = await this.ensureVaultMetadata()
      const result = await this.repository.call<{ updatedEnvelope?: VaultMetadataWire }>('vaultRecover', {
        metadata,
        recoveryKey: input.recoveryKey,
        newMasterPassword: input.newMasterPassword
      })
      if (result.updatedEnvelope) {
        try {
          const { id: _ignoreId, ...envelopeFields } = result.updatedEnvelope
          const saved = await this.requestJson<VaultMetadataWire>(
            this.account!.serverUrl,
            '/api/v1/vault/key-envelope',
            {
              method: 'PUT',
              body: {
                currentPassword: input.currentAccountPassword,
                ...envelopeFields
              },
              withAuth: true
            }
          )
          this.vaultMetadata = { ...result.updatedEnvelope, ...saved, id: saved.id ?? metadata.id }
        } catch (error) {
          await this.repository.call('vaultLock').catch(() => {})
          this.vaultUnlocked = false
          throw error
        }
      }
      this.vaultUnlocked = true
      this.account = await this.repository.call<SyncAccountRecord>('syncAccountGet')
      await this.persistUnlockedVaultKey()
      this.lastError = null
      await this.performSyncCycle()
      const status = this.buildStatus()
      this.emitStatus(status)
      return status
    })
  }

  async lockVault(): Promise<SyncStatusSnapshot> {
    return this.runExclusive(async () => {
      this.clearAutoSyncTimer()
      await this.repository.call('vaultLock')
      if (this.account) {
        this.account = await this.repository.call<SyncAccountRecord>('syncAccountUpsert', {
          serverUrl: this.account.serverUrl,
          email: this.account.email,
          rememberEmail: this.account.rememberEmail,
          keepSignedIn: this.account.keepSignedIn,
          autoSync: this.account.autoSync,
          writeMode: this.account.writeMode,
          encryptedVaultKey: null,
          deviceId: this.account.deviceId,
          deviceName: this.account.deviceName
        })
      }
      this.vaultUnlocked = false
      this.clearAllPendingConflicts()
      this.lastError = null
      const status = this.buildStatus()
      this.emitStatus(status)
      return status
    })
  }

  async syncNow(): Promise<SyncStatusSnapshot> {
    return this.runExclusive(async () => {
      this.clearAutoSyncTimer()
      this.requireSignedIn()
      if (!this.vaultUnlocked) throw new Error('保管库未解锁，请先输入主密码解锁')
      if (this.getAllPendingConflicts().length > 0) {
        throw new Error('存在待处理的同步冲突，请先选择保留本地或远端版本')
      }
      await this.performSyncCycle()
      const status = this.buildStatus()
      this.emitStatus(status)
      return status
    })
  }

  async resolveConflicts(resolutions: SyncConflictResolutionItem[]): Promise<SyncStatusSnapshot> {
    return this.runExclusive(async () => {
      this.requireSignedIn()
      if (!this.vaultUnlocked) throw new Error('保管库未解锁')
      const resolutionMap: Record<string, 'local' | 'remote'> = {}
      for (const item of resolutions) {
        resolutionMap[item.conflictId] = item.choice
      }
      await this.performSyncCycle(resolutionMap)
      const status = this.buildStatus()
      this.emitStatus(status)
      return status
    })
  }

  async updatePreferences(raw: SyncPreferencesUpdate): Promise<SyncPreferencesResult> {
    const input = syncPreferencesUpdateSchema.parse(raw)
    return this.runExclusive(async () => {
      if (!this.account) await this.initFromDb()
      if (!this.account) throw new Error('请先登录同步账号')

      const prevSyncPasswords = this.account.syncPasswords
      const prevSyncFileCredentials = this.account.syncFileCredentials
      const prevSyncRdpCredentials = this.account.syncRdpCredentials
      const prevSyncProtocolSettings = this.account.syncProtocolSettings

      const nextSyncPasswords = input.syncPasswords ?? prevSyncPasswords
      const nextSyncFileCredentials = input.syncFileCredentials ?? prevSyncFileCredentials
      const nextSyncRdpCredentials = input.syncRdpCredentials ?? prevSyncRdpCredentials
      const nextSyncProtocolSettings = input.syncProtocolSettings ?? prevSyncProtocolSettings

      const protocolsSupported = this.supportsNamespace('protocols')
      const settingsSupported = this.supportsNamespace('settings')
      const disablingCorePasswords = input.syncPasswords === false && prevSyncPasswords
      const disablingFileCredentials =
        input.syncFileCredentials === false && prevSyncFileCredentials && protocolsSupported
      const disablingRdpCredentials =
        input.syncRdpCredentials === false && prevSyncRdpCredentials && protocolsSupported
      const requiresVaultKeyRotation =
        disablingCorePasswords || disablingFileCredentials || disablingRdpCredentials

      let rotatedRecoveryKey: string | undefined

      // Turning off any synced credential class triggers real Vault Key Rotation + stripped re-upload
      if (requiresVaultKeyRotation) {
        this.requireSignedIn()
        if (!this.vaultUnlocked) throw new Error('关闭凭据加密同步并轮换密钥前，请先解锁保管库')
        if (!input.masterPassword) {
          throw new Error('关闭凭据同步需要触发保管库密钥轮换，请输入保管库主密码以加密新密钥。')
        }
        if (!input.currentAccountPassword) {
          throw new Error('关闭凭据同步需要向服务端验证账号身份，请输入当前账号登录密码。')
        }
        const nextKeyVersion = (this.account.keyVersion ?? 1) + 1
        const plaintextPasswords = await this.decryptLocalHostPasswords()
        const plaintextFileSecrets = protocolsSupported ? await this.decryptLocalFileSecrets() : {}
        const plaintextRdpPasswords = protocolsSupported ? await this.decryptLocalRdpPasswords() : {}

        if (this.serverCapabilities.supportsBatchVaultRotate && protocolsSupported) {
          const includeNamespaces: SyncNamespace[] = ['core', 'protocols']
          if (settingsSupported && nextSyncProtocolSettings) includeNamespaces.push('settings')

          let prep:
            | {
                recoveryKey: string
                keyEnvelope: VaultMetadataWire
                envelopes: Partial<Record<SyncNamespace, SyncDocumentEnvelope>>
                nextBaseDocs: Partial<Record<SyncNamespace, string>>
              }
            | undefined
          try {
            prep = await this.repository.call('syncPrepareBatchRotate', {
              newKeyVersion: nextKeyVersion,
              masterPassword: input.masterPassword,
              syncPasswords: nextSyncPasswords,
              syncFileCredentials: nextSyncFileCredentials,
              syncRdpCredentials: nextSyncRdpCredentials,
              syncProtocolSettings: nextSyncProtocolSettings,
              includeNamespaces,
              maxDocumentBytes: this.serverCapabilities.maxDocumentBytes,
              plaintextPasswords,
              plaintextFileSecrets,
              plaintextRdpPasswords
            })
          } finally {
            wipePasswordMap(plaintextPasswords)
            wipeFileSecretMap(plaintextFileSecrets)
            wipePasswordMap(plaintextRdpPasswords)
          }

          try {
            const baseRevisions: Partial<Record<SyncNamespace, string>> = {}
            for (const ns of includeNamespaces) {
              const head = await this.fetchRemoteNamespaceDocument(this.account.serverUrl, ns)
              baseRevisions[ns] =
                head?.revision ??
                (ns === 'core' ? this.account.lastRevision : this.namespaceRecords[ns]?.lastRevision) ??
                '0'
            }
            const rotateRes = await this.requestJson<{
              id: string
              keyVersion: number
              revision: string | number
              revisions?: Partial<Record<SyncNamespace, string | number>>
              updatedAt: string
            }>(this.account.serverUrl, '/api/v1/vault/rotate', {
              method: 'POST',
              headers: {
                'Idempotency-Key': randomUUID(),
                'If-Match': formatRevisionIfMatch(baseRevisions.core ?? '0')
              },
              withAuth: true,
              body: {
                currentPassword: input.currentAccountPassword,
                keyEnvelope: prep!.keyEnvelope,
                document: prep!.envelopes.core,
                documents: prep!.envelopes,
                baseRevisions
              }
            })
            const coreRevStr = String(rotateRes.revisions?.core ?? rotateRes.revision)
            const coreBaseCipher = await this.encryptBaseDoc(prep!.nextBaseDocs.core ?? '')
            const committedNamespaces: Partial<
              Record<
                'protocols' | 'settings',
                { revision: string; etag: string | null; baseDocCipher: Uint8Array | null }
              >
            > = {}
            for (const ns of ['protocols', 'settings'] as const) {
              if (!includeNamespaces.includes(ns)) continue
              const nsRev = String(rotateRes.revisions?.[ns] ?? rotateRes.revision)
              committedNamespaces[ns] = {
                revision: nsRev,
                etag: formatRevisionIfMatch(nsRev),
                baseDocCipher: await this.encryptBaseDoc(prep!.nextBaseDocs[ns] ?? '')
              }
            }
            await this.repository.call('syncCommitBatchRotate', {
              keyVersion: rotateRes.keyVersion ?? nextKeyVersion,
              syncPasswords: nextSyncPasswords,
              syncFileCredentials: nextSyncFileCredentials,
              syncRdpCredentials: nextSyncRdpCredentials,
              coreRevision: coreRevStr,
              coreEtag: formatRevisionIfMatch(coreRevStr),
              coreBaseDocCipher: coreBaseCipher,
              namespaces: committedNamespaces
            })
            this.vaultMetadata = await this.tryFetchVaultMetadata(this.account.serverUrl)
            this.account = await this.repository.call<SyncAccountRecord>('syncAccountGet')
            await this.refreshNamespaceRecords()
            await this.persistUnlockedVaultKey()
            rotatedRecoveryKey = prep!.recoveryKey
          } catch (error) {
            await this.repository.call('syncCancelRotate').catch(() => {})
            throw error
          }
        } else {
          // Legacy v1 single-document vault rotate path (100% v1 wire-compatible)
          let prep: Awaited<ReturnType<SyncService['callPrepareRotate']>> | undefined
          try {
            prep = await this.callPrepareRotate(
              nextKeyVersion,
              input.masterPassword,
              nextSyncPasswords,
              plaintextPasswords
            )
          } finally {
            wipePasswordMap(plaintextPasswords)
            wipeFileSecretMap(plaintextFileSecrets)
            wipePasswordMap(plaintextRdpPasswords)
          }
          try {
            const currentHead = await this.fetchRemoteDocument(this.account.serverUrl)
            const baseRevision = currentHead?.revision ?? this.account.lastRevision ?? '0'
            const rotateRes = await this.requestJson<{
              id: string
              keyVersion: number
              revision: string | number
              updatedAt: string
            }>(this.account.serverUrl, '/api/v1/vault/rotate', {
              method: 'POST',
              headers: {
                'Idempotency-Key': randomUUID(),
                'If-Match': formatRevisionIfMatch(baseRevision)
              },
              withAuth: true,
              body: {
                currentPassword: input.currentAccountPassword,
                keyEnvelope: prep.keyEnvelope,
                document: prep.reencryptedEnvelope
              }
            })
            const baseCipher = await this.encryptBaseDoc(prep.nextBaseDocJson)
            const revStr = String(rotateRes.revision)
            await this.repository.call('syncCommitRotate', {
              keyVersion: rotateRes.keyVersion ?? nextKeyVersion,
              syncPasswords: nextSyncPasswords,
              revision: revStr,
              etag: formatRevisionIfMatch(revStr),
              baseDocCipher: baseCipher
            })
            this.vaultMetadata = await this.tryFetchVaultMetadata(this.account.serverUrl)
            this.account = await this.repository.call<SyncAccountRecord>('syncAccountGet')
            await this.persistUnlockedVaultKey()
            rotatedRecoveryKey = prep.recoveryKey
          } catch (error) {
            await this.repository.call('syncCancelRotate').catch(() => {})
            throw error
          }
        }
      }

      let nextEncryptedToken = this.account.encryptedRefreshToken ?? null
      if (input.keepSignedIn !== undefined) {
        if (!input.keepSignedIn) {
          nextEncryptedToken = null
        } else if (this.refreshToken) {
          if (!(await isSystemEncryptionAvailable())) {
            throw new Error(unavailableEncryptionMessage('无法保存保持登录状态'))
          }
          nextEncryptedToken = await safeStorage.encryptStringAsync(this.refreshToken)
        }
      }

      const enablingCorePasswords = input.syncPasswords === true && !prevSyncPasswords
      const enablingFileOrRdpCreds =
        (input.syncFileCredentials === true && !prevSyncFileCredentials) ||
        (input.syncRdpCredentials === true && !prevSyncRdpCredentials)
      const enablingProtocolSettings = input.syncProtocolSettings === true && !prevSyncProtocolSettings

      this.account = await this.repository.call<SyncAccountRecord>('syncAccountUpsert', {
        serverUrl: input.serverUrl ?? this.account.serverUrl,
        allowInsecureHttp:
          input.serverUrl !== undefined
            ? Boolean(input.allowInsecureHttp)
            : (input.allowInsecureHttp ?? this.account.allowInsecureHttp),
        email: this.account.email,
        rememberEmail: input.rememberEmail ?? this.account.rememberEmail,
        keepSignedIn: input.keepSignedIn ?? this.account.keepSignedIn,
        autoSync: input.autoSync ?? this.account.autoSync,
        writeMode: input.writeMode ?? this.account.writeMode,
        encryptedRefreshToken: nextEncryptedToken,
        deviceId: this.account.deviceId,
        deviceName: this.account.deviceName,
        syncPasswords: nextSyncPasswords,
        syncFileCredentials: nextSyncFileCredentials,
        syncRdpCredentials: nextSyncRdpCredentials,
        syncProtocolSettings: nextSyncProtocolSettings,
        pendingChanges: enablingCorePasswords ? true : this.account.pendingChanges
      })

      if (enablingFileOrRdpCreds) {
        await this.repository.call('syncNamespaceMarkPending', 'protocols')
      }
      if (enablingProtocolSettings) {
        await this.repository.call('syncNamespaceMarkPending', 'settings')
      }
      await this.refreshNamespaceRecords()

      const hasAnyPending =
        this.account.pendingChanges ||
        (protocolsSupported && Boolean(this.namespaceRecords.protocols?.pendingChanges)) ||
        (settingsSupported &&
          this.account.syncProtocolSettings &&
          Boolean(this.namespaceRecords.settings?.pendingChanges))

      if (
        (enablingCorePasswords ||
          (enablingFileOrRdpCreds && protocolsSupported) ||
          (enablingProtocolSettings && settingsSupported) ||
          (input.writeMode === 'realtime' && hasAnyPending)) &&
        this.vaultUnlocked &&
        this.accessToken
      ) {
        await this.performSyncCycle()
      }

      const status = this.buildStatus()
      this.emitStatus(status)
      return { status, rotatedRecoveryKey }
    })
  }

  async listDevices(): Promise<SyncDevice[]> {
    this.requireSignedIn()
    const res = await this.requestJson<{ items?: SyncDevice[]; devices?: SyncDevice[] } | SyncDevice[]>(
      this.account!.serverUrl,
      '/api/v1/devices',
      { method: 'GET', withAuth: true }
    )
    const list = Array.isArray(res) ? res : (res.items ?? res.devices ?? [])
    return list.map((d) => ({ ...d, current: Boolean(d.current || d.id === this.account?.deviceId) }))
  }

  async revokeDevice(deviceId: string): Promise<SyncDevice[]> {
    this.requireSignedIn()
    if (deviceId === this.account!.deviceId) {
      throw new Error('不能吊销当前正在使用的设备会话，请使用“退出登录”断开连接。')
    }
    await this.requestJson(this.account!.serverUrl, `/api/v1/devices/${encodeURIComponent(deviceId)}`, {
      method: 'DELETE',
      withAuth: true
    })
    return this.listDevices()
  }

  async listRevisions(namespace: SyncNamespace = 'core'): Promise<SyncRevisionInfo[]> {
    this.requireSignedIn()
    if (namespace !== 'core' && !this.supportsNamespace(namespace)) {
      return []
    }
    interface RawRevisionItem {
      revision: string | number
      schemaVersion: number
      keyVersion: number
      algorithm: string
      ciphertextHash: string
      createdAt: string
      createdByDevice?: { id?: string; name?: string } | string | null
    }
    const endpoint =
      namespace === 'core'
        ? '/api/v1/sync/revisions'
        : `/api/v1/sync/documents/${encodeURIComponent(namespace)}/revisions`
    const res = await this.requestJson<{ items?: RawRevisionItem[] }>(this.account!.serverUrl, endpoint, {
      method: 'GET',
      withAuth: true
    })
    const list = Array.isArray(res?.items) ? res.items : []
    return list.map((item) => {
      const dev = item.createdByDevice
      const devId = typeof dev === 'string' ? dev : (dev?.id ?? null)
      const devName = typeof dev === 'string' ? dev : (dev?.name ?? dev?.id ?? null)
      return {
        namespace,
        revision: String(item.revision),
        schemaVersion: item.schemaVersion,
        keyVersion: item.keyVersion,
        algorithm: item.algorithm,
        ciphertextHash: item.ciphertextHash,
        createdAt: item.createdAt,
        createdByDeviceId: devId,
        createdByDeviceName: devName
      }
    })
  }

  async restoreRevision(revision: string, namespace: SyncNamespace = 'core'): Promise<SyncStatusSnapshot> {
    return this.runExclusive(async () => {
      this.requireSignedIn()
      if (!this.vaultUnlocked) throw new Error('保管库未解锁')
      if (!/^\d+$/.test(revision)) throw new Error('无效的历史版本号')

      const serverUrl = this.account!.serverUrl
      if (namespace !== 'core') {
        if (!this.supportsNamespace(namespace)) {
          throw new Error(`当前同步服务器不支持命名空间 ${namespace} 的历史版本恢复`)
        }
        const head = await this.fetchRemoteNamespaceDocument(serverUrl, namespace)
        const baseRevision = head?.revision ?? this.namespaceRecords[namespace]?.lastRevision ?? '0'
        await this.requestJson<{
          revision: string | number
          restoredFromRevision: string
          updatedAt: string
        }>(
          serverUrl,
          `/api/v1/sync/documents/${encodeURIComponent(namespace)}/revisions/${encodeURIComponent(revision)}/restore`,
          {
            method: 'POST',
            headers: {
              'Idempotency-Key': randomUUID(),
              'If-Match': formatRevisionIfMatch(baseRevision)
            },
            body: {},
            withAuth: true
          }
        )
        const restoredRemote = await this.fetchRemoteNamespaceDocument(serverUrl, namespace)
        if (!restoredRemote) {
          throw new Error('历史版本恢复后拉取远端文档失败')
        }
        if (namespace === 'protocols') {
          const plaintextFileSecrets = await this.decryptLocalFileSecrets()
          const plaintextRdpPasswords = await this.decryptLocalRdpPasswords()
          let evaluated: SyncEvaluateProtocolsOutput
          try {
            evaluated = await this.repository.call<SyncEvaluateProtocolsOutput>(
              'syncEvaluateNamespaceRevisionRestore',
              {
                namespace: 'protocols',
                plaintextFileSecrets,
                plaintextRdpPasswords,
                revisionEnvelope: restoredRemote.envelope
              }
            )
          } finally {
            wipeFileSecretMap(plaintextFileSecrets)
            wipePasswordMap(plaintextRdpPasswords)
          }
          const committed = await this.commitProtocolsEvaluationToLocal(
            evaluated,
            restoredRemote.revision,
            restoredRemote.etag
          )
          if (committed) await this.emitUnifiedDataUpdate({ protocols: committed })
          delete this.pendingNamespaceConflicts.protocols
        } else {
          const evaluated = await this.repository.call<SyncEvaluateSettingsOutput>(
            'syncEvaluateNamespaceRevisionRestore',
            {
              namespace: 'settings',
              revisionEnvelope: restoredRemote.envelope
            }
          )
          const committed = await this.commitSettingsEvaluationToLocal(
            evaluated,
            restoredRemote.revision,
            restoredRemote.etag
          )
          if (committed) await this.emitUnifiedDataUpdate({ settings: committed })
          delete this.pendingNamespaceConflicts.settings
        }
        await this.refreshNamespaceRecords()
        this.lastError = null
        const status = this.buildStatus()
        this.emitStatus(status)
        return status
      }

      const head = await this.fetchRemoteDocument(serverUrl)
      const baseRevision = head?.revision ?? this.account?.lastRevision ?? '0'
      await this.requestJson<{ revision: string | number; restoredFromRevision: string; updatedAt: string }>(
        serverUrl,
        `/api/v1/sync/revisions/${encodeURIComponent(revision)}/restore`,
        {
          method: 'POST',
          headers: {
            'Idempotency-Key': randomUUID(),
            'If-Match': formatRevisionIfMatch(baseRevision)
          },
          body: {},
          withAuth: true
        }
      )

      const restoredRemote = await this.fetchRemoteDocument(serverUrl)
      if (!restoredRemote) {
        throw new Error('历史版本恢复后拉取远端文档失败')
      }

      const plaintextPasswords = await this.decryptLocalHostPasswords()
      let evaluated: SyncEvaluateOutput
      try {
        evaluated = await this.repository.call<SyncEvaluateOutput>('syncEvaluateRevisionRestore', {
          plaintextPasswords,
          revisionEnvelope: restoredRemote.envelope
        })
      } finally {
        wipePasswordMap(plaintextPasswords)
      }

      const committed = await this.commitEvaluationToLocal(
        evaluated,
        restoredRemote.revision,
        restoredRemote.etag
      )
      if (committed) await this.emitUnifiedDataUpdate({ core: committed })
      this.pendingConflict = null
      this.lastError = null
      const status = this.buildStatus()
      this.emitStatus(status)
      return status
    })
  }

  /** Record a local database mutation so in-flight sync commits never clobber newer local rows. */
  markLocalMutation(): void {
    this.localMutationEpoch += 1
  }

  setUiBackgrounded(backgrounded: boolean): void {
    if (this.disposed || this.uiBackgrounded === backgrounded) return
    this.uiBackgrounded = backgrounded
    if (backgrounded) {
      if (this.autoSyncRequest) {
        this.syncDeferredByBackground = true
        this.syncDeferredImmediate ||= this.autoSyncRequest.immediate
        this.clearAutoSyncTimer()
      }
      return
    }
    this.autoSyncNotBefore = performance.now() + AUTO_SYNC_RESUME_MS
    if (!this.syncDeferredByBackground) return
    const immediate = this.syncDeferredImmediate
    this.syncDeferredByBackground = false
    this.syncDeferredImmediate = false
    this.enqueueAutoSync(immediate)
  }

  scheduleAutoSync(immediate = false): void {
    if (this.disposed) return
    if (immediate) this.localMutationEpoch += 1
    this.enqueueAutoSync(immediate)
  }

  private enqueueAutoSync(immediate: boolean): void {
    if (this.disposed) return
    if (this.uiBackgrounded) {
      this.syncDeferredByBackground = true
      if (immediate) this.syncDeferredImmediate = true
      return
    }
    const request = { immediate: immediate || Boolean(this.autoSyncRequest?.immediate) }
    this.clearAutoSyncTimer()
    this.autoSyncRequest = request
    const delay = resolveAutoSyncDelay(request.immediate, this.autoSyncNotBefore - performance.now())
    this.autoSyncTimer = setTimeout(() => {
      this.autoSyncTimer = undefined
      void this.runExclusive(() => this.runScheduledSync(request)).catch((err) => {
        if (this.autoSyncRequest === request) this.autoSyncRequest = undefined
        this.onDiagnostic?.(`autoSync failed: ${err instanceof Error ? err.message : String(err)}`)
      })
    }, delay)
  }

  private async runScheduledSync(request: { immediate: boolean }): Promise<void> {
    if (this.autoSyncRequest !== request) return
    await this.initFromDbIfNeeded()
    const account = await this.repository.call<SyncAccountRecord | undefined>('syncAccountGet')
    if (this.autoSyncRequest !== request) return
    this.account = account
    await this.refreshNamespaceRecords()
    if (this.autoSyncRequest !== request) return
    this.autoSyncRequest = undefined
    if (!account) return
    if (
      !this.accessToken ||
      !this.vaultUnlocked ||
      account.writeMode === 'local-only' ||
      (!account.autoSync && !request.immediate)
    ) {
      this.emitStatus(this.buildStatus())
      return
    }
    if (account.readOnlyRemoteSchema || this.getAllPendingConflicts().length) return
    await this.performSyncCycle()
    this.emitStatus(this.buildStatus())
  }

  dispose(): void {
    this.disposed = true
    this.clearAutoSyncTimer()
    this.accessToken = null
    this.refreshToken = null
  }

  private async initFromDbIfNeeded(): Promise<void> {
    if (!this.account) await this.initFromDb()
  }

  private clearAutoSyncTimer(): void {
    this.autoSyncRequest = undefined
    if (this.autoSyncTimer) {
      clearTimeout(this.autoSyncTimer)
      this.autoSyncTimer = undefined
    }
  }

  private async callPrepareRotate(
    newKeyVersion: number,
    masterPassword: string,
    syncPasswords: boolean,
    plaintextPasswords: Record<string, string>
  ) {
    return this.repository.call<{
      recoveryKey: string
      keyEnvelope: VaultMetadataWire
      reencryptedEnvelope: SyncDocumentEnvelope
      nextBaseDocJson: string
    }>('syncPrepareRotate', {
      newKeyVersion,
      masterPassword,
      syncPasswords,
      plaintextPasswords
    })
  }

  private async authenticate(
    mode: 'login' | 'register',
    input: SyncLoginInput | SyncRegisterInput
  ): Promise<SyncStatusSnapshot> {
    this.clearAutoSyncTimer()
    const existing = await this.repository.call<SyncAccountRecord | undefined>('syncAccountGet')
    const sameAccount =
      existing &&
      existing.serverUrl === input.serverUrl &&
      existing.email.toLowerCase() === input.email.toLowerCase()

    const fallbackDeviceName = input.deviceName || existing?.deviceName || hostname() || 'Orbit Desktop'
    const appVersion = typeof app?.getVersion === 'function' ? app.getVersion() : '1.3.0'

    if (input.keepSignedIn && !(await isSystemEncryptionAvailable())) {
      throw new Error(unavailableEncryptionMessage('无法启用保持登录状态'))
    }

    const endpoint = mode === 'register' ? '/api/v1/auth/register' : '/api/v1/auth/login'
    const requestBody: Record<string, unknown> = {
      email: input.email,
      password: input.password,
      device: {
        name: fallbackDeviceName,
        platform: process.platform,
        appVersion
      }
    }
    if (mode === 'register' && 'inviteCode' in input && input.inviteCode) {
      requestBody.inviteCode = input.inviteCode
    }

    const authRes = await this.requestJson<{
      accessToken: string
      refreshToken: string
      user: { id?: string; email: string }
      device?: { id?: string; name?: string }
    }>(input.serverUrl, endpoint, {
      method: 'POST',
      withAuth: false,
      allowInsecureHttp: Boolean(input.allowInsecureHttp),
      body: requestBody
    })

    if (!sameAccount) {
      await this.repository.call('vaultLock')
      this.vaultUnlocked = false
      this.vaultMetadata = null
    }

    this.accessToken = authRes.accessToken
    this.refreshToken = authRes.refreshToken
    const encryptedRefreshToken = input.keepSignedIn
      ? await safeStorage.encryptStringAsync(authRes.refreshToken)
      : null
    const deviceId = authRes.device?.id || existing?.deviceId || randomUUID()
    const deviceName = authRes.device?.name || fallbackDeviceName

    this.account = await this.repository.call<SyncAccountRecord>('syncAccountUpsert', {
      serverUrl: input.serverUrl,
      allowInsecureHttp: Boolean(input.allowInsecureHttp),
      email: authRes.user?.email ?? input.email,
      rememberEmail: input.rememberEmail,
      keepSignedIn: input.keepSignedIn,
      autoSync: sameAccount ? existing.autoSync : true,
      encryptedRefreshToken,
      ...(sameAccount ? {} : { encryptedVaultKey: null }),
      deviceId,
      deviceName,
      vaultId: sameAccount ? existing.vaultId : null,
      keyVersion: sameAccount ? existing.keyVersion : 1,
      syncPasswords: sameAccount ? existing.syncPasswords : false,
      syncPrivateKeys: false,
      syncFileCredentials: sameAccount ? existing.syncFileCredentials : false,
      syncRdpCredentials: sameAccount ? existing.syncRdpCredentials : false,
      syncProtocolSettings: sameAccount ? existing.syncProtocolSettings : true,
      resetSyncCursor: !sameAccount
    })

    this.clearAllPendingConflicts()
    this.offline = false
    this.lastError = null
    await this.fetchMeAndVaultStatus()

    const status = this.buildStatus()
    this.emitStatus(status)
    return status
  }

  private async fetchMeAndVaultStatus(): Promise<void> {
    if (!this.account || !this.accessToken) return
    const me = await this.requestJson<{
      user?: { id?: string; email?: string }
      deviceId?: string
      capabilities?: Record<string, unknown>
    }>(this.account.serverUrl, '/api/v1/me', { method: 'GET', withAuth: true })

    this.serverCapabilities = await this.probeServerCapabilities(this.account.serverUrl, me.capabilities)
    this.vaultMetadata = await this.tryFetchVaultMetadata(this.account.serverUrl)
    const nextEmail = me.user?.email ?? this.account.email
    const nextDeviceId = me.deviceId || this.account.deviceId
    if (this.vaultMetadata) {
      const vaultChanged = Boolean(
        this.account.vaultId && this.vaultMetadata.id && this.account.vaultId !== this.vaultMetadata.id
      )
      if (vaultChanged) {
        await this.repository.call('vaultLock')
        this.vaultUnlocked = false
      }
      this.account = await this.repository.call<SyncAccountRecord>('syncAccountUpsert', {
        serverUrl: this.account.serverUrl,
        email: nextEmail,
        rememberEmail: this.account.rememberEmail,
        keepSignedIn: this.account.keepSignedIn,
        autoSync: this.account.autoSync,
        ...(vaultChanged ? { encryptedVaultKey: null } : {}),
        deviceId: nextDeviceId,
        deviceName: this.account.deviceName,
        vaultId: this.vaultMetadata.id ?? this.account.vaultId,
        keyVersion: this.vaultMetadata.keyVersion,
        resetSyncCursor: vaultChanged
      })
    } else if (this.account.vaultId || nextDeviceId !== this.account.deviceId) {
      if (this.account.vaultId) {
        await this.repository.call('vaultLock')
        this.vaultUnlocked = false
      }
      this.account = await this.repository.call<SyncAccountRecord>('syncAccountUpsert', {
        serverUrl: this.account.serverUrl,
        email: nextEmail,
        rememberEmail: this.account.rememberEmail,
        keepSignedIn: this.account.keepSignedIn,
        autoSync: this.account.autoSync,
        ...(this.account.vaultId ? { encryptedVaultKey: null } : {}),
        deviceId: nextDeviceId,
        deviceName: this.account.deviceName,
        vaultId: null,
        keyVersion: 1,
        resetSyncCursor: Boolean(this.account.vaultId)
      })
    }
    await this.refreshNamespaceRecords()
    let unlocked = this.account.vaultId ? await this.repository.call<boolean>('vaultHasUnlockedKey') : false
    if (!unlocked && this.account.vaultId && this.account.encryptedVaultKey) {
      unlocked = await this.tryRestoreVaultKeyFromDisk()
    }
    this.vaultUnlocked = unlocked
  }

  private async probeServerCapabilities(
    serverUrl: string,
    inlineCapabilities?: Record<string, unknown>
  ): Promise<SyncServerCapabilities> {
    if (inlineCapabilities && typeof inlineCapabilities === 'object' && !Array.isArray(inlineCapabilities)) {
      return normalizeServerCapabilities(inlineCapabilities)
    }
    try {
      const remote = await this.requestJson<Record<string, unknown>>(serverUrl, '/api/v1/capabilities', {
        method: 'GET',
        withAuth: true
      })
      if (remote && typeof remote === 'object' && !Array.isArray(remote)) {
        return normalizeServerCapabilities(remote)
      }
      return { ...DEFAULT_LEGACY_SERVER_CAPABILITIES, probed: true }
    } catch (error) {
      if (
        error instanceof SyncHttpError &&
        (error.status === 404 || error.status === 405 || error.status === 501)
      ) {
        return { ...DEFAULT_LEGACY_SERVER_CAPABILITIES, probed: true }
      }
      // If `/api/v1/me` just succeeded, gracefully degrade to legacy v1 instead of failing login/resume
      this.onDiagnostic?.(
        `capabilities probe fallback to legacy v1: ${error instanceof Error ? error.message : String(error)}`
      )
      return { ...DEFAULT_LEGACY_SERVER_CAPABILITIES, probed: true }
    }
  }

  private async persistUnlockedVaultKey(): Promise<void> {
    if (!this.account) return
    try {
      if (!(await isSystemEncryptionAvailable())) return
      const rawKeyBase64 = await this.repository.call<string | null>('vaultExportKey')
      if (!rawKeyBase64) return
      const encryptedVaultKey = await safeStorage.encryptStringAsync(rawKeyBase64)
      this.account = await this.repository.call<SyncAccountRecord>('syncAccountUpsert', {
        serverUrl: this.account.serverUrl,
        email: this.account.email,
        rememberEmail: this.account.rememberEmail,
        keepSignedIn: this.account.keepSignedIn,
        autoSync: this.account.autoSync,
        writeMode: this.account.writeMode,
        encryptedVaultKey,
        deviceId: this.account.deviceId,
        deviceName: this.account.deviceName
      })
    } catch {
      /* Ignore OS keyring persistence failure; user can still use session in-memory */
    }
  }

  private async tryRestoreVaultKeyFromDisk(): Promise<boolean> {
    if (!this.account?.encryptedVaultKey) return false
    try {
      if (!(await isSystemEncryptionAvailable())) return false
      const dec = await safeStorage.decryptStringAsync(Buffer.from(this.account.encryptedVaultKey))
      return await this.repository.call<boolean>('vaultRestoreKey', { rawKeyBase64: dec.result })
    } catch {
      return false
    }
  }

  private async ensureVaultMetadata(): Promise<VaultMetadataWire> {
    const meta = await this.tryFetchVaultMetadata(this.account!.serverUrl)
    if (!meta) throw new Error('云端尚未创建加密保管库，请先创建保管库主密码')
    this.vaultMetadata = meta
    return meta
  }

  private async tryFetchVaultMetadata(serverUrl: string): Promise<VaultMetadataWire | null> {
    try {
      return await this.requestJson<VaultMetadataWire>(serverUrl, '/api/v1/vault/key-envelope', {
        method: 'GET',
        withAuth: true
      })
    } catch (error) {
      if (error instanceof SyncHttpError && error.status === 404) return null
      throw error
    }
  }

  private async performSyncCycle(resolutions?: Record<string, 'local' | 'remote'>): Promise<void> {
    this.syncing = true
    this.offline = false
    this.lastError = null
    this.emitStatus(this.buildStatus())

    try {
      const serverUrl = this.account!.serverUrl
      const coreCommitted = await this.syncCoreNamespace(serverUrl, resolutions)
      let protocolsCommitted: {
        fileProfiles: FileProfile[]
        rdpProfiles: RdpProfile[]
        knownRdpHosts: KnownRdpHostEntry[]
      } | null = null
      let settingsCommitted: { protocolSettings: AllProtocolSettings } | null = null

      if (this.vaultUnlocked && this.supportsNamespace('protocols')) {
        protocolsCommitted = await this.syncProtocolsNamespace(serverUrl, resolutions)
      }
      if (this.vaultUnlocked && this.supportsNamespace('settings') && this.account?.syncProtocolSettings) {
        settingsCommitted = await this.syncSettingsNamespace(serverUrl, resolutions)
      }

      await this.refreshNamespaceRecords()
      if (coreCommitted || protocolsCommitted || settingsCommitted) {
        await this.emitUnifiedDataUpdate({
          core: coreCommitted ?? undefined,
          protocols: protocolsCommitted ?? undefined,
          settings: settingsCommitted ?? undefined
        })
      }
    } catch (error) {
      if (error instanceof SyncNetworkError) {
        this.offline = true
      }
      this.lastError = error instanceof Error ? error.message : '同步失败'
      throw error
    } finally {
      this.syncing = false
      this.emitStatus(this.buildStatus())
    }
  }

  private async handleRemoteKeyVersionMismatch(serverUrl: string): Promise<void> {
    this.vaultMetadata = await this.tryFetchVaultMetadata(serverUrl)
    await this.repository.call('vaultLock')
    this.vaultUnlocked = false
    if (this.vaultMetadata) {
      this.account = await this.repository.call<SyncAccountRecord>('syncAccountUpsert', {
        serverUrl: this.account!.serverUrl,
        email: this.account!.email,
        rememberEmail: this.account!.rememberEmail,
        keepSignedIn: this.account!.keepSignedIn,
        autoSync: this.account!.autoSync,
        deviceId: this.account!.deviceId,
        deviceName: this.account!.deviceName,
        vaultId: this.vaultMetadata.id ?? this.account!.vaultId,
        keyVersion: this.vaultMetadata.keyVersion
      })
    }
    throw new Error(
      this.vaultMetadata
        ? `检测到保管库密钥已轮换至 v${this.vaultMetadata.keyVersion}，请重新使用主密码解锁以同步最新文档。`
        : '检测到保管库密钥已在其他设备轮换，请重新使用主密码解锁以同步最新文档。'
    )
  }

  private async syncCoreNamespace(
    serverUrl: string,
    resolutions?: Record<string, 'local' | 'remote'>
  ): Promise<{ hosts: Host[]; groups: SyncGroup[]; tunnels: SyncTunnel[] } | null> {
    for (let attempt = 0; attempt < MAX_CONFLICT_RACE_RETRIES; attempt++) {
      const remote = await this.fetchRemoteDocument(serverUrl)
      if (remote && remote.envelope.keyVersion !== this.account?.keyVersion) {
        this.vaultMetadata = await this.tryFetchVaultMetadata(serverUrl)
        if (this.vaultMetadata && this.vaultMetadata.keyVersion > (this.account?.keyVersion ?? 0)) {
          await this.handleRemoteKeyVersionMismatch(serverUrl)
        }
      }

      const snapshotEpoch = this.localMutationEpoch
      const baseDocJson = await this.decryptBaseDocIfPresent()
      const plaintextPasswords = await this.decryptLocalHostPasswords()
      let evaluated: SyncEvaluateOutput
      try {
        evaluated = await this.repository.call<SyncEvaluateOutput>('syncEvaluateRemoteAndMerge', {
          plaintextPasswords,
          baseDocJson,
          remoteEnvelope: remote?.envelope ?? null,
          resolutions
        })
      } finally {
        wipePasswordMap(plaintextPasswords)
      }

      if (evaluated.readOnlySchema) {
        this.account = await this.repository.call<SyncAccountRecord>('syncAccountGet')
        this.lastError = `远端同步文档版本 v${evaluated.remoteSchemaVersion} 高于当前支持版本 v${SYNC_SCHEMA_VERSION}，已进入只读保护模式以防覆盖数据。`
        this.pendingConflict = null
        return null
      }

      if (evaluated.conflicts.length > 0) {
        this.pendingConflict = {
          remoteEnvelope: remote?.envelope ?? null,
          remoteRevision: remote?.revision ?? null,
          remoteEtag: remote?.etag ?? null,
          conflicts: evaluated.conflicts
        }
        return null
      }

      let targetRevision = remote?.revision ?? null
      let targetEtag = remote?.etag ?? null
      if (evaluated.needsUpload) {
        if (!evaluated.uploadEnvelope) throw new Error('生成同步加密信封失败')
        try {
          const putRes = await this.putRemoteDocument(serverUrl, {
            baseRevision: remote?.revision ?? null,
            etag: remote?.etag ?? null,
            envelope: evaluated.uploadEnvelope,
            idempotencyKey: randomUUID()
          })
          targetRevision = putRes.revision
          targetEtag = putRes.etag
        } catch (error) {
          if (error instanceof SyncHttpError && error.status === 409) {
            if (error.code === 'VAULT_KEY_VERSION_MISMATCH') {
              await this.handleRemoteKeyVersionMismatch(serverUrl)
            }
            continue
          }
          throw error
        }
      }

      if (this.localMutationEpoch !== snapshotEpoch) {
        await this.recordUploadedCheckpointIfNeeded(evaluated, targetRevision, targetEtag)
        continue
      }
      const committed = await this.commitEvaluationToLocal(
        evaluated,
        targetRevision,
        targetEtag,
        snapshotEpoch
      )
      if (!committed) {
        await this.recordUploadedCheckpointIfNeeded(evaluated, targetRevision, targetEtag)
        continue
      }
      this.pendingConflict = null
      return committed
    }
    if (this.autoSyncTimer) {
      this.rerunRequested = true
      return null
    }
    throw new Error('远端文档并发更新频繁，请稍后重试。')
  }

  private async syncProtocolsNamespace(
    serverUrl: string,
    resolutions?: Record<string, 'local' | 'remote'>
  ): Promise<{
    fileProfiles: FileProfile[]
    rdpProfiles: RdpProfile[]
    knownRdpHosts: KnownRdpHostEntry[]
  } | null> {
    for (let attempt = 0; attempt < MAX_CONFLICT_RACE_RETRIES; attempt++) {
      const remote = await this.fetchRemoteNamespaceDocument(serverUrl, 'protocols')
      if (remote && remote.envelope.keyVersion !== this.account?.keyVersion) {
        this.vaultMetadata = await this.tryFetchVaultMetadata(serverUrl)
        if (this.vaultMetadata && this.vaultMetadata.keyVersion > (this.account?.keyVersion ?? 0)) {
          await this.handleRemoteKeyVersionMismatch(serverUrl)
        }
      }

      const snapshotEpoch = this.localMutationEpoch
      await this.refreshNamespaceRecords()
      const baseDocJson = await this.decryptCipherIfPresent(this.namespaceRecords.protocols?.baseDocCipher)
      const plaintextFileSecrets = await this.decryptLocalFileSecrets()
      const plaintextRdpPasswords = await this.decryptLocalRdpPasswords()
      let evaluated: SyncEvaluateProtocolsOutput
      try {
        evaluated = await this.repository.call<SyncEvaluateProtocolsOutput>('syncEvaluateProtocolsAndMerge', {
          plaintextFileSecrets,
          plaintextRdpPasswords,
          baseDocJson,
          remoteEnvelope: remote?.envelope ?? null,
          resolutions,
          maxDocumentBytes: this.serverCapabilities.maxDocumentBytes
        })
      } finally {
        wipeFileSecretMap(plaintextFileSecrets)
        wipePasswordMap(plaintextRdpPasswords)
      }

      if (evaluated.readOnlySchema) {
        await this.refreshNamespaceRecords()
        this.lastError = `远端 protocols 同步文档版本 v${evaluated.remoteSchemaVersion} 高于当前支持版本 v${SYNC_NAMESPACE_SCHEMA_VERSION}，该命名空间已进入只读保护模式。`
        delete this.pendingNamespaceConflicts.protocols
        return null
      }

      if (evaluated.conflicts.length > 0) {
        this.pendingNamespaceConflicts.protocols = evaluated.conflicts
        return null
      }

      let targetRevision = remote?.revision ?? null
      let targetEtag = remote?.etag ?? null
      if (evaluated.needsUpload) {
        if (!evaluated.uploadEnvelope) throw new Error('生成 protocols 同步加密信封失败')
        try {
          const putRes = await this.putRemoteNamespaceDocument(serverUrl, 'protocols', {
            baseRevision: remote?.revision ?? null,
            etag: remote?.etag ?? null,
            envelope: evaluated.uploadEnvelope,
            idempotencyKey: randomUUID()
          })
          targetRevision = putRes.revision
          targetEtag = putRes.etag
        } catch (error) {
          if (error instanceof SyncHttpError && error.status === 409) {
            if (error.code === 'VAULT_KEY_VERSION_MISMATCH') {
              await this.handleRemoteKeyVersionMismatch(serverUrl)
            }
            continue
          }
          throw error
        }
      }

      if (this.localMutationEpoch !== snapshotEpoch) {
        if (evaluated.needsUpload) {
          await this.repository.call('syncRecordNamespaceUploadedCheckpoint', {
            namespace: 'protocols',
            revision: targetRevision,
            etag: targetEtag,
            baseDocCipher: await this.encryptBaseDoc(evaluated.mergedBaseJson ?? ''),
            docExtra: evaluated.docExtra
          })
        }
        continue
      }

      const committed = await this.commitProtocolsEvaluationToLocal(
        evaluated,
        targetRevision,
        targetEtag,
        snapshotEpoch
      )
      if (!committed) {
        if (evaluated.needsUpload) {
          await this.repository.call('syncRecordNamespaceUploadedCheckpoint', {
            namespace: 'protocols',
            revision: targetRevision,
            etag: targetEtag,
            baseDocCipher: await this.encryptBaseDoc(evaluated.mergedBaseJson ?? ''),
            docExtra: evaluated.docExtra
          })
        }
        continue
      }
      delete this.pendingNamespaceConflicts.protocols
      return committed
    }
    if (this.autoSyncTimer) {
      this.rerunRequested = true
      return null
    }
    throw new Error('远端 protocols 文档并发更新频繁，请稍后重试。')
  }

  private async syncSettingsNamespace(
    serverUrl: string,
    resolutions?: Record<string, 'local' | 'remote'>
  ): Promise<{ protocolSettings: AllProtocolSettings } | null> {
    for (let attempt = 0; attempt < MAX_CONFLICT_RACE_RETRIES; attempt++) {
      const remote = await this.fetchRemoteNamespaceDocument(serverUrl, 'settings')
      if (remote && remote.envelope.keyVersion !== this.account?.keyVersion) {
        this.vaultMetadata = await this.tryFetchVaultMetadata(serverUrl)
        if (this.vaultMetadata && this.vaultMetadata.keyVersion > (this.account?.keyVersion ?? 0)) {
          await this.handleRemoteKeyVersionMismatch(serverUrl)
        }
      }

      const snapshotEpoch = this.localMutationEpoch
      await this.refreshNamespaceRecords()
      const baseDocJson = await this.decryptCipherIfPresent(this.namespaceRecords.settings?.baseDocCipher)
      const evaluated = await this.repository.call<SyncEvaluateSettingsOutput>(
        'syncEvaluateSettingsAndMerge',
        {
          baseDocJson,
          remoteEnvelope: remote?.envelope ?? null,
          resolutions,
          maxDocumentBytes: this.serverCapabilities.maxDocumentBytes
        }
      )

      if (evaluated.readOnlySchema) {
        await this.refreshNamespaceRecords()
        this.lastError = `远端 settings 同步文档版本 v${evaluated.remoteSchemaVersion} 高于当前支持版本 v${SYNC_NAMESPACE_SCHEMA_VERSION}，该命名空间已进入只读保护模式。`
        delete this.pendingNamespaceConflicts.settings
        return null
      }

      if (evaluated.conflicts.length > 0) {
        this.pendingNamespaceConflicts.settings = evaluated.conflicts
        return null
      }

      let targetRevision = remote?.revision ?? null
      let targetEtag = remote?.etag ?? null
      if (evaluated.needsUpload) {
        if (!evaluated.uploadEnvelope) throw new Error('生成 settings 同步加密信封失败')
        try {
          const putRes = await this.putRemoteNamespaceDocument(serverUrl, 'settings', {
            baseRevision: remote?.revision ?? null,
            etag: remote?.etag ?? null,
            envelope: evaluated.uploadEnvelope,
            idempotencyKey: randomUUID()
          })
          targetRevision = putRes.revision
          targetEtag = putRes.etag
        } catch (error) {
          if (error instanceof SyncHttpError && error.status === 409) {
            if (error.code === 'VAULT_KEY_VERSION_MISMATCH') {
              await this.handleRemoteKeyVersionMismatch(serverUrl)
            }
            continue
          }
          throw error
        }
      }

      if (this.localMutationEpoch !== snapshotEpoch) {
        if (evaluated.needsUpload) {
          await this.repository.call('syncRecordNamespaceUploadedCheckpoint', {
            namespace: 'settings',
            revision: targetRevision,
            etag: targetEtag,
            baseDocCipher: await this.encryptBaseDoc(evaluated.mergedBaseJson ?? ''),
            docExtra: evaluated.docExtra
          })
        }
        continue
      }

      const committed = await this.commitSettingsEvaluationToLocal(
        evaluated,
        targetRevision,
        targetEtag,
        snapshotEpoch
      )
      if (!committed) {
        if (evaluated.needsUpload) {
          await this.repository.call('syncRecordNamespaceUploadedCheckpoint', {
            namespace: 'settings',
            revision: targetRevision,
            etag: targetEtag,
            baseDocCipher: await this.encryptBaseDoc(evaluated.mergedBaseJson ?? ''),
            docExtra: evaluated.docExtra
          })
        }
        continue
      }
      delete this.pendingNamespaceConflicts.settings
      return committed
    }
    if (this.autoSyncTimer) {
      this.rerunRequested = true
      return null
    }
    throw new Error('远端 settings 文档并发更新频繁，请稍后重试。')
  }

  private async emitUnifiedDataUpdate(parts: {
    core?: { hosts: Host[]; groups: SyncGroup[]; tunnels: SyncTunnel[] }
    protocols?: { fileProfiles: FileProfile[]; rdpProfiles: RdpProfile[]; knownRdpHosts: KnownRdpHostEntry[] }
    settings?: { protocolSettings: AllProtocolSettings }
  }): Promise<void> {
    const core =
      parts.core ??
      ({
        hosts: await this.repository.call<Host[]>('list'),
        groups: await this.repository.call<SyncGroup[]>('groupsList'),
        tunnels: await this.repository.call<SyncTunnel[]>('tunnelsList')
      } as const)
    const update: SyncDataUpdate = {
      hosts: core.hosts,
      groups: core.groups,
      tunnels: core.tunnels,
      ...(parts.protocols
        ? {
            fileProfiles: parts.protocols.fileProfiles,
            rdpProfiles: parts.protocols.rdpProfiles,
            knownRdpHosts: parts.protocols.knownRdpHosts
          }
        : {}),
      ...(parts.settings ? { protocolSettings: parts.settings.protocolSettings } : {})
    }
    await yieldToEventLoop()
    this.emitData(update)
  }

  private async commitEvaluationToLocal(
    evaluated: SyncEvaluateOutput,
    revision: string | null,
    etag: string | null,
    snapshotEpoch?: number
  ): Promise<{ hosts: Host[]; groups: SyncGroup[]; tunnels: SyncTunnel[] } | null> {
    const canEncrypt = await isSystemEncryptionAvailable()
    const encryptedHostSecrets: Record<string, Uint8Array | null> = {}
    for (const item of evaluated.hostSecretsToEncrypt) {
      await yieldToEventLoop()
      if (item.password) {
        if (!canEncrypt) {
          throw new Error(unavailableEncryptionMessage('无法在本地保存同步的主机密码'))
        }
        encryptedHostSecrets[item.hostId] = await safeStorage.encryptStringAsync(item.password)
      } else {
        encryptedHostSecrets[item.hostId] = null
      }
    }
    const baseDocCipher = await this.encryptBaseDoc(evaluated.mergedBaseJson ?? '')
    if (snapshotEpoch !== undefined && this.localMutationEpoch !== snapshotEpoch) {
      return null
    }
    const committed = await this.repository.call<{
      hosts: Host[]
      groups: SyncGroup[]
      tunnels: SyncTunnel[]
    }>('syncCommitApplied', {
      localHostUpdates: evaluated.localHostUpdates,
      encryptedHostSecrets,
      deletedHostIds: evaluated.deletedHostIds,
      localGroups: evaluated.localGroups,
      localTunnels: evaluated.localTunnels,
      nextPreferences: evaluated.nextPreferences,
      remoteHostFingerprints: evaluated.remoteHostFingerprints,
      revision,
      etag,
      baseDocCipher,
      docExtra: evaluated.docExtra
    })
    this.account = await this.repository.call<SyncAccountRecord>('syncAccountGet')
    return committed
  }

  private async commitProtocolsEvaluationToLocal(
    evaluated: SyncEvaluateProtocolsOutput,
    revision: string | null,
    etag: string | null,
    snapshotEpoch?: number
  ): Promise<{
    fileProfiles: FileProfile[]
    rdpProfiles: RdpProfile[]
    knownRdpHosts: KnownRdpHostEntry[]
  } | null> {
    const canEncrypt = await isSystemEncryptionAvailable()
    const encryptedFileSecrets: Record<string, Uint8Array | null> = {}
    for (const item of evaluated.fileSecretsToEncrypt) {
      await yieldToEventLoop()
      if (item.secrets && Object.keys(item.secrets).length > 0) {
        if (!canEncrypt) {
          throw new Error(unavailableEncryptionMessage('无法在本地保存同步的文件服务器凭据'))
        }
        encryptedFileSecrets[item.profileId] = await safeStorage.encryptStringAsync(
          JSON.stringify(item.secrets)
        )
      } else {
        encryptedFileSecrets[item.profileId] = null
      }
    }
    const encryptedRdpSecrets: Record<string, Uint8Array | null> = {}
    for (const item of evaluated.rdpSecretsToEncrypt) {
      await yieldToEventLoop()
      if (item.password) {
        if (!canEncrypt) {
          throw new Error(unavailableEncryptionMessage('无法在本地保存同步的 RDP 密码'))
        }
        encryptedRdpSecrets[item.profileId] = await safeStorage.encryptStringAsync(item.password)
      } else {
        encryptedRdpSecrets[item.profileId] = null
      }
    }
    const baseDocCipher = await this.encryptBaseDoc(evaluated.mergedBaseJson ?? '')
    if (snapshotEpoch !== undefined && this.localMutationEpoch !== snapshotEpoch) {
      return null
    }
    const committed = await this.repository.call<{
      fileProfiles: FileProfile[]
      rdpProfiles: RdpProfile[]
      knownRdpHosts: KnownRdpHostEntry[]
    }>('syncCommitProtocolsApplied', {
      localFileProfileUpdates: evaluated.localFileProfileUpdates,
      encryptedFileSecrets,
      deletedFileProfileIds: evaluated.deletedFileProfileIds,
      localRdpProfileUpdates: evaluated.localRdpProfileUpdates,
      encryptedRdpSecrets,
      deletedRdpProfileIds: evaluated.deletedRdpProfileIds,
      localKnownRdpHosts: evaluated.localKnownRdpHosts,
      deletedKnownRdpHostIds: evaluated.deletedKnownRdpHostIds,
      nextPreferences: evaluated.nextPreferences,
      revision,
      etag,
      baseDocCipher,
      docExtra: evaluated.docExtra
    })
    this.account = await this.repository.call<SyncAccountRecord>('syncAccountGet')
    await this.refreshNamespaceRecords()
    return committed
  }

  private async commitSettingsEvaluationToLocal(
    evaluated: SyncEvaluateSettingsOutput,
    revision: string | null,
    etag: string | null,
    snapshotEpoch?: number
  ): Promise<{ protocolSettings: AllProtocolSettings } | null> {
    if (!evaluated.nextProtocolSettings) return null
    const baseDocCipher = await this.encryptBaseDoc(evaluated.mergedBaseJson ?? '')
    if (snapshotEpoch !== undefined && this.localMutationEpoch !== snapshotEpoch) {
      return null
    }
    const committed = await this.repository.call<{ protocolSettings: AllProtocolSettings }>(
      'syncCommitSettingsApplied',
      {
        nextProtocolSettings: evaluated.nextProtocolSettings,
        revision,
        etag,
        baseDocCipher,
        docExtra: evaluated.docExtra
      }
    )
    await this.refreshNamespaceRecords()
    return committed
  }

  private async recordUploadedCheckpointIfNeeded(
    evaluated: SyncEvaluateOutput,
    revision: string | null,
    etag: string | null
  ): Promise<void> {
    if (!evaluated.needsUpload) return
    const baseDocCipher = await this.encryptBaseDoc(evaluated.mergedBaseJson ?? '')
    await this.repository.call('syncRecordUploadedCheckpoint', {
      revision,
      etag,
      baseDocCipher,
      docExtra: evaluated.docExtra
    })
    this.account = await this.repository.call<SyncAccountRecord>('syncAccountGet')
  }

  private async encryptBaseDoc(baseJson: string): Promise<Uint8Array | null> {
    if (!baseJson) return null
    const canEncrypt = await isSystemEncryptionAvailable()
    if (!canEncrypt) return null
    return safeStorage.encryptStringAsync(baseJson)
  }

  private async decryptCipherIfPresent(cipher?: Uint8Array | null): Promise<string | null> {
    if (!cipher) return null
    if (!(await isSystemEncryptionAvailable())) return null
    try {
      const dec = await safeStorage.decryptStringAsync(Buffer.from(cipher))
      return dec.result
    } catch {
      return null
    }
  }

  private async decryptBaseDocIfPresent(): Promise<string | null> {
    return this.decryptCipherIfPresent(this.account?.baseDocCipher)
  }

  private async decryptLocalHostPasswords(): Promise<Record<string, string>> {
    const blobs = await this.repository.call<Array<{ id: string; secret: Uint8Array }>>('syncListSecretBlobs')
    const result: Record<string, string> = {}
    if (blobs.length === 0) return result
    if (!(await isSystemEncryptionAvailable())) return result
    for (const entry of blobs) {
      await yieldToEventLoop()
      try {
        const dec = await safeStorage.decryptStringAsync(Buffer.from(entry.secret))
        result[entry.id] = dec.result
      } catch {
        /* Skip unreadable OS credential */
      }
    }
    return result
  }

  private async decryptLocalFileSecrets(): Promise<Record<string, FileSecretsInput>> {
    const blobs =
      await this.repository.call<Array<{ id: string; secret: Uint8Array }>>('syncListFileSecretBlobs')
    const result: Record<string, FileSecretsInput> = {}
    if (blobs.length === 0) return result
    if (!(await isSystemEncryptionAvailable())) return result
    for (const entry of blobs) {
      await yieldToEventLoop()
      try {
        const dec = await safeStorage.decryptStringAsync(Buffer.from(entry.secret))
        const parsed = JSON.parse(dec.result) as FileSecretsInput
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          result[entry.id] = parsed
        }
      } catch {
        /* Skip unreadable OS credential */
      }
    }
    return result
  }

  private async decryptLocalRdpPasswords(): Promise<Record<string, string>> {
    const blobs =
      await this.repository.call<Array<{ id: string; secret: Uint8Array }>>('syncListRdpSecretBlobs')
    const result: Record<string, string> = {}
    if (blobs.length === 0) return result
    if (!(await isSystemEncryptionAvailable())) return result
    for (const entry of blobs) {
      await yieldToEventLoop()
      try {
        const dec = await safeStorage.decryptStringAsync(Buffer.from(entry.secret))
        result[entry.id] = dec.result
      } catch {
        /* Skip unreadable OS credential */
      }
    }
    return result
  }

  private async fetchRemoteDocument(serverUrl: string): Promise<{
    revision: string
    etag: string | null
    envelope: SyncDocumentEnvelope
  } | null> {
    return this.fetchRemoteNamespaceDocument(serverUrl, 'core')
  }

  private async fetchRemoteNamespaceDocument(
    serverUrl: string,
    namespace: SyncNamespace
  ): Promise<{
    revision: string
    etag: string | null
    envelope: SyncDocumentEnvelope
  } | null> {
    const path =
      namespace === 'core'
        ? '/api/v1/sync/document'
        : `/api/v1/sync/documents/${encodeURIComponent(namespace)}`
    try {
      const { data, etag } = await this.requestJsonWithMeta<SyncDocumentEnvelope | null>(serverUrl, path, {
        method: 'GET',
        withAuth: true
      })
      if (!data) return null
      const revision = String(data.revision ?? '0')
      return {
        revision,
        etag: etag ?? formatRevisionIfMatch(revision),
        envelope: {
          revision,
          schemaVersion: Number(data.schemaVersion),
          keyVersion: Number(data.keyVersion),
          algorithm: data.algorithm ?? 'AES-256-GCM',
          nonce: data.nonce,
          ciphertext: data.ciphertext,
          ciphertextHash: data.ciphertextHash,
          updatedByDeviceId: data.updatedByDeviceId,
          updatedAt: data.updatedAt
        }
      }
    } catch (error) {
      if (error instanceof SyncHttpError && error.status === 404) {
        if (error.code === 'VAULT_NOT_FOUND') {
          await this.repository.call('vaultLock')
          this.vaultUnlocked = false
          this.vaultMetadata = null
          throw new Error('云端尚未创建或已重置保管库，请重新创建或同步保管库状态。')
        }
        return null
      }
      throw error
    }
  }

  private async putRemoteDocument(
    serverUrl: string,
    payload: {
      baseRevision: string | null
      etag: string | null
      envelope: SyncDocumentEnvelope
      idempotencyKey: string
    }
  ): Promise<{ revision: string; etag: string | null }> {
    return this.putRemoteNamespaceDocument(serverUrl, 'core', payload)
  }

  private async putRemoteNamespaceDocument(
    serverUrl: string,
    namespace: SyncNamespace,
    payload: {
      baseRevision: string | null
      etag: string | null
      envelope: SyncDocumentEnvelope
      idempotencyKey: string
    }
  ): Promise<{ revision: string; etag: string | null }> {
    const path =
      namespace === 'core'
        ? '/api/v1/sync/document'
        : `/api/v1/sync/documents/${encodeURIComponent(namespace)}`
    const ifMatch = payload.baseRevision
      ? formatRevisionIfMatch(payload.baseRevision)
      : formatRevisionIfMatch('0')
    const { data, etag } = await this.requestJsonWithMeta<{
      revision: string | number
      updatedAt: string
    }>(serverUrl, path, {
      method: 'PUT',
      headers: {
        'Idempotency-Key': payload.idempotencyKey,
        'If-Match': ifMatch
      },
      withAuth: true,
      body: {
        schemaVersion: payload.envelope.schemaVersion,
        keyVersion: payload.envelope.keyVersion,
        algorithm: payload.envelope.algorithm,
        nonce: payload.envelope.nonce,
        ciphertext: payload.envelope.ciphertext,
        ciphertextHash: payload.envelope.ciphertextHash
      }
    })
    const nextRevision = String(data.revision)
    return {
      revision: nextRevision,
      etag: etag ?? formatRevisionIfMatch(nextRevision)
    }
  }

  private async clearLocalAuthState(): Promise<void> {
    this.accessToken = null
    this.refreshToken = null
    this.vaultUnlocked = false
    this.vaultMetadata = null
    this.serverCapabilities = { ...DEFAULT_LEGACY_SERVER_CAPABILITIES }
    this.clearAllPendingConflicts()
    this.account = await this.repository.call<SyncAccountRecord | undefined>('syncAccountClearAuth')
  }

  private requireSignedIn(): void {
    if (!this.account || !this.accessToken) {
      throw new Error('请先登录同步账号')
    }
  }

  private async refreshAccessTokenSingleFlight(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise
    this.refreshPromise = this.performRefresh().finally(() => {
      this.refreshPromise = null
    })
    return this.refreshPromise
  }

  private async performRefresh(): Promise<void> {
    const account = this.account
    if (!account || !this.refreshToken) {
      throw new SyncHttpError(401, '缺少刷新凭据，请重新登录')
    }
    const res = await this.requestJson<{
      accessToken: string
      refreshToken: string
      user?: { id?: string; email?: string }
      device?: { id?: string; name?: string }
    }>(account.serverUrl, '/api/v1/auth/refresh', {
      method: 'POST',
      withAuth: false,
      allowRetryAuth: false,
      body: {
        refreshToken: this.refreshToken
      }
    })
    this.accessToken = res.accessToken
    this.refreshToken = res.refreshToken
    const encryptedRefreshToken =
      account.keepSignedIn && (await isSystemEncryptionAvailable())
        ? await safeStorage.encryptStringAsync(res.refreshToken)
        : null
    this.account = await this.repository.call<SyncAccountRecord>('syncAccountUpsert', {
      serverUrl: account.serverUrl,
      email: res.user?.email ?? account.email,
      rememberEmail: account.rememberEmail,
      keepSignedIn: account.keepSignedIn,
      autoSync: account.autoSync,
      encryptedRefreshToken,
      deviceId: res.device?.id || account.deviceId,
      deviceName: res.device?.name || account.deviceName
    })
  }

  private async requestJson<T>(
    serverUrl: string,
    path: string,
    opts: {
      method: string
      body?: unknown
      headers?: Record<string, string>
      withAuth: boolean
      allowRetryAuth?: boolean
      allowInsecureHttp?: boolean
    }
  ): Promise<T> {
    const { data } = await this.requestJsonWithMeta<T>(serverUrl, path, opts)
    return data
  }

  private async requestJsonWithMeta<T>(
    serverUrl: string,
    path: string,
    opts: {
      method: string
      body?: unknown
      headers?: Record<string, string>
      withAuth: boolean
      allowRetryAuth?: boolean
      allowInsecureHttp?: boolean
    }
  ): Promise<{ data: T; etag: string | null }> {
    const validatedServerUrl = validateSyncServerUrl(serverUrl, {
      allowInsecureHttp: opts.allowInsecureHttp ?? this.account?.allowInsecureHttp ?? false
    })
    const url = `${validatedServerUrl}${path}`
    const allowRetryAuth = opts.allowRetryAuth ?? true

    for (let retry = 0; retry <= MAX_RETRY_429; retry++) {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        ...(opts.headers ?? {})
      }
      if (opts.body !== undefined) {
        headers['Content-Type'] = 'application/json'
      }
      if (opts.withAuth) {
        if (!this.accessToken) throw new SyncHttpError(401, '尚未登录或会话已过期')
        headers.Authorization = `Bearer ${this.accessToken}`
      }

      let response: Response
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      try {
        response = await fetch(url, {
          method: opts.method,
          headers,
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: controller.signal
        })
      } catch (error) {
        const message =
          error instanceof Error && error.name === 'AbortError'
            ? '同步服务器请求超时，当前已保留本地离线数据。'
            : '无法连接同步服务器，请检查网络或服务地址（本地数据不受影响）。'
        throw new SyncNetworkError(message)
      } finally {
        clearTimeout(timeout)
      }

      if (response.status === 401 && opts.withAuth && allowRetryAuth && this.refreshToken) {
        try {
          await this.refreshAccessTokenSingleFlight()
        } catch (refreshError) {
          if (
            refreshError instanceof SyncHttpError &&
            (refreshError.status === 401 || refreshError.status === 403)
          ) {
            await this.clearLocalAuthState()
            this.emitStatus(this.buildStatus())
          }
          throw refreshError
        }
        return this.requestJsonWithMeta<T>(serverUrl, path, { ...opts, allowRetryAuth: false })
      }

      if (response.status === 429 && retry < MAX_RETRY_429) {
        const retryAfterRaw = response.headers.get('retry-after')
        const waitMs = parseRetryAfterMs(retryAfterRaw)
        await sleep(waitMs)
        continue
      }

      const text = await response.text()
      let parsedBody: Record<string, unknown> | undefined
      if (text) {
        try {
          parsedBody = JSON.parse(text) as Record<string, unknown>
        } catch {
          parsedBody = undefined
        }
      }

      if (!response.ok) {
        const nestedData =
          parsedBody?.data && typeof parsedBody.data === 'object' && !Array.isArray(parsedBody.data)
            ? (parsedBody.data as Record<string, unknown>)
            : undefined
        const code =
          (typeof nestedData?.code === 'string' && nestedData.code) ||
          (typeof parsedBody?.code === 'string' ? parsedBody.code : undefined)
        const message =
          (typeof nestedData?.message === 'string' && nestedData.message) ||
          (typeof parsedBody?.error === 'string' && parsedBody.error) ||
          (typeof parsedBody?.message === 'string' && parsedBody.message) ||
          `同步服务返回 HTTP ${response.status}`
        throw new SyncHttpError(response.status, message, code)
      }

      return {
        data: (parsedBody ?? null) as T,
        etag: response.headers.get('etag')
      }
    }

    throw new SyncHttpError(429, '同步服务器限流，请稍后再试。')
  }

  private runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.syncQueue.then(task, task)
    this.syncQueue = run.catch(() => {})
    return run.finally(() => {
      if (this.rerunRequested && !this.disposed) {
        this.rerunRequested = false
        this.scheduleAutoSync()
      }
    })
  }

  private buildStatus(): SyncStatusSnapshot {
    const acc = this.account
    const signedIn = Boolean(acc && this.accessToken)
    const vaultConfigured = Boolean(acc?.vaultId || this.vaultMetadata)
    const allConflicts = this.getAllPendingConflicts()
    const protoNs = this.namespaceRecords.protocols
    const settingsNs = this.namespaceRecords.settings
    const anyPending = Boolean(
      acc?.pendingChanges ||
        (this.supportsNamespace('protocols') && protoNs?.pendingChanges) ||
        (this.supportsNamespace('settings') && acc?.syncProtocolSettings && settingsNs?.pendingChanges)
    )

    let phase: SyncStatePhase = 'unconfigured'
    if (this.syncing) phase = 'syncing'
    else if (acc?.readOnlyRemoteSchema) phase = 'read-only-schema'
    else if (allConflicts.length > 0) phase = 'conflict'
    else if (this.offline) phase = 'offline'
    else if (!acc?.serverUrl) phase = 'unconfigured'
    else if (!signedIn) phase = 'signed-out'
    else if (!vaultConfigured || !this.vaultUnlocked) phase = 'vault-locked'
    else if (this.lastError) phase = 'error'
    else phase = 'synced'

    const namespaces: Record<SyncNamespace, SyncNamespaceState> = {
      core: {
        namespace: 'core',
        lastRevision: acc?.lastRevision ?? null,
        lastSyncAt: acc?.lastSyncAt ?? null,
        pendingChanges: acc?.pendingChanges ?? false,
        readOnlyRemoteSchema: acc?.readOnlyRemoteSchema ?? false,
        remoteSchemaVersion: acc?.remoteSchemaVersion
      },
      protocols: {
        namespace: 'protocols',
        lastRevision: protoNs?.lastRevision ?? null,
        lastSyncAt: protoNs?.lastSyncAt ?? null,
        pendingChanges: protoNs?.pendingChanges ?? false,
        readOnlyRemoteSchema: protoNs?.readOnlyRemoteSchema ?? false,
        remoteSchemaVersion: protoNs?.remoteSchemaVersion
      },
      settings: {
        namespace: 'settings',
        lastRevision: settingsNs?.lastRevision ?? null,
        lastSyncAt: settingsNs?.lastSyncAt ?? null,
        pendingChanges: settingsNs?.pendingChanges ?? false,
        readOnlyRemoteSchema: settingsNs?.readOnlyRemoteSchema ?? false,
        remoteSchemaVersion: settingsNs?.remoteSchemaVersion
      }
    }

    return {
      phase,
      serverUrl: acc?.serverUrl ?? '',
      allowInsecureHttp: acc?.allowInsecureHttp ?? false,
      email: acc?.rememberEmail || signedIn ? (acc?.email ?? '') : '',
      rememberEmail: acc?.rememberEmail ?? true,
      keepSignedIn: acc?.keepSignedIn ?? false,
      autoSync: acc?.autoSync ?? true,
      writeMode: acc?.writeMode ?? 'realtime',
      signedIn,
      vaultConfigured,
      vaultUnlocked: this.vaultUnlocked,
      vaultId: acc?.vaultId ?? this.vaultMetadata?.id ?? null,
      keyVersion: acc?.keyVersion ?? this.vaultMetadata?.keyVersion ?? 1,
      deviceId: acc?.deviceId ?? '',
      deviceName: acc?.deviceName ?? hostname(),
      syncPasswords: acc?.syncPasswords ?? false,
      syncPrivateKeys: acc?.syncPrivateKeys ?? false,
      syncFileCredentials: acc?.syncFileCredentials ?? false,
      syncRdpCredentials: acc?.syncRdpCredentials ?? false,
      syncProtocolSettings: acc?.syncProtocolSettings ?? true,
      lastRevision: acc?.lastRevision ?? null,
      lastSyncAt: acc?.lastSyncAt ?? null,
      pendingChanges: anyPending,
      readOnlyRemoteSchema: acc?.readOnlyRemoteSchema ?? false,
      remoteSchemaVersion: acc?.remoteSchemaVersion,
      lastError: this.lastError,
      conflicts: allConflicts,
      capabilities: {
        passwordSyncSupported: true,
        privateKeySyncSupported: false,
        keySyncReason: SYNC_KEY_CAPABILITY_MESSAGE
      },
      serverCapabilities: {
        ...this.serverCapabilities,
        supportedNamespaces: [...this.serverCapabilities.supportedNamespaces]
      },
      namespaces
    }
  }
}

function normalizeServerCapabilities(raw: Record<string, unknown>): SyncServerCapabilities {
  const validSet = new Set<string>(SYNC_NAMESPACES)
  const rawList = Array.isArray(raw.supportedNamespaces)
    ? raw.supportedNamespaces.filter(
        (item): item is SyncNamespace => typeof item === 'string' && validSet.has(item)
      )
    : []
  const supportedNamespaces: SyncNamespace[] = rawList.includes('core')
    ? [...new Set(rawList)]
    : ['core', ...new Set(rawList)]
  const maxSchemaVersion =
    typeof raw.maxSchemaVersion === 'number' &&
    Number.isInteger(raw.maxSchemaVersion) &&
    raw.maxSchemaVersion >= 1
      ? raw.maxSchemaVersion
      : supportedNamespaces.length > 1
        ? SYNC_NAMESPACE_SCHEMA_VERSION
        : SYNC_SCHEMA_VERSION
  const rawMaxBytes =
    typeof raw.maxDocumentBytes === 'number' && Number.isFinite(raw.maxDocumentBytes)
      ? Math.trunc(raw.maxDocumentBytes)
      : MAX_SYNC_DOCUMENT_BYTES
  const maxDocumentBytes = Math.min(
    Math.max(rawMaxBytes, MAX_SYNC_DOCUMENT_BYTES),
    MAX_SYNC_ALLOWED_DOCUMENT_BYTES
  )
  const supportsBatchVaultRotate = Boolean(raw.supportsBatchVaultRotate)
  const legacyV1Only = !supportedNamespaces.includes('protocols') && !supportedNamespaces.includes('settings')
  return {
    probed: true,
    legacyV1Only,
    maxSchemaVersion,
    supportedNamespaces,
    maxDocumentBytes,
    supportsBatchVaultRotate
  }
}

function parseRetryAfterMs(header: string | null): number {
  if (!header) return 1500
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.max(seconds * 1000, 300), 15_000)
  }
  const timestamp = Date.parse(header)
  if (!Number.isNaN(timestamp)) {
    return Math.min(Math.max(timestamp - Date.now(), 300), 15_000)
  }
  return 1500
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function formatRevisionIfMatch(revision: string | number): string {
  const clean = String(revision)
    .trim()
    .replace(/^"+|"+$/g, '')
  if (clean.startsWith('revision-')) return `"${clean}"`
  return `"revision-${clean}"`
}

function wipePasswordMap(map: Record<string, string>): void {
  for (const key of Object.keys(map)) {
    map[key] = ''
    delete map[key]
  }
}

function wipeFileSecretMap(map: Record<string, FileSecretsInput>): void {
  for (const key of Object.keys(map)) {
    const entry = map[key]
    if (entry) {
      if (entry.password) entry.password = ''
      if (entry.token) entry.token = ''
      if (entry.secretAccessKey) entry.secretAccessKey = ''
      if (entry.sessionToken) entry.sessionToken = ''
    }
    delete map[key]
  }
}
