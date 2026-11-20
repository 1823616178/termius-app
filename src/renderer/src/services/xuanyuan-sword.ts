import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

export interface MainSwordModel {
  group: THREE.Group
  bladeMaterial: THREE.MeshStandardMaterial
  silverMaterial: THREE.MeshStandardMaterial
  scabbard: THREE.Group
  tasselMaterial: THREE.MeshStandardMaterial
  tasselGroup: THREE.Group
  glow: THREE.Sprite
  bladeAura: THREE.Group
  auraMaterial: THREE.MeshBasicMaterial
  inlayMaterial: THREE.MeshStandardMaterial
  bladeFlow: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
  flowHead: THREE.Uniform<number>
  flowColor: THREE.Uniform<THREE.Color>
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
  // Swept openwork: one tine turns back toward the grip, the other catches the blade.
  shape.moveTo(0.045, 0.13)
  shape.bezierCurveTo(0.24, 0.17, 0.47, -0.02, 0.33, -0.23)
  shape.bezierCurveTo(0.58, -0.16, 0.6, -0.45, 0.47, -0.72)
  shape.bezierCurveTo(0.48, -0.48, 0.29, -0.49, 0.24, -0.31)
  shape.bezierCurveTo(0.17, -0.43, 0.19, -0.54, 0.23, -0.61)
  shape.bezierCurveTo(0.04, -0.48, 0.15, -0.26, 0.04, -0.18)
  shape.closePath()
  const piercing = new THREE.Path()
  piercing.moveTo(0.19, -0.025)
  piercing.bezierCurveTo(0.36, -0.045, 0.32, -0.19, 0.27, -0.24)
  piercing.bezierCurveTo(0.29, -0.13, 0.19, -0.12, 0.19, -0.025)
  shape.holes.push(piercing)
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

function createGuardScroll(side: number, facing: number, material: THREE.Material): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(side * 0.08, -0.72, facing * 0.081),
    new THREE.Vector3(side * 0.25, -0.79, facing * 0.081),
    new THREE.Vector3(side * 0.37, -1.03, facing * 0.081),
    new THREE.Vector3(side * 0.49, -1.12, facing * 0.078),
    new THREE.Vector3(side * 0.5, -1.34, facing * 0.07)
  ])
  return new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.015, 5, false), material)
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
    grooves.push(surfaceTube(surfacePoints(0.003), 0.011))
    inlays.push(surfaceTube(surfacePoints(0.012), 0.006))
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
  metal.addColorStop(0, '#e6ffff')
  metal.addColorStop(0.17, '#a5d4dc')
  metal.addColorStop(0.21, '#547483')
  metal.addColorStop(0.47, '#a5c8d0')
  metal.addColorStop(0.5, '#c8edff')
  metal.addColorStop(0.53, '#718e9b')
  metal.addColorStop(0.79, '#3d6171')
  metal.addColorStop(0.83, '#98c4d2')
  metal.addColorStop(1, '#f0ffff')
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

