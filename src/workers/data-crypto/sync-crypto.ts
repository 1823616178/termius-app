import { createCipheriv, createDecipheriv, createHash, hkdf as hkdfCallback, randomBytes } from 'node:crypto'
import { promisify } from 'node:util'
import { argon2idSync } from './argon2id'
import {
  MAX_SYNC_DOCUMENT_BYTES,
  SYNC_A2_ITERATIONS,
  SYNC_A2_MEMORY_KIB,
  SYNC_A2_PARALLELISM,
  SYNC_A2_TAG_LENGTH,
  SYNC_AAD_DOMAIN_DOCUMENT,
  SYNC_AAD_DOMAIN_PASSWORD_WRAP,
  SYNC_AAD_DOMAIN_RECOVERY_WRAP,
  SYNC_AES_ALGORITHM,
  SYNC_GCM_NONCE_BYTES,
  SYNC_GCM_TAG_BYTES,
  SYNC_HKDF_RECOVERY_INFO,
  SYNC_RECOVERY_PREFIX,
  SYNC_SALT_BYTES,
  SYNC_SCHEMA_VERSION,
  type SyncDocumentEnvelope,
  type SyncDocumentV1,
  type VaultKdfParameters,
  type VaultMetadataWire
} from '../../shared/sync'

const hkdfAsync = promisify(hkdfCallback)

function decodeBase64Flexible(encoded: string): Buffer {
  const clean = encoded.trim()
  if (!clean) throw new Error('加密字段不能为空')
  const normalized = clean.replace(/-/g, '+').replace(/_/g, '/')
  const padLen = (4 - (normalized.length % 4)) % 4
  return Buffer.from(normalized + '='.repeat(padLen), 'base64')
}

export interface PackedAesGcmBox {
  nonce: string
  ciphertext: string
  ciphertextHash: string
}

/**
 * 构建长度前缀编码的 AAD：`domain|{utf8ByteLen}:{value}|...`
 */
export function buildAad(domain: string, ...fields: string[]): Buffer {
  const parts = [domain, ...fields.map((field) => `${Buffer.byteLength(field, 'utf8')}:${field}`)]
  return Buffer.from(parts.join('|'), 'utf8')
}

export function aesGcmEncrypt(
  key: Buffer,
  plaintext: Buffer,
  aad: Buffer,
  fixedNonce?: Buffer
): PackedAesGcmBox {
  if (key.length !== 32) throw new Error('AES-256-GCM 密钥长度必须为 32 字节')
  const nonce = fixedNonce ?? randomBytes(SYNC_GCM_NONCE_BYTES)
  if (nonce.length !== SYNC_GCM_NONCE_BYTES) throw new Error('GCM Nonce 长度无效')
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: SYNC_GCM_TAG_BYTES })
  cipher.setAAD(aad)
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  // Align wire format with HarmonyOS C++ core and ssh-tool-server: ciphertext || 16-byte GCM tag
  const combined = Buffer.concat([ct, tag])
  return {
    nonce: nonce.toString('base64'),
    ciphertext: combined.toString('base64'),
    ciphertextHash: createHash('sha256').update(combined).digest('hex')
  }
}

export function aesGcmDecrypt(
  key: Buffer,
  box: { nonce: string; ciphertext: string; ciphertextHash?: string },
  aad: Buffer
): Buffer {
  if (key.length !== 32) throw new Error('AES-256-GCM 密钥长度必须为 32 字节')
  const nonce = decodeBase64Flexible(box.nonce)
  const combined = decodeBase64Flexible(box.ciphertext)
  if (nonce.length !== SYNC_GCM_NONCE_BYTES) throw new Error('GCM Nonce 长度无效')
  if (combined.length < SYNC_GCM_TAG_BYTES) throw new Error('GCM 密文长度无效')
  if (box.ciphertextHash) {
    const actualHash = createHash('sha256').update(combined).digest('hex')
    if (actualHash !== box.ciphertextHash.trim().toLowerCase()) {
      throw new Error('解密失败：密文校验和与服务端记录不一致')
    }
  }
  const ct = combined.subarray(0, combined.length - SYNC_GCM_TAG_BYTES)
  const tag = combined.subarray(combined.length - SYNC_GCM_TAG_BYTES)
  const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: SYNC_GCM_TAG_BYTES })
  decipher.setAAD(aad)
  decipher.setAuthTag(tag)
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()])
  } catch {
    throw new Error('解密失败：主密码/恢复密钥不匹配或密文校验未通过')
  }
}

export function computeRecoveryChecksum(secretBytes: Buffer): string {
  // Match C++ vault.cpp: SHA-256(ASCII("SPM1") || raw32)[0..12) upper hex
  return createHash('sha256')
    .update(Buffer.concat([Buffer.from(SYNC_RECOVERY_PREFIX, 'ascii'), secretBytes]))
    .digest('hex')
    .slice(0, 12)
    .toUpperCase()
}

export function generateRecoveryKey(): string {
  const secret = randomBytes(32)
  const payload = secret.toString('base64url')
  return `${SYNC_RECOVERY_PREFIX}-${payload}-${computeRecoveryChecksum(secret)}`
}

