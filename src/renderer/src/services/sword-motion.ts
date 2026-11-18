export const LOOP_SECONDS = 60
export const MOVEMENT_SECONDS = 5
export const INTRO_SECONDS = 3.8
export const IMPACT_SECONDS = 0.42
export const LINK_SEGMENT_CAPACITY = 96
export const HEART_X = 1.12
export const HEART_Y = 0.22

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
  nameEn: string
  sub: string
  subEn: string
  link: 'none' | 'threads' | 'grid' | 'ring'
  linkColor: 0 | 1 | 2
}

export const FORMATIONS: FormationMeta[] = [
  {
    name: '诛仙剑阵',
    nameEn: 'Zhu Xian Array',
    sub: '四门诛戮陷绝 · 杀意朝心',
    subEn: 'Four Gates of Slaughter · Blades Converged',
    link: 'none',
    linkColor: 0
  },
  {
    name: '大庚剑阵',
    nameEn: 'Da Geng Sword Array',
    sub: '庚金剑丝 · 隐匿穿空',
    subEn: 'Gilded Wire Threads · Silent Void Pierce',
    link: 'threads',
    linkColor: 0
  },
  {
    name: '春黎剑阵',
    nameEn: 'Chun Li Array',
    sub: '幻术为基 · 春影重叠',
    subEn: 'Illusion Foundation · Layered Dawn Shadows',
    link: 'none',
    linkColor: 1
  },
  {
    name: '青蟠剑阵',
    nameEn: 'Qing Pan Array',
    sub: '青元高阶 · 蟠龙绕柱',
    subEn: 'Azure Essence · Coiling Dragon Pillars',
    link: 'none',
    linkColor: 1
  },
  {
    name: '小千剑阵',
    nameEn: 'Xiao Qian Array',
    sub: '千剑层叠 · 六重呼吸',
    subEn: 'Thousand Layered Blades · Sixfold Breath',
    link: 'none',
    linkColor: 0
  },
  {
    name: '大千剑阵',
    nameEn: 'Da Qian Array',
    sub: '大千世界 · 三环浑天',
    subEn: 'Grand Cosmos · Tri-Ring Celestial Sphere',
    link: 'none',
    linkColor: 0
  },
  {
    name: '恒山剑阵',
    nameEn: 'Heng Shan Array',
    sub: '七人一队 · 攻守相济',
    subEn: 'Seven-Star Phalanx · Balanced Guard & Strike',
    link: 'none',
    linkColor: 1
  },
  {
    name: '六脉神剑阵',
    nameEn: 'Six Meridians Array',
    sub: '六脉剑气 · 依次奔涌',
    subEn: 'Six Meridian Qi · Cascading Surge',
    link: 'none',
    linkColor: 0
  },
  {
    name: '罗汉剑阵',
    nameEn: 'Arhat Sword Array',
    sub: '少林罗汉 · 立剑如僧',
    subEn: 'Shaolin Arhat · Standing Blades in Serenity',
    link: 'none',
    linkColor: 0
  },
  {
    name: '九宫八卦剑阵',
    nameEn: 'Bagua Nine-Palace Array',
    sub: '九宫方位 · 交织剑网',
    subEn: 'Nine Palaces · Interwoven Trigram Lattice',
    link: 'grid',
    linkColor: 1
  },
  {
    name: '五行连环剑阵',
    nameEn: 'Five Elements Ring',
    sub: '五行相生 · 连环合击',
    subEn: 'Wu Xing Cycle · Linked Orbital Strike',
    link: 'ring',
    linkColor: 0
  },
  {
    name: '五九剑阵',
    nameEn: 'Five-Nine Vortex Array',
    sub: '四五长剑 · 旋盘不息',
    subEn: 'Forty-Five Longswords · Perpetual Spiral',
    link: 'none',
    linkColor: 0
  }
]

