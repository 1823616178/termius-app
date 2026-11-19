import { describe, expect, it } from 'vitest'
import { DEFAULT_FILES_SETTINGS, DEFAULT_SSH_SETTINGS, type FileProfile } from '../../src/shared/files'
import { DEFAULT_RDP_SETTINGS, type KnownRdpHostEntry, type RdpProfile } from '../../src/shared/rdp'
import {
  buildLocalProtocolsDocument,
  buildLocalSettingsDocument,
  normalizeRemoteProtocolsDocument,
  normalizeRemoteSettingsDocument,
  threeWayMergeProtocols,
  threeWayMergeSettings,
  type LocalProtocolsSyncSource
} from '../../src/workers/data-crypto/sync-merge-v2'

const FILE_ID = '22222222-2222-4222-8222-222222222222'
const RDP_ID = '33333333-3333-4333-8333-333333333333'

function fileProfile(overrides: Partial<FileProfile> = {}): FileProfile {
  return {
    id: FILE_ID,
    name: 'Prod-S3',
    protocol: 's3',
    host: '',
    port: 0,
    username: 'AKIA123',
    initialPath: '',
    notes: '',
    favorite: false,
    options: { bucket: 'b', region: 'eu-west-1' },
    hasSecrets: true,
    updatedAt: '2026-11-19T00:00:00.000Z',
    ...overrides
  }
}

function rdpProfile(overrides: Partial<RdpProfile> = {}): RdpProfile {
  return {
    id: RDP_ID,
    name: 'Win-Desktop',
    host: '10.0.0.8',
    port: 3389,
    domain: '',
    username: 'admin',
    notes: '',
    favorite: false,
    options: {},
    hasPassword: true,
    updatedAt: '2026-11-19T00:00:00.000Z',
    ...overrides
  }
}

function makeSource(over: Partial<LocalProtocolsSyncSource> = {}): LocalProtocolsSyncSource {
  const known: KnownRdpHostEntry[] = [
    {
      id: '10.0.0.8:3389',
      host: '10.0.0.8',
      port: 3389,
      fingerprint: 'AA:BB',
      subject: 'CN=Win',
      issuer: 'CN=Win',
      validFrom: '2026',
      validTo: '2036',
      acceptedAt: '2026-11-19T00:00:00.000Z'
    }
  ]
  return {
    fileProfiles: [fileProfile()],
    plaintextFileSecrets: { [FILE_ID]: { secretAccessKey: 'S3-Secret-One' } },
    rdpProfiles: [rdpProfile()],
    plaintextRdpPasswords: { [RDP_ID]: 'RdpPass-One' },
    knownRdpHosts: known,
    preferences: { syncFileCredentials: true, syncRdpCredentials: true },
    ...over
  }
}

