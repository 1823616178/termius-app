// All ten thousand array blades are mapped to real triangles on the sword and the sheath.
// The mapping lives in weapon-local coordinates and follows their current animated 3D poses.
import * as T from 'three'

export interface FusionRig {
  tick(dt: number, P: Float32Array, Q: Float32Array, C: Float32Array, M: Float32Array, ready: boolean): void
  flip(): number
  readonly remaining: number
  readonly progress: number
  readonly target: number
}

interface SampleSource {
  pos: T.BufferAttribute
  idx: T.BufferAttribute | null
  m: T.Matrix4
  cdf: number[]
  end: number
}

export function formationFusion(world: T.Group, sword: T.Group, sheath: T.Group, count: number): FusionRig {
  const samples = new Float32Array(count * 3)
  const which = new Uint8Array(count)
  const a = new T.Vector3()
  const b = new T.Vector3()
  const c = new T.Vector3()
  const v = new T.Vector3()
  const cross = new T.Vector3()
  const e = new T.Vector3()
  const w = new T.Vector3()
  const matrix = new T.Matrix4()
  let seed = 72851
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647

  function sample(obj: T.Group, first: number, num: number, index: number): void {
    obj.updateWorldMatrix(true, true)
    const inv = obj.matrixWorld.clone().invert()
    const bank: SampleSource[] = []
    let total = 0
    for (const part of obj.children) {
      if (!part.userData.weaponPart || !part.visible) continue
      part.traverse((mesh) => {
        if (!(mesh instanceof T.Mesh)) return
        const g = mesh.geometry as T.BufferGeometry
        const pos = g.attributes.position as T.BufferAttribute | undefined
        if (!pos) return
        const idx = g.index
        const m = new T.Matrix4().multiplyMatrices(inv, mesh.matrixWorld)
        const cdf: number[] = []
        const n = idx ? idx.count : pos.count
        for (let j = 0; j + 2 < n; j += 3) {
          a.fromBufferAttribute(pos, idx ? idx.getX(j) : j).applyMatrix4(m)
          b.fromBufferAttribute(pos, idx ? idx.getX(j + 1) : j + 1).applyMatrix4(m)
          c.fromBufferAttribute(pos, idx ? idx.getX(j + 2) : j + 2).applyMatrix4(m)
          total += cross.subVectors(b, a).cross(e.subVectors(c, a)).length() * 0.5
          cdf.push(total)
        }
        bank.push({ pos, idx, m, cdf, end: total })
      })
    }
    if (!total) throw new Error('Cannot sample weapon geometry')
    const seek = (arr: number[], val: number): number => {
      let l = 0
      let h = arr.length - 1
      while (l < h) {
        const m = (l + h) >> 1
        if (arr[m]! < val) l = m + 1
        else h = m
      }
      return l
    }
    const bounds = bank.map((s) => s.end)
    for (let k = 0; k < num; k++) {
      const x = ((k + rnd()) / num) * total
      const s = bank[seek(bounds, x)]!
      const j = 3 * seek(s.cdf, x)
      const id = (t: number) => (s.idx ? s.idx.getX(j + t) : j + t)
      a.fromBufferAttribute(s.pos, id(0))
      b.fromBufferAttribute(s.pos, id(1))
      c.fromBufferAttribute(s.pos, id(2))
      const r = Math.sqrt(rnd())
      const u = rnd()
      v.copy(a)
        .multiplyScalar(1 - r)
        .addScaledVector(b, r * (1 - u))
        .addScaledVector(c, r * u)
        .applyMatrix4(s.m)
        .toArray(samples, 3 * (first + k))
      which[first + k] = index
    }
  }

  const swordCount = Math.ceil(count * 0.58)
  sample(sword, 0, swordCount, 0)
  sample(sheath, swordCount, count - swordCount, 1)

  let progress = 0
  let target = 0
  let remaining = count
  const smooth = (t: number) => t * t * (3 - 2 * t)
  const cl = (t: number) => Math.max(0, Math.min(1, t))
  const matrices: [T.Matrix4, T.Matrix4] = [new T.Matrix4(), new T.Matrix4()]

  function tick(
    dt: number,
    P: Float32Array,
    _Q: Float32Array,
    _C: Float32Array,
    M: Float32Array,
    ready: boolean
  ): void {
    const goal = target && ready ? 1 : 0
    progress = goal > progress ? Math.min(goal, progress + dt / 6.4) : Math.max(goal, progress - dt / 6.4)
    if (progress === 0) {
      remaining = count
      return
    }
    remaining = 0
    world.updateWorldMatrix(true, false)
    sword.updateWorldMatrix(true, false)
    sheath.updateWorldMatrix(true, false)
    matrix.copy(world.matrixWorld).invert()
    matrices[0].multiplyMatrices(matrix, sword.matrixWorld)
    matrices[1].multiplyMatrices(matrix, sheath.matrixWorld)
    for (let i = 0; i < count; i++) {
      const j = i * 3
      const k = i * 4
      const sd = ((i * 73) % 997) / 997
      const stagger = sd * 0.25
      const u = smooth(cl((progress - stagger) / 0.75))
      const z = Math.sin(Math.PI * u)
      const angle = sd * 6.283 + u * 5.4
      w.fromArray(samples, j).applyMatrix4(matrices[which[i]!]!)
      const ax = P[j]!
      const ay = P[j + 1]!
      const az = P[j + 2]!
      P[j] = ax + (w.x - ax) * u + Math.cos(angle) * z * (0.3 + 0.6 * sd)
      P[j + 1] = ay + (w.y - ay) * u + z * (0.3 + 0.4 * sd)
      P[j + 2] = az + (w.z - az) * u + Math.sin(angle) * z * (0.3 + 0.6 * sd)
      M[k] = M[k]! * (1 - smooth(cl((u - 0.78) / 0.22)))
      if (u < 1) remaining++
      M[k + 1] = M[k + 1]! + z * 0.8
      M[k + 3] = M[k + 3]! + z * 0.6
    }
  }

  return {
    tick,
    flip() {
      target = 1 - target
      return target
    },
    get remaining() {
      return remaining
    },
    get progress() {
      return progress
    },
    get target() {
      return target
    }
  }
}
