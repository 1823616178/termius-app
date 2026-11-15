export const LOOP_SECONDS = 20

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
}

export type SwordMotionTier = 'full' | 'light' | 'off'

const TAU = Math.PI * 2
const HEART_X = 0.9

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

export function formationCount(tier: SwordMotionTier, compact: boolean): number {
  if (tier === 'off') return 0
  if (compact) return tier === 'full' ? 12 : 6
  return tier === 'full' ? 144 : 32
}

function loopPhase(timeSeconds: number): number {
  return (((timeSeconds % LOOP_SECONDS) + LOOP_SECONDS) % LOOP_SECONDS) / LOOP_SECONDS
}

export function gatheringStrength(timeSeconds: number): number {
  const phase = loopPhase(timeSeconds)
  return smoothstep(0.42, 0.65, phase) * (1 - smoothstep(0.68, 0.9, phase))
}

function seed(index: number, salt: number): number {
  const value = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453
  return value - Math.floor(value)
}

function samplePosition(index: number, total: number, timeSeconds: number): Vec3 {
  const safeTotal = Math.max(1, Math.floor(total))
  const lane = index % 3
  const phase = loopPhase(timeSeconds)
  const cycle = phase * TAU
  const angle = (index / safeTotal) * TAU + seed(index, 1) * 0.5 + cycle * (lane + 1)
  const gather = gatheringStrength(timeSeconds)
  const radius = 3.1 + seed(index, 2) * 3.3
  const gatheredRadius = 0.34 + seed(index, 3) * 0.5
  const r = radius + (gatheredRadius - radius) * gather
  const depth = -2.8 + seed(index, 4) * 5.6
  const gatheredDepth = -1.65 + seed(index, 5) * 0.9

  return {
    x: HEART_X + Math.cos(angle) * r,
    y: Math.sin(angle) * r * (0.48 + lane * 0.09) + Math.sin(cycle * 2 + seed(index, 6) * TAU) * 0.22,
    z: depth + (gatheredDepth - depth) * gather + Math.sin(angle * 2 + lane) * 0.34 * (1 - gather)
  }
}

function normalize(vector: Vec3): Vec3 {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length }
}

export function sampleSwordPose(index: number, total: number, timeSeconds: number): SwordPose {
  const position = samplePosition(index, total, timeSeconds)
  const next = samplePosition(index, total, timeSeconds + 0.016)
  const gather = gatheringStrength(timeSeconds)

  return {
    position,
    direction: normalize({ x: next.x - position.x, y: next.y - position.y, z: next.z - position.z }),
    scale: (0.3 + seed(index, 7) * 0.28) * (1 - gather * 0.58),
    glow: clamp01(0.24 + seed(index, 8) * 0.5 + gather * 0.45)
  }
}