export interface FormationWeights {
  phase: number
  gather: number
  lotus: number
  vortex: number
  volley: number
  ambientPulse: number
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
  mainSwordTiltX: number
  mainSwordTiltZ: number
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
  skyReveal: number
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
const CROSS = 0.45
const DAGENG_THREAD_COUNT = 24

export function createEmptyPose(): SwordPose {
  return {
    position: { x: 0, y: 0, z: 0 },
    direction: { x: 0, y: 1, z: 0 },
    scale: 0,
    glow: 0,
    stretch: 1,
    energy: 0,
    gold: 0,
    jade: 0,
    seal: 0
  }
}

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

function seed(index: number, salt: number): number {
  const value = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453
  return value - Math.floor(value)
}

function fract(value: number): number {
  return value - Math.floor(value)
}

function writeFib(j: number, n: number, out: Vec3): void {
  const y = 1 - (2 * (j + 0.5)) / Math.max(1, n)
  const r = Math.sqrt(Math.max(0, 1 - y * y))
  const th = j * 2.399963
  out.x = Math.cos(th) * r
  out.y = y
  out.z = Math.sin(th) * r
}

function rotateAroundInto(
  vx: number,
  vy: number,
  vz: number,
  ax: number,
  ay: number,
  az: number,
  angle: number,
  out: Vec3
): void {
  const len = Math.hypot(ax, ay, az) || 1
  const nx = ax / len
  const ny = ay / len
  const nz = az / len
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const dot = nx * vx + ny * vy + nz * vz
  const cx = ny * vz - nz * vy
  const cy = nz * vx - nx * vz
  const cz = nx * vy - ny * vx
  const oneMinusC = 1 - c
  out.x = vx * c + cx * s + nx * dot * oneMinusC
  out.y = vy * c + cy * s + ny * dot * oneMinusC
  out.z = vz * c + cz * s + nz * dot * oneMinusC
}

function setPose(
  out: SwordPose,
  px: number,
  py: number,
  pz: number,
  dx: number,
  dy: number,
  dz: number,
  scale: number,
  glow: number,
  stretch: number,
  energy: number,
  gold: number,
  jade: number,
  seal: number
): void {
  out.position.x = px
  out.position.y = py
  out.position.z = pz
  const len = Math.hypot(dx, dy, dz)
  if (len < 1e-6) {
    out.direction.x = 0
    out.direction.y = 1
    out.direction.z = 0
  } else {
    out.direction.x = dx / len
    out.direction.y = dy / len
    out.direction.z = dz / len
  }
  out.scale = scale
  out.glow = glow
  out.stretch = stretch
  out.energy = energy
  out.gold = gold
  out.jade = jade
  out.seal = seal
}

function copyPose(src: SwordPose, dst: SwordPose): void {
  dst.position.x = src.position.x
  dst.position.y = src.position.y
  dst.position.z = src.position.z
  dst.direction.x = src.direction.x
  dst.direction.y = src.direction.y
  dst.direction.z = src.direction.z
  dst.scale = src.scale
  dst.glow = src.glow
  dst.stretch = src.stretch
  dst.energy = src.energy
  dst.gold = src.gold
  dst.jade = src.jade
  dst.seal = src.seal
}

const tmpVecA: Vec3 = { x: 0, y: 0, z: 0 }
const tmpVecB: Vec3 = { x: 0, y: 0, z: 0 }
const scratchCurrent = createEmptyPose()
const scratchOther = createEmptyPose()
const scratchTarget = createEmptyPose()

function writeGateCenter(gate: number, base: number, out: Vec3): void {
  const angle = (gate * TAU) / 4 + TAU / 8 + base
  out.x = HEART_X + Math.cos(angle) * 2.85
  out.y = HEART_Y + Math.sin(angle) * 2.08
  out.z = -0.58 + Math.sin(angle * 2) * 0.36
}

function writeDagengEnds(k: number, outA: Vec3, outB: Vec3): void {
  const planeZ = -1.7 + (k % 5) * 0.56
  outA.x = HEART_X - 2.35 + seed(k, 1) * 5.2
  outA.y = -1.95 + seed(k, 2) * 4.25
  outA.z = planeZ + (seed(k, 3) - 0.5) * 0.65
  outB.x = HEART_X - 2.35 + seed(k, 4) * 5.2
  outB.y = -1.95 + seed(k, 5) * 4.25
  outB.z = planeZ + (seed(k, 6) - 0.5) * 0.65
}

function writeJiugongCellCenter(cell: number, base: number, out: Vec3): void {
  const gx = ((cell % 3) - 1) * 1.44
  const gy = (Math.floor(cell / 3) - 1) * 1.18
  const yaw = 0.24 + Math.sin(base * 2) * 0.08
  const pitch = -0.16
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  const rx = gx * cy
  const rz1 = -gx * sy
  const ry = gy * cp - rz1 * sp
  const rz = gy * sp + rz1 * cp
  out.x = HEART_X + 0.08 + rx
  out.y = HEART_Y + ry
  out.z = -0.95 + rz
}

function writeBaguaAnchor(trigram: number, base: number, out: Vec3): void {
  const angle = (trigram * TAU) / 8 - base * 2
  const r = 3.45
  out.x = HEART_X + 0.08 + Math.cos(angle) * r
  out.y = HEART_Y + Math.sin(angle) * r * 0.84
  out.z = -1.15 + Math.sin(angle * 2) * 0.35
}

function writeElemCenter(elem: number, base: number, out: Vec3): void {
  const angle = (elem * TAU) / 5 - TAU / 4 + base * 2
  out.x = HEART_X + Math.cos(angle) * 2.35
  out.y = HEART_Y + Math.sin(angle) * 1.85
  out.z = -0.78 + Math.sin(angle) * 0.45
}

function poseZhuxian(i: number, n: number, cyc: number, base: number, out: SwordPose): void {
  const gateEnd = Math.floor(n * 0.62)
  const streamEnd = Math.floor(n * 0.86)
  if (i < gateEnd) {
    const gate = i % 4
    const localIdx = Math.floor(i / 4)
    const per = Math.max(1, Math.ceil(gateEnd / 4))
    writeGateCenter(gate, base, tmpVecA)
    const rx = HEART_X - tmpVecA.x
    const ry = HEART_Y - tmpVecA.y
    const rz = -0.1 - tmpVecA.z
    const rLen = Math.hypot(rx, ry, rz) || 1
    const nx = rx / rLen
    const ny = ry / rLen
    const nz = rz / rLen
    // Tangent basis (U, V) orthogonal to portal normal N
    const ux = -ny
    const uy = nx
    const uLen = Math.hypot(ux, uy) || 1
    const u0 = ux / uLen
    const u1 = uy / uLen
    const v0 = ny * 0 - nz * u1
    const v1 = nz * u0 - nx * 0
    const v2 = nx * u1 - ny * u0

    const ring = localIdx % 3
    const ringPer = Math.max(1, Math.ceil(per / 3))
    const ringAng = (Math.floor(localIdx / 3) / ringPer) * TAU + base * (ring % 2 ? -6 : 6)
    const portalR = 0.24 + ring * 0.34
    const ca = Math.cos(ringAng) * portalR
    const sa = Math.sin(ringAng) * portalR
    const depthStep = (1 - ring) * 0.22
    const px = tmpVecA.x + u0 * ca + v0 * sa + nx * depthStep
    const py = tmpVecA.y + u1 * ca + v1 * sa + ny * depthStep
    const pz = tmpVecA.z + v2 * sa + nz * depthStep
    const fired = Math.floor(cyc * 72) % 4 === gate ? 1 : 0
    setPose(
      out,
      px,
      py,
      pz,
      HEART_X - px,
      HEART_Y - py,
      -0.1 - pz,
      0.155 + fired * 0.032 + (ring === 2 ? 0.015 : 0),
      0.42 + fired * 0.45,
      1.08 + fired * 0.55,
      0.45 + fired * 0.5,
      0.48 + fired * 0.34,
      0.06,
      0.32 + fired * 0.48
    )
    return
  }
  if (i < streamEnd) {
    const local = i - gateEnd
    const count = Math.max(1, streamEnd - gateEnd)
    const gate = local % 4
    const per = Math.max(1, Math.ceil(count / 4))
    writeGateCenter(gate, base, tmpVecA)
    const theta = (Math.floor(local / 4) / per) * TAU + base * 12
    const u = 0.5 - 0.44 * Math.cos(theta)
    const loopDir = Math.sin(theta)
    const arcLift = loopDir * 0.24
    const jitter = (seed(i, 21) - 0.5) * 0.18 * (1 - u * 0.55)
    const px = lerp(tmpVecA.x, HEART_X, u) + jitter
    const py = lerp(tmpVecA.y, HEART_Y, u) + arcLift + (seed(i, 22) - 0.5) * 0.16 * (1 - u * 0.55)
    const pz = lerp(tmpVecA.z, -0.08, u) - Math.abs(arcLift) * 0.4
    const dirSign = loopDir >= 0 ? 1 : -1
    setPose(
      out,
      px,
      py,
      pz,
      (HEART_X - tmpVecA.x) * dirSign,
      (HEART_Y - tmpVecA.y) * dirSign,
      (-0.08 - tmpVecA.z) * dirSign,
      0.125 + Math.max(0, loopDir) * 0.025,
      0.55 + Math.max(0, loopDir) * 0.25,
      1.75 + Math.max(0, loopDir) * 0.35,
      0.65 + Math.max(0, loopDir) * 0.25,
      0.72,
      0.04,
      0.62
    )
    return
  }
  const local = i - streamEnd
  const count = Math.max(1, n - streamEnd)
  const ang = (local / count) * TAU - base * 3
  const r = 3.55
  const px = HEART_X + Math.cos(ang) * r
  const py = HEART_Y + Math.sin(ang) * r * 0.78
  const pz = -1.25 + Math.cos(ang * 2) * 0.38
  setPose(out, px, py, pz, HEART_X - px, HEART_Y - py, 0.25, 0.14, 0.34, 1.12, 0.35, 0.66, 0.06, 0.28)
}

function poseDageng(i: number, n: number, _cyc: number, base: number, out: SwordPose): void {
  const threadLimit = Math.floor(n * 0.84)
  if (i < threadLimit) {
    const k = i % DAGENG_THREAD_COUNT
    const per = Math.max(1, Math.ceil(threadLimit / DAGENG_THREAD_COUNT))
    const phase = (Math.floor(i / DAGENG_THREAD_COUNT) / per) * TAU
    const theta = phase + base * 10 * (k % 2 === 0 ? 1 : -1)
    const s = 0.5 - 0.46 * Math.cos(theta)
    const travel = Math.sin(theta)
    const dirSign = travel >= 0 ? (k % 2 === 0 ? 1 : -1) : k % 2 === 0 ? -1 : 1
    writeDagengEnds(k, tmpVecA, tmpVecB)
    const dx = tmpVecB.x - tmpVecA.x
    const dy = tmpVecB.y - tmpVecA.y
    const dz = tmpVecB.z - tmpVecA.z
    const wave = travel * 0.055
    const px = lerp(tmpVecA.x, tmpVecB.x, s)
    const py = lerp(tmpVecA.y, tmpVecB.y, s) + wave
    const pz = lerp(tmpVecA.z, tmpVecB.z, s)
    const shimmer = 0.5 + 0.5 * Math.sin(base * 18 + k * 1.1)
    setPose(
      out,
      px,
      py,
      pz,
      dx * dirSign,
      dy * dirSign,
      dz * dirSign,
      0.125,
      0.38 + shimmer * 0.35,
      2.1,
      0.42 + shimmer * 0.45,
      0.88,
      0.08,
      0
    )
    return
  }
  const local = i - threadLimit
  const count = Math.max(1, n - threadLimit)
  const ang = (local / count) * TAU + base * 4
  const r = 3.25
  const px = HEART_X + Math.cos(ang) * r
  const py = HEART_Y + Math.sin(ang) * r * 0.76
  const pz = -1.2 + Math.sin(ang * 3) * 0.32
  setPose(out, px, py, pz, -Math.sin(ang), Math.cos(ang), 0.15, 0.16, 0.42, 1.3, 0.45, 0.82, 0.12, 0)
}

function poseChunli(i: number, n: number, _cyc: number, base: number, out: SwordPose): void {
  const petalEnd = Math.floor(n * 0.72)
  if (i < petalEnd) {
    const arm = i % 5
    const ribbon = (Math.floor(i / 5) % 3) - 1
    const per = Math.max(1, Math.ceil(petalEnd / 15))
    const t = Math.floor(i / 15) / per
    const petalSpread = ribbon * 0.22 * Math.sin(t * Math.PI)
    const ang = (arm * TAU) / 5 + t * 2.25 + petalSpread + base * 3
    const r = 0.46 + t * 2.85
    const px = HEART_X + Math.cos(ang) * r
    const py = HEART_Y + Math.sin(ang) * r * 0.86
    const pz = -0.88 + Math.sin(t * Math.PI) * 0.58 + ribbon * 0.18
    const pulse = 0.5 + 0.5 * Math.sin(base * 12 + t * 5 + arm)
    setPose(
      out,
      px,
      py,
      pz,
      Math.cos(ang) * 0.65 - Math.sin(ang) * 0.4,
      Math.sin(ang) * 0.65 + Math.cos(ang) * 0.4,
      0.22 * Math.cos(t * Math.PI),
      0.155,
      0.38 + pulse * 0.28,
      1.08,
      0.34 + pulse * 0.32,
      0.18 + (1 - t) * 0.34,
      0.8,
      0
    )
    return
  }
  const local = i - petalEnd
  const count = Math.max(1, n - petalEnd)
  const arm = local % 5
  const t = Math.floor(local / 5) / Math.max(1, Math.ceil(count / 5))
  const drift = Math.sin(base * 12 + local * 0.35) * 0.26
  const ang = (arm * TAU) / 5 + t * 2.3 + base * 3 + 0.22
  const r = 0.72 + t * 2.75
  const px = HEART_X + Math.cos(ang) * r - Math.sin(ang) * drift
  const py = HEART_Y + Math.sin(ang) * r * 0.86 + Math.cos(ang) * drift
  const pz = -1.25 + Math.cos(base * 6 + local) * 0.38
  setPose(out, px, py, pz, -Math.sin(ang), Math.cos(ang), 0.15, 0.12, 0.34, 1.15, 0.3, 0.12, 0.88, 0)
}

function poseQingpan(i: number, n: number, _cyc: number, base: number, out: SwordPose): void {
  const dragonEnd = Math.floor(n * 0.74)
  if (i < dragonEnd) {
    const strand = i % 5
    const per = Math.max(1, Math.ceil(dragonEnd / 5))
    const t = Math.floor(i / 5) / per
    const ang = t * TAU * 3.25 + base * 4
    const spineR = lerp(2.3, 0.92, t) + 0.24 * Math.sin(t * TAU * 2 + base * 8)
    const sx = HEART_X + Math.cos(ang) * spineR
    const sy = -1.72 + t * 3.68
    const sz = -0.58 + Math.sin(ang) * spineR * 0.56
    const strandAng = (strand / 5) * TAU + t * 16 + base * 6
    const isHead = t > 0.91
    const tubeR = isHead ? 0.34 * (1 + (t - 0.91) * 4) : 0.19 * Math.sin(t * Math.PI * 0.9 + 0.18)
    const px = sx + Math.cos(strandAng) * tubeR
    const py = sy + Math.sin(strandAng) * tubeR * 0.65
    const pz = sz + Math.sin(strandAng) * tubeR
    setPose(
      out,
      px,
      py,
      pz,
      -Math.sin(ang) * 1.1,
      0.85,
      Math.cos(ang) * 0.6,
      isHead ? 0.2 : 0.155,
      0.38 + (isHead ? 0.45 : 0.2 * Math.sin(base * 12 + t * 6)),
      isHead ? 1.35 : 1.18,
      0.42 + (isHead ? 0.45 : 0.22 * Math.sin(base * 12 + t * 6)),
      isHead ? 0.58 : 0.24,
      isHead ? 0.78 : 0.85,
      isHead ? 0.15 : 0
    )
    return
  }
  const local = i - dragonEnd
  const count = Math.max(1, n - dragonEnd)
  const ang = (local / count) * TAU * 2 - base * 5
  const t = local / count
  const r = 2.65 + 0.65 * Math.sin(t * Math.PI)
  const px = HEART_X + Math.cos(ang) * r
  const py = -1.55 + t * 3.35
  const pz = -1.05 + Math.sin(ang) * r * 0.45
  setPose(out, px, py, pz, -Math.sin(ang), 0.72, Math.cos(ang) * 0.45, 0.12, 0.3, 1.1, 0.3, 0.16, 0.78, 0)
}

function poseXiaoqian(i: number, n: number, _cyc: number, base: number, out: SwordPose): void {
  const layer = i % 6
  const per = Math.max(1, Math.ceil(n / 6))
  const j = Math.floor(i / 6)
  const band = j % 2
  const breath = Math.sin(base * 12 - layer * 0.7)
  const ang = (j / per) * TAU + base * (layer % 2 ? -4 : 4) + layer * 0.24
  const r = 0.72 + layer * 0.46 + band * 0.14 + breath * 0.14
  const lx = Math.cos(ang) * r
  const ly = Math.sin(ang) * r * 0.9
  const lz = (band ? 0.08 : -0.08) - layer * 0.14
  const tilt = ((layer % 3) - 1) * 0.24 + Math.sin(base * 4 + layer) * 0.09
  rotateAroundInto(lx, ly, lz, 0.8, 0.4, 0, tilt, tmpVecA)
  const px = HEART_X + tmpVecA.x
  const py = HEART_Y + tmpVecA.y
  const pz = -0.65 + tmpVecA.z
  rotateAroundInto(-Math.sin(ang), Math.cos(ang), 0.12 * (band ? 1 : -1), 0.8, 0.4, 0, tilt, tmpVecB)
  setPose(
    out,
    px,
    py,
    pz,
    tmpVecB.x,
    tmpVecB.y,
    tmpVecB.z,
    0.15 + (5 - layer) * 0.008,
    0.36 + 0.18 * breath,
    1.05,
    0.34 + 0.22 * breath,
    layer % 2 ? 0.68 : 0.28,
    layer % 2 ? 0.22 : 0.68,
    0
  )
}

const DAQIAN_AXES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 0],
  [0.707, 0.707, 0],
  [0, 0.6, 0.8]
]

