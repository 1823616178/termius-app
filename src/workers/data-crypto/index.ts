import { Repository } from './database'
import { shutdownKdfWorker } from './kdf-client'
const repository = new Repository(process.argv[2]!)

const ALLOWED_METHODS = new Set<keyof Repository>([
  'list',
  'get',
  'save',
  'remove',
  'updateSecret',
  'fileProfilesList',
  'fileProfileGet',
  'fileProfileSave',
  'fileProfileUpdateSecret',
  'fileProfileRemove',
  'rdpProfilesList',
  'rdpProfileGet',
  'rdpProfileSave',
  'rdpProfileUpdateSecret',
  'rdpProfileRemove',
  'rdpKnownHostsList',
  'rdpKnownHostVerify',
  'rdpKnownHostTrust',
  'rdpKnownHostRemove',
  'protocolSettingsAll',
  'protocolSettingsPatch',
  'known',
  'knownHostsList',
  'knownHostsRemove',
  'trust',
  'groupsList',
  'groupSave',
  'groupRemove',
  'tunnelsList',
  'tunnelSave',
  'tunnelRemove',
  'syncAccountGet',
  'syncAccountUpsert',
  'syncAccountClearAuth',
  'syncListSecretBlobs',
  'vaultHasUnlockedKey',
  'vaultExportKey',
  'vaultRestoreKey',
  'vaultLock',
  'vaultCreate',
  'vaultUnlock',
  'vaultRecover',
  'syncEvaluateRemoteAndMerge',
  'syncPrepareRotate',
  'syncCommitRotate',
  'syncCancelRotate',
  'syncEvaluateRevisionRestore',
  'syncCommitApplied',
  'syncRecordUploadedCheckpoint'
])

process.parentPort.on('message', ({ data }) => {
  if (data.type === 'shutdown') {
    void shutdownKdfWorker().finally(() => {
      repository.close()
      process.exit(0)
    })
    return
  }
  const { id, method, args } = data
  void (async () => {
    try {
      const fn = repository[method as keyof Repository]
      if (typeof fn !== 'function' || !ALLOWED_METHODS.has(method as keyof Repository)) {
        throw new Error('不支持的数据操作')
      }
      const value = await (fn as (...args: unknown[]) => unknown).apply(repository, args)
      process.parentPort.postMessage({ id, value })
    } catch (error) {
      process.parentPort.postMessage({ id, error: error instanceof Error ? error.message : '数据操作失败' })
    }
  })()
})
process.on('exit', () => repository.close())
process.parentPort.postMessage({ ready: true })
