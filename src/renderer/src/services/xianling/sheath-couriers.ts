// The scabbard (or main sword) and its travelling swords use the same sampled metal surface, in local space.
import * as T from 'three'
import { COUNT } from './layouts'

export const COURIERS = 2048

export interface ExchangeRig {
  tick(dt: number, time: number, fp: Float32Array, fq: Float32Array, fc: Float32Array, fv: Float32Array): void
  flip(): number
  returnHome(): void
  setInspect(v: boolean): void
  dispose(): void
  readonly joined: number
  readonly away: boolean
  readonly progress: number
}

interface SurfaceBank {
  o: T.Mesh
  g: T.BufferGeometry
  pos: T.BufferAttribute
  idx: T.BufferAttribute | null
  m: T.Matrix4
  y: Float32Array
  cdf: number[]
}

export function scabbardExchange(
  world: T.Group,
  sheath: T.Group,
  baseGeometry: T.InstancedBufferGeometry,
  mat: T.ShaderMaterial
): ExchangeRig {
  const n = COURIERS
  const pts = new Float32Array(3 * n)
  const info = new Float32Array(4 * n)
  const bank: SurfaceBank[] = []
  const weights: number[] = []
  const a = new T.Vector3()
  const b = new T.Vector3()
  const c = new T.Vector3()
  const e1 = new T.Vector3()
  const e2 = new T.Vector3()
  const p = new T.Vector3()
  const q = new T.Quaternion()
  const axis = new T.Vector3(0, 1, 0)
  const other = new T.Quaternion()
  const matrix = new T.Matrix4()
  const surface = new T.Vector3()
  const decomp = new T.Quaternion()
  const unit = new T.Vector3()
  const origin = new T.Vector3()
  const xf = new T.Matrix4()
  const shCut = { value: -0.1 }
  let lo = Infinity
  let hi = -Infinity
  let weight = 0
  let seed = 57913
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const cl = (x: number) => Math.max(0, Math.min(1, x))
  const ease = (x: number) => x * x * (3 - 2 * x)

  sheath.updateWorldMatrix(true, true)
  const inv = sheath.matrixWorld.clone().invert()
  for (const part of sheath.children) {
    if (!part.userData.weaponPart || !part.visible) continue
    part.traverse((o) => {
      if (!(o instanceof T.Mesh)) return
      const g = o.geometry as T.BufferGeometry
      const pos = g.attributes.position as T.BufferAttribute | undefined
      if (!pos) return
      const idx = g.index
      const m = xf.multiplyMatrices(inv, o.matrixWorld).clone()
      const y = new Float32Array(pos.count)
      for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i).applyMatrix4(m)
        lo = Math.min(lo, p.y)
        hi = Math.max(hi, p.y)
        y[i] = p.y
      }
      g.setAttribute('scHeight', new T.BufferAttribute(y, 1))
      bank.push({ o, g, pos, idx, m, y, cdf: [] })
    })
  }

  const span = hi - lo || 1
  const clonedMaterials: T.Material[] = []

  for (const s of bank) {
    const { o, pos, idx, m, y } = s
    for (let i = 0; i < y.length; i++) y[i] = (y[i]! - lo) / span
    const orig = o.material as T.Material
    const metal = orig.clone()
    const prevOnBeforeCompile = orig.onBeforeCompile
    const prevKey = typeof orig.customProgramCacheKey === 'function' ? orig.customProgramCacheKey() : ''
    metal.onBeforeCompile = (shader, renderer) => {
      if (prevOnBeforeCompile) prevOnBeforeCompile.call(metal, shader, renderer)
      shader.uniforms.front = shCut
      shader.vertexShader =
        'attribute float scHeight;varying float shellH;\n' +
        shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nshellH=scHeight;')
      shader.fragmentShader =
        'uniform float front;varying float shellH;\n' +
        shader.fragmentShader.replace(
          '#include <opaque_fragment>',
          `if(shellH<front)discard; float hot=1.-smoothstep(0.,.085,abs(shellH-front));outgoingLight+=hot*vec3(.53,1.2,1.8);\n#include <opaque_fragment>`
        )
    }
    metal.customProgramCacheKey = () => (prevKey ? `${prevKey}+sheath-wave-v1` : 'sheath-wave-v1')
    o.material = metal
    clonedMaterials.push(metal)

    const local: number[] = []
    const triCount = idx ? idx.count : pos.count
    for (let j = 0; j + 2 < triCount; j += 3) {
      const i0 = idx ? idx.getX(j) : j
      const i1 = idx ? idx.getX(j + 1) : j + 1
      const i2 = idx ? idx.getX(j + 2) : j + 2
      a.fromBufferAttribute(pos, i0).applyMatrix4(m)
      b.fromBufferAttribute(pos, i1).applyMatrix4(m)
      c.fromBufferAttribute(pos, i2).applyMatrix4(m)
      const area = e1.subVectors(b, a).cross(e2.subVectors(c, a)).length() * 0.5
      weight += area
      local.push(weight)
    }
    s.cdf = local
    weights.push(weight)
  }

  const seek = (bounds: number[], v: number): number => {
    let low = 0
    let high = bounds.length - 1
    while (low < high) {
      const k = (low + high) >>> 1
      if (bounds[k]! < v) low = k + 1
      else high = k
    }
    return low
  }

  for (let i = 0; i < n; i++) {
    const v = ((i + rand()) / n) * weight
    const s = bank[seek(weights, v)]!
    const { pos, idx, m } = s
    const j = 3 * seek(s.cdf, v)
    a.fromBufferAttribute(pos, idx ? idx.getX(j) : j)
    b.fromBufferAttribute(pos, idx ? idx.getX(j + 1) : j + 1)
    c.fromBufferAttribute(pos, idx ? idx.getX(j + 2) : j + 2)
    const r = Math.sqrt(rand())
    const u = rand()
    p.copy(a)
      .multiplyScalar(1 - r)
      .addScaledVector(b, r * (1 - u))
      .addScaledVector(c, r * u)
      .applyMatrix4(m)
      .toArray(pts, i * 3)
    info.set([(p.y - lo) / span, rand(), rand(), rand()], 4 * i)
  }

  const g = new T.InstancedBufferGeometry()
  for (const s of ['position', 'normal', 'kind'] as const) {
    const attr = baseGeometry.attributes[s]
    if (attr) g.setAttribute(s, attr)
  }
  g.instanceCount = n
  const att: T.InstancedBufferAttribute[] = []
  const buf: Float32Array[] = []
  for (const [key, size] of [
    ['curP', 3],
    ['curQ', 4],
    ['curC', 3],
    ['curM', 4]
  ] as const) {
    const ar = new Float32Array(n * size)
    const at = new T.InstancedBufferAttribute(ar, size).setUsage(T.DynamicDrawUsage)
    att.push(at)
    buf.push(ar)
    g.setAttribute(key, at)
  }
  const [P, Q, C, V] = buf as [Float32Array, Float32Array, Float32Array, Float32Array]
  const mesh = new T.Mesh(g, mat)
  mesh.frustumCulled = false
  world.add(mesh)
  mesh.visible = false

  const lineg = new T.BufferGeometry()
  const tails = new Float32Array((n / 8) * 6)
  const tailcol = new Float32Array(tails.length)
  lineg.setAttribute('position', new T.BufferAttribute(tails, 3).setUsage(T.DynamicDrawUsage))
  lineg.setAttribute('color', new T.BufferAttribute(tailcol, 3).setUsage(T.DynamicDrawUsage))
  const lineMat = new T.LineBasicMaterial({
    vertexColors: true,
    blending: T.AdditiveBlending,
    transparent: true,
    opacity: 0.7,
    depthWrite: false
  })
  const lines = new T.LineSegments(lineg, lineMat)
  lines.frustumCulled = false
  world.add(lines)
  lines.visible = false

  let progress = 0
  let target = 0
  let joined = 0
  let inspecting = false

  function tick(
    dt: number,
    _time: number,
    fp: Float32Array,
    fq: Float32Array,
    fc: Float32Array,
    fv: Float32Array
  ): void {
    progress =
      target > progress ? Math.min(target, progress + dt / 5.4) : Math.max(target, progress - dt / 5.4)
    const t = progress
    joined = 0
    shCut.value = t * 3.5 - 0.1
    mesh.visible = t > 0
    lines.visible = t > 0 && t < 1
    sheath.visible = inspecting || shCut.value < 1.001
    if (inspecting) shCut.value = -0.1
    if (!t) return
    world.updateWorldMatrix(true, false)
    sheath.updateWorldMatrix(true, false)
    matrix.copy(world.matrixWorld).invert().multiply(sheath.matrixWorld)
    matrix.decompose(origin, decomp, unit)
    const tintStart = [0.64, 0.87, 1] as const
    for (let i = 0; i < n; i++) {
      const j = i * 3
      const k = i * 4
      const id = (31 + 3037 * i) % COUNT
      const d = id * 3
      const h = id * 4
      const Y = info[k]!
      const r = info[k + 1]!
      const s = info[k + 2]!
      const w = info[k + 3]!
      const born = (Y + 0.1) / 3.5
      const coat = ease(cl((t - born + 0.026) / 0.05))
      const u = cl((t - born - 0.072 - w * 0.075) / (0.51 + 0.025 * s))
      const f = ease(u)
      const arch = Math.sin(u * Math.PI)
      const ang = r * 6.283 + u * 3.85
      const cs = Math.cos(ang)
      const sn = Math.sin(ang)
      const x = fp[d]! + 0.1 * (s - 0.5)
      const y = fp[d + 1]! + 0.13 * (r - 0.5)
      const z = fp[d + 2]! + 0.13 * (w - 0.5)
      surface.fromArray(pts, j).applyMatrix4(matrix)
      if (u === 1) joined++
      const rx = x - surface.x
      const ry = y - surface.y
      const rz = z - surface.z
      const amp = 0.55 + 0.82 * s
      const ex = arch * amp * cs
      const ey = arch * (0.48 + 0.35 * w)
      const ez = arch * amp * sn
      P[j] = surface.x + rx * f + ex
      P[j + 1] = surface.y + ry * f + ey
      P[j + 2] = surface.z + rz * f + ez
      const der = 6 * u * (1 - u)
      const hc = Math.PI * Math.cos(u * Math.PI)
      p.set(
        rx * der + amp * (hc * cs - 3.85 * arch * sn),
        ry * der + hc * (0.48 + 0.35 * w),
        rz * der + amp * (hc * sn + 3.85 * arch * cs)
      ).normalize()
      q.setFromUnitVectors(axis, p)
      other.copy(decomp).slerp(q, ease(cl(u * 4)))
      q.fromArray(fq, h)
      other.slerp(q, ease(cl((u - 0.7) / 0.3))).toArray(Q, k)
      const flash = arch * 0.64 + (1 - f) * coat * 0.29
      for (let ch = 0; ch < 3; ch++) C[j + ch] = tintStart[ch]! * (1 - f) + fc[d + ch]! * f
      V[k] = coat * ((0.073 + 0.042 * r) * (1 - f) + fv[h]! * f + arch * 0.065)
      V[k + 1] = flash + fv[h + 1]! * f
      V[k + 2] = s
      V[k + 3] = flash * 0.68
      if ((i & 7) === 0 && lines.visible) {
        const v = 6 * (i >> 3)
        const l = arch * (0.19 + 0.32 * r) * (target ? 1 : -1)
        tails.set([P[j]! - p.x * l, P[j + 1]! - p.y * l, P[j + 2]! - p.z * l, P[j]!, P[j + 1]!, P[j + 2]!], v)
        tailcol.set([0, 0, 0, 0.39 * arch, 0.76 * arch, arch], v)
      }
    }
    for (const at of att) at.needsUpdate = true
    if (lines.visible) {
      ;(lineg.attributes.position as T.BufferAttribute).needsUpdate = true
      ;(lineg.attributes.color as T.BufferAttribute).needsUpdate = true
    }
  }

  return {
    tick,
    flip() {
      target = 1 - target
      return target
    },
    returnHome() {
      target = 0
    },
    setInspect(v: boolean) {
      inspecting = v
      shCut.value = v ? -0.1 : progress * 3.5 - 0.1
      sheath.visible = v || shCut.value < 1.001
    },
    dispose() {
      g.dispose()
      lineg.dispose()
      lineMat.dispose()
      clonedMaterials.forEach((m) => m.dispose())
    },
    get joined() {
      return joined
    },
    get away() {
      return !!target
    },
    get progress() {
      return progress
    }
  }
}
