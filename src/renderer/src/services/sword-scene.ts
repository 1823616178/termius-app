import * as THREE from 'three'
import {
  createFlareTexture,
  createFlyingSwordGeometry,
  createGlowTexture,
  createGlyphSprite,
  createGourd,
  createGroundImpact,
  createPillarTexture,
  createShockwaveTexture,
  createSkySwordGeometry,
  type GourdModel,
  type GroundImpactModel
} from './sword-models'
import {
  createMainSword,
  createXuanyuanInscriptionTexture,
  MAIN_SWORD_PIVOT_Y,
  MAIN_SWORD_TIP_Y,
  type MainSwordModel
} from './xuanyuan-sword'
import {
  createEmptyPose,
  DEPTH_FOCUS_Z,
  FORMATIONS,
  formationAt,
  formationDepthAt,
  type FormationDepth,
  formationCount,
  HEART_X,
  HEART_Y,
  IMPACT_SECONDS,
  INTRO_SECONDS,
  LINK_SEGMENT_CAPACITY,
  sampleFormationLinks,
  sampleIntroSwordPoseInto,
  sampleSkySwordPoseInto,
  sampleStageState,
  skyFormationCount,
  type SwordPose
} from './sword-motion'

export interface SwordSceneOptions {
  variant: 'welcome' | 'compact'
  tier: 'full' | 'light'
  state: string
  boost: boolean
  sheathed?: boolean
  palette: { accentA: string; accentB: string; seal: string; text: string; bg?: string }
}

export interface SwordScene {
  resize(width: number, height: number, dpr: number): void
  setPointer(x: number, y: number): void
  /** Free-orbit camera controls (welcome variant only). */
  beginOrbit(): void
  orbitBy(dxPixels: number, dyPixels: number): void
  endOrbit(): void
  zoomBy(delta: number): void
  resetView(): void
  projectSwordTip(target: SwordTipProjection): void
  beginSwordTilt(xPixels: number, yPixels: number): boolean
  moveSwordTilt(xPixels: number, yPixels: number): void
  endSwordTilt(cancelled?: boolean): void
  update(options: SwordSceneOptions): void
  render(timeSeconds: number, introTimeSeconds?: number): string
  formationIndex(): number
  triggerPulse(): void
  dispose(releaseContext?: boolean): void
}

export interface SwordTipProjection {
  x: number
  y: number
  visible: boolean
  tiltDegrees: number
}

const UP = new THREE.Vector3(0, 1, 0)
const GLYPHS = ['☰', '☱', '☲', '☳', '☴', '☵', '☶', '☷']
const MAX_CORE_SWORDS = formationCount('full', false)
const MAX_SKY_SWORDS = skyFormationCount('full', false)
const TRAIL_COUNT = 160
const TRAIL_SEGMENTS = 10
const TRAIL_VERTEX_COUNT = TRAIL_COUNT * TRAIL_SEGMENTS * 2
const STAR_COUNT = 900
const TAU = Math.PI * 2
// Formations are authored as shallow camera-facing discs; each gets its own depth gain/centre
// (see DEPTH_PROFILE in sword-motion) so side views keep a real 3D body.
const ORBIT_RAD_PER_PIXEL = 0.0075
const ORBIT_PITCH_LIMIT = 1.3
const ORBIT_TOTAL_PITCH_LIMIT = 1.5
const ORBIT_ZOOM_MIN = 0.55
const ORBIT_ZOOM_MAX = 1.7
const FLOOR_Y = -2.55
const FLOOR_TICKS = 12
const SWORD_TILT_LIMIT = (65 * Math.PI) / 180

function deepenPose(pose: SwordPose, depth: FormationDepth, enabled: boolean): void {
  if (!enabled) return
  pose.position.z = DEPTH_FOCUS_Z + (pose.position.z - depth.center) * depth.gain
  const dz = pose.direction.z * depth.gain
  const len = Math.hypot(pose.direction.x, pose.direction.y, dz) || 1
  pose.direction.x /= len
  pose.direction.y /= len
  pose.direction.z = dz / len
}

function clampValue(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function disposeSceneResources(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  releaseContext = true
): void {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()
  scene.traverse((object) => {
    const renderable = object as unknown as {
      geometry?: THREE.BufferGeometry
      material?: THREE.Material | THREE.Material[]
    }
    if (renderable.geometry) geometries.add(renderable.geometry)
    if (renderable.material) {
      for (const material of Array.isArray(renderable.material)
        ? renderable.material
        : [renderable.material]) {
        materials.add(material)
      }
    }
    if (object instanceof THREE.InstancedMesh) object.dispose()
  })
  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value instanceof THREE.Texture) textures.add(value)
    }
  }
  geometries.forEach((geometry) => geometry.dispose())
  materials.forEach((material) => material.dispose())
  textures.forEach((texture) => texture.dispose())
  renderer.dispose()
  if (releaseContext) renderer.forceContextLoss()
  scene.clear()
}

export function createSwordScene(canvas: HTMLCanvasElement, initialOptions: SwordSceneOptions): SwordScene {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true
  })
  const scene = new THREE.Scene()
  try {
    return buildSwordScene(renderer, scene, initialOptions)
  } catch (error) {
    disposeSceneResources(scene, renderer, false)
    throw error
  }
}

