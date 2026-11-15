<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { instanceClass } from '../../../shared/classes'

const props = withDefaults(
  defineProps<{
    variant?: 'welcome' | 'compact'
    state?: string
    active?: boolean
    paused?: boolean
    boost?: boolean
    instance?: string
  }>(),
  {
    variant: 'welcome',
    state: 'idle',
    active: true,
    paused: false,
    boost: false,
    instance: 'main'
  }
)

const c = (base: string) => instanceClass(base, props.instance)

interface Vec3 {
  x: number
  y: number
  z: number
}

interface TriFace {
  a: number
  b: number
  c: number
  role: 'blade' | 'ridge' | 'guard' | 'hilt' | 'pommel'
}

interface SpiritMist {
  angle: number
  radius: number
  height: number
  size: number
  speed: number
  tone: 'gold' | 'jade' | 'seal'
  phase: number
}

const LIGHT: Vec3 = (() => {
  const lx = 0.44
  const ly = -0.56
  const lz = 0.7
  const len = Math.hypot(lx, ly, lz)
  return { x: lx / len, y: ly / len, z: lz / len }
})()

// Ancient Eight-Faceted Chinese Jian (天枢长锋) built cleanly in local space:
// -y points to the needle tip, +y points through the winged guard, wrapped hilt, and pommel.
function buildAncientJianMesh(): { verts: Vec3[]; faces: TriFace[] } {
  const verts: Vec3[] = []
  const faces: TriFace[] = []

  const addV = (x: number, y: number, z: number): number => {
    verts.push({ x, y, z })
    return verts.length - 1
  }

  const pushTri = (a: number, b: number, cIdx: number, role: TriFace['role']) => {
    faces.push({ a, b, c: cIdx, role })
  }

  // 1. Tip vertex (index 0) & diamond-section blade stations
  const tip = addV(0, -1.78, 0)
  const sections = [
    { y: -1.32, w: 0.088, t: 0.048 },
    { y: -0.62, w: 0.132, t: 0.072 },
    { y: 0.14, w: 0.156, t: 0.084 },
    { y: 0.56, w: 0.172, t: 0.09 }
  ]

  const rings = sections.map((s) => [
    addV(0, s.y, s.t), // 0: front spine
    addV(s.w, s.y, 0), // 1: right edge
    addV(0, s.y, -s.t), // 2: back spine
    addV(-s.w, s.y, 0) // 3: left edge
  ])

  const r0 = rings[0]!
  pushTri(tip, r0[0]!, r0[1]!, 'blade')
  pushTri(tip, r0[1]!, r0[2]!, 'blade')
  pushTri(tip, r0[2]!, r0[3]!, 'blade')
  pushTri(tip, r0[3]!, r0[0]!, 'blade')

  for (let i = 0; i < rings.length - 1; i++) {
    const top = rings[i]!
    const bot = rings[i + 1]!
    for (let k = 0; k < 4; k++) {
      const next = (k + 1) % 4
      const role: TriFace['role'] = k === 0 || k === 3 ? 'ridge' : 'blade'
      pushTri(top[k]!, bot[k]!, bot[next]!, role)
      pushTri(top[k]!, bot[next]!, top[next]!, role)
    }
  }

  // 2. Winged Bronze Guard (云纹山字格) spanning left/right upturned tips
  const gCenterTop = addV(0, 0.54, 0.125)
  const gCenterTopB = addV(0, 0.54, -0.125)
  const gCenterBot = addV(0, 0.72, 0.092)
  const gCenterBotB = addV(0, 0.72, -0.092)
  const gRightUp = addV(0.38, 0.44, 0)
  const gRightLow = addV(0.31, 0.65, 0)
  const gLeftUp = addV(-0.38, 0.44, 0)
  const gLeftLow = addV(-0.31, 0.65, 0)

  pushTri(gCenterTop, gCenterBot, gRightLow, 'guard')
  pushTri(gCenterTop, gRightLow, gRightUp, 'guard')
  pushTri(gCenterTop, gLeftUp, gLeftLow, 'guard')
  pushTri(gCenterTop, gLeftLow, gCenterBot, 'guard')

  pushTri(gCenterTopB, gRightUp, gRightLow, 'guard')
  pushTri(gCenterTopB, gRightLow, gCenterBotB, 'guard')
  pushTri(gCenterTopB, gCenterBotB, gLeftLow, 'guard')
  pushTri(gCenterTopB, gLeftLow, gLeftUp, 'guard')

  // Guard side bevels
  pushTri(gCenterTop, gRightUp, gCenterTopB, 'guard')
  pushTri(gCenterTop, gCenterTopB, gLeftUp, 'guard')
  pushTri(gCenterBot, gRightLow, gCenterBotB, 'guard')
  pushTri(gCenterBot, gCenterBotB, gLeftLow, 'guard')

  // 3. Wrapped Hilt (墨绳剑茎) diamond prism
  const hTop = [addV(0, 0.72, 0.068), addV(0.068, 0.72, 0), addV(0, 0.72, -0.068), addV(-0.068, 0.72, 0)]
  const hBot = [addV(0, 1.18, 0.056), addV(0.056, 1.18, 0), addV(0, 1.18, -0.056), addV(-0.056, 1.18, 0)]
  for (let k = 0; k < 4; k++) {
    const next = (k + 1) % 4
    pushTri(hTop[k]!, hBot[k]!, hBot[next]!, 'hilt')
    pushTri(hTop[k]!, hBot[next]!, hTop[next]!, 'hilt')
  }

  // 4. Jade & Bronze Ring Pommel (玉璧剑首)
  const pTop = [addV(0, 1.18, 0.088), addV(0.11, 1.18, 0), addV(0, 1.18, -0.088), addV(-0.11, 1.18, 0)]
  const pEnd = addV(0, 1.32, 0)
  for (let k = 0; k < 4; k++) {
    const next = (k + 1) % 4
    pushTri(pTop[k]!, pEnd, pTop[next]!, 'pommel')
  }

  return { verts, faces }
}

