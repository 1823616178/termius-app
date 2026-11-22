// Lower-volume 12 grand formation equations adapted from xianling/arrays/reference-fields.js.
export interface RefInfo {
  readonly name: string
  readonly nameEn: string
  readonly sub: string
  readonly subEn: string
  readonly link: string
  readonly linkColor: number
  readonly bladePitch: number
  readonly bladeRoll: number
  readonly lobes: number
}

export interface ReferenceSample {
  position: { x: number; y: number; z: number }
  direction: { x: number; y: number; z: number }
  scale: number
  glow: number
  stretch: number
  energy: number
  gold: number
  jade: number
  seal: number
}

const f = 1.12
const p = 0.22
const h = Math.PI * 2

export const REF_INFO: readonly RefInfo[] = [
  {
    name: '诛仙剑阵',
    nameEn: 'Zhu Xian Array',
    sub: '四门诛戮陷绝 · 杀意朝心',
    subEn: 'Four Gates of Slaughter · Blades Converged',
    link: 'none',
    linkColor: 0,
    bladePitch: 0.1,
    bladeRoll: -0.76,
    lobes: 4
  },
  {
    name: '大庚剑阵',
    nameEn: 'Da Geng Sword Array',
    sub: '庚金剑丝 · 隐匿穿空',
    subEn: 'Gilded Wire Threads · Silent Void Pierce',
    link: 'threads',
    linkColor: 0,
    bladePitch: -0.32,
    bladeRoll: 0.86,
    lobes: 3
  },
  {
    name: '春黎剑阵',
    nameEn: 'Chun Li Array',
    sub: '幻术为基 · 春影重叠',
    subEn: 'Illusion Foundation · Layered Dawn Shadows',
    link: 'none',
    linkColor: 1,
    bladePitch: 0.16,
    bladeRoll: -0.4,
    lobes: 5
  },
  {
    name: '青蟠剑阵',
    nameEn: 'Qing Pan Array',
    sub: '青元高阶 · 蟠龙绕柱',
    subEn: 'Azure Essence · Coiling Dragon Pillars',
    link: 'none',
    linkColor: 1,
    bladePitch: 0.61,
    bladeRoll: -0.28,
    lobes: 2
  },
  {
    name: '小千剑阵',
    nameEn: 'Xiao Qian Array',
    sub: '千剑层叠 · 六重呼吸',
    subEn: 'Thousand Layered Blades · Sixfold Breath',
    link: 'none',
    linkColor: 0,
    bladePitch: -0.42,
    bladeRoll: -0.42,
    lobes: 6
  },
  {
    name: '大千剑阵',
    nameEn: 'Da Qian Array',
    sub: '大千世界 · 三环浑天',
    subEn: 'Grand Cosmos · Tri-Ring Celestial Sphere',
    link: 'none',
    linkColor: 0,
    bladePitch: 0.48,
    bladeRoll: 0.58,
    lobes: 3
  },
  {
    name: '恒山剑阵',
    nameEn: 'Heng Shan Array',
    sub: '七人一队 · 攻守相济',
    subEn: 'Seven-Star Phalanx · Balanced Guard & Strike',
    link: 'none',
    linkColor: 1,
    bladePitch: -0.18,
    bladeRoll: -0.93,
    lobes: 7
  },
  {
    name: '六脉神剑阵',
    nameEn: 'Six Meridians Array',
    sub: '六脉剑气 · 依次奔涌',
    subEn: 'Six Meridian Qi · Cascading Surge',
    link: 'none',
    linkColor: 0,
    bladePitch: 0.28,
    bladeRoll: 1.02,
    lobes: 6
  },
  {
    name: '罗汉剑阵',
    nameEn: 'Arhat Sword Array',
    sub: '少林罗汉 · 立剑如僧',
    subEn: 'Shaolin Arhat · Standing Blades in Serenity',
    link: 'none',
    linkColor: 0,
    bladePitch: -0.24,
    bladeRoll: 0.04,
    lobes: 2
  },
  {
    name: '九宫八卦剑阵',
    nameEn: 'Bagua Nine-Palace Array',
    sub: '九宫方位 · 交织剑网',
    subEn: 'Nine Palaces · Interwoven Trigram Lattice',
    link: 'grid',
    linkColor: 1,
    bladePitch: 0.34,
    bladeRoll: -0.54,
    lobes: 8
  },
  {
    name: '五行连环剑阵',
    nameEn: 'Five Elements Ring',
    sub: '五行相生 · 连环合击',
    subEn: 'Wu Xing Cycle · Linked Orbital Strike',
    link: 'ring',
    linkColor: 0,
    bladePitch: -0.37,
    bladeRoll: 0.52,
    lobes: 5
  },
  {
    name: '五九剑阵',
    nameEn: 'Five-Nine Vortex Array',
    sub: '四五长剑 · 旋盘不息',
    subEn: 'Forty-Five Longswords · Perpetual Spiral',
    link: 'none',
    linkColor: 0,
    bladePitch: 0.52,
    bladeRoll: -0.84,
    lobes: 4
  }
]

