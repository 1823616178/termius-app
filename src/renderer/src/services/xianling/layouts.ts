import { EXTRA, type FormationLayout, type FormationSpec, newReferenceLayout } from './grand-formations'
import { newSample, referencePose } from './reference-fields'

export type { FormationLayout, FormationSpec }

// Each layout returns exactly COUNT independent positions, orientations and colors. No point sprites stand in for swords.
export const COUNT = 10000

const UPPER_VOLUME: readonly FormationSpec[] = [
  {
    name: '星河九旋',
    short: '星河',
    english: 'SPIRAL OF STARS',
    story: '九道剑流由金色星核舒展开来，沿星臂回旋成河。',
    storyEn: 'Nine sword streams unfurl from a golden stellar core, spiralling into a river of stars.',
    nucleus: '九旋星臂',
    nucleusEn: 'Nine Spiral Arms',
    spell: '星河涌潮',
    spellEn: 'Stellar Tide',
    tone: '星辉系',
    toneEn: 'Starlight',
    primary: '#78d8ff',
    secondary: '#f9c27f',
    tilt: 0.77,
    roll: -0.22
  },
  {
    name: '太极合仪',
    short: '两仪',
    english: 'TWIN CURRENTS',
    story: '苍青与月白各成一仪，阴阳鱼眼相抱，万剑同息。',
    storyEn: 'Azure and moonlit silver twine as yin and yang, breathing together in ten thousand blades.',
    nucleus: '阴阳双鱼',
    nucleusEn: 'Twin Yin-Yang',
    spell: '两仪分合',
    spellEn: 'Polarity Shift',
    tone: '玄水系',
    toneEn: 'Abyssal Tide',
    primary: '#69e3dd',
    secondary: '#ffdb9b',
    tilt: 0.24,
    roll: 0.07
  },
  {
    name: '苍龙游霄',
    short: '苍龙',
    english: 'JADE SKY DRAGON',
    story: '剑鳞循脊而生，双角破云；龙须先动，长身随后游过天幕。',
    storyEn: 'Blade scales trace the spine as horns cleave the clouds and the jade dragon glides skyward.',
    nucleus: '云脊龙珠',
    nucleusEn: 'Dragon Spine Pearl',
    spell: '苍龙抬首',
    spellEn: 'Dragon Rising',
    tone: '碧霄系',
    toneEn: 'Jade Sky',
    primary: '#68edbe',
    secondary: '#e4ca86',
    tilt: 0.04,
    roll: -0.04
  },
  {
    name: '丹凤朝阳',
    short: '丹凤',
    english: 'VERMILION PHOENIX',
    story: '赤金剑羽层层展开，五束长翎曳出余火，双翼环抱朝阳。',
    storyEn: 'Crimson-gold blade plumes fan wide while five tail feathers trail embers around the sun.',
    nucleus: '赤羽金冠',
    nucleusEn: 'Phoenix Crest',
    spell: '凤翎振翼',
    spellEn: 'Phoenix Wings',
    tone: '赤焰系',
    toneEn: 'Vermilion Flame',
    primary: '#ff936f',
    secondary: '#ffe3a3',
    tilt: 0.09,
    roll: 0.0
  },
  {
    name: '琉璃莲台',
    short: '莲台',
    english: 'LOTUS OF GLASS',
    story: '三重剑瓣托起莲心，外瓣先舒，内瓣后放，寒玉映金。',
    storyEn: 'Three tiers of crystalline sword petals cradle a gilded heart, blooming layer upon layer.',
    nucleus: '三重剑瓣',
    nucleusEn: 'Triple Lotus Petals',
    spell: '琉璃花开',
    spellEn: 'Lotus Bloom',
    tone: '琉璃系',
    toneEn: 'Crystalline',
    primary: '#83ebd3',
    secondary: '#efb2ee',
    tilt: 0.92,
    roll: 0.08
  },
  {
    name: '周天八卦',
    short: '八卦',
    english: 'CELESTIAL TRIGRAMS',
    story: '飞剑排作先天八卦的阴阳爻，三层刻度围绕阵眼逆向流转。',
    storyEn: 'Flying blades align into primordial trigrams as three graduated dials revolve around the core.',
    nucleus: '先天卦盘',
    nucleusEn: 'Primordial Bagua',
    spell: '八门轮转',
    spellEn: 'Eight-Gate Wheel',
    tone: '天仪系',
    toneEn: 'Celestial Dial',
    primary: '#8dbdff',
    secondary: '#ffdb95',
    tilt: 0.5,
    roll: -0.14
  },
  {
    name: '云阙九重',
    short: '云阙',
    english: 'PALACE IN THE CLOUDS',
    story: '浮空基座之上，金檐逐层挑起，万柄飞剑托成一座云中宝塔。',
    storyEn: 'Golden eaves lift tier by tier above a floating plinth, forged into a skyborne sword pagoda.',
    nucleus: '浮空金阙',
    nucleusEn: 'Skyborne Pagoda',
    spell: '层阙升云',
    spellEn: 'Cloud Palace Rise',
    tone: '云金系',
    toneEn: 'Cloud Gold',
    primary: '#a6cfff',
    secondary: '#ffcc77',
    tilt: 0.16,
    roll: -0.015
  },
  {
    name: '霜花六出',
    short: '霜花',
    english: 'SIXFOLD FROST',
    story: '六条冰脊向外生长，每一道侧枝再分晶棱，霜光透过镂空。',
    storyEn: 'Six frost spines branch into crystalline facets, letting pale winter radiance pierce through.',
    nucleus: '六棱冰晶',
    nucleusEn: 'Sixfold Crystal',
    spell: '霜枝绽放',
    spellEn: 'Frost Blossom',
    tone: '霜华系',
    toneEn: 'Frost Crystal',
    primary: '#a1eaff',
    secondary: '#c6b9ff',
    tilt: 0.26,
    roll: 0.19
  },
  {
    name: '双曜星桥',
    short: '双曜',
    english: 'BINARY ORBIT',
    story: '一冷一暖两颗剑星相望，倾斜星环交错，中间悬起一道光桥。',
    storyEn: 'Cool and warm sword stars gaze across tilted rings, bridged by a suspended arc of light.',
    nucleus: '双星轨道',
    nucleusEn: 'Binary Orbits',
    spell: '双曜交辉',
    spellEn: 'Binary Brilliance',
    tone: '双曜系',
    toneEn: 'Binary Star',
    primary: '#76dfff',
    secondary: '#ff9977',
    tilt: 0.09,
    roll: -0.095
  },
  {
    name: '沧海听潮',
    short: '沧海',
    english: 'CREST OF THE TIDE',
    story: '深蓝剑流卷起高浪，银白浪冠在半空回扣，细沫悬而未落。',
    storyEn: 'Deep sapphire currents surge into a curling silver crest, suspending spray in midair.',
    nucleus: '银冠潮眼',
    nucleusEn: 'Silver Tide Crest',
    spell: '万顷潮生',
    spellEn: 'Endless Surge',
    tone: '潮汐系',
    toneEn: 'Ocean Tide',
    primary: '#55bfff',
    secondary: '#b4ffed',
    tilt: 0.07,
    roll: -0.04
  },
  {
    name: '昆仑飞瀑',
    short: '昆仑',
    english: 'PEAKS AND CASCADES',
    story: '剑锋列成远近群峰，三道天瀑自峰顶垂落，山光与水色分明。',
    storyEn: 'Blades rise into distant peaks as three celestial waterfalls cascade down misty cliffs.',
    nucleus: '群峰天瀑',
    nucleusEn: 'Peaks & Cascades',
    spell: '云瀑垂天',
    spellEn: 'Skyward Cascade',
    tone: '青岚系',
    toneEn: 'Mountain Mist',
    primary: '#8ed4ab',
    secondary: '#b4eaff',
    tilt: 0.04,
    roll: -0.025
  },
  {
    name: '万剑归一',
    short: '归一',
    english: 'TEN THOUSAND AS ONE',
    story: '一万柄小剑重构仙灵：云冠、灵珠、剑脊依次点亮，最终合为一剑。',
    storyEn: 'Ten thousand blades assemble into Xianling itself—crown, pearl, and spine uniting as one.',
    nucleus: '仙灵剑相',
    nucleusEn: 'Xianling Silhouette',
    spell: '万剑合璧',
    spellEn: 'Myriad as One',
    tone: '归元系',
    toneEn: 'Primal Unity',
    primary: '#8edfff',
    secondary: '#f7d29d',
    tilt: 0.04,
    roll: -0.26
  }
]

