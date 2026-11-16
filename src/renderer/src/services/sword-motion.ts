export const LOOP_SECONDS = 20
export const INTRO_SECONDS = 3.8
export const IMPACT_SECONDS = 0.42

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface SwordPose {
  position: Vec3
  direction: Vec3
  scale: number
  glow: number
  stretch: number
  energy: number
}

export interface FormationWeights {
  phase: number
  gather: number
  lotus: number
  vortex: number
  volley: number
  pulsePrimary: number
  pulseSecondary: number
  pulse: number
  phaseLabel: string
}

export interface StageState {
  introProgress: number
  cameraZ: number
  cameraY: number
  mainSwordY: number
  mainSwordSpin: number
  mainSwordInvert: number
  mainSwordTremble: number
  mainSwordScale: number
  mainSwordGlow: number
  groundReveal: number
  crackReveal: number
  debrisLift: number
  debrisOpacity: number
  descentBeam: number
  ringUnfold: number
  ringRadiiScales: [number, number, number]
  gourdReveal: number
  wineReveal: number
  particleReveal: number
  introShockwave: number
  groundShockwave: number
  climaxShockwaveA: number
  climaxShockwaveB: number
  pillarIntensity: number
  weights: FormationWeights
}

export type SwordMotionTier = 'full' | 'light' | 'off'

const TAU = Math.PI * 2
const HEART_X = 0.9
const HEART_Y = 0.26

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  const span = edge1 - edge0
  if (Math.abs(span) < 1e-8) return value >= edge1 ? 1 : 0
  const t = clamp01((value - edge0) / span)
  return t * t * (3 - 2 * t)
}

function easeOutCubic(value: number): number {
  const t = clamp01(value)
  return 1 - Math.pow(1 - t, 3)
}

function easeInOutCubic(value: number): number {
  const t = clamp01(value)
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function easeOutBack(value: number): number {
  const t = clamp01(value)
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t)
  }
}

function normalizeVec3(vector: Vec3): Vec3 {
  const length = Math.hypot(vector.x, vector.y, vector.z)
  if (length < 1e-6) return { x: 0, y: 1, z: 0 }
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length }
}

export function formationCount(tier: SwordMotionTier, compact: boolean): number {
  if (tier === 'off') return 0
  if (compact) return tier === 'full' ? 12 : 6
  return tier === 'full' ? 144 : 32
}

function loopPhase(timeSeconds: number): number {
  const safe = Number.isFinite(timeSeconds) ? timeSeconds : 0
  return (((safe % LOOP_SECONDS) + LOOP_SECONDS) % LOOP_SECONDS) / LOOP_SECONDS
}

export function gatheringStrength(timeSeconds: number): number {
  const phase = loopPhase(timeSeconds)
  return smoothstep(0.45, 0.64, phase) * (1 - smoothstep(0.68, 0.9, phase))
}

function pulseEnvelope(phase: number, start: number, end: number, strength = 1): number {
  if (phase <= start || phase >= end) return 0
  const u = (phase - start) / (end - start)
  return Math.sin(Math.PI * Math.pow(u, 0.55)) * strength
}

export function sampleFormationWeights(
  timeSeconds: number,
  introTimeSeconds = INTRO_SECONDS
): FormationWeights {
  const phase = loopPhase(timeSeconds)
  const gather = gatheringStrength(timeSeconds)
  const lotus = smoothstep(0.2, 0.3, phase) * (1 - smoothstep(0.42, 0.51, phase))
  const vortex = smoothstep(0.44, 0.56, phase) * (1 - smoothstep(0.66, 0.75, phase))
  const volley = smoothstep(0.655, 0.685, phase) * (1 - smoothstep(0.75, 0.835, phase))
  const pulsePrimary = pulseEnvelope(phase, 0.655, 0.72, 1)
  const pulseSecondary = pulseEnvelope(phase, 0.7, 0.77, 0.76)
  const pulse = Math.max(pulsePrimary, pulseSecondary)

  let phaseLabel = '游龙巡天 · 三才流转'
  if (introTimeSeconds < INTRO_SECONDS * 0.9) {
    if (introTimeSeconds < IMPACT_SECONDS) {
      phaseLabel = '开阵启封 · 天剑破空'
    } else if (introTimeSeconds < 1.15) {
      phaseLabel = '开阵启封 · 裂地渊鸣'
    } else if (introTimeSeconds < 2.28) {
      phaseLabel = '开阵启封 · 万剑分身'
    } else {
      phaseLabel = '开阵启封 · 凌虚归阵'
    }
  } else if (phase >= 0.22 && phase < 0.45) {
    phaseLabel = '剑莲绽放 · 气贯八荒'
  } else if (phase >= 0.45 && phase < 0.65) {
    phaseLabel = '旋涡聚势 · 万锋朝宗'
  } else if (phase >= 0.65 && phase < 0.78) {
    phaseLabel = '万剑归宗 · 剑雨穿心'
  } else if (phase >= 0.78) {
    phaseLabel = '散华归墟 · 星海沉浮'
  }

  return {
    phase,
    gather,
    lotus,
    vortex,
    volley,
    pulsePrimary,
    pulseSecondary,
    pulse,
    phaseLabel
  }
}

