export const LOOP_SECONDS = 60
export const MOVEMENT_SECONDS = 5
export const INTRO_SECONDS = 3.8
export const IMPACT_SECONDS = 0.42
export const LINK_SEGMENT_CAPACITY = 48

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
  gold: number
  jade: number
  seal: number
}

export interface FormationMeta {
  name: string
  sub: string
  link: 'none' | 'gates' | 'threads' | 'grid' | 'ring'
  linkColor: 0 | 1 | 2
}

export const FORMATIONS: FormationMeta[] = [
  { name: '诛仙剑阵', sub: '四门诛戮陷绝 · 杀意朝心', link: 'gates', linkColor: 2 },
  { name: '大庚剑阵', sub: '庚金剑丝 · 隐匿穿空', link: 'threads', linkColor: 0 },
  { name: '春黎剑阵', sub: '幻术为基 · 春影重叠', link: 'none', linkColor: 1 },
  { name: '青蟠剑阵', sub: '青元高阶 · 蟠龙绕柱', link: 'none', linkColor: 1 },
  { name: '小千剑阵', sub: '千剑层叠 · 六重呼吸', link: 'none', linkColor: 0 },
  { name: '大千剑阵', sub: '大千世界 · 三环浑天', link: 'none', linkColor: 0 },
  { name: '恒山剑阵', sub: '七人一队 · 攻守相济', link: 'none', linkColor: 1 },
  { name: '六脉神剑阵', sub: '六脉剑气 · 依次奔涌', link: 'none', linkColor: 0 },
  { name: '罗汉剑阵', sub: '少林罗汉 · 立剑如僧', link: 'none', linkColor: 0 },
  { name: '九宫八卦剑阵', sub: '九宫方位 · 交织剑网', link: 'grid', linkColor: 1 },
  { name: '五行连环剑阵', sub: '五行相生 · 连环合击', link: 'ring', linkColor: 0 },
  { name: '五九剑阵', sub: '四五长剑 · 旋盘不息', link: 'none', linkColor: 0 }
]

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
  formationIndex: number
  fade: number
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
  gourdTilt: number
  gourdPour: number
  corkLift: number
  vaporIntensity: number
  gourdGlow: number
  particleReveal: number
  introShockwave: number
  groundShockwave: number
  climaxShockwaveA: number
  climaxShockwaveB: number
  pillarIntensity: number
  formationIndex: number
  formationFade: number
  weights: FormationWeights
}

export type SwordMotionTier = 'full' | 'light' | 'off'

const TAU = Math.PI * 2
const HEART_X = 0.9
const HEART_Y = 0.26
const CROSS = 0.45

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
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) }
}

function normalizeVec3(vector: Vec3): Vec3 {
  const length = Math.hypot(vector.x, vector.y, vector.z)
  if (length < 1e-6) return { x: 0, y: 1, z: 0 }
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length }
}

function seed(index: number, salt: number): number {
  const value = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453
  return value - Math.floor(value)
}

function fract(value: number): number {
  return value - Math.floor(value)
}

function fib(j: number, n: number): Vec3 {
  const y = 1 - (2 * (j + 0.5)) / Math.max(1, n)
  const r = Math.sqrt(Math.max(0, 1 - y * y))
  const th = j * 2.399963
  return { x: Math.cos(th) * r, y, z: Math.sin(th) * r }
}

function rotateAround(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const a = normalizeVec3(axis)
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const dot = a.x * v.x + a.y * v.y + a.z * v.z
  const cx = a.y * v.z - a.z * v.y
  const cy = a.z * v.x - a.x * v.z
  const cz = a.x * v.y - a.y * v.x
  return {
    x: v.x * c + cx * s + a.x * dot * (1 - c),
    y: v.y * c + cy * s + a.y * dot * (1 - c),
    z: v.z * c + cz * s + a.z * dot * (1 - c)
  }
}

