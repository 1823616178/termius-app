import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

export interface CrackBranch {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  delay: number
  material: THREE.MeshBasicMaterial
}

export interface DebrisShard {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
  angle: number
  radius: number
  baseY: number
  lift: number
  spin: number
  scale: number
  glowing: boolean
}

export interface GroundImpactModel {
  group: THREE.Group
  plinth: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
  plinthMaterial: THREE.MeshStandardMaterial
  crackDisc: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  crackDiscMaterial: THREE.MeshBasicMaterial
  craterGlow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  craterGlowMaterial: THREE.MeshBasicMaterial
  fissures: CrackBranch[]
  debris: DebrisShard[]
  shockwave: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  shockwaveMaterial: THREE.MeshBasicMaterial
  stoneMaterial: THREE.MeshStandardMaterial
  crystalMaterial: THREE.MeshStandardMaterial
}

export interface GourdModel {
  group: THREE.Group
  body: THREE.Mesh<THREE.LatheGeometry, THREE.MeshStandardMaterial>
  cork: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial>
  cord: THREE.Mesh<THREE.TubeGeometry, THREE.MeshStandardMaterial>
  seal: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  sealMaterial: THREE.MeshBasicMaterial
  vapor: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>
  vaporMaterial: THREE.PointsMaterial
  pourRibbon: THREE.Mesh<THREE.TubeGeometry, THREE.MeshBasicMaterial>
  pourMaterial: THREE.MeshBasicMaterial
}

function transformed(geometry: THREE.BufferGeometry, x: number, y: number, z: number): THREE.BufferGeometry {
  geometry.translate(x, y, z)
  return geometry.index ? geometry.toNonIndexed() : geometry
}

export function createFlyingSwordGeometry(): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(0.052, 0.062, 0.8, 4, 1)
  body.scale(1, 1, 0.42)
  const point = new THREE.ConeGeometry(0.052, 0.12, 4, 1)
  point.scale(1, 1, 0.42)
  const guard = new THREE.BoxGeometry(0.22, 0.035, 0.07)
  const grip = new THREE.CylinderGeometry(0.022, 0.028, 0.3, 6)
  const pommel = new THREE.CylinderGeometry(0.042, 0.034, 0.05, 8)
  const geometry = mergeGeometries(
    [
      transformed(body, 0, 0.28, 0),
      transformed(point, 0, 0.74, 0),
      transformed(guard, 0, -0.135, 0),
      transformed(grip, 0, -0.3, 0),
      transformed(pommel, 0, -0.475, 0)
    ],
    false
  )
  body.dispose()
  point.dispose()
  guard.dispose()
  grip.dispose()
  pommel.dispose()
  if (!geometry) throw new Error('Unable to create flying sword geometry')
  geometry.computeVertexNormals()
  return geometry
}

