import * as THREE from 'three'
import {
  createFlareTexture,
  createFlyingSwordGeometry,
  createGlowTexture,
  createGlyphSprite,
  createGourd,
  createGroundImpact,
  createMainSword,
  createPillarTexture,
  createShockwaveTexture,
  createWineBowl,
  type GroundImpactModel,
  type MainSwordModel,
  type WineBowlModel
} from './sword-models'
import {
  formationCount,
  IMPACT_SECONDS,
  INTRO_SECONDS,
  sampleIntroSwordPose,
  sampleStageState
} from './sword-motion'

export interface SwordSceneOptions {
  variant: 'welcome' | 'compact'
  tier: 'full' | 'light'
  state: string
  boost: boolean
  palette: { accentA: string; accentB: string; seal: string; text: string; bg?: string }
}

export interface SwordScene {
  resize(width: number, height: number, dpr: number): void
  setPointer(x: number, y: number): void
  update(options: SwordSceneOptions): void
  render(timeSeconds: number, introTimeSeconds?: number): string
  triggerPulse(): void
  dispose(): void
}

interface Trail {
  line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
  positions: Float32Array
  colors: Float32Array
  swordIndex: number
}

const UP = new THREE.Vector3(0, 1, 0)
const GLYPHS = ['☰', '☱', '☲', '☳', '☴', '☵', '☶', '☷']
const TRAIL_COUNT = 32
const TRAIL_POINTS = 14

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
  renderer.toneMappingExposure = 1.22
  renderer.setClearColor(0x000000, 0)
  const fog = new THREE.FogExp2(options.palette.bg || '#080b0a', 0.023)
  scene.fog = fog
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 60)
  camera.position.set(0, 1.1, 9.2)

  const ambient = new THREE.HemisphereLight('#d9e7df', '#17100b', 1.48)
  scene.add(ambient)
  const keyLight = new THREE.DirectionalLight('#f4f0df', 4.3)
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
    roughness: 0.24,
    emissive: '#254c43',
    emissiveIntensity: 0.44,
    flatShading: true
  })
  const swords = new THREE.InstancedMesh(flyingGeometry, flyingMaterial, 144)
  swords.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  swords.frustumCulled = false
  const initColor = new THREE.Color('#e5eee9')
  for (let i = 0; i < 144; i++) swords.setColorAt(i, initColor)

  const formation = new THREE.Group()
  formation.add(swords)
  scene.add(formation)

  const foregroundMaterial = flyingMaterial.clone()
  foregroundMaterial.color.set('#f1ddae')
  foregroundMaterial.emissive.set('#8a6530')
  foregroundMaterial.emissiveIntensity = 0.58
  const foreground = Array.from({ length: 4 }, () => {
    const sword = new THREE.Mesh(flyingGeometry, foregroundMaterial)
    sword.frustumCulled = false
    scene.add(sword)
    return sword
  })

  const guardianMaterial = flyingMaterial.clone()
  guardianMaterial.color.set('#e9f4ee')
  guardianMaterial.emissive.set('#5ec4a6')
  guardianMaterial.emissiveIntensity = 0.62
  const guardians = Array.from({ length: 4 }, () => {
    const sword = new THREE.Mesh(flyingGeometry, guardianMaterial)
    sword.frustumCulled = false
    scene.add(sword)
    return sword
  })

  const trails: Trail[] = []
  const trailGroup = new THREE.Group()
  formation.add(trailGroup)
  for (let index = 0; index < TRAIL_COUNT; index++) {
    const positions = new Float32Array(TRAIL_POINTS * 3)
    const colors = new Float32Array(TRAIL_POINTS * 3)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage)
    )
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage))
    const material = new THREE.LineBasicMaterial({
      color: '#ffffff',
      vertexColors: true,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
    const line = new THREE.Line(geometry, material)
    line.frustumCulled = false
    trailGroup.add(line)
    trails.push({ line, positions, colors, swordIndex: Math.floor((index * 144) / TRAIL_COUNT) })
  }

  const glowTexture = createGlowTexture()
  const mainSword: MainSwordModel = createMainSword(glowTexture)
  scene.add(mainSword.group)

  const pillarTexture = createPillarTexture()
  const pillarMaterial = new THREE.SpriteMaterial({
    map: pillarTexture,
    color: '#d4af63',
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  })
  const pillarSprite = new THREE.Sprite(pillarMaterial)
  pillarSprite.position.set(0.9, 0.45, -0.35)
  pillarSprite.scale.set(2.4, 9.6, 1)
  scene.add(pillarSprite)

  const flareTexture = createFlareTexture()
  const flareMaterial = new THREE.SpriteMaterial({
    map: flareTexture,
    color: '#f2dab0',
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  })
  const flareSprite = new THREE.Sprite(flareMaterial)
  flareSprite.position.set(0.9, 0.28, -0.25)
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
    mesh.position.set(0.9, 0.24, -0.22)
    mesh.rotation.set(0.13, -0.08, 0)
    mesh.visible = false
    scene.add(mesh)
    return { mesh, material }
  })

  const groundImpact: GroundImpactModel = createGroundImpact(shockwaveTexture, glowTexture)
  groundImpact.group.position.set(0.9, -1.36, -0.04)
  groundImpact.group.rotation.set(0.32, 0, -0.04)
  groundImpact.group.visible = false
  scene.add(groundImpact.group)

  const ringGroup = new THREE.Group()
  const ringMeshes: THREE.Mesh[] = []
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
      Math.cos(angle) * 2.52,
      Math.sin(angle) * 2.52,
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
    size: 0.027,
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
  const trailColor = new THREE.Color()
  const brightGold = new THREE.Color('#fff1cc')
  const gold = new THREE.Color(options.palette.accentA)
  const jade = new THREE.Color(options.palette.accentB)
  const seal = new THREE.Color(options.palette.seal)
  const steel = new THREE.Color(options.palette.text)
  const pointerTarget = new THREE.Vector2()
  const pointer = new THREE.Vector2()
  let lastLoopTime = 0
  let manualPulseProgress = 0
  let disposed = false

  function update(nextOptions: SwordSceneOptions): void {
    options = { ...nextOptions, palette: { ...nextOptions.palette } }
    gold.set(options.palette.accentA)
    jade.set(options.palette.accentB)
    seal.set(options.palette.seal)
    steel.set(options.palette.text).lerp(jade, 0.16)
    fog.color.set(options.palette.bg || '#080b0a')
    const isError = options.state === 'error'
    const accent = isError ? seal : jade
    flyingMaterial.emissive.copy(accent).multiplyScalar(0.24)
    foregroundMaterial.emissive.copy(isError ? seal : gold).multiplyScalar(0.45)
    guardianMaterial.emissive.copy(accent).multiplyScalar(0.35)
    mainSword.bladeMaterial.color.copy(steel)
    mainSword.bladeMaterial.emissive.copy(accent).multiplyScalar(0.22)
    mainSword.goldMaterial.color.copy(gold)
    mainSword.tasselMaterial.color.copy(seal)
    mainSword.glow.material.color.copy(accent)
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
    swords.count = formationCount(options.tier, compact)
    formation.scale.setScalar(compact ? 0.48 : 1)
    formation.position.x = compact ? -0.9 * 0.48 : 0
    ringGroup.position.x = compact ? 0 : 0.9
    ringGroup.scale.setScalar(compact ? 0.52 : 0.86)
    gourd.visible = !compact
    wine.group.visible = !compact
    particles.visible = !compact
    pillarSprite.visible = !compact
    flareSprite.visible = !compact
    foreground.forEach((sword) => {
      sword.visible = !compact && options.tier === 'full'
    })
    guardians.forEach((sword) => {
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
    camera.updateProjectionMatrix()
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
    slot.mesh.scale.set(size, size, 1)
    slot.material.opacity = Math.sin(progress * Math.PI) * (1 - progress * 0.4) * baseOpacity
  }

  function triggerPulse(): void {
    if (!disposed) manualPulseProgress = 0.001
  }

  function render(timeSeconds: number, introTimeSeconds = INTRO_SECONDS): string {
    if (disposed) return ''
    const time = Number.isFinite(timeSeconds) ? timeSeconds : 0
    const introTime = Number.isFinite(introTimeSeconds) ? Math.max(0, introTimeSeconds) : INTRO_SECONDS
    const dt = lastLoopTime > 0 ? Math.min(0.05, Math.max(0.001, Math.abs(time - lastLoopTime))) : 0.016
    lastLoopTime = time

    if (manualPulseProgress > 0) {
      manualPulseProgress += dt / 1.05
      if (manualPulseProgress >= 1) manualPulseProgress = 0
    }

    const compact = options.variant === 'compact'
    const stage = sampleStageState(time, compact ? Math.max(introTime * 2.6, 0.8) : introTime, compact)
    const { weights } = stage
    const phase = weights.phase
    const cycle = phase * Math.PI * 2
    const gather = weights.gather
    const pulse = Math.max(
      weights.pulse,
      manualPulseProgress > 0 ? Math.sin(manualPulseProgress * Math.PI) * 0.75 : 0
    )
    const count = formationCount(options.tier, compact)

    for (let index = 0; index < count; index++) {
      const pose = sampleIntroSwordPose(index, count, time, introTime)
      if (pose.scale <= 0.0005) {
        scale.set(0, 0, 0)
        matrix.compose(position.set(0.9, 0.26, -0.35), quaternion.identity(), scale)
        swords.setMatrixAt(index, matrix)
        continue
      }
      position.set(pose.position.x, pose.position.y, pose.position.z)
      direction.set(pose.direction.x, pose.direction.y, pose.direction.z).normalize()
      quaternion.setFromUnitVectors(UP, direction)
      const size = pose.scale * (compact ? 0.85 : 1)
      scale.set(size, size * pose.stretch, size)
      matrix.compose(position, quaternion, scale)
      swords.setMatrixAt(index, matrix)

      instanceColor
        .copy(steel)
        .lerp(jade, 0.26 + weights.lotus * 0.22)
        .lerp(gold, Math.min(1, pose.glow * 0.36 + pose.energy * 0.55))
      if (pulse > 0.02) {
        instanceColor.lerp(brightGold, pulse * 0.42 * pose.energy)
      }
      if (options.state === 'error') instanceColor.lerp(seal, 0.7)
      swords.setColorAt(index, instanceColor)
    }
    swords.instanceMatrix.needsUpdate = true
    if (swords.instanceColor) swords.instanceColor.needsUpdate = true

    if (trailGroup.visible) {
      const trailStep = 0.036
      const opacityBoost =
        0.32 + gather * 0.28 + weights.volley * 0.3 + pulse * 0.25 + (options.boost ? 0.12 : 0)
      for (const [trailIdx, trail] of trails.entries()) {
        const baseColor = trailIdx % 3 === 0 ? gold : options.state === 'error' ? seal : jade
        trailColor.copy(baseColor).lerp(brightGold, pulse * 0.45)
        let activePoints = 0
        for (let point = 0; point < TRAIL_POINTS; point++) {
          const sampleLoop = time - point * trailStep
          const sampleIntro = Math.max(0, introTime - point * trailStep)
          const pose = sampleIntroSwordPose(
            trail.swordIndex % Math.max(1, count),
            count,
            sampleLoop,
            sampleIntro
          )
          if (pose.scale > 0.001) activePoints++
          trail.positions[point * 3] = pose.position.x
          trail.positions[point * 3 + 1] = pose.position.y
          trail.positions[point * 3 + 2] = pose.position.z

          const fade = Math.pow(1 - point / (TRAIL_POINTS - 1), 1.85) * (pose.scale > 0.001 ? 1 : 0)
          trail.colors[point * 3] = trailColor.r * fade
          trail.colors[point * 3 + 1] = trailColor.g * fade
          trail.colors[point * 3 + 2] = trailColor.b * fade
        }
        trail.line.visible = activePoints > 1
        trail.line.geometry.getAttribute('position').needsUpdate = true
        trail.line.geometry.getAttribute('color').needsUpdate = true
        trail.line.material.opacity = opacityBoost
      }
    }

    const introFactor = stage.introProgress
    foreground.forEach((sword, index) => {
      if (!sword.visible) return
      const surge = 1 + weights.volley * 0.25
      const angle = cycle + (index / foreground.length) * Math.PI * 2
      sword.position.set(
        2 + Math.cos(angle) * (3.2 * surge),
        Math.sin(angle) * 1.85,
        1.8 + Math.sin(angle) * 0.8 + weights.volley * 0.65
      )
      direction.set(-Math.sin(angle) * 3.2, Math.cos(angle) * 1.85, Math.cos(angle) * 0.8).normalize()
      sword.quaternion.setFromUnitVectors(UP, direction)
      const fgScale = (0.46 + index * 0.045) * Math.min(1, Math.max(0, (introFactor - 0.15) * 1.5))
      sword.scale.set(fgScale, fgScale * (1 + weights.volley * 0.45), fgScale)
    })

    guardians.forEach((sword, index) => {
      if (!sword.visible) return
      const reveal = Math.min(1, Math.max(0, (introTime - 0.45 - index * 0.12) / 0.55))
      const angle = -cycle * 2 + (index / guardians.length) * Math.PI * 2
      const guardR = 0.88 + weights.lotus * 0.35 - gather * 0.18 + pulse * 0.15
      sword.position.set(
        0.9 + Math.cos(angle) * guardR,
        0.25 + Math.sin(angle) * guardR * 0.72,
        -0.12 + Math.sin(angle * 2) * 0.22
      )
      direction
        .set(
          Math.cos(angle) * (0.4 + weights.lotus * 0.8) - Math.sin(angle) * 0.6,
          Math.sin(angle) * (0.4 + weights.lotus * 0.8) + Math.cos(angle) * 0.6,
          0.35
        )
        .normalize()
      sword.quaternion.setFromUnitVectors(UP, direction)
      const gScale = (0.34 + pulse * 0.06) * reveal
      sword.scale.set(gScale, gScale * (1 + pulse * 0.35), gScale)
    })

    const heartX = compact ? 0 : 0.9
    const hoverWave = introTime >= INTRO_SECONDS ? Math.sin(cycle * 2) * 0.08 : 0
    mainSword.group.position.set(
      heartX + stage.mainSwordTremble * 0.55,
      0.28 + hoverWave + stage.mainSwordY,
      0
    )
    mainSword.group.rotation.set(
      0.08 + pointer.y * 0.08,
      -0.18 + Math.sin(cycle) * 0.42 + pointer.x * 0.2 + stage.mainSwordSpin,
      -0.12 + stage.mainSwordInvert + Math.sin(cycle * 2) * 0.04 + stage.mainSwordTremble
    )
    const invertRatio = stage.mainSwordInvert / Math.PI
    const plantedDrape = introTime < IMPACT_SECONDS ? 0.12 : 0.88 + Math.sin(cycle * 5) * 0.12
    mainSword.tasselGroup.rotation.z =
      (plantedDrape - Math.sin(cycle * 2) * 0.05) * invertRatio + Math.sin(cycle * 2) * 0.05
    mainSword.tasselGroup.rotation.x = invertRatio * (introTime < IMPACT_SECONDS ? 0.08 : 0.38)
    const mainScale = (compact ? 0.5 : 0.68) * stage.mainSwordScale * (1 + gather * 0.04 + pulse * 0.055)
    mainSword.group.scale.setScalar(mainScale)
    mainSword.bladeMaterial.emissiveIntensity = 0.22 + stage.mainSwordGlow * 0.95 + (options.boost ? 0.24 : 0)
    mainSword.glow.material.opacity = 0.2 + stage.mainSwordGlow * 0.48 + (options.boost ? 0.14 : 0)
    mainSword.glow.scale.setScalar(4.8 + gather * 1.6 + pulse * 2.1)

    if (pillarSprite.visible) {
      pillarMaterial.opacity = Math.min(0.62, stage.pillarIntensity * 0.48 + (options.boost ? 0.12 : 0))
      const beamNarrow = stage.descentBeam > 0.05 ? 0.95 : 1.6
      pillarSprite.scale.set(beamNarrow + pulse * 1.1, 8.6 + stage.pillarIntensity * 3.2, 1)
    }
    if (flareSprite.visible) {
      const flareAlpha = Math.max(
        pulse * 0.65,
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
      stage.climaxShockwaveA > 0 ? 7.2 : 8.2,
      stage.climaxShockwaveA > 0 ? 0.64 : 0.24,
      compact
    )
    updateShockwave(shockwaves[1]!, stage.climaxShockwaveB, 6.2, 0.54, compact)
    updateShockwave(shockwaves[2]!, manualPulseProgress, 5.6, 0.58, compact)

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

    const ringBaseScale = compact ? 0.52 : 0.86
    ringGroup.scale.setScalar(ringBaseScale * (1 + pulse * 0.12))
    ringGroup.rotation.z = cycle + (1 - stage.ringUnfold) * Math.PI * 1.2
    ringGroup.rotation.x = 0.13 + Math.sin(cycle) * 0.035
    ringMeshes.forEach((mesh, index) => {
      const s = Math.max(0.001, stage.ringRadiiScales[index] ?? 1)
      mesh.scale.setScalar(s)
    })
    ringMaterials.forEach((material, index) => {
      const reveal = Math.min(1, Math.max(0, (stage.ringRadiiScales[index] ?? 1) * 1.15))
      material.opacity =
        (0.11 + index * 0.025 + gather * 0.24 + pulse * 0.34 + (options.boost ? 0.07 : 0)) * reveal
    })
    spokesMesh.scale.setScalar(Math.max(0.001, stage.ringUnfold))
    spokeMaterial.opacity = (0.07 + gather * 0.18 + pulse * 0.22) * stage.ringUnfold
    glyphs.forEach((sprite, index) => {
      if (!sprite.visible) return
      const glyphReveal = Math.min(1, Math.max(0, (introTime - 0.65 - index * 0.08) / 0.35))
      sprite.material.opacity = (0.5 + gather * 0.28 + pulse * 0.35) * glyphReveal
      sprite.scale.setScalar(0.42 * (0.4 + glyphReveal * 0.6) * (1 + pulse * 0.15))
    })

    const gourdLift = (1 - stage.gourdReveal) * -0.95
    gourd.position.y = -0.7 + Math.sin(cycle * 2) * 0.07 + gourdLift
    gourd.scale.setScalar(0.54 * (0.35 + stage.gourdReveal * 0.65))
    gourd.rotation.set(0.06, -0.24 + Math.sin(cycle) * 0.16, 0.08 + Math.sin(cycle * 2) * 0.035)

    const wineLift = (1 - stage.wineReveal) * -0.9
    wine.group.position.y = -0.95 + wineLift
    wine.group.scale.setScalar(0.76 * (0.35 + stage.wineReveal * 0.65))
    wine.liquid.material.emissiveIntensity = 0.38 + gather * 0.45 + pulse * 0.55
    wine.ripples.forEach((ripple, index) => {
      const ripplePhase = (phase * 4 + index * 0.5) % 1
      const size = 0.35 + ripplePhase * (1.85 + pulse * 0.45)
      ripple.scale.set(size, size, size)
      ripple.material.opacity = (1 - ripplePhase) * (0.18 + gather * 0.38 + pulse * 0.35) * stage.wineReveal
    })
    wine.droplets.forEach((droplet, index) => {
      const angle = cycle * 2 + (index / wine.droplets.length) * Math.PI * 2
      const lift = (Math.sin(angle) + 1) * 0.5
      droplet.position.set(
        Math.cos(angle) * 0.26,
        0.28 + lift * (0.18 + gather * 0.28 + pulse * 0.24),
        Math.sin(angle) * 0.26
      )
      droplet.scale.setScalar((0.55 + gather * 0.65 + pulse * 0.4) * stage.wineReveal)
    })

    particles.rotation.z = cycle
    particles.rotation.y = Math.sin(cycle) * 0.08
    particles.scale.setScalar(0.35 + stage.particleReveal * 0.65 + pulse * 0.06)
    particleMaterial.opacity = (0.36 + gather * 0.24 + pulse * 0.22) * stage.particleReveal

    const pointerBlend = 1 - Math.exp(-5.5 * dt)
    pointer.lerp(pointerTarget, pointerBlend)
    camera.position.x = pointer.x * 0.32
    camera.position.y = stage.cameraY + pointer.y * 0.16
    camera.position.z = stage.cameraZ
    camera.lookAt(compact ? 0 : 0.35, 0, 0)
    renderer.render(scene, camera)
    return weights.phaseLabel
  }

  update(initialOptions)

  return {
    resize,
    update,
    render,
    triggerPulse,
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
