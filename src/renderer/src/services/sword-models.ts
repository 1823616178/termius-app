import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

export interface MainSwordModel {
  group: THREE.Group
  bladeMaterial: THREE.MeshStandardMaterial
  goldMaterial: THREE.MeshStandardMaterial
  tasselMaterial: THREE.MeshStandardMaterial
  glow: THREE.Sprite
}

export interface WineBowlModel {
  group: THREE.Group
  liquid: THREE.Mesh<THREE.CircleGeometry, THREE.MeshStandardMaterial>
  ripples: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>[]
  droplets: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>[]
}

function transformed(geometry: THREE.BufferGeometry, x: number, y: number, z: number): THREE.BufferGeometry {
  geometry.translate(x, y, z)
  return geometry.toNonIndexed()
}

export function createFlyingSwordGeometry(): THREE.BufferGeometry {
  const blade = transformed(new THREE.ConeGeometry(0.075, 1.08, 4, 1), 0, 0.34, 0)
  const guard = transformed(new THREE.BoxGeometry(0.34, 0.045, 0.075), 0, -0.22, 0)
  const grip = transformed(new THREE.CylinderGeometry(0.025, 0.032, 0.34, 6), 0, -0.4, 0)
  const pommel = transformed(new THREE.OctahedronGeometry(0.055, 0), 0, -0.6, 0)
  const geometry = mergeGeometries([blade, guard, grip, pommel], false)
  blade.dispose()
  guard.dispose()
  grip.dispose()
  pommel.dispose()
  if (!geometry) throw new Error('Unable to create flying sword geometry')
  geometry.computeVertexNormals()
  return geometry
}

function createBladeGeometry(): THREE.BufferGeometry {
  const positions: number[] = []
  const indices: number[] = []
  const rings = [
    { y: -0.68, w: 0.18, t: 0.095 },
    { y: 0.05, w: 0.145, t: 0.078 },
    { y: 1.35, w: 0.09, t: 0.052 }
  ]

  for (const ring of rings) {
    positions.push(
      0, ring.y, ring.t,
      ring.w, ring.y, 0,
      0, ring.y, -ring.t,
      -ring.w, ring.y, 0
    )
  }
  for (let row = 0; row < rings.length - 1; row++) {
    for (let side = 0; side < 4; side++) {
      const next = (side + 1) % 4
      const a = row * 4 + side
      const b = row * 4 + next
      const c = (row + 1) * 4 + next
      const d = (row + 1) * 4 + side
      indices.push(a, b, d, b, c, d)
    }
  }
  const tip = positions.length / 3
  positions.push(0, 2.3, 0)
  for (let side = 0; side < 4; side++) {
    indices.push(8 + side, 8 + ((side + 1) % 4), tip)
  }

  const indexed = new THREE.BufferGeometry()
  indexed.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  indexed.setIndex(indices)
  const geometry = indexed.toNonIndexed()
  indexed.dispose()
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

export function createMainSword(glowTexture: THREE.Texture): MainSwordModel {
  const group = new THREE.Group()
  const bladeMaterial = new THREE.MeshStandardMaterial({
    color: '#c8d8d4',
    metalness: 0.92,
    roughness: 0.2,
    emissive: '#315f55',
    emissiveIntensity: 0.22,
    flatShading: true
  })
  const goldMaterial = new THREE.MeshStandardMaterial({
    color: '#d4af63',
    metalness: 0.86,
    roughness: 0.28,
    emissive: '#5a3c12',
    emissiveIntensity: 0.18
  })
  const gripMaterial = new THREE.MeshStandardMaterial({ color: '#211916', roughness: 0.72, metalness: 0.18 })
  const tasselMaterial = new THREE.MeshStandardMaterial({
    color: '#b84532',
    roughness: 0.68,
    emissive: '#4b100b',
    emissiveIntensity: 0.25
  })

  group.add(new THREE.Mesh(createBladeGeometry(), bladeMaterial))
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.1, 0.16), goldMaterial)
  guard.position.y = -0.75
  group.add(guard)
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.OctahedronGeometry(0.17, 0), goldMaterial)
    wing.scale.set(1.25, 0.65, 0.6)
    wing.position.set(side * 0.44, -0.69, 0)
    group.add(wing)
  }
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.075, 0.68, 8), gripMaterial)
  grip.position.y = -1.13
  group.add(grip)
  for (let index = 0; index < 7; index++) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.071, 0.008, 4, 8), goldMaterial)
    band.rotation.x = Math.PI / 2
    band.position.y = -0.85 - index * 0.09
    group.add(band)
  }
  const pommel = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.035, 6, 18), goldMaterial)
  pommel.position.y = -1.54
  group.add(pommel)

  const runeGeometry = new THREE.BoxGeometry(0.025, 0.075, 0.012)
  for (let index = 0; index < 7; index++) {
    const rune = new THREE.Mesh(runeGeometry, goldMaterial)
    rune.position.set(0, -0.34 + index * 0.22, 0.092 - index * 0.004)
    rune.rotation.z = index % 2 === 0 ? 0.3 : -0.3
    group.add(rune)
  }

  for (let strand = 0; strand < 3; strand++) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -1.6, 0),
      new THREE.Vector3(0.08 + strand * 0.035, -1.82, 0.03 * strand),
      new THREE.Vector3(-0.04 + strand * 0.06, -2.08, -0.02 * strand),
      new THREE.Vector3(0.13 + strand * 0.04, -2.3, 0.04)
    ])
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.014, 5, false), tasselMaterial))
  }

  const glowMaterial = new THREE.SpriteMaterial({
    map: glowTexture,
    color: '#8ad9c1',
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  })
  const glow = new THREE.Sprite(glowMaterial)
  glow.position.set(0, 0.2, -0.5)
  glow.scale.set(5.2, 5.2, 1)
  group.add(glow)
  return { group, bladeMaterial, goldMaterial, tasselMaterial, glow }
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