function poseDaqian(i: number, n: number, _cyc: number, base: number, out: SwordPose): void {
  const ringEnd = Math.floor(n * 0.45)
  if (i < ringEnd) {
    const shell = i % 3
    const per = Math.max(1, Math.ceil(ringEnd / 3))
    const j = Math.floor(i / 3)
    const ang = (j / per) * TAU + base * (3 + shell * 2)
    const r = 2.05 + shell * 0.62
    const [ax, ay, az] = DAQIAN_AXES[shell]!
    // Build ring in XZ rotated onto axis
    const baseTilt = shell === 0 ? 0.25 : shell === 1 ? 0.95 : -0.82
    rotateAroundInto(
      Math.cos(ang) * r,
      j % 2 === 0 ? 0.06 : -0.06,
      Math.sin(ang) * r,
      ax,
      ay,
      az,
      baseTilt,
      tmpVecA
    )
    const px = HEART_X + tmpVecA.x
    const py = HEART_Y + tmpVecA.y
    const pz = -0.78 + tmpVecA.z
    rotateAroundInto(-Math.sin(ang), 0, Math.cos(ang), ax, ay, az, baseTilt, tmpVecB)
    setPose(out, px, py, pz, tmpVecB.x, tmpVecB.y, tmpVecB.z, 0.165, 0.48, 1.15, 0.45, 0.78, 0.22, 0)
    return
  }
  const local = i - ringEnd
  const count = Math.max(1, n - ringEnd)
  const shell = local % 3
  const per = Math.max(1, Math.ceil(count / 3))
  writeFib(Math.floor(local / 3), per, tmpVecA)
  const r = 1.2 + shell * 0.95
  const [ax, ay, az] = DAQIAN_AXES[shell]!
  rotateAroundInto(tmpVecA.x * r, tmpVecA.y * r, tmpVecA.z * r, ax, ay, az, base * (2 + shell), tmpVecB)
  const px = HEART_X + tmpVecB.x
  const py = HEART_Y + tmpVecB.y
  const pz = -0.82 + tmpVecB.z
  const tx = ay * tmpVecB.z - az * tmpVecB.y
  const ty = az * tmpVecB.x - ax * tmpVecB.z
  const tz = ax * tmpVecB.y - ay * tmpVecB.x
  setPose(out, px, py, pz, tx, ty, tz, 0.145, 0.36, 1.0, 0.35, 0.62, 0.38, 0)
}

