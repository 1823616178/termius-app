import * as THREE from 'three'
import {
  createFlyingSwordGeometry,
  createGlyphSprite,
  createGlowTexture,
  createGourd,
  createMainSword,
  createWineBowl,
  type MainSwordModel,
  type WineBowlModel
} from './sword-models'
import { formationCount, gatheringStrength, LOOP_SECONDS, sampleSwordPose } from './sword-motion'

export interface SwordSceneOptions {
  variant: 'welcome' | 'compact'
  tier: 'full' | 'light'
  state: string
  boost: boolean
  palette: { accentA: string; accentB: string; seal: string; text: string }
}

export interface SwordScene {
  resize(width: number, height: number, dpr: number): void
  setPointer(x: number, y: number): void
  update(options: SwordSceneOptions): void
  render(timeSeconds: number): void
  dispose(): void
}

interface Trail {
  line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
  positions: Float32Array
  swordIndex: number
}

const UP = new THREE.Vector3(0, 1, 0)
const GLYPHS = ['☰', '☱', '☲', '☳', '☴', '☵', '☶', '☷']

function disposeSceneResources(scene: THREE.Scene, renderer: THREE.WebGLRenderer): void {
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
  renderer.forceContextLoss()
  scene.clear()
}

export function createSwordScene(canvas: HTMLCanvasElement, initialOptions: SwordSceneOptions): SwordScene {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance'
  })
  const scene = new THREE.Scene()
  try {
    return buildSwordScene(renderer, scene, initialOptions)
  } catch (error) {
    disposeSceneResources(scene, renderer)
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
  renderer.toneMappingExposure = 1.18
  renderer.setClearColor(0x000000, 0)
  scene.fog = new THREE.FogExp2('#080b0a', 0.026)
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 60)
  camera.position.set(0, 1.1, 9.2)

  const ambient = new THREE.HemisphereLight('#d9e7df', '#17100b', 1.45)
  scene.add(ambient)
  const keyLight = new THREE.DirectionalLight('#f4f0df', 4.2)
  keyLight.position.set(-3, 5, 6)
  scene.add(keyLight)
  const rimLight = new THREE.PointLight('#5ec4a6', 24, 15, 1.5)
  rimLight.position.set(3.2, 1.8, 3.5)
  scene.add(rimLight)
  const wineLight = new THREE.PointLight('#d98b38', 10, 7, 1.8)
  wineLight.position.set(-2.4, -0.2, 2.8)
  scene.add(wineLight)

  const flyingGeometry = createFlyingSwordGeometry()
  const flyingMaterial = new THREE.MeshStandardMaterial({
    color: '#e5eee9',
    metalness: 0.86,
    roughness: 0.25,
    emissive: '#254c43',
    emissiveIntensity: 0.42,
    flatShading: true
  })
  const swords = new THREE.InstancedMesh(flyingGeometry, flyingMaterial, 144)
  swords.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  swords.frustumCulled = false
  scene.add(swords)

  const formation = new THREE.Group()
  scene.add(formation)
  swords.removeFromParent()
  formation.add(swords)

  const foregroundMaterial = flyingMaterial.clone()
  foregroundMaterial.color.set('#f1ddae')
  foregroundMaterial.emissive.set('#8a6530')
  foregroundMaterial.emissiveIntensity = 0.55
  const foreground = Array.from({ length: 4 }, () => {
    const sword = new THREE.Mesh(flyingGeometry, foregroundMaterial)
    sword.frustumCulled = false
    scene.add(sword)
    return sword
  })

  const trails: Trail[] = []
  const trailGroup = new THREE.Group()
  formation.add(trailGroup)
  for (let index = 0; index < 16; index++) {
    const positions = new Float32Array(10 * 3)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage)
    )
    const material = new THREE.LineBasicMaterial({
      color: '#5ec4a6',
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
    const line = new THREE.Line(geometry, material)
    line.frustumCulled = false
    trailGroup.add(line)
    trails.push({ line, positions, swordIndex: index * 9 })
  }

  const glowTexture = createGlowTexture()
  const mainSword: MainSwordModel = createMainSword(glowTexture)
  scene.add(mainSword.group)

  const ringGroup = new THREE.Group()
  const ringMaterials: THREE.MeshBasicMaterial[] = []
  for (const [index, radius] of [1.18, 1.92, 2.55].entries()) {
    const material = new THREE.MeshBasicMaterial({
      color: index === 1 ? '#5ec4a6' : '#d4af63',
      transparent: true,
      opacity: 0.2 - index * 0.025,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius, radius + 0.012 + index * 0.006, 96), material)
    ringGroup.add(ring)
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
      Math.cos(angle) * 2.52,
      Math.sin(angle) * 2.52,
      0
    )
  }
  spokesGeometry.setAttribute('position', new THREE.Float32BufferAttribute(spokePositions, 3))
  const spokeMaterial = new THREE.LineBasicMaterial({ color: '#d4af63', transparent: true, opacity: 0.08 })
  ringGroup.add(new THREE.LineSegments(spokesGeometry, spokeMaterial))
  const glyphs = GLYPHS.map((glyph, index) => {
    const sprite = createGlyphSprite(glyph, '#d4af63')
    const angle = (index / GLYPHS.length) * Math.PI * 2
    sprite.position.set(Math.cos(angle) * 2.26, Math.sin(angle) * 2.26, 0.02)
    ringGroup.add(sprite)
    return sprite
  })
  ringGroup.position.set(0.9, 0.1, -1.45)
  ringGroup.rotation.set(0.13, -0.08, 0)
  scene.add(ringGroup)

  const gourd = createGourd()
  gourd.position.set(-1.25, -0.7, 0.9)
  gourd.scale.setScalar(0.54)
  scene.add(gourd)
  const wine: WineBowlModel = createWineBowl()
  wine.group.position.set(2.65, -0.95, 0.8)
  wine.group.scale.setScalar(0.76)
  scene.add(wine.group)

  const particlePositions = new Float32Array(420 * 3)
  for (let index = 0; index < 420; index++) {
    const angle = index * 2.399963
    const radius = 1.4 + ((index * 37) % 100) / 12
    particlePositions[index * 3] = Math.cos(angle) * radius + 0.6
    particlePositions[index * 3 + 1] = -3.4 + ((index * 61) % 100) / 14
    particlePositions[index * 3 + 2] = -5 + ((index * 29) % 100) / 12
  }
  const particleGeometry = new THREE.BufferGeometry()
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3))
  const particleMaterial = new THREE.PointsMaterial({
    color: '#d4af63',
    size: 0.025,
    transparent: true,
    opacity: 0.52,
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
  const gold = new THREE.Color(options.palette.accentA)
  const jade = new THREE.Color(options.palette.accentB)
  const seal = new THREE.Color(options.palette.seal)
  const steel = new THREE.Color(options.palette.text)
  const pointerTarget = new THREE.Vector2()
  const pointer = new THREE.Vector2()
  let disposed = false

  function update(nextOptions: SwordSceneOptions): void {
    options = { ...nextOptions, palette: { ...nextOptions.palette } }
    gold.set(options.palette.accentA)
    jade.set(options.palette.accentB)
    seal.set(options.palette.seal)
    steel.set(options.palette.text).lerp(jade, 0.16)
    const isError = options.state === 'error'
    const accent = isError ? seal : jade
    flyingMaterial.emissive.copy(accent).multiplyScalar(0.22)
    foregroundMaterial.emissive.copy(isError ? seal : gold).multiplyScalar(0.42)
    mainSword.bladeMaterial.color.copy(steel)
    mainSword.bladeMaterial.emissive.copy(accent).multiplyScalar(0.2)
    mainSword.goldMaterial.color.copy(gold)
    mainSword.tasselMaterial.color.copy(seal)
    mainSword.glow.material.color.copy(accent)
    rimLight.color.copy(accent)
    particleMaterial.color.copy(gold)
    spokeMaterial.color.copy(gold)
    ringMaterials.forEach((material, index) => material.color.copy(index === 1 ? accent : gold))
    glyphs.forEach((sprite) => sprite.material.color.copy(gold))
    trails.forEach((trail, index) => trail.line.material.color.copy(index % 3 === 0 ? gold : accent))
    swords.count = formationCount(options.tier, options.variant === 'compact')
    const compact = options.variant === 'compact'
    formation.scale.setScalar(compact ? 0.48 : 1)
    formation.position.x = compact ? -0.9 * 0.48 : 0
    ringGroup.position.x = compact ? 0 : 0.9
    ringGroup.scale.setScalar(compact ? 0.52 : 0.86)
    gourd.visible = !compact
    wine.group.visible = !compact
    particles.visible = !compact
    foreground.forEach((sword) => {
      sword.visible = !compact && options.tier === 'full'
    })
    trailGroup.visible = !compact && options.tier === 'full'
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
    camera.position.z = compact ? 6.8 : 9.2
    camera.updateProjectionMatrix()
  }

  function render(timeSeconds: number): void {
    if (disposed) return
    const time = Number.isFinite(timeSeconds) ? timeSeconds : 0
    const phase = (((time % LOOP_SECONDS) + LOOP_SECONDS) % LOOP_SECONDS) / LOOP_SECONDS
    const cycle = phase * Math.PI * 2
    const gather = gatheringStrength(time)
    const compact = options.variant === 'compact'
    const count = formationCount(options.tier, compact)

    for (let index = 0; index < count; index++) {
      const pose = sampleSwordPose(index, count, time)
      position.set(pose.position.x, pose.position.y, pose.position.z)
      direction.set(pose.direction.x, pose.direction.y, pose.direction.z).normalize()
      quaternion.setFromUnitVectors(UP, direction)
      const size = pose.scale * (compact ? 0.85 : 1)
      scale.set(size, size, size)
      matrix.compose(position, quaternion, scale)
      swords.setMatrixAt(index, matrix)
      instanceColor
        .copy(steel)
        .lerp(jade, 0.28)
        .lerp(gold, pose.glow * 0.38)
      if (options.state === 'error') instanceColor.lerp(seal, 0.7)
      swords.setColorAt(index, instanceColor)
    }
    swords.instanceMatrix.needsUpdate = true
    if (swords.instanceColor) swords.instanceColor.needsUpdate = true

    if (trailGroup.visible) {
      for (const trail of trails) {
        for (let point = 0; point < 10; point++) {
          const pose = sampleSwordPose(trail.swordIndex % Math.max(1, count), count, time - point * 0.045)
          trail.positions[point * 3] = pose.position.x
          trail.positions[point * 3 + 1] = pose.position.y
          trail.positions[point * 3 + 2] = pose.position.z
        }
        trail.line.geometry.getAttribute('position').needsUpdate = true
        trail.line.material.opacity = 0.12 + gather * 0.28 + (options.boost ? 0.08 : 0)
      }
    }

    foreground.forEach((sword, index) => {
      if (!sword.visible) return
      const angle = cycle + (index / foreground.length) * Math.PI * 2
      sword.position.set(2 + Math.cos(angle) * 3.2, Math.sin(angle) * 1.85, 1.8 + Math.sin(angle) * 0.8)
      direction.set(-Math.sin(angle) * 3.2, Math.cos(angle) * 1.85, Math.cos(angle) * 0.8).normalize()
      sword.quaternion.setFromUnitVectors(UP, direction)
      sword.scale.setScalar(0.48 + index * 0.045)
    })

    mainSword.group.position.set(compact ? 0 : 0.9, 0.28 + Math.sin(cycle * 2) * 0.08, 0)
    mainSword.group.rotation.set(
      0.08 + pointer.y * 0.08,
      -0.18 + Math.sin(cycle) * 0.42 + pointer.x * 0.2,
      -0.12 + Math.sin(cycle * 2) * 0.04
    )
    const mainScale = (compact ? 0.5 : 0.68) * (1 + gather * 0.035)
    mainSword.group.scale.setScalar(mainScale)
    mainSword.bladeMaterial.emissiveIntensity = 0.22 + gather * 0.8 + (options.boost ? 0.2 : 0)
    mainSword.glow.material.opacity = 0.2 + gather * 0.42 + (options.boost ? 0.12 : 0)
    mainSword.glow.scale.setScalar(4.8 + gather * 1.7)

    ringGroup.rotation.z = cycle
    ringGroup.rotation.x = 0.13 + Math.sin(cycle) * 0.035
    ringMaterials.forEach((material, index) => {
      material.opacity = 0.1 + index * 0.025 + gather * 0.24 + (options.boost ? 0.06 : 0)
    })
    spokeMaterial.opacity = 0.07 + gather * 0.2

    gourd.position.y = -0.7 + Math.sin(cycle * 2) * 0.07
    gourd.rotation.set(0.06, -0.24 + Math.sin(cycle) * 0.16, 0.08 + Math.sin(cycle * 2) * 0.035)
    wine.liquid.material.emissiveIntensity = 0.38 + gather * 0.5
    wine.ripples.forEach((ripple, index) => {
      const ripplePhase = (phase * 4 + index * 0.5) % 1
      const size = 0.35 + ripplePhase * 1.85
      ripple.scale.set(size, size, size)
      ripple.material.opacity = (1 - ripplePhase) * (0.18 + gather * 0.42)
    })
    wine.droplets.forEach((droplet, index) => {
      const angle = cycle * 2 + (index / wine.droplets.length) * Math.PI * 2
      const lift = (Math.sin(angle) + 1) * 0.5
      droplet.position.set(
        Math.cos(angle) * 0.26,
        0.28 + lift * (0.18 + gather * 0.28),
        Math.sin(angle) * 0.26
      )
      droplet.scale.setScalar(0.55 + gather * 0.75)
    })

    particles.rotation.z = cycle
    particles.rotation.y = Math.sin(cycle) * 0.08
    particleMaterial.opacity = 0.36 + gather * 0.28
    pointer.lerp(pointerTarget, 0.065)
    camera.position.x = pointer.x * 0.3
    camera.position.y = (compact ? 0.2 : 1.1) + pointer.y * 0.16
    camera.lookAt(compact ? 0 : 0.35, 0, 0)
    renderer.render(scene, camera)
  }

  update(initialOptions)

  return {
    resize,
    update,
    render,
    setPointer(x: number, y: number) {
      pointerTarget.set(Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y)))
    },
    dispose() {
      if (disposed) return
      disposed = true
      disposeSceneResources(scene, renderer)
    }
  }
}