export function parseRecoveryKeySecret(rawKey: string): Buffer {
  const trimmed = rawKey.trim()
  const match = new RegExp(`^${SYNC_RECOVERY_PREFIX}-([A-Za-z0-9_-]{43})-([0-9A-Fa-f]{12})$`).exec(trimmed)
  if (!match) {
    throw new Error('恢复密钥格式无效，应为 SPM1-<43位载荷>-<12位校验和>')
  }
  const secret = Buffer.from(match[1]!, 'base64url')
  if (secret.length !== 32 || secret.toString('base64url') !== match[1]) {
    throw new Error('恢复密钥载荷解码失败')
  }
  const expectedChecksum = computeRecoveryChecksum(secret)
  if (expectedChecksum !== match[2]!.toUpperCase()) {
    throw new Error('恢复密钥校验和未通过，请检查是否拼写有误')
  }
  return secret
}

export async function deriveRecoveryKek(recoveryKey: string): Promise<Buffer> {
  const secret = parseRecoveryKeySecret(recoveryKey)
  try {
    const ab = await hkdfAsync('sha256', secret, Buffer.alloc(0), SYNC_HKDF_RECOVERY_INFO, 32)
    return Buffer.from(ab)
  } finally {
    secret.fill(0)
  }
}

export async function derivePasswordKek(
  masterPassword: string,
  kdf: VaultKdfParameters,
  saltB64: string
): Promise<Buffer> {
  if (kdf.algorithm !== 'argon2id') throw new Error(`不支持的 KDF 算法：${String(kdf.algorithm)}`)
  if (
    !Number.isInteger(kdf.memory) ||
    kdf.memory < 16384 ||
    kdf.memory > 524288 ||
    !Number.isInteger(kdf.iterations) ||
    kdf.iterations < 1 ||
    kdf.iterations > 20 ||
    !Number.isInteger(kdf.parallelism) ||
    kdf.parallelism < 1 ||
    kdf.parallelism > 8
  ) {
    throw new Error('Argon2id 参数超出安全允许范围')
  }
  const salt = decodeBase64Flexible(saltB64)
  if (salt.length < 8 || salt.length > 64) throw new Error('Argon2id Salt 长度无效')
  return Buffer.from(
    argon2idSync({
      password: Buffer.from(masterPassword, 'utf8'),
      salt,
      memoryKiB: kdf.memory,
      passes: kdf.iterations,
      parallelism: kdf.parallelism,
      tagLength: SYNC_A2_TAG_LENGTH
    })
  )
}

async function wrapVaultKeyWithPassword(
  vaultKey: Buffer,
  keyVersion: number,
  masterPassword: string
): Promise<{
  passwordWrappedKey: string
  passwordWrapNonce: string
  kdfSalt: string
  kdfParameters: VaultKdfParameters
}> {
  const kdfParameters: VaultKdfParameters = {
    algorithm: 'argon2id',
    memory: SYNC_A2_MEMORY_KIB,
    iterations: SYNC_A2_ITERATIONS,
    parallelism: SYNC_A2_PARALLELISM
  }
  const kdfSalt = randomBytes(SYNC_SALT_BYTES).toString('base64')
  const kek = await derivePasswordKek(masterPassword, kdfParameters, kdfSalt)
  try {
    const aad = buildAad(SYNC_AAD_DOMAIN_PASSWORD_WRAP, String(keyVersion))
    const box = aesGcmEncrypt(kek, vaultKey, aad)
    return {
      passwordWrappedKey: box.ciphertext,
      passwordWrapNonce: box.nonce,
      kdfSalt,
      kdfParameters
    }
  } finally {
    kek.fill(0)
  }
}

async function wrapVaultKeyWithRecovery(
  vaultKey: Buffer,
  keyVersion: number,
  recoveryKey: string
): Promise<{ recoveryWrappedKey: string; recoveryWrapNonce: string }> {
  const kek = await deriveRecoveryKek(recoveryKey)
  try {
    const aad = buildAad(SYNC_AAD_DOMAIN_RECOVERY_WRAP, String(keyVersion))
    const box = aesGcmEncrypt(kek, vaultKey, aad)
    return {
      recoveryWrappedKey: box.ciphertext,
      recoveryWrapNonce: box.nonce
    }
  } finally {
    kek.fill(0)
  }
}

async function createWrappedEnvelope(
  keyVersion: number,
  masterPassword: string
): Promise<{ vaultKey: Buffer; recoveryKey: string; envelope: VaultMetadataWire }> {
  const vaultKey = randomBytes(32)
  const recoveryKey = generateRecoveryKey()
  const [pwPart, recPart] = await Promise.all([
    wrapVaultKeyWithPassword(vaultKey, keyVersion, masterPassword),
    wrapVaultKeyWithRecovery(vaultKey, keyVersion, recoveryKey)
  ])
  return {
    vaultKey,
    recoveryKey,
    envelope: {
      keyVersion,
      ...pwPart,
      ...recPart
    }
  }
}