function gateCenter(gate: number, rot: number): Vec3 {
  const angle = (gate * TAU) / 4 + TAU / 8 + rot * 0.12
  return { x: HEART_X + Math.cos(angle) * 2.5, y: HEART_Y + Math.sin(angle) * 2.0, z: -0.6 }
}

function threadEnds(k: number): [Vec3, Vec3] {
  const a = {
    x: -3.6 + seed(k, 1) * 7.2,
    y: -1.6 + seed(k, 2) * 3.4,
    z: -1.2 + seed(k, 3) * 1.2
  }
  const b = {
    x: -3.6 + seed(k, 4) * 7.2,
    y: -1.6 + seed(k, 5) * 3.4,
    z: -1.2 + seed(k, 6) * 1.2
  }
  return [a, b]
}

function cellCenter(cell: number): Vec3 {
  return {
    x: HEART_X + (cell % 3 - 1) * 1.5,
    y: HEART_Y + (Math.floor(cell / 3) - 1) * 1.2,
    z: -1.0
  }
}

function elemCenter(elem: number, rot: number): Vec3 {
  const angle = (elem * TAU) / 5 - TAU / 4 + rot * 0.15
  return { x: HEART_X + Math.cos(angle) * 2.0, y: HEART_Y + Math.sin(angle) * 1.6, z: -0.7 }
}

function pose(
  position: Vec3,
  direction: Vec3,
  scale: number,
  glow: number,
  stretch: number,
  energy: number,
  gold: number,
  jade: number,
  seal: number
): SwordPose {
  return { position, direction: normalizeVec3(direction), scale, glow, stretch, energy, gold, jade, seal }
}

function poseZhuxian(i: number, n: number, gt: number, rot: number): SwordPose {
  const gate = i % 4
  const per = Math.ceil(n / 4)
  const c = gateCenter(gate, rot)
  const off = fib(Math.floor(i / 4), per)
  const position = { x: c.x + off.x * 0.5, y: c.y + off.y * 0.5, z: c.z + off.z * 0.5 }
  const fired = Math.floor(gt * 1.2) % 4 === gate ? 1 : 0
  return pose(
    position,
    { x: HEART_X - position.x, y: HEART_Y - position.y, z: -position.z },
    0.24,
    0.4 + fired * 0.4,
    1 + fired * 0.5,
    0.4 + fired * 0.5,
    0.5 + fired * 0.3,
    0.08,
    0.3 + fired * 0.4
  )
}

function poseDageng(i: number, n: number, gt: number, _rot: number): SwordPose {
  const k = i % 12
  const per = Math.ceil(n / 12)
  const s = fract(Math.floor(i / 12) / per + gt * 0.06)
  const [a, b] = threadEnds(k)
  const position = lerpVec3(a, b, s)
  const shimmer = 0.5 + 0.5 * Math.sin(gt * 3 + k)
  return pose(
    position,
    { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z },
    0.16,
    0.3 + shimmer * 0.2,
    1.6,
    0.3 + shimmer * 0.3,
    0.8,
    0.1,
    0
  )
}

function poseChunli(i: number, n: number, gt: number, rot: number): SwordPose {
  const arm = i % 5
  const per = Math.ceil(n / 5)
  const t = Math.floor(i / 5) / per
  const ang = (arm * TAU) / 5 + t * 2.4 + rot * 0.3
  const r = 0.5 + t * 2.4
  const ghost = Math.sin(gt * 2 + i) * 0.12
  const position = {
    x: HEART_X + Math.cos(ang) * r - Math.sin(ang) * ghost,
    y: HEART_Y + Math.sin(ang) * r * 0.85 + Math.cos(ang) * ghost,
    z: -0.8 - t * 0.4
  }
  return pose(
    position,
    { x: Math.cos(ang) * 0.6 - Math.sin(ang) * 0.4, y: Math.sin(ang) * 0.6 + Math.cos(ang) * 0.4, z: 0 },
    0.2,
    0.4,
    1,
    0.3 + 0.2 * Math.sin(gt * 1.5 + t * 4),
    0.2,
    0.7,
    0
  )
}

