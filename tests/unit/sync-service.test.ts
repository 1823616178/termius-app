import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getVersion: () => '0.1.0-test'
  },
  safeStorage: {
    isAsyncEncryptionAvailable: vi.fn(async () => true),
    encryptStringAsync: vi.fn(async (plain: string) => Buffer.from(`enc:${plain}`, 'utf8')),
    decryptStringAsync: vi.fn(async (buf: Buffer) => ({
      result: buf.toString('utf8').replace(/^enc:/, ''),
      shouldReEncrypt: false
    }))
  }
}))

import type { DataClient } from '../../src/main/data-client'
import { SyncService } from '../../src/main/sync-service'
import type { SyncDataUpdate } from '../../src/shared/contracts'
import type { SyncStatusSnapshot } from '../../src/shared/sync'
import { Repository } from '../../src/workers/data-crypto/database'
import { startMockSyncServer } from '../helpers/mock-sync-server'

function createInMemoryDataClient(repo: Repository): DataClient {
  return {
    ready: Promise.resolve(),
    async call<T>(method: string, ...args: unknown[]): Promise<T> {
      const fn = repo[method as keyof Repository] as (...params: unknown[]) => unknown
      return (await fn.apply(repo, args)) as T
    },
    shutdown: async () => {},
    close: () => {}
  } as unknown as DataClient
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body === null ? '' : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  })
}