const JIAN_MESH = buildAncientJianMesh()

const MIST_PARTICLES: SpiritMist[] = Array.from({ length: 34 }, (_, i) => ({
  angle: (i / 34) * Math.PI * 2,
  radius: 1.4 + (i % 7) * 0.28,
  height: ((i % 9) - 4) * 0.26,
  size: 0.9 + (i % 4) * 0.45,
  speed: (0.14 + (i % 5) * 0.06) * (i % 2 === 0 ? 1 : -1),
  tone: i % 5 === 0 ? 'seal' : i % 2 === 0 ? 'gold' : 'jade',
  phase: i * 0.73
}))

const BAGUA_GLYPHS = ['☰', '☱', '☲', '☳', '☴', '☵', '☶', '☷'] as const

const canvas = ref<HTMLCanvasElement | null>(null)
const hovered = ref(false)
const reducedMotion = ref(false)

let rafId = 0
let startTime = 0
let lastTick = 0
let targetTiltX = 0
let targetTiltY = 0
let currentTiltX = 0
let currentTiltY = 0
let mediaQuery: MediaQueryList | null = null
let attrObserver: MutationObserver | null = null
let resizeObserver: ResizeObserver | null = null
let visible = true

interface ThemePalette {
  gold: [number, number, number]
  jade: [number, number, number]
  steelBright: [number, number, number]
  steelDark: [number, number, number]
  seal: [number, number, number]
  ink: [number, number, number]
  paper: [number, number, number]
}

const themeColors = {
  accentA: [212, 175, 99] as [number, number, number],
  accentB: [94, 196, 166] as [number, number, number],
  seal: [201, 76, 56] as [number, number, number],
  text: [239, 233, 218] as [number, number, number]
}

function parseCssHex(value: string, fallback: [number, number, number]): [number, number, number] {
  const clean = value.trim().replace('#', '')
  if (/^[0-9a-fA-F]{6}$/.test(clean)) {
    return [
      Number.parseInt(clean.slice(0, 2), 16),
      Number.parseInt(clean.slice(2, 4), 16),
      Number.parseInt(clean.slice(4, 6), 16)
    ]
  }
  return fallback
}

function readThemePalette() {
  const styles = getComputedStyle(document.documentElement)
  themeColors.accentA = parseCssHex(styles.getPropertyValue('--color-accent-primary'), [212, 175, 99])
  themeColors.accentB = parseCssHex(styles.getPropertyValue('--color-accent-secondary'), [94, 196, 166])
  themeColors.seal = parseCssHex(styles.getPropertyValue('--color-seal'), [201, 76, 56])
  themeColors.text = parseCssHex(styles.getPropertyValue('--color-text-primary'), [239, 233, 218])
}