export async function createVaultMaterial(
  keyVersion: number,
  masterPassword: string
): Promise<{ vaultKey: Buffer; recoveryKey: string; envelope: VaultMetadataWire }> {
  return createWrappedEnvelope(keyVersion, masterPassword)
}

export async function rotateVaultKeyMaterials(
  newKeyVersion: number,
  masterPassword: string
): Promise<{ vaultKey: Buffer; recoveryKey: string; envelope: VaultMetadataWire }> {
  return createWrappedEnvelope(newKeyVersion, masterPassword)
}

export async function unlockVaultWithPassword(
  envelope: VaultMetadataWire,
  masterPassword: string
): Promise<Buffer> {
  const kek = await derivePasswordKek(masterPassword, envelope.kdfParameters, envelope.kdfSalt)
  try {
    const aad = buildAad(SYNC_AAD_DOMAIN_PASSWORD_WRAP, String(envelope.keyVersion))
    const vaultKey = aesGcmDecrypt(
      kek,
      { nonce: envelope.passwordWrapNonce, ciphertext: envelope.passwordWrappedKey },
      aad
    )
    if (vaultKey.length !== 32) throw new Error('Vault Key 长度异常')
    return vaultKey
  } finally {
    kek.fill(0)
  }
}

export async function recoverVaultWithKey(
  envelope: VaultMetadataWire,
  recoveryKey: string,
  newMasterPassword?: string
): Promise<{ vaultKey: Buffer; updatedEnvelope?: VaultMetadataWire }> {
  if (!envelope.recoveryWrappedKey || !envelope.recoveryWrapNonce) {
    throw new Error('远端保管库未配置恢复密钥包裹数据')
  }
  const kek = await deriveRecoveryKek(recoveryKey)
  try {
    const aad = buildAad(SYNC_AAD_DOMAIN_RECOVERY_WRAP, String(envelope.keyVersion))
    const vaultKey = aesGcmDecrypt(
      kek,
      { nonce: envelope.recoveryWrapNonce, ciphertext: envelope.recoveryWrappedKey },
      aad
    )
    if (vaultKey.length !== 32) throw new Error('Vault Key 长度异常')
    if (!newMasterPassword) return { vaultKey }

    const pwPart = await wrapVaultKeyWithPassword(vaultKey, envelope.keyVersion, newMasterPassword)
    return {
      vaultKey,
      updatedEnvelope: {
        ...envelope,
        ...pwPart
      }
    }
  } finally {
    kek.fill(0)
  }
}

export function encryptSyncDocument(
  vaultKey: Buffer,
  vaultId: string,
  keyVersion: number,
  document: SyncDocumentV1
): SyncDocumentEnvelope {
  const serialized = JSON.stringify(document)
  const byteSize = Buffer.byteLength(serialized, 'utf8')
  if (byteSize > MAX_SYNC_DOCUMENT_BYTES) {
    throw new Error(
      `同步文档体积 ${(byteSize / 1024 / 1024).toFixed(2)} MiB 超过服务端上限 2.00 MiB，请精简数据后重试`
    )
  }
  const aad = buildAad(SYNC_AAD_DOMAIN_DOCUMENT, vaultId, String(document.schemaVersion), String(keyVersion))
  const box = aesGcmEncrypt(vaultKey, Buffer.from(serialized, 'utf8'), aad)
  if (Buffer.byteLength(box.ciphertext, 'utf8') > MAX_SYNC_DOCUMENT_BYTES) {
    throw new Error('加密后的同步文档体积超过服务端 2.00 MiB 限制，请精简数据后重试')
  }
  return {
    schemaVersion: document.schemaVersion,
    keyVersion,
    algorithm: SYNC_AES_ALGORITHM,
    nonce: box.nonce,
    ciphertext: box.ciphertext,
    ciphertextHash: box.ciphertextHash
  }
}

export interface DecryptedRemoteDocument {
  schemaVersion: number
  readOnlySchema: boolean
  rawDocument: Record<string, unknown>
}

export function decryptSyncDocument(
  vaultKey: Buffer,
  vaultId: string,
  envelope: SyncDocumentEnvelope
): DecryptedRemoteDocument {
  if (envelope.algorithm && envelope.algorithm !== SYNC_AES_ALGORITHM) {
    throw new Error(`不支持的文档加密算法：${envelope.algorithm}`)
  }
  const aad = buildAad(
    SYNC_AAD_DOMAIN_DOCUMENT,
    vaultId,
    String(envelope.schemaVersion),
    String(envelope.keyVersion)
  )
  const plaintext = aesGcmDecrypt(
    vaultKey,
    { nonce: envelope.nonce, ciphertext: envelope.ciphertext, ciphertextHash: envelope.ciphertextHash },
    aad
  )
  let parsed: unknown
  try {
    parsed = JSON.parse(plaintext.toString('utf8'))
  } catch {
    throw new Error('远端同步文档 JSON 解析失败')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('远端同步文档结构无效')
  }
  const record = parsed as Record<string, unknown>
  const version = typeof record.schemaVersion === 'number' ? record.schemaVersion : envelope.schemaVersion
  return {
    schemaVersion: version,
    readOnlySchema: version > SYNC_SCHEMA_VERSION,
    rawDocument: record
  }
}