export function sampleStageState(
  timeSeconds: number,
  introTimeSeconds = INTRO_SECONDS,
  compact = false
): StageState {
  const t = Math.max(0, introTimeSeconds)
  const intro = clamp01(t / INTRO_SECONDS)
  const weights = sampleFormationWeights(timeSeconds, t)
  const baseCameraZ = compact ? 6.8 : 9.2
  const baseCameraY = compact ? 0.2 : 1.1

  const cameraMove = easeOutCubic(clamp01(t / 1.5))
  let cameraY = lerp(baseCameraY + (compact ? 0.35 : 1.55), baseCameraY, cameraMove)
  let cameraZ = lerp(baseCameraZ + (compact ? 1.4 : 2.35), baseCameraZ, cameraMove)

  let mainSwordY = 0
  let mainSwordSpin = 0
  let mainSwordInvert = 0
  let mainSwordTremble = 0
  let mainSwordScale = 1
  let descentBeam = 0

  if (compact) {
    const dropPhase = clamp01(t / 0.55)
    mainSwordY = lerp(1.8, 0, easeOutBack(dropPhase))
    mainSwordSpin = (1 - easeOutCubic(dropPhase)) * TAU
    mainSwordScale = lerp(0.38, 1, easeOutCubic(clamp01(t / 0.48)))
  } else if (t < INTRO_SECONDS) {
    const riseBlend = easeInOutCubic(smoothstep(2.15, 3.3, t))
    if (t < IMPACT_SECONDS) {
      const diveU = clamp01(t / IMPACT_SECONDS)
      mainSwordY = lerp(6.4, -0.36, Math.pow(diveU, 1.75))
      mainSwordSpin = (1 - diveU) * 1.1
      mainSwordInvert = Math.PI
      mainSwordScale = lerp(0.58, 1.06, easeOutCubic(clamp01(t / 0.26)))
      descentBeam = Math.sin(diveU * Math.PI) * 1.15
    } else if (t < 2.15) {
      const sinceImpact = t - IMPACT_SECONDS
      mainSwordTremble = Math.sin(sinceImpact * 58) * Math.exp(-sinceImpact * 6.2) * 0.045
      mainSwordY = -0.36 + mainSwordTremble * 0.25
      mainSwordSpin = 0
      mainSwordInvert = Math.PI
      mainSwordScale = lerp(1.06, 1.04, smoothstep(0.42, 0.85, t))
    } else {
      mainSwordY = lerp(-0.36, 0, riseBlend) + Math.sin(riseBlend * Math.PI) * 0.22
      mainSwordInvert = lerp(Math.PI, 0, easeInOutCubic(smoothstep(2.22, 3.24, t)))
      mainSwordSpin = Math.sin(riseBlend * Math.PI) * TAU * 0.48
      mainSwordScale = lerp(1.04, 1, riseBlend)
    }

    if (t >= IMPACT_SECONDS && t < 0.96) {
      const recoil = t - IMPACT_SECONDS
      const shake = Math.exp(-recoil * 8.5) * 0.12
      cameraY += Math.sin(recoil * 66) * shake
      cameraZ += Math.cos(recoil * 52) * shake * 0.55
    }
  }

  const groundEnter = smoothstep(0.18, 0.45, t)
  const groundFadeOut = 1 - smoothstep(2.82, 3.68, t)
  const groundReveal = compact ? 0 : groundEnter * groundFadeOut
  const crackSpread = compact ? 0 : easeOutCubic(clamp01((t - IMPACT_SECONDS) / 0.56))
  const crackReveal = crackSpread * groundFadeOut
  const debrisLift = compact ? 0 : easeOutCubic(clamp01((t - IMPACT_SECONDS) / 1.45))
  const debrisOpacity = compact ? 0 : smoothstep(IMPACT_SECONDS, 0.52, t) * (1 - smoothstep(2.42, 3.45, t))

  const ringUnfold = easeOutCubic(clamp01((t - 0.54) / 1.05))
  const ring0 = easeOutBack(clamp01((t - 0.52) / 0.72))
  const ring1 = easeOutBack(clamp01((t - 0.68) / 0.78))
  const ring2 = easeOutBack(clamp01((t - 0.84) / 0.85))

  const gourdReveal = easeOutCubic(clamp01((t - 1.05) / 1.05))
  const wineReveal = easeOutCubic(clamp01((t - 1.18) / 1.05))
  const particleReveal = easeOutCubic(clamp01((t - 0.46) / 1.45))

  const groundShockwave =
    !compact && t >= IMPACT_SECONDS && t < IMPACT_SECONDS + 0.9 ? (t - IMPACT_SECONDS) / 0.9 : 0
  const introShockwave = t >= IMPACT_SECONDS && t < IMPACT_SECONDS + 0.85 ? (t - IMPACT_SECONDS) / 0.85 : 0
  const climaxShockwaveA =
    weights.phase >= 0.655 && weights.phase <= 0.725 ? (weights.phase - 0.655) / 0.07 : 0
  const climaxShockwaveB =
    weights.phase >= 0.705 && weights.phase <= 0.775 ? (weights.phase - 0.705) / 0.07 : 0

  const introLandingFlare = pulseEnvelope(clamp01((t - 0.25) / 1.5), 0.08, 0.88, 1)
  const cloneBurstFlare = pulseEnvelope(clamp01((t - 0.55) / 1.75), 0.1, 0.85, 0.72)
  const pillarIntensity = Math.max(
    descentBeam * 0.95,
    introLandingFlare * 0.95,
    weights.pulse * 0.95 + weights.gather * 0.35
  )

  return {
    introProgress: intro,
    cameraZ,
    cameraY,
    mainSwordY,
    mainSwordSpin,
    mainSwordInvert,
    mainSwordTremble,
    mainSwordScale,
    mainSwordGlow: Math.max(introLandingFlare, cloneBurstFlare, weights.gather * 0.55 + weights.pulse * 0.9),
    groundReveal,
    crackReveal,
    debrisLift,
    debrisOpacity,
    descentBeam,
    ringUnfold,
    ringRadiiScales: [ring0, ring1, ring2],
    gourdReveal,
    wineReveal,
    particleReveal,
    introShockwave,
    groundShockwave,
    climaxShockwaveA,
    climaxShockwaveB,
    pillarIntensity,
    weights
  }
}