function createScabbard(
  silver: THREE.Material,
  polished: THREE.Material,
  shadow: THREE.Material,
  sapphire: THREE.Material
): THREE.Group {
  const scabbard = new THREE.Group()
  scabbard.name = 'SilverCloudScabbard'
  // The throat folds inward. Its cavity clears both faces of the assembled blade.
  const profile = [
    [0.207, 0.21],
    [0.211, 0.012],
    [0.26, 0],
    [0.29, 0.055],
    [0.28, 0.17],
    [0.235, 0.38],
    [0.218, 0.94],
    [0.197, 3.25],
    [0.267, 3.58],
    [0.241, 3.89],
    [0.167, 4.24],
    [0.07, 4.45],
    [0, 4.54]
  ] as const
  const body = new THREE.Mesh(
    new THREE.LatheGeometry(
      profile.map(([r, y]) => new THREE.Vector2(r, y)),
      20
    ),
    silver
  )
  body.scale.z = 0.56
  scabbard.add(body)

  for (const [y, r] of [
    [0.06, 0.28],
    [0.21, 0.268],
    [0.95, 0.218],
    [3.29, 0.205],
    [3.87, 0.221]
  ] as const) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(r, 0.018, 5, 36), polished)
    band.position.y = y
    band.rotation.x = Math.PI / 2
    band.scale.y = 0.56
    scabbard.add(band)
  }
  const wire = (coords: number[][], material: THREE.Material, width: number): void => {
    const curve = new THREE.CatmullRomCurve3(coords.map(([x, y, z]) => new THREE.Vector3(x, y, z)))
    scabbard.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, width, 5, false), material))
  }
  for (const face of [-1, 1]) {
    for (const side of [-1, 1]) {
      for (const y of [0.27, 3.46]) {
        wire(
          [
            [side * 0.08, y, face * 0.15],
            [side * 0.22, y + 0.12, face * 0.093],
            [side * 0.246, y + 0.31, face * 0.055],
            [side * 0.155, y + 0.45, face * 0.105],
            [side * 0.128, y + 0.33, face * 0.13],
            [side * 0.178, y + 0.27, face * 0.115]
          ],
          polished,
          0.021
        )
      }
      wire(
        [
          [0, 0.19, 0.17 * face],
          [side * 0.19, 0.42, 0.091 * face],
          [side * 0.12, 0.72, 0.12 * face],
          [0, 1.02, 0.139 * face]
        ],
        polished,
        0.024
      )
      wire(
        [
          [side * 0.11, 0.86, 0.117 * face],
          [side * 0.085, 1.7, 0.115 * face],
          [side * 0.078, 2.8, 0.108 * face],
          [side * 0.13, 3.35, 0.104 * face],
          [side * 0.175, 3.57, 0.092 * face],
          [0, 4.33, 0.075 * face]
        ],
        shadow,
        0.013
      )
      wire(
        [
          [0, 3.27, 0.136 * face],
          [side * 0.125, 3.53, 0.12 * face],
          [side * 0.079, 3.81, 0.127 * face],
          [0, 4.07, 0.118 * face]
        ],
        polished,
        0.025
      )
    }
    for (const [y, z] of [
      [0.49, 0.134],
      [3.68, 0.142]
    ] as const) {
      const bezel = new THREE.Mesh(new THREE.OctahedronGeometry(0.119), shadow)
      bezel.scale.set(0.98, 1.66, 0.3)
      bezel.position.set(0, y, face * z)
      scabbard.add(bezel)
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.088), sapphire)
      gem.position.set(0, y, face * (z + 0.033))
      gem.scale.set(1, 1.64, 0.58)
      scabbard.add(gem)
    }
  }
  return scabbard
}

