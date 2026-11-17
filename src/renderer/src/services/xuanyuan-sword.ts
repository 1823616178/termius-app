import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

export interface MainSwordModel {
  group: THREE.Group
  bladeMaterial: THREE.MeshStandardMaterial
  goldMaterial: THREE.MeshStandardMaterial
  tasselMaterial: THREE.MeshStandardMaterial
  tasselGroup: THREE.Group
  glow: THREE.Sprite
}

export const MAIN_SWORD_PIVOT_Y = -0.72
export const MAIN_SWORD_TIP_Y = 3.65
const BLADE_BASE = MAIN_SWORD_PIVOT_Y
const BLADE_TIP = MAIN_SWORD_TIP_Y
const BLADE_TEXTURE_WIDTH = 0.56
// Han-jian straight blade: edges stay near-parallel, convergence confined to the final ~12% so the point reads short.
const BLADE_RINGS = [
  { y: -0.72, w: 0.26, t: 0.11 },
  { y: -0.3, w: 0.255, t: 0.104 },
  { y: 0.85, w: 0.245, t: 0.096 },
  { y: 2.05, w: 0.235, t: 0.088 },
  { y: 3.12, w: 0.225, t: 0.08 },
  { y: 3.4, w: 0.115, t: 0.042 }
]

function addBladeUV(geometry: THREE.BufferGeometry): void {
  const positions = geometry.getAttribute('position')
  const uv = new Float32Array(positions.count * 2)
  for (let index = 0; index < positions.count; index++) {
    uv[index * 2] = THREE.MathUtils.clamp(0.5 + positions.getX(index) / BLADE_TEXTURE_WIDTH, 0, 1)
    uv[index * 2 + 1] = THREE.MathUtils.clamp(
      (positions.getY(index) - BLADE_BASE) / (BLADE_TIP - BLADE_BASE),
      0,
      1
    )
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
}

export function createXuanyuanBladeGeometry(): THREE.BufferGeometry {
  const positions: number[] = []
  const indices: number[] = []
  for (const ring of BLADE_RINGS) {
    positions.push(
      0,
      ring.y,
      ring.t,
      ring.w * 0.68,
      ring.y,
      ring.t * 0.46,
      ring.w,
      ring.y,
      0,
      ring.w * 0.68,
      ring.y,
      -ring.t * 0.46,
      0,
      ring.y,
      -ring.t,
      -ring.w * 0.68,
      ring.y,
      -ring.t * 0.46,
      -ring.w,
      ring.y,
      0,
      -ring.w * 0.68,
      ring.y,
      ring.t * 0.46
    )
  }
  for (let row = 0; row < BLADE_RINGS.length - 1; row++) {
    for (let side = 0; side < 8; side++) {
      const next = (side + 1) % 8
      const a = row * 8 + side
      const b = row * 8 + next
      const c = (row + 1) * 8 + next
      const d = (row + 1) * 8 + side
      indices.push(a, b, d, b, c, d)
    }
  }
  const tip = positions.length / 3
  positions.push(0, BLADE_TIP, 0)
  const lastRing = (BLADE_RINGS.length - 1) * 8
  for (let side = 0; side < 8; side++) {
    indices.push(lastRing + side, lastRing + ((side + 1) % 8), tip)
  }
  const base = positions.length / 3
  positions.push(0, BLADE_BASE, 0)
  for (let side = 0; side < 8; side++) {
    indices.push(base, (side + 1) % 8, side)
  }

  const indexed = new THREE.BufferGeometry()
  indexed.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  indexed.setIndex(indices)
  const geometry = indexed.toNonIndexed()
  indexed.dispose()
  geometry.computeVertexNormals()
  addBladeUV(geometry)
  geometry.computeBoundingBox()
  return geometry
}

function createBladeEdgeGeometry(side: number): THREE.BufferGeometry {
  const positions: number[] = []
  const indices: number[] = []
  const rings = [...BLADE_RINGS, { y: BLADE_TIP, w: 0, t: 0 }]
  for (const facing of [-1, 1]) {
    const offset = positions.length / 3
    for (const ring of rings) {
      positions.push(
        side * ring.w,
        ring.y,
        facing * 0.003,
        side * ring.w * 0.84,
        ring.y,
        facing * (ring.t * 0.38 + 0.005)
      )
    }
    for (let row = 0; row < rings.length - 1; row++) {
      const a = offset + row * 2
      const b = a + 1
      const c = a + 3
      const d = a + 2
      if (side * facing > 0) indices.push(a, b, d, b, c, d)
      else indices.push(a, d, b, b, d, c)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

export function createXuanyuanGuardGeometry(): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape()
  shape.moveTo(0.07, 0.055)
  shape.bezierCurveTo(0.18, 0.075, 0.3, 0.07, 0.4, 0.045)
  shape.bezierCurveTo(0.47, 0.028, 0.5, -0.012, 0.485, -0.052)
  shape.bezierCurveTo(0.47, -0.095, 0.42, -0.115, 0.37, -0.1)
  shape.bezierCurveTo(0.3, -0.082, 0.22, -0.075, 0.14, -0.09)
  shape.lineTo(0.07, -0.12)
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, {
    steps: 1,
    depth: 0.095,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.018,
    bevelThickness: 0.018,
    curveSegments: 8
  })
  geometry.translate(0, -0.8, -0.0475)
  return geometry
}

function createGuardScroll(side: number, facing: number): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(side * 0.15, -0.762, facing * 0.066),
    new THREE.Vector3(side * 0.27, -0.752, facing * 0.066),
    new THREE.Vector3(side * 0.37, -0.768, facing * 0.062),
    new THREE.Vector3(side * 0.44, -0.802, facing * 0.055),
    new THREE.Vector3(side * 0.465, -0.85, facing * 0.045)
  ])
  return new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.012, 5, false))
}

