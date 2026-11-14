import { describe, expect, it } from 'vitest'
import { SYNC_SCHEMA_VERSION, type SyncDocumentV1 } from '../../src/shared/sync'
import {
  buildLocalWireDocument,
  normalizeRemoteDocument,
  threeWayMerge,
  type LocalSyncSource
} from '../../src/workers/data-crypto/sync-merge'

function makeBaseSource(hostId: string): LocalSyncSource {
  return {
    hosts: [
      {
        id: hostId,
        name: 'App-Node',
        address: '10.0.0.5',
        port: 22,
        username: 'ubuntu',
        auth: 'password',
        keepalive: 30,
        group: 'local-only-group',
        notes: 'local-only-note',
        favorite: true,
        hasPassword: true,
        updatedAt: '2026-11-14T00:00:00.000Z'
      }
    ],
    plaintextPasswords: { [hostId]: 'InitialSecret!' },
    knownFingerprints: { '10.0.0.5:22': 'SHA256:hostfp' },
    groups: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Core',
        color: '#3B82F6',
        updatedAt: '2026-11-14T00:00:00.000Z'
      }
    ],
    tunnels: [],
    tunnelExtras: {},
    groupExtras: {},
    preferences: { syncPasswords: true, syncPrivateKeys: false }
  }
}

describe('Sync DTO projection & three-way merge', () => {
  it('excludes local host.group/notes/favorite from wire DTO and preserves unknown remote fields', () => {
    const hostId = crypto.randomUUID()
    const source = makeBaseSource(hostId)
    source.hosts[0]!.syncExtras = {
      serverExtra: { customTag: 'from-ohos' },
      profileExtra: { customProfileFlag: 42 },
      secrets: {
        privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nDEMO\n-----END OPENSSH PRIVATE KEY-----',
        passphrase: 'kp'
      }
    }

    const wire = buildLocalWireDocument(source)
    const wireServer = wire.servers[0]!
    expect('id' in wireServer).toBe(false)
    expect('groupId' in wireServer.profile).toBe(false)
    expect('group' in wireServer.profile).toBe(false)
    expect('notes' in wireServer.profile).toBe(false)
    expect(wireServer.customTag).toBe('from-ohos')
    expect(wireServer.profile.customProfileFlag).toBe(42)
    expect(wireServer.secrets?.password).toBe('InitialSecret!')
    expect(wireServer.secrets?.privateKey).toContain('OPENSSH PRIVATE KEY')

    // Disabling syncPasswords must omit plaintext password & passphrase from the uploaded wire document
    source.preferences.syncPasswords = false
    const strippedWire = buildLocalWireDocument(source)
    expect(strippedWire.servers[0]!.secrets?.password).toBeUndefined()
    expect(strippedWire.servers[0]!.secrets?.passphrase).toBeUndefined()
  })

  it('auto-merges non-conflicting field updates across local and remote', () => {
    const hostId = crypto.randomUUID()
    const baseSource = makeBaseSource(hostId)
    const baseDoc = buildLocalWireDocument(baseSource, '2026-11-14T00:00:00.000Z')

    const localSource = makeBaseSource(hostId)
    localSource.hosts[0]!.port = 2222

    const remoteDoc: SyncDocumentV1 = {
      ...structuredClone(baseDoc),
      updatedAt: '2026-11-14T01:00:00.000Z',
      servers: [
        {
          ...structuredClone(baseDoc.servers[0]!),
          profile: {
            ...structuredClone(baseDoc.servers[0]!.profile),
            username: 'ops-admin'
          }
        }
      ],
      tunnels: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          name: 'Remote-Unknown-Type',
          serverId: hostId,
          groupId: null,
          type: 'X-FUTURE',
          listenHost: '127.0.0.1',
          listenPort: 9000,
          destHost: '127.0.0.1',
          destPort: 9001,
          destServerId: '',
          autoReconnect: true,
          enabled: true,
          extraTunnelProp: 'keep-me'
        }
      ]
    }

    const merge = threeWayMerge({ localSource, baseDoc, remoteDoc })
    expect(merge.conflicts).toHaveLength(0)
    expect(merge.needsUpload).toBe(true)
    expect(merge.merged.servers[0]!.profile.port).toBe(2222)
    expect(merge.merged.servers[0]!.profile.username).toBe('ops-admin')
    expect(merge.localTunnels[0]!.readOnly).toBe(true)
    expect(merge.merged.tunnels[0]!.extraTunnelProp).toBe('keep-me')
  })

  it('detects conflicts with masked passwords and applies explicit resolutions', () => {
    const hostId = crypto.randomUUID()
    const baseSource = makeBaseSource(hostId)
    const baseDoc = buildLocalWireDocument(baseSource)

    const localSource = makeBaseSource(hostId)
    localSource.plaintextPasswords[hostId] = 'Local-New-Secret-123'

    const remoteDoc = structuredClone(baseDoc)
    remoteDoc.servers[0]!.secrets = {
      ...(remoteDoc.servers[0]!.secrets ?? {}),
      password: 'Remote-New-Secret-99'
    }

    const conflictResult = threeWayMerge({ localSource, baseDoc, remoteDoc })
    expect(conflictResult.conflicts).toHaveLength(1)
    const conflict = conflictResult.conflicts[0]!
    expect(conflict.isSecret).toBe(true)
    expect(conflict.localDisplay).not.toContain('Local-New-Secret-123')
    expect(conflict.remoteDisplay).not.toContain('Remote-New-Secret-99')

    const resolved = threeWayMerge({
      localSource,
      baseDoc,
      remoteDoc,
      resolutions: { [conflict.id]: 'remote' }
    })
    expect(resolved.conflicts).toHaveLength(0)
    expect(resolved.merged.servers[0]!.secrets?.password).toBe('Remote-New-Secret-99')
    expect(resolved.localHostUpdates[0]!.passwordTouched).toBe(true)
    expect(resolved.localHostUpdates[0]!.plaintextPassword).toBe('Remote-New-Secret-99')
  })

  it('deletes locally untouched host when absent in cleanly decrypted remote document', () => {
    const hostA = crypto.randomUUID()
    const hostB = crypto.randomUUID()
    const baseSource = makeBaseSource(hostA)
    baseSource.hosts.push({
      ...baseSource.hosts[0]!,
      id: hostB,
      name: 'Remove-Me',
      address: '10.0.0.9'
    })
    const baseDoc = buildLocalWireDocument(baseSource)

    const remoteRaw: Record<string, unknown> = {
      schemaVersion: SYNC_SCHEMA_VERSION,
      updatedAt: '2026-11-14T02:00:00.000Z',
      preferences: baseDoc.preferences,
      servers: baseDoc.servers.filter((s) => s.profile.id === hostA),
      tunnels: [],
      groups: baseDoc.groups
    }
    const remoteDoc = normalizeRemoteDocument(remoteRaw)

    const merge = threeWayMerge({ localSource: baseSource, baseDoc, remoteDoc })
    expect(merge.conflicts).toHaveLength(0)
    expect(merge.deletedHostIds).toEqual([hostB])
    expect(merge.localHostUpdates.map((u) => u.host.id)).toEqual([hostA])
    expect(merge.needsUpload).toBe(false)
  })
})