function seed(index: number, salt: number): number {
  const value = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453
  return value - Math.floor(value)
}

interface SampledGeometryState {
  position: Vec3
  lotusDir: Vec3
  lotusWeight: number
  localGather: number
  volleyLocal: number
  isGuard: boolean
}

function sampleGeometryState(index: number, total: number, timeSeconds: number): SampledGeometryState {
  const safeTotal = Math.max(1, Math.floor(total))
  const lane = index % 3
  const phase = loopPhase(timeSeconds)
  const cycle = phase * TAU

  const angle = (index / safeTotal) * TAU + seed(index, 1) * 0.45 + cycle * (lane + 1)
  const radius = 3.05 + seed(index, 2) * 3.3
  const depth = -4.5 + seed(index, 4) * 4.6
  const wave = Math.sin(cycle * 2 + angle * 2 + seed(index, 6) * TAU) * 0.26

  const orbitPos: Vec3 = {
    x: HEART_X + Math.cos(angle) * radius,
    y: Math.sin(angle) * radius * (0.48 + lane * 0.09) + wave,
    z: depth + Math.sin(angle * 2 + lane) * 0.34
  }

  // Form 2: Concentric Sword Lotus (护法剑莲 / 背光扇轮) behind the main sword
  const ring = index % 3
  const ringIndex = Math.floor(index / 3)
  const ringCount = Math.max(1, Math.ceil(safeTotal / 3))
  const ringRot = (ring === 1 ? -1 : 1) * cycle
  const lotusAngle = (ringIndex / ringCount) * TAU + ring * 0.36 + ringRot
  const breath = Math.sin(cycle * 4 + ring * 1.1) * 0.14
  const lotusRadius = (ring === 0 ? 1.42 : ring === 1 ? 2.34 : 3.3) + breath
  const lotusPos: Vec3 = {
    x: HEART_X + Math.cos(lotusAngle) * lotusRadius,
    y: 0.22 + Math.sin(lotusAngle) * lotusRadius,
    z: -1.18 - ring * 0.38
  }
  const lotusDir = normalizeVec3({
    x: Math.cos(lotusAngle),
    y: Math.sin(lotusAngle),
    z: 0.14
  })
  const lotusWeight = smoothstep(0.2, 0.3, phase) * (1 - smoothstep(0.42, 0.51, phase))

  // Form 3: Staggered Conical Vortex converging tightly on the sword heart at t = 13s (phase = 0.65)
  const stagger = (seed(index, 9) - 0.5) * 0.08
  const localGather =
    smoothstep(0.44 + stagger, 0.61 + stagger, phase) * (1 - smoothstep(0.69 + stagger, 0.9, phase))
  const gatheredRadius = 0.34 + seed(index, 3) * 0.48
  const spiralSpin = localGather * (3.6 + (index % 4) * 0.55)
  const vortexAngle = angle + spiralSpin
  const vortexR = lerp(radius, gatheredRadius, localGather)
  const gatheredDepth = -0.95 + seed(index, 5) * 1.15
  const vortexPos: Vec3 = {
    x: HEART_X + Math.cos(vortexAngle) * vortexR,
    y: lerp(orbitPos.y, Math.sin(vortexAngle) * gatheredRadius * 0.62 + HEART_Y * 0.5, localGather),
    z: lerp(orbitPos.z, gatheredDepth, localGather)
  }

  // Form 4: Piercing Sword-Rain Volley (万剑归宗 · 剑雨穿心) from t = 13.2s..16.0s
  const volleyStart = 0.66 + seed(index, 11) * 0.032
  const volleyEnd = 0.76 + seed(index, 11) * 0.038
  const volleyProgress = clamp01((phase - volleyStart) / Math.max(0.001, volleyEnd - volleyStart))
  const volleyLocal =
    smoothstep(volleyStart, volleyStart + 0.032, phase) *
    (1 - smoothstep(volleyEnd - 0.038, volleyEnd, phase))
  const isGuard = index % 6 === 0

  let volleyPos: Vec3
  if (isGuard) {
    const guardRadius = 0.78 + seed(index, 3) * 0.28
    const guardAngle = angle + volleyLocal * 4.8
    volleyPos = {
      x: HEART_X + Math.cos(guardAngle) * guardRadius,
      y: HEART_Y + Math.sin(guardAngle) * guardRadius * 0.86,
      z: -0.25 + Math.sin(guardAngle * 2) * 0.45
    }
  } else {
    const rayAngle = (index / safeTotal) * TAU * 2 + seed(index, 1) * 0.65
    const surge = Math.sin(volleyProgress * Math.PI)
    const coneRadius = 0.45 + surge * (3.35 + seed(index, 2) * 2.5)
    volleyPos = {
      x: HEART_X + Math.cos(rayAngle) * coneRadius,
      y: HEART_Y + Math.sin(rayAngle) * coneRadius * 0.74,
      z: -0.65 + surge * (2.55 + seed(index, 4) * 1.75)
    }
  }

  const basePos = lerpVec3(orbitPos, lotusPos, lotusWeight)
  const gatheredPos = lerpVec3(basePos, vortexPos, localGather)
  const position = lerpVec3(gatheredPos, volleyPos, volleyLocal)

  return {
    position,
    lotusDir,
    lotusWeight,
    localGather,
    volleyLocal,
    isGuard
  }
}

