import { describe, expect, it, vi } from 'vitest'
import {
  assessMotionCapability,
  isSoftwareRenderer,
  parseMotionPreference,
  parseMotionTier,
  probeMotionGraphics,
  REDUCED_MOTION_REASON,
  resolveMotionPreference,
  sampleMotionFrame
} from '../../src/renderer/src/services/motion-performance'

describe('motion performance capability', () => {
  it.each([
    [{ webgl2Supported: true, hardwareConcurrency: 16, deviceMemory: 16 }, 'full'],
    [{ webgl2Supported: true, hardwareConcurrency: 4, deviceMemory: 16 }, 'light'],
    [{ webgl2Supported: true, hardwareConcurrency: 16, deviceMemory: 4 }, 'light'],
    [{ webgl2Supported: true, hardwareConcurrency: 2, deviceMemory: 16 }, 'off'],
    [{ webgl2Supported: true, hardwareConcurrency: 16, deviceMemory: 2 }, 'off'],
    [{ webgl2Supported: true, hardwareConcurrency: 16, renderer: 'ANGLE (SwiftShader)' }, 'off'],
    [{ webgl2Supported: false, hardwareConcurrency: 16, deviceMemory: 16 }, 'off']
  ] as const)('evaluates capability without a benchmark: %o', (input, tier) => {
    expect(assessMotionCapability(input).tier).toBe(tier)
  })

  it('does not punish unavailable hardware hints or unknown renderer names', () => {
    const capability = assessMotionCapability({ webgl2Supported: true })
    expect(capability).toMatchObject({
      tier: 'full',
      softwareRenderer: false,
      cpuCores: null,
      memoryGb: null
    })
    expect(assessMotionCapability({ webgl2Supported: true, renderer: 'WebKit WebGL' }).tier).toBe('full')
  })

  it.each([
    'SwiftShader Device (Subzero)',
    'llvmpipe (LLVM 15.0.6)',
    'softpipe',
    'Microsoft Basic Render Driver'
  ])('recognizes software rendering: %s', (renderer) => {
    expect(isSoftwareRenderer(renderer)).toBe(true)
  })
  it.each([
    'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0)',
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0)'
  ])('accepts hardware renderers: %s', (renderer) => {
    expect(isSoftwareRenderer(renderer)).toBe(false)
  })

  it('honors reduced motion in automatic mode only', () => {
    const capability = assessMotionCapability({ webgl2Supported: true, reducedMotion: true })
    expect(capability).toMatchObject({ tier: 'off', reason: REDUCED_MOTION_REASON })
  })
})

describe('motion preference resolution', () => {
  it('keeps the scene off until the store has initialized an explicit tier', () => {
    expect(parseMotionTier(undefined)).toBe('off')
    expect(parseMotionTier('')).toBe('off')
    expect(parseMotionTier('unexpected')).toBe('off')
    expect(parseMotionTier('off')).toBe('off')
    expect(parseMotionTier('light')).toBe('light')
    expect(parseMotionTier('full')).toBe('full')
  })

  it('keeps auto as the default and migrates explicit legacy choices', () => {
    expect(parseMotionPreference(null)).toBe('auto')
    expect(parseMotionPreference('full')).toBe('full')
    expect(parseMotionPreference('light')).toBe('light')
    expect(parseMotionPreference('off')).toBe('off')
    expect(parseMotionPreference('invalid')).toBe('auto')
  })

  it('allows the user to force full motion over weak hardware and reduced motion', () => {
    const capability = assessMotionCapability({ webgl2Supported: false, reducedMotion: true })
    expect(resolveMotionPreference('full', capability).tier).toBe('full')
    expect(resolveMotionPreference('full', capability).reason).toContain('强制')
    expect(resolveMotionPreference('auto', capability).tier).toBe('off')
    expect(resolveMotionPreference('light', capability).tier).toBe('light')
    expect(resolveMotionPreference('off', capability).tier).toBe('off')
  })
})

describe('graphics capability probe cleanup', () => {
  it('does not replace a successful probe when context cleanup throws', () => {
    const loseContext = vi.fn(() => {
      throw new Error('Simulated cleanup failure')
    })
    const gl = {
      RENDERER: 7937,
      getParameter: () => 'Hardware Test GPU',
      getExtension: (name: string) => (name === 'WEBGL_lose_context' ? { loseContext } : null)
    }
    const canvas = { getContext: () => gl } as unknown as HTMLCanvasElement
    expect(probeMotionGraphics(canvas)).toEqual({ webgl2Supported: true, renderer: 'Hardware Test GPU' })
    expect(loseContext).toHaveBeenCalledOnce()
  })
})

describe('sustained frame rate sampling', () => {
  it('does not downgrade after one slow sample', () => {
    expect(sampleMotionFrame({ tier: 'full', fps: 30, slowWindows: 0 })).toMatchObject({
      tier: 'full',
      slowWindows: 1
    })
  })

  it('downgrades full to light and then light to off after sustained low fps', () => {
    expect(sampleMotionFrame({ tier: 'full', fps: 30, slowWindows: 1 }).tier).toBe('light')
    expect(sampleMotionFrame({ tier: 'light', fps: 20, slowWindows: 1 }).tier).toBe('off')
  })

  it('resets the slow streak after a healthy sample', () => {
    expect(sampleMotionFrame({ tier: 'full', fps: 60, slowWindows: 1 }).slowWindows).toBe(0)
    expect(sampleMotionFrame({ tier: 'light', fps: 30, slowWindows: 1 })).toMatchObject({
      tier: 'light',
      slowWindows: 0
    })
  })

  it('does not change the tier for borderline healthy rates or a static scene', () => {
    expect(sampleMotionFrame({ tier: 'full', fps: 42, slowWindows: 1 }).tier).toBe('full')
    expect(sampleMotionFrame({ tier: 'light', fps: 24, slowWindows: 1 }).tier).toBe('light')
    expect(sampleMotionFrame({ tier: 'off', fps: 0, slowWindows: 0 }).tier).toBe('off')
  })
})