function rgba(rgb: [number, number, number], alpha: number): string {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`
}

function blend(
  a: [number, number, number],
  b: [number, number, number],
  t: number
): [number, number, number] {
  const k = Math.max(0, Math.min(1, t))
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k)
  ]
}

function rotatePoint(p: Vec3, rx: number, ry: number, rz: number): Vec3 {
  const cy = Math.cos(ry)
  const sy = Math.sin(ry)
  const x1 = p.x * cy + p.z * sy
  const z1 = -p.x * sy + p.z * cy

  const cx = Math.cos(rx)
  const sx = Math.sin(rx)
  const y2 = p.y * cx - z1 * sx
  const z2 = p.y * sx + z1 * cx

  const cz = Math.cos(rz)
  const sz = Math.sin(rz)
  return {
    x: x1 * cz - y2 * sz,
    y: x1 * sz + y2 * cz,
    z: z2
  }
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  }
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1
  return { x: v.x / len, y: v.y / len, z: v.z / len }
}

function isMotionDisabled(): boolean {
  return reducedMotion.value || document.documentElement.dataset.motion === 'off'
}

function renderFrame(timeSec: number) {
  const el = canvas.value
  if (!el) return
  const ctx = el.getContext('2d')
  if (!ctx) return

  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const width = el.clientWidth
  const height = el.clientHeight
  if (!width || !height) return

  const pixelW = Math.round(width * dpr)
  const pixelH = Math.round(height * dpr)
  if (el.width !== pixelW || el.height !== pixelH) {
    el.width = pixelW
    el.height = pixelH
  }

  ctx.save()
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, width, height)

  const compact = props.variant === 'compact'
  const cx = width * 0.5
  const cy = compact ? height * 0.52 : height * 0.51
  const scale = compact ? Math.min(width, height) * 0.25 : Math.min(width, height) * 0.27
  const cameraDist = 6.2

  const isError = props.state === 'error'
  const isConnecting =
    props.state === 'connecting' || props.state === 'verifying' || props.state === 'authenticating'
  const boostFactor = props.paused ? 0.35 : props.boost || hovered.value ? 1.55 : isConnecting ? 1.85 : 1

  const palette: ThemePalette = {
    gold: isError ? blend(themeColors.seal, [235, 165, 92], 0.35) : themeColors.accentA,
    jade: isError ? blend(themeColors.seal, themeColors.text, 0.2) : themeColors.accentB,
    steelBright: blend([210, 232, 228], themeColors.text, 0.55),
    steelDark: [44, 58, 56],
    seal: themeColors.seal,
    ink: [14, 18, 17],
    paper: themeColors.text
  }

  const project = (v: Vec3) => {
    const persp = cameraDist / (cameraDist - v.z * 0.92)
    return {
      x: cx + v.x * scale * persp,
      y: cy + v.y * scale * persp,
      z: v.z,
      persp
    }
  }

  // Ink-wash ambient mountain mist + gold/jade halo behind the sword formation
  const ambientGlow = ctx.createRadialGradient(cx, cy, scale * 0.1, cx, cy, scale * (compact ? 2.8 : 3.2))
  ambientGlow.addColorStop(0, rgba(palette.jade, 0.16))
  ambientGlow.addColorStop(0.45, rgba(palette.gold, 0.1))
  ambientGlow.addColorStop(1, rgba(palette.gold, 0))
  ctx.fillStyle = ambientGlow
  ctx.beginPath()
  ctx.arc(cx, cy, scale * 3.2, 0, Math.PI * 2)
  ctx.fill()

  // Formation plane base inclination: subtle low camera over the Bagua disk behind the sword
  const arrayRx = 1.06 + currentTiltX * 0.42
  const arrayRy = 0.08 + currentTiltY * 0.36
  const arrayRz = -0.14

  const wuxingNodes = [
    { label: '木', rgb: [82, 208, 148] as [number, number, number] },
    { label: '火', rgb: [228, 102, 74] as [number, number, number] },
    { label: '土', rgb: palette.gold },
    { label: '金', rgb: palette.steelBright },
    { label: '水', rgb: palette.jade }
  ]

  // Helper to draw back or front half of horizontal Bagua octagon formation
  const drawBaguaDisk = (frontPass: boolean) => {
    const rOuter = 2.55
    const rInner = 2.12
    const spin = timeSec * 0.2 * boostFactor

    // Octagonal engraved bronze border segments
    ctx.lineCap = 'round'
    for (let i = 0; i < 8; i++) {
      const a0 = spin + (i * Math.PI) / 4
      const a1 = spin + ((i + 1) * Math.PI) / 4
      const p0 = rotatePoint(
        { x: Math.cos(a0) * rOuter, y: 0.42, z: Math.sin(a0) * rOuter },
        arrayRx,
        arrayRy,
        arrayRz
      )
      const p1 = rotatePoint(
        { x: Math.cos(a1) * rOuter, y: 0.42, z: Math.sin(a1) * rOuter },
        arrayRx,
        arrayRy,
        arrayRz
      )
      const midZ = (p0.z + p1.z) * 0.5
      if (frontPass !== midZ >= 0) continue

      const q0 = project(p0)
      const q1 = project(p1)
      ctx.beginPath()
      ctx.moveTo(q0.x, q0.y)
      ctx.lineTo(q1.x, q1.y)
      ctx.strokeStyle = rgba(palette.gold, frontPass ? 0.56 : 0.16)
      ctx.lineWidth = frontPass ? 1.55 : 0.9
      ctx.stroke()

      // Trigram symbols on the 8 compass stations
      if (!compact) {
        const tm = a0 + Math.PI / 8
        const tp = project(
          rotatePoint(
            {
              x: Math.cos(tm) * (rOuter - 0.2),
              y: 0.42,
              z: Math.sin(tm) * (rOuter - 0.2)
            },
            arrayRx,
            arrayRy,
            arrayRz
          )
        )
        const depthAlpha = frontPass ? 0.85 : 0.22
        ctx.font = `600 ${Math.max(10, Math.round(scale * 0.24 * tp.persp))}px "Segoe UI Symbol", "Microsoft YaHei", serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = rgba(palette.gold, depthAlpha)
        ctx.fillText(BAGUA_GLYPHS[i]!, tp.x, tp.y)
      }
    }

    // Inner circular gold/jade formation meridian
    const segs = 56
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2
      const a1 = ((i + 1) / segs) * Math.PI * 2
      const p0 = rotatePoint(
        { x: Math.cos(a0) * rInner, y: 0.42, z: Math.sin(a0) * rInner },
        arrayRx,
        arrayRy,
        arrayRz
      )
      const p1 = rotatePoint(
        { x: Math.cos(a1) * rInner, y: 0.42, z: Math.sin(a1) * rInner },
        arrayRx,
        arrayRy,
        arrayRz
      )
      const midZ = (p0.z + p1.z) * 0.5
      if (frontPass !== midZ >= 0) continue

      const q0 = project(p0)
      const q1 = project(p1)
      ctx.beginPath()
      ctx.moveTo(q0.x, q0.y)
      ctx.lineTo(q1.x, q1.y)
      ctx.strokeStyle = rgba(palette.jade, frontPass ? 0.34 : 0.11)
      ctx.lineWidth = frontPass ? 1.15 : 0.7
      ctx.stroke()
    }

    // WuXing Five-Element star array lines & nodes
    const wSpin = -timeSec * 0.16 * boostFactor
    const nodePts = Array.from({ length: 5 }, (_, idx) => {
      const ang = wSpin + (idx / 5) * Math.PI * 2 - Math.PI / 2
      return rotatePoint(
        { x: Math.cos(ang) * 1.48, y: 0.42, z: Math.sin(ang) * 1.48 },
        arrayRx,
        arrayRy,
        arrayRz
      )
    })

    for (let i = 0; i < 5; i++) {
      const pA = nodePts[i]!
      const pB = nodePts[(i + 2) % 5]!
      const midZ = (pA.z + pB.z) * 0.5
      if (frontPass === midZ >= 0) {
        const qa = project(pA)
        const qb = project(pB)
        ctx.beginPath()
        ctx.moveTo(qa.x, qa.y)
        ctx.lineTo(qb.x, qb.y)
        ctx.strokeStyle = rgba(palette.gold, frontPass ? 0.24 : 0.08)
        ctx.lineWidth = 0.85
        ctx.stroke()
      }
    }

    for (let i = 0; i < 5; i++) {
      const p = nodePts[i]!
      if (frontPass !== p.z >= 0) continue
      const q = project(p)
      const node = wuxingNodes[i]!
      const r = (compact ? 2.3 : 3.2) * q.persp
      ctx.fillStyle = rgba(node.rgb, frontPass ? 0.9 : 0.3)
      ctx.beginPath()
      ctx.arc(q.x, q.y, r, 0, Math.PI * 2)
      ctx.fill()
      if (frontPass) {
        ctx.strokeStyle = rgba(node.rgb, 0.45)
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(q.x, q.y, r + 2.4, 0, Math.PI * 2)
        ctx.stroke()
      }
    }
  }

  // Helper to draw Taiji Yin-Yang seal flat inside the formation center
  const drawTaijiHeart = () => {
    const center = rotatePoint({ x: 0, y: 0.42, z: 0 }, arrayRx, arrayRy, arrayRz)
    const pCenter = project(center)
    const xAxis = rotatePoint({ x: 1, y: 0.42, z: 0 }, arrayRx, arrayRy, arrayRz)
    const zAxis = rotatePoint({ x: 0, y: 0.42, z: 1 }, arrayRx, arrayRy, arrayRz)

    const rx = Math.hypot(xAxis.x - center.x, xAxis.y - center.y) * scale * pCenter.persp * 0.64
    const ry = Math.hypot(zAxis.x - center.x, zAxis.y - center.y) * scale * pCenter.persp * 0.64
    const rot = timeSec * 0.55 * boostFactor

    ctx.save()
    ctx.translate(pCenter.x, pCenter.y)
    ctx.scale(1, Math.max(0.24, ry / Math.max(1, rx)))
    ctx.rotate(rot)

    const r = Math.max(8, rx)
    // Outer jade ring
    ctx.beginPath()
    ctx.arc(0, 0, r, 0, Math.PI * 2)
    ctx.fillStyle = rgba(palette.ink, 0.68)
    ctx.fill()
    ctx.strokeStyle = rgba(palette.gold, 0.42)
    ctx.lineWidth = 1.2
    ctx.stroke()

    // Yang half (luminous pale ivory/jade)
    ctx.beginPath()
    ctx.arc(0, 0, r * 0.94, -Math.PI / 2, Math.PI / 2, false)
    ctx.arc(0, r * 0.47, r * 0.47, Math.PI / 2, -Math.PI / 2, true)
    ctx.arc(0, -r * 0.47, r * 0.47, Math.PI / 2, -Math.PI / 2, false)
    ctx.closePath()
    ctx.fillStyle = rgba(palette.paper, 0.24)
    ctx.fill()

    // Yin & Yang eyes
    ctx.beginPath()
    ctx.arc(0, -r * 0.47, r * 0.14, 0, Math.PI * 2)
    ctx.fillStyle = rgba(palette.gold, 0.85)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(0, r * 0.47, r * 0.14, 0, Math.PI * 2)
    ctx.fillStyle = rgba(palette.jade, 0.85)
    ctx.fill()

    ctx.restore()
  }

  // Orbiting miniature 3D flying spirit sword helper
  const spiritOrbits = compact
    ? [
        { rx: 0.45, rz: 0.42, radius: 1.56, speed: 0.85, count: 3, offset: 0 },
        { rx: -0.52, rz: -0.46, radius: 1.82, speed: -0.68, count: 2, offset: 1.4 }
      ]
    : [
        { rx: 0.42, rz: 0.36, radius: 1.72, speed: 0.78, count: 4, offset: 0 },
        { rx: -0.48, rz: -0.44, radius: 2.02, speed: -0.58, count: 2, offset: 1.1 }
      ]

  const drawSpiritSwordPass = (frontPass: boolean) => {
    const items: Array<{
      pTip: ReturnType<typeof project>
      pWingL: ReturnType<typeof project>
      pWingR: ReturnType<typeof project>
      pBase: ReturnType<typeof project>
      pPommel: ReturnType<typeof project>
      trail: Array<ReturnType<typeof project>>
      depth: number
    }> = []

    for (const orb of spiritOrbits) {
      for (let i = 0; i < orb.count; i++) {
        const theta = orb.offset + (i / orb.count) * Math.PI * 2 + timeSec * orb.speed * boostFactor
        const localPos: Vec3 = {
          x: Math.cos(theta) * orb.radius,
          y: 0.04,
          z: Math.sin(theta) * orb.radius
        }
        const dirSign = orb.speed >= 0 ? 1 : -1
        const localFwd = normalize({
          x: -Math.sin(theta) * dirSign,
          y: 0,
          z: Math.cos(theta) * dirSign
        })
        const worldPos = rotatePoint(localPos, orb.rx + currentTiltX * 0.25, currentTiltY * 0.3, orb.rz)
        if (frontPass !== worldPos.z >= 0) continue

        const worldFwd = normalize(
          rotatePoint(localFwd, orb.rx + currentTiltX * 0.25, currentTiltY * 0.3, orb.rz)
        )
        const upVec: Vec3 = { x: 0, y: 1, z: 0 }
        const right = normalize(cross(worldFwd, upVec))

        const swordLen = compact ? 0.36 : 0.44
        const wingW = swordLen * 0.2
        const tipPos: Vec3 = {
          x: worldPos.x + worldFwd.x * swordLen * 0.65,
          y: worldPos.y + worldFwd.y * swordLen * 0.65,
          z: worldPos.z + worldFwd.z * swordLen * 0.65
        }
        const guardCenter: Vec3 = {
          x: worldPos.x - worldFwd.x * swordLen * 0.12,
          y: worldPos.y - worldFwd.y * swordLen * 0.12,
          z: worldPos.z - worldFwd.z * swordLen * 0.12
        }
        const wingL: Vec3 = {
          x: guardCenter.x - right.x * wingW,
          y: guardCenter.y - right.y * wingW,
          z: guardCenter.z - right.z * wingW
        }
        const wingR: Vec3 = {
          x: guardCenter.x + right.x * wingW,
          y: guardCenter.y + right.y * wingW,
          z: guardCenter.z + right.z * wingW
        }
        const pommelPos: Vec3 = {
          x: worldPos.x - worldFwd.x * swordLen * 0.42,
          y: worldPos.y - worldFwd.y * swordLen * 0.42,
          z: worldPos.z - worldFwd.z * swordLen * 0.42
        }

        const trailPts: Array<ReturnType<typeof project>> = []
        for (let t = 0; t < 7; t++) {
          const backTheta = theta - dirSign * (t * 0.085)
          const tp = rotatePoint(
            { x: Math.cos(backTheta) * orb.radius, y: 0.04, z: Math.sin(backTheta) * orb.radius },
            orb.rx + currentTiltX * 0.25,
            currentTiltY * 0.3,
            orb.rz
          )
          trailPts.push(project(tp))
        }

        items.push({
          pTip: project(tipPos),
          pWingL: project(wingL),
          pWingR: project(wingR),
          pBase: project(guardCenter),
          pPommel: project(pommelPos),
          trail: trailPts,
          depth: worldPos.z
        })
      }
    }

    items.sort((a, b) => a.depth - b.depth)
    for (const s of items) {
      // Sword-Qi trail
      const alphaScale = frontPass ? 0.62 : 0.2
      for (let t = 0; t < s.trail.length - 1; t++) {
        const a = s.trail[t]!
        const b = s.trail[t + 1]!
        const frac = 1 - t / s.trail.length
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.strokeStyle = rgba(palette.jade, alphaScale * frac * 0.72)
        ctx.lineWidth = Math.max(0.6, frac * 2.1)
        ctx.stroke()
      }

      // Blade polygon
      ctx.beginPath()
      ctx.moveTo(s.pTip.x, s.pTip.y)
      ctx.lineTo(s.pWingR.x * 0.45 + s.pBase.x * 0.55, s.pWingR.y * 0.45 + s.pBase.y * 0.55)
      ctx.lineTo(s.pBase.x, s.pBase.y)
      ctx.lineTo(s.pWingL.x * 0.45 + s.pBase.x * 0.55, s.pWingL.y * 0.45 + s.pBase.y * 0.55)
      ctx.closePath()
      ctx.fillStyle = rgba(palette.steelBright, frontPass ? 0.92 : 0.4)
      ctx.fill()
      ctx.strokeStyle = rgba(palette.jade, frontPass ? 0.85 : 0.3)
      ctx.lineWidth = 0.85
      ctx.stroke()

      // Bronze guard + hilt
      ctx.beginPath()
      ctx.moveTo(s.pWingL.x, s.pWingL.y)
      ctx.lineTo(s.pWingR.x, s.pWingR.y)
      ctx.strokeStyle = rgba(palette.gold, frontPass ? 0.95 : 0.38)
      ctx.lineWidth = 1.65
      ctx.stroke()

      ctx.beginPath()
      ctx.moveTo(s.pBase.x, s.pBase.y)
      ctx.lineTo(s.pPommel.x, s.pPommel.y)
      ctx.strokeStyle = rgba(palette.seal, frontPass ? 0.88 : 0.35)
      ctx.lineWidth = 1.4
      ctx.stroke()
    }
  }

  // Pass 1: Back Bagua Ring + Taiji Heart + Back Spirit Swords + Back Mist
  drawBaguaDisk(false)
  drawTaijiHeart()
  drawSpiritSwordPass(false)

  for (const m of MIST_PARTICLES) {
    const ang = m.angle + timeSec * m.speed * boostFactor
    const p = rotatePoint(
      {
        x: Math.cos(ang) * m.radius,
        y: m.height + Math.sin(timeSec * 0.9 + m.phase) * 0.08,
        z: Math.sin(ang) * m.radius
      },
      currentTiltX * 0.4,
      currentTiltY * 0.4,
      0
    )
    if (p.z >= 0) continue
    const q = project(p)
    const cRgb = m.tone === 'seal' ? palette.seal : m.tone === 'jade' ? palette.jade : palette.gold
    ctx.fillStyle = rgba(cRgb, 0.25)
    ctx.beginPath()
    ctx.arc(q.x, q.y, m.size * 0.85, 0, Math.PI * 2)
    ctx.fill()
  }

  // Pass 2: Centerpiece 3D Suspended Ancient Jian (玄天长锋)
  const bobY = Math.sin(timeSec * 1.45) * 0.075
  const jianRx = 0.26 + Math.sin(timeSec * 0.8) * 0.06 + currentTiltX * 0.55
  const jianRy = timeSec * 0.55 * boostFactor + currentTiltY * 1.15
  const jianRz = -0.34 + Math.cos(timeSec * 0.65) * 0.04

  const transformedJian = JIAN_MESH.verts.map((v) => {
    const r = rotatePoint(v, jianRx, jianRy, jianRz)
    return { x: r.x, y: r.y + bobY, z: r.z }
  })

  const projectedJian = transformedJian.map(project)

  const shadedFaces = JIAN_MESH.faces
    .map((f) => {
      const va = transformedJian[f.a]!
      const vb = transformedJian[f.b]!
      const vc = transformedJian[f.c]!
      const normal = normalize(cross(sub(vb, va), sub(vc, va)))
      const avgZ = (va.z + vb.z + vc.z) / 3
      const ndotl = Math.max(0.05, Math.abs(normal.x * LIGHT.x + normal.y * LIGHT.y + normal.z * LIGHT.z))
      return { f, avgZ, ndotl }
    })
    .sort((x, y) => x.avgZ - y.avgZ)

  for (const { f, ndotl } of shadedFaces) {
    const pa = projectedJian[f.a]!
    const pb = projectedJian[f.b]!
    const pc = projectedJian[f.c]!

    let fillRgb: [number, number, number]
    let edgeRgb: [number, number, number]
    let fillAlpha = 0.94

    if (f.role === 'guard' || f.role === 'pommel') {
      fillRgb = blend([92, 68, 28], palette.gold, Math.min(1, 0.35 + ndotl * 0.85))
      edgeRgb = blend(palette.gold, palette.paper, 0.38)
    } else if (f.role === 'hilt') {
      fillRgb = blend(palette.ink, palette.seal, 0.26 + ndotl * 0.34)
      edgeRgb = rgba(palette.gold, 1) ? palette.gold : palette.gold
      fillAlpha = 0.96
    } else if (f.role === 'ridge') {
      fillRgb = blend(palette.steelDark, palette.steelBright, Math.min(1, 0.25 + ndotl * 0.95))
      edgeRgb = blend(palette.jade, palette.steelBright, 0.65)
    } else {
      fillRgb = blend(palette.steelDark, palette.jade, Math.min(1, 0.2 + ndotl * 0.78))
      edgeRgb = palette.jade
    }

    ctx.beginPath()
    ctx.moveTo(pa.x, pa.y)
    ctx.lineTo(pb.x, pb.y)
    ctx.lineTo(pc.x, pc.y)
    ctx.closePath()
    ctx.fillStyle = rgba(fillRgb, fillAlpha)
    ctx.fill()
    ctx.strokeStyle = rgba(edgeRgb, f.role === 'hilt' ? 0.52 : 0.76)
    ctx.lineWidth = f.role === 'guard' ? 1.15 : 0.85
    ctx.stroke()
  }

  // Luminous axial blade spine highlight & Seven-Star runes along the central spine
  const pTip = projectedJian[0]!
  const pBaseSpineF = projectedJian[13]!
  ctx.beginPath()
  ctx.moveTo(pTip.x, pTip.y)
  ctx.lineTo(pBaseSpineF.x, pBaseSpineF.y)
  ctx.strokeStyle = rgba(palette.paper, 0.58)
  ctx.lineWidth = 1.1
  ctx.stroke()

  // Sword tip Qi gleam star
  const tipGlow = ctx.createRadialGradient(pTip.x, pTip.y, 0.5, pTip.x, pTip.y, compact ? 10 : 16)
  tipGlow.addColorStop(0, rgba(palette.paper, 0.92))
  tipGlow.addColorStop(0.38, rgba(palette.jade, 0.52))
  tipGlow.addColorStop(1, rgba(palette.jade, 0))
  ctx.fillStyle = tipGlow
  ctx.beginPath()
  ctx.arc(pTip.x, pTip.y, compact ? 10 : 16, 0, Math.PI * 2)
  ctx.fill()

  // Flowing Crimson Sword Tassel (朱砂剑穗) hanging from pommel tip (last vertex)
  const pommelOrigin = transformedJian[transformedJian.length - 1]!
  const tasselPts: Array<ReturnType<typeof project>> = []
  for (let i = 0; i <= 7; i++) {
    const frac = i / 7
    const sway = Math.sin(timeSec * 3.1 - i * 0.55) * 0.11 * frac
    const drift = Math.cos(timeSec * 2.3 - i * 0.42) * 0.08 * frac
    tasselPts.push(
      project({
        x: pommelOrigin.x + sway + 0.06 * frac,
        y: pommelOrigin.y + frac * 0.56,
        z: pommelOrigin.z + drift
      })
    )
  }
  ctx.beginPath()
  tasselPts.forEach((pt, idx) => {
    if (idx === 0) ctx.moveTo(pt.x, pt.y)
    else ctx.lineTo(pt.x, pt.y)
  })
  ctx.strokeStyle = rgba(palette.seal, 0.92)
  ctx.lineWidth = compact ? 1.8 : 2.3
  ctx.lineCap = 'round'
  ctx.stroke()

  // Pass 3: Front Bagua Disk + Front Spirit Swords + Front Qi Embers
  drawBaguaDisk(true)
  drawSpiritSwordPass(true)

  for (const m of MIST_PARTICLES) {
    const ang = m.angle + timeSec * m.speed * boostFactor
    const p = rotatePoint(
      {
        x: Math.cos(ang) * m.radius,
        y: m.height + Math.sin(timeSec * 0.9 + m.phase) * 0.08,
        z: Math.sin(ang) * m.radius
      },
      currentTiltX * 0.4,
      currentTiltY * 0.4,
      0
    )
    if (p.z < 0) continue
    const q = project(p)
    const cRgb = m.tone === 'seal' ? palette.seal : m.tone === 'jade' ? palette.jade : palette.gold
    const alpha = Math.min(0.88, 0.34 + 0.3 * Math.sin(timeSec * 2.2 + m.phase))
    ctx.fillStyle = rgba(cRgb, alpha)
    ctx.beginPath()
    ctx.arc(q.x, q.y, m.size * q.persp, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.restore()
}

function stopLoop() {
  if (rafId) {
    cancelAnimationFrame(rafId)
    rafId = 0
  }
}

function tick(now: number) {
  rafId = 0
  if (!startTime) startTime = now
  const dt = lastTick ? Math.min(0.05, (now - lastTick) / 1000) : 0.016
  lastTick = now

  const lerp = 1 - Math.exp(-8 * dt)
  currentTiltX += (targetTiltX - currentTiltX) * lerp
  currentTiltY += (targetTiltY - currentTiltY) * lerp

  const timeSec = isMotionDisabled() ? 0 : (now - startTime) / 1000
  renderFrame(timeSec)

  if (props.active && !props.paused && visible && !isMotionDisabled()) {
    rafId = requestAnimationFrame(tick)
  }
}

function ensureRunning() {
  if (!canvas.value) return
  if (isMotionDisabled() || !props.active || props.paused || !visible) {
    stopLoop()
    renderFrame(0)
    return
  }
  if (!rafId) {
    lastTick = performance.now()
    rafId = requestAnimationFrame(tick)
  }
}

function onPointerMove(event: PointerEvent) {
  const el = canvas.value
  if (!el || isMotionDisabled()) return
  const rect = el.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  const nx = ((event.clientX - rect.left) / rect.width - 0.5) * 2
  const ny = ((event.clientY - rect.top) / rect.height - 0.5) * 2
  targetTiltY = Math.max(-0.85, Math.min(0.85, nx * 0.55))
  targetTiltX = Math.max(-0.6, Math.min(0.6, -ny * 0.42))
}

function onPointerLeave() {
  hovered.value = false
  targetTiltX = 0
  targetTiltY = 0
}

function handleVisibilityChange() {
  visible = document.visibilityState !== 'hidden'
  ensureRunning()
}

onMounted(() => {
  readThemePalette()
  mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  reducedMotion.value = mediaQuery.matches
  mediaQuery.addEventListener('change', () => {
    reducedMotion.value = Boolean(mediaQuery?.matches)
    ensureRunning()
  })

  attrObserver = new MutationObserver(() => {
    readThemePalette()
    ensureRunning()
  })
  attrObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-motion', 'data-contrast', 'data-ui-theme', 'style']
  })

  if (canvas.value) {
    resizeObserver = new ResizeObserver(() => {
      renderFrame(startTime ? (performance.now() - startTime) / 1000 : 0)
    })
    resizeObserver.observe(canvas.value)
  }

  document.addEventListener('visibilitychange', handleVisibilityChange)
  ensureRunning()
})