export const ATLAS: readonly FormationSpec[] = [...UPPER_VOLUME, ...EXTRA]

export interface StudyPart {
  readonly tab: string
  readonly tabEn: string
  readonly name: string
  readonly nameEn: string
  readonly english: string
  readonly note: string
  readonly noteEn: string
}

export const STUDY_PARTS: readonly StudyPart[] = [
  {
    tab: '全剑',
    tabEn: 'Full',
    name: '仙灵全貌',
    nameEn: 'Xianling Full Blade',
    english: 'SILHOUETTE',
    note: '看剑尖、双翼剑格与白玉柄的比例。拖动可翻到背面；选下方部位可看局部。',
    noteEn:
      'Inspect the proportion of tip, twin-wing guard and jade grip. Drag to rotate; pick a tab below for close-ups.'
  },
  {
    tab: '灵珠',
    tabEn: 'Pearl',
    name: '浅蓝八卦珠',
    nameEn: 'Ice-Blue Bagua Pearl',
    english: 'TRIGRAM CORE',
    note: '浅蓝晶壳里，阴阳鱼与八组卦爻缓缓转动。轻拖到侧面，可见晶壳包着转芯的深度。',
    noteEn:
      'Inside the pale crystal shell, yin-yang fish and eight trigrams slowly revolve. Tilt sideways to inspect its depth.'
  },
  {
    tab: '剑格',
    tabEn: 'Guard',
    name: '旋云剑格',
    nameEn: 'Swirling Cloud Guard',
    english: 'CLOUD GUARD',
    note: '沿剑格侧缘转动，观察两翼云纹的起伏与镂空。',
    noteEn: 'Orbit along the guard rim to view the layered silver cloud reliefs and pierced openings.'
  },
  {
    tab: '剑柄',
    tabEn: 'Grip',
    name: '白玉剑柄',
    nameEn: 'White Jade Grip',
    english: 'JADE GRIP',
    note: '白玉柄身逐段收细，银箍与錾纹环绕其上。拖动可检查背面的纹路。',
    noteEn:
      'Turned white jade tapers down the grip, encircled by chiseled silver collars and twin spiral wires.'
  },
  {
    tab: '剑身',
    tabEn: 'Blade',
    name: '霜钢剑脊',
    nameEn: 'Forged Frost-Steel Spine',
    english: 'FORGED STEEL',
    note: '转动剑面，让光沿剑脊扫过；两侧刃面会先后映出亮银与暗银。',
    noteEn:
      'Turn the blade to sweep specular light along the spine as bevels alternate bright and shadowed silver.'
  }
]

const NUMERALS = '一二三四五六七八九'

export function formatChineseOrdinal(index: number): string {
  const ord =
    index < 9
      ? NUMERALS[index]!
      : index < 19
        ? '十' + (NUMERALS[index - 10] ?? '')
        : '二十' + (NUMERALS[index - 20] ?? '')
  return `第 ${ord} 阵`
}

type Tuple3 = [number, number, number]

const smoothArc = (x: number, a: number, b: number): number => Math.max(0, Math.min(1, (x - a) / (b - a)))
const TAU = Math.PI * 2
const pi = Math.PI
const mix = (a: number, b: number, k: number): number => a + (b - a) * k
const V = (x: number, y: number, z = 0): Tuple3 => [x, y, z]
const plus = (a: Tuple3, b: Tuple3): Tuple3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: Tuple3, b: Tuple3): Tuple3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const times = (a: Tuple3, k: number): Tuple3 => [a[0] * k, a[1] * k, a[2] * k]
const lerp = (a: Tuple3, b: Tuple3, k: number): Tuple3 => [
  mix(a[0], b[0], k),
  mix(a[1], b[1], k),
  mix(a[2], b[2], k)
]

function bez(a: Tuple3, b: Tuple3, c: Tuple3, d: Tuple3, t: number): Tuple3 {
  const u = 1 - t
  const u2 = u * u
  const u3 = u2 * u
  const t2 = t * t
  const t3 = t2 * t
  return [
    u3 * a[0] + 3 * u2 * t * b[0] + 3 * u * t2 * c[0] + t3 * d[0],
    u3 * a[1] + 3 * u2 * t * b[1] + 3 * u * t2 * c[1] + t3 * d[1],
    u3 * a[2] + 3 * u2 * t * b[2] + 3 * u * t2 * c[2] + t3 * d[2]
  ]
}

const hex = (s: string): Tuple3 => [
  ((parseInt(s, 16) >> 16) & 255) / 255,
  ((parseInt(s, 16) >> 8) & 255) / 255,
  (parseInt(s, 16) & 255) / 255
]