export function sampleSwordPose(index: number, total: number, timeSeconds: number): SwordPose {
  const current = sampleGeometryState(index, total, timeSeconds)
  const next = sampleGeometryState(index, total, timeSeconds + 0.016)
  const weights = sampleFormationWeights(timeSeconds)

  const tangentDir = normalizeVec3({
    x: next.position.x - current.position.x,
    y: next.position.y - current.position.y,
    z: next.position.z - current.position.z
  })
  const convergeDir = normalizeVec3({
    x: HEART_X - current.position.x,
    y: HEART_Y - current.position.y,
    z: 0.22 - current.position.z
  })

  // Blend flight tangent -> radial Sword Lotus outward -> inward heart convergence -> piercing volley tangent
  const lotusBlended = lerpVec3(tangentDir, current.lotusDir, current.lotusWeight * 0.92)
  const convergeWeight = current.localGather * (1 - current.volleyLocal) * 0.78
  const direction = normalizeVec3(lerpVec3(lotusBlended, convergeDir, convergeWeight))

  const baseScale = 0.22 + seed(index, 7) * 0.19
  const scale =
    baseScale *
    (1 - current.localGather * 0.22) *
    (1 + current.lotusWeight * 0.08 + current.volleyLocal * (current.isGuard ? 0.05 : 0.14))

  const waveEnergy = Math.max(0, Math.sin(weights.phase * TAU * 4 - seed(index, 12) * TAU))
  const energy = clamp01(
    current.lotusWeight * 0.35 +
      current.localGather * 0.55 +
      current.volleyLocal * 0.85 +
      weights.pulse * (0.45 + waveEnergy * 0.55)
  )

  return {
    position: current.position,
    direction,
    scale,
    glow: clamp01(0.24 + seed(index, 8) * 0.45 + energy * 0.52),
    stretch: 1 + current.volleyLocal * (current.isGuard ? 0.2 : 1.05) + weights.pulse * 0.25,
    energy
  }
}