function poseQingpan(i: number, n: number, gt: number, rot: number): SwordPose {
  const t = i / n
  const ang = t * TAU * 3.2 + rot * 0.5
  const r = 1.5 + 0.35 * Math.sin(t * TAU * 2 + gt * 1.5)
  const position = {
    x: HEART_X + Math.cos(ang) * r,
    y: -1.4 + t * 3.2,
    z: -0.7 + Math.sin(ang) * r * 0.5
  }
  return pose(
    position,
    { x: -Math.sin(ang), y: 0.9, z: Math.cos(ang) * 0.5 },
    0.22,
    0.4,
    1.2,
    0.4 + 0.2 * Math.sin(gt * 1.5 + t * 6),
    0.25,
    0.8,
    0
  )
}

function poseXiaoqian(i: number, n: number, gt: number, rot: number): SwordPose {
  const layer = i % 6
  const per = Math.ceil(n / 6)
  const j = Math.floor(i / 6)
  const breath = Math.sin(gt * 1.2 - layer * 0.5)
  const ang = (j / per) * TAU + rot * (layer % 2 ? -0.4 : 0.4) + layer * 0.2
  const r = 0.7 + layer * 0.42 + breath * 0.12
  const position = {
    x: HEART_X + Math.cos(ang) * r,
    y: HEART_Y + Math.sin(ang) * r * 0.9,
    z: -0.9 - layer * 0.15
  }
  return pose(
    position,
    { x: -Math.sin(ang), y: Math.cos(ang), z: 0 },
    0.18,
    0.35,
    1,
    0.3 + 0.2 * breath,
    layer % 2 ? 0.6 : 0.3,
    layer % 2 ? 0.2 : 0.6,
    0
  )
}

function poseDaqian(i: number, n: number, _gt: number, rot: number): SwordPose {
  const shell = i % 3
  const per = Math.ceil(n / 3)
  const f = fib(Math.floor(i / 3), per)
  const r = 1.2 + shell * 0.8
  const axes: Vec3[] = [
    { x: 0, y: 1, z: 0 },
    { x: 0.7, y: 0.7, z: 0 },
    { x: 0, y: 0.6, z: 0.8 }
  ]
  const axis = axes[shell]!
  const spun = rotateAround({ x: f.x * r, y: f.y * r, z: f.z * r }, axis, rot * (0.25 + shell * 0.12))
  const position = { x: HEART_X + spun.x, y: HEART_Y + spun.y, z: -0.8 + spun.z }
  const tangent = {
    x: axis.y * spun.z - axis.z * spun.y,
    y: axis.z * spun.x - axis.x * spun.z,
    z: axis.x * spun.y - axis.y * spun.x
  }
  return pose(position, tangent, 0.2, 0.4, 1, 0.35, 0.7, 0.3, 0)
}

function poseHengshan(i: number, n: number, gt: number, rot: number): SwordPose {
  const squad = Math.floor(i / 7)
  const member = i % 7
  const sc = Math.ceil(n / 7)
  const ang = (squad / sc) * TAU + rot * 0.25
  const c = { x: HEART_X + Math.cos(ang) * 2.6, y: HEART_Y + Math.sin(ang) * 1.56, z: -0.8 }
  const mode = smoothstep(-0.2, 0.2, Math.sin(gt * 0.8 + squad))
  const mr = lerp(0.24, 0.42, mode)
  const ma = (member * TAU) / 7 + rot * 0.6
  const off = { x: Math.cos(ma) * mr, y: Math.sin(ma) * mr, z: 0 }
  const position = { x: c.x + off.x, y: c.y + off.y, z: c.z + off.z }
  const dir = normalizeVec3(lerpVec3(normalizeVec3({ x: -off.x, y: -off.y, z: 0 }), normalizeVec3(off), mode))
  return pose(position, dir, 0.2, 0.35, 1 + mode * 0.2, 0.3 + mode * 0.3, 0.3, 0.4, 0.05)
}