export function makeLayout(id: number): FormationLayout {
  if (id >= 12) return newReferenceLayout(id - 12, COUNT)
  let seed = 72643 + id * 32173
  const R = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
  const U = () => R() * 2 - 1
  const G = () => (R() + R() + R() - 1.5) * 1.18
  const p = new Float32Array(COUNT * 3)
  const q = new Float32Array(COUNT * 4)
  const col = new Float32Array(COUNT * 3)
  const v = new Float32Array(COUNT * 4)
  const spec = ATLAS[id]!
  const pa = hex(spec.primary.slice(1))
  const pb = hex(spec.secondary.slice(1))
  const white = hex('e2faff')

  let pos: Tuple3 = V(0, 0)
  let dir: Tuple3 = V(0, 1)
  let sz = 0.142
  let tint: Tuple3 = pa
  let region = 0
  let heat = 0

  function path(fn: (s: number) => Tuple3, t: number, width = 0, depth = width, spread = width): void {
    const a = fn(t)
    const bef = fn(Math.max(0, t - 0.001))
    const aft = fn(Math.min(1, t + 0.001))
    pos = plus(a, V(G() * width, G() * spread, G() * depth))
    dir = sub(aft, bef)
  }

  function ring(r: number, ang: number, z: number, w = 0.035): void {
    pos = V(r * Math.cos(ang) + G() * w, r * Math.sin(ang) + G() * w, z + G() * w)
    dir = V(-Math.sin(ang), Math.cos(ang), 0.02 * U())
  }

  function segment(a: Tuple3, b: Tuple3, t: number, width = 0.035, depth = width): void {
    pos = plus(lerp(a, b, t), V(G() * width, G() * width, G() * depth))
    dir = sub(b, a)
  }

  function curve(a: Tuple3, b: Tuple3, c: Tuple3, d: Tuple3, t: number, w = 0.035): void {
    path((s) => bez(a, b, c, d, s), t, w)
  }

  function sphere(x: number, y: number, z: number, rx: number, ry: number, rz: number): void {
    const yy = U()
    const ang = R() * TAU
    const rr = Math.sqrt(1 - yy * yy)
    pos = V(x + rx * rr * Math.cos(ang), y + ry * yy, z + rz * rr * Math.sin(ang))
    dir = V(-Math.sin(ang), 0.24, Math.cos(ang))
  }

  function plume(a: Tuple3, b: Tuple3, c: Tuple3, d: Tuple3, t: number, w: number, reg: number): void {
    const hVal = Math.pow(Math.sin(t * pi), 0.63)
    const off = U() * w * hVal
    const base = bez(a, b, c, d, t)
    const dd = sub(bez(a, b, c, d, Math.min(t + 0.002, 1)), bez(a, b, c, d, Math.max(t - 0.002, 0)))
    const l = Math.hypot(dd[0], dd[1]) || 1
    pos = plus(base, V((-off * dd[1]) / l, (off * dd[0]) / l, G() * 0.035))
    dir = plus(
      times(dd, 1 / l),
      V((-dd[1] / l) * Math.sign(off) * 0.56, (dd[0] / l) * Math.sign(off) * 0.56, 0.08)
    )
    tint = lerp(pa, pb, 0.18 + (0.62 * Math.abs(off)) / (w + 0.001))
    if (Math.abs(off) < 0.03) tint = white
    region = reg
  }

  for (let i = 0; i < COUNT; i++) {
    const f = (i + 0.5) / COUNT
    const t = R()
    const a = R() * TAU
    const s = R() < 0.5 ? -1 : 1
    pos = V(0, 0)
    dir = V(0, 1)
    sz = 0.142 + R() * 0.105
    tint = lerp(pa, white, R() * 0.37)
    region = 0
    heat = R()

    if (id === 0) {
      if (f < 0.78) {
        const arm = i % 9
        const r = 0.4 + 3.87 * t ** 0.78
        const lane = Math.floor(R() * 6)
        const th =
          (arm * TAU) / 9 + 0.72 * r + 0.36 * Math.log(0.5 + r) + 0.024 * lane + G() * (0.021 + 0.065 * t)
        const b = 0.38 * Math.exp(-r * 0.72)
        ring(r, th, b + G() * (0.022 + 0.047 * t), 0.012 + 0.024 * t)
        dir = V(Math.cos(th) - r * 0.85 * Math.sin(th), Math.sin(th) + r * 0.85 * Math.cos(th), -0.09)
        tint = lerp(
          t < 0.28 ? pb : lerp(hex('2c8eea'), pa, (arm % 3) * 0.36),
          white,
          0.06 + 0.24 * (lane / 5)
        )
        sz *= 0.78 + 0.55 * t
        region = arm / 9
      } else if (f < 0.9) {
        const rr = 0.2 + 0.5 * R()
        const yy = U()
        const rr2 = Math.sqrt(1 - yy * yy)
        pos = V(rr * Math.cos(a) * rr2, rr * Math.sin(a) * rr2, 0.2 + rr * yy * 0.8)
        dir = V(-Math.sin(a), Math.cos(a), yy * 0.4)
        tint = lerp(pb, white, 0.06 + R() * 0.38)
        sz *= 0.7
        region = 1
      } else {
        const r = [3.77, 4.12, 4.45][i % 3]!
        const th = a + G() * 0.015
        ring(r, th, 0.05 + 0.22 * Math.sin(th * 2 + (i % 3)), 0.028)
        tint = lerp(pa, pb, i % 3 === 2 ? 0.6 : 0.1)
        sz *= 0.82
        region = 1.1
      }
    }

    if (id === 1) {
      if (f < 0.81) {
        const r = 3.3 * Math.sqrt(R())
        const x = r * Math.cos(a)
        const y = r * Math.sin(a)
        const edge = (y >= 0 ? 1 : -1) * Math.sqrt(Math.max(0, 1.65 ** 2 - (Math.abs(y) - 1.65) ** 2))
        const side = x > edge ? 1 : -1
        const dot = Math.hypot(x, y - side * -1.65) < 0.48
        const sideColor = dot ? -side : side
        tint = sideColor === 1 ? lerp(pb, white, R() * 0.38) : lerp(hex('2185a6'), pa, R() * 0.68)
        const cy = y > 0 ? 1.65 : -1.65
        pos = V(x + 0.07 * side, y, 0.16 + 0.27 * Math.sqrt(1 - (r / 3.31) ** 2) + 0.11 * side)
        dir = V(-(y - cy), x, 0.03 * U())
        region = side > 0 ? 0.2 : 0.7
        sz *= 0.94
      } else if (f < 0.9) {
        const r = 0.48 + 0.07 * U()
        ring(r, a, 0.57, 0.019)
        pos[1] += s * 1.65
        tint = s > 0 ? pb : pa
        region = 0.9
      } else {
        ring([3.46, 3.77, 4.02][i % 3]!, a, 0.02, 0.017)
        sz *= 0.94
        tint = i % 3 === 2 ? pb : white
        region = 1
      }
    }

    if (id === 2) {
      const spine = (u: number): Tuple3 =>
        V(
          -4.2 + 6.37 * u,
          -0.32 + 1.23 * Math.sin(u * TAU * 1.24 - 0.68) + 1.44 * u,
          0.55 * Math.sin(u * TAU * 1.44)
        )
      if (f < 0.57) {
        const u = Math.pow(t, 0.79)
        const P = spine(u)
        const D = sub(spine(u + 0.001), spine(u - 0.001))
        const l = Math.hypot(D[0], D[1])
        const rr = 0.065 + 0.36 * Math.sin(u * pi * 0.84)
        const b = (TAU * (i % 7)) / 7 + u * 38 + G() * 0.055
        pos = plus(P, V((-D[1] / l) * rr * Math.cos(b), (D[0] / l) * rr * Math.cos(b), rr * Math.sin(b)))
        dir = D
        tint = lerp(pa, pb, 0.17 + 0.58 * (0.5 + 0.5 * Math.cos(b)) ** 6)
        region = u
        sz *= 0.85 + 0.55 * u
      } else if (f < 0.66) {
        const idx = i % 27
        const u = 0.1 + idx * 0.031
        const hVal = 0.2 + 0.31 * u
        const P = spine(u)
        const D = sub(spine(u + 0.001), spine(u - 0.001))
        const l = Math.hypot(D[0], D[1])
        segment(
          plus(P, V((-D[1] / l) * 0.18, (D[0] / l) * 0.18, 0.03)),
          plus(P, V((-D[1] / l) * hVal - 0.24, (D[0] / l) * hVal + 0.17, -0.1)),
          t,
          0.03
        )
        tint = pb
        sz *= 0.9
      } else {
        const head = spine(1)
        const H = (x: number, y: number, z = 0): Tuple3 => plus(head, V(x, y, z))
        if (f < 0.75) {
          sphere(...H(0.08, 0.07), 0.62, 0.42, 0.45)
          tint = lerp(pa, white, 0.25)
        } else if (f < 0.8) {
          sphere(...H(0.63, -0.045, 0.08), 0.59, 0.21, 0.29)
          tint = lerp(pa, pb, 0.43)
        } else if (f < 0.86) {
          const side = i % 2 ? 1 : -1
          curve(
            H(-0.08, 0.25, 0.23 * side),
            H(-0.37, 0.82, 0.28 * side),
            H(-0.59, 0.93, 0.37 * side),
            H(-0.66, 1.34, 0.4 * side),
            t,
            0.038
          )
          if (i % 3 === 0) segment(H(-0.38, 0.77, 0.31 * side), H(-0.1, 1.12, 0.36 * side), t, 0.035)
          tint = pb
        } else if (f < 0.935) {
          const k = i % 5
          curve(
            H(0.63, -0.08, 0.11 * s),
            H(1.14, 0.34 + s * 0.24, 0.32 * s),
            H(1.65 + s * 0.2, -0.88 + 0.12 * k, 0.53 * s),
            H(2.05 - 0.1 * k, -0.19 + 0.14 * k, 0.08 * s),
            t,
            0.016
          )
          sz *= 0.75
          tint = lerp(pb, white, 0.25)
        } else if (f < 0.955) {
          sphere(...H(0.36, 0.18, 0.39 * s), 0.105, 0.085, 0.07)
          tint = pb
          sz *= 0.65
        } else {
          const u = i % 2 ? 0.36 : 0.76
          const P = spine(u)
          curve(
            P,
            plus(P, V(-0.13, -0.57, 0.4 * s)),
            plus(P, V(0.35, -0.68, 0.55 * s)),
            plus(P, V(0.55 + 0.09 * (i % 3), -0.93 + 0.09 * (i % 3), 0.52 * s)),
            t,
            0.052
          )
          tint = lerp(pa, pb, 0.25)
        }
      }
    }

    if (id === 3) {
      const side = i % 2 ? 1 : -1
      const S = (x: number, y: number, z = 0): Tuple3 => V(x * side, y, z)
      if (f < 0.62) {
        const k = Math.floor(R() * 13)
        const u = k / 12
        plume(
          S(0.16, 0.12 + 0.57 * u),
          S(1.22, 0.46 - 0.59 * u, 0.24),
          S(2.49 - 0.91 * u, 0.86 + 0.25 * u, 0.35),
          S(4.05 - 1.48 * u, 1.99 - 2.19 * u, 0.08 - 0.3 * u),
          t,
          0.11 + 0.09 * u,
          side > 0 ? 0.22 : 0.74
        )
        tint = lerp(tint, hex('ff603c'), 0.37 * (1 - u))
      } else if (f < 0.76) {
        const k = i % 8
        const u = k / 7
        plume(
          S(0.1, 0.52),
          S(0.55 + 0.65 * u, 1.13, 0.48),
          S(1.55 + 0.7 * u, 1.08 + 0.36 * u, 0.25),
          S(2.09 + 1.56 * u, 1.1 + 1.11 * u, 0.1),
          t,
          0.105,
          0.42
        )
        tint = lerp(pb, pa, 0.2 + 0.57 * u)
      } else if (f < 0.91) {
        const k = i % 5
        const off = (k - 2) * 0.68
        plume(
          V(0.0, -0.21),
          V(off * 0.24, -0.95, 0.21),
          V(off * 1.55 - 1, -1.74, 0.46),
          V(off - 0.38, -3.04 + 0.27 * Math.abs(k - 2), 0.1),
          t,
          0.105,
          0.55
        )
      } else if (f < 0.955) {
        sphere(0, 0.06, 0.2, 0.27, 0.77, 0.23)
        tint = pb
      } else if (f < 0.985) {
        curve(V(0, 0.41, 0.2), V(0.2, 0.86, 0.26), V(-0.07, 1.26, 0.23), V(0.38, 1.35, 0.26), t, 0.084)
        tint = pb
      } else {
        const k = i % 3
        curve(
          V(-0.03, 1.14, 0.2),
          V(-0.3, 1.45, 0.23),
          V(-0.51, 1.63, 0.26),
          V(-0.49 - 0.18 * k, 1.73 + 0.13 * k, 0.25),
          t,
          0.023
        )
        tint = pb
      }
    }

    if (id === 4) {
      const layer = i % 3
      const n = [10, 8, 6][layer]!
      const j = Math.floor(R() * n)
      const phi = (j * TAU) / n + 0.27 * layer
      const u = 0.02 + 0.98 * t
      const b = U()
      const rr = 0.3 + [3.7, 2.73, 1.74][layer]! * u
      const th = phi + ((b * pi) / n) * 0.91 * Math.sin(pi * u) ** 0.65
      const z =
        [-0.72, -0.42, -0.05][layer]! +
        [0.87, 1.48, 1.7][layer]! * u ** 1.6 +
        0.35 * Math.sin(pi * u) * (1 - b * b)
      pos = V(rr * Math.cos(th), rr * Math.sin(th), z)
      dir = V(Math.cos(th), Math.sin(th), 0.52 + 0.5 * u)
      tint = lerp(layer === 1 ? pb : pa, white, 0.26 + 0.4 * Math.abs(b))
      if (f > 0.93) {
        sphere(0.0, 0.0, 0.47, 0.57, 0.57, 0.58)
        tint = hex('ffd48b')
      }
      region = layer * 0.4
      sz *= 0.96
    }

    if (id === 5) {
      if (f < 0.43) {
        const j = i % 8
        const row = Math.floor(R() * 3)
        const th = (j * TAU) / 8
        const bits = ['111', '011', '010', '001', '000', '100', '101', '110'][j]!
        const x = bits[row] === '1' ? U() * 0.64 : s * (0.16 + R() * 0.48)
        const y = 1.88 + row * 0.31 + U() * 0.079
        pos = V(x * Math.cos(th) - y * Math.sin(th), x * Math.sin(th) + y * Math.cos(th), 0.12 + U() * 0.068)
        dir = V(Math.cos(th), Math.sin(th), 0.01)
        tint = lerp(pb, white, R() * 0.27)
        region = 0.4
      } else if (f < 0.67) {
        const lev = i % 4
        const th = ((Math.floor(R() * 8) + 0.5) * TAU) / 8
        const w = U() * Math.tan(pi / 8)
        const rad = 2.9 + lev * 0.207
        pos = V(
          rad * (Math.cos(th) - w * Math.sin(th)),
          rad * (Math.sin(th) + w * Math.cos(th)),
          lev * 0.035 - 0.1
        )
        dir = V(-Math.sin(th), Math.cos(th))
        tint = lev === 3 ? pb : pa
        region = 0.8
      } else if (f < 0.84) {
        const j = i % 72
        const u = R()
        const r = 3.73 + u * (j % 6 ? 0.15 : 0.34)
        pos = V(r * Math.cos((j * TAU) / 72), r * Math.sin((j * TAU) / 72), -0.02)
        dir = V(Math.cos((j * TAU) / 72), Math.sin((j * TAU) / 72))
        tint = j % 6 ? pa : pb
        region = 1
      } else if (f < 0.93) {
        ring(i % 2 ? 1.48 : 1.63, a, 0.16, 0.015)
        region = 0.16
      } else {
        const r = 1.22 * Math.sqrt(R())
        const x = r * Math.cos(a)
        const y = r * Math.sin(a)
        pos = V(x, y, 0.25)
        dir = V(-y, x)
        tint = x > (y > 0 ? 1 : -1) * Math.sqrt(Math.max(0, 0.61 ** 2 - (Math.abs(y) - 0.61) ** 2)) ? pa : pb
        region = 0.05
      }
    }

    if (id === 6) {
      if (f < 0.61) {
        const layer = i % 5
        const w = 2.73 - layer * 0.4
        const y = -1.43 + layer * 0.83
        const face = Math.floor(R() * 4)
        const u = U()
        const vVal = R()
        const rr = w * (1 - 0.69 * vVal)
        const X = rr * u
        const Z = rr * (face % 2 === 0 ? 1 : -1)
        const xx = face < 2 ? X : Z
        const zz = face < 2 ? Z : X
        const hVal =
          y + 0.49 * vVal + 0.33 * Math.pow(Math.abs(u), 4) * (1 - vVal) + 0.07 * Math.cos(u * Math.PI)
        pos = V(xx, hVal, zz * 0.59)
        dir = V(xx * 0.52, 0.33, zz * 0.42)
        tint = vVal < 0.16 ? pb : lerp(pa, pb, 0.28)
        region = layer / 5
      } else if (f < 0.83) {
        const layer = i % 5
        const w = 1.68 - layer * 0.245
        const y = -2.05 + layer * 0.83
        const j = i % 4
        const x = (j % 2 ? 1 : -1) * w * 0.82
        const z = (j < 2 ? -1 : 1) * w * 0.53
        if (i % 5 === 0) segment(V(-w, y + 0.42, z), V(w, y + 0.42, z), t, 0.032)
        else segment(V(x, y, z), V(x, y + 0.69, z), t, 0.075)
        tint = lerp(pb, pa, 0.43)
        region = layer / 5
      } else if (f < 0.94) {
        const j = i % 3
        const w = 2.55 + j * 0.21
        const th = ((i % 4) * TAU) / 4
        const x = U() * w
        pos = V(
          x * Math.cos(th) - w * Math.sin(th),
          -2.11 - j * 0.14 + U() * 0.045,
          (x * Math.sin(th) + w * Math.cos(th)) * 0.57
        )
        dir = V(Math.cos(th), 0, Math.sin(th))
        tint = pa
      } else {
        const rr = 0.28 * (1 - t) + 0.09 * Math.sin(t * 9 * pi)
        pos = V(rr * Math.cos(a), 2.25 + t * 0.86, rr * Math.sin(a))
        dir = V(0, 1, 0)
        tint = pb
      }
    }

    if (id === 7) {
      const arm = i % 6
      const th = (arm * TAU) / 6
      let rr: number | null = null
      let x = 0
      R()
      if (f < 0.21) {
        rr = 0.37 + 3.64 * t
        x = G() * 0.051
      } else if (f < 0.73) {
        const k = i % 4
        const base = 0.74 + k * 0.67
        const branch = 1.08 - k * 0.2
        rr = base + t * branch * 0.76
        x = s * t * branch * 0.8 + G() * 0.031
      } else if (f < 0.89) {
        const k = i % 3
        const base = 0.74 + k * 0.67
        const branch = 1.08 - k * 0.2
        const ss = i % 2 ? 1 : -1
        rr = base + 0.49 * branch + t * 0.28
        x = ss * (0.51 * branch + 0.34 * t) + G() * 0.025
      } else {
        const theta = th + pi / 6
        const w = U() * 0.575
        const rad = i % 2 ? 0.63 : 1.35
        pos = V(
          rad * (Math.cos(theta) - w * Math.sin(theta)),
          rad * (Math.sin(theta) + w * Math.cos(theta)),
          0.12
        )
        dir = V(-Math.sin(theta), Math.cos(theta))
        rr = null
      }
      if (rr !== null) {
        pos = V(
          rr * Math.cos(th) - x * Math.sin(th),
          rr * Math.sin(th) + x * Math.cos(th),
          0.24 * Math.sin(rr * 0.85) + G() * 0.045
        )
        dir = V(Math.cos(th + (f < 0.21 ? 0 : 0.78 * s)), Math.sin(th + (f < 0.21 ? 0 : 0.78 * s)), 0)
      }
      tint = lerp(pa, pb, 0.17 + 0.47 * t)
      sz *= 0.93
      region = arm / 6
    }

    if (id === 8) {
      const side = i % 2 ? 1 : -1
      const x = side * 1.85
      const y = side * 0.47
      const rad = side > 0 ? 1.03 : 1.27
      if (f < 0.53) {
        sphere(x, y, 0, rad, rad, rad)
        dir = V(-(pos[1] - y), pos[0] - x, 0.48)
        tint = lerp(side > 0 ? pb : pa, white, R() * 0.38)
      } else if (f < 0.86) {
        const r = rad * (1.48 + Math.floor(R() * 4) * 0.14) + G() * 0.024
        const b = side * 0.52
        const xx = r * Math.cos(a)
        const yy = r * 0.35 * Math.sin(a)
        pos = V(
          x + xx * Math.cos(b) - yy * Math.sin(b),
          y + xx * Math.sin(b) + yy * Math.cos(b),
          r * 0.74 * Math.sin(a)
        )
        dir = V(-Math.sin(a + b), Math.cos(a + b) * 0.69, 0.61 * Math.cos(a))
        tint = lerp(side > 0 ? pb : pa, white, 0.3)
      } else {
        const k = i % 3
        path(
          (u) =>
            V(
              mix(-2.05, 2.05, u),
              mix(-0.44, 0.53, u) + Math.sin(u * pi * 2 + k * 0.18) * 0.54,
              Math.sin(u * pi * 2 + 0.8) * 0.55
            ),
          t,
          0.053
        )
        tint = lerp(pa, pb, t)
      }
      region = side === 1 ? 0.75 : 0.25
    }

    if (id === 9) {
      if (f < 0.79) {
        const line = i % 54
        const u = line / 53
        const off = U()
        const A = V(-4, -1.56 + 0.8 * u, off * 0.36)
        const B = V(-0.7, -3.0 + u, off * 0.51)
        const C = V(0.3 + u * 1.29, 3.08 + u * 0.68, off * 0.55)
        const D = V(2.4 + u * 0.74, 1.31 + u * 0.28, off * 0.36)
        path((z) => bez(A, B, C, D, z), t, 0.024, 0.11)
        tint = lerp(hex('1c689f'), pa, 0.16 + 0.72 * u)
        region = u
      } else if (f < 0.935) {
        const k = i % 14
        curve(
          V(0.65 + 0.095 * k, 1.99 + 0.031 * k, 0.0),
          V(2.05 + 0.1 * k, 2.48 - 0.025 * k, 0.12),
          V(2.15 + 0.08 * k, 0.97 - 0.065 * k, 0.15),
          V(1.5 + 0.096 * k, 1.07 - 0.09 * k, 0.22),
          t,
          0.045
        )
        tint = lerp(white, pb, 0.5)
        region = 1
      } else {
        const k = i % 8
        path(
          (u) =>
            V(
              -4.05 + 8.1 * u,
              -1.72 + 0.11 * k + 0.22 * Math.sin(u * 10 + k * 0.35),
              0.79 * Math.sin(u * pi) + k * 0.09
            ),
          t,
          0.023
        )
        tint = lerp(pa, white, R() * 0.6)
        region = 0.45
      }
    }

    if (id === 10) {
      const pk: readonly [number, number, number, number][] = [
        [-3.15, 1.5, 1.14, -0.44],
        [-1.76, 3.21, 1.14, -0.35],
        [0, 4.55, 1.55, -0.77],
        [1.63, 3.13, 1.2, -0.26],
        [3.08, 1.97, 1.22, -0.36]
      ]
      if (f < 0.78) {
        const [x, hVal, w, z] = pk[i % 5]!
        const u = R()
        const rr = w * (1 - u) ** 0.79 * (1 + 0.13 * Math.sin(a * 5 + u * 7))
        const y = -2.15 + hVal * u + 0.1 * Math.sin(a * 3 + u * 6)
        pos = V(x + rr * Math.cos(a) + 0.16 * Math.sin(3 * u + x), y, z + rr * 0.78 * Math.sin(a))
        dir = V(-0.22 * Math.cos(a), 1, -0.22 * Math.sin(a))
        tint = u > 0.78 ? lerp(white, pb, 0.33) : lerp(hex('387f85'), pa, u)
        region = u * 0.65
      } else if (f < 0.93) {
        const j = i % 3
        const [x, hVal, w, z] = pk[j + 1]!
        path(
          (u) =>
            V(
              x + 0.2 * Math.sin(u * 5) + 0.26,
              -1.97 + hVal * 0.78 - u * hVal * 0.85,
              z + w * 0.81 * (0.23 + 0.7 * u)
            ),
          t,
          0.075,
          0.035
        )
        tint = lerp(pb, white, 0.47)
        region = 0.9
      } else {
        const r = 2.3 + 1.7 * R()
        pos = V(r * Math.cos(a), -2.12 + 0.13 * Math.sin(a * 3), r * 0.58 * Math.sin(a))
        dir = V(-Math.sin(a), 0, Math.cos(a))
        tint = pa
        region = 1
      }
    }

    if (id === 11) {
      if (f < 0.5) {
        const u = t
        const w = 0.24 * (1 - 0.22 * u) * (1 - Math.pow(u, 13))
        pos = V(U() * w, 1.01 - 4.59 * u, G() * 0.07 * (1 - u * 0.7))
        dir = V(0.008 * U(), -1, 0.01 * U())
        tint = Math.abs(pos[0]) > 0.74 * w ? white : lerp(pa, white, R() * 0.43)
        sz *= 0.98
      } else if (f < 0.66) {
        const k = i % 3
        const w = 1 + 0.22 * k
        curve(
          V(0, 0.93, 0.03),
          V(s * 1.12 * w, 1.24, 0.09),
          V(s * 0.81 * w, 1.76, 0.11),
          V(s * (0.45 + 0.15 * k), 1.97 + k * 0.14, 0.04),
          t,
          0.047
        )
        tint = k === 0 ? pb : pa
      } else if (f < 0.79) {
        const y = 1.75 + t * 1.72
        const rr = 0.112 + 0.033 * Math.cos(t * TAU * 11) + 0.057 * t ** 4
        pos = V(rr * Math.cos(a), y, rr * Math.sin(a))
        dir = V(-Math.sin(a), 0.5, Math.cos(a))
        tint = i % 4 ? white : pb
      } else if (f < 0.85) {
        sphere(0, 1.49, 0.0, 0.31, 0.33, 0.21)
        tint = lerp(hex('1296bf'), pa, 0.5)
      } else if (f < 0.91) {
        curve(V(-0.12, 3.44, 0), V(-0.34, 3.53, 0.0), V(-0.26, 2.71, 0.02), V(-0.56, 2.53, 0.06), t, 0.023)
        if (i % 3 !== 0)
          curve(
            V(-0.56, 2.54, 0.06),
            V(-0.6, 2.0, 0.08),
            V(-0.79, 1.82, 0.05),
            V(-0.88, 1.33, 0.03),
            t,
            0.038
          )
        tint = pb
      } else {
        const k = i % 3
        path(
          (u) => {
            const an = u * 6.0 + 0.35 * k
            return V((0.31 + 0.6 * u) * Math.sin(an), -2.61 + u * 4.33, 0.46 * Math.cos(an))
          },
          t,
          0.026
        )
        tint = pa
      }
      region = t
    }

    if (id === 0 && i >= COUNT - 100) {
      const j = i - (COUNT - 100)
      const ang = (j * TAU) / 100
      const r = 4.34
      pos = V(r * Math.cos(ang), r * Math.sin(ang), 0.28 + 0.13 * Math.cos(4 * ang))
      dir = V(0.28 * Math.cos(ang), 0.28 * Math.sin(ang), 1)
      sz = 0.42 + 0.19 * (j % 5 === 0 ? 1 : 0)
      tint = j % 5 === 0 ? pb : white
      region = 1.1
    }

    // Final calligraphic passes refine distinctive silhouettes, still drawing from the same 10,000-instance budget.
    if (id === 2) {
      const baseY = -0.32 + 1.23 * Math.sin(TAU * 1.24 - 0.68) + 1.44
      const H = (x: number, y: number, z = 0): Tuple3 => V(2.17 + x, baseY + y, z)
      if (f >= 0.515 && f < 0.57) {
        const k = Math.floor(R() * 9)
        const j = k / 8
        curve(
          H(-0.23, 0.22 - j * 0.43, 0.16 * s),
          H(-0.88 - 0.27 * j, 0.52 - j * 0.48, 0.28 * s),
          H(-1.08, 0.86 - 0.85 * j, 0.56 * s),
          H(-1.42 + 0.58 * j, 0.66 - 0.98 * j, 0.48 * s),
          t,
          0.037
        )
        tint = lerp(pa, pb, 0.29 + 0.52 * (1 - j))
        sz *= 0.83
      }
      if (f >= 0.912 && f < 0.943) {
        curve(
          H(0.19, -0.18, 0.08),
          H(0.38, -0.67, 0.11),
          H(0.88, -0.52, 0.13),
          H(1.12, -0.34, 0.16),
          t,
          0.045
        )
        tint = lerp(pa, pb, 0.62)
      }
      if (f > 0.953 && f < 0.975) {
        sphere(3.98, baseY - 0.12, 0.3, 0.17, 0.17, 0.17)
        tint = pb
        sz *= 0.72
      }
      if (f > 0.975) {
        const u = i % 2 ? 0.33 : 0.77
        const spineAux = (z: number): Tuple3 =>
          V(
            -4.2 + 6.37 * z,
            -0.32 + 1.23 * Math.sin(z * TAU * 1.24 - 0.68) + 1.44 * z,
            0.55 * Math.sin(z * TAU * 1.44)
          )
        const P = spineAux(u)
        const vVal = R()
        curve(
          plus(P, V(-0.03, -0.04, 0.27)),
          plus(P, V(-0.19, -0.69, 0.4)),
          plus(P, V(0.45, -0.6, 0.64)),
          plus(P, V(0.6, -1.06, 0.73)),
          vVal,
          0.071
        )
        if (t > 0.69) {
          const toe = Math.floor(R() * 3) - 1
          curve(
            plus(P, V(0.59, -1.04, 0.72)),
            plus(P, V(0.72, -1.22, 0.76)),
            plus(P, V(0.93 + toe * 0.11, -1.13 + toe * 0.09, 0.75)),
            plus(P, V(1.03 + toe * 0.12, -0.98 + toe * 0.12, 0.64)),
            vVal,
            0.027
          )
          tint = pb
        }
      }
    }

    if (id === 3 && f < 0.62) {
      const k = Math.abs(pos[0]) / 4.2
      tint = lerp(hex('f35238'), hex('ffba60'), 0.13 + k * 0.61 + R() * 0.13)
    }

    if (id === 6) {
      if (f > 0.627 && f < 0.831) {
        const j = Math.floor(R() * 5)
        const W = 1.71 - j * 0.244
        const y0 = -2.05 + j * 0.83
        const sj = R() < 0.5 ? -1 : 1
        const zj = R() < 0.5 ? -1 : 1
        if (R() < 0.61) {
          segment(V(sj * W * 0.83, y0, zj * W * 0.53), V(sj * W * 0.83, y0 + 0.7, zj * W * 0.53), t, 0.07)
          tint = lerp(pb, pa, 0.31)
        } else {
          const pillar = (Math.floor(R() * 5) - 2) * W * 0.31
          segment(V(pillar, y0 + 0.06, zj * W * 0.4), V(pillar, y0 + 0.63, zj * W * 0.4), t, 0.035)
          tint = lerp(hex('398794'), pa, R() * 0.41)
        }
        region = j / 5
      }
      const xx = pos[0]
      const zz = pos[2]
      const dx = dir[0]
      const dz = dir[2]
      pos[0] = 0.958 * xx + 0.286 * zz
      pos[2] = -0.286 * xx + 0.958 * zz
      dir[0] = 0.958 * dx + 0.286 * dz
      dir[2] = -0.286 * dx + 0.958 * dz
    }

    if (id === 7) {
      const arm = i % 6
      const th = (arm * TAU) / 6
      const k = Math.floor(R() * 4)
      const base = 0.71 + 0.72 * k
      const len = 1.26 - 0.235 * k
      const side = U() > 0 ? 1 : -1
      let X = 0
      let Y = 0
      let da = 0
      if (f < 0.22) {
        Y = 0.23 + 3.9 * t
        X = G() * 0.038
      } else if (f < 0.72) {
        Y = base + t * len * 0.69
        X = side * t * len * 0.83
        da = 0.84 * side
      } else if (f < 0.89) {
        const p0 = R() < 0.5 ? 0.43 : 0.68
        const vVal = R()
        const twig = (0.43 - 0.064 * k) * vVal
        Y = base + p0 * len * 0.69 + twig
        X = side * p0 * len * 0.83 + side * twig * 0.12
        da = 0.14 * side
      } else if (f < 0.97) {
        const x = U() * 0.572
        const r = i % 2 ? 0.64 : 1.44
        Y = r
        X = x * r
        da = Math.PI * 0.5
      } else {
        const r = 0.52 * Math.sqrt(R())
        Y = r * Math.cos(a)
        X = r * Math.sin(a)
        da = th
      }
      pos = V(
        Y * Math.cos(th) - X * Math.sin(th) + G() * 0.026,
        Y * Math.sin(th) + X * Math.cos(th) + G() * 0.026,
        0.24 * Math.sin(Y * 0.82) + G() * 0.042
      )
      dir = V(Math.cos(th + da), Math.sin(th + da), 0.02)
      tint = lerp(pa, pb, R() * 0.61)
      sz *= 0.94
    }

    if (id === 9 && f < 0.935) {
      const b = R()
      const u = t
      const A = V(-4.02, -2.35 + b * 1.32, 0.24 * G())
      const P = V(0.02 + 1.12 * b, 0.85 + 0.47 * b, 0.3 * G())
      const D = V(2.01 + 1.26 * b, 1.34 + 0.15 * b, 0.23 * G())
      if (f < 0.78) {
        path(
          (vVal) =>
            vVal < 0.64
              ? bez(
                  A,
                  V(-2.66, -2.65 + 1.7 * b, 0.12),
                  V(-0.86 + 1.47 * b, -0.57 + 0.11 * b, 0.13),
                  P,
                  vVal / 0.64
                )
              : bez(
                  P,
                  V(0.82 + 0.94 * b, 2.68 + 0.42 * b, 0.28),
                  V(2.49 + 0.97 * b, 2.93 + 0.34 * b, 0.26),
                  D,
                  (vVal - 0.64) / 0.36
                ),
          u,
          0.027,
          0.13
        )
        const whitecap = smoothArc(u, 0.67, 0.96)
        tint = lerp(lerp(hex('1968b6'), hex('42cde9'), b * 0.83), white, whitecap * (0.27 + 0.43 * b))
        region = b
      } else {
        const j = i % 12
        const vVal = R()
        const start = V(1.9 + j * 0.11, 2.09 + 0.16 * Math.sin(j * 0.27), 0.19)
        curve(
          start,
          plus(start, V(0.54, -0.04, 0.09)),
          plus(start, V(0.33, -0.89, 0.2)),
          plus(start, V(-0.015, -0.74 - 0.05 * j, 0.18)),
          vVal,
          0.034
        )
        tint = lerp(pb, white, R() * 0.56)
        sz *= 0.8
      }
    }

    if (id === 10 && f < 0.78) {
      const arr: readonly [number, number, number, number][] = [
        [-3.1, 1.65, 1.29, -0.49],
        [-1.62, 3.48, 1.37, -0.57],
        [0.02, 4.53, 1.42, -0.49],
        [1.5, 3.24, 1.21, -0.43],
        [3.01, 2.2, 1.23, -0.28]
      ]
      const j = Math.floor(R() * 5)
      const [cx, hVal, width, cz] = arr[j]!
      const u = R()
      const aa = a
      const rr =
        width *
        (1 - u) ** 0.51 *
        (0.82 +
          0.19 * Math.sin(3 * aa + u * 14) +
          0.13 * Math.cos(5 * aa - u * 11) +
          0.085 * Math.sin(11 * aa))
      const x = cx + rr * Math.cos(aa) + 0.27 * Math.sin(u * 6 + j)
      const y = -2.15 + hVal * u + 0.15 * Math.sin(aa * 4 + u * 9) * (1 - u)
      pos = V(x, y, cz + rr * 0.83 * Math.sin(aa))
      dir = V(0.14 * Math.cos(aa * 3 + j), 1, 0.06 * Math.sin(aa))
      tint = lerp(hex('226f82'), pa, 0.15 + 0.43 * (0.5 + 0.5 * Math.cos(aa * 4 + j)))
      if (u > 0.73 + 0.07 * Math.sin(aa * 4 + j)) tint = lerp(pb, white, 0.58)
      region = u * 0.65
    }

    // Same single low-poly, faceted sword archetype for every instance, varied only by transform and metal tint.
    const norm = Math.hypot(dir[0], dir[1], dir[2]) || 1
    const dx = dir[0] / norm
    const dy = dir[1] / norm
    const dz = dir[2] / norm
    const w = 1 + dy
    let qx = dz
    const qy = 0
    let qz = -dx
    let qw = w
    if (w < 0.000001) {
      qx = 0
      qz = 1
      qw = 0
    }
    const n = Math.hypot(qx, qy, qz, qw) || 1
    qx /= n
    qz /= n
    qw /= n
    const roll = U() * 0.42
    const cs = Math.cos(roll / 2)
    const ss = Math.sin(roll / 2)
    q.set([qx * cs - qz * ss, qw * ss, qz * cs + qx * ss, qw * cs], i * 4)
    p.set(pos, i * 3)
    col.set(tint, i * 3)
    v.set([sz, region, heat, R()], i * 4)
  }

  return { p, q, col, v }
}