describe('protocols namespace 3-way merge', () => {
  it('includes secrets only when the matching credential-sync switch is on', () => {
    const on = buildLocalProtocolsDocument(makeSource())
    expect(on.fileProfiles[0]!.secrets?.secretAccessKey).toBe('S3-Secret-One')
    expect(on.rdpProfiles[0]!.secrets?.password).toBe('RdpPass-One')

    const off = buildLocalProtocolsDocument(
      makeSource({ preferences: { syncFileCredentials: false, syncRdpCredentials: false } })
    )
    expect(off.fileProfiles[0]!.secrets).toBeUndefined()
    expect(off.rdpProfiles[0]!.secrets).toBeUndefined()
    expect(JSON.stringify(off)).not.toContain('S3-Secret-One')
    expect(JSON.stringify(off)).not.toContain('RdpPass-One')
  })

  it('uploads local state when remote is empty and pulls remote-only entities on a fresh device', () => {
    const source = makeSource()
    const first = threeWayMergeProtocols({ localSource: source, baseDoc: null, remoteDoc: null })
    expect(first.needsUpload).toBe(true)
    expect(first.conflicts).toHaveLength(0)

    const remote = normalizeRemoteProtocolsDocument(JSON.parse(JSON.stringify(first.merged)))
    const fresh = makeSource({
      fileProfiles: [],
      plaintextFileSecrets: {},
      rdpProfiles: [],
      plaintextRdpPasswords: {},
      knownRdpHosts: [],
      preferences: { syncFileCredentials: false, syncRdpCredentials: false }
    })
    const pulled = threeWayMergeProtocols({ localSource: fresh, baseDoc: null, remoteDoc: remote })
    expect(pulled.conflicts).toHaveLength(0)
    expect(pulled.localFileProfileUpdates.map((u) => u.profile.id)).toEqual([FILE_ID])
    expect(pulled.localRdpProfileUpdates.map((u) => u.profile.id)).toEqual([RDP_ID])
    expect(pulled.localKnownRdpHosts).toHaveLength(1)
    // fresh device adopts remote credential switches and secrets
    expect(pulled.nextPreferences).toEqual({ syncFileCredentials: true, syncRdpCredentials: true })
    expect(pulled.localFileProfileUpdates[0]!.plaintextSecrets?.secretAccessKey).toBe('S3-Secret-One')
    expect(pulled.localRdpProfileUpdates[0]!.plaintextPassword).toBe('RdpPass-One')
  })

  it('raises redacted conflicts for concurrent secret edits and honours resolutions', () => {
    const baseDoc = buildLocalProtocolsDocument(makeSource())
    const localSource = makeSource({
      plaintextFileSecrets: { [FILE_ID]: { secretAccessKey: 'Local-Changed-Secret' } },
      plaintextRdpPasswords: { [RDP_ID]: 'Local-Rdp-Changed' }
    })
    const remoteRaw = JSON.parse(JSON.stringify(baseDoc)) as typeof baseDoc
    remoteRaw.fileProfiles[0]!.secrets = { secretAccessKey: 'Remote-Changed-Secret' }
    remoteRaw.rdpProfiles[0]!.secrets = { password: 'Remote-Rdp-Changed' }
    const remoteDoc = normalizeRemoteProtocolsDocument(remoteRaw)

    const merge = threeWayMergeProtocols({ localSource, baseDoc, remoteDoc })
    expect(merge.conflicts.map((c) => c.id).sort()).toEqual(
      [`fileProfile:${FILE_ID}:secrets.secretAccessKey`, `rdpProfile:${RDP_ID}:secrets.password`].sort()
    )
    for (const conflict of merge.conflicts) {
      expect(conflict.isSecret).toBe(true)
      expect(conflict.namespace).toBe('protocols')
      const shown = `${conflict.localDisplay}|${conflict.remoteDisplay}`
      expect(shown).not.toContain('Changed')
      expect(shown).toContain('••••••')
    }

    const resolved = threeWayMergeProtocols({
      localSource,
      baseDoc,
      remoteDoc,
      resolutions: {
        [`fileProfile:${FILE_ID}:secrets.secretAccessKey`]: 'remote',
        [`rdpProfile:${RDP_ID}:secrets.password`]: 'local'
      }
    })
    expect(resolved.conflicts).toHaveLength(0)
    const mergedFile = resolved.merged.fileProfiles[0]!
    expect(mergedFile.secrets?.secretAccessKey).toBe('Remote-Changed-Secret')
    expect(resolved.merged.rdpProfiles[0]!.secrets?.password).toBe('Local-Rdp-Changed')
  })

  it('auto-merges disjoint field edits and propagates remote deletions of untouched entities', () => {
    const baseDoc = buildLocalProtocolsDocument(makeSource())
    const localSource = makeSource({ fileProfiles: [fileProfile({ notes: 'local note' })] })
    const remoteRaw = JSON.parse(JSON.stringify(baseDoc)) as typeof baseDoc
    remoteRaw.fileProfiles[0]!.username = 'AKIA-REMOTE'
    remoteRaw.rdpProfiles = []
    const merge = threeWayMergeProtocols({
      localSource,
      baseDoc,
      remoteDoc: normalizeRemoteProtocolsDocument(remoteRaw)
    })
    expect(merge.conflicts).toHaveLength(0)
    expect(merge.merged.fileProfiles[0]!.notes).toBe('local note')
    expect(merge.merged.fileProfiles[0]!.username).toBe('AKIA-REMOTE')
    expect(merge.deletedRdpProfileIds).toEqual([RDP_ID])
  })
})

