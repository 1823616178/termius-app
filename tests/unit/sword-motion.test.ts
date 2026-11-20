import { describe, expect, it } from 'vitest'
import {
  createEmptyPose,
  DEPTH_FOCUS_Z,
  FORMATIONS,
  formationCount,
  formationDepthAt,
  gatheringStrength,
  HEART_X,
  IMPACT_SECONDS,
  INTRO_SECONDS,
  LINK_SEGMENT_CAPACITY,
  LOOP_SECONDS,
  MOVEMENT_SECONDS,
  sampleFormationLinks,
  sampleFormationWeights,
  sampleIntroSwordPose,
  sampleIntroSwordPoseInto,
  sampleSkySwordPoseInto,
  sampleStageState,
  sampleSwordPose,
  skyFormationCount
} from '../../src/renderer/src/services/sword-motion'

function linkCountAt(time: number): number {
  const positions = new Float32Array(LINK_SEGMENT_CAPACITY * 2 * 3)
  const weights = new Float32Array(LINK_SEGMENT_CAPACITY * 2)
  const colors = new Uint8Array(LINK_SEGMENT_CAPACITY * 2)
  const count = sampleFormationLinks(time, positions, weights, colors)
  expect(count).toBeLessThanOrEqual(LINK_SEGMENT_CAPACITY)
  for (let v = 0; v < count * 2; v++) {
    expect(weights[v]).toBeGreaterThanOrEqual(0)
    expect(weights[v]).toBeLessThanOrEqual(1)
    expect(Number.isFinite(positions[v * 3]!)).toBe(true)
    expect(Number.isFinite(positions[v * 3 + 1]!)).toBe(true)
    expect(Number.isFinite(positions[v * 3 + 2]!)).toBe(true)
  }
  return count
}