watch(
  () => [props.active, props.paused, props.state, props.boost, props.variant],
  () => ensureRunning()
)

onBeforeUnmount(() => {
  stopLoop()
  attrObserver?.disconnect()
  resizeObserver?.disconnect()
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})
</script>

<template>
  <div
    :class="c('container_workspace_orbit_body_stage')"
    :data-variant="variant"
    :data-state="state"
    aria-hidden="true"
    @pointerenter="hovered = true"
    @pointermove="onPointerMove"
    @pointerleave="onPointerLeave"
  >
    <canvas ref="canvas" :class="c('container_workspace_orbit_body_canvas')" />
  </div>
</template>

<style scoped lang="scss">
[class*='container_workspace_orbit_body_stage'] {
  position: relative;
  display: grid;
  place-items: center;
  width: min(440px, 92vw);
  height: 204px;
  margin: 4px auto 0;
  user-select: none;
  touch-action: none;
  &[data-variant='compact'] {
    width: 108px;
    height: 92px;
    margin: 0;
  }
}
[class*='container_workspace_orbit_body_canvas'] {
  width: 100%;
  height: 100%;
  display: block;
  filter: drop-shadow(0 10px 24px rgba(0, 0, 0, 0.62));
}
[class*='container_workspace_orbit_body_stage']::before {
  content: '';
  position: absolute;
  inset: 12% 20%;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    var(--color-accent-primary-soft),
    var(--color-accent-secondary-soft) 52%,
    transparent 74%
  );
  pointer-events: none;
  z-index: 0;
}
</style>