function poseHengshan(i: number, n: number, _cyc: number, base: number, out: SwordPose): void {
  const rosetteSquads = n >= 210 ? 60 : Math.max(1, Math.floor(n / 7))
  const rosetteLimit = rosetteSquads * 7
  if (i < rosetteLimit) {
    const squad = Math.floor(i / 7)
    const member = i % 7
    const t0Count = Math.min(rosetteSquads, Math.max(1, Math.round(rosetteSquads * 0.24)))
    const t1Count = Math.min(
      Math.max(0, rosetteSquads - t0Count),
      Math.max(1, Math.round(rosetteSquads * 0.34))
    )
    const t2Count = Math.max(1, rosetteSquads - t0Count - t1Count)
    const tier = squad < t0Count ? 0 : squad < t0Count + t1Count ? 1 : 2
    const tierStart = tier === 0 ? 0 : tier === 1 ? t0Count : t0Count + t1Count
    const tierCount = tier === 0 ? t0Count : tier === 1 ? t1Count : t2Count
    const ang = ((squad - tierStart) / tierCount) * TAU + base * (tier === 1 ? -3 : 2)
    const orbR = 1.55 + tier * 0.92
    const cx = HEART_X + Math.cos(ang) * orbR
    const cy = HEART_Y + Math.sin(ang) * orbR * 0.72
    const cz = -0.75 + (tier - 1) * 0.38
    const mode = smoothstep(-0.22, 0.22, Math.sin(base * 6 + squad * 0.45))
    const mr = lerp(0.22, 0.4, mode)
    const ma = (member * TAU) / 7 + base * 6
    const ox = Math.cos(ma) * mr
    const oy = Math.sin(ma) * mr
    const dirX = lerp(-ox, ox, mode)
    const dirY = lerp(-oy, oy, mode)
    setPose(
      out,
      cx + ox,
      cy + oy,
      cz + Math.sin(ma) * 0.12,
      dirX,
      dirY,
      0.18 * mode,
      0.155,
      0.38,
      1 + mode * 0.25,
      0.32 + mode * 0.35,
      0.32,
      0.45,
      0.06
    )
    return
  }
  const local = i - rosetteLimit
  const count = Math.max(1, n - rosetteLimit)
  const ring = local % 2
  const ang = (local / count) * TAU + base * (ring ? -2 : 2)
  const r = ring ? 3.15 : 2.1
  const mode = smoothstep(-0.25, 0.25, Math.sin(base * 6 + ang * 3))
  const px = HEART_X + Math.cos(ang) * r
  const py = HEART_Y + Math.sin(ang) * r * 0.78
  const pz = -1.15 - ring * 0.35 + Math.sin(ang * 3) * 0.14
  const sign = mode * 2 - 1
  setPose(
    out,
    px,
    py,
    pz,
    Math.cos(ang) * sign,
    Math.sin(ang) * sign,
    0.15,
    0.125,
    0.3,
    1.05 + mode * 0.2,
    0.28 + mode * 0.3,
    0.28,
    0.48,
    0.04
  )
}

function poseLiumai(i: number, n: number, cyc: number, base: number, out: SwordPose): void {
  const mer = i % 6
  const lane = Math.floor(i / 6) % 3
  const per = Math.max(1, Math.ceil(n / 18))
  const s = Math.floor(i / 18) / per
  const ang = (mer * TAU) / 6 + base * 2
  const wave = fract(cyc * 24 - mer / 6)
  const g = Math.pow(0.5 + 0.5 * Math.cos((s - wave) * TAU), 6)
  const r = 0.42 + s * 3.35
  const tubeR = lane === 0 ? 0.04 : 0.2
  const tubeA = (lane * TAU) / 3 + s * 8 + base * 6
  const zSlope = mer % 2 === 0 ? 0.26 : -0.22
  const cosA = Math.cos(ang)
  const sinA = Math.sin(ang)
  const px = HEART_X + cosA * r - sinA * Math.cos(tubeA) * tubeR
  const py = HEART_Y + sinA * r * 0.82 + cosA * Math.cos(tubeA) * tubeR
  const pz = -0.6 + r * zSlope + Math.sin(tubeA) * tubeR
  setPose(
    out,
    px,
    py,
    pz,
    cosA,
    sinA * 0.82,
    zSlope,
    0.155 + g * 0.035,
    0.34 + g * 0.56,
    1.1 + g * 1.35,
    0.26 + g * 0.74,
    0.42 + g * 0.58,
    0.34 * (1 - g),
    0
  )
}