describe('twelve named sword formations', () => {
  it('uses bounded full, light, compact and sky sword instance counts', () => {
    expect(formationCount('full', false)).toBe(3600)
    expect(formationCount('light', false)).toBe(180)
    expect(formationCount('full', true)).toBe(24)
    expect(formationCount('light', true)).toBe(12)
    expect(formationCount('off', false)).toBe(0)
    expect(skyFormationCount('full', false)).toBe(5760)
    expect(skyFormationCount('light', false)).toBe(120)
    expect(skyFormationCount('full', true)).toBe(0)
    expect(skyFormationCount('off', false)).toBe(0)
    expect(FORMATIONS).toHaveLength(12)
  })

  it('is deterministic, finite and periodic over the grand cycle', () => {
    const total = formationCount('full', false)
    const first = sampleSwordPose(7, total, 1.25)
    const repeated = sampleSwordPose(7, total, 1.25)
    const nextLoop = sampleSwordPose(7, total, 1.25 + LOOP_SECONDS)
    expect(first).toEqual(repeated)
    expect(first.position.x).toBeCloseTo(nextLoop.position.x, 8)
    expect(first.position.y).toBeCloseTo(nextLoop.position.y, 8)
    expect(first.position.z).toBeCloseTo(nextLoop.position.z, 8)
    expect(first.stretch).toBeCloseTo(nextLoop.stretch, 8)
    for (const value of [...Object.values(first.position), ...Object.values(first.direction)]) {
      expect(Number.isFinite(value)).toBe(true)
    }
  })

  it('names each movement in sequence across the grand cycle', () => {
    for (let m = 0; m < FORMATIONS.length; m++) {
      const weights = sampleFormationWeights(m * 5 + 2.5)
      expect(weights.formationIndex).toBe(m)
      expect(weights.phaseLabel).toContain(FORMATIONS[m]!.name)
    }
  })

  it('crossfades adjacent formations without positional jumps including the 60s wrap', () => {
    const total = formationCount('full', false)
    for (const index of [20, 44, 45, 500, 950, 1200]) {
      for (let boundary = 5; boundary <= LOOP_SECONDS; boundary += 5) {
        const before = sampleSwordPose(index, total, boundary - 0.02)
        const after = sampleSwordPose(index, total, boundary + 0.02)
        const distance = Math.hypot(
          before.position.x - after.position.x,
          before.position.y - after.position.y,
          before.position.z - after.position.z
        )
        expect(distance).toBeLessThan(0.6)
      }
    }
  })

  it('covers all four quadrants in Wujiu outer galaxy without a missing arc', () => {
    const total = formationCount('full', false)
    const quadrants = new Set<string>()
    for (let i = 45; i < total; i++) {
      const p = sampleSwordPose(i, total, 57.5)
      const qx = p.position.x >= HEART_X ? '+' : '-'
      const qy = p.position.y >= 0.22 ? '+' : '-'
      quadrants.add(`${qx}${qy}`)
    }
    expect(quadrants.size).toBe(4)
  })

  it('gathers at the Zhuxian climax and rests elsewhere while keeping ambient pulse alive', () => {
    expect(gatheringStrength(0)).toBe(0)
    expect(gatheringStrength(3)).toBeGreaterThan(0.95)
    expect(gatheringStrength(30)).toBe(0)
    expect(gatheringStrength(LOOP_SECONDS)).toBe(0)
    expect(sampleFormationWeights(22.5).ambientPulse).toBeGreaterThan(0.3)
  })

  it('emits formation-specific sword threads within capacity', () => {
    expect(linkCountAt(2.5)).toBe(0)
    expect(linkCountAt(7.5)).toBe(24)
    expect(linkCountAt(12.5)).toBe(0)
    expect(linkCountAt(47.5)).toBe(22)
    expect(linkCountAt(52.5)).toBe(10)
  })

  it('pours the gourd at the climax and lets it rest mid-cycle', () => {
    const climax = sampleStageState(3, 3)
    expect(climax.gourdReveal).toBeGreaterThan(0.9)
    expect(climax.gourdPour).toBeGreaterThan(0.3)
    expect(climax.corkLift).toBeGreaterThan(0.02)
    expect(climax.vaporIntensity).toBeGreaterThan(0.2)
    const calm = sampleStageState(20, 20)
    expect(calm.gourdPour).toBeLessThan(0.3)
    expect(calm.gourdGlow).toBeGreaterThanOrEqual(6)
    for (const value of [climax.gourdTilt, climax.gourdPour, climax.corkLift, climax.vaporIntensity]) {
      expect(Number.isFinite(value)).toBe(true)
    }
  })

  it('eases into a diagonal hero pose after the planted opening in every formation', () => {
    const planted = sampleStageState(1, 1)
    const rising = sampleStageState(3.5, 3.5)
    expect(planted.mainSwordTiltX).toBeCloseTo(0.08)
    expect(planted.mainSwordTiltZ).toBeCloseTo(-0.12)
    const tiltOf = (state: typeof planted) =>
      Math.acos(Math.cos(state.mainSwordTiltX) * Math.cos(state.mainSwordTiltZ))
    for (let i = 0; i < FORMATIONS.length; i++) {
      const floating = sampleStageState(i * MOVEMENT_SECONDS + 2.5, INTRO_SECONDS)
      expect(tiltOf(floating)).toBeGreaterThan((20 * Math.PI) / 180)
      expect(tiltOf(floating)).toBeLessThan((25 * Math.PI) / 180)
      expect(tiltOf(rising)).toBeGreaterThan(tiltOf(planted))
      expect(tiltOf(rising)).toBeLessThan(tiltOf(floating))
    }
  })

  it('blooms Chunli illusion and fires the six-meridian volley', () => {
    const total = formationCount('full', false)
    const bloom = sampleFormationWeights(12.5)
    expect(bloom.lotus).toBeGreaterThan(0.9)
    expect(bloom.phaseLabel).toContain('春黎')

    expect(sampleFormationWeights(2).pulsePrimary).toBeGreaterThan(0.6)
    expect(sampleFormationWeights(3.5).pulseSecondary).toBeGreaterThan(0.4)
    expect(sampleFormationWeights(20).pulse).toBe(0)
    expect(sampleFormationWeights(37).volley).toBeGreaterThan(0.9)
    let maxStretch = 0
    for (let i = 0; i < total; i++) maxStretch = Math.max(maxStretch, sampleSwordPose(i, total, 37).stretch)
    expect(maxStretch).toBeGreaterThan(1.4)
  })

  it('plunges divine sword into cracked earth and spawns clones before ascending', () => {
    const total = formationCount('full', false)
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

    const preImpactSword = sampleIntroSwordPose(25, total, 0.2, 0.2)
    expect(preImpactSword.scale).toBe(0)
    expect(Math.abs(preImpactSword.position.x - HEART_X)).toBeLessThan(0.12)

    const emergingSword = sampleIntroSwordPose(25, total, 1.3, 1.3)
    expect(emergingSword.scale).toBeGreaterThan(0)

    const settledSword = sampleIntroSwordPose(25, total, INTRO_SECONDS, INTRO_SECONDS)
    expect(settledSword).toEqual(sampleSwordPose(25, total, INTRO_SECONDS))

    const intoPose = createEmptyPose()
    sampleIntroSwordPoseInto(25, total, INTRO_SECONDS, INTRO_SECONDS, intoPose)
    expect(intoPose).toEqual(settledSword)
  })

  it('remains finite across every sword, sky-sea blade and phase in the grand cycle', () => {
    const total = formationCount('full', false)
    const skyTotal = skyFormationCount('full', false)
    const skyPose = createEmptyPose()
    for (let t = 0; t <= LOOP_SECONDS; t += 2.5) {
      for (let i = 0; i < total; i += 43) {
        const pose = sampleSwordPose(i, total, t)
        const introPose = sampleIntroSwordPose(i, total, t, Math.min(INTRO_SECONDS, t))
        for (const value of [
          ...Object.values(pose.position),
          ...Object.values(pose.direction),
          pose.scale,
          pose.glow,
          pose.stretch,
          pose.energy,
          pose.gold,
          pose.jade,
          pose.seal,
          ...Object.values(introPose.position),
          ...Object.values(introPose.direction)
        ]) {
          expect(Number.isFinite(value)).toBe(true)
        }
      }
      for (let s = 0; s < skyTotal; s += 37) {
        sampleSkySwordPoseInto(s, skyTotal, t, 0.5, 0.5, skyPose)
        for (const value of [
          ...Object.values(skyPose.position),
          ...Object.values(skyPose.direction),
          skyPose.scale,
          skyPose.stretch
        ]) {
          expect(Number.isFinite(value)).toBe(true)
        }
      }
    }
  })

  it('keeps every formation a real 3D volume after depth shaping and varies depth smoothly', () => {
    const total = formationCount('full', false)
    const depth = { gain: 1, center: 0 }
    for (let f = 0; f < FORMATIONS.length; f++) {
      const time = f * MOVEMENT_SECONDS + MOVEMENT_SECONDS * 0.5
      formationDepthAt(time, depth)
      let sum = 0
      let sumSq = 0
      let hits = 0
      for (let i = 0; i < total; i += 7) {
        const pose = sampleSwordPose(i, total, time)
        if (pose.scale <= 0.001) continue
        const z = DEPTH_FOCUS_Z + (pose.position.z - depth.center) * depth.gain
        sum += z
        sumSq += z * z
        hits++
      }
      const mean = sum / hits
      const sd = Math.sqrt(sumSq / hits - mean * mean)
      expect(Math.abs(mean - DEPTH_FOCUS_Z)).toBeLessThan(0.3)
      expect(sd, FORMATIONS[f]!.name).toBeGreaterThan(0.7)
    }
    const before = { gain: 1, center: 0 }
    const after = { gain: 1, center: 0 }
    formationDepthAt(LOOP_SECONDS - 0.001, before)
    formationDepthAt(0, after)
    expect(Math.abs(before.gain - after.gain)).toBeLessThan(0.05)
    expect(Math.abs(before.center - after.center)).toBeLessThan(0.05)
  })
})
