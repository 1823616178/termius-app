<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { instanceClass } from '../../../shared/classes'
import { motionTier } from '../stores/workbench'

type StageState = 'idle' | 'connecting' | 'verifying' | 'authenticating' | 'running' | 'exited' | 'error'

const props = withDefaults(
  defineProps<{
    variant?: 'welcome' | 'compact'
    state?: StageState
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
    instance: 'w0-stage'
  }
)

const stageRef = ref<HTMLElement>()
const canvasRef = ref<HTMLCanvasElement>()
const pointerTilt = ref({ x: 0, y: 0 })

const c = (base: string) => instanceClass(base, props.instance)

interface Vec3 {
  x: number
  y: number
  z: number
}

const PHI = (1 + Math.sqrt(5)) / 2
const RAW_TUPLES: [number, number, number][] = [
  [-1, PHI, 0],
  [1, PHI, 0],
  [-1, -PHI, 0],
  [1, -PHI, 0],
  [0, -1, PHI],
  [0, 1, PHI],
  [0, -1, -PHI],
  [0, 1, -PHI],
  [PHI, 0, -1],
  [PHI, 0, 1],
  [-PHI, 0, -1],
  [-PHI, 0, 1]
]
const RAW_VERTS: Vec3[] = RAW_TUPLES.map(([x, y, z]) => {
  const len = Math.hypot(x, y, z)
  return { x: x / len, y: y / len, z: z / len }
})

const RAW_FACES: [number, number, number][] = [
  [0, 11, 5],
  [0, 5, 1],
  [0, 1, 7],
  [0, 7, 10],
  [0, 10, 11],
  [1, 5, 9],
  [5, 11, 4],
  [11, 10, 2],
  [10, 7, 6],
  [7, 1, 8],
  [3, 9, 4],
  [3, 4, 2],
  [3, 2, 6],
  [3, 6, 8],
  [3, 8, 9],
  [4, 9, 5],
  [2, 4, 11],
  [6, 2, 10],
  [8, 6, 7],
  [9, 8, 1]
]

// Ensure consistent outward triangle winding for accurate back-face culling
const ICO_FACES = RAW_FACES.map(([a, b, cIdx]): [number, number, number] => {
  const va = RAW_VERTS[a]!
  const vb = RAW_VERTS[b]!
  const vc = RAW_VERTS[cIdx]!
  const ab = { x: vb.x - va.x, y: vb.y - va.y, z: vb.z - va.z }
  const ac = { x: vc.x - va.x, y: vc.y - va.y, z: vc.z - va.z }
  const nx = ab.y * ac.z - ab.z * ac.y
  const ny = ab.z * ac.x - ab.x * ac.z
  const nz = ab.x * ac.y - ab.y * ac.x
  const cx = (va.x + vb.x + vc.x) / 3
  const cy = (va.y + vb.y + vc.y) / 3
  const cz = (va.z + vb.z + vc.z) / 3
  return nx * cx + ny * cy + nz * cz >= 0 ? [a, b, cIdx] : [a, cIdx, b]
})

const OCTA_VERTS: Vec3[] = [
  { x: 0, y: 1, z: 0 },
  { x: 1, y: 0, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 0, z: -1 },
  { x: 0, y: -1, z: 0 }
]

const OCTA_FACES: [number, number, number][] = [
  [0, 1, 2],
  [0, 2, 3],
  [0, 3, 4],
  [0, 4, 1],
  [5, 2, 1],
  [5, 3, 2],
  [5, 4, 3],
  [5, 1, 4]
]

interface DustPoint {
  radius: number
  speed: number
  phase: number
  tiltX: number
  tiltZ: number
  size: number
  cyan: boolean
}

const DUST: DustPoint[] = Array.from({ length: 18 }, (_, idx) => ({
  radius: 1.25 + ((idx * 37) % 10) * 0.09,
  speed: (idx % 2 === 0 ? 1 : -1) * (0.22 + (idx % 5) * 0.08),
  phase: idx * 0.71,
  tiltX: 0.4 + ((idx * 19) % 12) * 0.14,
  tiltZ: -0.9 + ((idx * 23) % 15) * 0.12,
  size: 1.1 + (idx % 3) * 0.55,
  cyan: idx % 3 === 0
}))

