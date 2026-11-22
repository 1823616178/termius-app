import * as T from 'three'
import { drawEffects } from './draw-effects'
import { BEATS, DRAW_LENGTH, drawPose, smooth } from './draw-motion'
import { buildFlow } from './flow'
import { heroPitch, heroRoll } from './grand-formations'
import type { FormationLayout, FormationSpec } from './layouts'
import { buildArmory } from './model'
import { swordDance } from './sword-dance'

export type ConductorMode = 'free' | 'dance' | 'return' | 'close' | 'open' | 'seated'

export interface HeroFrameState {
  gather: number
  rec: number
  mode: ConductorMode
  beat: number
  amp: number
  tipMatrix: T.Matrix4
  draw: number | null
  sheathed: boolean
  phase: number | null
  fusionRemaining: number
  fusion: number
  fusionTarget: number
  swordTransfer: number
  swordAway: boolean
  swordJoined: number
  transfer: number
  away: boolean
  joined: number
}

export interface Conductor {
  readonly sword: T.Group
  readonly sheath: T.Group
  readonly tipOK: boolean
  readonly materials: Record<string, T.MeshStandardMaterial>
  addPositionOffset(i: number, d: T.Vector3): void
  resetPosition(): void
  holdTip(v: boolean): void
  setBladeQuaternion(q: T.Quaternion): void
  resetBlade(): void
  setAbsent(v: boolean): void
  setDance(v: boolean): void
  sync(): void
  inspectTick(t: number): void
  frame(
    time: number,
    dt: number,
    castAge: number,
    solveAim?: () => T.Quaternion | null,
    solvePosition?: () => void
  ): HeroFrameState
  links(points: Float32Array, t: number, fade: number): void
  select(id: number, layout: FormationLayout): void
  actuate(type: 'sheath' | 'recall' | 'cast'): void
  tilt(dx: number, dy: number): void
  reset(): void
  tip(cam: T.Camera): T.Vector3
  dispose(): void
}

const baseRoll = [-0.32, 0.26, -0.34, 0.22, -0.08, -0.38, 0.35, -0.25, 0.44, -0.47, 0.16, 0.48] as const

function firstLight(x: number): number {
  return Math.exp(-Math.pow((x - 0.38) / 0.34, 2))
}

interface TransitionSnapshot {
  p: T.Vector3
  q: T.Quaternion
  sp: T.Vector3
  sq: T.Quaternion
  scale: number
}