describe('SyncService state machine', () => {
  let repo: Repository
  let statuses: SyncStatusSnapshot[]
  let dataUpdates: SyncDataUpdate[]
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    repo = new Repository(':memory:')
    statuses = []
    dataUpdates = []
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    repo.close()
    vi.restoreAllMocks()
  })

  it('rejects non-loopback HTTP unless allowInsecureHttp is explicitly confirmed and persists opt-in', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/api/v1/auth/login')) {
        return jsonResponse({
          accessToken: 'acc-1',
          refreshToken: 'ref-1',
          user: { id: 'u1', email: 'user@example.com' },
          device: { id: 'dev-1', name: 'TestBox' }
        })
      }
      if (url.endsWith('/api/v1/me')) {
        return jsonResponse({ user: { id: 'u1', email: 'user@example.com' }, deviceId: 'dev-1' })
      }
      if (url.endsWith('/api/v1/vault/key-envelope')) {
        return jsonResponse({ message: 'not found' }, 404)
      }
      throw new Error(`unexpected URL: ${url}`)
    })
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch

    const service = new SyncService(
      createInMemoryDataClient(repo),
      (status) => statuses.push(status),
      (data) => dataUpdates.push(data)
    )

    await expect(
      service.login({
        serverUrl: 'http://192.168.10.20:8080',
        email: 'user@example.com',
        password: 'Password123',
        rememberEmail: true,
        keepSignedIn: false
      })
    ).rejects.toThrow('HTTPS')
    expect(fetchMock).not.toHaveBeenCalled()

    const status = await service.login({
      serverUrl: 'http://192.168.10.20:8080',
      email: 'user@example.com',
      password: 'Password123',
      rememberEmail: true,
      keepSignedIn: false,
      allowInsecureHttp: true
    })
    expect(status.signedIn).toBe(true)
    expect(status.allowInsecureHttp).toBe(true)
    expect((await service.getDefaults()).allowInsecureHttp).toBe(true)
    service.dispose()
  })

  it('deduplicates concurrent 401 token refreshes with single-flight and retries requests', async () => {
    let refreshCalls = 0
    let devicesTokenSeen: string[] = []

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>
      if (url.endsWith('/api/v1/auth/login')) {
        return jsonResponse({
          accessToken: 'expired-token',
          refreshToken: 'ref-initial',
          user: { id: 'u1', email: 'user@example.com' },
          device: { id: 'dev-1', name: 'TestBox' }
        })
      }
      if (url.endsWith('/api/v1/me')) {
        return jsonResponse({ user: { id: 'u1', email: 'user@example.com' }, deviceId: 'dev-1' })
      }
      if (url.endsWith('/api/v1/vault/key-envelope')) {
        return jsonResponse({ message: 'missing' }, 404)
      }
      if (url.endsWith('/api/v1/auth/refresh')) {
        refreshCalls++
        await new Promise((r) => setTimeout(r, 20))
        return jsonResponse({
          accessToken: 'fresh-token',
          refreshToken: 'ref-rotated',
          user: { id: 'u1', email: 'user@example.com' }
        })
      }
      if (url.endsWith('/api/v1/devices')) {
        devicesTokenSeen.push(headers.Authorization ?? '')
        if (headers.Authorization === 'Bearer expired-token') {
          return jsonResponse({ message: 'token expired' }, 401)
        }
        return jsonResponse({
          items: [
            {
              id: 'dev-1',
              name: 'TestBox',
              platform: 'win32',
              appVersion: '0.1.0',
              createdAt: '2026-11-16T00:00:00Z',
              lastSeenAt: '2026-11-16T00:00:00Z',
              current: true
            }
          ]
        })
      }
      throw new Error(`unexpected URL: ${url}`)
    })
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch

    const service = new SyncService(
      createInMemoryDataClient(repo),
      (status) => statuses.push(status),
      (data) => dataUpdates.push(data)
    )

    await service.login({
      serverUrl: 'https://sync.example.com',
      email: 'user@example.com',
      password: 'Password123',
      rememberEmail: true,
      keepSignedIn: true
    })

    const [first, second] = await Promise.all([service.listDevices(), service.listDevices()])
    expect(refreshCalls).toBe(1)
    expect(first).toHaveLength(1)
    expect(second).toHaveLength(1)
    expect(devicesTokenSeen.filter((v) => v === 'Bearer fresh-token')).toHaveLength(2)
    service.dispose()
  })

  it('runs vault creation, encrypted document upload, 409 conflict race retry, and logout cleanly', async () => {
    let remoteEnvelope: Record<string, unknown> | null = null
    let remoteRevision = 0
    let vaultMeta: Record<string, unknown> | null = null
    let putAttempts = 0

    repo.save({
      name: 'Edge-Node',
      address: '10.0.0.8',
      port: 22,
      username: 'ops',
      auth: 'password',
      keepalive: 60,
      group: '',
      notes: '',
      favorite: false
    })

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/v1/auth/register')) {
        return jsonResponse({
          accessToken: 'acc-reg',
          refreshToken: 'ref-reg',
          user: { id: 'u2', email: 'vault@example.com' },
          device: { id: 'dev-2', name: 'VaultPC' }
        })
      }
      if (url.endsWith('/api/v1/me')) {
        return jsonResponse({ user: { id: 'u2', email: 'vault@example.com' }, deviceId: 'dev-2' })
      }
      if (url.endsWith('/api/v1/vault/key-envelope')) {
        return vaultMeta ? jsonResponse(vaultMeta) : jsonResponse({ message: 'not found' }, 404)
      }
      if (url.endsWith('/api/v1/vault') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        vaultMeta = { ...body, id: 'vault-uuid-1', keyVersion: 1 }
        return jsonResponse({ id: 'vault-uuid-1', keyVersion: 1 })
      }
      if (url.endsWith('/api/v1/sync/document') && (!init?.method || init.method === 'GET')) {
        return remoteEnvelope
          ? jsonResponse(remoteEnvelope, 200, { etag: `"revision-${remoteRevision}"` })
          : jsonResponse({ message: 'not found' }, 404)
      }
      if (url.endsWith('/api/v1/sync/document') && init?.method === 'PUT') {
        putAttempts++
        if (putAttempts === 1) {
          return jsonResponse({ message: 'stale etag', code: 'ETAG_MISMATCH' }, 409)
        }
        remoteRevision++
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        remoteEnvelope = {
          ...body,
          revision: String(remoteRevision),
          updatedAt: new Date().toISOString()
        }
        return jsonResponse({ revision: remoteRevision, updatedAt: remoteEnvelope.updatedAt }, 200, {
          etag: `"revision-${remoteRevision}"`
        })
      }
      if (url.endsWith('/api/v1/auth/logout')) {
        return jsonResponse({ ok: true })
      }
      throw new Error(`unexpected URL: ${url} (${init?.method ?? 'GET'})`)
    })
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch

    const service = new SyncService(
      createInMemoryDataClient(repo),
      (status) => statuses.push(status),
      (data) => dataUpdates.push(data)
    )

    await service.register({
      serverUrl: 'http://127.0.0.1:8787',
      email: 'vault@example.com',
      password: 'RegisterPass123',
      rememberEmail: true,
      keepSignedIn: false
    })

    const created = await service.createVault({ masterPassword: 'VaultMasterPassword#1' })
    expect(created.recoveryKey).toMatch(/^SPM1-/)
    expect(created.status.phase).toBe('synced')
    expect(created.status.lastRevision).toBe('1')
    expect(putAttempts).toBe(2) // First 409 triggered automatic retry and succeeded
    expect(JSON.stringify(remoteEnvelope)).not.toContain('Edge-Node')
    expect(dataUpdates.length).toBeGreaterThanOrEqual(1)

    const afterLogout = await service.logout()
    expect(afterLogout.signedIn).toBe(false)
    expect(afterLogout.phase).toBe('signed-out')
    expect(repo.list().map((h) => h.name)).toEqual(['Edge-Node'])
    service.dispose()
  })

  it('rejects resumeSession when stored account uses non-loopback HTTP without opt-in flag', async () => {
    repo.syncAccountUpsert({
      serverUrl: 'http://sync.lan:8080',
      allowInsecureHttp: false,
      email: 'user@example.com',
      rememberEmail: true,
      keepSignedIn: true,
      autoSync: true,
      encryptedRefreshToken: Buffer.from('enc:ref-legacy', 'utf8'),
      deviceId: 'dev-1',
      deviceName: 'LegacyBox'
    })

    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch

    const service = new SyncService(
      createInMemoryDataClient(repo),
      (status) => statuses.push(status),
      (data) => dataUpdates.push(data)
    )
    await service.resumeSession()

    expect(fetchMock).not.toHaveBeenCalled()
    const status = await service.getStatus()
    expect(status.signedIn).toBe(false)
    expect(status.lastError).toContain('HTTPS')
    service.dispose()
  })
})