function poseLiumai(i: number, n: number, gt: number, rot: number): SwordPose {
  const mer = i % 6
  const per = Math.ceil(n / 6)
  const s = Math.floor(i / 6) / per
  const ang = (mer * TAU) / 6 + rot * 0.1
  const wave = fract(gt * 0.5 - mer / 6)
  const g = Math.exp(-Math.pow((s - wave) * 6, 2))
  const r = 0.4 + s * 3.0
  const position = { x: HEART_X + Math.cos(ang) * r, y: HEART_Y + Math.sin(ang) * r * 0.8, z: -0.5 }
  return pose(
    position,
    { x: Math.cos(ang), y: Math.sin(ang), z: 0 },
    0.2,
    0.3 + g * 0.5,
    1 + g * 1.2,
    0.2 + g * 0.7,
    0.4 + g * 0.6,
    0.3 * (1 - g),
    0
  )
}

function poseLuohan(i: number, n: number, gt: number, rot: number): SwordPose {
  const ang = (i / n) * TAU + rot * 0.08
  const r = 2.2
  const position = {
    x: HEART_X + Math.cos(ang) * r,
    y: HEART_Y + Math.sin(ang) * r * 0.35 - 0.2,
    z: -1.0 + Math.sin(ang) * r * 0.3
  }
  const sway = Math.sin(gt * 0.8 + i) * 0.05
  const tap = Math.floor(gt * 0.5) % n === i ? 1 : 0
  return pose(position, { x: sway, y: 1, z: sway * 0.5 }, 0.24, 0.25 + tap * 0.3, 1, 0.15 + tap * 0.4, 0.5, 0.15, 0.05)
}

function poseJiugong(i: number, n: number, gt: number, rot: number): SwordPose {
  const cell = i % 9
  const per = Math.ceil(n / 9)
  const c = cellCenter(cell)
  const f = fib(Math.floor(i / 9), per)
  const spun = rotateAround({ x: f.x * 0.4, y: f.y * 0.4, z: f.z * 0.4 }, { x: 0, y: 0, z: 1 }, rot * 0.4 + cell)
  const position = { x: c.x + spun.x, y: c.y + spun.y, z: c.z + spun.z }
  const next = cellCenter((cell + 1) % 9)
  const dir = normalizeVec3(
    lerpVec3(normalizeVec3({ x: next.x - position.x, y: next.y - position.y, z: 0 }), { x: -spun.y, y: spun.x, z: 0 }, 0.4)
  )
  return pose(position, dir, 0.18, 0.35, 1, 0.3 + 0.2 * Math.sin(gt * 1.2 + cell), cell % 2 ? 0.5 : 0.3, cell % 2 ? 0.3 : 0.5, 0)
}

const ELEMENT_MIX: ReadonlyArray<readonly [number, number, number]> = [
  [0.8, 0.1, 0],
  [0.15, 0.8, 0],
  [0.1, 0.2, 0],
  [0.2, 0.05, 0.7],
  [0.5, 0.15, 0.2]
]

function poseWuxing(i: number, n: number, gt: number, rot: number): SwordPose {
  const elem = i % 5
  const per = Math.ceil(n / 5)
  const c = elemCenter(elem, rot)
  const f = fib(Math.floor(i / 5), per)
  const position = { x: c.x + f.x * 0.45, y: c.y + f.y * 0.45, z: c.z + f.z * 0.45 }
  const next = elemCenter((elem + 1) % 5, rot)
  const active = Math.floor(gt * 0.6) % 5 === elem ? 1 : 0
  const [gold, jade, seal] = ELEMENT_MIX[elem]!
  return pose(
    position,
    { x: next.x - position.x, y: next.y - position.y, z: next.z - position.z },
    0.2,
    0.35 + active * 0.4,
    1 + active * 0.3,
    0.3 + active * 0.5,
    gold,
    jade,
    seal
  )
}