export function makeConductor(
  scene: T.Scene,
  root: T.Group,
  world: T.Group,
  atlas: readonly FormationSpec[]
): Conductor {
  const ensemble = new T.Group()
  ensemble.name = '主剑与鞘 · 同台实物'
  root.add(ensemble)
  const { sword, sheath, rotors, materials } = buildArmory()
  ensemble.add(sword, sheath)
  for (const part of sheath.children) {
    if (part.userData.displayOnly) part.visible = false
  }

  const blades = new T.Group()
  const mist = new T.Group()
  sword.add(blades)
  sheath.add(mist)
  const danceMount = new T.Group()
  const throatMount = new T.Group()
  ensemble.add(danceMount, throatMount)
  const flow = buildFlow({ sword, sheath, bladeLight: blades, effects: mist })
  const stageDance = swordDance(danceMount)
  const throat = drawEffects(throatMount)
  stageDance.hide()
  throat.hide()

  const studio = document.createElement('canvas')
  studio.width = 512
  studio.height = 256
  const ctx = studio.getContext('2d')
  if (ctx) {
    const gr = ctx.createLinearGradient(0, 0, 0, 256)
    const stops: readonly [number, string][] = [
      [0, '#cadae1'],
      [0.38, '#8b9ba6'],
      [0.47, '#415c72'],
      [0.55, '#b2c3c5'],
      [1, '#374e63']
    ]
    stops.forEach(([v, col]) => gr.addColorStop(v, col))
    ctx.fillStyle = gr
    ctx.fillRect(0, 0, 512, 256)
    const panels: readonly [number, number, string][] = [
      [16, 45, '#f4fcff'],
      [104, 49, '#283849'],
      [220, 44, '#f9ebce'],
      [361, 41, '#fcffff']
    ]
    for (const [x, w, col] of panels) {
      ctx.fillStyle = col
      ctx.fillRect(x, 23, w, 159)
    }
  }
  const envTex = new T.CanvasTexture(studio)
  envTex.mapping = T.EquirectangularReflectionMapping
  envTex.colorSpace = T.SRGBColorSpace
  scene.environment = envTex
  scene.add(new T.HemisphereLight(0xeaf6ff, 0x6f8495, 0.95))
  const lights: readonly [number, number, number, number, number][] = [
    [-4, 7, 5, 0xfff5e5, 1.6],
    [4, 1, 3, 0x9de0ff, 1.1],
    [1, 5, -4, 0xe2f9ff, 1.85]
  ]
  for (const [x, y, z, co, intensity] of lights) {
    const l = new T.DirectionalLight(co, intensity)
    l.position.set(x, y, z)
    scene.add(l)
  }

  const linkRoot = new T.Group()
  world.add(linkRoot)
  const N = 10
  const M = 64
  const p = new Float32Array(N * (M + 1) * 6)
  const uv: number[] = []
  const strip: number[] = []
  const ix: number[] = []
  for (let j = 0; j < N; j++) {
    for (let i = 0; i <= M; i++) {
      const u = i / M
      uv.push(u, -1, u, 1)
      strip.push(j, j)
      if (i < M) {
        const n = (j * (M + 1) + i) * 2
        ix.push(n, n + 1, n + 2, n + 1, n + 3, n + 2)
      }
    }
  }
  const linkGeo = new T.BufferGeometry()
  const linkPosAttr = new T.BufferAttribute(p, 3).setUsage(T.DynamicDrawUsage)
  linkGeo.setAttribute('position', linkPosAttr)
  linkGeo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2))
  linkGeo.setAttribute('strand', new T.Float32BufferAttribute(strip, 1))
  linkGeo.setIndex(ix)
  const uniforms = {
    t: { value: 0 },
    age: { value: -1 },
    rec: { value: -1 },
    ink: { value: new T.Color() },
    sun: { value: new T.Color() },
    strength: { value: 0 }
  }
  const linkMat = new T.ShaderMaterial({
    uniforms,
    depthWrite: false,
    transparent: true,
    blending: T.AdditiveBlending,
    side: T.DoubleSide,
    vertexShader: `attribute float strand;varying vec2 v;varying float j;void main(){v=uv;j=strand;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform float t,age,rec,strength;uniform vec3 ink,sun;varying vec2 v;varying float j;void main(){float x=v.x;float h=fract(t*.25-j*.112);float h2=fract((max(age,0.)-.09*j)*.82);float s0=exp(-abs(h-x)*16.);float s1=exp(-abs(h2-x)*11.)*step(0.,age)*step(age,4.4);float back=exp(-abs(fract(t*.6+j*.15)-(1.-x))*14.)*step(0.,rec);float w=exp(-abs(v.y)*3.3);float fade=pow(max(.001,sin(x*3.1416)),.5);vec3 C=mix(ink,sun,.35+.30*cos(j*2.+x*4.));gl_FragColor=vec4(mix(C,vec3(.92,1.,1.),min(1.,w*(s1+.7*back))),fade*w*(.095+s0*.35+s1*.94+back*.68+strength*.24));}`
  })
  const link = new T.Mesh(linkGeo, linkMat)
  link.frustumCulled = false
  linkRoot.add(link)
  const nodeIds = new Int32Array(N)
  const heroMatrix = new T.Matrix4()
  const inv = new T.Matrix4()
  const origin = new T.Vector3()
  const point = new T.Vector3()
  const target = new T.Vector3()

  // Ring and halo are attached to the blade, never screen-space layers.
  const seals = new T.Group()
  sword.add(seals)
  seals.position.set(0, 1.29, 0)
  const marks: number[] = []
  const trigCodes = ['111', '011', '010', '001', '000', '100', '101', '110'] as const
  for (let j = 0; j < 8; j++) {
    const a = (j * Math.PI) / 4
    const polar = (an: number, R: number): [number, number, number] => [Math.sin(an) * R, Math.cos(an) * R, 0]
    for (let k = 0; k < 16; k++) {
      for (const rad of [0.63, 0.7]) {
        marks.push(...polar(a - 0.33 + (0.66 * k) / 16, rad), ...polar(a - 0.33 + (0.66 * (k + 1)) / 16, rad))
      }
    }
    for (let k = 0; k < 3; k++) {
      const rr = 0.44 + k * 0.064
      const segs: readonly [number, number][] =
        trigCodes[j]![k] === '1'
          ? [[-0.12, 0.12]]
          : [
              [-0.12, -0.036],
              [0.036, 0.12]
            ]
      for (const [x, X] of segs) {
        for (const u of [x, X]) {
          marks.push(u * Math.cos(a) + rr * Math.sin(a), -u * Math.sin(a) + rr * Math.cos(a), 0.009)
        }
      }
    }
  }
  const sg = new T.BufferGeometry()
  sg.setAttribute('position', new T.Float32BufferAttribute(marks, 3))
  const sm = new T.LineBasicMaterial({
    color: 0x9ce9ff,
    depthWrite: false,
    transparent: true,
    blending: T.AdditiveBlending
  })
  seals.add(new T.LineSegments(sg, sm))

  let tiltX = 0
  let tiltZ = 0
  let cur = 0
  let danceEnabled = false
  let noSheath = false
  let mode: ConductorMode = 'free'
  let age = 0
  let rec = -20
  let curRoll = -0.28
  let curPitch = 0.05
  const fxOn = true
  let transition: TransitionSnapshot | null = null
  let exposed = 1

  const gripY = 2.04
  const manual = new T.Quaternion()
  const identity = new T.Quaternion()
  const basePose = new T.Quaternion()
  const gripA = new T.Vector3()
  const gripB = new T.Vector3()
  let held = false
  let tipOK = true
  let sheathTravel = 0
  let danceOffset = 0
  let actionScale = 0.82
  const sheathStartSword = new T.Vector3()
  const sheathStartScabbard = new T.Vector3()
  const sheathStartSwordOffset = new T.Vector3()
  const sheathStartScabbardOffset = new T.Vector3()
  const sheathLine = new T.Vector3()
  const sheathTarget = new T.Vector3()
  const sheathSwordQ = new T.Quaternion()
  const sheathQ = new T.Quaternion()
  const sheathEffectP = new T.Vector3()
  const sheathEffectQ = new T.Quaternion()
  const positionOffsets: [T.Vector3, T.Vector3] = [new T.Vector3(), new T.Vector3()]
  const sheathBaseQ = new T.Quaternion()
  const sheathBaseP = new T.Vector3()
  const syncQ = new T.Quaternion()
  const syncP = new T.Vector3()

  function begin(type: ConductorMode): void {
    manual.identity()
    held = false
    transition = {
      p: sword.position.clone().sub(positionOffsets[0]),
      q: sword.quaternion.clone(),
      sp: sheath.position.clone().sub(positionOffsets[1]),
      sq: sheath.quaternion.clone(),
      scale: ensemble.scale.x
    }
    mode = type
    age = 0
    if (type === 'dance') danceOffset = 0
  }

  function setDance(v: boolean): void {
    danceEnabled = !!v
    if (danceEnabled) {
      if (rec < 0 && mode !== 'dance') begin('dance')
    } else if (mode === 'dance') {
      begin('return')
    }
  }

  function actuate(type: 'sheath' | 'recall' | 'cast'): void {
    if (type === 'sheath') {
      if (noSheath) return
      if (mode === 'close') {
        mode = 'open'
      } else if (mode === 'open') {
        mode = 'close'
      } else if (mode === 'seated') {
        mode = 'open'
      } else {
        sheathStartSword.copy(sword.position)
        sheathStartScabbard.copy(sheath.position)
        sheathStartSwordOffset.copy(positionOffsets[0])
        sheathStartScabbardOffset.copy(positionOffsets[1])
        sheathSwordQ.copy(sword.quaternion)
        sheathQ.copy(sheath.quaternion)
        actionScale = ensemble.scale.x
        sheathTravel = 0
        manual.identity()
        held = false
        transition = null
        age = 0
        mode = 'close'
      }
    } else if (type === 'recall') {
      rec = 0
      if (mode !== 'free') begin('return')
    } else if (type === 'cast') {
      if (mode === 'seated' || mode === 'close') actuate('sheath')
    }
  }

  function select(id: number, layout: FormationLayout): void {
    cur = id
    tiltX = 0
    tiltZ = 0
    const spec = atlas[id]!
    uniforms.ink.value.set(spec.primary)
    uniforms.sun.value.set(spec.secondary)
    sm.color.copy(uniforms.ink.value).lerp(uniforms.sun.value, 0.24)
    const used = new Set<number>()
    for (let j = 0; j < N; j++) {
      const a = (j * 2 * Math.PI) / N
      let best = 0
      let bestScore = -1e6
      for (let i = 0; i < layout.p.length / 3; i += 13) {
        const x = layout.p[i * 3]!
        const y = layout.p[i * 3 + 1]!
        const d = Math.hypot(x, y) || 1
        const S = ((x * Math.cos(a) + y * Math.sin(a)) / d) * 3 - Math.abs(d - (2.0 + (j % 3) * 0.56)) * 0.29
        if (S > bestScore && !used.has(i)) {
          bestScore = S
          best = i
        }
      }
      used.add(best)
      nodeIds[j] = best
    }
  }

  function sync(): void {
    root.updateWorldMatrix(true, false)
    world.updateWorldMatrix(true, false)
    sword.updateWorldMatrix(true, false)
    inv.copy(world.matrixWorld).invert()
    heroMatrix.multiplyMatrices(inv, sword.matrixWorld)
    origin.set(0, 1.29, 0.04).applyMatrix4(heroMatrix)
  }

  function frame(
    time: number,
    dt: number,
    castAge: number,
    solveAim?: () => T.Quaternion | null,
    solvePosition?: () => void
  ): HeroFrameState {
    if (rec >= 0) rec += dt
    if (rec > 5.8) {
      rec = -20
      if (danceEnabled) begin('dance')
    }
    age += dt
    const crest =
      castAge >= 0 && castAge < 4.5 ? firstLight(castAge) + 0.28 * Math.sin((Math.PI * castAge) / 4.5) : 0
    let draw: number | null = null
    let beat = 0
    const targetRoll = cur >= 12 ? heroRoll(cur - 12) * 0.77 : (baseRoll[cur] ?? -0.28)
    const targetPitch = cur >= 12 ? heroPitch(cur - 12) * 0.64 : 0.035
    const factor = 1 - Math.exp(-dt * 4.6)
    curRoll += (targetRoll - curRoll) * factor
    curPitch += (targetPitch - curPitch) * factor
    ensemble.scale.setScalar(0.82)
    ensemble.position.set(0, 0.12, 0.81)
    sword.rotation.order = sheath.rotation.order = 'ZYX'
    sword.position.set(0.11 * Math.sin(time * 0.32 + cur), 0.12 * Math.sin(time * 0.68) + 0.16 * crest, 0)
    sword.rotation.set(
      curPitch + tiltX + 0.075 * Math.sin(time * 0.39),
      -0.22 + 0.14 * Math.sin(time * 0.39) + 0.34 * crest,
      curRoll + tiltZ + 0.035 * Math.sin(time * 0.67) + 0.14 * crest,
      'ZYX'
    )
    sheath.position.set(-1.52 + 0.08 * Math.sin(time * 0.46), 0.84 + 0.09 * Math.sin(time * 0.58), -0.25)
    sheath.rotation.set(0.06, 0.3 + 0.14 * Math.sin(time * 0.31), -0.18, 'ZYX')

    const manualSheath = mode === 'close' || mode === 'seated' || mode === 'open'
    let finishedOpen = false
    const px = Math.min(1.6, window.devicePixelRatio || 1)
    if (manualSheath) {
      if (mode === 'close') sheathTravel = Math.min(1, sheathTravel + dt / 3.6)
      else if (mode === 'open') sheathTravel = Math.max(0, sheathTravel - dt / 3.6)
      if (mode === 'seated') sheathTravel = 1
      ensemble.scale.setScalar(actionScale)
      sheath.position
        .copy(sheathStartScabbard)
        .add(gripA.copy(positionOffsets[1]).sub(sheathStartScabbardOffset))
      sheath.quaternion.copy(sheathQ)
      sword.position.copy(sheathStartSword).add(gripA.copy(positionOffsets[0]).sub(sheathStartSwordOffset))
      sheathLine.set(0, 1, 0).applyQuaternion(sheathQ)
      sheathTarget.copy(sheath.position).addScaledVector(sheathLine, 4.49445)
      const approach = smooth(0, 0.35, sheathTravel)
      const insertion = smooth(0.35, 1, sheathTravel)
      sword.position.lerp(sheathTarget, approach).addScaledVector(sheathLine, -4.41445 * insertion)
      sword.quaternion.copy(sheathSwordQ).slerp(sheathQ, approach)
      exposed = 1 - insertion
      const t = 2.3 * (1 - sheathTravel)
      const d = drawPose(t)
      sheathEffectP.fromArray(d.sh)
      sheathEffectQ.setFromEuler(new T.Euler(0, d.by, d.bz, 'ZYX'))
      draw = t
      stageDance.hide()
      if (!noSheath) throat.show(t, d, fxOn, px)
      else throat.hide()
      if (mode === 'close' && sheathTravel >= 1) mode = 'seated'
      if (mode === 'open' && sheathTravel <= 0) finishedOpen = true
    } else if (mode === 'dance') {
      const t = Math.min(age + danceOffset, DRAW_LENGTH)
      const d = drawPose(t)
      sword.position.fromArray(d.sw)
      sheath.position.fromArray(d.sh)
      sword.rotation.set(d.ax || 0, d.ay, d.az, 'ZYX')
      sheath.rotation.set(0, d.by, d.bz, 'ZYX')
      ensemble.scale.setScalar(0.73)
      beat = Math.max(...BEATS.map((v) => Math.exp(-Math.pow((t - v) / 0.18, 2))))
      exposed = Math.min(1.02, d.length / (354 * 0.01265))
      draw = t
      stageDance.show(t, fxOn, px)
      if (!noSheath && t < 4.3) throat.show(t, d, fxOn, px)
      else throat.hide()
      if (age + danceOffset >= DRAW_LENGTH) {
        age = 0
        danceOffset = 0
      }
    } else {
      stageDance.hide()
      throat.hide()
      exposed = 1.02
      if (mode === 'return' && age > 1.05) {
        mode = 'free'
        transition = null
      }
    }

    if (transition && age < 1.04) {
      const k = smooth(0, 1.04, age)
      sword.position.lerp(transition.p, 1 - k)
      sword.quaternion.slerp(transition.q, 1 - k)
      sheath.position.lerp(transition.sp, 1 - k)
      sheath.quaternion.slerp(transition.sq, 1 - k)
      ensemble.scale.setScalar(ensemble.scale.x * k + transition.scale * (1 - k))
    }
    const gather = rec < 0 ? 0 : smooth(0.12, 2.22, rec) * (1 - smooth(3.02, 5.68, rec))
    if (rec >= 0 && mode === 'free') {
      sword.rotation.z += gather * (-curRoll * 0.73)
      sword.rotation.y += gather * 0.29
      sword.position.y += gather * 0.21
    }
    sheathBaseP.copy(sheath.position)
    sheathBaseQ.copy(sheath.quaternion)
    if (manualSheath) {
      sheathBaseP.copy(sheathEffectP)
      sheathBaseQ.copy(sheathEffectQ)
    } else {
      sword.position.add(positionOffsets[0])
      sheath.position.add(positionOffsets[1])
    }
    basePose.copy(sword.quaternion)
    if (held && solveAim) {
      const q = solveAim()
      if (q) manual.copy(basePose).invert().multiply(q).normalize()
    }
    tipOK = mode === 'free' || mode === 'return' || (mode === 'dance' && exposed > 0.98)
    if (!held && mode !== 'free' && mode !== 'return') manual.slerp(identity, 1 - Math.exp(-dt * 8))
    gripA.set(0, gripY, 0).applyQuaternion(sword.quaternion)
    sword.quaternion.multiply(manual)
    gripB.set(0, gripY, 0).applyQuaternion(sword.quaternion)
    sword.position.add(gripA.sub(gripB))
    sheath.quaternion.copy(sword.quaternion)
    if (solvePosition) solvePosition()
    syncQ.copy(sheathBaseQ).invert()
    throatMount.quaternion.copy(sheath.quaternion).multiply(syncQ)
    syncP.copy(sheathBaseP).applyQuaternion(throatMount.quaternion)
    throatMount.position.copy(sheath.position).sub(syncP)
    danceMount.quaternion.copy(sword.quaternion).multiply(identity.copy(basePose).invert())
    identity.identity()
    gripB.set(0, gripY, 0).applyQuaternion(sword.quaternion).add(sword.position)
    danceMount.position
      .copy(gripB)
      .sub(gripA.copy(gripB).applyQuaternion(danceMount.quaternion))
      .add(positionOffsets[0])
    const amp = Math.max(crest, beat, gather * 0.9)
    flow.enable(fxOn)
    flow.tick(time, amp, fxOn, exposed)
    for (const r of rotors) r.rotation.z = (-(time % 12) * Math.PI) / 6 - amp * 0.28
    seals.visible = fxOn
    seals.rotation.z = -time * 0.19
    seals.scale.setScalar(0.58 + 0.47 * amp)
    sm.opacity = 0.12 + 0.63 * amp
    sync()
    uniforms.t.value = time
    uniforms.age.value = castAge
    uniforms.rec.value = rec
    uniforms.strength.value = amp
    if (finishedOpen) {
      if (danceEnabled) {
        begin('dance')
        danceOffset = 2.3
      } else {
        begin('return')
      }
    }
    return {
      gather,
      rec,
      mode,
      beat,
      amp,
      tipMatrix: heroMatrix,
      draw,
      sheathed: mode === 'seated' || mode === 'close',
      phase: mode === 'dance' ? Math.min(DRAW_LENGTH, age + danceOffset) : null,
      fusionRemaining: 0,
      fusion: 0,
      fusionTarget: 0,
      swordTransfer: 0,
      swordAway: false,
      swordJoined: 0,
      transfer: 0,
      away: false,
      joined: 0
    }
  }

  function links(points: Float32Array, t: number, fade: number): void {
    link.visible = fxOn
    for (let j = 0; j < N; j++) {
      const k = nodeIds[j]! * 3
      target.set(points[k]!, points[k + 1]!, points[k + 2]!)
      const dx = target.x - origin.x
      const dy = target.y - origin.y
      const len = Math.hypot(dx, dy) || 1
      const ax = -dy / len
      const ay = dx / len
      for (let i = 0; i <= M; i++) {
        const u = i / M
        const s = Math.sin(Math.PI * u)
        const bow = s * (0.22 + 0.16 * Math.sin(1.3 * t + j + 4 * u))
        const x = origin.x + dx * u + ax * bow
        const y = origin.y + dy * u + ay * bow
        const z = origin.z + (target.z - origin.z) * u + s * 0.28
        const w = (0.019 + 0.022 * uniforms.strength.value) * (0.77 + 0.23 * s) * fade
        const a = (j * (M + 1) + i) * 2
        linkPosAttr.setXYZ(a, x - ax * w, y - ay * w, z)
        linkPosAttr.setXYZ(a + 1, x + ax * w, y + ay * w, z)
      }
    }
    linkPosAttr.needsUpdate = true
  }

  return {
    addPositionOffset(i: number, d: T.Vector3) {
      positionOffsets[i]!.add(d)
      if (i === 0) {
        positionOffsets[1].add(d)
        sheath.position.add(d)
      } else if (mode === 'close' || mode === 'open' || mode === 'seated') {
        sword.position.add(d)
      }
    },
    resetPosition() {
      positionOffsets[0].set(0, 0, 0)
      positionOffsets[1].set(0, 0, 0)
    },
    get tipOK() {
      return tipOK
    },
    holdTip(v: boolean) {
      held = v
    },
    setBladeQuaternion(q: T.Quaternion) {
      manual.copy(basePose).invert().multiply(q).normalize()
    },
    resetBlade() {
      manual.identity()
    },
    setAbsent(v: boolean) {
      noSheath = v
      if (v && (mode === 'close' || mode === 'seated' || mode === 'open')) {
        if (danceEnabled) begin('dance')
        else begin('return')
      }
      mist.visible = !v
    },
    get sheath() {
      return sheath
    },
    get sword() {
      return sword
    },
    get materials() {
      return materials
    },
    setDance,
    sync,
    inspectTick(t: number) {
      flow.tick(t, 0.05, false, 1.02)
      for (const r of rotors) r.rotation.z = (-t * Math.PI) / 6
    },
    frame,
    links,
    select,
    actuate,
    tilt(dx: number, dy: number) {
      tiltZ = Math.max(-1.3, Math.min(1.3, tiltZ - dx * 0.009))
      tiltX = Math.max(-1.1, Math.min(1.1, tiltX + dy * 0.008))
    },
    reset() {
      tiltX = 0
      tiltZ = 0
    },
    tip(cam: T.Camera) {
      sword.updateWorldMatrix(true, false)
      return point.set(0, -3.48, 0).applyMatrix4(sword.matrixWorld).project(cam)
    },
    dispose() {
      envTex.dispose()
      if (scene.environment === envTex) scene.environment = null
    }
  }
}
