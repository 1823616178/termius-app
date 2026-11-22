// Channels sampled from the exact same non-planar seven-act motion as the hero mesh.
import { BEATS, bladePoint, DRAW_LENGTH, smooth } from './draw-motion'

export interface DanceScore {
  family: number
  sign: number
  count: number
  v: number[][]
  weight: number
  x: number
  y: number
  z: number
}

const TAU = Math.PI * 2
const N = 64
const rate = 60
const table: number[][] = []

for (let i = 0; i <= Math.ceil(DRAW_LENGTH * rate); i++) {
  const t = i / rate
  const pt = bladePoint(t, -2.8)
  const q = bladePoint(Math.max(0, t - 0.08), -2.8)
  const v = pt.map((x, j) => Math.tanh((x - q[j]!) * 1.1))
  const flare = Math.max(...BEATS.map((k) => Math.exp(-((t - k) ** 2) / 0.038)))
  table.push([...v, ...pt.map((x) => Math.tanh(x * 0.52)), flare])
}

// winding, accent, phrase family and group count follow each figure's topology
const voices: readonly [number, number, number][] = [
  [0, 9, 1],
  [1, 2, -1],
  [2, 5, 1],
  [3, 2, -1],
  [4, 10, 1],
  [1, 8, 1],
  [5, 5, -1],
  [4, 6, -1],
  [1, 2, 1],
  [2, 4, -1],
  [5, 3, 1],
  [6, 3, 1],
  [6, 4, -1],
  [7, 12, 1],
  [4, 5, -1],
  [2, 5, 1],
  [1, 6, 1],
  [0, 3, -1],
  [5, 7, 1],
  [6, 6, -1],
  [5, 18, -1],
  [7, 9, -1],
  [4, 5, 1],
  [0, 9, 1]
]

export function score(id: number, t: number | null): DanceScore | null {
  if (t == null) return null
  const [family, count, sign] = voices[id] ?? voices[0]!
  const span = 0.28 + 0.035 * (id % 6)
  const v: number[][] = []
  for (let k = 0; k < N; k++) {
    const a = Math.max(0, t - (span * k) / (N - 1)) * rate
    const j = Math.min(table.length - 1, Math.floor(a))
    const h = a - j
    const cur = table[j]!
    const nxt = table[Math.min(j + 1, table.length - 1)]!
    v.push(cur.map((x, l) => x + (nxt[l]! - x) * h))
  }
  const p = v[0]!
  const envelope = smooth(0.1, 2.15, t) * (1 - smooth(15.7, 17.74, t))
  const u = t / DRAW_LENGTH
  return {
    family,
    sign,
    count,
    v,
    weight: envelope,
    x: sign * TAU * smooth(5.9, 10.2, t) + envelope * (0.24 * p[2]! + 0.18 * p[4]!),
    y: -sign * TAU * smooth(10.3, 15.7, t) + envelope * (0.38 * p[0]! + 0.38 * Math.sin(u * TAU + id * 0.41)),
    z: envelope * (0.3 * p[3]! + 0.24 * p[1]!) + sign * 0.52 * Math.sin(TAU * u) ** 3
  }
}