export function createGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Unable to create glow texture')
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64)
  gradient.addColorStop(0, 'rgba(255,255,255,0.95)')
  gradient.addColorStop(0.16, 'rgba(255,255,255,0.5)')
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.1)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 128, 128)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export function createShockwaveTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Unable to create shockwave texture')
  const gradient = context.createRadialGradient(128, 128, 60, 128, 128, 127)
  gradient.addColorStop(0, 'rgba(255,255,255,0)')
  gradient.addColorStop(0.76, 'rgba(255,255,255,0.03)')
  gradient.addColorStop(0.86, 'rgba(255,255,255,0.92)')
  gradient.addColorStop(0.91, 'rgba(255,255,255,0.4)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 256, 256)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export function createPillarTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 256
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Unable to create sword pillar texture')
  const horizontal = context.createLinearGradient(0, 0, 128, 0)
  horizontal.addColorStop(0, 'rgba(255,255,255,0)')
  horizontal.addColorStop(0.35, 'rgba(255,255,255,0.22)')
  horizontal.addColorStop(0.5, 'rgba(255,255,255,0.95)')
  horizontal.addColorStop(0.65, 'rgba(255,255,255,0.22)')
  horizontal.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = horizontal
  context.fillRect(0, 0, 128, 256)

  context.globalCompositeOperation = 'destination-in'
  const vertical = context.createLinearGradient(0, 0, 0, 256)
  vertical.addColorStop(0, 'rgba(255,255,255,0)')
  vertical.addColorStop(0.28, 'rgba(255,255,255,0.85)')
  vertical.addColorStop(0.5, 'rgba(255,255,255,1)')
  vertical.addColorStop(0.75, 'rgba(255,255,255,0.8)')
  vertical.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = vertical
  context.fillRect(0, 0, 128, 256)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export function createFlareTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Unable to create flare texture')
  context.translate(64, 64)
  for (const angle of [0, Math.PI / 2]) {
    context.save()
    context.rotate(angle)
    context.scale(1, 0.065)
    const ray = context.createRadialGradient(0, 0, 0, 0, 0, 62)
    ray.addColorStop(0, 'rgba(255,255,255,0.95)')
    ray.addColorStop(0.28, 'rgba(255,255,255,0.34)')
    ray.addColorStop(1, 'rgba(255,255,255,0)')
    context.fillStyle = ray
    context.beginPath()
    context.arc(0, 0, 62, 0, Math.PI * 2)
    context.fill()
    context.restore()
  }
  const core = context.createRadialGradient(0, 0, 0, 0, 0, 14)
  core.addColorStop(0, 'rgba(255,255,255,1)')
  core.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = core
  context.beginPath()
  context.arc(0, 0, 14, 0, Math.PI * 2)
  context.fill()
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export function createGlyphSprite(glyph: string, color: string): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Unable to create formation glyph')
  context.font = '64px "Segoe UI Symbol", "Microsoft YaHei", serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillStyle = color
  context.shadowColor = color
  context.shadowBlur = 12
  context.fillText(glyph, 64, 68)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  })
  const sprite = new THREE.Sprite(material)
  sprite.scale.setScalar(0.42)
  return sprite
}

function createWineSeal(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Unable to create gourd seal')
  context.translate(128, 128)
  context.rotate(-0.08)
  context.strokeStyle = 'rgba(224,177,99,0.82)'
  context.lineWidth = 5
  context.strokeRect(-72, -72, 144, 144)
  context.font = '112px KaiTi, STKaiti, serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillStyle = 'rgba(237,199,130,0.9)'
  context.fillText('酒', 0, 8)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export function createGourd(): GourdModel {
  const group = new THREE.Group()
  const profile = [
    [0, -0.9],
    [0.28, -0.86],
    [0.48, -0.63],
    [0.52, -0.35],
    [0.43, -0.08],
    [0.25, 0.1],
    [0.29, 0.28],
    [0.39, 0.46],
    [0.37, 0.65],
    [0.24, 0.82],
    [0.14, 0.9],
    [0.13, 1.02],
    [0, 1.04]
  ].map(([x, y]) => new THREE.Vector2(x, y))
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: '#6b3d20',
    roughness: 0.42,
    metalness: 0.28,
    emissive: '#2a1309',
    emissiveIntensity: 0.18
  })
  const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 40), bodyMaterial)
  group.add(body)

  const goldMaterial = new THREE.MeshStandardMaterial({ color: '#b78b48', metalness: 0.82, roughness: 0.3 })
  const cork = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.14, 0.22, 12),
    new THREE.MeshStandardMaterial({ color: '#34231a', roughness: 0.9 })
  )
  cork.position.y = 1.11
  group.add(cork)
  for (const y of [0.89, 1]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.018, 6, 20), goldMaterial)
    ring.rotation.x = Math.PI / 2
    ring.position.y = y
    group.add(ring)
  }

  const cordMaterial = new THREE.MeshStandardMaterial({ color: '#a54130', roughness: 0.72 })
  const cordCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.1, 0.96, 0),
    new THREE.Vector3(0.48, 0.83, 0.04),
    new THREE.Vector3(0.5, 0.42, 0.08),
    new THREE.Vector3(0.28, 0.18, 0.12)
  ])
  const cord = new THREE.Mesh(new THREE.TubeGeometry(cordCurve, 20, 0.025, 6, false), cordMaterial)
  group.add(cord)

  const sealMaterial = new THREE.MeshBasicMaterial({
    map: createWineSeal(),
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide
  })
  const seal = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.48), sealMaterial)
  seal.position.set(0, -0.37, 0.535)
  group.add(seal)

  const vaporCount = 24
  const vaporGeometry = new THREE.BufferGeometry()
  vaporGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(vaporCount * 3), 3).setUsage(THREE.DynamicDrawUsage)
  )
  const vaporMaterial = new THREE.PointsMaterial({
    color: '#e8c07a',
    size: 0.05,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  })
  const vapor = new THREE.Points(vaporGeometry, vaporMaterial)
  vapor.frustumCulled = false
  group.add(vapor)

  const pourCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 1.2, 0),
    new THREE.Vector3(0.5, 1.35, 0.1),
    new THREE.Vector3(1.1, 1.0, 0.2),
    new THREE.Vector3(1.6, 0.5, 0.25)
  ])
  const pourMaterial = new THREE.MeshBasicMaterial({
    color: '#f2c878',
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  })
  const pourRibbon = new THREE.Mesh(new THREE.TubeGeometry(pourCurve, 24, 0.035, 6, false), pourMaterial)
  group.add(pourRibbon)

  return { group, body, cork, cord, seal, sealMaterial, vapor, vaporMaterial, pourRibbon, pourMaterial }
}