describe('settings namespace 3-way merge', () => {
  const allDefaults = { ssh: DEFAULT_SSH_SETTINGS, files: DEFAULT_FILES_SETTINGS, rdp: DEFAULT_RDP_SETTINGS }

  it('strips machine-local RDP paths from the wire document', () => {
    const doc = buildLocalSettingsDocument({
      protocolSettings: {
        ...allDefaults,
        rdp: {
          ...DEFAULT_RDP_SETTINGS,
          externalClientPath: 'C:\\secret\\freerdp.exe',
          sharedDrivePath: 'D:\\share'
        }
      },
      preferences: { syncProtocolSettings: true }
    })
    expect(JSON.stringify(doc)).not.toContain('freerdp.exe')
    expect(JSON.stringify(doc)).not.toContain('D:\\\\share')
    expect(doc.protocolSettings.rdp).not.toHaveProperty('externalClientPath')
  })

  it('adopts remote values over untouched defaults, keeps local paths, and flags real conflicts', () => {
    const remoteRaw = buildLocalSettingsDocument({
      protocolSettings: {
        ...allDefaults,
        ssh: { ...DEFAULT_SSH_SETTINGS, defaultPort: 2201 },
        rdp: { ...DEFAULT_RDP_SETTINGS, preferredMode: 'embedded' }
      },
      preferences: { syncProtocolSettings: true }
    })
    const remoteDoc = normalizeRemoteSettingsDocument(JSON.parse(JSON.stringify(remoteRaw)))

    const localDefaults = {
      ...allDefaults,
      rdp: { ...DEFAULT_RDP_SETTINGS, externalClientPath: '/usr/bin/xfreerdp3' }
    }
    const adopt = threeWayMergeSettings({
      localSource: { protocolSettings: localDefaults, preferences: { syncProtocolSettings: true } },
      baseDoc: null,
      remoteDoc
    })
    expect(adopt.conflicts).toHaveLength(0)
    expect(adopt.nextProtocolSettings.ssh.defaultPort).toBe(2201)
    expect(adopt.nextProtocolSettings.rdp.preferredMode).toBe('embedded')
    expect(adopt.nextProtocolSettings.rdp.externalClientPath).toBe('/usr/bin/xfreerdp3')

    // Non-default local value vs different remote value with no base -> conflict
    const conflict = threeWayMergeSettings({
      localSource: {
        protocolSettings: { ...localDefaults, ssh: { ...DEFAULT_SSH_SETTINGS, defaultPort: 2300 } },
        preferences: { syncProtocolSettings: true }
      },
      baseDoc: null,
      remoteDoc
    })
    expect(conflict.conflicts.map((c) => c.id)).toEqual(['protocolSettings:ssh:defaultPort'])
    expect(conflict.conflicts[0]!.namespace).toBe('settings')

    const resolved = threeWayMergeSettings({
      localSource: {
        protocolSettings: { ...localDefaults, ssh: { ...DEFAULT_SSH_SETTINGS, defaultPort: 2300 } },
        preferences: { syncProtocolSettings: true }
      },
      baseDoc: null,
      remoteDoc,
      resolutions: { 'protocolSettings:ssh:defaultPort': 'local' }
    })
    expect(resolved.conflicts).toHaveLength(0)
    expect(resolved.nextProtocolSettings.ssh.defaultPort).toBe(2300)
    expect(resolved.needsUpload).toBe(true)
  })
})