function poseWujiu(i: number, n: number, _gt: number, rot: number): SwordPose {
  if (i < 45) {
    const ang = (i / 45) * TAU + rot * 0.9
    const r = 1.6 + ((i % 5) % 2) * 0.2
    const position = { x: HEART_X + Math.cos(ang) * r, y: HEART_Y + Math.sin(ang) * r * 0.85, z: -0.6 }
    return pose(position, { x: -Math.sin(ang), y: Math.cos(ang), z: 0 }, 0.22, 0.5, 1.1, 0.6, 0.8, 0.2, 0)
  }
  const ang = (i / n) * TAU + rot * 0.2
  const position = { x: HEART_X + Math.cos(ang) * 3.0, y: HEART_Y + Math.sin(ang) * 2.4, z: -1.2 }
  return pose(position, { x: -Math.sin(ang), y: Math.cos(ang), z: 0 }, 0.1, 0.15, 1, 0.1, 0.2, 0.3, 0)
}

const MOVEMENTS: ReadonlyArray<(i: number, n: number, gt: number, rot: number) => SwordPose> = [
  poseZhuxian,
  poseDageng,
  poseChunli,
  poseQingpan,
  poseXiaoqian,
  poseDaqian,
  poseHengshan,
  poseLiumai,
  poseLuohan,
  poseJiugong,
  poseWuxing,
  poseWujiu
]

function blendPose(a: SwordPose, b: SwordPose, f: number, pinch: number): SwordPose {
  const merged = lerpVec3(a.position, b.position, f)
  const position = {
    x: HEART_X + (merged.x - HEART_X) * (1 - pinch),
    y: HEART_Y + (merged.y - HEART_Y) * (1 - pinch),
    z: merged.z * (1 - pinch * 0.5)
  }
  return {
    position,
    direction: normalizeVec3(lerpVec3(a.direction, b.direction, f)),
    scale: lerp(a.scale, b.scale, f),
    glow: lerp(a.glow, b.glow, f) + pinch * 0.6,
    stretch: lerp(a.stretch, b.stretch, f),
    energy: lerp(a.energy, b.energy, f),
    gold: lerp(a.gold, b.gold, f),
    jade: lerp(a.jade, b.jade, f),
    seal: lerp(a.seal, b.seal, f)
  }
}

export function formationAt(grandTime: number): { index: number; local: number; fade: number; from: number } {
  const grand = ((grandTime % LOOP_SECONDS) + LOOP_SECONDS) % LOOP_SECONDS
  const index = Math.min(FORMATIONS.length - 1, Math.floor(grand / MOVEMENT_SECONDS))
  const local = grand - index * MOVEMENT_SECONDS
  if (local < CROSS) {
    return { index, local, fade: smoothstep(MOVEMENT_SECONDS - CROSS, MOVEMENT_SECONDS + CROSS, local + MOVEMENT_SECONDS), from: (index + FORMATIONS.length - 1) % FORMATIONS.length }
  }
  if (local > MOVEMENT_SECONDS - CROSS) {
    return { index, local, fade: smoothstep(MOVEMENT_SECONDS - CROSS, MOVEMENT_SECONDS + CROSS, local), from: index }
  }
  return { index, local, fade: 0, from: index }
}

export function sampleSwordPose(index: number, total: number, timeSeconds: number): SwordPose {
  const safeTotal = Math.max(1, Math.floor(total))
  const gt = ((timeSeconds % LOOP_SECONDS) + LOOP_SECONDS) % LOOP_SECONDS
  const rot = gt * 0.6
  const { index: m, fade, from } = formationAt(gt)
  const current = MOVEMENTS[m]!(index, safeTotal, gt, rot)
  if (fade <= 0) return current
  const pinch = Math.sin(fade * Math.PI) * 0.16
  if (from === m) {
    const next = MOVEMENTS[(m + 1) % FORMATIONS.length]!(index, safeTotal, gt, rot)
    return blendPose(current, next, fade, pinch)
  }
  const prev = MOVEMENTS[from]!(index, safeTotal, gt, rot)
  return blendPose(prev, current, fade, pinch)
}

