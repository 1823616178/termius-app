import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import {
  MAX_SYNC_DOCUMENT_BYTES,
  MAX_SYNC_V2_DOCUMENT_BYTES,
  SYNC_NAMESPACES,
  type SyncDocumentEnvelope,
  type SyncNamespace,
  type VaultMetadataWire
} from '../../src/shared/sync'

interface StoredDevice {
  id: string
  name: string
  platform: string
  appVersion: string
  createdAt: string
  lastSeenAt: string
}

interface StoredRevision {
  revision: string
  schemaVersion: number
  keyVersion: number
  algorithm: 'AES-256-GCM'
  nonce: string
  ciphertext: string
  ciphertextHash: string
  createdByDeviceId: string
  createdByDeviceName: string
  createdAt: string
}

interface StoredUser {
  id: string
  email: string
  passwordHash: string
  vault?: VaultMetadataWire & { id: string }
  revisions: StoredRevision[]
  namespaceRevisions: Record<SyncNamespace, StoredRevision[]>
  devices: Map<string, StoredDevice>
  idempotencyCache: Map<string, { status: number; body: unknown; headers?: Record<string, string> }>
}

interface RefreshRecord {
  email: string
  deviceId: string
  used: boolean
}

export interface MockSyncServerOptions {
  multiNamespace?: boolean
  maxDocumentBytes?: number
  supportsBatchVaultRotate?: boolean
}

export interface MockSyncServerHandle {
  url: string
  close(): Promise<void>
  getUserState(email: string): {
    vault?: VaultMetadataWire & { id: string }
    latestRevision?: { revision: string; envelope: SyncDocumentEnvelope }
    revisionCount: number
    namespaceRevisions: Record<
      SyncNamespace,
      {
        latestRevision?: { revision: string; envelope: SyncDocumentEnvelope }
        revisionCount: number
      }
    >
    devices: number
    refreshRotateCount: number
  }
  pushSimulatedRemoteRevision(
    email: string,
    envelope: SyncDocumentEnvelope,
    deviceId?: string,
    namespace?: SyncNamespace
  ): { revision: string; updatedAt: string }
  expireAllAccessTokens(): void
}

function assertNonEmptyString(val: unknown, field: string): string {
  if (typeof val !== 'string' || !val.trim()) {
    throw new Error(`Invalid input: expected string, received ${typeof val} (${field})`)
  }
  return val.trim()
}

function sha256HexOfBase64(b64: string): string {
  return createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex')
}