function cloneSpawnOrigin(index: number): Vec3 {
  // Clones peel directly out of the plunged divine sword shaft & glowing earth crater
  const shaftT = Math.pow(seed(index, 13), 0.78)
  const radial = (seed(index, 14) - 0.5) * 0.16
  const depth = (seed(index, 15) - 0.5) * 0.14
  return {
    x: HEART_X + radial,
    y: lerp(-1.3, 0.88, shaftT),
    z: depth
  }
}

function sampleIntroArcPosition(
  index: number,
  total: number,
  origin: Vec3,
  targetPos: Vec3,
  u: number
): Vec3 {
  const ease = easeOutCubic(u)
  const fountain = Math.sin(Math.min(1, u * 1.15) * Math.PI)
  const ejectAngle = (index / Math.max(1, total)) * TAU * 3.5 + seed(index, 16) * 1.4
  const spread = (0.85 + seed(index, 17) * 0.95) * fountain
  const upward = (0.72 + seed(index, 18) * 0.92) * Math.sin(u * Math.PI)
  return {
    x: lerp(origin.x, targetPos.x, ease) + Math.cos(ejectAngle) * spread * 0.65,
    y: lerp(origin.y, targetPos.y, ease) + upward + Math.sin(ejectAngle) * spread * 0.28,
    z: lerp(origin.z, targetPos.z, ease) - Math.sin(u * Math.PI) * 0.5
  }
}

export function sampleIntroSwordPose(
  index: number,
  total: number,
  loopTimeSeconds: number,
  introTimeSeconds: number
): SwordPose {
  const target = sampleSwordPose(index, total, loopTimeSeconds)
  if (introTimeSeconds >= INTRO_SECONDS) return target

  const safeTotal = Math.max(1, Math.floor(total))
  const origin = cloneSpawnOrigin(index)
  const order = (index / safeTotal) * 0.68 + seed(index, 10) * 0.32
  const start = 0.48 + order * 1.38
  const duration = 1.15
  const u = clamp01((introTimeSeconds - start) / duration)

  if (u <= 0) {
    return {
      position: origin,
      direction: { x: 0, y: 1, z: 0 },
      scale: 0,
      glow: 0,
      stretch: 1,
      energy: 0
    }
  }

  const ease = easeOutCubic(u)
  const position = sampleIntroArcPosition(index, safeTotal, origin, target.position, u)
  const nextPosition = sampleIntroArcPosition(
    index,
    safeTotal,
    origin,
    target.position,
    Math.min(1, u + 0.02)
  )
  const velocityDir = normalizeVec3({
    x: nextPosition.x - position.x,
    y: nextPosition.y - position.y,
    z: nextPosition.z - position.z
  })
  const direction = normalizeVec3(lerpVec3(velocityDir, target.direction, smoothstep(0.68, 1, u)))
  const popScale = smoothstep(0, 0.18, u)
  const burstFlare = Math.sin(u * Math.PI)

  return {
    position,
    direction,
    scale: target.scale * popScale,
    glow: clamp01(target.glow + burstFlare * 0.52),
    stretch: lerp(1 + burstFlare * 1.35, target.stretch, ease),
    energy: clamp01(Math.max(target.energy, burstFlare * 0.98))
  }
}
