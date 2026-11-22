import { newSample, REF_INFO, referencePose } from './reference-fields'

export interface FormationLayout {
  p: Float32Array
  q: Float32Array
  col: Float32Array
  v: Float32Array
  jitter?: Float32Array
}

export interface FormationSpec {
  readonly name: string
  readonly short: string
  readonly english: string
  readonly story: string
  readonly storyEn: string
  readonly nucleus: string
  readonly nucleusEn: string
  readonly spell: string
  readonly spellEn: string
  readonly tone: string
  readonly toneEn: string
  readonly primary: string
  readonly secondary: string
  readonly tilt: number
  readonly roll: number
}

const stories: readonly [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  number,
  number
][] = [
  [
    '诛仙',
    'FOUR CELESTIAL GATES',
    '四座剑门遥相呼应，银刃朝向阵心。主剑起光，四门依次开合。',
    'Four sword gates echo across the void, silver tips aimed inward as the main blade ignites.',
    '四门阵枢',
    'Four-Gate Pivot',
    '四门齐明',
    'Four Gates Ablaze',
    '四门系',
    'Four-Gate',
    '#b5dbff',
    '#eab484',
    0.11,
    -0.09
  ],
  [
    '大庚',
    'GILDED THREADS',
    '庚金剑丝在不同深度穿梭，主剑拨动一线，整张金网随之泛光。',
    'Gilded threads weave across depth planes; pluck one line and the entire golden web resonates.',
    '廿四金弦',
    '24 Golden Chords',
    '金丝共振',
    'Gilded Resonance',
    '庚金系',
    'Gilded Metal',
    '#f3c56b',
    '#abdbd5',
    0.08,
    0.04
  ],
  [
    '春黎',
    'VERNAL MIRAGE',
    '五簇春影沿弧线舒展。浅碧、桃色剑流前后交叠，如花瓣绕着灵珠盛开。',
    'Five vernal streams unfurl in layered jade and blossom arcs like petals opening around the pearl.',
    '五瓣春影',
    'Five Dawn Petals',
    '春影重光',
    'Vernal Radiance',
    '春影系',
    'Vernal',
    '#89e5ba',
    '#f0aebf',
    0.36,
    -0.14
  ],
  [
    '青蟠',
    'JADE DRAGON COIL',
    '五股细剑拧成青龙脊线，自剑尖盘升至剑格，外圈剑流逆向托起龙身。',
    'Five slender currents braid into a rising azure dragon spine buoyed by counter-rotating outer blades.',
    '蟠龙玉柱',
    'Coiling Jade Pillar',
    '青元腾霄',
    'Azure Ascent',
    '青元系',
    'Azure Essence',
    '#64e2b6',
    '#e5c783',
    0.1,
    -0.12
  ],
  [
    '小千',
    'SIXFOLD BREATH',
    '六重剑环相互错开，阵心一次吐纳，万剑便从内到外层层响应。',
    'Six offset rings breathe in unison; every pulse at the core ripples outward ring by ring.',
    '六重环域',
    'Sixfold Rings',
    '小千吐纳',
    'Sixfold Breath',
    '环域系',
    'Ring Domain',
    '#9dc4ff',
    '#ceb0ff',
    0.3,
    0.05
  ],
  [
    '大千',
    'CELESTIAL ARMILLARY',
    '三道浑天剑轨在立体空间交会。灵珠如星核，轨面各循自己的轴线转动。',
    'Three armillary blade orbits intersect in space, each plane turning about its own celestial axis.',
    '三环浑天',
    'Tri-Ring Armillary',
    '星轨同辉',
    'Orbital Convergence',
    '浑天系',
    'Armillary',
    '#7edaff',
    '#f4d18f',
    0.13,
    -0.09
  ],
  [
    '恒山',
    'SEVEN STAR CHOIR',
    '七座剑簇列成星位，外环随主剑转向，金色音节沿七星次第点亮。',
    'Seven blade clusters hold Dipper stations as golden accents kindle in sequence along the ring.',
    '七星阵位',
    'Seven-Star Phalanx',
    '七曜唱和',
    'Seven-Star Choir',
    '七星系',
    'Seven-Star',
    '#a7e1c7',
    '#e6d5a1',
    0.11,
    -0.06
  ],
  [
    '六脉',
    'SIX LUMINOUS MERIDIANS',
    '六脉剑流自阵心发散，光潮按脉序传递，主剑银脊与当值脉门同亮。',
    'Six meridian streams radiate from center, passing luminous tides in strict sequential cadence.',
    '六脉灵枢',
    'Six Meridian Core',
    '六脉潮汐',
    'Meridian Surge',
    '六脉系',
    'Six-Meridian',
    '#8fd8ff',
    '#d0b6ff',
    0.17,
    0.08
  ],
  [
    '罗汉',
    'ARHAT HALO',
    '十八枚高阶阵标守住内圈，三层立剑环绕主剑，如金色梵音自下而上升起。',
    'Eighteen sentinel blades guard the inner halo while three upright tiers rise like gilded chimes.',
    '十八金印',
    '18 Golden Seals',
    '梵轮启明',
    'Halo Awakening',
    '梵轮系',
    'Sacred Halo',
    '#f0bf77',
    '#b5eee0',
    0.18,
    -0.02
  ],
  [
    '九宫',
    'NINE PALACE LATTICE',
    '九宫落子，八方列卦。宫与宫之间织起光络，每一道脉冲都从灵珠发出。',
    'Nine palaces anchor an eight-trigram lattice, weaving luminous pulses outward from the pearl.',
    '九宫八门',
    'Nine-Palace Gates',
    '九宫贯络',
    'Palace Lattice',
    '九宫系',
    'Nine-Palace',
    '#a2c4ff',
    '#f2cf93',
    0.14,
    0.04
  ],
  [
    '五行',
    'FIVE ELEMENT CYCLE',
    '金、木、水、火、土化成五座彩环，剑流沿五行相生的次序周游一轮。',
    'Metal, Wood, Water, Fire and Earth form five chromatic rings flowing in generative harmony.',
    '五行相生',
    'Five-Element Cycle',
    '五色连环',
    'Five-Element Link',
    '五行系',
    'Five-Element',
    '#9ce3bb',
    '#f4bd87',
    0.21,
    -0.08
  ],
  [
    '五九',
    'FORTY-FIVE STARS',
    '四十五柄领阵飞剑标定内盘，五股外旋长流绕主剑盘转，合成金青双辉。',
    'Forty-five lead swords anchor the inner dial while five outer spirals sweep in gold and teal.',
    '四十五星标',
    '45 Star Beacons',
    '五九旋盘',
    'Five-Nine Vortex',
    '星盘系',
    'Astrolabe',
    '#6edacb',
    '#edc389',
    0.57,
    -0.23
  ]
]