export function newSample(): ReferenceSample {
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

interface Vec3 {
  x: number
  y: number
  z: number
}

function clamp01(e: number): number {
  return Math.max(0, Math.min(1, e))
}

function smoothStep(e: number, t: number, n: number): number {
  const r = t - e
  if (Math.abs(r) < 1e-8) return +(n >= t)
  const i = clamp01((n - e) / r)
  return i * i * (3 - 2 * i)
}

function lerpNum(e: number, t: number, n: number): number {
  return e + (t - e) * n
}

function hashVal(e: number, t: number): number {
  const n = Math.sin((e + 1) * 12.9898 + t * 78.233) * 43758.5453
  return n - Math.floor(n)
}

function fract(e: number): number {
  return e - Math.floor(e)
}

function fibSphere(e: number, t: number, n: Vec3): void {
  const r = 1 - (2 * (e + 0.5)) / Math.max(1, t)
  const i = Math.sqrt(Math.max(0, 1 - r * r))
  const a = e * 2.399963
  n.x = Math.cos(a) * i
  n.y = r
  n.z = Math.sin(a) * i
}

function rotAxis(e: number, t: number, n: number, r: number, i: number, a: number, o: number, s: Vec3): void {
  const c = Math.hypot(r, i, a) || 1
  const l = r / c
  const u = i / c
  const d = a / c
  const co = Math.cos(o)
  const si = Math.sin(o)
  const m = l * e + u * t + d * n
  const hx = u * n - d * t
  const gy = d * e - l * n
  const gz = l * t - u * e
  const v = 1 - co
  s.x = e * co + hx * si + l * m * v
  s.y = t * co + gy * si + u * m * v
  s.z = n * co + gz * si + d * m * v
}

function writeSample(
  e: ReferenceSample,
  tx: number,
  ty: number,
  tz: number,
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
  e.position.x = tx
  e.position.y = ty
  e.position.z = tz
  const len = Math.hypot(dx, dy, dz)
  if (len < 1e-6) {
    e.direction.x = 0
    e.direction.y = 1
    e.direction.z = 0
  } else {
    e.direction.x = dx / len
    e.direction.y = dy / len
    e.direction.z = dz / len
  }
  e.scale = scale
  e.glow = glow
  e.stretch = stretch
  e.energy = energy
  e.gold = gold
  e.jade = jade
  e.seal = seal
}

const k: Vec3 = { x: 0, y: 0, z: 0 }
const A: Vec3 = { x: 0, y: 0, z: 0 }

function gatePos(e: number, t: number, n: Vec3): void {
  const r = (e * h) / 4 + h / 8 + t
  n.x = f + Math.cos(r) * 2.85
  n.y = p + Math.sin(r) * 2.08
  n.z = -0.58 + Math.sin(r * 2) * 0.36
}

function wireEnds(e: number, t: Vec3, n: Vec3): void {
  const r = -1.7 + (e % 5) * 0.56
  t.x = -1.23 + hashVal(e, 1) * 5.2
  t.y = -1.95 + hashVal(e, 2) * 4.25
  t.z = r + (hashVal(e, 3) - 0.5) * 0.65
  n.x = -1.23 + hashVal(e, 4) * 5.2
  n.y = -1.95 + hashVal(e, 5) * 4.25
  n.z = r + (hashVal(e, 6) - 0.5) * 0.65
}

function palacePos(e: number, t: number, n: Vec3): void {
  const r = ((e % 3) - 1) * 1.44
  const i = (Math.floor(e / 3) - 1) * 1.18
  const a = 0.24 + Math.sin(t * 2) * 0.08
  const o = -0.16
  const s = Math.cos(a)
  const c = Math.sin(a)
  const l = Math.cos(o)
  const u = Math.sin(o)
  const d = r * s
  const fv = -r * c
  const m = i * l - fv * u
  const hv = i * u + fv * l
  n.x = 1.2000000000000002 + d
  n.y = p + m
  n.z = -0.95 + hv
}

function baguaPos(e: number, t: number, n: Vec3): void {
  const r = (e * h) / 8 - t * 2
  const i = 3.45
  n.x = 1.2000000000000002 + Math.cos(r) * i
  n.y = p + Math.sin(r) * i * 0.84
  n.z = -1.15 + Math.sin(r * 2) * 0.35
}

function elemPos(e: number, t: number, n: Vec3): void {
  const r = (e * h) / 5 - h / 4 + t * 2
  n.x = f + Math.cos(r) * 2.35
  n.y = p + Math.sin(r) * 1.85
  n.z = -0.78 + Math.sin(r) * 0.45
}

function fZhuxian(e: number, t: number, n: number, r: number, i: ReferenceSample): void {
  const a = Math.floor(t * 0.62)
  const o = Math.floor(t * 0.86)
  if (e < a) {
    const gate = e % 4
    const ord = Math.floor(e / 4)
    const s = Math.max(1, Math.ceil(a / 4))
    gatePos(gate, r, k)
    const c = f - k.x
    const l = p - k.y
    const u = -0.1 - k.z
    const d = Math.hypot(c, l, u) || 1
    const mx = c / d
    const my = l / d
    const mz = u / d
    const vx = -my
    const vy = mx
    const bv = Math.hypot(vx, vy) || 1
    const ux = vx / bv
    const uy = vy / bv
    const cx = -mz * uy
    const cy = mz * ux
    const cz = mx * uy - my * ux
    const ring = ord % 3
    const O = Math.max(1, Math.ceil(s / 3))
    const ang = (Math.floor(ord / 3) / O) * h + r * (ring % 2 ? -6 : 6)
    const rad = 0.24 + ring * 0.34
    const M = Math.cos(ang) * rad
    const N = Math.sin(ang) * rad
    const P = (1 - ring) * 0.22
    const px = k.x + ux * M + cx * N + mx * P
    const py = k.y + uy * M + cy * N + my * P
    const pz = k.z + cz * N + mz * P
    const pulse = +(Math.floor(n * 72) % 4 === gate)
    writeSample(
      i,
      px,
      py,
      pz,
      f - px,
      p - py,
      -0.1 - pz,
      0.155 + pulse * 0.032 + (ring === 2 ? 0.015 : 0),
      0.42 + pulse * 0.45,
      1.08 + pulse * 0.55,
      0.45 + pulse * 0.5,
      0.48 + pulse * 0.34,
      0.06,
      0.32 + pulse * 0.48
    )
    return
  }
  if (e < o) {
    const idx = e - a
    const span = Math.max(1, o - a)
    const s = idx % 4
    const c = Math.max(1, Math.ceil(span / 4))
    gatePos(s, r, k)
    const l = (Math.floor(idx / 4) / c) * h + r * 12
    const u = 0.5 - 0.44 * Math.cos(l)
    const d = Math.sin(l)
    const m = d * 0.24
    const g = (hashVal(e, 21) - 0.5) * 0.18 * (1 - u * 0.55)
    const px = lerpNum(k.x, f, u) + g
    const py = lerpNum(k.y, p, u) + m + (hashVal(e, 22) - 0.5) * 0.16 * (1 - u * 0.55)
    const pz = lerpNum(k.z, -0.08, u) - Math.abs(m) * 0.4
    const b = d >= 0 ? 1 : -1
    writeSample(
      i,
      px,
      py,
      pz,
      (f - k.x) * b,
      (p - k.y) * b,
      (-0.08 - k.z) * b,
      0.125 + Math.max(0, d) * 0.025,
      0.55 + Math.max(0, d) * 0.25,
      1.75 + Math.max(0, d) * 0.35,
      0.65 + Math.max(0, d) * 0.25,
      0.72,
      0.04,
      0.62
    )
    return
  }
  const s = ((e - o) / Math.max(1, t - o)) * h - r * 3
  const c = 3.55
  const px = f + Math.cos(s) * c
  const py = p + Math.sin(s) * c * 0.78
  writeSample(
    i,
    px,
    py,
    -1.25 + Math.cos(s * 2) * 0.38,
    f - px,
    p - py,
    0.25,
    0.14,
    0.34,
    1.12,
    0.35,
    0.66,
    0.06,
    0.28
  )
}

function fDageng(e: number, t: number, _n: number, r: number, i: ReferenceSample): void {
  const a = Math.floor(t * 0.84)
  if (e < a) {
    const wire = e % 24
    const cnt = Math.max(1, Math.ceil(a / 24))
    const o = (Math.floor(e / 24) / cnt) * h + r * 10 * (wire % 2 === 0 ? 1 : -1)
    const s = 0.5 - 0.46 * Math.cos(o)
    const c = Math.sin(o)
    const l = c >= 0 ? (wire % 2 === 0 ? 1 : -1) : wire % 2 === 0 ? -1 : 1
    wireEnds(wire, k, A)
    const u = A.x - k.x
    const d = A.y - k.y
    const dz = A.z - k.z
    const lift = c * 0.055
    const mx = lerpNum(k.x, A.x, s)
    const my = lerpNum(k.y, A.y, s) + lift
    const mz = lerpNum(k.z, A.z, s)
    const v = 0.5 + 0.5 * Math.sin(r * 18 + wire * 1.1)
    writeSample(
      i,
      mx,
      my,
      mz,
      u * l,
      d * l,
      dz * l,
      0.125,
      0.38 + v * 0.35,
      2.1,
      0.42 + v * 0.45,
      0.88,
      0.08,
      0
    )
    return
  }
  const o = ((e - a) / Math.max(1, t - a)) * h + r * 4
  const s = 3.25
  writeSample(
    i,
    f + Math.cos(o) * s,
    p + Math.sin(o) * s * 0.76,
    -1.2 + Math.sin(o * 3) * 0.32,
    -Math.sin(o),
    Math.cos(o),
    0.15,
    0.16,
    0.42,
    1.3,
    0.45,
    0.82,
    0.12,
    0
  )
}

function fChunli(e: number, t: number, _n: number, r: number, i: ReferenceSample): void {
  const a = Math.floor(t * 0.72)
  if (e < a) {
    const lobe = e % 5
    const layer = (Math.floor(e / 5) % 3) - 1
    const o = Math.max(1, Math.ceil(a / 15))
    const s = Math.floor(e / 15) / o
    const c = layer * 0.22 * Math.sin(s * Math.PI)
    const l = (lobe * h) / 5 + s * 2.25 + c + r * 3
    const u = 0.46 + s * 2.85
    const dx = f + Math.cos(l) * u
    const dy = p + Math.sin(l) * u * 0.86
    const dz = -0.88 + Math.sin(s * Math.PI) * 0.58 + layer * 0.18
    const pulse = 0.5 + 0.5 * Math.sin(r * 12 + s * 5 + lobe)
    writeSample(
      i,
      dx,
      dy,
      dz,
      Math.cos(l) * 0.65 - Math.sin(l) * 0.4,
      Math.sin(l) * 0.65 + Math.cos(l) * 0.4,
      0.22 * Math.cos(s * Math.PI),
      0.155,
      0.38 + pulse * 0.28,
      1.08,
      0.34 + pulse * 0.32,
      0.18 + (1 - s) * 0.34,
      0.8,
      0
    )
    return
  }
  const o = e - a
  const s = Math.max(1, t - a)
  const c = o % 5
  const l = Math.floor(o / 5) / Math.max(1, Math.ceil(s / 5))
  const u = Math.sin(r * 12 + o * 0.35) * 0.26
  const d = (c * h) / 5 + l * 2.3 + r * 3 + 0.22
  const m = 0.72 + l * 2.75
  writeSample(
    i,
    f + Math.cos(d) * m - Math.sin(d) * u,
    p + Math.sin(d) * m * 0.86 + Math.cos(d) * u,
    -1.25 + Math.cos(r * 6 + o) * 0.38,
    -Math.sin(d),
    Math.cos(d),
    0.15,
    0.12,
    0.34,
    1.15,
    0.3,
    0.12,
    0.88,
    0
  )
}

function fQingpan(e: number, t: number, _n: number, r: number, i: ReferenceSample): void {
  const a = Math.floor(t * 0.74)
  if (e < a) {
    const strand = e % 5
    const cnt = Math.max(1, Math.ceil(a / 5))
    const o = Math.floor(e / 5) / cnt
    const s = o * h * 3.25 + r * 4
    const c = lerpNum(2.3, 0.92, o) + 0.24 * Math.sin(o * h * 2 + r * 8)
    const l = f + Math.cos(s) * c
    const u = -1.72 + o * 3.68
    const d = -0.58 + Math.sin(s) * c * 0.56
    const pv = (strand / 5) * h + o * 16 + r * 6
    const m = o > 0.91
    const g = m ? 0.34 * (1 + (o - 0.91) * 4) : 0.19 * Math.sin(o * Math.PI * 0.9 + 0.18)
    writeSample(
      i,
      l + Math.cos(pv) * g,
      u + Math.sin(pv) * g * 0.65,
      d + Math.sin(pv) * g,
      -Math.sin(s) * 1.1,
      0.85,
      Math.cos(s) * 0.6,
      m ? 0.2 : 0.155,
      0.38 + (m ? 0.45 : 0.2 * Math.sin(r * 12 + o * 6)),
      m ? 1.35 : 1.18,
      0.42 + (m ? 0.45 : 0.22 * Math.sin(r * 12 + o * 6)),
      m ? 0.58 : 0.24,
      m ? 0.78 : 0.85,
      m ? 0.15 : 0
    )
    return
  }
  const o = e - a
  const s = Math.max(1, t - a)
  const c = (o / s) * h * 2 - r * 5
  const l = o / s
  const u = 2.65 + 0.65 * Math.sin(l * Math.PI)
  writeSample(
    i,
    f + Math.cos(c) * u,
    -1.55 + l * 3.35,
    -1.05 + Math.sin(c) * u * 0.45,
    -Math.sin(c),
    0.72,
    Math.cos(c) * 0.45,
    0.12,
    0.3,
    1.1,
    0.3,
    0.16,
    0.78,
    0
  )
}

function fXiaoqian(e: number, t: number, _n: number, r: number, i: ReferenceSample): void {
  const a = e % 6
  const o = Math.max(1, Math.ceil(t / 6))
  const s = Math.floor(e / 6)
  const c = s % 2
  const l = Math.sin(r * 12 - a * 0.7)
  const u = (s / o) * h + r * (a % 2 ? -4 : 4) + a * 0.24
  const d = 0.72 + a * 0.46 + c * 0.14 + l * 0.14
  const m = Math.cos(u) * d
  const g = Math.sin(u) * d * 0.9
  const z = (c ? 0.08 : -0.08) - a * 0.14
  const v = ((a % 3) - 1) * 0.24 + Math.sin(r * 4 + a) * 0.09
  rotAxis(m, g, z, 0.8, 0.4, 0, v, k)
  rotAxis(-Math.sin(u), Math.cos(u), 0.12 * (c ? 1 : -1), 0.8, 0.4, 0, v, A)
  writeSample(
    i,
    f + k.x,
    p + k.y,
    -0.65 + k.z,
    A.x,
    A.y,
    A.z,
    0.15 + (5 - a) * 0.008,
    0.36 + 0.18 * l,
    1.05,
    0.34 + 0.22 * l,
    a % 2 ? 0.68 : 0.28,
    a % 2 ? 0.22 : 0.68,
    0
  )
}

const AXES: readonly [number, number, number][] = [
  [0, 1, 0],
  [0.707, 0.707, 0],
  [0, 0.6, 0.8]
]

function fDaqian(e: number, t: number, _n: number, r: number, i: ReferenceSample): void {
  const a = Math.floor(t * 0.45)
  if (e < a) {
    const ring = e % 3
    const cnt = Math.max(1, Math.ceil(a / 3))
    const o = Math.floor(e / 3)
    const s = (o / cnt) * h + r * (3 + ring * 2)
    const c = 2.05 + ring * 0.62
    const [l, u, d] = AXES[ring]!
    const m = ring === 0 ? 0.25 : ring === 1 ? 0.95 : -0.82
    rotAxis(Math.cos(s) * c, o % 2 === 0 ? 0.06 : -0.06, Math.sin(s) * c, l, u, d, m, k)
    rotAxis(-Math.sin(s), 0, Math.cos(s), l, u, d, m, A)
    writeSample(i, f + k.x, p + k.y, -0.78 + k.z, A.x, A.y, A.z, 0.165, 0.48, 1.15, 0.45, 0.78, 0.22, 0)
    return
  }
  const o = e - a
  const s = Math.max(1, t - a)
  const c = o % 3
  const l = Math.max(1, Math.ceil(s / 3))
  fibSphere(Math.floor(o / 3), l, k)
  const u = 1.2 + c * 0.95
  const [d, m, g] = AXES[c]!
  rotAxis(k.x * u, k.y * u, k.z * u, d, m, g, r * (2 + c), A)
  writeSample(
    i,
    f + A.x,
    p + A.y,
    -0.82 + A.z,
    m * A.z - g * A.y,
    g * A.x - d * A.z,
    d * A.y - m * A.x,
    0.145,
    0.36,
    1,
    0.35,
    0.62,
    0.38,
    0
  )
}

function fHengshan(e: number, t: number, _n: number, r: number, i: ReferenceSample): void {
  const a = Math.max(1, Math.floor(t / (t >= 210 ? 21 : 7)))
  const o = a * 7
  if (e < o) {
    const grp = Math.floor(e / 7)
    const member = e % 7
    const r0 = Math.min(a, Math.max(1, Math.round(a * 0.24)))
    const s = Math.min(Math.max(0, a - r0), Math.max(1, Math.round(a * 0.34)))
    const c = Math.max(1, a - r0 - s)
    const l = grp < r0 ? 0 : grp < r0 + s ? 1 : 2
    const u = l === 0 ? 0 : l === 1 ? r0 : r0 + s
    const d = l === 0 ? r0 : l === 1 ? s : c
    const m = ((grp - u) / d) * h + r * (l === 1 ? -3 : 2)
    const g = 1.55 + l * 0.92
    const cx = f + Math.cos(m) * g
    const cy = p + Math.sin(m) * g * 0.72
    const cz = -0.75 + (l - 1) * 0.38
    const x = smoothStep(-0.22, 0.22, Math.sin(r * 6 + grp * 0.45))
    const rad = lerpNum(0.22, 0.4, x)
    const w = (member * h) / 7 + r * 6
    const ox = Math.cos(w) * rad
    const oy = Math.sin(w) * rad
    writeSample(
      i,
      cx + ox,
      cy + oy,
      cz + Math.sin(w) * 0.12,
      lerpNum(-ox, ox, x),
      lerpNum(-oy, oy, x),
      0.18 * x,
      0.155,
      0.38,
      1 + x * 0.25,
      0.32 + x * 0.35,
      0.32,
      0.45,
      0.06
    )
    return
  }
  const s = e - o
  const c = Math.max(1, t - o)
  const l = s % 2
  const u = (s / c) * h + r * (l ? -2 : 2)
  const d = l ? 3.15 : 2.1
  const m = smoothStep(-0.25, 0.25, Math.sin(r * 6 + u * 3))
  const gx = f + Math.cos(u) * d
  const gy = p + Math.sin(u) * d * 0.78
  const gz = -1.15 - l * 0.35 + Math.sin(u * 3) * 0.14
  const b = m * 2 - 1
  writeSample(
    i,
    gx,
    gy,
    gz,
    Math.cos(u) * b,
    Math.sin(u) * b,
    0.15,
    0.125,
    0.3,
    1.05 + m * 0.2,
    0.28 + m * 0.3,
    0.28,
    0.48,
    0.04
  )
}

function fLiumai(e: number, t: number, n: number, r: number, i: ReferenceSample): void {
  const a = e % 6
  const o = Math.floor(e / 6) % 3
  const s = Math.max(1, Math.ceil(t / 18))
  const c = Math.floor(e / 18) / s
  const l = (a * h) / 6 + r * 2
  const u = fract(n * 24 - a / 6)
  const d = (0.5 + 0.5 * Math.cos((c - u) * h)) ** 6
  const m = 0.42 + c * 3.35
  const g = o === 0 ? 0.04 : 0.2
  const ang = (o * h) / 3 + c * 8 + r * 6
  const vz = a % 2 === 0 ? 0.26 : -0.22
  const cs = Math.cos(l)
  const sn = Math.sin(l)
  writeSample(
    i,
    f + cs * m - sn * Math.cos(ang) * g,
    p + sn * m * 0.82 + cs * Math.cos(ang) * g,
    -0.6 + m * vz + Math.sin(ang) * g,
    cs,
    sn * 0.82,
    vz,
    0.155 + d * 0.035,
    0.34 + d * 0.56,
    1.1 + d * 1.35,
    0.26 + d * 0.74,
    0.42 + d * 0.58,
    0.34 * (1 - d),
    0
  )
}

function fLuohan(e: number, t: number, _n: number, r: number, i: ReferenceSample): void {
  const a = Math.min(18, Math.max(4, Math.floor(t * 0.12)))
  if (e < a) {
    const ang = (e / a) * h + r * 2
    const rad = 1.58
    const ox = f + Math.cos(ang) * rad
    const oy = p + Math.sin(ang) * rad * 0.38 - 0.15
    const oz = -0.65 - Math.sin(ang) * rad * 0.38
    const l = 0.5 + 0.5 * Math.cos(ang * 2 - r * 12)
    const u = Math.sin(r * 6 + e) * 0.04
    writeSample(i, ox, oy, oz, u, 1, u * 0.5, 0.24, 0.35 + l * 0.38, 1.15, 0.28 + l * 0.45, 0.72, 0.1, 0.08)
    return
  }
  const o = e - a
  const s = Math.max(1, t - a)
  const c = o % 3
  const l = Math.max(1, Math.ceil(s / 3))
  const u = (Math.floor(o / 3) / l) * h + r * (c % 2 ? -1 : 1)
  const d = 2.15 + c * 0.62
  const mx = f + Math.cos(u) * d
  const my = p + Math.sin(u) * d * 0.42 - 0.35 + c * 0.48
  const mz = -1.05 - Math.sin(u) * d * 0.45
  const v = 0.5 + 0.5 * Math.cos(u * 3 - r * 12 + c * 0.7)
  const y = Math.sin(r * 6 + o * 0.3) * 0.04
  writeSample(
    i,
    mx,
    my,
    mz,
    y,
    1,
    y * 0.4,
    0.165 - c * 0.012,
    0.26 + v * 0.3,
    1.05,
    0.2 + v * 0.35,
    0.58 + v * 0.2,
    0.14,
    0.04
  )
}

function fJiugong(e: number, t: number, _n: number, r: number, i: ReferenceSample): void {
  const a = Math.floor(t * 0.72)
  if (e < a) {
    const pal = e % 9
    const ord = Math.floor(e / 9)
    const o = Math.max(1, Math.ceil(a / 9))
    palacePos(pal, r, k)
    const s = ord % 3
    const c = Math.max(1, Math.ceil(o / 3))
    const l = (Math.floor(ord / 3) / c) * h + r * (pal % 2 ? -6 : 6) + s * 0.45
    const u = s === 0 ? 0.14 : s === 1 ? 0.33 : 0.49
    rotAxis(Math.cos(l) * u, Math.sin(l) * u * 0.88, (s - 1) * 0.14, 0.25, 1, 0, 0.22, A)
    const m = 0.5 + 0.5 * Math.sin(r * 12 + pal * 0.7)
    writeSample(
      i,
      k.x + A.x,
      k.y + A.y,
      k.z + A.z,
      -Math.sin(l),
      Math.cos(l) * 0.88,
      0.24,
      0.135 + (s === 0 ? 0.025 : 0),
      0.38 + m * 0.22,
      1.08,
      0.36 + m * 0.24,
      pal % 2 ? 0.58 : 0.28,
      pal % 2 ? 0.28 : 0.66,
      0
    )
    return
  }
  const o = e - a
  const s = Math.max(1, t - a)
  const c = o % 8
  const l = Math.floor(o / 8)
  const u = Math.max(1, Math.ceil(s / 8))
  const d = l % 3
  const m = Math.max(1, Math.ceil(u / 3))
  const g = Math.floor(l / 3) / m - 0.5
  baguaPos(c, r, k)
  const ang = Math.atan2(k.y - p, k.x - 1.2000000000000002)
  const vx = -Math.sin(ang)
  const vy = Math.cos(ang)
  const bx = Math.cos(ang)
  const by = Math.sin(ang)
  const radial = (d - 1) * 0.16
  const tang = g * 0.62
  const wx = k.x + bx * radial + vx * tang
  const wy = k.y + by * radial + vy * tang
  writeSample(i, wx, wy, k.z + (d - 1) * 0.06, f - wx, p - wy, 0.22, 0.13, 0.36, 1.1, 0.38, 0.6, 0.44, 0)
}

const WUXING_TONES: readonly [number, number, number][] = [
  [0.85, 0.1, 0],
  [0.14, 0.84, 0],
  [0.12, 0.48, 0],
  [0.24, 0.05, 0.74],
  [0.56, 0.16, 0.22]
]

function fWuxing(e: number, t: number, n: number, r: number, i: ReferenceSample): void {
  const a = Math.floor(t * 0.72)
  if (e < a) {
    const elem = e % 5
    const o = Math.floor(e / 5)
    const s = Math.max(1, Math.ceil(a / 5))
    elemPos(elem, r, k)
    const c = o % 3
    const l = Math.max(1, Math.ceil(s / 3))
    const u = (Math.floor(o / 3) / l) * h + r * (c % 2 ? -6 : 6)
    const d = +(Math.floor(n * 60) % 5 === elem)
    const rad = c === 0 ? 0.16 : c === 1 ? 0.36 : 0.56
    rotAxis(
      Math.cos(u) * rad,
      Math.sin(u) * rad * (elem === 1 ? 1.15 : 0.88),
      c === 0 ? 0.22 : (c - 1) * 0.15,
      0.6,
      0.8,
      0,
      elem * 0.45 + r * 2,
      A
    )
    const px = k.x + A.x
    const py = k.y + A.y
    const pz = k.z + A.z
    elemPos((elem + 1) % 5, r, A)
    const [g0, g1, g2] = WUXING_TONES[elem]!
    writeSample(
      i,
      px,
      py,
      pz,
      A.x - px,
      A.y - py,
      A.z - pz,
      0.155 + d * 0.03,
      0.38 + d * 0.44,
      1.08 + d * 0.35,
      0.36 + d * 0.52,
      g0,
      g1,
      g2
    )
    return
  }
  const o = fract((e - a) / Math.max(1, t - a) + n * 3) * 5
  const s = Math.floor(o) % 5
  const c = o - Math.floor(o)
  elemPos(s, r, k)
  elemPos((s + 1) % 5, r, A)
  const l = Math.sin(c * Math.PI) * 0.42
  const u = lerpNum(k.x, A.x, c) + (k.x - f) * l * 0.14
  const d = lerpNum(k.y, A.y, c) + (k.y - p) * l * 0.14
  const m = lerpNum(k.z, A.z, c) + l * 0.45
  const [g0, g1, g2] = WUXING_TONES[s]!
  writeSample(i, u, d, m, A.x - k.x, A.y - k.y, A.z - k.z, 0.125, 0.48, 1.65, 0.58, g0, g1, g2)
}

function fWujiu(e: number, t: number, _n: number, r: number, i: ReferenceSample): void {
  if (e < 45) {
    const ang = (e / 45) * h + r * 12
    const rad = 1.42 + (e % 3) * 0.24
    writeSample(
      i,
      f + Math.cos(ang) * rad,
      p + Math.sin(ang) * rad * 0.85,
      -0.48 + Math.sin(ang * 3) * 0.18,
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
  const a = e - 45
  const o = Math.max(1, t - 45)
  const s = a % 5
  const c = Math.max(1, Math.ceil(o / 5))
  const l = Math.floor(a / 5) / c
  const u = (s * h) / 5 + l * 2.2 + r * 4
  const d = 2.02 + l * 2.18
  writeSample(
    i,
    f + Math.cos(u) * d,
    p + Math.sin(u) * d * 0.8,
    -0.78 - l * 1.15 + Math.sin(l * h * 2 + s + r * 6) * 0.12,
    -Math.sin(u),
    Math.cos(u) * 0.8,
    -0.08,
    0.125 + (1 - l) * 0.03,
    0.26 + (1 - l) * 0.2,
    1.08,
    0.24 + (1 - l) * 0.25,
    0.45 + (1 - l) * 0.3,
    0.38,
    0
  )
}

const EVALUATORS = [
  fZhuxian,
  fDageng,
  fChunli,
  fQingpan,
  fXiaoqian,
  fDaqian,
  fHengshan,
  fLiumai,
  fLuohan,
  fJiugong,
  fWuxing,
  fWujiu
] as const

export function referencePose(
  id: number,
  i: number,
  count: number,
  fraction: number,
  phase: number,
  out: ReferenceSample
): void {
  const fn = EVALUATORS[id] ?? EVALUATORS[0]
  fn(i, count, fraction, phase, out)
}