function rotateVec(v: Vec3, ax: number, ay: number, az = 0): Vec3 {
  let x = v.x
  let y = v.y
  let z = v.z
  if (ax !== 0) {
    const c1 = Math.cos(ax)
    const s1 = Math.sin(ax)
    const ny = y * c1 - z * s1
    const nz = y * s1 + z * c1
    y = ny
    z = nz
  }
  if (ay !== 0) {
    const c2 = Math.cos(ay)
    const s2 = Math.sin(ay)
    const nx = x * c2 + z * s2
    const nz = -x * s2 + z * c2
    x = nx
    z = nz
  }
  if (az !== 0) {
    const c3 = Math.cos(az)
    const s3 = Math.sin(az)
    const nx = x * c3 - y * s3
    const ny = x * s3 + y * c3
    x = nx
    y = ny
  }
  return { x, y, z }
}

function project(v: Vec3, cx: number, cy: number, scaleBase: number, focal: number) {
  const perspective = focal / Math.max(focal * 0.25, focal - v.z)
  return {
    x: cx + v.x * scaleBase * perspective,
    y: cy + v.y * scaleBase * perspective,
    z: v.z,
    scale: perspective
  }
}

const reducedMedia =
  typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : undefined
const prefersReduced = ref(reducedMedia?.matches ?? false)

const effectiveTier = computed(() => (prefersReduced.value ? 'off' : motionTier.value))
const canAnimate = computed(
  () => props.active && !props.paused && effectiveTier.value === 'full' && !documentHidden.value
)

const documentHidden = ref(typeof document !== 'undefined' ? document.hidden : false)

let animId = 0
let observer: ResizeObserver | undefined
let lastTime = 0
let phaseTime = 0.72
let smoothTilt = { x: 0, y: 0 }
let cyanMix = 0

function onVisibilityChange() {
  documentHidden.value = document.hidden
}

function onReducedMotionChange(event: MediaQueryListEvent) {
  prefersReduced.value = event.matches
}