function poseLuohan(i: number, n: number, _cyc: number, base: number, out: SwordPose): void {
  const pillarCount = Math.min(18, Math.max(4, Math.floor(n * 0.12)))
  if (i < pillarCount) {
    const ang = (i / pillarCount) * TAU + base * 2
    const r = 1.58
    const px = HEART_X + Math.cos(ang) * r
    const py = HEART_Y + Math.sin(ang) * r * 0.38 - 0.15
    const pz = -0.65 - Math.sin(ang) * r * 0.38
    const chant = 0.5 + 0.5 * Math.cos(ang * 2 - base * 12)
    const sway = Math.sin(base * 6 + i) * 0.04
    setPose(
      out,
      px,
      py,
      pz,
      sway,
      1,
      sway * 0.5,
      0.24,
      0.35 + chant * 0.38,
      1.15,
      0.28 + chant * 0.45,
      0.72,
      0.1,
      0.08
    )
    return
  }
  const local = i - pillarCount
  const count = Math.max(1, n - pillarCount)
  const tier = local % 3
  const per = Math.max(1, Math.ceil(count / 3))
  const ang = (Math.floor(local / 3) / per) * TAU + base * (tier % 2 ? -1 : 1)
  const r = 2.15 + tier * 0.62
  const px = HEART_X + Math.cos(ang) * r
  const py = HEART_Y + Math.sin(ang) * r * 0.42 - 0.35 + tier * 0.48
  const pz = -1.05 - Math.sin(ang) * r * 0.45
  const zenWave = 0.5 + 0.5 * Math.cos(ang * 3 - base * 12 + tier * 0.7)
  const sway = Math.sin(base * 6 + local * 0.3) * 0.04
  setPose(
    out,
    px,
    py,
    pz,
    sway,
    1,
    sway * 0.4,
    0.165 - tier * 0.012,
    0.26 + zenWave * 0.3,
    1.05,
    0.2 + zenWave * 0.35,
    0.58 + zenWave * 0.2,
    0.14,
    0.04
  )
}

function poseJiugong(i: number, n: number, _cyc: number, base: number, out: SwordPose): void {
  const palaceEnd = Math.floor(n * 0.72)
  if (i < palaceEnd) {
    const cell = i % 9
    const localIdx = Math.floor(i / 9)
    const per = Math.max(1, Math.ceil(palaceEnd / 9))
    writeJiugongCellCenter(cell, base, tmpVecA)
    const tier = localIdx % 3
    const tierPer = Math.max(1, Math.ceil(per / 3))
    const ang = (Math.floor(localIdx / 3) / tierPer) * TAU + base * (cell % 2 ? -6 : 6) + tier * 0.45
    const r = tier === 0 ? 0.14 : tier === 1 ? 0.33 : 0.49
    const lx = Math.cos(ang) * r
    const ly = Math.sin(ang) * r * 0.88
    const lz = (tier - 1) * 0.14
    rotateAroundInto(lx, ly, lz, 0.25, 1, 0, 0.22, tmpVecB)
    const px = tmpVecA.x + tmpVecB.x
    const py = tmpVecA.y + tmpVecB.y
    const pz = tmpVecA.z + tmpVecB.z
    const pulse = 0.5 + 0.5 * Math.sin(base * 12 + cell * 0.7)
    setPose(
      out,
      px,
      py,
      pz,
      -Math.sin(ang),
      Math.cos(ang) * 0.88,
      0.24,
      0.135 + (tier === 0 ? 0.025 : 0),
      0.38 + pulse * 0.22,
      1.08,
      0.36 + pulse * 0.24,
      cell % 2 ? 0.58 : 0.28,
      cell % 2 ? 0.28 : 0.66,
      0
    )
    return
  }
  const local = i - palaceEnd
  const count = Math.max(1, n - palaceEnd)
  const trigram = local % 8
  const localIdx = Math.floor(local / 8)
  const per = Math.max(1, Math.ceil(count / 8))
  const bar = localIdx % 3
  const barPer = Math.max(1, Math.ceil(per / 3))
  const t = Math.floor(localIdx / 3) / barPer - 0.5
  writeBaguaAnchor(trigram, base, tmpVecA)
  const radialAng = Math.atan2(tmpVecA.y - HEART_Y, tmpVecA.x - (HEART_X + 0.08))
  const tangX = -Math.sin(radialAng)
  const tangY = Math.cos(radialAng)
  const cosR = Math.cos(radialAng)
  const sinR = Math.sin(radialAng)
  const barOffset = (bar - 1) * 0.16
  const span = t * 0.62
  const px = tmpVecA.x + cosR * barOffset + tangX * span
  const py = tmpVecA.y + sinR * barOffset + tangY * span
  const pz = tmpVecA.z + (bar - 1) * 0.06
  setPose(out, px, py, pz, HEART_X - px, HEART_Y - py, 0.22, 0.13, 0.36, 1.1, 0.38, 0.6, 0.44, 0)
}

const ELEMENT_MIX: ReadonlyArray<readonly [number, number, number]> = [
  [0.85, 0.1, 0],
  [0.14, 0.84, 0],
  [0.12, 0.48, 0],
  [0.24, 0.05, 0.74],
  [0.56, 0.16, 0.22]
]

function poseWuxing(i: number, n: number, cyc: number, base: number, out: SwordPose): void {
  const elemEnd = Math.floor(n * 0.72)
  if (i < elemEnd) {
    const elem = i % 5
    const localIdx = Math.floor(i / 5)
    const per = Math.max(1, Math.ceil(elemEnd / 5))
    writeElemCenter(elem, base, tmpVecA)
    const ring = localIdx % 3
    const ringPer = Math.max(1, Math.ceil(per / 3))
    const ang = (Math.floor(localIdx / 3) / ringPer) * TAU + base * (ring % 2 ? -6 : 6)
    const active = Math.floor(cyc * 60) % 5 === elem ? 1 : 0
    const r = ring === 0 ? 0.16 : ring === 1 ? 0.36 : 0.56
    const lx = Math.cos(ang) * r
    const ly = Math.sin(ang) * r * (elem === 1 ? 1.15 : 0.88)
    const lz = ring === 0 ? 0.22 : (ring - 1) * 0.15
    rotateAroundInto(lx, ly, lz, 0.6, 0.8, 0, elem * 0.45 + base * 2, tmpVecB)
    const px = tmpVecA.x + tmpVecB.x
    const py = tmpVecA.y + tmpVecB.y
    const pz = tmpVecA.z + tmpVecB.z
    writeElemCenter((elem + 1) % 5, base, tmpVecB)
    const [gold, jade, seal] = ELEMENT_MIX[elem]!
    setPose(
      out,
      px,
      py,
      pz,
      tmpVecB.x - px,
      tmpVecB.y - py,
      tmpVecB.z - pz,
      0.155 + active * 0.03,
      0.38 + active * 0.44,
      1.08 + active * 0.35,
      0.36 + active * 0.52,
      gold,
      jade,
      seal
    )
    return
  }
  const local = i - elemEnd
  const count = Math.max(1, n - elemEnd)
  const loopProgress = fract(local / count + cyc * 3) * 5
  const elem = Math.floor(loopProgress) % 5
  const u = loopProgress - Math.floor(loopProgress)
  writeElemCenter(elem, base, tmpVecA)
  writeElemCenter((elem + 1) % 5, base, tmpVecB)
  const arcLift = Math.sin(u * Math.PI) * 0.42
  const px = lerp(tmpVecA.x, tmpVecB.x, u) + (tmpVecA.x - HEART_X) * arcLift * 0.14
  const py = lerp(tmpVecA.y, tmpVecB.y, u) + (tmpVecA.y - HEART_Y) * arcLift * 0.14
  const pz = lerp(tmpVecA.z, tmpVecB.z, u) + arcLift * 0.45
  const [gold, jade, seal] = ELEMENT_MIX[elem]!
  setPose(
    out,
    px,
    py,
    pz,
    tmpVecB.x - tmpVecA.x,
    tmpVecB.y - tmpVecA.y,
    tmpVecB.z - tmpVecA.z,
    0.125,
    0.48,
    1.65,
    0.58,
    gold,
    jade,
    seal
  )
}