export async function startMockSyncServer(
  options: MockSyncServerOptions = {}
): Promise<MockSyncServerHandle> {
  const multiNamespace = Boolean(options.multiNamespace)
  const maxDocumentBytes =
    options.maxDocumentBytes ?? (multiNamespace ? MAX_SYNC_V2_DOCUMENT_BYTES : MAX_SYNC_DOCUMENT_BYTES)
  const supportsBatchVaultRotate = options.supportsBatchVaultRotate ?? multiNamespace
  const users = new Map<string, StoredUser>()
  const accessTokens = new Map<string, { email: string; deviceId: string }>()
  const refreshTokens = new Map<string, RefreshRecord>()
  let refreshRotateCount = 0

  function hashPassword(pw: string): string {
    return createHash('sha256').update(pw).digest('hex')
  }

  function issueTokens(email: string, deviceId: string) {
    const accessToken = `acc_${randomBytes(24).toString('hex')}`
    const refreshToken = `ref_${randomBytes(24).toString('hex')}`
    accessTokens.set(accessToken, { email, deviceId })
    refreshTokens.set(refreshToken, { email, deviceId, used: false })
    return { accessToken, refreshToken, expiresIn: 900 }
  }

  async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const text = Buffer.concat(chunks).toString('utf8')
    return text ? (JSON.parse(text) as Record<string, unknown>) : {}
  }

  function sendJson(
    res: ServerResponse,
    status: number,
    payload: unknown,
    headers: Record<string, string> = {}
  ): void {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      ...headers
    })
    res.end(payload === null ? 'null' : JSON.stringify(payload))
  }

  function sendApiError(res: ServerResponse, status: number, code: string, message: string): void {
    sendJson(res, status, {
      statusCode: status,
      statusMessage: code,
      message,
      data: { code, message }
    })
  }

  function requireAuth(
    req: IncomingMessage,
    res: ServerResponse
  ): { user: StoredUser; deviceId: string } | undefined {
    const authHeader = req.headers.authorization ?? ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
    const session = accessTokens.get(token)
    if (!session) {
      sendApiError(res, 401, 'AUTH_TOKEN_EXPIRED', '访问令牌无效或已过期')
      return undefined
    }
    const user = users.get(session.email)
    if (!user || !user.devices.has(session.deviceId)) {
      sendApiError(res, 401, 'AUTH_UNAUTHORIZED', '设备会话已被注销')
      return undefined
    }
    user.devices.get(session.deviceId)!.lastSeenAt = new Date().toISOString()
    return { user, deviceId: session.deviceId }
  }

  function parseIfMatch(header: string | undefined): string | null {
    if (!header) return null
    const clean = header.trim().replace(/^"+|"+$/g, '')
    const match = /^revision-(\d+)$/.exec(clean)
    return match ? match[1]! : null
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const path = url.pathname
      const method = req.method ?? 'GET'

      if (method === 'POST' && path === '/api/v1/auth/register') {
        const body = await readJsonBody(req)
        const email = assertNonEmptyString(body.email, 'email').toLowerCase()
        const password = assertNonEmptyString(body.password, 'password')
        if (password.length < 10) {
          return sendApiError(
            res,
            400,
            'VALIDATION_ERROR',
            'Too small: expected string to have >=10 characters'
          )
        }
        const devInput = (body.device ?? {}) as Record<string, unknown>
        const deviceName = assertNonEmptyString(devInput.name, 'device.name')
        const platform = assertNonEmptyString(devInput.platform, 'device.platform')
        const appVersion = assertNonEmptyString(devInput.appVersion, 'device.appVersion')

        if (users.has(email)) return sendApiError(res, 409, 'AUTH_EMAIL_EXISTS', '该邮箱已注册')
        const now = new Date().toISOString()
        const deviceId = randomUUID()
        const userId = randomUUID()
        const coreRevs: StoredRevision[] = []
        const user: StoredUser = {
          id: userId,
          email,
          passwordHash: hashPassword(password),
          revisions: coreRevs,
          namespaceRevisions: {
            core: coreRevs,
            protocols: [],
            settings: []
          },
          devices: new Map([
            [
              deviceId,
              {
                id: deviceId,
                name: deviceName,
                platform,
                appVersion,
                createdAt: now,
                lastSeenAt: now
              }
            ]
          ]),
          idempotencyCache: new Map()
        }
        users.set(email, user)
        const tokens = issueTokens(email, deviceId)
        return sendJson(res, 200, {
          ...tokens,
          user: { id: user.id, email: user.email },
          device: { id: deviceId, name: deviceName }
        })
      }

      if (method === 'POST' && path === '/api/v1/auth/login') {
        const body = await readJsonBody(req)
        const email = assertNonEmptyString(body.email, 'email').toLowerCase()
        const password = assertNonEmptyString(body.password, 'password')
        const devInput = (body.device ?? {}) as Record<string, unknown>
        const deviceName = assertNonEmptyString(devInput.name, 'device.name')
        const platform = assertNonEmptyString(devInput.platform, 'device.platform')
        const appVersion = assertNonEmptyString(devInput.appVersion, 'device.appVersion')

        const user = users.get(email)
        if (!user || user.passwordHash !== hashPassword(password)) {
          return sendApiError(res, 401, 'AUTH_INVALID_CREDENTIALS', '邮箱或密码不正确')
        }
        const now = new Date().toISOString()
        const deviceId = randomUUID()
        user.devices.set(deviceId, {
          id: deviceId,
          name: deviceName,
          platform,
          appVersion,
          createdAt: now,
          lastSeenAt: now
        })
        const tokens = issueTokens(email, deviceId)
        return sendJson(res, 200, {
          ...tokens,
          user: { id: user.id, email: user.email },
          device: { id: deviceId, name: deviceName }
        })
      }

      if (method === 'POST' && path === '/api/v1/auth/refresh') {
        const body = await readJsonBody(req)
        if ('deviceId' in body) {
          return sendApiError(res, 400, 'VALIDATION_ERROR', 'Unrecognized key: "deviceId"')
        }
        const token = assertNonEmptyString(body.refreshToken, 'refreshToken')
        const record = refreshTokens.get(token)
        if (!record || record.used) {
          if (record?.used) {
            users.get(record.email)?.devices.delete(record.deviceId)
            return sendApiError(res, 401, 'AUTH_TOKEN_REUSED', '检测到刷新令牌重用，当前设备会话已吊销')
          }
          return sendApiError(res, 401, 'AUTH_TOKEN_EXPIRED', '刷新令牌无效或已过期')
        }
        record.used = true
        const user = users.get(record.email)
        const dev = user?.devices.get(record.deviceId)
        if (!user || !dev) {
          return sendApiError(res, 401, 'AUTH_UNAUTHORIZED', '设备会话不存在')
        }
        refreshRotateCount++
        const nextTokens = issueTokens(record.email, record.deviceId)
        return sendJson(res, 200, {
          ...nextTokens,
          user: { id: user.id, email: user.email },
          device: { id: dev.id, name: dev.name }
        })
      }

      const auth = requireAuth(req, res)
      if (!auth) return
      const { user, deviceId } = auth

      if (method === 'POST' && path === '/api/v1/auth/logout') {
        for (const [accTok, sess] of accessTokens.entries()) {
          if (sess.email === user.email && sess.deviceId === deviceId) accessTokens.delete(accTok)
        }
        for (const rec of refreshTokens.values()) {
          if (rec.email === user.email && rec.deviceId === deviceId) rec.used = true
        }
        user.devices.delete(deviceId)
        return sendJson(res, 200, { ok: true })
      }

      if (method === 'GET' && path === '/api/v1/me') {
        return sendJson(res, 200, {
          user: { id: user.id, email: user.email },
          deviceId
        })
      }

      if (multiNamespace && method === 'GET' && path === '/api/v1/capabilities') {
        return sendJson(res, 200, {
          maxSchemaVersion: 2,
          supportedNamespaces: ['core', 'protocols', 'settings'],
          maxDocumentBytes,
          supportsBatchVaultRotate
        })
      }

      if (method === 'GET' && path === '/api/v1/devices') {
        return sendJson(res, 200, {
          items: [...user.devices.values()].map((d) => ({ ...d, current: d.id === deviceId }))
        })
      }

      if (method === 'DELETE' && path.startsWith('/api/v1/devices/')) {
        const targetId = decodeURIComponent(path.slice('/api/v1/devices/'.length))
        if (targetId === deviceId) {
          return sendApiError(res, 400, 'DEVICE_CURRENT', '不能直接吊销当前正在使用的设备')
        }
        user.devices.delete(targetId)
        return sendJson(res, 200, { revoked: true })
      }

      if (method === 'GET' && path === '/api/v1/vault/key-envelope') {
        if (!user.vault) return sendApiError(res, 404, 'VAULT_NOT_FOUND', '尚未创建同步密钥库')
        return sendJson(res, 200, user.vault)
      }

      if (method === 'POST' && path === '/api/v1/vault') {
        const idemKey = String(req.headers['idempotency-key'] ?? '')
        if (!idemKey) return sendApiError(res, 400, 'VALIDATION_ERROR', '缺少 Idempotency-Key')
        if (user.idempotencyCache.has(idemKey)) {
          const cached = user.idempotencyCache.get(idemKey)!
          return sendJson(res, cached.status, cached.body, cached.headers)
        }
        if (user.vault) return sendApiError(res, 409, 'VAULT_ALREADY_EXISTS', '同步密钥库已存在')
        const body = (await readJsonBody(req)) as unknown as VaultMetadataWire
        if (!body.kdfParameters || typeof body.kdfParameters.iterations !== 'number') {
          return sendApiError(res, 400, 'VALIDATION_ERROR', 'Invalid kdfParameters')
        }
        const vaultId = randomUUID()
        user.vault = { ...body, id: vaultId, keyVersion: Number(body.keyVersion || 1) }
        const result = { id: vaultId, keyVersion: user.vault.keyVersion }
        user.idempotencyCache.set(idemKey, { status: 201, body: result })
        return sendJson(res, 201, result)
      }

      if (method === 'PUT' && path === '/api/v1/vault/key-envelope') {
        if (!user.vault) return sendApiError(res, 404, 'VAULT_NOT_FOUND', '尚未创建同步密钥库')
        const body = (await readJsonBody(req)) as Record<string, unknown>
        const currentPw = assertNonEmptyString(body.currentPassword, 'currentPassword')
        if (hashPassword(currentPw) !== user.passwordHash) {
          return sendApiError(res, 401, 'AUTH_INVALID_CREDENTIALS', '当前账号密码不正确')
        }
        const nextEnv = body as unknown as VaultMetadataWire
        user.vault = {
          id: user.vault.id,
          keyVersion: Number(nextEnv.keyVersion),
          passwordWrappedKey: nextEnv.passwordWrappedKey,
          passwordWrapNonce: nextEnv.passwordWrapNonce,
          recoveryWrappedKey: nextEnv.recoveryWrappedKey,
          recoveryWrapNonce: nextEnv.recoveryWrapNonce,
          kdfSalt: nextEnv.kdfSalt,
          kdfParameters: nextEnv.kdfParameters
        }
        return sendJson(res, 200, user.vault)
      }

      if (method === 'POST' && path === '/api/v1/vault/rotate') {
        const idemKey = String(req.headers['idempotency-key'] ?? '')
        if (!idemKey) return sendApiError(res, 400, 'VALIDATION_ERROR', '缺少 Idempotency-Key')
        if (user.idempotencyCache.has(idemKey)) {
          const cached = user.idempotencyCache.get(idemKey)!
          return sendJson(res, cached.status, cached.body, cached.headers)
        }
        if (!user.vault) return sendApiError(res, 404, 'VAULT_NOT_FOUND', '尚未创建同步密钥库')
        const body = (await readJsonBody(req)) as {
          currentPassword: string
          keyEnvelope: VaultMetadataWire
          document?: SyncDocumentEnvelope
          documents?: Partial<Record<SyncNamespace, SyncDocumentEnvelope>>
          baseRevisions?: Partial<Record<SyncNamespace, string>>
        }
        if (
          hashPassword(assertNonEmptyString(body.currentPassword, 'currentPassword')) !== user.passwordHash
        ) {
          return sendApiError(res, 401, 'AUTH_INVALID_CREDENTIALS', '当前账号密码不正确')
        }
        const latestCoreRev = user.namespaceRevisions.core.at(-1)?.revision ?? '0'
        const ifMatchRev = parseIfMatch(req.headers['if-match']) ?? body.baseRevisions?.core ?? null
        if (ifMatchRev !== latestCoreRev) {
          return sendApiError(res, 409, 'SYNC_REVISION_CONFLICT', '同步版本号不一致')
        }

        const now = new Date().toISOString()
        const dev = user.devices.get(deviceId)!
        const batchDocs =
          multiNamespace && supportsBatchVaultRotate && body.documents
            ? body.documents
            : body.document
              ? { core: body.document }
              : {}

        if (!batchDocs.core) {
          return sendApiError(res, 400, 'VALIDATION_ERROR', 'Missing core document on rotate')
        }

        for (const ns of SYNC_NAMESPACES) {
          const env = batchDocs[ns]
          if (!env) continue
          if (sha256HexOfBase64(env.ciphertext) !== env.ciphertextHash) {
            return sendApiError(res, 400, 'VALIDATION_ERROR', `${ns} ciphertextHash mismatch`)
          }
          if (ns !== 'core' && body.baseRevisions?.[ns] !== undefined) {
            const latestNsRev = user.namespaceRevisions[ns].at(-1)?.revision ?? '0'
            if (String(body.baseRevisions[ns]) !== latestNsRev) {
              return sendApiError(res, 409, 'SYNC_REVISION_CONFLICT', `${ns} 同步版本号不一致`)
            }
          }
        }

        user.vault = { ...body.keyEnvelope, id: user.vault.id }
        const nextRevisions: Partial<Record<SyncNamespace, string>> = {}
        for (const ns of SYNC_NAMESPACES) {
          const env = batchDocs[ns]
          if (!env) continue
          const latestNsRev = user.namespaceRevisions[ns].at(-1)?.revision ?? '0'
          const nextRev = String(BigInt(latestNsRev) + BigInt(1))
          nextRevisions[ns] = nextRev
          const rotatedList: StoredRevision[] = [
            {
              revision: nextRev,
              schemaVersion: env.schemaVersion,
              keyVersion: body.keyEnvelope.keyVersion,
              algorithm: env.algorithm,
              nonce: env.nonce,
              ciphertext: env.ciphertext,
              ciphertextHash: env.ciphertextHash,
              createdByDeviceId: deviceId,
              createdByDeviceName: dev.name,
              createdAt: now
            }
          ]
          user.namespaceRevisions[ns] = rotatedList
          if (ns === 'core') user.revisions = rotatedList
        }

        const coreNextRev = nextRevisions.core!
        const responseBody = {
          id: user.vault.id,
          keyVersion: user.vault.keyVersion,
          revision: coreNextRev,
          ...(multiNamespace ? { revisions: nextRevisions } : {}),
          updatedAt: now
        }
        const headers = { ETag: `"revision-${coreNextRev}"` }
        user.idempotencyCache.set(idemKey, { status: 200, body: responseBody, headers })
        return sendJson(res, 200, responseBody, headers)
      }

      const resolveDocNamespace = (p: string): SyncNamespace | null => {
        if (p === '/api/v1/sync/document') return 'core'
        if (!multiNamespace) return null
        const m = /^\/api\/v1\/sync\/documents\/(core|protocols|settings)$/.exec(p)
        return m ? (m[1] as SyncNamespace) : null
      }

      const docNs = resolveDocNamespace(path)
      if ((method === 'GET' || method === 'HEAD') && docNs) {
        if (!user.vault) return sendApiError(res, 404, 'VAULT_NOT_FOUND', '尚未创建同步密钥库')
        const latest = user.namespaceRevisions[docNs].at(-1)
        if (!latest) return sendApiError(res, 404, 'SYNC_DOCUMENT_NOT_FOUND', '尚未上传同步文档')
        if (method === 'HEAD') {
          res.writeHead(204, {
            ETag: `"revision-${latest.revision}"`,
            'X-Sync-Revision': latest.revision,
            'X-Key-Version': String(latest.keyVersion)
          })
          return res.end()
        }
        return sendJson(
          res,
          200,
          {
            revision: latest.revision,
            schemaVersion: latest.schemaVersion,
            keyVersion: latest.keyVersion,
            algorithm: latest.algorithm,
            nonce: latest.nonce,
            ciphertext: latest.ciphertext,
            ciphertextHash: latest.ciphertextHash,
            updatedByDeviceId: latest.createdByDeviceId,
            updatedAt: latest.createdAt
          },
          { ETag: `"revision-${latest.revision}"` }
        )
      }

      if (method === 'PUT' && docNs) {
        const idemKey = String(req.headers['idempotency-key'] ?? '')
        if (!idemKey) return sendApiError(res, 400, 'VALIDATION_ERROR', '缺少 Idempotency-Key')
        if (user.idempotencyCache.has(idemKey)) {
          const cached = user.idempotencyCache.get(idemKey)!
          return sendJson(res, cached.status, cached.body, cached.headers)
        }
        if (!user.vault) return sendApiError(res, 404, 'VAULT_NOT_FOUND', '尚未创建同步密钥库')
        const revList = user.namespaceRevisions[docNs]
        const latestRev = revList.at(-1)?.revision ?? '0'
        const ifMatchRev = parseIfMatch(req.headers['if-match'])
        if (ifMatchRev !== latestRev) {
          return sendApiError(res, 409, 'SYNC_REVISION_CONFLICT', '远端已有更新版本，需要合并冲突')
        }
        const body = (await readJsonBody(req)) as Record<string, unknown>
        if ('envelope' in body || 'baseRevision' in body) {
          return sendApiError(res, 400, 'VALIDATION_ERROR', 'Unexpected wrapper keys on /sync/document')
        }
        const doc = body as unknown as SyncDocumentEnvelope
        if (doc.keyVersion !== user.vault.keyVersion) {
          return sendApiError(res, 409, 'VAULT_KEY_VERSION_MISMATCH', '密钥版本不一致')
        }
        if (doc.algorithm !== 'AES-256-GCM') {
          return sendApiError(res, 400, 'VALIDATION_ERROR', 'Unsupported algorithm')
        }
        if (Buffer.byteLength(doc.ciphertext, 'utf8') > maxDocumentBytes) {
          return sendApiError(res, 413, 'PAYLOAD_TOO_LARGE', 'Encrypted document exceeds maxDocumentBytes')
        }
        if (sha256HexOfBase64(doc.ciphertext) !== doc.ciphertextHash) {
          return sendApiError(res, 400, 'VALIDATION_ERROR', 'ciphertextHash mismatch')
        }
        const nextRev = String(BigInt(latestRev) + BigInt(1))
        const now = new Date().toISOString()
        const dev = user.devices.get(deviceId)!
        revList.push({
          revision: nextRev,
          schemaVersion: doc.schemaVersion,
          keyVersion: doc.keyVersion,
          algorithm: doc.algorithm,
          nonce: doc.nonce,
          ciphertext: doc.ciphertext,
          ciphertextHash: doc.ciphertextHash,
          createdByDeviceId: deviceId,
          createdByDeviceName: dev.name,
          createdAt: now
        })
        const result = { revision: nextRev, updatedAt: now }
        const headers = { ETag: `"revision-${nextRev}"` }
        user.idempotencyCache.set(idemKey, { status: 200, body: result, headers })
        return sendJson(res, 200, result, headers)
      }

      const revListMatch =
        path === '/api/v1/sync/revisions'
          ? ('core' as SyncNamespace)
          : multiNamespace
            ? ((/^\/api\/v1\/sync\/documents\/(core|protocols|settings)\/revisions$/.exec(path)?.[1] as
                | SyncNamespace
                | undefined) ?? null)
            : null

      if (method === 'GET' && revListMatch) {
        return sendJson(res, 200, {
          items: [...user.namespaceRevisions[revListMatch]].reverse().map((r) => ({
            revision: r.revision,
            schemaVersion: r.schemaVersion,
            keyVersion: r.keyVersion,
            algorithm: r.algorithm,
            ciphertextHash: r.ciphertextHash,
            createdByDevice: { id: r.createdByDeviceId, name: r.createdByDeviceName },
            createdAt: r.createdAt
          }))
        })
      }

      const restoreMatch = (() => {
        const legacy = /^\/api\/v1\/sync\/revisions\/(\d+)\/restore$/.exec(path)
        if (legacy) return { ns: 'core' as SyncNamespace, rev: legacy[1]! }
        if (!multiNamespace) return null
        const v2 = /^\/api\/v1\/sync\/documents\/(core|protocols|settings)\/revisions\/(\d+)\/restore$/.exec(
          path
        )
        return v2 ? { ns: v2[1] as SyncNamespace, rev: v2[2]! } : null
      })()

      if (method === 'POST' && restoreMatch) {
        const { ns, rev } = restoreMatch
        const idemKey = String(req.headers['idempotency-key'] ?? '')
        if (!idemKey) return sendApiError(res, 400, 'VALIDATION_ERROR', '缺少 Idempotency-Key')
        if (!user.vault) return sendApiError(res, 404, 'VAULT_NOT_FOUND', '尚未创建同步密钥库')
        const revList = user.namespaceRevisions[ns]
        const found = revList.find((r) => r.revision === rev)
        if (!found) return sendApiError(res, 404, 'SYNC_REVISION_NOT_FOUND', '同步历史版本不存在')
        if (found.keyVersion !== user.vault.keyVersion) {
          return sendApiError(res, 409, 'VAULT_KEY_VERSION_MISMATCH', '历史版本使用的密钥已不再有效')
        }
        const latestRev = revList.at(-1)?.revision ?? '0'
        if (parseIfMatch(req.headers['if-match']) !== latestRev) {
          return sendApiError(res, 409, 'SYNC_REVISION_CONFLICT', '同步版本号不一致')
        }
        const nextRev = String(BigInt(latestRev) + BigInt(1))
        const now = new Date().toISOString()
        const dev = user.devices.get(deviceId)!
        revList.push({
          ...found,
          revision: nextRev,
          createdByDeviceId: deviceId,
          createdByDeviceName: dev.name,
          createdAt: now
        })
        return sendJson(
          res,
          200,
          { revision: nextRev, restoredFromRevision: rev, updatedAt: now },
          { ETag: `"revision-${nextRev}"` }
        )
      }

      sendApiError(res, 404, 'NOT_FOUND', 'Unknown endpoint')
    } catch (error) {
      sendApiError(res, 400, 'VALIDATION_ERROR', error instanceof Error ? error.message : 'Mock server error')
    }
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    getUserState(email: string) {
      const user = users.get(email.toLowerCase())
      const formatRev = (r?: StoredRevision) =>
        r
          ? {
              revision: r.revision,
              envelope: {
                revision: r.revision,
                schemaVersion: r.schemaVersion,
                keyVersion: r.keyVersion,
                algorithm: r.algorithm,
                nonce: r.nonce,
                ciphertext: r.ciphertext,
                ciphertextHash: r.ciphertextHash,
                updatedByDeviceId: r.createdByDeviceId,
                updatedAt: r.createdAt
              }
            }
          : undefined
      const latest = user?.namespaceRevisions.core.at(-1)
      return {
        vault: user?.vault,
        latestRevision: formatRev(latest),
        revisionCount: user?.namespaceRevisions.core.length ?? 0,
        namespaceRevisions: {
          core: {
            latestRevision: formatRev(user?.namespaceRevisions.core.at(-1)),
            revisionCount: user?.namespaceRevisions.core.length ?? 0
          },
          protocols: {
            latestRevision: formatRev(user?.namespaceRevisions.protocols.at(-1)),
            revisionCount: user?.namespaceRevisions.protocols.length ?? 0
          },
          settings: {
            latestRevision: formatRev(user?.namespaceRevisions.settings.at(-1)),
            revisionCount: user?.namespaceRevisions.settings.length ?? 0
          }
        },
        devices: user?.devices.size ?? 0,
        refreshRotateCount
      }
    },
    pushSimulatedRemoteRevision(
      email: string,
      envelope: SyncDocumentEnvelope,
      deviceId = 'remote-peer',
      namespace: SyncNamespace = 'core'
    ) {
      const user = users.get(email.toLowerCase())
      if (!user) throw new Error(`Mock user not found: ${email}`)
      const revList = user.namespaceRevisions[namespace]
      const latestRev = revList.at(-1)?.revision ?? '0'
      const nextRev = String(BigInt(latestRev) + BigInt(1))
      const updatedAt = envelope.updatedAt || new Date().toISOString()
      revList.push({
        revision: nextRev,
        schemaVersion: envelope.schemaVersion,
        keyVersion: envelope.keyVersion,
        algorithm: envelope.algorithm,
        nonce: envelope.nonce,
        ciphertext: envelope.ciphertext,
        ciphertextHash: envelope.ciphertextHash,
        createdByDeviceId: deviceId,
        createdByDeviceName: 'HarmonyOS Peer',
        createdAt: updatedAt
      })
      return { revision: nextRev, updatedAt }
    },
    expireAllAccessTokens() {
      accessTokens.clear()
    }
  }
}