export function createMainSword(
  glowTexture: THREE.Texture,
  inscriptionTexture: THREE.Texture
): MainSwordModel {
  const group = new THREE.Group()
  group.name = 'XuanyuanSword'
  const bladeMaterial = new THREE.MeshStandardMaterial({
    color: '#ebf4ff',
    map: inscriptionTexture,
    metalness: 0.86,
    roughness: 0.2,
    emissive: '#7594b6',
    emissiveMap: inscriptionTexture,
    emissiveIntensity: 0.24,
    flatShading: true
  })
  const silverMaterial = new THREE.MeshStandardMaterial({
    color: '#d5e4f4',
    metalness: 0.9,
    roughness: 0.23,
    emissive: '#557092',
    emissiveIntensity: 0.22,
    side: THREE.DoubleSide
  })
  const polishedSilver = new THREE.MeshStandardMaterial({
    color: '#edf7ff',
    metalness: 0.92,
    roughness: 0.17,
    emissive: '#94b6d5',
    emissiveIntensity: 0.48,
    side: THREE.DoubleSide
  })
  const gunmetal = new THREE.MeshStandardMaterial({
    color: '#425570',
    metalness: 0.8,
    roughness: 0.38
  })
  const gripMaterial = new THREE.MeshStandardMaterial({
    color: '#adc1d8',
    roughness: 0.58,
    metalness: 0.24
  })
  const jadeMaterial = new THREE.MeshStandardMaterial({
    color: '#6faeff',
    metalness: 0.35,
    roughness: 0.14,
    emissive: '#285dd4',
    emissiveIntensity: 0.55
  })
  const tasselMaterial = new THREE.MeshStandardMaterial({
    color: '#d9ecff',
    roughness: 0.68,
    emissive: '#4a6b89',
    emissiveIntensity: 0.25
  })

  const blade = new THREE.Mesh(createXuanyuanBladeGeometry(), bladeMaterial)
  blade.name = 'XuanyuanBlade'
  const bladeAssembly = new THREE.Group()
  bladeAssembly.scale.set(0.69, 1, 0.8)
  group.add(bladeAssembly)
  bladeAssembly.add(blade)
  const flowHead = new THREE.Uniform(-1)
  const flowColor = new THREE.Uniform(new THREE.Color('#84e8db'))
  const bladeFlow = new THREE.Mesh(
    blade.geometry,
    new THREE.ShaderMaterial({
      uniforms: { flowHead, flowColor },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      vertexShader: `
      varying vec2 bladeUv;
      void main() {
        bladeUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
      fragmentShader: `
      uniform float flowHead;
      uniform vec3 flowColor;
      varying vec2 bladeUv;
      void main() {
        float across = abs(bladeUv.x - 0.5);
        float distanceToHead = flowHead - bladeUv.y - across * 0.13;
        float front = exp(-distanceToHead * distanceToHead * 529.0);
        float wake = smoothstep(-0.02, 0.04, distanceToHead) * (1.0 - smoothstep(0.04, 0.42, distanceToHead));
        float spine = 1.0 - smoothstep(0.016, 0.09, across);
        float strength = front * (0.36 + 0.64 * spine) + wake * (0.14 + 0.82 * spine);
        gl_FragColor = vec4(mix(flowColor, vec3(0.82, 0.94, 1.0), front * spine), strength);
        #include <colorspace_fragment>
      }
    `
    })
  )
  bladeAssembly.add(bladeFlow)
  const inlayMaterial = polishedSilver.clone()
  bladeAssembly.add(createXuanyuanBladeOrnaments(gunmetal, inlayMaterial))
  for (const side of [-1, 1]) {
    bladeAssembly.add(new THREE.Mesh(createBladeEdgeGeometry(side), polishedSilver))
  }

  const collarGeometry = new THREE.CylinderGeometry(0.2, 0.2, 0.11, 8)
  const collar = new THREE.Mesh(collarGeometry, silverMaterial)
  collar.position.y = -0.7
  collar.scale.set(1.35, 1, 0.76)
  collar.rotation.y = Math.PI / 8
  group.add(collar)
  for (const y of [-0.605, -0.795]) {
    const collarBand = new THREE.Mesh(new THREE.CylinderGeometry(0.185, 0.185, 0.028, 8), polishedSilver)
    collarBand.position.y = y
    collarBand.scale.set(1.35, 1, 0.76)
    collarBand.rotation.y = Math.PI / 8
    group.add(collarBand)
  }

  const guardGeometry = createXuanyuanGuardGeometry()
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(guardGeometry, silverMaterial)
    wing.scale.x = side
    group.add(wing)
    for (const facing of [-1, 1]) {
      group.add(createGuardScroll(side, facing, polishedSilver))
      const inset = new THREE.Mesh(new THREE.OctahedronGeometry(0.08), jadeMaterial)
      inset.position.set(side * 0.36, -1.065, facing * 0.071)
      inset.scale.set(0.65, 1.45, 0.42)
      inset.rotation.z = side * 0.4
      group.add(inset)
    }
  }

  const mask = new THREE.Mesh(new THREE.DodecahedronGeometry(0.14, 0), gunmetal)
  mask.position.set(0, -0.78, 0)
  mask.scale.set(1.1, 0.85, 0.65)
  group.add(mask)
  for (const side of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.18, 5), silverMaterial)
    horn.position.set(side * 0.09, -0.61, 0.015)
    horn.rotation.z = -side * 0.55
    group.add(horn)
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), tasselMaterial)
    eye.position.set(side * 0.071, -0.706, 0.116)
    group.add(eye)
  }
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.018, 6, 4), polishedSilver)
  bezel.position.set(0, -0.82, 0.13)
  bezel.rotation.z = Math.PI / 4
  bezel.scale.y = 1.15
  group.add(bezel)
  const jade = new THREE.Mesh(new THREE.OctahedronGeometry(0.085, 0), jadeMaterial)
  jade.position.set(0, -0.82, 0.145)
  jade.scale.set(1.25, 1.75, 0.8)
  group.add(jade)

  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.066, 0.078, 0.66, 12), gripMaterial)
  grip.position.y = -1.18
  group.add(grip)
  group.add(createGripHelix(1, polishedSilver))
  group.add(createGripHelix(-1, gunmetal))
  for (const y of [-0.88, -1.5]) {
    const gripCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.091, 0.091, 0.06, 12), silverMaterial)
    gripCollar.position.y = y
    group.add(gripCollar)
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.009, 5, 16), polishedSilver)
    band.rotation.x = Math.PI / 2
    band.position.y = y
    group.add(band)
  }

  const pommel = new THREE.Mesh(new THREE.TorusGeometry(0.122, 0.032, 8, 24), silverMaterial)
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
  const binding = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 5, 16), polishedSilver)
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

  for (const detail of tasselGroup.children) {
    detail.position.x += 0.32
    detail.position.y -= 0.46
  }
  const cord = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.13, -0.07, 0.05),
    new THREE.Vector3(0.28, -0.27, 0.07),
    new THREE.Vector3(0.32, -0.46, 0)
  ])
  tasselGroup.add(new THREE.Mesh(new THREE.TubeGeometry(cord, 24, 0.012, 5, false), polishedSilver))
  const bead = new THREE.Mesh(new THREE.OctahedronGeometry(0.067), jadeMaterial)
  bead.position.set(0.32, -0.42, 0)
  tasselGroup.add(bead)
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
  // Two tapered ribbons lift from the guard and converge on the point in blade-local space.
  const bladeAura = new THREE.Group()
  const auraMaterial = new THREE.MeshBasicMaterial({
    color: '#ffe199',
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  })
  const vertices: number[] = []
  const indices: number[] = []
  for (let i = 0; i <= 80; i++) {
    const u = i / 80
    const envelope = Math.sin(u * Math.PI)
    const radius = 0.37 * (1 - u) + 0.36 * envelope
    const angle = u * Math.PI * 2.7
    const y = THREE.MathUtils.lerp(BLADE_BASE, BLADE_TIP, u)
    for (const side of [-1, 1]) {
      const r = radius + side * envelope * 0.021
      vertices.push(r * Math.cos(angle), y, r * Math.sin(angle))
    }
    const a = i * 2
    if (i < 80) indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3)
  }
  const auraGeometry = new THREE.BufferGeometry()
  auraGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  auraGeometry.setIndex(indices)
  for (const angle of [0, Math.PI]) {
    const ribbon = new THREE.Mesh(auraGeometry, auraMaterial)
    ribbon.rotation.y = angle
    bladeAura.add(ribbon)
  }
  group.add(bladeAura)
  return {
    group,
    bladeMaterial,
    silverMaterial,
    tasselMaterial,
    scabbard: createScabbard(silverMaterial, polishedSilver, gunmetal, jadeMaterial),
    tasselGroup,
    glow,
    bladeAura,
    auraMaterial,
    inlayMaterial,
    bladeFlow,
    flowHead,
    flowColor
  }
}
