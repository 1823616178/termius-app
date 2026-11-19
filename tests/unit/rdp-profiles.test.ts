import { describe, expect, it, vi } from 'vitest'
import { normalizeProtocolSettings, protocolSettingsPatchSchema } from '../../src/shared/files'
import {
  DEFAULT_RDP_SETTINGS,
  rdpConnectSourceSchema,
  rdpProfileInputSchema,
  type RdpEnvironmentProbe
} from '../../src/shared/rdp'
import type { DataClient } from '../../src/main/data-client'
import { RdpService, resolveRdpLaunchConfig } from '../../src/main/rdp/service'

const probeWithSchemeA: RdpEnvironmentProbe = {
  platform: 'win32',
  displaySession: 'windows',
  schemeAAvailable: true,
  schemeABinary: 'mstsc.exe',
  schemeABinaryPath: 'C:\\Windows\\System32\\mstsc.exe',
  schemeACmdkeyAvailable: true,
  schemeBAvailable: true,
  schemeBEngine: 'ironrdp-wasm',
  candidates: []
}

const probeMissingSchemeA: RdpEnvironmentProbe = {
  platform: 'linux',
  displaySession: 'wayland',
  schemeAAvailable: false,
  schemeACmdkeyAvailable: false,
  schemeAMissingReason: 'Ubuntu 当前为 Wayland 会话，未检测到 wlfreerdp3 / xfreerdp3',
  schemeAInstallHint: 'sudo apt update && sudo apt install -y freerdp3-wayland',
  schemeBAvailable: true,
  schemeBEngine: 'ironrdp-wasm',
  candidates: []
}

describe('RDP profile schemas & settings normalization', () => {
  it('validates minimal and complete RDP profiles and rejects unsafe control chars', () => {
    const minimal = rdpProfileInputSchema.parse({ name: 'Win Box', host: '10.0.0.50' })
    expect(minimal.port).toBe(3389)
    expect(minimal.savePassword).toBe(false)

    expect(rdpProfileInputSchema.safeParse({ name: 'BadHost', host: '10.0.0.1\r\nfoo' }).success).toBe(false)
    expect(rdpProfileInputSchema.safeParse({ name: 'SpaceHost', host: '10.0.0.1 /x' }).success).toBe(false)
    expect(
      rdpProfileInputSchema.safeParse({
        name: 'ConflictPw',
        host: '10.0.0.1',
        password: 'pw',
        clearPassword: true
      }).success
    ).toBe(false)
    expect(
      rdpConnectSourceSchema.safeParse({ kind: 'profile', profileId: crypto.randomUUID() }).success
    ).toBe(true)
  })

  it('defaults rdp settings to Scheme A (external) with fallback and patches without overwriting siblings', () => {
    const def = normalizeProtocolSettings('rdp', undefined)
    expect(def).toEqual(DEFAULT_RDP_SETTINGS)
    expect(def.preferredMode).toBe('external')
    expect(def.autoFallbackToEmbedded).toBe(true)

    const partial = protocolSettingsPatchSchema.parse({
      namespace: 'rdp',
      patch: { preferredMode: 'embedded', defaultWidth: 1920 }
    })
    expect(partial.namespace).toBe('rdp')
    expect(partial.patch).toEqual({ preferredMode: 'embedded', defaultWidth: 1920 })

    const normalized = normalizeProtocolSettings('rdp', {
      preferredMode: 'embedded',
      defaultWidth: 99999 // invalid -> drops back to default only for this field
    })
    expect(normalized.preferredMode).toBe('embedded')
    expect(normalized.defaultWidth).toBe(1280)
  })
})

describe('Scheme A preferred & Scheme B fallback resolution', () => {
  it('starts explicit Scheme B sessions without probing for an external client', async () => {
    const probeFn = vi.fn().mockResolvedValue(probeWithSchemeA)
    const service = new RdpService({
      data: { call: vi.fn().mockResolvedValue({ rdp: DEFAULT_RDP_SETTINGS }) } as unknown as DataClient,
      encryptSecret: vi.fn(),
      decryptSecret: vi.fn(),
      emitSessionState: vi.fn(),
      emitCertPrompt: vi.fn(),
      probeFn
    })
    try {
      const session = await service.connect(1, {
        kind: 'adhoc',
        host: '127.0.0.1',
        launchModeOverride: 'embedded'
      })
      expect(session.mode).toBe('embedded')
      expect(session.embeddedParams?.proxyAddress).toMatch(/^ws:\/\/127\.0\.0\.1:/)
      expect(probeFn).not.toHaveBeenCalled()
    } finally {
      await service.shutdownAll()
    }
  })

  it('uses Scheme A by default when native client is available, and switches cleanly to Scheme B', () => {
    const schemeA = resolveRdpLaunchConfig({
      settings: DEFAULT_RDP_SETTINGS,
      options: {},
      probe: probeWithSchemeA
    })
    expect(schemeA.effectiveMode).toBe('external')
    expect(schemeA.fallbackFromExternal).toBe(false)

    const switchedInSettings = resolveRdpLaunchConfig({
      settings: { ...DEFAULT_RDP_SETTINGS, preferredMode: 'embedded' },
      options: {},
      probe: probeWithSchemeA
    })
    expect(switchedInSettings.effectiveMode).toBe('embedded')
    expect(switchedInSettings.fallbackFromExternal).toBe(false)

    const perHostOverrideToB = resolveRdpLaunchConfig({
      settings: DEFAULT_RDP_SETTINGS,
      options: { launchMode: 'embedded', width: 1600 },
      probe: probeWithSchemeA
    })
    expect(perHostOverrideToB.effectiveMode).toBe('embedded')
    expect(perHostOverrideToB.width).toBe(1600)
  })

  it('auto-falls back from Scheme A to Scheme B when enabled, and throws install hint when disabled', () => {
    const fellBack = resolveRdpLaunchConfig({
      settings: DEFAULT_RDP_SETTINGS,
      options: {},
      probe: probeMissingSchemeA
    })
    expect(fellBack.effectiveMode).toBe('embedded')
    expect(fellBack.fallbackFromExternal).toBe(true)
    expect(fellBack.fallbackReason).toContain('Wayland')

    expect(() =>
      resolveRdpLaunchConfig({
        settings: { ...DEFAULT_RDP_SETTINGS, autoFallbackToEmbedded: false },
        options: {},
        probe: probeMissingSchemeA
      })
    ).toThrow(/freerdp3-wayland/)
  })
})