function modelSeed(index: number, salt: number): number {
  const value = Math.sin((index + 1) * 19.137 + salt * 61.91) * 43758.5453
  return value - Math.floor(value)
}

function createCrackMapTexture(): THREE.CanvasTexture {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Unable to create crack map texture')

  const cx = size / 2
  const cy = size / 2

  // Scorched crater aura base
  const haze = context.createRadialGradient(cx, cy, 8, cx, cy, 232)
  haze.addColorStop(0, 'rgba(255,255,255,0.92)')
  haze.addColorStop(0.16, 'rgba(255,255,255,0.48)')
  haze.addColorStop(0.42, 'rgba(255,255,255,0.16)')
  haze.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = haze
  context.fillRect(0, 0, size, size)

  // Concentric fracture rings
  context.lineCap = 'round'
  for (const [radius, width, alpha] of [
    [44, 3.2, 0.72],
    [92, 2.2, 0.45],
    [146, 1.4, 0.25]
  ] as const) {
    context.beginPath()
    for (let seg = 0; seg <= 36; seg++) {
      const a = (seg / 36) * Math.PI * 2
      const wobble = 1 + (modelSeed(seg, Math.round(radius)) - 0.5) * 0.16
      const px = cx + Math.cos(a) * radius * wobble
      const py = cy + Math.sin(a) * radius * wobble
      if (seg === 0) context.moveTo(px, py)
      else context.lineTo(px, py)
    }
    context.strokeStyle = `rgba(255,255,255,${alpha})`
    context.lineWidth = width
    context.stroke()
  }

  // Sharp hairline radial cracks
  for (let branch = 0; branch < 14; branch++) {
    const baseA = (branch / 14) * Math.PI * 2 + (modelSeed(branch, 3) - 0.5) * 0.25
    let x = cx + Math.cos(baseA) * 10
    let y = cy + Math.sin(baseA) * 10
    let angle = baseA
    const steps = 8
    for (let step = 0; step < steps; step++) {
      const dist = 16 + modelSeed(branch * 10 + step, 7) * 18
      angle += (modelSeed(branch * 10 + step, 9) - 0.5) * 0.65
      const nx = x + Math.cos(angle) * dist
      const ny = y + Math.sin(angle) * dist
      const t = step / steps
      context.beginPath()
      context.moveTo(x, y)
      context.lineTo(nx, ny)
      context.strokeStyle = `rgba(255,255,255,${(1 - t) * 0.85})`
      context.lineWidth = (1 - t * 0.75) * 3.8
      context.stroke()
      x = nx
      y = ny
    }
  }

  // Radial mask to guarantee zero quad edge clipping
  context.globalCompositeOperation = 'destination-in'
  const mask = context.createRadialGradient(cx, cy, 40, cx, cy, 244)
  mask.addColorStop(0, 'rgba(255,255,255,1)')
  mask.addColorStop(0.68, 'rgba(255,255,255,0.65)')
  mask.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = mask
  context.fillRect(0, 0, size, size)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function createCraterPlinthGeometry(): THREE.BufferGeometry {
  const segs = 20
  const radii = [0.06, 0.24, 0.48, 0.78, 1.15]
  const baseHeights = [-0.08, -0.02, 0.08, 0.01, -0.18]
  const positions: number[] = []
  const indices: number[] = []

  for (let rIdx = 0; rIdx < radii.length; rIdx++) {
    const r = radii[rIdx]!
    const h = baseHeights[rIdx]!
    for (let s = 0; s < segs; s++) {
      const angle = (s / segs) * Math.PI * 2
      const jitterR = r * (1 + (modelSeed(s, rIdx + 1) - 0.5) * (rIdx >= 2 ? 0.24 : 0.1))
      const jitterY = h + (modelSeed(s, rIdx + 11) - 0.5) * (rIdx === 2 ? 0.09 : 0.04)
      positions.push(Math.cos(angle) * jitterR, jitterY, Math.sin(angle) * jitterR)
    }
  }

  for (let rIdx = 0; rIdx < radii.length - 1; rIdx++) {
    for (let s = 0; s < segs; s++) {
      const next = (s + 1) % segs
      const a = rIdx * segs + s
      const b = rIdx * segs + next
      const c = (rIdx + 1) * segs + next
      const d = (rIdx + 1) * segs + s
      indices.push(a, d, b, b, d, c)
    }
  }

  const indexed = new THREE.BufferGeometry()
  indexed.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  indexed.setIndex(indices)
  const geometry = indexed.toNonIndexed()
  indexed.dispose()
  geometry.computeVertexNormals()
  return geometry
}

function pushCrackRibbon(
  positions: number[],
  colors: number[],
  startX: number,
  startZ: number,
  baseAngle: number,
  length: number,
  halfWidthStart: number,
  seedId: number,
  steps: number
): { midX: number; midZ: number; midAngle: number } {
  let x = startX
  let z = startZ
  let angle = baseAngle
  const stepLen = length / steps
  let prevLx = 0
  let prevLz = 0
  let prevRx = 0
  let prevRz = 0
  let prevY = 0
  let prevBright = 1
  let midX = startX
  let midZ = startZ
  let midAngle = baseAngle

  for (let step = 0; step <= steps; step++) {
    const t = step / steps
    const r = Math.hypot(x, z)
    const y = r < 0.52 ? 0.085 - Math.abs(r - 0.36) * 0.05 : 0.028
    const halfW = halfWidthStart * (1 - t * 0.88)
    const nx = -Math.sin(angle)
    const nz = Math.cos(angle)
    const lx = x - nx * halfW
    const lz = z - nz * halfW
    const rx = x + nx * halfW
    const rz = z + nz * halfW
    const bright = Math.pow(1 - t * 0.72, 1.2)

    if (step > 0) {
      positions.push(
        prevLx,
        prevY,
        prevLz,
        prevRx,
        prevY,
        prevRz,
        lx,
        y,
        lz,
        prevRx,
        prevY,
        prevRz,
        rx,
        y,
        rz,
        lx,
        y,
        lz
      )
      for (const b of [prevBright, prevBright, bright, prevBright, bright, bright]) {
        colors.push(b, b * 0.96, b * 0.88)
      }
    }

    if (step === Math.floor(steps / 2)) {
      midX = x
      midZ = z
      midAngle = angle
    }
    prevLx = lx
    prevLz = lz
    prevRx = rx
    prevRz = rz
    prevY = y
    prevBright = bright
    angle += (modelSeed(seedId * 17 + step, 23) - 0.5) * 0.52
    x += Math.cos(angle) * stepLen
    z += Math.sin(angle) * stepLen
  }

  return { midX, midZ, midAngle }
}

function createCrackBranchGeometry(branchIndex: number, length: number): THREE.BufferGeometry {
  const positions: number[] = []
  const colors: number[] = []
  const baseAngle = (branchIndex / 10) * Math.PI * 2 + (modelSeed(branchIndex, 5) - 0.5) * 0.24
  const startR = 0.08
  const mid = pushCrackRibbon(
    positions,
    colors,
    Math.cos(baseAngle) * startR,
    Math.sin(baseAngle) * startR,
    baseAngle,
    length,
    0.048,
    branchIndex + 1,
    7
  )
  const forkAngle = mid.midAngle + (branchIndex % 2 === 0 ? 0.52 : -0.52)
  pushCrackRibbon(positions, colors, mid.midX, mid.midZ, forkAngle, length * 0.45, 0.026, branchIndex + 31, 4)

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  return geometry
}

export function createGroundImpact(
  shockwaveTexture: THREE.Texture,
  glowTexture: THREE.Texture
): GroundImpactModel {
  const group = new THREE.Group()
  const plinthMaterial = new THREE.MeshStandardMaterial({
    color: '#131817',
    roughness: 0.72,
    metalness: 0.28,
    emissive: '#1e3e34',
    emissiveIntensity: 0.25,
    flatShading: true
  })
  const plinth = new THREE.Mesh(createCraterPlinthGeometry(), plinthMaterial)
  group.add(plinth)

  const crackDiscMaterial = new THREE.MeshBasicMaterial({
    map: createCrackMapTexture(),
    color: '#d4af63',
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending
  })
  const crackDisc = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 5.6), crackDiscMaterial)
  crackDisc.rotation.x = -Math.PI / 2
  crackDisc.position.y = 0.015
  group.add(crackDisc)

  const craterGlowMaterial = new THREE.MeshBasicMaterial({
    map: glowTexture,
    color: '#fff1cc',
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending
  })
  const craterGlow = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 1.35), craterGlowMaterial)
  craterGlow.rotation.x = -Math.PI / 2
  craterGlow.position.y = 0.03
  group.add(craterGlow)

  const fissures: CrackBranch[] = []
  for (let index = 0; index < 10; index++) {
    const length = 1.65 + modelSeed(index, 19) * 1.15
    const material = new THREE.MeshBasicMaterial({
      color: '#ffffff',
      vertexColors: true,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
    const mesh = new THREE.Mesh(createCrackBranchGeometry(index, length), material)
    group.add(mesh)
    fissures.push({
      mesh,
      delay: (index % 3) * 0.14 + modelSeed(index, 29) * 0.12,
      material
    })
  }

  const stoneMaterial = new THREE.MeshStandardMaterial({
    color: '#1b2220',
    roughness: 0.65,
    metalness: 0.35,
    emissive: '#22453b',
    emissiveIntensity: 0.25,
    flatShading: true,
    transparent: true,
    opacity: 0
  })
  const crystalMaterial = new THREE.MeshStandardMaterial({
    color: '#e8d7a6',
    roughness: 0.3,
    metalness: 0.7,
    emissive: '#d4af63',
    emissiveIntensity: 0.9,
    flatShading: true,
    transparent: true,
    opacity: 0
  })
  const shardGeometry = new THREE.OctahedronGeometry(0.08, 0)
  const debris: DebrisShard[] = []
  for (let index = 0; index < 18; index++) {
    const glowing = index % 4 === 0
    const mesh = new THREE.Mesh(shardGeometry, glowing ? crystalMaterial : stoneMaterial)
    const angle = (index / 18) * Math.PI * 2 + modelSeed(index, 37) * 0.4
    const radius = 0.28 + modelSeed(index, 41) * 1.55
    const scale = (glowing ? 0.52 : 0.72) + modelSeed(index, 43) * 0.95
    mesh.scale.set(scale * 1.1, scale * 0.55, scale * 0.85)
    mesh.visible = false
    group.add(mesh)
    debris.push({
      mesh,
      angle,
      radius,
      baseY: 0.06 + modelSeed(index, 47) * 0.08,
      lift: 0.35 + modelSeed(index, 53) * 0.95,
      spin: (modelSeed(index, 59) - 0.5) * 6,
      scale,
      glowing
    })
  }

  const shockwaveMaterial = new THREE.MeshBasicMaterial({
    map: shockwaveTexture,
    color: '#d4af63',
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  })
  const shockwave = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shockwaveMaterial)
  shockwave.rotation.x = -Math.PI / 2
  shockwave.position.y = 0.04
  shockwave.visible = false
  group.add(shockwave)

  return {
    group,
    plinth,
    plinthMaterial,
    crackDisc,
    crackDiscMaterial,
    craterGlow,
    craterGlowMaterial,
    fissures,
    debris,
    shockwave,
    shockwaveMaterial,
    stoneMaterial,
    crystalMaterial
  }
}
