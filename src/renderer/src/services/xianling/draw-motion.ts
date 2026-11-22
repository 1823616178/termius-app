// Choreography of a levitating artifact. All times and transforms are shared with scrubbing and VFX.
export const DRAW_LENGTH = 17.8
export const CLEAR = 1.92
export const MOUTH = 3.57 - 202 * 0.01265

export interface DanceAct {
  readonly label: string
  readonly title: string
  readonly titleEn: string
  readonly labelEn: string
  readonly start: number
  readonly color: string
}

export const ACTS: readonly DanceAct[] = [
  {
    label: '启封',
    labelEn: 'Unseal',
    title: '寒光破封',
    titleEn: 'Frost Unseals',
    start: 0,
    color: '#92e7ff'
  },
  {
    label: '掬月',
    labelEn: 'Moon',
    title: '银弧揽月',
    titleEn: 'Silver Moon Arc',
    start: 2.35,
    color: '#8afaff'
  },
  {
    label: '穿星',
    labelEn: 'Stars',
    title: '三叠流星',
    titleEn: 'Triple Meteor',
    start: 4.3,
    color: '#ffd9a0'
  },
  {
    label: '回雪',
    labelEn: 'Snow',
    title: '流云回雪',
    titleEn: 'Drifting Snow',
    start: 6.7,
    color: '#c7aaff'
  },
  {
    label: '叠影',
    labelEn: 'Mirage',
    title: '镜中叠影',
    titleEn: 'Mirrored Echoes',
    start: 9.25,
    color: '#88cfff'
  },
  {
    label: '莲华',
    labelEn: 'Lotus',
    title: '八瓣莲华',
    titleEn: 'Eight-Petal Lotus',
    start: 11.55,
    color: '#9ef8e1'
  },
  {
    label: '归璧',
    labelEn: 'Return',
    title: '光敛归璧',
    titleEn: 'Radiant Return',
    start: 14.45,
    color: '#f4e6ba'
  }
]

export const BEATS: readonly number[] = [
  1.92, 2.84, 3.82, 4.89, 5.6, 6.32, 7.44, 8.54, 9.96, 10.52, 11.13, 12.11, 12.87, 13.77, 15.0, 16.91
]

export interface DrawPose {
  sw: [number, number, number]
  sh: [number, number, number]
  az: number
  bz: number
  ax: number
  bx: number
  ay: number
  by: number
  length: number
  open: number
  rest: number
  phase: number
}

export const smooth = (a: number, b: number, t: number): number => {
  const u = Math.max(0, Math.min(1, (t - a) / (b - a)))
  return u * u * (3 - 2 * u)
}

const mix = (a: number, b: number, t: number): number => a + (b - a) * t
const PI = Math.PI

export const phaseAt = (t: number): number => ACTS.reduce((n, a, i) => (t >= a.start ? i : n), 0)

function aligned(f: number, ang: number, baseY = 0.04): DrawPose {
  const dist = f * 349 * 0.01265
  const dx = -Math.sin(ang)
  const dy = Math.cos(ang)
  const drift = -dist * 0.49
  const sh: [number, number, number] = [drift * dx, drift * dy + baseY, 0]
  const sw: [number, number, number] = [sh[0] + (0.08 + dist) * dx, sh[1] + (0.08 + dist) * dy, 0]
  return {
    sw,
    sh,
    az: ang,
    bz: ang,
    ax: 0,
    bx: 0,
    ay: -0.09,
    by: -0.09,
    length: dist,
    open: Math.min(1, f),
    rest: 0,
    phase: 0
  }
}

function intro(t: number): DrawPose {
  const f =
    0.1 * smooth(0.25, 0.85, t) +
    0.09 * smooth(0.9, 1.19, t) +
    0.81 * smooth(1.34, CLEAR, t) +
    0.12 * smooth(CLEAR, 2.3, t)
  const a = -0.125 - 0.13 * smooth(0.05, 0.91, t) - 0.61 * smooth(1.14, 1.93, t)
  return aligned(f, a)
}

const DEG = PI / 180
const startPose = intro(2.3)
const endPose = aligned(1.12, -0.78)
const key = (t: number, p: DrawPose): number[] => [t, ...p.sw, p.az / DEG, p.ax / DEG, p.ay / DEG]