describe('SyncService multi-namespace sync against mock servers', () => {
  const ACCOUNT_PASSWORD = 'AccountPass123!'
  const MASTER_PASSWORD = 'MasterVaultPass#1'
  const noop = () => {}

  async function boot(serverUrl: string, mode: 'register' | 'login', email: string) {
    const repo = new Repository(':memory:')
    const service = new SyncService(createInMemoryDataClient(repo), noop, noop)
    const input = {
      serverUrl,
      email,
      password: ACCOUNT_PASSWORD,
      rememberEmail: true,
      keepSignedIn: false
    }
    if (mode === 'register') await service.register(input)
    else await service.login(input)
    return { repo, service }
  }

  it('coalesces foreground edits without starting automatic sync during restore grace', async () => {
    const server = await startMockSyncServer()
    const { repo, service } = await boot(server.url, 'register', 'restore@example.com')
    try {
      await service.createVault({ masterPassword: MASTER_PASSWORD })
      const readAccount = vi.spyOn(repo, 'syncAccountGet').mockReturnValue(undefined)
      vi.useFakeTimers()
      service.scheduleAutoSync(true)
      service.setUiBackgrounded(true)
      await vi.advanceTimersByTimeAsync(60_000)
      service.setUiBackgrounded(false)
      await vi.advanceTimersByTimeAsync(500)
      service.scheduleAutoSync(true)
      await vi.advanceTimersByTimeAsync(1999)
      expect(readAccount).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(readAccount).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
      service.dispose()
      repo.close()
      await server.close()
    }
  })

  it('degrades gracefully on a legacy v1 server: core syncs, protocols/settings stay local, capability banner data says legacy', async () => {
    const server = await startMockSyncServer()
    const email = 'legacy@example.com'
    const a = await boot(server.url, 'register', email)
    try {
      a.repo.save({ name: 'Legacy-Host', address: '10.1.1.1', port: 22, username: 'ops' })
      a.repo.fileProfileSave({ name: 'Local-FTP', protocol: 'ftp', host: 'ftp.local' })
      a.repo.protocolSettingsPatch('ssh', { defaultPort: 2299 })

      await a.service.createVault({ masterPassword: MASTER_PASSWORD })
      const status = await a.service.syncNow()

      expect(status.serverCapabilities.legacyV1Only).toBe(true)
      expect(status.serverCapabilities.supportedNamespaces).toEqual(['core'])
      expect(status.serverCapabilities.maxDocumentBytes).toBe(2 * 1024 * 1024)
      expect(status.serverCapabilities.supportsBatchVaultRotate).toBe(false)
      expect(status.phase).toBe('synced')

      const state = server.getUserState(email)
      expect(state.namespaceRevisions.core.revisionCount).toBeGreaterThanOrEqual(1)
      expect(state.namespaceRevisions.protocols.revisionCount).toBe(0)
      expect(state.namespaceRevisions.settings.revisionCount).toBe(0)
      expect(a.repo.fileProfilesList().map((p) => p.name)).toEqual(['Local-FTP'])
      expect(a.repo.protocolSettingsAll().ssh.defaultPort).toBe(2299)
      // Unsupported namespaces report no revisions instead of calling v2 endpoints
      expect(await a.service.listRevisions('protocols')).toEqual([])
    } finally {
      a.service.dispose()
      a.repo.close()
      await server.close()
    }
  })

  it('syncs file/RDP profiles, RDP cert pins and protocol settings across two devices and rotates all namespaces atomically when credential sync is disabled', async () => {
    const server = await startMockSyncServer({ multiNamespace: true })
    const email = 'multi@example.com'
    const a = await boot(server.url, 'register', email)
    let b: Awaited<ReturnType<typeof boot>> | undefined
    try {
      const fileId = a.repo.fileProfileSave(
        {
          name: 'Team-S3',
          protocol: 's3',
          username: 'AKIAXYZ',
          options: { bucket: 'bkt', region: 'us-east-1' }
        },
        Buffer.from('enc:' + JSON.stringify({ secretAccessKey: 'S3-Secret-Value' }), 'utf8')
      )[0]!.id
      const rdpId = a.repo.rdpProfileSave(
        { name: 'Win-Server', host: '10.2.2.2', username: 'admin' },
        Buffer.from('enc:RdpSecret-Value', 'utf8')
      )[0]!.id
      a.repo.rdpKnownHostTrust({
        host: '10.2.2.2',
        port: 3389,
        fingerprint: 'AA:BB:CC',
        subject: 'CN=Win',
        issuer: 'CN=Win',
        validFrom: '2026',
        validTo: '2036'
      })
      a.repo.protocolSettingsPatch('ssh', { defaultPort: 2288 })

      await a.service.createVault({ masterPassword: MASTER_PASSWORD })
      await a.service.updatePreferences({ syncFileCredentials: true, syncRdpCredentials: true })
      const statusA = await a.service.syncNow()

      expect(statusA.serverCapabilities.legacyV1Only).toBe(false)
      expect(statusA.serverCapabilities.supportedNamespaces).toEqual(['core', 'protocols', 'settings'])
      expect(statusA.serverCapabilities.supportsBatchVaultRotate).toBe(true)
      expect(statusA.serverCapabilities.maxDocumentBytes).toBe(8 * 1024 * 1024)

      const stateA = server.getUserState(email)
      expect(stateA.namespaceRevisions.protocols.revisionCount).toBeGreaterThanOrEqual(1)
      expect(stateA.namespaceRevisions.settings.revisionCount).toBeGreaterThanOrEqual(1)
      const wire = JSON.stringify(stateA.namespaceRevisions)
      for (const secret of ['S3-Secret-Value', 'RdpSecret-Value', 'Team-S3', 'Win-Server', '10.2.2.2']) {
        expect(wire).not.toContain(secret)
      }

      // Second device pulls everything
      b = await boot(server.url, 'login', email)
      await b.service.unlockVault({ masterPassword: MASTER_PASSWORD })
      expect(b.repo.fileProfilesList().map((p) => p.id)).toEqual([fileId])
      expect(b.repo.rdpProfilesList().map((p) => p.id)).toEqual([rdpId])
      expect(b.repo.rdpKnownHostsList().map((k) => k.fingerprint)).toEqual(['AA:BB:CC'])
      expect(b.repo.protocolSettingsAll().ssh.defaultPort).toBe(2288)
      const bSecrets = b.repo.syncListFileSecretBlobs()
      expect(Buffer.from(bSecrets[0]!.secret).toString('utf8')).toContain('S3-Secret-Value')
      expect(Buffer.from(b.repo.syncListRdpSecretBlobs()[0]!.secret).toString('utf8')).toBe(
        'enc:RdpSecret-Value'
      )

      // Turning off file credential sync triggers atomic batch rotation across all namespaces
      const rotated = await a.service.updatePreferences({
        syncFileCredentials: false,
        masterPassword: MASTER_PASSWORD,
        currentAccountPassword: ACCOUNT_PASSWORD
      })
      expect(rotated.rotatedRecoveryKey).toMatch(/^SPM1-/)
      expect(rotated.status.keyVersion).toBe(2)
      expect(rotated.status.syncFileCredentials).toBe(false)
      const stateRotated = server.getUserState(email)
      expect(stateRotated.vault?.keyVersion).toBe(2)
      for (const ns of ['core', 'protocols', 'settings'] as const) {
        expect(stateRotated.namespaceRevisions[ns].latestRevision?.envelope.keyVersion).toBe(2)
        expect(stateRotated.namespaceRevisions[ns].revisionCount).toBe(1)
      }
    } finally {
      a.service.dispose()
      a.repo.close()
      b?.service.dispose()
      b?.repo.close()
      await server.close()
    }
  }, 120_000)
})