function buildSwordScene(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  initialOptions: SwordSceneOptions
): SwordScene {
  let options = { ...initialOptions, palette: { ...initialOptions.palette } }
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.24
  renderer.setClearColor(0x000000, 0)
  const fog = new THREE.FogExp2(options.palette.bg || '#080b0a', 0.034)
  scene.fog = fog
  const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 80)
  camera.position.set(0, 0.95, 10.0)

  const ambient = new THREE.HemisphereLight('#d9e7df', '#17100b', 1.52)
  scene.add(ambient)
  const keyLight = new THREE.DirectionalLight('#f4f0df', 4.4)
  keyLight.position.set(-3, 5, 6)
  scene.add(keyLight)
  const viewLight = new THREE.DirectionalLight('#b9d9e7', 1.8)
  viewLight.target.position.set(HEART_X, HEART_Y, DEPTH_FOCUS_Z)
  scene.add(viewLight, viewLight.target)
  const rimLight = new THREE.PointLight('#5ec4a6', 26, 18, 1.45)
  rimLight.position.set(3.4, 1.8, 3.6)
  scene.add(rimLight)
  const gourdLight = new THREE.PointLight('#d98b38', 8, 7, 1.8)
  gourdLight.position.set(-0.56, -0.8, 2.0)
  scene.add(gourdLight)

  const flyingGeometry = createFlyingSwordGeometry()
  const flyingMaterial = new THREE.MeshStandardMaterial({
    color: '#edf4ef',
    metalness: 0.68,
    roughness: 0.28,
    emissive: '#254c43',
    emissiveIntensity: 0.46,
    flatShading: true,
    vertexColors: true
  })
  const swords = new THREE.InstancedMesh(flyingGeometry, flyingMaterial, MAX_CORE_SWORDS)
  swords.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  swords.frustumCulled = false
  const initColor = new THREE.Color('#e5eee9')
  for (let i = 0; i < MAX_CORE_SWORDS; i++) swords.setColorAt(i, initColor)

  const skyGeometry = createSkySwordGeometry()
  const skyMaterial = new THREE.MeshStandardMaterial({
    color: '#e5f1eb',
    metalness: 0.78,
    roughness: 0.3,
    emissive: '#2c5a4f',
    emissiveIntensity: 0.56,
    flatShading: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.74,
    depthWrite: false
  })
  const skySwords = new THREE.InstancedMesh(skyGeometry, skyMaterial, MAX_SKY_SWORDS)
  skySwords.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  skySwords.frustumCulled = false
  skySwords.renderOrder = -1
  for (let i = 0; i < MAX_SKY_SWORDS; i++) skySwords.setColorAt(i, initColor)
  scene.add(skySwords)

  const formation = new THREE.Group()
  formation.add(swords)
  scene.add(formation)

  const foregroundMaterial = flyingMaterial.clone()
  foregroundMaterial.color.set('#eff5f2')
  foregroundMaterial.emissive.set('#8a6530')
  foregroundMaterial.emissiveIntensity = 0.58
  // Pack each lane into sweeping ribbons with a larger lead sword and a tapering tail.
  const foregroundFlights = Array.from({ length: 640 }, (_, index) => {
    const lane = index % 8
    const slot = Math.floor(index / 8)
    const tail = (slot % 16) / 15
    return {
      phase: (Math.floor(slot / 16) / 5) * TAU + lane * 0.38 - tail * (lane < 4 ? 0.88 : -0.88),
      speed: lane < 4 ? 2 : -2,
      radiusX: 2.8 + lane * 0.17 + tail * 0.28,
      radiusY: 1.65 + lane * 0.09 + tail * 0.22,
      tilt: lane < 4 ? 0.26 : -0.24,
      depth: 0.95 + lane * 0.21 + tail * 0.17,
      scale: (slot % 16 === 0 ? 0.235 : 0.14 - tail * 0.067) + lane * 0.005,
      tail
    }
  })
  const foreground = new THREE.InstancedMesh(flyingGeometry, foregroundMaterial, foregroundFlights.length)
  foreground.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  foreground.frustumCulled = false
  scene.add(foreground)

  // Attenuate just the blades behind the tip's screen-space halo, from any orbit angle.
  const tipHalo = new THREE.Uniform(new THREE.Vector3())
  for (const material of [flyingMaterial, skyMaterial, foregroundMaterial]) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.tipHalo = tipHalo
      shader.fragmentShader =
        'uniform vec3 tipHalo;\n' +
        shader.fragmentShader.replace(
          '#include <opaque_fragment>',
          `float tipDistance = length(gl_FragCoord.xy - tipHalo.xy);
         outgoingLight *= mix(0.25, 1.0, smoothstep(0.0, max(0.001, tipHalo.z), tipDistance));
         #include <opaque_fragment>`
        )
    }
  }

  const guardianMaterial = flyingMaterial.clone()
  guardianMaterial.color.set('#e9f4ee')
  guardianMaterial.emissive.set('#5ec4a6')
  guardianMaterial.emissiveIntensity = 0.62
  const guardians = Array.from({ length: 6 }, () => {
    const sword = new THREE.Mesh(flyingGeometry, guardianMaterial)
    sword.frustumCulled = false
    scene.add(sword)
    return sword
  })

  const trailPositions = new Float32Array(TRAIL_VERTEX_COUNT * 3)
  const trailColors = new Float32Array(TRAIL_VERTEX_COUNT * 3)
  const trailGeometry = new THREE.BufferGeometry()
  trailGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(trailPositions, 3).setUsage(THREE.DynamicDrawUsage)
  )
  trailGeometry.setAttribute(
    'color',
    new THREE.BufferAttribute(trailColors, 3).setUsage(THREE.DynamicDrawUsage)
  )
  const trailMaterial = new THREE.LineBasicMaterial({
    color: '#ffffff',
    vertexColors: true,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  })
  const trailLines = new THREE.LineSegments(trailGeometry, trailMaterial)
  trailLines.frustumCulled = false
  formation.add(trailLines)

  const glowTexture = createGlowTexture()
  // Small, depth-tested glints keep individual blades readable inside dense formations.
  const glintGeometry = new THREE.BufferGeometry()
  const glintPositions = new Float32Array(TRAIL_COUNT * 3)
  const glintColors = new Float32Array(TRAIL_COUNT * 3)
  glintGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(glintPositions, 3).setUsage(THREE.DynamicDrawUsage)
  )
  glintGeometry.setAttribute(
    'color',
    new THREE.BufferAttribute(glintColors, 3).setUsage(THREE.DynamicDrawUsage)
  )
  const glintMaterial = new THREE.PointsMaterial({
    map: glowTexture,
    size: 0.095,
    transparent: true,
    opacity: 0.8,
    vertexColors: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  })
  const glints = new THREE.Points(glintGeometry, glintMaterial)
  glints.frustumCulled = false
  formation.add(glints)
  const inscriptionTexture = createXuanyuanInscriptionTexture()
  const mainSword: MainSwordModel = createMainSword(glowTexture, inscriptionTexture)
  scene.add(mainSword.group, mainSword.scabbard)

  const pillarTexture = createPillarTexture()
  const pillarMaterial = new THREE.MeshBasicMaterial({
    map: pillarTexture,
    color: '#d4af63',
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  })
  // Two crossed vertical planes read as a volumetric light column from any angle.
  const pillarSprite = new THREE.Group()
  const pillarPlaneGeometry = new THREE.PlaneGeometry(1, 1)
  const pillarPlaneA = new THREE.Mesh(pillarPlaneGeometry, pillarMaterial)
  const pillarPlaneB = new THREE.Mesh(pillarPlaneGeometry, pillarMaterial)
  pillarPlaneB.rotation.y = Math.PI / 2
  pillarSprite.add(pillarPlaneA, pillarPlaneB)
  pillarSprite.position.set(HEART_X, 0.42, -0.35)
  pillarSprite.scale.set(2.4, 9.8, 2.4)
  scene.add(pillarSprite)

  const flareTexture = createFlareTexture()
  const tipStar = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: flareTexture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  )
  tipStar.position.y = MAIN_SWORD_TIP_Y
  mainSword.group.add(tipStar)
  const guardLight = new THREE.Sprite(mainSword.glow.material.clone())
  guardLight.position.set(0, MAIN_SWORD_PIVOT_Y, 0.13)
  mainSword.group.add(guardLight)
  const flareMaterial = new THREE.SpriteMaterial({
    map: flareTexture,
    color: '#f2dab0',
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  })
  const flareSprite = new THREE.Sprite(flareMaterial)
  flareSprite.position.set(HEART_X, HEART_Y + 0.04, -0.25)
  flareSprite.scale.set(2.4, 2.4, 1)
  scene.add(flareSprite)

  const shockwaveTexture = createShockwaveTexture()
  const shockwaveGeometry = new THREE.PlaneGeometry(1, 1)
  const shockwaves = Array.from({ length: 3 }, () => {
    const material = new THREE.MeshBasicMaterial({
      map: shockwaveTexture,
      color: '#d4af63',
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
    const mesh = new THREE.Mesh(shockwaveGeometry, material)
    mesh.position.set(HEART_X, HEART_Y, -0.22)
    mesh.rotation.set(0.13, -0.08, 0)
    mesh.visible = false
    scene.add(mesh)
    return { mesh, material }
  })

  const groundImpact: GroundImpactModel = createGroundImpact(shockwaveTexture, glowTexture)
  groundImpact.group.position.set(HEART_X, -1.42, -0.04)
  groundImpact.group.rotation.set(0.32, 0, -0.04)
  groundImpact.group.visible = false
  scene.add(groundImpact.group)

  const ringGroup = new THREE.Group()
  const ringMeshes: THREE.Mesh[] = []
  const ringMaterials: THREE.MeshBasicMaterial[] = []
  for (const [index, radius] of [1.18, 1.92, 2.58].entries()) {
    const material = new THREE.MeshBasicMaterial({
      color: index === 1 ? '#5ec4a6' : '#d4af63',
      transparent: true,
      opacity: 0.2 - index * 0.025,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius, radius + 0.015 + index * 0.006, 96), material)
    ringGroup.add(ring)
    ringMeshes.push(ring)
    ringMaterials.push(material)
  }
  const spokesGeometry = new THREE.BufferGeometry()
  const spokePositions: number[] = []
  for (let index = 0; index < 16; index++) {
    const angle = (index / 16) * Math.PI * 2
    spokePositions.push(
      Math.cos(angle) * 1.2,
      Math.sin(angle) * 1.2,
      0,
      Math.cos(angle) * 2.55,
      Math.sin(angle) * 2.55,
      0
    )
  }
  spokesGeometry.setAttribute('position', new THREE.Float32BufferAttribute(spokePositions, 3))
  const spokeMaterial = new THREE.LineBasicMaterial({ color: '#d4af63', transparent: true, opacity: 0.08 })
  const spokesMesh = new THREE.LineSegments(spokesGeometry, spokeMaterial)
  ringGroup.add(spokesMesh)
  const glyphs = GLYPHS.map((glyph, index) => {
    const sprite = createGlyphSprite(glyph, '#d4af63')
    const angle = (index / GLYPHS.length) * Math.PI * 2
    sprite.position.set(Math.cos(angle) * 2.28, Math.sin(angle) * 2.28, 0.02)
    ringGroup.add(sprite)
    return sprite
  })
  ringGroup.position.set(HEART_X, 0.08, -1.45)
  ringGroup.rotation.set(0.13, -0.08, 0)
  scene.add(ringGroup)

  // Horizon floor: concentric rings with twelve ticks (one per formation) anchor the depth
  // axes, so free-orbit rotation always has a ground reference.
  const floorGroup = new THREE.Group()
  const floorMaterials: THREE.MeshBasicMaterial[] = []
  for (const [index, radius] of [2.7, 4.1, 5.6].entries()) {
    const material = new THREE.MeshBasicMaterial({
      color: index === 1 ? '#5ec4a6' : '#d4af63',
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius, radius + 0.02 + index * 0.012, 128), material)
    ring.rotation.x = -Math.PI / 2
    floorGroup.add(ring)
    floorMaterials.push(material)
  }
  const floorTickPositions: number[] = []
  for (let index = 0; index < FLOOR_TICKS; index++) {
    const angle = (index / FLOOR_TICKS) * TAU
    floorTickPositions.push(
      Math.cos(angle) * 5.35,
      0,
      Math.sin(angle) * 5.35,
      Math.cos(angle) * 5.95,
      0,
      Math.sin(angle) * 5.95
    )
  }
  const floorTickGeometry = new THREE.BufferGeometry()
  floorTickGeometry.setAttribute('position', new THREE.Float32BufferAttribute(floorTickPositions, 3))
  const floorTickMaterial = new THREE.LineBasicMaterial({
    color: '#d4af63',
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  })
  floorGroup.add(new THREE.LineSegments(floorTickGeometry, floorTickMaterial))
  floorGroup.position.set(HEART_X, FLOOR_Y, DEPTH_FOCUS_Z)
  scene.add(floorGroup)

  const gourd: GourdModel = createGourd()
  gourd.group.position.set(-0.56, -1.16, 0.82)
  gourd.group.scale.setScalar(0.5)
  scene.add(gourd.group)

  const linkVertexCount = LINK_SEGMENT_CAPACITY * 2
  const linkPositions = new Float32Array(linkVertexCount * 3)
  const linkColors = new Float32Array(linkVertexCount * 3)
  const linkWeights = new Float32Array(linkVertexCount)
  const linkColorIdx = new Uint8Array(linkVertexCount)
  const linkGeometry = new THREE.BufferGeometry()
  linkGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(linkPositions, 3).setUsage(THREE.DynamicDrawUsage)
  )
  linkGeometry.setAttribute(
    'color',
    new THREE.BufferAttribute(linkColors, 3).setUsage(THREE.DynamicDrawUsage)
  )
  const linkMaterial = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.52,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  })
  const links = new THREE.LineSegments(linkGeometry, linkMaterial)
  links.frustumCulled = false
  links.visible = false
  scene.add(links)

  const particlePositions = new Float32Array(STAR_COUNT * 3)
  for (let index = 0; index < STAR_COUNT; index++) {
    const angle = index * 2.399963
    const radius = 1.6 + ((index * 37) % 100) / 9.5
    particlePositions[index * 3] = Math.cos(angle) * radius + HEART_X * 0.7
    particlePositions[index * 3 + 1] = -3.8 + ((index * 61) % 100) / 12.5
    particlePositions[index * 3 + 2] = -9.5 + ((index * 29) % 100) / 9.5
  }
  const particleGeometry = new THREE.BufferGeometry()
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3))
  const particleMaterial = new THREE.PointsMaterial({
    map: glowTexture,
    color: '#d4af63',
    size: 0.085,
    transparent: true,
    opacity: 0.56,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  })
  const particles = new THREE.Points(particleGeometry, particleMaterial)
  scene.add(particles)

  const matrix = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const direction = new THREE.Vector3()
  const quaternion = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  const instanceColor = new THREE.Color()
  const trailColor = new THREE.Color()
  const brightGold = new THREE.Color('#fff1cc')
  const gold = new THREE.Color(options.palette.accentA)
  const jade = new THREE.Color(options.palette.accentB)
  const seal = new THREE.Color(options.palette.seal)
  const steel = new THREE.Color(options.palette.text)
  const pointerTarget = new THREE.Vector2()
  const pointer = new THREE.Vector2()
  const depth: FormationDepth = { gain: 1, center: DEPTH_FOCUS_Z }
  const trailDepths = Array.from({ length: TRAIL_SEGMENTS }, () => ({ gain: 1, center: DEPTH_FOCUS_Z }))
  const bladeRoll = new THREE.Quaternion()
  const poseScratch = createEmptyPose()
  const trailPoseA = createEmptyPose()
  const trailPoseB = createEmptyPose()
  let lastLoopTime = 0
  let bladePitch = 0
  let bladeRollAngle = 0
  let flowTime = 2
  let sheathTravel = initialOptions.sheathed ? 1 : 0
  const restingRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.12, -0.15, -2.96))
  const silkDrape = new THREE.Quaternion()
  let lastFormationIndex = 0
  let manualPulseProgress = 0
  let disposed = false
  let viewWidth = 1
  let viewHeight = 1
  let lastIntroTime = 0
  let tiltingSword = false
  const swordTilt = new THREE.Quaternion()
  const swordBaseRotation = new THREE.Quaternion()
  const tiltStartOffset = new THREE.Quaternion()
  const tiltStartRotation = new THREE.Quaternion()
  const tiltRotation = new THREE.Quaternion()
  const tiltDelta = new THREE.Quaternion()
  const inverseBase = new THREE.Quaternion()
  const tiltPivot = new THREE.Vector3()
  const tiltTip = new THREE.Vector3()
  const tiltStartDirection = new THREE.Vector3()
  const tiltDirection = new THREE.Vector3()
  const tiltStartHit = new THREE.Vector3()
  const tiltHit = new THREE.Vector3()
  const tiltPlane = new THREE.Plane()
  const tiltRay = new THREE.Raycaster()
  const tiltNdc = new THREE.Vector2()
  const tipScreen = new THREE.Vector3()
  const hiltOffset = new THREE.Vector3()
  const hiltWorld = new THREE.Vector3()
  let tiltScale = 1
  const orbitPivot = new THREE.Vector3(HEART_X, HEART_Y - 0.1, -0.7)
  const framingNdc = new THREE.Vector3()
  const orbit = {
    yaw: 0,
    pitch: 0,
    zoom: 1,
    targetYaw: 0,
    targetPitch: 0,
    targetZoom: 1,
    velYaw: 0,
    velPitch: 0,
    lastMove: 0,
    dragging: false,
    sway: 1
  }

  function writePoseToInstancedMesh(
    mesh: THREE.InstancedMesh,
    index: number,
    pose: SwordPose,
    sizeFactor: number,
    pulse: number,
    isError: boolean,
    colorScale = 1
  ): void {
    if (pose.scale <= 0.0005) {
      scale.set(0, 0, 0)
      matrix.compose(position.set(HEART_X, HEART_Y, -0.35), quaternion.identity(), scale)
      mesh.setMatrixAt(index, matrix)
      return
    }
    position.set(pose.position.x, pose.position.y, pose.position.z)
    direction.set(pose.direction.x, pose.direction.y, pose.direction.z).normalize()
    quaternion.setFromUnitVectors(UP, direction)
    bladeRoll.setFromAxisAngle(UP, index * 2.399963 + Math.sin(lastLoopTime * 1.4 + index * 0.73) * 0.55)
    quaternion.multiply(bladeRoll)
    const size = pose.scale * sizeFactor
    scale.set(size, size * pose.stretch, size)
    matrix.compose(position, quaternion, scale)
    mesh.setMatrixAt(index, matrix)

    instanceColor
      .copy(steel)
      .lerp(jade, pose.jade)
      .lerp(gold, pose.gold)
      .lerp(seal, pose.seal * 0.85)
    if (pulse > 0.02) {
      instanceColor.lerp(brightGold, pulse * 0.44 * pose.energy)
    }
    if (isError) instanceColor.lerp(seal, 0.7)
    instanceColor.multiplyScalar(0.82 + pose.glow * 0.32 + pose.energy * 0.16)
    if (colorScale !== 1) instanceColor.multiplyScalar(colorScale)
    mesh.setColorAt(index, instanceColor)
  }

  function update(nextOptions: SwordSceneOptions): void {
    options = { ...nextOptions, palette: { ...nextOptions.palette } }
    gold.set(options.palette.accentA)
    jade.set(options.palette.accentB)
    seal.set(options.palette.seal)
    steel.set(options.palette.text).lerp(jade, 0.12)
    fog.color.set(options.palette.bg || '#080b0a')
    const isError = options.state === 'error'
    const accent = isError ? seal : jade
    flyingMaterial.emissive.copy(isError ? seal : steel).multiplyScalar(0.18)
    skyMaterial.emissive
      .copy(isError ? seal : steel)
      .lerp(accent, 0.35)
      .multiplyScalar(0.18)
    foregroundMaterial.emissive.copy(accent).multiplyScalar(0.13)
    foregroundFlights.forEach((flight, i) => {
      instanceColor.copy(i % 8 < 4 ? gold : accent).lerp(steel, 0.24)
      instanceColor.multiplyScalar(1.25 - flight.tail * 0.77)
      foreground.setColorAt(i, instanceColor)
    })
    if (foreground.instanceColor) foreground.instanceColor.needsUpdate = true
    guardianMaterial.emissive.copy(accent).multiplyScalar(0.35)
    mainSword.bladeMaterial.color.set('#e5f2f5').lerp(steel, 0.13)
    mainSword.bladeMaterial.emissive.copy(isError ? seal : steel).multiplyScalar(0.32)
    mainSword.flowColor.value.set(isError ? seal : '#6cbcff')
    mainSword.glow.material.color.copy(mainSword.flowColor.value)
    mainSword.auraMaterial.color.copy(mainSword.flowColor.value)
    mainSword.inlayMaterial.emissive.set('#9bcfff')
    tipStar.material.color.set('#e5f5ff')
    guardLight.material.color.copy(mainSword.flowColor.value)
    pillarMaterial.color.copy(isError ? seal : gold)
    flareMaterial.color.copy(isError ? seal : gold).lerp(brightGold, 0.35)
    shockwaves[0]!.material.color.copy(isError ? seal : gold)
    shockwaves[1]!.material.color.copy(accent)
    shockwaves[2]!.material.color.copy(isError ? seal : gold)
    groundImpact.plinthMaterial.emissive.copy(accent).multiplyScalar(0.28)
    groundImpact.crackDiscMaterial.color.copy(isError ? seal : gold).lerp(brightGold, 0.22)
    groundImpact.craterGlowMaterial.color.copy(brightGold)
    groundImpact.shockwaveMaterial.color.copy(isError ? seal : gold)
    groundImpact.crystalMaterial.emissive.copy(isError ? seal : gold)
    groundImpact.fissures.forEach((fissure, idx) => {
      fissure.material.color.copy(idx % 3 === 1 ? accent : gold).lerp(brightGold, 0.35)
    })
    rimLight.color.copy(accent)
    particleMaterial.color.copy(gold)
    spokeMaterial.color.copy(gold)
    ringMaterials.forEach((material, index) => material.color.copy(index === 1 ? accent : gold))
    glyphs.forEach((sprite) => sprite.material.color.copy(gold))
    const compact = options.variant === 'compact'
    if (compact) {
      orbit.yaw = orbit.targetYaw = 0
      orbit.pitch = orbit.targetPitch = 0
      orbit.zoom = orbit.targetZoom = 1
      orbit.dragging = false
    }
    const coreCount = formationCount(options.tier, compact)
    const skyCount = skyFormationCount(options.tier, compact)
    swords.count = coreCount
    skySwords.count = skyCount
    skySwords.visible = !compact && skyCount > 0
    formation.scale.setScalar(compact ? 0.48 : 1)
    formation.position.x = compact ? -HEART_X * 0.48 : 0
    ringGroup.position.x = compact ? 0 : HEART_X
    ringGroup.scale.setScalar(compact ? 0.52 : 0.88)
    gourd.group.visible = !compact
    particles.visible = !compact
    pillarSprite.visible = !compact
    flareSprite.visible = !compact
    foreground.visible = !compact && options.tier === 'full'
    guardians.forEach((sword) => {
      sword.visible = !compact && options.tier === 'full'
    })
    trailLines.visible = !compact && options.tier === 'full'
    glyphs.forEach((sprite) => {
      sprite.visible = !compact
    })
  }

  function resize(width: number, height: number, dpr: number): void {
    if (disposed) return
    const compact = options.variant === 'compact'
    renderer.setPixelRatio(Math.min(dpr || 1, options.tier === 'light' ? 1.2 : compact ? 1.5 : 1.6))
    renderer.setSize(Math.max(1, Math.floor(width)), Math.max(1, Math.floor(height)), false)
    camera.aspect = Math.max(1, width) / Math.max(1, height)
    viewWidth = Math.max(1, width)
    viewHeight = Math.max(1, height)
    camera.updateProjectionMatrix()
  }

  function orbitEnabled(): boolean {
    return !disposed && options.variant === 'welcome'
  }

  function beginOrbit(): void {
    if (!orbitEnabled()) return
    orbit.dragging = true
    orbit.velYaw = 0
    orbit.velPitch = 0
    orbit.lastMove = performance.now()
  }

  function orbitBy(dxPixels: number, dyPixels: number): void {
    if (!orbitEnabled() || !orbit.dragging) return
    const now = performance.now()
    const dtSeconds = Math.max(0.001, (now - orbit.lastMove) / 1000)
    orbit.lastMove = now
    const dYaw = -dxPixels * ORBIT_RAD_PER_PIXEL
    const dPitch = dyPixels * ORBIT_RAD_PER_PIXEL
    orbit.targetYaw += dYaw
    orbit.targetPitch = clampValue(orbit.targetPitch + dPitch, -ORBIT_PITCH_LIMIT, ORBIT_PITCH_LIMIT)
    orbit.velYaw += (clampValue(dYaw / dtSeconds, -9, 9) - orbit.velYaw) * 0.4
    orbit.velPitch += (clampValue(dPitch / dtSeconds, -9, 9) - orbit.velPitch) * 0.4
  }

  function endOrbit(): void {
    if (!orbit.dragging) return
    orbit.dragging = false
    // Release with a little inertia when the pointer was still moving.
    if (performance.now() - orbit.lastMove < 90) {
      orbit.targetYaw += orbit.velYaw * 0.22
      orbit.targetPitch = clampValue(
        orbit.targetPitch + orbit.velPitch * 0.22,
        -ORBIT_PITCH_LIMIT,
        ORBIT_PITCH_LIMIT
      )
    }
  }

  function zoomBy(delta: number): void {
    if (!orbitEnabled()) return
    orbit.targetZoom = clampValue(orbit.targetZoom * Math.exp(delta * 0.0012), ORBIT_ZOOM_MIN, ORBIT_ZOOM_MAX)
  }

  function resetView(): void {
    if (!orbitEnabled()) return
    orbit.dragging = false
    orbit.targetYaw = Math.round(orbit.yaw / TAU) * TAU
    orbit.targetPitch = 0
    orbit.targetZoom = 1
    endSwordTilt()
    swordTilt.identity()
  }

  function projectSwordTip(target: SwordTipProjection): void {
    mainSword.group.updateWorldMatrix(true, false)
    tipScreen.set(0, MAIN_SWORD_TIP_Y, 0).applyMatrix4(mainSword.group.matrixWorld).project(camera)
    target.x = ((tipScreen.x + 1) * viewWidth) / 2
    target.y = ((1 - tipScreen.y) * viewHeight) / 2
    tiltDirection.copy(UP).applyQuaternion(mainSword.group.quaternion)
    target.tiltDegrees = Math.acos(clampValue(tiltDirection.y, -1, 1)) * (180 / Math.PI)
    target.visible =
      orbitEnabled() &&
      sheathTravel === 0 &&
      !options.sheathed &&
      lastIntroTime >= INTRO_SECONDS &&
      tipScreen.z > -1 &&
      tipScreen.z < 1 &&
      target.x >= 16 &&
      target.x <= viewWidth - 16 &&
      target.y >= 16 &&
      target.y <= viewHeight - 16
  }

  function intersectTiltPlane(x: number, y: number): boolean {
    tiltNdc.set((x / viewWidth) * 2 - 1, 1 - (y / viewHeight) * 2)
    tiltRay.setFromCamera(tiltNdc, camera)
    return tiltRay.ray.intersectPlane(tiltPlane, tiltHit) !== null
  }

  function beginSwordTilt(x: number, y: number): boolean {
    if (!orbitEnabled() || lastIntroTime < INTRO_SECONDS || sheathTravel > 0 || options.sheathed) return false
    // Pick in CSS pixels so the narrow blade stays easy to grab at every zoom/DPR.
    mainSword.group.updateWorldMatrix(true, false)
    tiltTip.set(0, MAIN_SWORD_TIP_Y, 0).applyMatrix4(mainSword.group.matrixWorld)
    tipScreen.copy(tiltTip).project(camera)
    if (
      tipScreen.z <= -1 ||
      tipScreen.z >= 1 ||
      Math.hypot(x - ((tipScreen.x + 1) * viewWidth) / 2, y - ((1 - tipScreen.y) * viewHeight) / 2) > 28
    )
      return false
    tiltPivot.set(0, MAIN_SWORD_PIVOT_Y, 0).applyMatrix4(mainSword.group.matrixWorld)
    camera.getWorldDirection(tiltDirection)
    tiltPlane.setFromNormalAndCoplanarPoint(tiltDirection, tiltTip)
    if (!intersectTiltPlane(x, y)) return false
    tiltStartHit.copy(tiltHit)
    tiltStartDirection.copy(tiltTip).sub(tiltPivot).normalize()
    tiltStartRotation.copy(mainSword.group.quaternion)
    tiltRotation.copy(tiltStartRotation)
    tiltStartOffset.copy(swordTilt)
    tiltScale = mainSword.group.scale.x
    orbit.dragging = false
    tiltingSword = true
    return true
  }

  function moveSwordTilt(x: number, y: number): void {
    if (!tiltingSword || !intersectTiltPlane(x, y)) return
    tiltDirection.copy(tiltHit).sub(tiltStartHit).add(tiltTip).sub(tiltPivot)
    if (tiltDirection.lengthSq() < 0.0001) return
    tiltDirection.normalize()
    // Keep the sword upright within a 65° cone, even if dragged across the hilt.
    if (tiltDirection.y < Math.cos(SWORD_TILT_LIMIT)) {
      const horizontal = Math.hypot(tiltDirection.x, tiltDirection.z)
      if (horizontal < 0.0001) return
      const gain = Math.sin(SWORD_TILT_LIMIT) / horizontal
      tiltDirection.set(tiltDirection.x * gain, Math.cos(SWORD_TILT_LIMIT), tiltDirection.z * gain)
    }
    tiltDelta.setFromUnitVectors(tiltStartDirection, tiltDirection)
    tiltRotation.copy(tiltStartRotation).premultiply(tiltDelta)
  }

  function endSwordTilt(cancelled = false): void {
    if (!tiltingSword) return
    tiltingSword = false
    if (cancelled) swordTilt.copy(tiltStartOffset)
    else swordTilt.copy(tiltRotation).multiply(inverseBase.copy(swordBaseRotation).invert())
  }

  function updateShockwave(
    slot: { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial },
    progress: number,
    maxScale: number,
    baseOpacity: number,
    compact: boolean
  ): void {
    if (compact || progress <= 0 || progress >= 1) {
      slot.mesh.visible = false
      slot.material.opacity = 0
      return
    }
    const eased = 1 - Math.pow(1 - progress, 3)
    const size = 0.6 + eased * maxScale
    slot.mesh.visible = true
    slot.mesh.quaternion.copy(camera.quaternion)
    slot.mesh.scale.set(size, size, 1)
    slot.material.opacity = Math.sin(progress * Math.PI) * (1 - progress * 0.4) * baseOpacity
  }

  function triggerPulse(): void {
    if (disposed) return
    manualPulseProgress = 0.001
    flowTime = 0
  }

  function render(timeSeconds: number, introTimeSeconds = INTRO_SECONDS): string {
    if (disposed) return ''
    const time = Number.isFinite(timeSeconds) ? timeSeconds : 0
    const introTime = Number.isFinite(introTimeSeconds) ? Math.max(0, introTimeSeconds) : INTRO_SECONDS
    const justRevealed = lastIntroTime < INTRO_SECONDS && introTime >= INTRO_SECONDS
    lastIntroTime = introTime
    if (introTime < INTRO_SECONDS) endSwordTilt(true)
    const dt = lastLoopTime > 0 ? Math.min(0.05, Math.max(0.001, Math.abs(time - lastLoopTime))) : 0.016
    lastLoopTime = time

    if (manualPulseProgress > 0) {
      manualPulseProgress += dt / 1.05
      if (manualPulseProgress >= 1) manualPulseProgress = 0
    }

    const compact = options.variant === 'compact'
    const isError = options.state === 'error'
    if (compact || introTime < INTRO_SECONDS) sheathTravel = 0
    else sheathTravel = clampValue(sheathTravel + ((options.sheathed ? 1 : -1) * dt) / 1.9, 0, 1)
    if (tiltingSword && sheathTravel > 0) endSwordTilt(true)
    const stage = sampleStageState(time, compact ? Math.max(introTime * 2.6, 0.8) : introTime, compact)
    if (introTime < INTRO_SECONDS) flowTime = 2
    else if (justRevealed || stage.formationIndex !== lastFormationIndex) flowTime = 0
    else flowTime = Math.min(2, flowTime + dt)
    lastFormationIndex = stage.formationIndex
    const { weights } = stage
    const phase = weights.phase
    const cycle = phase * Math.PI * 2
    const gather = weights.gather
    const ambientPulse = weights.ambientPulse
    const pulse = Math.max(
      weights.pulse,
      manualPulseProgress > 0 ? Math.sin(manualPulseProgress * Math.PI) * 0.75 : 0
    )
    const combinedEnergy = Math.max(pulse, ambientPulse * 0.55)
    const count = formationCount(options.tier, compact)
    const sizeFactor = compact ? 0.85 : 1
    formationDepthAt(time, depth)
    const depthOn = !compact

    const pointerBlend = 1 - Math.exp(-5.5 * dt)
    pointer.lerp(pointerTarget, pointerBlend)
    if (compact) {
      camera.clearViewOffset()
      camera.position.set(pointer.x * 0.32, stage.cameraY + pointer.y * 0.16, stage.cameraZ)
      camera.lookAt(0, 0.05, 0)
    } else if (!tiltingSword) {
      // Reference framing: where the formation heart sits on screen with the classic fixed camera.
      camera.clearViewOffset()
      camera.position.set(pointer.x * 0.32, stage.cameraY + pointer.y * 0.16, stage.cameraZ)
      camera.lookAt(0.45, 0.05, 0)
      camera.updateMatrixWorld()
      framingNdc.copy(orbitPivot).project(camera)

      const orbitBlend = 1 - Math.exp(-9 * dt)
      orbit.yaw += (orbit.targetYaw - orbit.yaw) * orbitBlend
      orbit.pitch += (orbit.targetPitch - orbit.pitch) * orbitBlend
      orbit.zoom += (orbit.targetZoom - orbit.zoom) * orbitBlend
      orbit.sway += ((orbit.dragging ? 0 : 1) - orbit.sway) * orbitBlend
      const swayYaw = Math.sin(time * 0.42) * 0.075 * orbit.sway
      const swayPitch = Math.sin(time * 0.31 + 1.2) * 0.022 * orbit.sway
      const yaw = orbit.yaw + swayYaw + pointer.x * 0.05
      const offsetY = stage.cameraY - orbitPivot.y
      const offsetZ = stage.cameraZ - orbitPivot.z
      const radius = Math.hypot(offsetY, offsetZ) * orbit.zoom
      const pitch = clampValue(
        Math.atan2(offsetY, offsetZ) + orbit.pitch + swayPitch + pointer.y * 0.03,
        -ORBIT_TOTAL_PITCH_LIMIT,
        ORBIT_TOTAL_PITCH_LIMIT
      )
      const flat = Math.cos(pitch) * radius
      camera.position.set(
        orbitPivot.x + Math.sin(yaw) * flat,
        orbitPivot.y + Math.sin(pitch) * radius,
        orbitPivot.z + Math.cos(yaw) * flat
      )
      camera.lookAt(orbitPivot)
      camera.setViewOffset(
        viewWidth,
        viewHeight,
        (-framingNdc.x * viewWidth) / 2,
        (framingNdc.y * viewHeight) / 2,
        viewWidth,
        viewHeight
      )
    }
    camera.updateMatrixWorld()

    viewLight.position.copy(camera.position)
    viewLight.position.y += 2.5

    for (let index = 0; index < count; index++) {
      sampleIntroSwordPoseInto(index, count, time, introTime, poseScratch)
      deepenPose(poseScratch, depth, depthOn)
      writePoseToInstancedMesh(swords, index, poseScratch, sizeFactor, combinedEnergy, isError)
    }
    swords.instanceMatrix.needsUpdate = true
    if (swords.instanceColor) swords.instanceColor.needsUpdate = true

    const skyCount = skyFormationCount(options.tier, compact)
    if (skySwords.visible && skyCount > 0) {
      const skyScale = stage.skyReveal
      skyMaterial.opacity = (options.tier === 'light' ? 0.52 : 0.74) * skyScale
      for (let index = 0; index < skyCount; index++) {
        sampleSkySwordPoseInto(index, skyCount, time, gather, weights.volley, poseScratch)
        poseScratch.scale *= skyScale
        writePoseToInstancedMesh(skySwords, index, poseScratch, 1, combinedEnergy * 0.65, isError, 1)
      }
      skySwords.instanceMatrix.needsUpdate = true
      if (skySwords.instanceColor) skySwords.instanceColor.needsUpdate = true
    }

    if (trailLines.visible) {
      if (introTime < 0.45) {
        trailGeometry.setDrawRange(0, 0)
      } else {
        const trailStep = 0.024
        for (let seg = 0; seg < TRAIL_SEGMENTS; seg++) {
          formationDepthAt(time - (seg + 1) * trailStep, trailDepths[seg]!)
        }
        const opacityBoost =
          0.34 +
          gather * 0.24 +
          weights.volley * 0.28 +
          pulse * 0.24 +
          ambientPulse * 0.1 +
          (options.boost ? 0.12 : 0)
        let vertex = 0
        let glintCount = 0
        for (let t = 0; t < TRAIL_COUNT; t++) {
          const swordIndex = Math.floor((t * count) / TRAIL_COUNT)
          sampleIntroSwordPoseInto(swordIndex, count, time, introTime, trailPoseA)
          deepenPose(trailPoseA, depth, depthOn)
          if (trailPoseA.scale <= 0.001) continue

          trailColor
            .copy(steel)
            .lerp(jade, trailPoseA.jade)
            .lerp(gold, trailPoseA.gold)
            .lerp(seal, trailPoseA.seal * 0.65)
            .lerp(brightGold, pulse * 0.45)
          if (isError) trailColor.lerp(seal, 0.7)

          const tip = trailPoseA.scale * trailPoseA.stretch * 0.87
          glintPositions[glintCount * 3] = trailPoseA.position.x + trailPoseA.direction.x * tip
          glintPositions[glintCount * 3 + 1] = trailPoseA.position.y + trailPoseA.direction.y * tip
          glintPositions[glintCount * 3 + 2] = trailPoseA.position.z + trailPoseA.direction.z * tip
          const sparkle = 0.3 + 0.7 * Math.pow(Math.max(0, Math.sin(time * 3 + t * 2.4)), 6)
          glintColors[glintCount * 3] = trailColor.r * sparkle
          glintColors[glintCount * 3 + 1] = trailColor.g * sparkle
          glintColors[glintCount * 3 + 2] = trailColor.b * sparkle
          glintCount++

          let prevFade = 1
          for (let seg = 0; seg < TRAIL_SEGMENTS; seg++) {
            const nextOffset = (seg + 1) * trailStep
            sampleIntroSwordPoseInto(
              swordIndex,
              count,
              time - nextOffset,
              introTime >= INTRO_SECONDS ? INTRO_SECONDS : Math.max(0, introTime - nextOffset),
              trailPoseB
            )
            if (trailPoseB.scale <= 0.001) break
            deepenPose(trailPoseB, trailDepths[seg]!, depthOn)
            // Recycled volleys teleport to their origin; never draw a streak across that jump.
            if (
              Math.hypot(
                trailPoseA.position.x - trailPoseB.position.x,
                trailPoseA.position.y - trailPoseB.position.y,
                trailPoseA.position.z - trailPoseB.position.z
              ) > 1.4
            )
              break
            const nextFade = Math.pow(1 - (seg + 1) / TRAIL_SEGMENTS, 1.75)

            trailPositions[vertex * 3] = trailPoseA.position.x
            trailPositions[vertex * 3 + 1] = trailPoseA.position.y
            trailPositions[vertex * 3 + 2] = trailPoseA.position.z
            trailColors[vertex * 3] = trailColor.r * prevFade
            trailColors[vertex * 3 + 1] = trailColor.g * prevFade
            trailColors[vertex * 3 + 2] = trailColor.b * prevFade
            vertex++

            trailPositions[vertex * 3] = trailPoseB.position.x
            trailPositions[vertex * 3 + 1] = trailPoseB.position.y
            trailPositions[vertex * 3 + 2] = trailPoseB.position.z
            trailColors[vertex * 3] = trailColor.r * nextFade
            trailColors[vertex * 3 + 1] = trailColor.g * nextFade
            trailColors[vertex * 3 + 2] = trailColor.b * nextFade
            vertex++

            trailPoseA.position.x = trailPoseB.position.x
            trailPoseA.position.y = trailPoseB.position.y
            trailPoseA.position.z = trailPoseB.position.z
            prevFade = nextFade
          }
        }
        trailGeometry.setDrawRange(0, vertex)
        trailGeometry.getAttribute('position').needsUpdate = true
        glintGeometry.setDrawRange(0, glintCount)
        glintGeometry.getAttribute('position').needsUpdate = true
        glintGeometry.getAttribute('color').needsUpdate = true
        trailGeometry.getAttribute('color').needsUpdate = true
        trailMaterial.opacity = Math.min(0.88, opacityBoost)
      }
    }

    glints.visible = trailLines.visible && introTime >= 0.45

    const introFactor = stage.introProgress
    const transition = formationAt(time)
    const from = FORMATIONS[transition.from]!
    const to = FORMATIONS[(transition.from + 1) % FORMATIONS.length]!
    if (foreground.visible) {
      const surge = 1 + weights.volley * 0.22
      const reveal = THREE.MathUtils.smoothstep(introFactor, 0.15, 0.82)
      foregroundFlights.forEach((flight, index) => {
        const angle = cycle * flight.speed + flight.phase
        const sin = Math.sin(angle)
        const cos = Math.cos(angle)
        // Interpolate the two contours, so the lobes stay closed while the formation changes.
        const offset = angle - cycle
        const ripple = THREE.MathUtils.lerp(
          Math.cos(from.lobes * offset),
          Math.cos(to.lobes * offset),
          transition.fade
        )
        const slope = THREE.MathUtils.lerp(
          -from.lobes * Math.sin(from.lobes * offset),
          -to.lobes * Math.sin(to.lobes * offset),
          transition.fade
        )
        const rx = flight.radiusX * surge + ripple * 0.28
        const ry = flight.radiusY + ripple * 0.23
        position.set(
          HEART_X + rx * cos,
          HEART_Y + ry * sin + flight.tilt * cos,
          flight.depth + sin * 0.62 + weights.volley * 0.45
        )
        direction.set(
          -rx * sin + 0.28 * slope * cos,
          ry * cos + 0.23 * slope * sin - flight.tilt * sin,
          cos * 0.62
        )
        direction.multiplyScalar(Math.sign(flight.speed)).normalize()
        quaternion.setFromUnitVectors(UP, direction)
        const size = flight.scale * reveal
        scale.set(size, size * (1 + weights.volley * 0.42), size)
        foreground.setMatrixAt(index, matrix.compose(position, quaternion, scale))
      })
      foreground.instanceMatrix.needsUpdate = true
    }

    guardians.forEach((sword, index) => {
      if (!sword.visible) return
      const reveal = Math.min(1, Math.max(0, (introTime - 0.45 - index * 0.1) / 0.55))
      const angle = -cycle * 2 + (index / guardians.length) * Math.PI * 2
      const guardR = 0.92 + weights.lotus * 0.32 - gather * 0.16 + pulse * 0.15
      sword.position.set(
        HEART_X + Math.cos(angle) * guardR,
        HEART_Y + Math.sin(angle) * guardR * 0.72,
        -0.1 + Math.sin(angle * 2) * 0.24
      )
      direction
        .set(
          Math.cos(angle) * (0.4 + weights.lotus * 0.8) - Math.sin(angle) * 0.6,
          Math.sin(angle) * (0.4 + weights.lotus * 0.8) + Math.cos(angle) * 0.6,
          0.35
        )
        .normalize()
      sword.quaternion.setFromUnitVectors(UP, direction)
      const gScale = (0.3 + pulse * 0.05) * reveal
      sword.scale.set(gScale, gScale * (1 + pulse * 0.35), gScale)
    })

    const heartX = compact ? 0 : HEART_X
    const hoverWave = introTime >= INTRO_SECONDS ? Math.sin(cycle * 2) * 0.08 : 0
    mainSword.group.position.set(
      heartX + stage.mainSwordTremble * 0.55,
      0.26 + hoverWave + stage.mainSwordY,
      0
    )
    const aimReveal = compact ? 0 : THREE.MathUtils.smoothstep(introTime, 3.24, INTRO_SECONDS)
    const aimBlend = 1 - Math.exp(-7 * dt)
    bladePitch = THREE.MathUtils.lerp(
      bladePitch,
      THREE.MathUtils.lerp(from.bladePitch, to.bladePitch, transition.fade),
      aimBlend
    )
    bladeRollAngle = THREE.MathUtils.lerp(
      bladeRollAngle,
      THREE.MathUtils.lerp(from.bladeRoll, to.bladeRoll, transition.fade),
      aimBlend
    )
    mainSword.group.rotation.set(
      THREE.MathUtils.lerp(stage.mainSwordTiltX, bladePitch, aimReveal) + pointer.y * 0.08,
      -0.18 + Math.sin(cycle) * 0.42 + pointer.x * 0.2 + stage.mainSwordSpin,
      THREE.MathUtils.lerp(stage.mainSwordTiltZ, bladeRollAngle, aimReveal) +
        stage.mainSwordInvert +
        Math.sin(cycle * 2) * 0.04 +
        stage.mainSwordTremble
    )
    swordBaseRotation.copy(mainSword.group.quaternion)
    const invertRatio = stage.mainSwordInvert / Math.PI
    const plantedDrape = introTime < IMPACT_SECONDS ? 0.12 : 0.88 + Math.sin(cycle * 5) * 0.12
    mainSword.tasselGroup.rotation.z =
      (plantedDrape - Math.sin(cycle * 2) * 0.05) * invertRatio + Math.sin(cycle * 2) * 0.05
    mainSword.tasselGroup.rotation.x = invertRatio * (introTime < IMPACT_SECONDS ? 0.08 : 0.38)
    const mainScale = (compact ? 0.5 : 0.68) * stage.mainSwordScale * (1 + gather * 0.04 + pulse * 0.055)
    mainSword.group.scale.setScalar(mainScale)
    if (tiltingSword) {
      // Pin the hilt and camera while the tip follows the pointer in the screen plane.
      mainSword.group.scale.setScalar(tiltScale)
      mainSword.group.quaternion.copy(tiltRotation)
      hiltOffset.set(0, MAIN_SWORD_PIVOT_Y * tiltScale, 0).applyQuaternion(tiltRotation)
      mainSword.group.position.copy(tiltPivot).sub(hiltOffset)
    } else if (!compact) {
      hiltOffset.set(0, MAIN_SWORD_PIVOT_Y * mainScale, 0).applyQuaternion(swordBaseRotation)
      hiltWorld.copy(mainSword.group.position).add(hiltOffset)
      // Settle the guard at the formation heart; the point sweeps around this socket.
      hiltWorld.lerp(position.set(HEART_X, HEART_Y - 0.24 + hoverWave, 0.1), aimReveal)
      // Fade manual tilt out during the opening so the impact remains aligned with the ground.
      tiltDelta.identity().slerp(swordTilt, THREE.MathUtils.smoothstep(introTime, 3.24, INTRO_SECONDS))
      mainSword.group.quaternion.premultiply(tiltDelta)
      hiltOffset.set(0, MAIN_SWORD_PIVOT_Y * mainScale, 0).applyQuaternion(mainSword.group.quaternion)
      mainSword.group.position.copy(hiltWorld).sub(hiltOffset)
    }
    // Separate axially before bringing the mouth across the point. Reversing follows
    // the exact same path, so neither a quick second click nor a formation change clips the case.
    const extend = THREE.MathUtils.smoothstep(sheathTravel, 0, 0.34)
    const align = THREE.MathUtils.smoothstep(sheathTravel, 0.34, 0.5)
    const insert = THREE.MathUtils.smoothstep(sheathTravel, 0.5, 1)
    const reach = extend * (1 - insert)
    if (sheathTravel > 0) {
      hiltOffset.set(0, MAIN_SWORD_PIVOT_Y * mainScale, 0).applyQuaternion(mainSword.group.quaternion)
      hiltWorld.copy(mainSword.group.position).add(hiltOffset)
      hiltWorld.y += extend * 0.95
      hiltWorld.z += extend * 0.48
      mainSword.group.quaternion.slerp(restingRotation, extend)
      mainSword.group.scale.multiplyScalar(1 - reach * 0.21)
      hiltOffset.set(0, (MAIN_SWORD_PIVOT_Y + 2.32 * reach) * mainSword.group.scale.y, 0)
      mainSword.group.position.copy(hiltWorld).sub(hiltOffset.applyQuaternion(mainSword.group.quaternion))
    }
    const scabbard = mainSword.scabbard
    scabbard.visible = !compact && introFactor > 0.55
    if (scabbard.visible) {
      const reveal = THREE.MathUtils.smoothstep(introFactor, 0.55, 0.98)
      position.set(-1.34 * (1 - align), MAIN_SWORD_PIVOT_Y + 4.56 * reach, -0.46 * (1 - align))
      position.multiplyScalar(mainSword.group.scale.y).applyQuaternion(mainSword.group.quaternion)
      scabbard.position.copy(mainSword.group.position).add(position)
      scabbard.quaternion.copy(mainSword.group.quaternion)
      scabbard.rotateZ((0.13 + Math.sin(cycle * 3) * 0.04) * (1 - extend))
      scabbard.rotateY(0.23 * (1 - extend))
      scabbard.scale.copy(mainSword.group.scale).multiplyScalar(reveal)
    }
    silkDrape.slerp(quaternion.copy(mainSword.group.quaternion).invert(), 1 - Math.exp(-5 * dt))
    mainSword.tasselGroup.quaternion.slerp(silkDrape, aimReveal * (0.72 + 0.28 * extend))
    mainSword.bladeMaterial.emissiveIntensity = 0.22 + stage.mainSwordGlow * 0.95 + (options.boost ? 0.24 : 0)
    mainSword.glow.material.opacity = 0.2 + stage.mainSwordGlow * 0.48 + (options.boost ? 0.14 : 0)
    mainSword.glow.scale.setScalar(4.8 + gather * 1.6 + pulse * 2.1 + ambientPulse * 0.8)
    const sealedAura = THREE.MathUtils.smoothstep(insert, 0.66, 1)
    mainSword.bladeAura.visible = !compact
    mainSword.bladeAura.scale.set(1 + sealedAura * 0.8, 1 - sealedAura * 0.58, 1 + sealedAura * 0.8)
    mainSword.bladeAura.position.y = -sealedAura * 1.03
    tipStar.visible = !compact && insert === 0
    guardLight.visible = !compact
    mainSword.glow.visible = insert < 0.01
    mainSword.bladeFlow.visible = !compact && flowTime < 1.45 && insert === 0
    mainSword.flowHead.value = (flowTime - 0.12) * 1.32
    const tipFlash = Math.exp(-(((flowTime - 0.91) / 0.14) ** 2))
    const guardFlash = Math.exp(-(((flowTime - 0.13) / 0.18) ** 2))
    mainSword.bladeAura.rotation.y = cycle * 9
    mainSword.auraMaterial.opacity = (0.32 + combinedEnergy * 0.28 + tipFlash * 0.34) * stage.mainSwordScale
    mainSword.auraMaterial.opacity *= 1 - THREE.MathUtils.smoothstep(insert, 0, 0.23) + sealedAura * 1.9
    const shimmer = 0.5 + 0.5 * Math.sin(cycle * 48)
    mainSword.inlayMaterial.emissiveIntensity = 1.4 + shimmer * 0.6 + pulse * 1.5
    tipStar.scale.setScalar(0.64 + shimmer * 0.3 + pulse * 0.82 + tipFlash * 1.6)
    tipStar.material.rotation = 0.28 + 0.17 * Math.sin(cycle * 4)
    guardLight.scale.setScalar(0.88 + shimmer * 0.22 + pulse * 0.52 + guardFlash * 1.1)
    guardLight.material.opacity = 0.63 + combinedEnergy * 0.28

    if (pillarSprite.visible) {
      pillarMaterial.opacity = Math.min(0.64, stage.pillarIntensity * 0.48 + (options.boost ? 0.12 : 0))
      const beamNarrow = stage.descentBeam > 0.05 ? 0.95 : 1.65
      pillarSprite.scale.set(
        beamNarrow + pulse * 1.1,
        8.8 + stage.pillarIntensity * 3.2,
        beamNarrow + pulse * 1.1
      )
    }
    if (flareSprite.visible) {
      const flareAlpha = Math.max(
        pulse * 0.65,
        ambientPulse * 0.25,
        stage.introShockwave > 0 ? Math.sin(stage.introShockwave * Math.PI) * 0.58 : 0
      )
      flareMaterial.opacity = flareAlpha + (options.boost ? 0.12 : 0)
      const flareSize = 2.1 + flareAlpha * 3.1
      flareSprite.scale.set(flareSize, flareSize, 1)
      flareMaterial.rotation = cycle * 1.5
    }

    const primaryWave = stage.climaxShockwaveA > 0 ? stage.climaxShockwaveA : stage.introShockwave
    updateShockwave(
      shockwaves[0]!,
      primaryWave,
      stage.climaxShockwaveA > 0 ? 7.4 : 8.2,
      stage.climaxShockwaveA > 0 ? 0.64 : 0.24,
      compact
    )
    updateShockwave(shockwaves[1]!, stage.climaxShockwaveB, 6.4, 0.54, compact)
    updateShockwave(shockwaves[2]!, manualPulseProgress, 5.8, 0.58, compact)

    const showGround =
      !compact && (stage.groundReveal > 0.01 || stage.debrisOpacity > 0.01 || stage.groundShockwave > 0)
    groundImpact.group.visible = showGround
    if (showGround) {
      const gScale = 0.72 + stage.groundReveal * 0.28
      groundImpact.plinth.scale.set(gScale, stage.groundReveal, gScale)
      groundImpact.plinthMaterial.transparent = stage.groundReveal < 0.96
      groundImpact.plinthMaterial.opacity = stage.groundReveal
      groundImpact.plinthMaterial.depthWrite = stage.groundReveal > 0.25

      groundImpact.crackDiscMaterial.opacity = stage.crackReveal * 0.72
      groundImpact.crackDisc.scale.setScalar(0.42 + stage.crackReveal * 0.58)
      groundImpact.craterGlowMaterial.opacity = Math.min(
        0.65,
        stage.crackReveal * 0.42 +
          (stage.groundShockwave > 0 ? Math.sin(stage.groundShockwave * Math.PI) * 0.35 : 0)
      )
      groundImpact.craterGlow.scale.setScalar(0.65 + stage.crackReveal * 0.75)

      for (const fissure of groundImpact.fissures) {
        const span = Math.max(0.24, 1 - fissure.delay)
        const branchU = Math.min(1, Math.max(0, (stage.crackReveal - fissure.delay) / span))
        fissure.mesh.visible = branchU > 0.01
        if (branchU > 0.01) {
          fissure.mesh.scale.setScalar(branchU)
          fissure.material.opacity = Math.min(0.95, branchU * 0.94) * stage.groundReveal
        }
      }

      groundImpact.stoneMaterial.opacity = stage.debrisOpacity * 0.92
      groundImpact.crystalMaterial.opacity = stage.debrisOpacity * 0.96
      const showDebris = stage.debrisOpacity > 0.01
      for (const shard of groundImpact.debris) {
        shard.mesh.visible = showDebris
        if (!showDebris) continue
        const r = shard.radius * (0.38 + stage.debrisLift * 0.72)
        const a = shard.angle + stage.debrisLift * shard.spin * 0.08
        const yLift = shard.baseY + stage.debrisLift * shard.lift + Math.sin(time * 2.4 + shard.angle) * 0.05
        shard.mesh.position.set(Math.cos(a) * r, yLift, Math.sin(a) * r)
        shard.mesh.rotation.set(time * shard.spin, a + time * 0.9, time * shard.spin * 0.5)
      }

      if (stage.groundShockwave > 0 && stage.groundShockwave < 1) {
        const easedWave = 1 - Math.pow(1 - stage.groundShockwave, 3)
        const waveSize = 0.55 + easedWave * 6.8
        groundImpact.shockwave.visible = true
        groundImpact.shockwave.scale.set(waveSize, waveSize, 1)
        groundImpact.shockwaveMaterial.opacity =
          Math.sin(stage.groundShockwave * Math.PI) * (1 - stage.groundShockwave * 0.35) * 0.78
      } else {
        groundImpact.shockwave.visible = false
        groundImpact.shockwaveMaterial.opacity = 0
      }
    }

    const ringBaseScale = compact ? 0.52 : 0.88
    ringGroup.scale.setScalar(ringBaseScale * (1 + pulse * 0.12 + ambientPulse * 0.04))
    ringGroup.rotation.z = cycle + (1 - stage.ringUnfold) * Math.PI * 1.2
    ringGroup.rotation.x = 0.13 + Math.sin(cycle) * 0.035
    ringMeshes.forEach((mesh, index) => {
      const s = Math.max(0.001, stage.ringRadiiScales[index] ?? 1)
      mesh.scale.setScalar(s)
    })
    ringMaterials.forEach((material, index) => {
      const reveal = Math.min(1, Math.max(0, (stage.ringRadiiScales[index] ?? 1) * 1.15))
      material.opacity =
        (0.11 +
          index * 0.025 +
          gather * 0.24 +
          pulse * 0.34 +
          ambientPulse * 0.12 +
          (options.boost ? 0.07 : 0)) *
        reveal
    })
    spokesMesh.scale.setScalar(Math.max(0.001, stage.ringUnfold))
    spokeMaterial.opacity = (0.07 + gather * 0.18 + pulse * 0.22 + ambientPulse * 0.08) * stage.ringUnfold

    floorGroup.visible = !compact
    if (floorGroup.visible) {
      floorGroup.rotation.y = cycle * 0.5
      floorMaterials.forEach((material, index) => {
        material.opacity =
          (0.06 + index * 0.012 + gather * 0.1 + pulse * 0.2 + ambientPulse * 0.06) * stage.ringUnfold
      })
      floorTickMaterial.opacity = (0.16 + gather * 0.14 + pulse * 0.3) * stage.ringUnfold
    }
    glyphs.forEach((sprite, index) => {
      if (!sprite.visible) return
      const glyphReveal = Math.min(1, Math.max(0, (introTime - 0.65 - index * 0.08) / 0.35))
      sprite.material.opacity = (0.5 + gather * 0.28 + pulse * 0.35 + ambientPulse * 0.14) * glyphReveal
      sprite.scale.setScalar(0.42 * (0.4 + glyphReveal * 0.6) * (1 + pulse * 0.15))
    })

    const gourdLift = (1 - stage.gourdReveal) * -0.95
    gourd.group.position.set(
      -0.56 + Math.sin(cycle * 0.5) * 0.1,
      -1.16 + Math.sin(time * 1.3) * 0.06 + gourdLift,
      0.82 + Math.cos(cycle * 0.5) * 0.08
    )
    gourd.group.scale.setScalar(0.5 * (0.35 + stage.gourdReveal * 0.65))
    gourd.group.rotation.set(
      0.06 + stage.gourdPour * 0.12,
      -0.24 + Math.sin(time * 0.6) * 0.16,
      0.08 + stage.gourdTilt
    )
    gourd.body.scale.setScalar(1 + Math.sin(time * 1.3 + 0.6) * 0.02)
    gourd.cork.position.y = 1.11 + stage.corkLift
    gourd.cork.rotation.z = stage.gourdPour * 0.3
    gourd.cord.rotation.z = Math.sin(time * 1.6 + 1) * 0.06 + stage.gourdPour * 0.1
    gourd.sealMaterial.color.setRGB(1, 1, 1).lerp(brightGold, pulse * 0.6)
    gourd.sealMaterial.opacity = 0.75 + gather * 0.25

    const vaporAttribute = gourd.vapor.geometry.getAttribute('position') as THREE.BufferAttribute
    const vaporArray = vaporAttribute.array as Float32Array
    for (let v = 0; v < 24; v++) {
      const life = time * 0.35 + v / 24 - Math.floor(time * 0.35 + v / 24)
      vaporArray[v * 3] = Math.sin(time * 2 + v * 1.7) * 0.06 * life
      vaporArray[v * 3 + 1] = 1.2 + life * 1.1
      vaporArray[v * 3 + 2] = Math.cos(time * 1.8 + v) * 0.05 * life
    }
    vaporAttribute.needsUpdate = true
    gourd.vapor.visible = !compact && stage.vaporIntensity > 0.02
    gourd.vaporMaterial.opacity = stage.vaporIntensity * (options.tier === 'light' ? 0.25 : 0.5)
    gourd.vaporMaterial.size = 0.04 + stage.vaporIntensity * 0.03
    gourd.pourRibbon.visible = !compact && stage.gourdPour > 0.05
    gourd.pourMaterial.opacity = stage.gourdPour * 0.45
    gourd.pourRibbon.rotation.z = Math.sin(time * 1.2) * 0.05
    gourd.pourRibbon.scale.setScalar(0.8 + stage.gourdPour * 0.4)
    gourdLight.position.set(
      gourd.group.position.x,
      gourd.group.position.y + 0.4,
      gourd.group.position.z + 1.2
    )
    gourdLight.intensity = stage.gourdGlow

    const linkCount = sampleFormationLinks(time, linkPositions, linkWeights, linkColorIdx)
    const showLinks = !compact && options.tier === 'full' && linkCount > 0
    links.visible = showLinks
    if (showLinks) {
      for (let v = 0; v < linkCount * 2; v++) {
        if (depthOn) {
          linkPositions[v * 3 + 2] =
            DEPTH_FOCUS_Z + ((linkPositions[v * 3 + 2] ?? 0) - depth.center) * depth.gain
        }
        const base = linkColorIdx[v] === 1 ? jade : linkColorIdx[v] === 2 ? seal : gold
        const w = linkWeights[v] ?? 0
        linkColors[v * 3] = base.r * w
        linkColors[v * 3 + 1] = base.g * w
        linkColors[v * 3 + 2] = base.b * w
      }
      linkGeometry.getAttribute('position').needsUpdate = true
      linkGeometry.getAttribute('color').needsUpdate = true
      linkGeometry.setDrawRange(0, linkCount * 2)
      linkMaterial.opacity = 0.42 + pulse * 0.28 + ambientPulse * 0.1
    }

    particles.rotation.z = cycle
    particles.rotation.y = Math.sin(cycle) * 0.08
    particles.scale.setScalar(0.35 + stage.particleReveal * 0.65 + pulse * 0.06)
    particleMaterial.opacity =
      (0.38 + gather * 0.22 + pulse * 0.22 + ambientPulse * 0.08) * stage.particleReveal

    tipHalo.value.z = 0
    if (!compact && aimReveal > 0) {
      mainSword.group.updateWorldMatrix(true, false)
      tipScreen.set(0, MAIN_SWORD_TIP_Y, 0).applyMatrix4(mainSword.group.matrixWorld)
      tipScreen.applyMatrix4(camera.matrixWorldInverse)
      if (tipScreen.z < -camera.near) {
        const height = renderer.domElement.height
        const radius = (height * camera.projectionMatrix.elements[5] * mainScale * 0.41) / -tipScreen.z
        tipScreen.applyMatrix4(camera.projectionMatrix)
        tipHalo.value.set(
          (tipScreen.x + 1) * 0.5 * renderer.domElement.width,
          (tipScreen.y + 1) * 0.5 * height,
          radius * aimReveal
        )
      }
    }
    renderer.render(scene, camera)
    return weights.phaseLabel
  }

  update(initialOptions)

  return {
    resize,
    update,
    render,
    formationIndex: () => lastFormationIndex,
    triggerPulse,
    setPointer(x: number, y: number) {
      pointerTarget.set(Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y)))
    },
    beginOrbit,
    orbitBy,
    endOrbit,
    zoomBy,
    resetView,
    projectSwordTip,
    beginSwordTilt,
    moveSwordTilt,
    endSwordTilt,
    dispose(releaseContext = true) {
      if (disposed) return
      disposed = true
      disposeSceneResources(scene, renderer, releaseContext)
    }
  }
}
