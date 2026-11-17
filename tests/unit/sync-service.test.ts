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