function createGripHelix(direction: number, material: THREE.Material): THREE.Mesh {
  const points: THREE.Vector3[] = []
  for (let index = 0; index <= 72; index++) {
    const progress = index / 72
    const angle = direction * progress * Math.PI * 9
    const radius = 0.069 + progress * 0.009
    points.push(
      new THREE.Vector3(Math.cos(angle) * radius, -0.89 - progress * 0.58, Math.sin(angle) * radius)
    )
  }
  return new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 72, 0.0075, 5, false),
    material
  )
}

function bladeSurfaceDepth(x: number, y: number): number {
  const nextRing = BLADE_RINGS.findIndex((ring) => ring.y >= y)
  const upperIndex = nextRing <= 0 ? 1 : nextRing
  const lower = BLADE_RINGS[upperIndex - 1]!
  const upper = BLADE_RINGS[Math.min(upperIndex, BLADE_RINGS.length - 1)]!
  const progress = THREE.MathUtils.clamp((y - lower.y) / (upper.y - lower.y), 0, 1)
  const width = THREE.MathUtils.lerp(lower.w, upper.w, progress)
  const depth = THREE.MathUtils.lerp(lower.t, upper.t, progress)
  const distance = Math.abs(x)
  if (distance <= width * 0.68) {
    return depth * (1 - (distance / (width * 0.68)) * 0.54)
  }
  return depth * 0.46 * (1 - (distance - width * 0.68) / (width * 0.32))
}

function surfaceTube(points: THREE.Vector3[], radius: number): THREE.TubeGeometry {
  const path = new THREE.CurvePath<THREE.Vector3>()
  for (let index = 1; index < points.length; index++) {
    path.add(new THREE.LineCurve3(points[index - 1]!, points[index]!))
  }
  return new THREE.TubeGeometry(path, (points.length - 1) * 2, radius, 4, false)
}