function poseWujiu(i: number, n: number, _cyc: number, base: number, out: SwordPose): void {
  if (i < 45) {
    const ang = (i / 45) * TAU + base * 12
    const r = 1.42 + (i % 3) * 0.24
    const px = HEART_X + Math.cos(ang) * r
    const py = HEART_Y + Math.sin(ang) * r * 0.85
    const pz = -0.48 + Math.sin(ang * 3) * 0.18
    setPose(
      out,
      px,
      py,
      pz,
      -Math.sin(ang),
      Math.cos(ang) * 0.85,
      0.12,
      0.22,
      0.56,
      1.24,
      0.65,
      0.86,
      0.16,
      0
    )
    return
  }
  const local = i - 45
  const outerTotal = Math.max(1, n - 45)
  const arm = local % 5
  const per = Math.max(1, Math.ceil(outerTotal / 5))
  const t = Math.floor(local / 5) / per
  const ang = (arm * TAU) / 5 + t * 2.2 + base * 4
  const r = 2.02 + t * 2.18
  const px = HEART_X + Math.cos(ang) * r
  const py = HEART_Y + Math.sin(ang) * r * 0.8
  const pz = -0.78 - t * 1.15 + Math.sin(t * TAU * 2 + arm + base * 6) * 0.12
  setPose(
    out,
    px,
    py,
    pz,
    -Math.sin(ang),
    Math.cos(ang) * 0.8,
    -0.08,
    0.125 + (1 - t) * 0.03,
    0.26 + (1 - t) * 0.2,
    1.08,
    0.24 + (1 - t) * 0.25,
    0.45 + (1 - t) * 0.3,
    0.38,
    0
  )
}

const MOVEMENTS: ReadonlyArray<(i: number, n: number, cyc: number, base: number, out: SwordPose) => void> = [
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

function blendPoseInto(a: SwordPose, b: SwordPose, f: number, pinch: number, out: SwordPose): void {
  const mx = lerp(a.position.x, b.position.x, f)
  const my = lerp(a.position.y, b.position.y, f)
  const mz = lerp(a.position.z, b.position.z, f)
  out.position.x = HEART_X + (mx - HEART_X) * (1 - pinch)
  out.position.y = HEART_Y + (my - HEART_Y) * (1 - pinch)
  out.position.z = mz * (1 - pinch * 0.5)

  const dx = lerp(a.direction.x, b.direction.x, f)
  const dy = lerp(a.direction.y, b.direction.y, f)
  const dz = lerp(a.direction.z, b.direction.z, f)
  const len = Math.hypot(dx, dy, dz)
  if (len < 1e-6) {
    out.direction.x = 0
    out.direction.y = 1
    out.direction.z = 0
  } else {
    out.direction.x = dx / len
    out.direction.y = dy / len
    out.direction.z = dz / len
  }

  out.scale = lerp(a.scale, b.scale, f)
  out.glow = lerp(a.glow, b.glow, f) + pinch * 0.6
  out.stretch = lerp(a.stretch, b.stretch, f)
  out.energy = lerp(a.energy, b.energy, f)
  out.gold = lerp(a.gold, b.gold, f)
  out.jade = lerp(a.jade, b.jade, f)
  out.seal = lerp(a.seal, b.seal, f)
}

export function formationAt(grandTime: number): { index: number; local: number; fade: number; from: number } {
  const grand = ((grandTime % LOOP_SECONDS) + LOOP_SECONDS) % LOOP_SECONDS
  const index = Math.min(FORMATIONS.length - 1, Math.floor(grand / MOVEMENT_SECONDS))
  const local = grand - index * MOVEMENT_SECONDS
  if (local < CROSS) {
    return {
      index,
      local,
      fade: smoothstep(MOVEMENT_SECONDS - CROSS, MOVEMENT_SECONDS + CROSS, local + MOVEMENT_SECONDS),
      from: (index + FORMATIONS.length - 1) % FORMATIONS.length
    }
  }
  if (local > MOVEMENT_SECONDS - CROSS) {
    return {
      index,
      local,
      fade: smoothstep(MOVEMENT_SECONDS - CROSS, MOVEMENT_SECONDS + CROSS, local),
      from: index
    }
  }
  return { index, local, fade: 0, from: index }
}

export const DEPTH_FOCUS_Z = -0.8

/**
 * Per-formation depth shaping `[gain, centre]`. Most formations are authored as shallow
 * camera-facing discs, which collapse to a line when the camera orbits. The renderer remaps
 * `z' = DEPTH_FOCUS_Z + (z - centre) * gain`, which thickens flat formations the most and
 * also parks every formation's mid-plane on the orbit pivot.
 */
const DEPTH_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [2.1, -0.63], // 诛仙
  [1.5, -0.73], // 大庚 (already deep)
  [2.8, -0.78], // 春黎
  [1.6, -0.65], // 青蟠
  [3.0, -0.99], // 小千
  [1.15, -0.8], // 大千 (already spherical)
  [3.2, -1.11], // 恒山
  [2.1, -0.55], // 六脉
  [1.7, -1.04], // 罗汉
  [3.4, -1.01], // 九宫八卦
  [2.9, -0.69], // 五行连环
  [3.2, -1.32] // 五九
]

export interface FormationDepth {
  gain: number
  center: number
}

export function formationDepthAt(grandTime: number, out: FormationDepth): void {
  const { index, fade, from } = formationAt(grandTime)
  const count = FORMATIONS.length
  const [a, b] = fade <= 0 ? [index, index] : from === index ? [index, (index + 1) % count] : [from, index]
  const pa = DEPTH_PROFILE[a!]!
  const pb = DEPTH_PROFILE[b!]!
  out.gain = lerp(pa[0], pb[0], fade)
  out.center = lerp(pa[1], pb[1], fade)
}

export function sampleSwordPoseInto(index: number, total: number, timeSeconds: number, out: SwordPose): void {
  const safeTotal = Math.max(1, Math.floor(total))
  const gt = ((timeSeconds % LOOP_SECONDS) + LOOP_SECONDS) % LOOP_SECONDS
  const cyc = gt / LOOP_SECONDS
  const base = cyc * TAU
  const { index: m, fade, from } = formationAt(gt)
  MOVEMENTS[m]!(index, safeTotal, cyc, base, scratchCurrent)
  if (fade <= 0) {
    copyPose(scratchCurrent, out)
    return
  }
  const pinch = Math.sin(fade * Math.PI) * 0.16
  if (from === m) {
    MOVEMENTS[(m + 1) % FORMATIONS.length]!(index, safeTotal, cyc, base, scratchOther)
    blendPoseInto(scratchCurrent, scratchOther, fade, pinch, out)
    return
  }
  MOVEMENTS[from]!(index, safeTotal, cyc, base, scratchOther)
  blendPoseInto(scratchOther, scratchCurrent, fade, pinch, out)
}

export function sampleSwordPose(index: number, total: number, timeSeconds: number): SwordPose {
  const out = createEmptyPose()
  sampleSwordPoseInto(index, total, timeSeconds, out)
  return out
}

export function formationCount(tier: SwordMotionTier, compact: boolean): number {
  if (tier === 'off') return 0
  if (compact) return tier === 'full' ? 24 : 12
  return tier === 'full' ? 1260 : 180
}