// Position and unwrapped Euler angles at musical accents. Non-planar arcs and held beats, rather than a uniform turntable spin.
const keys: number[][] = [
  key(2.3, startPose),
  [2.64, 1.45, 1.32, 0.47, -76, 13, -33],
  [2.96, 1.1, 0.18, 0.84, -131, 29, -52],
  [3.4, 0.18, -0.6, 0.54, -213, 17, -5],
  [3.82, -0.36, 0.12, -0.16, -287, -19, 46],
  [4.14, 0.24, 0.46, 0.07, -304, -26, 52],
  [4.46, 0.58, 0.02, 0.26, -304, -22, 28],
  [4.89, 1.51, 0.89, 1.1, -246, 38, -17],
  [5.1, 1.41, 0.92, 1.07, -244, 33, -19],
  [5.6, -0.68, -0.51, -0.2, -414, -42, 61],
  [5.83, -0.69, -0.47, -0.19, -419, -46, 68],
  [6.32, 1.18, 0.45, 0.8, -305, 18, -28],
  [6.64, 1.13, 0.48, 0.72, -296, 22, -32],
  [7.04, 0.86, 1.06, 0.24, -244, 48, -73],
  [7.44, -0.55, 0.25, -0.75, -137, 68, -78],
  [7.77, -0.46, -0.83, -0.6, -53, 16, -33],
  [8.09, 0.51, -0.29, 0.21, 6, -26, 29],
  [8.54, 1.32, 0.71, 0.88, 164, -52, 65],
  [8.9, 0.21, 0.92, 0.42, 241, -16, 16],
  [9.22, -0.36, 0.23, 0.03, 275, 20, -23],
  [9.57, -0.32, -0.42, -0.11, 296, 30, -48],
  [9.96, 1.18, 0.58, 1.21, 409, -23, 56],
  [10.17, 1.14, 0.61, 1.12, 414, -27, 58],
  [10.52, -0.62, 0.27, 0.34, 544, 42, -69],
  [10.71, -0.66, 0.24, 0.32, 545, 43, -71],
  [11.13, 0.88, -0.56, 1.15, 666, -29, 35],
  [11.47, 1, -0.48, 0.98, 674, -25, 40],
  [12.11, 0.51, 0.61, 0.72, 760, 35, 86],
  [12.87, -0.27, -0.1, -0.23, 904, 48, 114],
  [13.34, 0.55, 0.73, 0.67, 1044, -20, 169],
  [13.77, 0.45, 0.42, 0.66, 1086, -8, 176],
  [14.38, 0.43, 0.37, 0.65, 1089, -7, 179],
  [14.85, 1.53, 1.24, 0.35, 1072, 13, 207],
  [15.15, 1.79, 1.59, 0.12, 1051, 6, 291],
  key(15.5, endPose).map((v, i) => (i === 4 ? v + 1080 : i === 6 ? v + 360 : v))
]

// Monotone cubic tangents preserve crisp reversals but keep motion continuous between accents.
function slope(i: number, k: number): number {
  if (i === 0 || i === keys.length - 1) return 0
  const a = keys[i - 1]!
  const b = keys[i]!
  const c = keys[i + 1]!
  const l = (b[k]! - a[k]!) / (b[0]! - a[0]!)
  const r = (c[k]! - b[k]!) / (c[0]! - b[0]!)
  return l * r <= 0 ? 0 : (2 * l * r) / (l + r)
}

const tangents: number[][] = keys.map((a, i) => a.map((_, k) => (k ? slope(i, k) : 0)))

function sampleKey(t: number): [number, number, number, number, number, number] {
  let i = 0
  while (i < keys.length - 2 && t > keys[i + 1]![0]!) i++
  const a = keys[i]!
  const b = keys[i + 1]!
  const dt = b[0]! - a[0]!
  const u = Math.max(0, Math.min(1, (t - a[0]!) / dt))
  const v = u * u
  const w = v * u
  const ta = tangents[i]!
  const tb = tangents[i + 1]!
  const out = a
    .slice(1)
    .map(
      (x, j) =>
        x * (2 * w - 3 * v + 1) +
        b[j + 1]! * (-2 * w + 3 * v) +
        dt * ((w - 2 * v + u) * ta[j + 1]! + (w - v) * tb[j + 1]!)
    )
  return [out[0]!, out[1]!, out[2]!, out[3]!, out[4]!, out[5]!]
}

export function drawPose(t: number): DrawPose {
  let p: DrawPose
  if (t <= 2.3) {
    p = intro(t)
  } else if (t >= 15.5) {
    const u = smooth(15.5, 16.99, t)
    p = aligned(1.12 * (1 - u), mix(-0.78, -0.17, smooth(15.54, 17.53, t)))
    p.az += PI * 6
    p.ay += PI * 2
  } else {
    const [x, y, z, az, ax, ay] = sampleKey(t)
    const idle = smooth(2.3, 4.32, t)
    const bring = smooth(14.35, 15.5, t)
    const flt = Math.sin((t - 4) * 0.66)
    const restSh = [-2.54, -0.12 + 0.18 * flt, -0.9] as const
    const sh: [number, number, number] = [
      mix(mix(startPose.sh[0], restSh[0], idle), endPose.sh[0], bring),
      mix(mix(startPose.sh[1], restSh[1], idle), endPose.sh[1], bring),
      mix(mix(startPose.sh[2], restSh[2], idle), endPose.sh[2], bring)
    ]
    p = {
      sw: [x, y, z],
      sh,
      ax: ax * DEG,
      ay: ay * DEG,
      az: az * DEG,
      bx: 0,
      by: mix(-0.09, 0.59, idle * (1 - bring)),
      bz: mix(mix(startPose.bz, -0.28 + 0.065 * flt, idle), endPose.bz, bring),
      open: 1,
      length: 5.01,
      rest: idle,
      phase: 0
    }
  }
  p.phase = phaseAt(t)
  return p
}

// Local longitudinal point transformed by the same ZYX rotation as the render meshes.
export function bladePoint(t: number, y: number): [number, number, number] {
  const p = drawPose(t)
  const cx = Math.cos(p.ax)
  const sx = Math.sin(p.ax)
  const sy = Math.sin(p.ay)
  const cy = Math.cos(p.ay)
  const cz = Math.cos(p.az)
  const sz = Math.sin(p.az)
  const px = sy * sx * y
  const py = cx * y
  return [p.sw[0] + cz * px - sz * py, p.sw[1] + sz * px + cz * py, p.sw[2] + cy * sx * y]
}