export function createXuanyuanBladeOrnaments(
  grooveMaterial: THREE.Material,
  inlayMaterial: THREE.Material
): THREE.Group {
  const group = new THREE.Group()
  group.name = 'XuanyuanBladeOrnaments'
  const grooves: THREE.BufferGeometry[] = []
  const inlays: THREE.BufferGeometry[] = []
  const addPath = (points: ReadonlyArray<readonly [number, number]>, facing: number): void => {
    const surfacePoints = (offset: number): THREE.Vector3[] =>
      points.map(([x, y]) => new THREE.Vector3(x, y, facing * (bladeSurfaceDepth(x, y) + offset)))
    grooves.push(surfaceTube(surfacePoints(0.003), 0.0065))
    inlays.push(surfaceTube(surfacePoints(0.009), 0.0035))
  }

  for (const facing of [-1, 1]) {
    for (const side of [-1, 1]) {
      addPath(
        [
          [side * 0.075, -0.47],
          [side * 0.075, 0.3],
          [side * 0.075, 1.25],
          [side * 0.07, 2.05],
          [side * 0.052, 2.9]
        ],
        facing
      )
    }
    addPath(
      [
        [-0.19, -0.17],
        [-0.125, -0.005],
        [-0.06, -0.115],
        [0.015, 0.09],
        [0.09, -0.05],
        [0.15, 0.025],
        [0.195, -0.17]
      ],
      facing
    )
    for (let river = 0; river < 3; river++) {
      const points: [number, number][] = []
      for (let index = 0; index <= 24; index++) {
        const progress = index / 24
        points.push([
          -0.185 + progress * 0.37,
          -0.28 - river * 0.074 + Math.sin(progress * Math.PI * 3 + river * 0.65) * 0.02
        ])
      }
      addPath(points, facing)
    }

    const sun: [number, number][] = []
    for (let index = 0; index <= 32; index++) {
      const angle = (index / 32) * Math.PI * 2
      sun.push([Math.cos(angle) * 0.047, 2.12 + Math.sin(angle) * 0.047])
    }
    addPath(sun, facing)
    for (let ray = 0; ray < 12; ray++) {
      const angle = (ray / 12) * Math.PI * 2
      addPath(
        [
          [Math.cos(angle) * 0.059, 2.12 + Math.sin(angle) * 0.059],
          [Math.cos(angle) * 0.085, 2.12 + Math.sin(angle) * 0.085]
        ],
        facing
      )
    }
    for (const side of [-1, 1]) {
      const x = side * 0.064
      addPath(
        [
          [x, 2.675],
          [x + 0.019, 2.65],
          [x, 2.625],
          [x - 0.019, 2.65],
          [x, 2.675]
        ],
        facing
      )
    }
  }

  let grooveGeometry: THREE.BufferGeometry | null = null
  let inlayGeometry: THREE.BufferGeometry | null = null
  try {
    grooveGeometry = mergeGeometries(grooves, false)
    inlayGeometry = mergeGeometries(inlays, false)
  } finally {
    grooves.forEach((geometry) => geometry.dispose())
    inlays.forEach((geometry) => geometry.dispose())
  }
  if (!grooveGeometry || !inlayGeometry) {
    grooveGeometry?.dispose()
    inlayGeometry?.dispose()
    throw new Error('Unable to create Xuanyuan blade ornaments')
  }
  group.add(new THREE.Mesh(grooveGeometry, grooveMaterial))
  group.add(new THREE.Mesh(inlayGeometry, inlayMaterial))
  return group
}

export function createXuanyuanInscriptionTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 1536
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Unable to create Xuanyuan sword inscriptions')
  const point = (x: number, y: number): [number, number] => [
    canvas.width * (0.5 + x / BLADE_TEXTURE_WIDTH),
    canvas.height * (1 - (y - BLADE_BASE) / (BLADE_TIP - BLADE_BASE))
  ]
  const path = (points: ReadonlyArray<readonly [number, number]>, color: string, width: number): void => {
    context.beginPath()
    points.forEach(([x, y], index) => {
      const [px, py] = point(x, y)
      if (index === 0) context.moveTo(px, py)
      else context.lineTo(px, py)
    })
    context.strokeStyle = color
    context.lineWidth = width
    context.stroke()
  }

  const metal = context.createLinearGradient(0, 0, canvas.width, 0)
  metal.addColorStop(0, '#c8ad75')
  metal.addColorStop(0.18, '#eee0b9')
  metal.addColorStop(0.5, '#fff7df')
  metal.addColorStop(0.82, '#eee0b9')
  metal.addColorStop(1, '#c8ad75')
  context.fillStyle = metal
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.lineCap = 'round'
  context.lineJoin = 'round'

  for (const side of [-1, 1]) {
    const border = BLADE_RINGS.map((ring) => [side * ring.w * 0.65, ring.y] as const)
    path(border, '#8a6b32', 5)
    path(
      border.map(([x, y]) => [x - side * 0.006, y]),
      '#fff5d4',
      2
    )
  }

  const [sunX, sunY] = point(0, 2.12)
  context.strokeStyle = '#715020'
  context.lineWidth = 4
  context.beginPath()
  context.ellipse(sunX, sunY, 43, 17, 0, 0, Math.PI * 2)
  context.stroke()
  for (let ray = 0; ray < 12; ray++) {
    const angle = (ray / 12) * Math.PI * 2
    context.beginPath()
    context.moveTo(...point(Math.cos(angle) * 0.059, 2.12 + Math.sin(angle) * 0.059))
    context.lineTo(...point(Math.cos(angle) * 0.085, 2.12 + Math.sin(angle) * 0.085))
    context.stroke()
  }

  for (const [x, y] of [
    [-0.064, 2.65],
    [0.064, 2.65],
    [-0.1, 1.9],
    [0.1, 1.9]
  ] as const) {
    const points: [number, number][] = []
    for (let index = 0; index < 10; index++) {
      const angle = -Math.PI / 2 + (index / 10) * Math.PI * 2
      const radius = index % 2 === 0 ? 0.024 : 0.01
      points.push([x + Math.cos(angle) * radius, y + Math.sin(angle) * radius])
    }
    path([...points, points[0]!], '#715020', 3)
  }

  path(
    [
      [-0.2, -0.18],
      [-0.13, -0.02],
      [-0.065, -0.12],
      [0.015, 0.09],
      [0.085, -0.055],
      [0.14, 0.015],
      [0.2, -0.18]
    ],
    '#795725',
    6
  )
  path(
    [
      [-0.15, -0.18],
      [-0.075, -0.08],
      [-0.02, -0.16],
      [0.065, -0.04],
      [0.13, -0.16]
    ],
    '#fff1c2',
    1.5
  )
  for (let river = 0; river < 3; river++) {
    const points: [number, number][] = []
    for (let index = 0; index <= 24; index++) {
      const progress = index / 24
      points.push([
        -0.19 + progress * 0.38,
        -0.29 - river * 0.075 + Math.sin(progress * Math.PI * 3 + river * 0.65) * 0.023
      ])
    }
    path(points, river === 1 ? '#fff0bd' : '#8b692e', 2)
  }

  context.fillStyle = '#473017'
  context.strokeStyle = '#f7e6b7'
  context.lineWidth = 1.4
  context.font = '600 106px KaiTi, STKaiti, serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  for (const [glyph, y] of [
    ['轩', 0.5],
    ['辕', 1.12]
  ] as const) {
    context.strokeText(glyph, ...point(0, y))
    context.fillText(glyph, ...point(0, y))
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export function createMainSword(
  glowTexture: THREE.Texture,
  inscriptionTexture: THREE.Texture
): MainSwordModel {
  const group = new THREE.Group()
  group.name = 'XuanyuanSword'
  const bladeMaterial = new THREE.MeshStandardMaterial({
    color: '#f6e7b6',
    map: inscriptionTexture,
    metalness: 0.86,
    roughness: 0.2,
    emissive: '#af7929',
    emissiveMap: inscriptionTexture,
    emissiveIntensity: 0.24,
    flatShading: true
  })
  const goldMaterial = new THREE.MeshStandardMaterial({
    color: '#d6a74b',
    metalness: 0.9,
    roughness: 0.23,
    emissive: '#67420e',
    emissiveIntensity: 0.22,
    side: THREE.DoubleSide
  })
  const brightGoldMaterial = new THREE.MeshStandardMaterial({
    color: '#ffedbc',
    metalness: 0.92,
    roughness: 0.17,
    emissive: '#c48c2b',
    emissiveIntensity: 0.48,
    side: THREE.DoubleSide
  })
  const bronzeMaterial = new THREE.MeshStandardMaterial({
    color: '#4c3520',
    metalness: 0.8,
    roughness: 0.38
  })
  const gripMaterial = new THREE.MeshStandardMaterial({
    color: '#191414',
    roughness: 0.58,
    metalness: 0.24
  })
  const jadeMaterial = new THREE.MeshStandardMaterial({
    color: '#73d7b2',
    metalness: 0.35,
    roughness: 0.14,
    emissive: '#21745d',
    emissiveIntensity: 0.55
  })
  const tasselMaterial = new THREE.MeshStandardMaterial({
    color: '#b84532',
    roughness: 0.68,
    emissive: '#4b100b',
    emissiveIntensity: 0.25
  })

  const blade = new THREE.Mesh(createXuanyuanBladeGeometry(), bladeMaterial)
  blade.name = 'XuanyuanBlade'
  group.add(blade)
  group.add(createXuanyuanBladeOrnaments(bronzeMaterial, brightGoldMaterial))
  for (const side of [-1, 1]) {
    group.add(new THREE.Mesh(createBladeEdgeGeometry(side), brightGoldMaterial))
  }

  const collarGeometry = new THREE.CylinderGeometry(0.2, 0.2, 0.11, 8)
  const collar = new THREE.Mesh(collarGeometry, goldMaterial)
  collar.position.y = -0.7
  collar.scale.set(1.35, 1, 0.76)
  collar.rotation.y = Math.PI / 8
  group.add(collar)
  for (const y of [-0.605, -0.795]) {
    const collarBand = new THREE.Mesh(new THREE.CylinderGeometry(0.185, 0.185, 0.028, 8), brightGoldMaterial)
    collarBand.position.y = y
    collarBand.scale.set(1.35, 1, 0.76)
    collarBand.rotation.y = Math.PI / 8
    group.add(collarBand)
  }

  const guardGeometry = createXuanyuanGuardGeometry()
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(guardGeometry, goldMaterial)
    wing.scale.x = side
    group.add(wing)
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), brightGoldMaterial)
    tip.position.set(side * 0.478, -0.855, 0)
    group.add(tip)
    for (const facing of [-1, 1]) {
      const scroll = createGuardScroll(side, facing)
      scroll.material = brightGoldMaterial
      group.add(scroll)
      const volute = new THREE.Mesh(
        new THREE.TorusGeometry(0.05, 0.012, 5, 20, Math.PI * 1.65),
        brightGoldMaterial
      )
      volute.position.set(side * 0.44, -0.845, facing * 0.058)
      volute.rotation.z = side * 0.5
      group.add(volute)
    }
  }

  const mask = new THREE.Mesh(new THREE.DodecahedronGeometry(0.14, 0), bronzeMaterial)
  mask.position.set(0, -0.78, 0)
  mask.scale.set(1.1, 0.85, 0.65)
  group.add(mask)
  for (const side of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.18, 5), goldMaterial)
    horn.position.set(side * 0.09, -0.61, 0.015)
    horn.rotation.z = -side * 0.55
    group.add(horn)
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), tasselMaterial)
    eye.position.set(side * 0.071, -0.706, 0.116)
    group.add(eye)
  }
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.018, 6, 4), brightGoldMaterial)
  bezel.position.set(0, -0.82, 0.13)
  bezel.rotation.z = Math.PI / 4
  bezel.scale.y = 1.15
  group.add(bezel)
  const jade = new THREE.Mesh(new THREE.OctahedronGeometry(0.085, 0), jadeMaterial)
  jade.position.set(0, -0.82, 0.145)
  jade.scale.set(0.8, 1.2, 0.65)
  group.add(jade)

  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.066, 0.078, 0.66, 12), gripMaterial)
  grip.position.y = -1.18
  group.add(grip)
  group.add(createGripHelix(1, brightGoldMaterial))
  group.add(createGripHelix(-1, bronzeMaterial))
  for (const y of [-0.88, -1.5]) {
    const gripCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.091, 0.091, 0.06, 12), goldMaterial)
    gripCollar.position.y = y
    group.add(gripCollar)
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.009, 5, 16), brightGoldMaterial)
    band.rotation.x = Math.PI / 2
    band.position.y = y
    group.add(band)
  }

  const pommel = new THREE.Mesh(new THREE.TorusGeometry(0.122, 0.032, 8, 24), goldMaterial)
  pommel.position.y = -1.66
  group.add(pommel)
  const pommelJade = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8), jadeMaterial)
  pommelJade.position.y = -1.66
  group.add(pommelJade)

  const tasselGroup = new THREE.Group()
  tasselGroup.position.set(0, -1.78, 0)
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.052, 10, 8), tasselMaterial)
  knot.scale.y = 1.2
  tasselGroup.add(knot)
  const binding = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 5, 16), brightGoldMaterial)
  binding.rotation.x = Math.PI / 2
  binding.position.y = -0.045
  tasselGroup.add(binding)
  for (let strand = 0; strand < 5; strand++) {
    const offset = (strand - 2) * 0.024
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -0.05, 0),
      new THREE.Vector3(offset + 0.06, -0.2, strand * 0.012),
      new THREE.Vector3(offset - 0.04, -0.43, -0.025 + strand * 0.008),
      new THREE.Vector3(offset + 0.09, -0.66 + Math.abs(strand - 2) * 0.025, 0.04)
    ])
    tasselGroup.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(curve, 20, 0.009 + (strand % 2) * 0.002, 5, false),
        tasselMaterial
      )
    )
  }

  group.add(tasselGroup)
  const glowMaterial = new THREE.SpriteMaterial({
    map: glowTexture,
    color: '#edc677',
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  })
  const glow = new THREE.Sprite(glowMaterial)
  glow.position.set(0, 0.65, -0.5)
  glow.scale.set(5.6, 5.6, 1)
  group.add(glow)
  return { group, bladeMaterial, goldMaterial, tasselMaterial, tasselGroup, glow }
}