export function createGourd(): THREE.Group {
  const group = new THREE.Group()
  const profile = [
    [0, -0.9], [0.28, -0.86], [0.48, -0.63], [0.52, -0.35], [0.43, -0.08],
    [0.25, 0.1], [0.29, 0.28], [0.39, 0.46], [0.37, 0.65], [0.24, 0.82],
    [0.14, 0.9], [0.13, 1.02], [0, 1.04]
  ].map(([x, y]) => new THREE.Vector2(x, y))
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: '#6b3d20',
    roughness: 0.42,
    metalness: 0.28,
    emissive: '#2a1309',
    emissiveIntensity: 0.18
  })
  group.add(new THREE.Mesh(new THREE.LatheGeometry(profile, 40), bodyMaterial))

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
  group.add(new THREE.Mesh(new THREE.TubeGeometry(cordCurve, 20, 0.025, 6, false), cordMaterial))

  const sealMaterial = new THREE.MeshBasicMaterial({
    map: createWineSeal(),
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide
  })
  const seal = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.48), sealMaterial)
  seal.position.set(0, -0.37, 0.48)
  group.add(seal)
  return group
}

export function createWineBowl(): WineBowlModel {
  const group = new THREE.Group()
  const profile = [
    [0.16, -0.32], [0.31, -0.28], [0.47, -0.06], [0.58, 0.24], [0.58, 0.3],
    [0.52, 0.3], [0.45, 0.02], [0.29, -0.2], [0.16, -0.24]
  ].map(([x, y]) => new THREE.Vector2(x, y))
  const clayMaterial = new THREE.MeshStandardMaterial({
    color: '#28201a',
    roughness: 0.5,
    metalness: 0.25,
    side: THREE.DoubleSide
  })
  group.add(new THREE.Mesh(new THREE.LatheGeometry(profile, 48), clayMaterial))
  const lip = new THREE.Mesh(
    new THREE.TorusGeometry(0.55, 0.025, 8, 48),
    new THREE.MeshStandardMaterial({ color: '#ad8045', metalness: 0.75, roughness: 0.32 })
  )
  lip.rotation.x = Math.PI / 2
  lip.position.y = 0.3
  group.add(lip)

  const liquid = new THREE.Mesh(
    new THREE.CircleGeometry(0.49, 48),
    new THREE.MeshStandardMaterial({
      color: '#b66c24',
      emissive: '#8a430e',
      emissiveIntensity: 0.5,
      metalness: 0.2,
      roughness: 0.18,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide
    })
  )
  liquid.rotation.x = -Math.PI / 2
  liquid.position.y = 0.23
  group.add(liquid)

  const ripples: WineBowlModel['ripples'] = []
  for (let index = 0; index < 2; index++) {
    const ripple = new THREE.Mesh(
      new THREE.TorusGeometry(0.18, 0.007, 5, 40),
      new THREE.MeshBasicMaterial({
        color: '#f2c878',
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    )
    ripple.rotation.x = Math.PI / 2
    ripple.position.y = 0.245 + index * 0.003
    group.add(ripple)
    ripples.push(ripple)
  }

  const droplets: WineBowlModel['droplets'] = []
  const dropletGeometry = new THREE.SphereGeometry(0.024, 8, 6)
  const dropletMaterial = new THREE.MeshStandardMaterial({
    color: '#e0a34e',
    emissive: '#b56a20',
    emissiveIntensity: 0.8,
    transparent: true,
    opacity: 0.8
  })
  for (let index = 0; index < 3; index++) {
    const droplet = new THREE.Mesh(dropletGeometry, dropletMaterial)
    group.add(droplet)
    droplets.push(droplet)
  }
  return { group, liquid, ripples, droplets }
}