export const EXTRA: readonly FormationSpec[] = REF_INFO.map((m, j) => {
  const s = stories[j]!
  return {
    name: m.name,
    short: s[0],
    english: s[1],
    story: s[2],
    storyEn: s[3],
    nucleus: s[4],
    nucleusEn: s[5],
    spell: s[6],
    spellEn: s[7],
    tone: s[8],
    toneEn: s[9],
    primary: s[10],
    secondary: s[11],
    tilt: s[12],
    roll: s[13]
  }
})

export const heroRoll = (j: number): number => REF_INFO[j]?.bladeRoll ?? 0
export const heroPitch = (j: number): number => REF_INFO[j]?.bladePitch ?? 0

const S = newSample()
const pal = ['#efc177', '#7dd6a7', '#72bfee', '#f69375', '#c1a0de'] as const
const GROUPS = [4, 24, 5, 5, 6, 3, 7, 6, 18, 9, 5, 45] as const

const rgb = (h: string): [number, number, number] => [
  parseInt(h.slice(1, 3), 16) / 255,
  parseInt(h.slice(3, 5), 16) / 255,
  parseInt(h.slice(5, 7), 16) / 255
]

export function newReferenceLayout(j: number, N: number): FormationLayout {
  const d: FormationLayout = {
    p: new Float32Array(3 * N),
    q: new Float32Array(4 * N),
    col: new Float32Array(3 * N),
    v: new Float32Array(4 * N),
    jitter: new Float32Array(3 * N)
  }
  let seed = 5419 + 3313 * j
  const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const G = () => R() + R() + R() - 1.5
  const s = stories[j]!
  const A = rgb(s[10])
  const B = rgb(s[11])
  const grp = GROUPS[j] ?? 5
  const jitter = d.jitter!
  for (let i = 0; i < N; i++) {
    const k = i * 4
    const c = i * 3
    const g = j === 1 ? 0.083 : j === 2 ? 0.1 : 0.085
    for (let n = 0; n < 3; n++) jitter[c + n] = G() * g
    d.v[k + 1] = (i % grp) / grp
    d.v[k + 2] = R()
    d.v[k + 3] = R()
    let a = A
    let b = B
    const hVal = 0.5 + 0.45 * Math.sin((i % 7) + j)
    if (j === 10) {
      a = rgb(pal[i % 5]!)
      b = a
    }
    const brightness = 0.8 + 0.19 * R()
    for (let n = 0; n < 3; n++) d.col[c + n] = (a[n]! * (1 - hVal) + b[n]! * hVal) * brightness
  }
  updateReference(d, j, 0, 0)
  return d
}

export function updateReference(d: FormationLayout, j: number, t: number, amp: number): void {
  const N = d.p.length / 3
  const phase = j * 0.431 + 0.026 * t + amp * 0.115
  const fractVal = (phase / (Math.PI * 2)) % 1
  const jitter = d.jitter!
  for (let i = 0; i < N; i++) {
    const o = i * 3
    const k = i * 4
    referencePose(j, i, N, fractVal, phase, S)
    const { x, y, z } = S.position
    const scale = j === 6 ? 0.91 : j === 11 ? 0.96 : 1.15
    d.p[o] = (x - 1.12) * scale + jitter[o]!
    d.p[o + 1] = (y - 0.22) * scale + jitter[o + 1]!
    d.p[o + 2] = (z + 0.74) * scale + jitter[o + 2]!
    const d0 = S.direction
    let xx = d0.z
    let zz = -d0.x
    let ww = 1 + d0.y
    if (ww < 1e-7) {
      xx = 0
      zz = 1
      ww = 0
    }
    const l = 1 / (Math.hypot(xx, zz, ww) || 1)
    const r = (d.v[k + 3]! - 0.5) * 0.9
    const cs = Math.cos(r * 0.5)
    const sn = Math.sin(r * 0.5)
    d.q[k] = (xx * cs - zz * sn) * l
    d.q[k + 1] = ww * sn * l
    d.q[k + 2] = (zz * cs + xx * sn) * l
    d.q[k + 3] = ww * cs * l
    d.v[k] = Math.min(0.46, S.scale * (0.82 + 0.26 * d.v[k + 2]!) * (0.65 + 0.38 * S.stretch))
    if (j === 11 && i < 45) d.v[k] = 0.52
    if (j === 8 && i < 18) d.v[k] = 0.58
  }
}