export function formationCount(tier: SwordMotionTier, compact: boolean): number {
  if (tier === 'off') return 0
  if (compact) return tier === 'full' ? 12 : 6
  return tier === 'full' ? 144 : 32
}

export function gatheringStrength(timeSeconds: number): number {
  const gt = ((timeSeconds % LOOP_SECONDS) + LOOP_SECONDS) % LOOP_SECONDS
  return smoothstep(0.5, 2, gt) * (1 - smoothstep(4, 5, gt))
}

function pulseEnvelopeGrand(gt: number, start: number, end: number, strength = 1): number {
  if (gt <= start || gt >= end) return 0
  const u = (gt - start) / (end - start)
  return Math.sin(Math.PI * Math.pow(u, 0.55)) * strength
}

export function sampleFormationWeights(timeSeconds: number, introTimeSeconds = INTRO_SECONDS): FormationWeights {
  const gt = ((timeSeconds % LOOP_SECONDS) + LOOP_SECONDS) % LOOP_SECONDS
  const { index, fade } = formationAt(gt)
  const gather = gatheringStrength(timeSeconds)
  const lotus = smoothstep(10, 11, gt) * (1 - smoothstep(14, 15, gt))
  const vortex = gather
  const volley = smoothstep(35, 36, gt) * (1 - smoothstep(39, 40, gt))
  const pulsePrimary = pulseEnvelopeGrand(gt, 1, 3)
  const pulseSecondary = pulseEnvelopeGrand(gt, 2.5, 4.2, 0.76)
  const pulse = Math.max(pulsePrimary, pulseSecondary)

  let phaseLabel = `${FORMATIONS[index]!.name} · ${FORMATIONS[index]!.sub}`
  if (introTimeSeconds < INTRO_SECONDS * 0.9) {
    if (introTimeSeconds < IMPACT_SECONDS) phaseLabel = '开阵启封 · 天剑破空'
    else if (introTimeSeconds < 1.15) phaseLabel = '开阵启封 · 裂地渊鸣'
    else if (introTimeSeconds < 2.28) phaseLabel = '开阵启封 · 万剑分身'
    else phaseLabel = '开阵启封 · 凌虚归阵'
  }

  return {
    phase: gt / LOOP_SECONDS,
    gather,
    lotus,
    vortex,
    volley,
    pulsePrimary,
    pulseSecondary,
    pulse,
    phaseLabel,
    formationIndex: index,
    fade
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
  const gt = ((timeSeconds % LOOP_SECONDS) + LOOP_SECONDS) % LOOP_SECONDS
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
  const particleReveal = easeOutCubic(clamp01((t - 0.46) / 1.45))

  const groundShockwave =
    !compact && t >= IMPACT_SECONDS && t < IMPACT_SECONDS + 0.9 ? (t - IMPACT_SECONDS) / 0.9 : 0
  const introShockwave = t >= IMPACT_SECONDS && t < IMPACT_SECONDS + 0.85 ? (t - IMPACT_SECONDS) / 0.85 : 0
  const climaxShockwaveA = weights.pulsePrimary > 0 ? weights.pulsePrimary : 0
  const climaxShockwaveB = weights.pulseSecondary > 0 ? weights.pulseSecondary : 0

  const introLandingFlare = pulseEnvelopeGrand(clamp01((t - 0.25) / 1.5) * 5, 0.4, 4.4, 1)
  const cloneBurstFlare = pulseEnvelopeGrand(clamp01((t - 0.55) / 1.75) * 5, 0.5, 4.2, 0.72)
  const pillarIntensity = Math.max(
    descentBeam * 0.95,
    introLandingFlare * 0.95,
    weights.pulse * 0.95 + weights.gather * 0.35
  )

  const gourdPour = clamp01(pulseEnvelopeGrand(gt, 1, 4) + weights.gather * 0.3 + 0.08 + 0.06 * Math.sin(gt * 0.7))
  const gourdTilt = Math.sin(gt * 0.9) * 0.1 + gourdPour * 0.55
  const corkLift = gourdPour * 0.12 + weights.pulse * 0.05
  const vaporIntensity = gourdReveal * (0.25 + gourdPour * 0.75 + weights.pulse * 0.4)
  const gourdGlow = 6 + weights.gather * 6 + weights.pulse * 8

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
    gourdTilt,
    gourdPour,
    corkLift,
    vaporIntensity,
    gourdGlow,
    particleReveal,
    introShockwave,
    groundShockwave,
    climaxShockwaveA,
    climaxShockwaveB,
    pillarIntensity,
    formationIndex: weights.formationIndex,
    formationFade: weights.fade,
    weights
  }
}

