import { describe, expect, it } from 'vitest'
import {
  formationCount,
  gatheringStrength,
  sampleSwordPose
} from '../../src/renderer/src/services/sword-motion'

describe('sword formation choreography', () => {
  it('uses bounded full and light instance counts', () => {
    expect(formationCount('full', false)).toBe(144)
    expect(formationCount('light', false)).toBe(32)
    expect(formationCount('full', true)).toBe(12)
  })

  it('gathers near the climax and rests at both loop boundaries', () => {
    expect(gatheringStrength(0)).toBe(0)
    expect(gatheringStrength(13)).toBeGreaterThan(0.95)
    expect(gatheringStrength(20)).toBe(0)
  })

  it('is deterministic, finite and periodic', () => {
    const first = sampleSwordPose(7, 144, 1.25)
    const repeated = sampleSwordPose(7, 144, 1.25)
    const nextLoop = sampleSwordPose(7, 144, 21.25)
    expect(first).toEqual(repeated)
    expect(first.position.x).toBeCloseTo(nextLoop.position.x, 8)
    expect(first.position.y).toBeCloseTo(nextLoop.position.y, 8)
    expect(first.position.z).toBeCloseTo(nextLoop.position.z, 8)
    for (const value of [...Object.values(first.position), ...Object.values(first.direction)]) {
      expect(Number.isFinite(value)).toBe(true)
    }
  })

  it('moves swords closer to the heart at the gathering climax', () => {
    const resting = sampleSwordPose(11, 144, 1)
    const gathered = sampleSwordPose(11, 144, 13)
    const restingRadius = Math.hypot(resting.position.x - 0.9, resting.position.y)
    const gatheredRadius = Math.hypot(gathered.position.x - 0.9, gathered.position.y)
    expect(gatheredRadius).toBeLessThan(restingRadius * 0.45)
    expect(gathered.scale).toBeLessThan(resting.scale)
  })
})
