import { argon2 as nativeArgon2, randomBytes } from 'node:crypto'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import {
  MAX_SYNC_DOCUMENT_BYTES,
  MAX_SYNC_V2_DOCUMENT_BYTES,
  SYNC_A2_ITERATIONS,
  SYNC_A2_MEMORY_KIB,
  SYNC_A2_PARALLELISM,
  SYNC_A2_TAG_LENGTH,
  SYNC_AAD_DOMAIN_DOCUMENT,
  SYNC_RECOVERY_PREFIX,
  SYNC_SCHEMA_VERSION,
  type SyncDocumentProtocolsV2,
  type SyncDocumentV1
} from '../../src/shared/sync'
import { argon2idSync } from '../../src/workers/data-crypto/argon2id'
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  buildAad,
  createVaultMaterial,
  decryptNamespaceDocument,
  decryptSyncDocument,
  deriveRecoveryKek,
  encryptNamespaceDocument,
  encryptSyncDocument,
  generateRecoveryKey,
  parseRecoveryKeySecret,
  recoverVaultWithKey,
  rotateVaultKeyMaterials,
  unlockVaultWithPassword
} from '../../src/workers/data-crypto/sync-crypto'

describe('Sync E2EE cryptography', () => {
  it('matches OpenSSL native Argon2id byte-for-byte across parameters', async () => {
    const nativeAsync = promisify(nativeArgon2)
    for (const cfg of [
      { memory: 64, passes: 3, parallelism: 2, tagLength: 32 },
      {
        memory: SYNC_A2_MEMORY_KIB,
        passes: SYNC_A2_ITERATIONS,
        parallelism: SYNC_A2_PARALLELISM,
        tagLength: SYNC_A2_TAG_LENGTH
      }
    ]) {
      const pw = Buffer.from('Orbit-Parity-密码-123!', 'utf8')
      const salt = randomBytes(16)
      const expected = await nativeAsync('argon2id', {
        message: pw,
        nonce: salt,
        parallelism: cfg.parallelism,
        tagLength: cfg.tagLength,
        memory: cfg.memory,
        passes: cfg.passes
      })
      const actual = Buffer.from(
        argon2idSync({
          password: pw,
          salt,
          memoryKiB: cfg.memory,
          passes: cfg.passes,
          parallelism: cfg.parallelism,
          tagLength: cfg.tagLength
        })
      )
      expect(actual.toString('hex')).toBe(expected.toString('hex'))
    }
  }, 15_000)

  it('matches HarmonyOS C++/OpenSSL S2 frozen golden vectors byte-for-byte', async () => {
    // Vectors frozen in ssh_client_ohos/entry/src/main/cpp/tests/vault_golden_vectors.h
    const salt = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex')
    const nonce = Buffer.from('101112131415161718191a1b', 'hex')
    const recoveryRaw = Buffer.from('202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f', 'hex')
    const expectedRecoveryKey = 'SPM1-ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8-EF4ED88BE4A3'
    expect(parseRecoveryKeySecret(expectedRecoveryKey).equals(recoveryRaw)).toBe(true)

    const recoveryKek = await deriveRecoveryKek(expectedRecoveryKey)
    expect(recoveryKek.toString('hex')).toBe(
      '3f564907fd98e07730ff9bb5d79dcab819bb80c11c2d0cba51c723edb83220a5'
    )

    const vaultKey = Buffer.from(
      argon2idSync({
        password: Buffer.from('s2-golden-password', 'utf8'),
        salt,
        memoryKiB: SYNC_A2_MEMORY_KIB,
        passes: SYNC_A2_ITERATIONS,
        parallelism: SYNC_A2_PARALLELISM,
        tagLength: SYNC_A2_TAG_LENGTH
      })
    )
    expect(vaultKey.toString('hex')).toBe('86b05fc972d63bcc7c33b0df2420f23484adbab54b923533983ec93b9783a7ec')

    const aad = buildAad(SYNC_AAD_DOMAIN_DOCUMENT, 'vault-golden', '1', '1')
    const encrypted = aesGcmEncrypt(vaultKey, Buffer.from('s2-golden-plaintext', 'utf8'), aad, nonce)
    expect(Buffer.from(encrypted.ciphertext, 'base64').toString('hex')).toBe(
      '636005c373efaad17c396e443e30b26fde0c00ab78b6442183407832d6f8acb47fe631'
    )
    expect(encrypted.ciphertextHash).toBe('7642985e1b19ef5784767564e06c2dce7c3ca7322acbf33865c1de03bf9a73c8')
    const decrypted = aesGcmDecrypt(vaultKey, encrypted, aad)
    expect(decrypted.toString('utf8')).toBe('s2-golden-plaintext')
  }, 15_000)

  it('builds length-prefixed UTF-8 AAD reliably for ASCII and CJK inputs', () => {
    const aad = buildAad('ssh-port-mapper/sync-document/v1', 'v-1', '1', '主机')
    expect(aad.toString('utf8')).toBe('ssh-port-mapper/sync-document/v1|3:v-1|1:1|6:主机')
  })

  it('creates, unlocks, recovers, and rotates vault keys using Argon2id and HKDF-SHA256', async () => {
    const vaultId = crypto.randomUUID()
    const created = await createVaultMaterial(1, 'Strong-Master-Pass-1!')
    const remoteEnvelope = { ...created.envelope, id: vaultId }
    expect(created.vaultKey.length).toBe(32)
    expect(created.recoveryKey).toMatch(
      new RegExp(`^${SYNC_RECOVERY_PREFIX}-[A-Za-z0-9_-]{43}-[0-9A-F]{12}$`)
    )

    const unlocked = await unlockVaultWithPassword(remoteEnvelope, 'Strong-Master-Pass-1!')
    expect(unlocked.equals(created.vaultKey)).toBe(true)

    await expect(unlockVaultWithPassword(remoteEnvelope, 'Wrong-Password!')).rejects.toThrow('解密失败')

    // Corrupted checksum must fail before HKDF derivation
    const corruptedRecovery = `${created.recoveryKey.slice(0, -1)}${created.recoveryKey.endsWith('0') ? '1' : '0'}`
    expect(() => parseRecoveryKeySecret(corruptedRecovery)).toThrow('校验和未通过')

    const recovered = await recoverVaultWithKey(remoteEnvelope, created.recoveryKey, 'New-Master-Pass-2!')
    expect(recovered.vaultKey.equals(created.vaultKey)).toBe(true)
    expect(recovered.updatedEnvelope).toBeDefined()

    const unlockedWithNewPass = await unlockVaultWithPassword(
      recovered.updatedEnvelope!,
      'New-Master-Pass-2!'
    )
    expect(unlockedWithNewPass.equals(created.vaultKey)).toBe(true)

    const rotated = await rotateVaultKeyMaterials(2, 'New-Master-Pass-2!')
    expect(rotated.vaultKey.equals(created.vaultKey)).toBe(false)
    expect(rotated.envelope.keyVersion).toBe(2)
  }, 15_000)

  it('encrypts, authenticates AAD & ciphertextHash, rejects oversize documents, and detects newer schemaVersion as read-only', async () => {
    const vaultId = crypto.randomUUID()
    const created = await createVaultMaterial(1, 'Vault-Password-123')
    const sampleDoc: SyncDocumentV1 = {
      schemaVersion: SYNC_SCHEMA_VERSION,
      updatedAt: '2026-11-14T10:00:00.000Z',
      preferences: { syncPasswords: true, syncPrivateKeys: false },
      servers: [
        {
          profile: {
            id: crypto.randomUUID(),
            name: 'prod-box',
            host: '10.1.2.3',
            port: 22,
            username: 'ops',
            authType: 'password',
            hostFingerprint: null,
            keepalive: 30
          },
          secrets: {
            password: 'TopSecretPassword!'
          }
        }
      ],
      tunnels: [],
      groups: []
    }

    const envelope = encryptSyncDocument(created.vaultKey, vaultId, 1, sampleDoc)
    expect(envelope.algorithm).toBe('AES-256-GCM')
    expect(envelope.ciphertext).not.toContain('TopSecretPassword!')
    expect(envelope.ciphertext).not.toContain('10.1.2.3')
    expect(envelope.ciphertextHash).toMatch(/^[0-9a-f]{64}$/)

    const decrypted = decryptSyncDocument(created.vaultKey, vaultId, envelope)
    expect(decrypted.readOnlySchema).toBe(false)
    expect(decrypted.schemaVersion).toBe(1)
    expect(
      (decrypted.rawDocument.servers as Array<{ secrets?: { password?: string } }>)[0]!.secrets?.password
    ).toBe('TopSecretPassword!')

    // Tampered keyVersion / ciphertextHash in envelope must fail verification
    expect(() => decryptSyncDocument(created.vaultKey, vaultId, { ...envelope, keyVersion: 2 })).toThrow(
      '解密失败'
    )
    expect(() =>
      decryptSyncDocument(created.vaultKey, vaultId, {
        ...envelope,
        ciphertextHash: '0'.repeat(64)
      })
    ).toThrow('校验和')

    // Future schemaVersion opens in read-only mode without throwing
    const futureRaw = { ...sampleDoc, schemaVersion: 9 } as unknown as SyncDocumentV1
    const futureEnv = encryptSyncDocument(created.vaultKey, vaultId, 1, futureRaw)
    const futureDecrypted = decryptSyncDocument(created.vaultKey, vaultId, futureEnv)
    expect(futureDecrypted.readOnlySchema).toBe(true)
    expect(futureDecrypted.schemaVersion).toBe(9)

    // Document size > 2 MiB must fail locally before upload
    const oversizedDoc: SyncDocumentV1 = {
      ...sampleDoc,
      servers: [
        {
          profile: {
            id: crypto.randomUUID(),
            name: 'huge',
            host: '10.0.0.1',
            port: 22,
            username: 'root',
            authType: 'key',
            keepalive: 30
          },
          secrets: {
            privateKey: 'A'.repeat(MAX_SYNC_DOCUMENT_BYTES + 1024)
          }
        }
      ]
    }
    expect(() => encryptSyncDocument(created.vaultKey, vaultId, 1, oversizedDoc)).toThrow('2.00 MiB')
  })

  it('generates valid unique SPM1 recovery keys', () => {
    const key = generateRecoveryKey()
    expect(parseRecoveryKeySecret(key).length).toBe(32)
  })

  it('encrypts v2 namespace documents with namespace-bound AAD, configurable size limit and keeps core v1 AAD untouched', async () => {
    const vaultId = crypto.randomUUID()
    const created = await createVaultMaterial(1, 'Vault-Password-123')
    const protocolsDoc: SyncDocumentProtocolsV2 = {
      schemaVersion: 2,
      updatedAt: '2026-11-19T00:00:00.000Z',
      preferences: { syncFileCredentials: true, syncRdpCredentials: true },
      fileProfiles: [],
      rdpProfiles: [
        {
          id: crypto.randomUUID(),
          name: 'Win-Box',
          host: '10.9.9.9',
          port: 3389,
          domain: '',
          username: 'admin',
          notes: '',
          favorite: false,
          options: {},
          secrets: { password: 'RdpTopSecret!' }
        }
      ],
      knownRdpHosts: []
    }
    const env = encryptNamespaceDocument(created.vaultKey, vaultId, 'protocols', 1, protocolsDoc)
    expect(env.schemaVersion).toBe(2)
    expect(env.ciphertext).not.toContain('RdpTopSecret!')

    const dec = decryptNamespaceDocument(created.vaultKey, vaultId, 'protocols', env)
    expect(dec.readOnlySchema).toBe(false)
    expect(
      (dec.rawDocument.rdpProfiles as Array<{ secrets: { password: string } }>)[0]!.secrets.password
    ).toBe('RdpTopSecret!')

    // Namespace is bound into AAD: a protocols ciphertext must not open as settings
    expect(() => decryptNamespaceDocument(created.vaultKey, vaultId, 'settings', env)).toThrow('解密失败')
    // v2 AAD differs from v1 core AAD domain
    expect(() => decryptSyncDocument(created.vaultKey, vaultId, env)).toThrow('解密失败')

    // Newer-than-supported namespace schema is flagged read-only
    const futureEnv = encryptNamespaceDocument(created.vaultKey, vaultId, 'protocols', 1, {
      ...protocolsDoc,
      schemaVersion: 7
    } as unknown as SyncDocumentProtocolsV2)
    expect(decryptNamespaceDocument(created.vaultKey, vaultId, 'protocols', futureEnv).readOnlySchema).toBe(
      true
    )

    // 'core' delegates to the frozen v1 path byte-compatibly
    const coreDoc: SyncDocumentV1 = {
      schemaVersion: SYNC_SCHEMA_VERSION,
      updatedAt: '2026-11-19T00:00:00.000Z',
      preferences: { syncPasswords: false, syncPrivateKeys: false },
      servers: [],
      tunnels: [],
      groups: []
    }
    const coreEnv = encryptNamespaceDocument(created.vaultKey, vaultId, 'core', 1, coreDoc)
    expect(decryptSyncDocument(created.vaultKey, vaultId, coreEnv).schemaVersion).toBe(1)

    // maxDocumentBytes from server capabilities is honored (clamped to >= 2 MiB)
    const big: SyncDocumentProtocolsV2 = {
      ...protocolsDoc,
      notes_blob: 'A'.repeat(MAX_SYNC_DOCUMENT_BYTES + 4096)
    }
    expect(() =>
      encryptNamespaceDocument(created.vaultKey, vaultId, 'protocols', 1, big, MAX_SYNC_DOCUMENT_BYTES)
    ).toThrow('2.00 MiB')
    expect(() =>
      encryptNamespaceDocument(created.vaultKey, vaultId, 'protocols', 1, big, MAX_SYNC_V2_DOCUMENT_BYTES)
    ).not.toThrow()
  })
})
