import { describe, expect, it } from 'vitest'
import {
  formationCount,
  gatheringStrength,
  IMPACT_SECONDS,
  INTRO_SECONDS,
  LOOP_SECONDS,
  sampleFormationWeights,
  sampleIntroSwordPose,
  sampleStageState,
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
    expect(first.stretch).toBeCloseTo(nextLoop.stretch, 8)
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

  it('arranges concentric radial Sword Lotus halo during the lotus phase', () => {
    const weights = sampleFormationWeights(7.0)
    expect(weights.lotus).toBeGreaterThan(0.9)
    expect(weights.phaseLabel).toContain('剑莲')

    const pose = sampleSwordPose(15, 144, 7.0)
    const radialX = pose.position.x - 0.9
    const radialY = pose.position.y - 0.22
    const dot = radialX * pose.direction.x + radialY * pose.direction.y
    expect(dot).toBeGreaterThan(0.5)
  })

  it('fires double golden pulses and stretched sword volley during the 13-15s climax', () => {
    const pulseA = sampleFormationWeights(13.3)
    const volleyPeak = sampleFormationWeights(14.0)
    const pulseB = sampleFormationWeights(14.3)
    const calm = sampleFormationWeights(1.5)

    expect(pulseA.pulsePrimary).toBeGreaterThan(0.6)
    expect(pulseA.volley).toBeGreaterThan(0.2)
    expect(volleyPeak.volley).toBeGreaterThan(0.95)
    expect(pulseB.pulseSecondary).toBeGreaterThan(0.4)
    expect(calm.pulse).toBe(0)

    const volleySword = sampleSwordPose(7, 144, 14.5)
    expect(volleySword.stretch).toBeGreaterThan(1.4)
    expect(volleySword.energy).toBeGreaterThan(0.5)
  })

  it('plunges divine sword into cracked earth and spawns clones before ascending', () => {
    const startStage = sampleStageState(0, 0)
    const impactStage = sampleStageState(0.75, 0.75)
    const midStage = sampleStageState(1.2, 1.2)
    const endStage = sampleStageState(INTRO_SECONDS, INTRO_SECONDS)

    expect(startStage.mainSwordY).toBeGreaterThan(2)
    expect(startStage.mainSwordInvert).toBeCloseTo(Math.PI, 4)
    expect(startStage.crackReveal).toBe(0)
    expect(startStage.cameraZ).toBeGreaterThan(endStage.cameraZ)
    expect(startStage.ringUnfold).toBe(0)
    expect(startStage.weights.phaseLabel).toContain('天剑破空')

    expect(IMPACT_SECONDS).toBeCloseTo(0.42, 3)
    expect(impactStage.mainSwordY).toBeLessThan(0)
    expect(impactStage.mainSwordInvert).toBeCloseTo(Math.PI, 4)
    expect(impactStage.groundReveal).toBeGreaterThan(0.8)
    expect(impactStage.crackReveal).toBeGreaterThan(0.7)
    expect(impactStage.debrisOpacity).toBeGreaterThan(0.5)
    expect(impactStage.introShockwave).toBeGreaterThan(0.3)
    expect(impactStage.groundShockwave).toBeGreaterThan(0.3)
    expect(impactStage.weights.phaseLabel).toContain('裂地')

    expect(midStage.ringUnfold).toBeGreaterThan(0.5)
    expect(midStage.weights.phaseLabel).toContain('万剑分身')
    expect(endStage.mainSwordY).toBeCloseTo(0, 6)
    expect(endStage.mainSwordInvert).toBeCloseTo(0, 6)
    expect(endStage.groundReveal).toBeCloseTo(0, 6)
    expect(endStage.crackReveal).toBeCloseTo(0, 6)
    expect(endStage.ringUnfold).toBe(1)

    const preImpactSword = sampleIntroSwordPose(25, 144, 0.2, 0.2)
    expect(preImpactSword.scale).toBe(0)
    expect(Math.abs(preImpactSword.position.x - 0.9)).toBeLessThan(0.12)

    const emergingSword = sampleIntroSwordPose(25, 144, 1.3, 1.3)
    expect(emergingSword.scale).toBeGreaterThan(0)

    const settledSword = sampleIntroSwordPose(25, 144, INTRO_SECONDS, INTRO_SECONDS)
    expect(settledSword).toEqual(sampleSwordPose(25, 144, INTRO_SECONDS))
  })

  it('remains finite across every sword and phase in the loop', () => {
    for (let t = 0; t <= LOOP_SECONDS; t += 2.5) {
      for (let i = 0; i < 144; i += 17) {
        const pose = sampleSwordPose(i, 144, t)
        const introPose = sampleIntroSwordPose(i, 144, t, Math.min(INTRO_SECONDS, t))
        for (const value of [
          ...Object.values(pose.position),
          ...Object.values(pose.direction),
          pose.scale,
          pose.glow,
          pose.stretch,
          pose.energy,
          ...Object.values(introPose.position),
          ...Object.values(introPose.direction)
        ]) {
          expect(Number.isFinite(value)).toBe(true)
        }
      }
    }
  })
})