const glyphCache = new Map<string, string>()

export function glyphSvgDataUrl(id: number, strokeColor: string): string {
  const key = `${id}:${strokeColor}`
  const cached = glyphCache.get(key)
  if (cached) return cached
  let pathStr = ''
  const c = (x: number, y: number, r: number) => `<circle cx="${x}" cy="${y}" r="${r}"/>`
  const l = (d: string) => `<path d="${d}"/>`
  const rot = (d: string, an: number) => `<g transform="rotate(${an} 24 20)">${d}</g>`
  if (id === 0) {
    pathStr = c(24, 20, 2)
    for (let i = 0; i < 6; i++) pathStr += rot(l('M26 20c4-5 13-3 13 4-1 9-16 13-26 5'), i * 60)
  } else if (id === 1) {
    pathStr = c(24, 20, 15) + l('M24 5c-10 0-10 15 0 15s10 15 0 15') + c(24, 12.5, 1.8) + c(24, 27.5, 1.8)
  } else if (id === 2) {
    pathStr = l(
      'M4 31c9 0 5-20 17-19 7 1 5 9 1 13-2 4 2 7 6 3 4-3 3-12 6-15l6-2 5 1-4-4-5 1-3-5 1 6-5-3 2 6c-4 6-4 12-7 14M7 31c7-5 5-17 13-17'
    )
  } else if (id === 3) {
    pathStr = l(
      'M24 12l3 1-2-4-3 1-1 6C15 14 10 7 3 5c4 9 7 12 13 14l-8-2 10 7-4 1 7 2-4 8 7-6 6 6-2-9 8-6-5 1 8-7-7 1c5-4 9-8 12-13-9 3-13 10-19 13z'
    )
  } else if (id === 4) {
    pathStr = l(
      'M24 32C12 30 12 18 24 5c12 13 12 25 0 27Zm0 0C11 33 7 23 7 12c13 2 18 11 17 20Zm0 0c13 1 17-9 17-20-13 2-18 11-17 20ZM24 32C10 35 4 29 2 21c10-1 18 3 22 11Zm0 0c14 3 20-3 22-11-10-1-18 3-22 11Z'
    )
  } else if (id === 5) {
    pathStr = l('m18 4 12 0 10 10v12L30 36H18L8 26V14z') + c(24, 20, 5)
    for (let i = 0; i < 8; i++)
      pathStr += rot(l(i % 2 ? 'M20 9h8m-8 3h3m2 0h3' : 'M20 9h3m2 0h3m-8 3h8'), 45 * i)
  } else if (id === 6) {
    pathStr = l(
      'M23 3l1-2 1 3m-1 0c-2 5-6 7-11 8l2 1h18l2-1c-5-1-9-4-11-8Zm-6 10v4m12-4v4m-6-2c-4 4-9 6-15 7l4 1h22l4-1c-6-1-11-3-15-7Zm-9 9v5m18-5v5M5 31l19-7 19 7-4 1H9zm6 2v3h26v-3M6 37h36'
    )
  } else if (id === 7) {
    for (let i = 0; i < 6; i++) pathStr += rot(l('M24 20V3m0 7 5-4m-5 4-5-4m5 10 7-6m-7 6-7-6'), 60 * i)
  } else if (id === 8) {
    pathStr =
      c(14, 25, 6) +
      c(34, 15, 5) +
      l('M5 27c-8 6 7 6 15 0s5-9-1-7M27 10c-8-1-4 6 5 10s18 2 9-5M19 23c5 0 5-5 10-6')
  } else if (id === 9) {
    pathStr = l(
      'M3 28c16 5 15-18 27-19 5-1 10 3 11 7-3-1-6-3-8-2 4 1 5 5 4 7-3-3-6-4-8-1-5 8-12 14-25 11m1-5c11 1 14-14 22-16m-11 21c7-2 9-8 13-9s7 2 14 2M3 35c12 2 19-6 27-5l12 1'
    )
  } else if (id === 10) {
    pathStr = l(
      'M2 32l11-17 4 6 8-18 10 19 3-7 8 17M16 21l6-7 3 3 3-4 7 9M26 19l-1 7 2 3-1 8m3-17-1 6 2 4-1 6'
    )
  } else if (id === 11) {
    pathStr =
      l('M22 4h4l-1 10 6-7-2 8-4 3v12l-1 6-2-6V18l-4-3-2-8 7 7zm2 13v15') +
      l('M10 25c-6-4 0-9 9-9m10 3c12-1 14-7 9-10')
  } else if (id >= 12) {
    const o = newSample()
    for (let i = 0; i < 450; i += 2) {
      referencePose(id - 12, i, 450, 0.1, 0.46, o)
      const { x, y } = o.position
      pathStr += `<path d="M${(24 + (x - 1.12) * 5).toFixed(1)} ${(20 - (y - 0.22) * 5).toFixed(1)}l.26 -.36"/>`
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 40" fill="none" stroke="${strokeColor}" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round">${pathStr}</svg>`
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  glyphCache.set(key, url)
  return url
}

let cachedAstrolabe: string | null = null

export function astrolabeSvgDataUrl(): string {
  if (cachedAstrolabe) return cachedAstrolabe
  let ring =
    '<circle cx="240" cy="240" r="226"/><circle cx="240" cy="240" r="222" stroke-dasharray="1 9"/><circle cx="240" cy="240" r="200" stroke-dasharray="30 9 1 9" opacity=".35"/>'
  for (let i = 0; i < 96; i++) {
    ring += `<path d="M240 14v${i % 8 === 0 ? 8 : 3}" transform="rotate(${i * 3.75} 240 240)"/>`
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 480" fill="none" stroke="#9bb1b1" stroke-width=".65">${ring}</svg>`
  cachedAstrolabe = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  return cachedAstrolabe
}

let cachedCrest: string | null = null

export function armoryCrestSvgDataUrl(): string {
  if (cachedCrest) return cachedCrest
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 50" fill="none"><path d="M22 2 40 13v23L22 47 4 36V13Z M22 7l13 9v17l-13 9-13-9V16Z" stroke="#dfc79f" stroke-width="1.4"/><path d="m22 9 2 5-1 15 4-3 3 2-7 5-1 5-1-5-7-5 3-2 4 3-1-15Z" fill="#dfc79f"/></svg>'
  cachedCrest = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  return cachedCrest
}