export function skyFormationCount(tier: SwordMotionTier, compact: boolean): number {
  if (tier === 'off' || compact) return 0
  return tier === 'full' ? 900 : 120
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

export function sampleFormationWeights(
  timeSeconds: number,
  introTimeSeconds = INTRO_SECONDS
): FormationWeights {
  const gt = ((timeSeconds % LOOP_SECONDS) + LOOP_SECONDS) % LOOP_SECONDS
  const { index, local, fade } = formationAt(gt)
  const gather = gatheringStrength(timeSeconds)
  const lotus = smoothstep(10, 11, gt) * (1 - smoothstep(14, 15, gt))
  const vortex = gather
  const volley = smoothstep(35, 36, gt) * (1 - smoothstep(39, 40, gt))
  const ambientPulse = Math.sin((local / MOVEMENT_SECONDS) * Math.PI) * 0.35
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
    ambientPulse,
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
  const baseCameraZ = compact ? 6.8 : 10.0
  const baseCameraY = compact ? 0.2 : 0.95

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
  const skyReveal = easeOutCubic(clamp01((t - 0.6) / 1.65))

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
    weights.pulse * 0.95 + weights.gather * 0.35 + weights.ambientPulse * 0.35
  )

  const gourdPour = clamp01(
    pulseEnvelopeGrand(gt, 1, 4) +
      weights.gather * 0.3 +
      weights.ambientPulse * 0.14 +
      0.08 +
      0.06 * Math.sin((gt / LOOP_SECONDS) * TAU * 7)
  )
  const gourdTilt = Math.sin((gt / LOOP_SECONDS) * TAU * 9) * 0.1 + gourdPour * 0.55
  const corkLift = gourdPour * 0.12 + weights.pulse * 0.05
  const vaporIntensity = gourdReveal * (0.25 + gourdPour * 0.75 + weights.pulse * 0.4)
  const gourdGlow = 6 + weights.gather * 6 + weights.pulse * 8 + weights.ambientPulse * 3

  return {
    introProgress: intro,
    cameraZ,
    cameraY,
    mainSwordY,
    mainSwordSpin,
    mainSwordInvert,
    // Keep the planted opening intact; lean into the floating hero pose after rising.
    mainSwordTiltX: compact ? 0.16 : lerp(0.08, 0.22, smoothstep(3.24, INTRO_SECONDS, t)),
    mainSwordTiltZ: compact ? -0.26 : lerp(-0.12, -0.34, smoothstep(3.24, INTRO_SECONDS, t)),
    mainSwordTremble,
    mainSwordScale,
    mainSwordGlow: Math.max(
      introLandingFlare,
      cloneBurstFlare,
      weights.gather * 0.55 + weights.pulse * 0.9 + weights.ambientPulse * 0.35
    ),
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
    skyReveal,
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

function cloneSpawnOrigin(index: number, out: Vec3): void {
  const shaftT = Math.pow(seed(index, 13), 0.78)
  const radial = (seed(index, 14) - 0.5) * 0.18
  const depth = (seed(index, 15) - 0.5) * 0.16
  out.x = HEART_X + radial
  out.y = lerp(-1.3, 0.88, shaftT)
  out.z = depth
}

function sampleIntroArcPositionInto(
  index: number,
  total: number,
  origin: Vec3,
  targetPos: Vec3,
  u: number,
  out: Vec3
): void {
  const ease = easeOutCubic(u)
  const fountain = Math.sin(Math.min(1, u * 1.15) * Math.PI)
  const ejectAngle = (index / Math.max(1, total)) * TAU * 4.5 + seed(index, 16) * 1.4
  const spread = (0.85 + seed(index, 17) * 1.05) * fountain
  const upward = (0.72 + seed(index, 18) * 0.98) * Math.sin(u * Math.PI)
  out.x = lerp(origin.x, targetPos.x, ease) + Math.cos(ejectAngle) * spread * 0.65
  out.y = lerp(origin.y, targetPos.y, ease) + upward + Math.sin(ejectAngle) * spread * 0.28
  out.z = lerp(origin.z, targetPos.z, ease) - Math.sin(u * Math.PI) * 0.52
}

const introOrigin: Vec3 = { x: 0, y: 0, z: 0 }
const introPosA: Vec3 = { x: 0, y: 0, z: 0 }
const introPosB: Vec3 = { x: 0, y: 0, z: 0 }

export function sampleIntroSwordPoseInto(
  index: number,
  total: number,
  loopTimeSeconds: number,
  introTimeSeconds: number,
  out: SwordPose
): void {
  if (introTimeSeconds >= INTRO_SECONDS) {
    sampleSwordPoseInto(index, total, loopTimeSeconds, out)
    return
  }

  sampleSwordPoseInto(index, total, loopTimeSeconds, scratchTarget)
  const safeTotal = Math.max(1, Math.floor(total))
  cloneSpawnOrigin(index, introOrigin)
  const order = (index / safeTotal) * 0.65 + seed(index, 10) * 0.35
  const start = 0.45 + order * 1.4
  const duration = 1.15
  const u = clamp01((introTimeSeconds - start) / duration)

  if (u <= 0) {
    setPose(out, introOrigin.x, introOrigin.y, introOrigin.z, 0, 1, 0, 0, 0, 1, 0, 0.3, 0.3, 0)
    return
  }

  const ease = easeOutCubic(u)
  sampleIntroArcPositionInto(index, safeTotal, introOrigin, scratchTarget.position, u, introPosA)
  sampleIntroArcPositionInto(
    index,
    safeTotal,
    introOrigin,
    scratchTarget.position,
    Math.min(1, u + 0.02),
    introPosB
  )
  const vx = introPosB.x - introPosA.x
  const vy = introPosB.y - introPosA.y
  const vz = introPosB.z - introPosA.z
  const vLen = Math.hypot(vx, vy, vz) || 1
  const dirBlend = smoothstep(0.68, 1, u)
  const dx = lerp(vx / vLen, scratchTarget.direction.x, dirBlend)
  const dy = lerp(vy / vLen, scratchTarget.direction.y, dirBlend)
  const dz = lerp(vz / vLen, scratchTarget.direction.z, dirBlend)
  const popScale = smoothstep(0, 0.18, u)
  const burstFlare = Math.sin(u * Math.PI)

  setPose(
    out,
    introPosA.x,
    introPosA.y,
    introPosA.z,
    dx,
    dy,
    dz,
    scratchTarget.scale * popScale,
    clamp01(scratchTarget.glow + burstFlare * 0.52),
    lerp(1 + burstFlare * 1.35, scratchTarget.stretch, ease),
    clamp01(Math.max(scratchTarget.energy, burstFlare * 0.98)),
    scratchTarget.gold,
    scratchTarget.jade,
    scratchTarget.seal
  )
}

export function sampleIntroSwordPose(
  index: number,
  total: number,
  loopTimeSeconds: number,
  introTimeSeconds: number
): SwordPose {
  const out = createEmptyPose()
  sampleIntroSwordPoseInto(index, total, loopTimeSeconds, introTimeSeconds, out)
  return out
}

export function sampleSkySwordPoseInto(
  index: number,
  total: number,
  timeSeconds: number,
  gather: number,
  volley: number,
  out: SwordPose
): void {
  const safeTotal = Math.max(1, Math.floor(total))
  const gt = ((timeSeconds % LOOP_SECONDS) + LOOP_SECONDS) % LOOP_SECONDS
  const cyc = gt / LOOP_SECONDS
  const base = cyc * TAU
  const riverEnd = Math.floor(safeTotal * 0.52)
  const vortexEnd = Math.floor(safeTotal * 0.85)
  const shimmer = 0.5 + 0.5 * Math.sin(base * 12 + index * 0.73)

  if (index < riverEnd) {
    // Sweeping celestial sword river across the right sky and moon horizon
    const lane = index % 5
    const u = fract(index / Math.max(1, riverEnd) + cyc * 2)
    const bandSpread = (lane - 2) * 0.48 + (seed(index, 31) - 0.5) * 0.62
    const xSpan = (u - 0.5) * 11.4
    const curveY = Math.sin((u - 0.5) * Math.PI * 1.1) * 1.75 + (u - 0.5) * 2.2
    const px = HEART_X + 0.6 + xSpan + bandSpread * 0.42
    const py = 0.25 + curveY + bandSpread * 0.36
    const pz = -3.8 - Math.sin(u * Math.PI) * 3.8 - seed(index, 32) * 2.0
    let dx = 11.4
    let dy = Math.cos((u - 0.5) * Math.PI * 1.1) * Math.PI * 1.1 * 1.75 + 2.2
    let dz = -Math.cos(u * Math.PI) * Math.PI * 1.8
    if (gather > 0.02) {
      dx = lerp(dx, (HEART_X - px) * 2.4, gather * 0.72)
      dy = lerp(dy, (HEART_Y - py) * 2.4, gather * 0.72)
      dz = lerp(dz, -pz * 2.4, gather * 0.45)
    }
    const leftMask = smoothstep(-1.4, 0.25, px)
    const envelope = Math.sin(u * Math.PI) * leftMask
    setPose(
      out,
      px,
      py,
      pz,
      dx,
      dy,
      dz,
      (0.15 + seed(index, 33) * 0.07) * envelope,
      0.32 + shimmer * 0.28,
      1.22 + volley * 0.55,
      0.28 + shimmer * 0.32,
      lane % 2 === 0 ? 0.72 : 0.26,
      lane % 2 === 0 ? 0.22 : 0.68,
      gather * 0.25
    )
    return
  }

  if (index < vortexEnd) {
    // Giant distant horizon sword wheel circling behind the formation
    const local = index - riverEnd
    const count = Math.max(1, vortexEnd - riverEnd)
    const tier = local % 3
    const ang = (local / count) * TAU + base * (tier % 2 ? -2 : 2)
    const r = 4.2 + tier * 1.05 + (seed(index, 34) - 0.5) * 0.48
    const px = HEART_X + 0.35 + Math.cos(ang) * r
    const py = HEART_Y + Math.sin(ang) * r * 0.65
    const pz = -4.0 - tier * 1.45 + Math.sin(ang * 2) * 0.55
    let dx = -Math.sin(ang)
    let dy = Math.cos(ang) * 0.65
    let dz = 0.1
    if (gather > 0.02) {
      dx = lerp(dx, HEART_X - px, gather * 0.68)
      dy = lerp(dy, HEART_Y - py, gather * 0.68)
    }
    const leftMask = smoothstep(-1.4, 0.25, px)
    setPose(
      out,
      px,
      py,
      pz,
      dx,
      dy,
      dz,
      (0.145 + seed(index, 35) * 0.065) * leftMask,
      0.28 + shimmer * 0.24,
      1.18 + volley * 0.45,
      0.26 + shimmer * 0.28,
      0.45 + (tier === 0 ? 0.35 : 0),
      0.54,
      gather * 0.22
    )
    return
  }

  // Deep starry sentinel blades hovering high in the night cosmos
  const local = index - vortexEnd
  const count = Math.max(1, safeTotal - vortexEnd)
  const ang = (local / count) * TAU - base
  const r = 4.6 + seed(index, 36) * 3.1
  const px = HEART_X + 0.6 + Math.cos(ang) * r
  const py = 0.45 + Math.sin(ang) * r * 0.58 + (seed(index, 37) - 0.5) * 1.2
  const pz = -6.2 - seed(index, 38) * 3.6
  const leftMask = smoothstep(-1.4, 0.25, px)
  setPose(
    out,
    px,
    py,
    pz,
    HEART_X - px,
    HEART_Y - py,
    -pz * 0.35,
    (0.14 + seed(index, 39) * 0.06) * leftMask,
    0.26 + shimmer * 0.28,
    1.12,
    0.26 + shimmer * 0.28,
    0.58,
    0.36,
    0
  )
}

export function sampleFormationLinks(
  grandTime: number,
  outPositions: Float32Array,
  outWeights: Float32Array,
  outColors: Uint8Array
): number {
  const gt = ((grandTime % LOOP_SECONDS) + LOOP_SECONDS) % LOOP_SECONDS
  const cyc = gt / LOOP_SECONDS
  const base = cyc * TAU
  const { index, fade, from } = formationAt(gt)
  let vertex = 0

  const push = (a: Vec3, b: Vec3, weight: number, color: number): void => {
    if (vertex + 2 > outWeights.length) return
    outPositions[vertex * 3] = a.x
    outPositions[vertex * 3 + 1] = a.y
    outPositions[vertex * 3 + 2] = a.z
    outWeights[vertex] = weight
    outColors[vertex] = color
    vertex++
    outPositions[vertex * 3] = b.x
    outPositions[vertex * 3 + 1] = b.y
    outPositions[vertex * 3 + 2] = b.z
    outWeights[vertex] = weight
    outColors[vertex] = color
    vertex++
  }

  const pA: Vec3 = { x: 0, y: 0, z: 0 }
  const pB: Vec3 = { x: 0, y: 0, z: 0 }

  const emit = (m: number, weight: number): void => {
    if (weight <= 0.01) return
    const meta = FORMATIONS[m]!
    const color = meta.linkColor
    if (meta.link === 'threads') {
      for (let k = 0; k < DAGENG_THREAD_COUNT; k++) {
        writeDagengEnds(k, pA, pB)
        push(pA, pB, weight * 0.62, color)
      }
    } else if (meta.link === 'grid') {
      for (let c = 0; c < 9; c++) {
        writeJiugongCellCenter(c, base, pA)
        if (c % 3 < 2) {
          writeJiugongCellCenter(c + 1, base, pB)
          push(pA, pB, weight * 0.72, color)
        }
        if (c < 6) {
          writeJiugongCellCenter(c + 3, base, pB)
          push(pA, pB, weight * 0.72, color)
        }
      }
      writeJiugongCellCenter(0, base, pA)
      writeJiugongCellCenter(8, base, pB)
      push(pA, pB, weight * 0.5, color)
      writeJiugongCellCenter(2, base, pA)
      writeJiugongCellCenter(6, base, pB)
      push(pA, pB, weight * 0.5, color)
      for (let t = 0; t < 8; t++) {
        writeBaguaAnchor(t, base, pA)
        writeBaguaAnchor((t + 1) % 8, base, pB)
        push(pA, pB, weight * 0.45, color)
      }
    } else if (meta.link === 'ring') {
      for (let e = 0; e < 5; e++) {
        writeElemCenter(e, base, pA)
        writeElemCenter((e + 1) % 5, base, pB)
        push(pA, pB, weight * 0.8, color)
        writeElemCenter((e + 2) % 5, base, pB)
        push(pA, pB, weight * 0.42, color)
      }
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