function resizeCanvas() {
  const canvas = canvasRef.value
  const host = stageRef.value
  if (!canvas || !host) return
  const width = Math.max(60, Math.round(host.clientWidth))
  const height = Math.max(60, Math.round(host.clientHeight))
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const targetW = Math.round(width * dpr)
  const targetH = Math.round(height * dpr)
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW
    canvas.height = targetH
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function mixRgb(a: [number, number, number], b: [number, number, number], t: number, alpha: number): string {
  const r = Math.round(lerp(a[0], b[0], t))
  const g = Math.round(lerp(a[1], b[1], t))
  const bl = Math.round(lerp(a[2], b[2], t))
  return `rgba(${r}, ${g}, ${bl}, ${alpha.toFixed(3)})`
}

function renderFrame(timeSec: number) {
  const canvas = canvasRef.value
  const host = stageRef.value
  if (!canvas || !host) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const width = host.clientWidth || canvas.width
  const height = host.clientHeight || canvas.height
  const dpr = canvas.width / Math.max(1, width)

  ctx.save()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)

  const compact = props.variant === 'compact'
  const minDim = Math.min(width, height)
  const coreRadius = compact ? minDim * 0.23 : minDim * 0.265
  const cx = width / 2
  const cy =
    height / 2 + (effectiveTier.value === 'full' ? Math.sin(timeSec * 1.45) * (compact ? 1.5 : 3.2) : 0)
  const focal = compact ? 3.8 : 4.2

  const isConnecting =
    props.state === 'connecting' || props.state === 'authenticating' || props.state === 'running'
  const isError = props.state === 'error'
  const isWarning = props.state === 'verifying'
  const targetCyan = isConnecting ? 0.65 : isWarning ? 0.25 : 0
  cyanMix = effectiveTier.value === 'full' ? lerp(cyanMix, targetCyan, 0.08) : targetCyan

  const accentCssA =
    typeof window !== 'undefined'
      ? getComputedStyle(document.documentElement).getPropertyValue('--color-accent-primary').trim()
      : ''
  const accentCssB =
    typeof window !== 'undefined'
      ? getComputedStyle(document.documentElement).getPropertyValue('--color-accent-secondary').trim()
      : ''

  const parseCssHex = (hex: string, fallback: [number, number, number]): [number, number, number] => {
    const clean = hex.replace(/^#/, '')
    if (/^[0-9a-fA-F]{6}$/.test(clean)) {
      return [
        parseInt(clean.slice(0, 2), 16),
        parseInt(clean.slice(2, 4), 16),
        parseInt(clean.slice(4, 6), 16)
      ]
    }
    return fallback
  }

  const accentA: [number, number, number] = isError
    ? [255, 125, 147]
    : parseCssHex(accentCssA, [167, 139, 250])
  const accentB: [number, number, number] = isWarning
    ? [245, 196, 107]
    : parseCssHex(accentCssB, [91, 220, 244])

  // 1. Volumetric Daoist celestial aurora radial glow behind Bagua-WuXing compass
  const glow = ctx.createRadialGradient(cx, cy, 4, cx, cy, coreRadius * 3.4)
  glow.addColorStop(0, mixRgb(accentA, accentB, cyanMix, 0.28))
  glow.addColorStop(0.45, mixRgb(accentB, accentA, 0.35, 0.11))
  glow.addColorStop(1, 'rgba(11, 13, 18, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, width, height)

  const camTiltX = smoothTilt.y * 0.42
  const camTiltY = smoothTilt.x * 0.5

  const drawBaguaOctagonRing = (
    radius: number,
    tiltX: number,
    tiltY: number,
    tiltZ: number,
    spinAngle: number,
    frontPass: boolean
  ) => {
    const baguaGlyphs = ['☰', '☱', '☲', '☳', '☴', '☵', '☶', '☷']
    const corners: {
      x: number
      y: number
      z: number
      scale: number
      glyph: string
      midX: number
      midY: number
      midZ: number
    }[] = []
    for (let i = 0; i < 8; i += 1) {
      const a0 = (i / 8) * Math.PI * 2 + spinAngle
      const aMid = ((i + 0.5) / 8) * Math.PI * 2 + spinAngle
      const pLocal: Vec3 = { x: Math.cos(a0) * radius, y: 0, z: Math.sin(a0) * radius }
      const mLocal: Vec3 = { x: Math.cos(aMid) * (radius * 0.96), y: 0, z: Math.sin(aMid) * (radius * 0.96) }
      const pRot = rotateVec(rotateVec(pLocal, tiltX, tiltY, tiltZ), camTiltX, camTiltY, 0)
      const mRot = rotateVec(rotateVec(mLocal, tiltX, tiltY, tiltZ), camTiltX, camTiltY, 0)
      const pt = project(pRot, cx, cy, coreRadius, focal)
      const mPt = project(mRot, cx, cy, coreRadius, focal)
      corners.push({
        x: pt.x,
        y: pt.y,
        z: pRot.z,
        scale: pt.scale,
        glyph: baguaGlyphs[i]!,
        midX: mPt.x,
        midY: mPt.y,
        midZ: mRot.z
      })
    }

    for (let i = 0; i < 8; i += 1) {
      const c0 = corners[i]!
      const c1 = corners[(i + 1) % 8]!
      const avgZ = (c0.z + c1.z) / 2
      if (avgZ >= 0 === frontPass) {
        ctx.beginPath()
        ctx.moveTo(c0.x, c0.y)
        ctx.lineTo(c1.x, c1.y)
        ctx.strokeStyle = frontPass
          ? mixRgb(accentA, [255, 224, 150], 0.35, 0.85)
          : mixRgb(accentA, accentB, 0.25, 0.22)
        ctx.lineWidth = frontPass ? (compact ? 1.45 : 2.1) : 1.0
        ctx.stroke()

        // Inner spoke toward sacred Bagua inner rim
        const innerLocal: Vec3 = {
          x: Math.cos((i / 8) * Math.PI * 2 + spinAngle) * (radius * 0.78),
          y: 0,
          z: Math.sin((i / 8) * Math.PI * 2 + spinAngle) * (radius * 0.78)
        }
        const innerRot = rotateVec(rotateVec(innerLocal, tiltX, tiltY, tiltZ), camTiltX, camTiltY, 0)
        const innerPt = project(innerRot, cx, cy, coreRadius, focal)
        ctx.beginPath()
        ctx.moveTo(c0.x, c0.y)
        ctx.lineTo(innerPt.x, innerPt.y)
        ctx.strokeStyle = frontPass
          ? mixRgb(accentB, [255, 255, 255], 0.2, 0.45)
          : mixRgb(accentB, accentA, 0.5, 0.14)
        ctx.lineWidth = compact ? 0.7 : 0.95
        ctx.stroke()
      }
      if (c0.midZ >= 0 === frontPass && !compact) {
        ctx.save()
        ctx.font = `700 ${Math.round(13 * c0.scale)}px "Segoe UI Symbol", "Microsoft YaHei UI", sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = frontPass
          ? mixRgb([255, 232, 163], accentB, cyanMix * 0.3, 0.96)
          : mixRgb(accentA, [180, 190, 220], 0.3, 0.28)
        ctx.fillText(c0.glyph, c0.midX, c0.midY)
        ctx.restore()
      }
    }
  }

  const drawWuxingPentagram = (
    radius: number,
    tiltX: number,
    tiltZ: number,
    spinAngle: number,
    frontPass: boolean
  ) => {
    const wuxingNodes: Array<{ label: string; color: [number, number, number] }> = [
      { label: '木', color: [52, 211, 153] },
      { label: '火', color: [251, 113, 133] },
      { label: '土', color: [251, 191, 36] },
      { label: '金', color: [226, 232, 240] },
      { label: '水', color: [56, 189, 248] }
    ]
    const projectedNodes = wuxingNodes.map((node, idx) => {
      const a = (idx / 5) * Math.PI * 2 + spinAngle
      const local: Vec3 = { x: Math.cos(a) * radius, y: 0, z: Math.sin(a) * radius }
      const rot = rotateVec(rotateVec(local, tiltX, 0, tiltZ), camTiltX, camTiltY, 0)
      const pt = project(rot, cx, cy, coreRadius, focal)
      return { ...node, ...pt, rotZ: rot.z }
    })
    // Star (相克) lines
    for (let i = 0; i < 5; i += 1) {
      const nA = projectedNodes[i]!
      const nB = projectedNodes[(i + 2) % 5]!
      const avgZ = (nA.rotZ + nB.rotZ) / 2
      if (avgZ >= 0 === frontPass) {
        ctx.beginPath()
        ctx.moveTo(nA.x, nA.y)
        ctx.lineTo(nB.x, nB.y)
        ctx.strokeStyle = frontPass
          ? mixRgb(nA.color, nB.color, 0.5, 0.58)
          : mixRgb(nA.color, nB.color, 0.5, 0.16)
        ctx.lineWidth = compact ? 0.75 : 1.15
        ctx.stroke()
      }
    }
    for (const node of projectedNodes) {
      if (node.rotZ >= 0 === frontPass) {
        const r = (compact ? 4.4 : 6.2) * node.scale
        const orbGlow = ctx.createRadialGradient(node.x, node.y, 0.5, node.x, node.y, r * 3.1)
        orbGlow.addColorStop(0, mixRgb(node.color, [255, 255, 255], 0.35, frontPass ? 0.88 : 0.3))
        orbGlow.addColorStop(1, mixRgb(node.color, [0, 0, 0], 0, 0))
        ctx.fillStyle = orbGlow
        ctx.beginPath()
        ctx.arc(node.x, node.y, r * 3.1, 0, Math.PI * 2)
        ctx.fill()

        ctx.beginPath()
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2)
        ctx.fillStyle = mixRgb(node.color, [255, 255, 255], 0.25, frontPass ? 0.92 : 0.4)
        ctx.fill()
        if (!compact) {
          ctx.font = `700 ${Math.max(9, Math.round(9.5 * node.scale))}px "Microsoft YaHei UI", sans-serif`
          ctx.fillStyle = '#090b10'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(node.label, node.x, node.y + 0.5)
        }
      }
    }
  }

  const drawOrbitHalf = (
    rx: number,
    ry: number,
    tiltX: number,
    tiltZ: number,
    satAngle: number,
    frontPass: boolean,
    primaryRing: boolean
  ) => {
    const steps = compact ? 64 : 112
    let activePath = false
    ctx.beginPath()
    for (let i = 0; i <= steps; i += 1) {
      const a = (i / steps) * Math.PI * 2
      const local: Vec3 = { x: Math.cos(a) * rx, y: 0, z: Math.sin(a) * ry }
      const rotated = rotateVec(rotateVec(local, tiltX, 0, tiltZ), camTiltX, camTiltY, 0)
      const isFront = rotated.z >= 0
      if (isFront === frontPass) {
        const pt = project(rotated, cx, cy, coreRadius, focal)
        if (!activePath) {
          ctx.moveTo(pt.x, pt.y)
          activePath = true
        } else {
          ctx.lineTo(pt.x, pt.y)
        }
      } else if (activePath) {
        activePath = false
      }
    }
    ctx.lineCap = 'round'
    if (primaryRing) {
      ctx.strokeStyle = frontPass
        ? mixRgb(accentA, accentB, cyanMix, 0.78)
        : mixRgb(accentA, accentB, cyanMix, 0.22)
      ctx.lineWidth = frontPass ? (compact ? 1.4 : 1.9) : compact ? 1.0 : 1.2
    } else {
      ctx.strokeStyle = frontPass
        ? mixRgb(accentB, accentA, cyanMix * 0.4, 0.58)
        : mixRgb(accentB, accentA, 0.2, 0.16)
      ctx.lineWidth = frontPass ? (compact ? 1.15 : 1.45) : compact ? 0.85 : 1.0
    }
    ctx.stroke()

    // Orbiting 3D satellite + short wake
    const satLocal: Vec3 = { x: Math.cos(satAngle) * rx, y: 0, z: Math.sin(satAngle) * ry }
    const satRot = rotateVec(rotateVec(satLocal, tiltX, 0, tiltZ), camTiltX, camTiltY, 0)
    if (satRot.z >= 0 === frontPass) {
      const pt = project(satRot, cx, cy, coreRadius, focal)
      const satR = (primaryRing ? (compact ? 3.2 : 4.3) : compact ? 2.4 : 3.2) * pt.scale
      const satColor = primaryRing ? accentB : accentA
      const bloom = ctx.createRadialGradient(pt.x, pt.y, 0.5, pt.x, pt.y, satR * 3.8)
      bloom.addColorStop(0, mixRgb(satColor, [255, 255, 255], 0.35, frontPass ? 0.9 : 0.38))
      bloom.addColorStop(1, mixRgb(satColor, [0, 0, 0], 0, 0))
      ctx.fillStyle = bloom
      ctx.beginPath()
      ctx.arc(pt.x, pt.y, satR * 3.8, 0, Math.PI * 2)
      ctx.fill()

      ctx.fillStyle = mixRgb(satColor, [255, 255, 255], frontPass ? 0.55 : 0.1, frontPass ? 0.98 : 0.55)
      ctx.beginPath()
      ctx.arc(pt.x, pt.y, satR, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // 2. Back halves of rings, Bagua octagon, WuXing pentagram & back particles
  const ring1TiltX = 1.06
  const ring1TiltZ = -0.49
  const ring2TiltX = 0.94
  const ring2TiltZ = 0.57
  const baguaTiltX = 1.12
  const baguaTiltZ = -0.26
  const wuxingTiltX = 0.86
  const wuxingTiltZ = 0.44
  drawBaguaOctagonRing(2.68, baguaTiltX, 0.14, baguaTiltZ, timeSec * 0.28, false)
  drawOrbitHalf(2.28, 2.28, ring1TiltX, ring1TiltZ, timeSec * 0.95 + 0.4, false, true)
  drawOrbitHalf(1.94, 1.94, ring2TiltX, ring2TiltZ, -timeSec * 0.72 + 2.4, false, false)
  drawWuxingPentagram(1.66, wuxingTiltX, wuxingTiltZ, -timeSec * 0.42, false)

  // Sparse dust particles
  const dustCount = effectiveTier.value === 'full' ? (compact ? 7 : DUST.length) : 0
  const backDust: { x: number; y: number; r: number; alpha: number; cyan: boolean }[] = []
  const frontDust: { x: number; y: number; r: number; alpha: number; cyan: boolean }[] = []
  for (let i = 0; i < dustCount; i += 1) {
    const d = DUST[i]!
    const angle = d.phase + timeSec * d.speed
    const pos = rotateVec(
      rotateVec({ x: Math.cos(angle) * d.radius, y: 0, z: Math.sin(angle) * d.radius }, d.tiltX, 0, d.tiltZ),
      camTiltX,
      camTiltY,
      0
    )
    const pt = project(pos, cx, cy, coreRadius, focal)
    const item = {
      x: pt.x,
      y: pt.y,
      r: d.size * pt.scale,
      alpha: pos.z >= 0 ? 0.75 : 0.28,
      cyan: d.cyan
    }
    if (pos.z >= 0) frontDust.push(item)
    else backDust.push(item)
  }
  for (const p of backDust) {
    ctx.fillStyle = mixRgb(p.cyan ? accentB : accentA, [255, 255, 255], 0.25, p.alpha)
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
    ctx.fill()
  }

  // 3. Outer Icosahedron vertices transform
  const rotY = timeSec * 0.52 + camTiltY
  const rotX = 0.36 + Math.sin(timeSec * 0.31) * 0.16 + camTiltX
  const icoVerts = RAW_VERTS.map((v) => rotateVec(v, rotX, rotY, 0))
  const icoProj = icoVerts.map((v) => project(v, cx, cy, coreRadius, focal))

  // Light vector from top-left-front
  const lx = -0.45
  const ly = -0.58
  const lz = 0.68

  // 3a. Faint inner-back icosahedron wireframe so glass feels genuinely volumetric
  const backFaces: { idx: [number, number, number]; avgZ: number }[] = []
  const frontFaces: { idx: [number, number, number]; avgZ: number; shade: number }[] = []
  for (const [ia, ib, ic] of ICO_FACES) {
    const va = icoVerts[ia]!
    const vb = icoVerts[ib]!
    const vc = icoVerts[ic]!
    const ab = { x: vb.x - va.x, y: vb.y - va.y, z: vb.z - va.z }
    const ac = { x: vc.x - va.x, y: vc.y - va.y, z: vc.z - va.z }
    const nx = ab.y * ac.z - ab.z * ac.y
    const ny = ab.z * ac.x - ab.x * ac.z
    const nz = ab.x * ac.y - ab.y * ac.x
    const nLen = Math.hypot(nx, ny, nz) || 1
    const nnz = nz / nLen
    const avgZ = (va.z + vb.z + vc.z) / 3
    if (nnz < 0) {
      backFaces.push({ idx: [ia, ib, ic], avgZ })
    } else {
      const shade = Math.max(0, Math.min(1, (nx / nLen) * lx + (ny / nLen) * ly + nnz * lz))
      frontFaces.push({ idx: [ia, ib, ic], avgZ, shade })
    }
  }

  backFaces.sort((a, b) => a.avgZ - b.avgZ)
  for (const f of backFaces) {
    const p1 = icoProj[f.idx[0]]!
    const p2 = icoProj[f.idx[1]]!
    const p3 = icoProj[f.idx[2]]!
    ctx.beginPath()
    ctx.moveTo(p1.x, p1.y)
    ctx.lineTo(p2.x, p2.y)
    ctx.lineTo(p3.x, p3.y)
    ctx.closePath()
    ctx.strokeStyle = mixRgb(accentA, accentB, cyanMix, 0.14)
    ctx.lineWidth = 0.75
    ctx.stroke()
  }

  // 3b. Counter-rotating glowing inner octahedron core inside the crystal
  const innerVerts = OCTA_VERTS.map((v) =>
    rotateVec({ x: v.x * 0.48, y: v.y * 0.48, z: v.z * 0.48 }, -rotX * 1.15, -rotY * 1.35 + 0.5, 0.24)
  )
  const innerProj = innerVerts.map((v) => project(v, cx, cy, coreRadius, focal))
  const innerFaces: { idx: [number, number, number]; avgZ: number; shade: number }[] = []
  for (const [ia, ib, ic] of OCTA_FACES) {
    const va = innerVerts[ia]!
    const vb = innerVerts[ib]!
    const vc = innerVerts[ic]!
    const ab = { x: vb.x - va.x, y: vb.y - va.y, z: vb.z - va.z }
    const ac = { x: vc.x - va.x, y: vc.y - va.y, z: vc.z - va.z }
    const nx = ab.y * ac.z - ab.z * ac.y
    const ny = ab.z * ac.x - ab.x * ac.z
    const nz = ab.x * ac.y - ab.y * ac.x
    const nLen = Math.hypot(nx, ny, nz) || 1
    if (nz > 0) {
      const shade = Math.max(0.1, Math.min(1, (nx / nLen) * lx + (ny / nLen) * ly + (nz / nLen) * lz))
      innerFaces.push({ idx: [ia, ib, ic], avgZ: (va.z + vb.z + vc.z) / 3, shade })
    }
  }
  innerFaces.sort((a, b) => a.avgZ - b.avgZ)
  for (const f of innerFaces) {
    const p1 = innerProj[f.idx[0]]!
    const p2 = innerProj[f.idx[1]]!
    const p3 = innerProj[f.idx[2]]!
    ctx.beginPath()
    ctx.moveTo(p1.x, p1.y)
    ctx.lineTo(p2.x, p2.y)
    ctx.lineTo(p3.x, p3.y)
    ctx.closePath()
    ctx.fillStyle = mixRgb(accentB, [232, 236, 244], f.shade * 0.55, 0.35 + f.shade * 0.45)
    ctx.fill()
    ctx.strokeStyle = mixRgb([255, 255, 255], accentB, 0.65, 0.65)
    ctx.lineWidth = 0.9
    ctx.stroke()
  }

  // 3b-center. Rotating 3D Taiji Yin-Yang Sphere Core inside crystal lattice
  const taijiR = coreRadius * (compact ? 0.31 : 0.36)
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(timeSec * 1.15)
  ctx.beginPath()
  ctx.arc(0, 0, taijiR, 0, Math.PI * 2)
  ctx.fillStyle = mixRgb([244, 246, 255], accentB, 0.18, 0.92)
  ctx.fill()
  // Dark Yin half
  ctx.beginPath()
  ctx.arc(0, 0, taijiR, Math.PI / 2, (Math.PI * 3) / 2)
  ctx.arc(0, -taijiR / 2, taijiR / 2, -Math.PI / 2, Math.PI / 2)
  ctx.arc(0, taijiR / 2, taijiR / 2, (Math.PI * 3) / 2, Math.PI / 2, true)
  ctx.closePath()
  ctx.fillStyle = mixRgb([12, 14, 24], accentA, 0.22, 0.95)
  ctx.fill()
  // Yin-Yang eyes
  ctx.beginPath()
  ctx.arc(0, -taijiR / 2, taijiR * 0.16, 0, Math.PI * 2)
  ctx.fillStyle = mixRgb([12, 14, 24], accentA, 0.25, 0.96)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(0, taijiR / 2, taijiR * 0.16, 0, Math.PI * 2)
  ctx.fillStyle = mixRgb([248, 250, 255], accentB, 0.2, 0.96)
  ctx.fill()
  ctx.strokeStyle = mixRgb(accentB, [255, 255, 255], 0.4, 0.72)
  ctx.lineWidth = compact ? 0.9 : 1.35
  ctx.beginPath()
  ctx.arc(0, 0, taijiR, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()

  // 3c. Translucent specular front facets of outer Icosahedron
  frontFaces.sort((a, b) => a.avgZ - b.avgZ)
  for (const f of frontFaces) {
    const p1 = icoProj[f.idx[0]]!
    const p2 = icoProj[f.idx[1]]!
    const p3 = icoProj[f.idx[2]]!
    ctx.beginPath()
    ctx.moveTo(p1.x, p1.y)
    ctx.lineTo(p2.x, p2.y)
    ctx.lineTo(p3.x, p3.y)
    ctx.closePath()
    const fillAlpha = 0.24 + f.shade * 0.26
    ctx.fillStyle = mixRgb([24, 21, 45], accentA, f.shade * 0.72 + cyanMix * 0.18, fillAlpha)
    ctx.fill()
    ctx.strokeStyle = mixRgb(accentA, [235, 238, 255], f.shade * 0.52, 0.42 + f.shade * 0.48)
    ctx.lineWidth = compact ? 0.95 : 1.15
    ctx.stroke()
  }

  // 4. Front halves of 3D orbits, WuXing pentagram, Bagua octagon & foreground particles
  drawWuxingPentagram(1.66, wuxingTiltX, wuxingTiltZ, -timeSec * 0.42, true)
  drawOrbitHalf(1.94, 1.94, ring2TiltX, ring2TiltZ, -timeSec * 0.72 + 2.4, true, false)
  drawOrbitHalf(2.28, 2.28, ring1TiltX, ring1TiltZ, timeSec * 0.95 + 0.4, true, true)
  drawBaguaOctagonRing(2.68, baguaTiltX, 0.14, baguaTiltZ, timeSec * 0.28, true)
  for (const p of frontDust) {
    ctx.fillStyle = mixRgb(p.cyan ? accentB : accentA, [255, 255, 255], 0.35, p.alpha)
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.restore()
}

function tick(now: number) {
  if (!canAnimate.value) {
    animId = 0
    return
  }
  const dt = lastTime > 0 ? Math.min(0.05, (now - lastTime) / 1000) : 0.016
  lastTime = now
  const speed = props.boost
    ? 1.8
    : props.state === 'connecting' || props.state === 'authenticating'
      ? 1.55
      : 1
  phaseTime += dt * speed
  smoothTilt.x = lerp(smoothTilt.x, pointerTilt.value.x, 0.1)
  smoothTilt.y = lerp(smoothTilt.y, pointerTilt.value.y, 0.1)
  renderFrame(phaseTime)
  animId = requestAnimationFrame(tick)
}

function syncLoop() {
  if (animId) {
    cancelAnimationFrame(animId)
    animId = 0
  }
  lastTime = 0
  resizeCanvas()
  if (canAnimate.value) {
    animId = requestAnimationFrame(tick)
  } else if (props.active) {
    smoothTilt = { ...pointerTilt.value }
    renderFrame(phaseTime)
  }
}

function onPointerMove(event: PointerEvent) {
  if (effectiveTier.value === 'off' || props.variant !== 'welcome') return
  const rect = stageRef.value?.getBoundingClientRect()
  if (!rect || rect.width <= 0 || rect.height <= 0) return
  pointerTilt.value = {
    x: ((event.clientX - rect.left) / rect.width - 0.5) * 2,
    y: ((event.clientY - rect.top) / rect.height - 0.5) * 2
  }
  if (!canAnimate.value && props.active) {
    smoothTilt = { ...pointerTilt.value }
    renderFrame(phaseTime)
  }
}

function onPointerLeave() {
  pointerTilt.value = { x: 0, y: 0 }
  if (!canAnimate.value && props.active) {
    smoothTilt = { x: 0, y: 0 }
    renderFrame(phaseTime)
  }
}

onMounted(() => {
  resizeCanvas()
  observer = new ResizeObserver(() => {
    resizeCanvas()
    if (!canAnimate.value && props.active) renderFrame(phaseTime)
  })
  if (stageRef.value) observer.observe(stageRef.value)
  document.addEventListener('visibilitychange', onVisibilityChange)
  reducedMedia?.addEventListener('change', onReducedMotionChange)
  syncLoop()
})

watch([canAnimate, () => props.active, () => props.state, effectiveTier], () => {
  syncLoop()
})

onBeforeUnmount(() => {
  if (animId) cancelAnimationFrame(animId)
  observer?.disconnect()
  document.removeEventListener('visibilitychange', onVisibilityChange)
  reducedMedia?.removeEventListener('change', onReducedMotionChange)
})
</script>

<template>
  <div
    ref="stageRef"
    :class="c('container_workspace_orbit3d_stage_base')"
    :data-variant="variant"
    @pointermove="onPointerMove"
    @pointerleave="onPointerLeave"
  >
    <div :class="c('container_workspace_orbit3d_stage_halo')" aria-hidden="true" />
    <canvas ref="canvasRef" :class="c('container_workspace_orbit3d_stage_canvas')" aria-hidden="true" />
  </div>
</template>

<style scoped lang="scss">
.container_workspace_orbit3d_stage_base {
  position: relative;
  display: grid;
  place-items: center;
  perspective: 960px;
  transform-style: preserve-3d;
  &[data-variant='welcome'] {
    width: 348px;
    height: 238px;
    margin: 16px 0 8px;
  }
  &[data-variant='compact'] {
    width: 128px;
    height: 98px;
  }
}
.container_workspace_orbit3d_stage_halo {
  position: absolute;
  inset: 14px 36px;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    rgba(167, 139, 250, 0.14),
    rgba(91, 220, 244, 0.05) 52%,
    transparent 72%
  );
  transform: translateZ(-28px);
  pointer-events: none;
}
.container_workspace_orbit3d_stage_canvas {
  width: 100%;
  height: 100%;
  display: block;
  transform: translateZ(12px);
}
</style>