function cloneSpawnOrigin(index: number): Vec3 {
  const shaftT = Math.pow(seed(index, 13), 0.78)
  const radial = (seed(index, 14) - 0.5) * 0.16
  const depth = (seed(index, 15) - 0.5) * 0.14
  return { x: HEART_X + radial, y: lerp(-1.3, 0.88, shaftT), z: depth }
}

function sampleIntroArcPosition(index: number, total: number, origin: Vec3, targetPos: Vec3, u: number): Vec3 {
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
      energy: 0,
      gold: 0.3,
      jade: 0.3,
      seal: 0
    }
  }

  const ease = easeOutCubic(u)
  const position = sampleIntroArcPosition(index, safeTotal, origin, target.position, u)
  const nextPosition = sampleIntroArcPosition(index, safeTotal, origin, target.position, Math.min(1, u + 0.02))
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
    energy: clamp01(Math.max(target.energy, burstFlare * 0.98)),
    gold: target.gold,
    jade: target.jade,
    seal: target.seal
  }
}

export function sampleFormationLinks(
  grandTime: number,
  outPositions: Float32Array,
  outWeights: Float32Array,
  outColors: Uint8Array
): number {
  const gt = ((grandTime % LOOP_SECONDS) + LOOP_SECONDS) % LOOP_SECONDS
  const rot = gt * 0.6
  const { index, fade, from } = formationAt(gt)
  let vertex = 0

  const push = (a: Vec3, b: Vec3, weight: number, color: number): void => {
    if (vertex + 2 > outWeights.length) return
    for (const [p, w] of [
      [a, weight],
      [b, weight]
    ] as const) {
      outPositions[vertex * 3] = p.x
      outPositions[vertex * 3 + 1] = p.y
      outPositions[vertex * 3 + 2] = p.z
      outWeights[vertex] = w
      outColors[vertex] = color
      vertex++
    }
  }

  const emit = (m: number, weight: number): void => {
    if (weight <= 0.01) return
    const meta = FORMATIONS[m]!
    const color = meta.linkColor
    if (meta.link === 'gates') {
      for (let g = 0; g < 4; g++) push(gateCenter(g, rot), { x: HEART_X, y: HEART_Y, z: -0.4 }, weight, color)
    } else if (meta.link === 'threads') {
      for (let k = 0; k < 12; k++) {
        const [a, b] = threadEnds(k)
        push(a, b, weight * 0.6, color)
      }
    } else if (meta.link === 'grid') {
      for (let c = 0; c < 9; c++) {
        if (c % 3 < 2) push(cellCenter(c), cellCenter(c + 1), weight * 0.7, color)
        if (c < 6) push(cellCenter(c), cellCenter(c + 3), weight * 0.7, color)
      }
      push(cellCenter(0), cellCenter(8), weight * 0.5, color)
      push(cellCenter(2), cellCenter(6), weight * 0.5, color)
    } else if (meta.link === 'ring') {
      for (let e = 0; e < 5; e++) push(elemCenter(e, rot), elemCenter((e + 1) % 5, rot), weight * 0.8, color)
    }
  }

  if (from === index) {
    emit(index, 1 - fade)
    emit((index + 1) % FORMATIONS.length, fade)
  } else {
    emit(from, 1 - fade)
    emit(index, fade)
  }
  return vertex / 2
}