import * as T from 'three'
import { formationFusion } from './formation-fusion'
import { updateReference } from './grand-formations'
import { ATLAS, COUNT, type FormationLayout, makeLayout } from './layouts'
import { type HeroFrameState, makeConductor } from './main-blade'
import { positionGrip } from './position-grip'
import { createRitual } from './ritual'
import { type DanceScore, score } from './score'
import { scabbardExchange } from './sheath-couriers'
import { tipGrip } from './tip-grip'

export interface TheatreHandles {
  tipHandle: HTMLElement
  tipLabel: HTMLElement
  swordHandle: HTMLElement
  sheathHandle: HTMLElement
  getTipLabels: () => { idle: string; aiming: string }
}

export interface XianlingTheatreOptions {
  host: HTMLElement
  canvas: HTMLCanvasElement
  handles: TheatreHandles
  tier: 'full' | 'light'
  isReducedMotion: () => boolean
  onFrameRate?: (fps: number) => void
}

export type FrameCallback = (
  progress: number,
  age: number,
  zoom: number,
  dt: number,
  hero: HeroFrameState | null
) => void

export interface XianlingTheatre {
  choose(index: number): void
  inspect(partIndex: number): void
  setChorus(v: boolean): void
  exchange(): void
  swordExchange(): void
  fusion(): void
  setDance(v: boolean): void
  actuate(type: 'sheath' | 'recall' | 'cast'): void
  cast(): void
  reset(): void
  zoom(multiplier: number): void
  orbit(v: boolean): void
  rotationSpeed(v: number): void
  pause(v: boolean): void
  setSuspended(v: boolean): void
  setTier(tier: 'full' | 'light'): void
  resize(width: number, height: number, dpr: number): void
  cancelDrag(): void
  nudgeTip(dx: number, dy: number): void
  resetFpsSampling(): void
  onframe(fn: FrameCallback): void
  dispose(releaseContext?: boolean): void
  readonly count: number
  readonly renderer: T.WebGLRenderer
}

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v))

const shaderMove = `uniform float tm,pixel;attribute vec3 curP,curC;attribute vec4 curQ,curM;varying vec3 tint;varying float shine,wave;vec3 qr(vec4 q,vec3 p){return p+2.*cross(q.xyz,cross(q.xyz,p)+q.w*p);}void anchor(out vec3 p,out vec4 q,out vec4 m,out float az){p=curP;q=curQ;m=curM;tint=curC;shine=m.y;wave=m.w;az=0.;}mat2 R(float a){float c=cos(a),s=sin(a);return mat2(c,s,-s,c);}`

export function archetype(simple = false): T.InstancedBufferGeometry {
  const p: number[] = []
  const n: number[] = []
  const part: number[] = []
  const v = (x: number, y: number, z: number): [number, number, number] => [x, y, z]

  function tri(
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    k: number
  ): void {
    const va = new T.Vector3(...a)
    const norm = new T.Vector3(...b)
      .sub(va)
      .cross(new T.Vector3(...c).sub(va))
      .normalize()
      .toArray()
    p.push(...a, ...b, ...c)
    for (let j = 0; j < 3; j++) n.push(...norm)
    part.push(k, k, k)
  }

  function quad(
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    d: [number, number, number],
    k: number
  ): void {
    tri(a, b, c, k)
    tri(a, c, d, k)
  }

  if (!simple) {
    const rows: readonly [number, number, number][] = [
      [-0.23, 0.072, 0.039],
      [-0.14, 0.061, 0.033],
      [0.378, 0.042, 0.024],
      [0.6, 0.0007, 0.001]
    ]
    const sec = (r: readonly [number, number, number]): [number, number, number][] => [
      v(-r[1], r[0], 0),
      v(0, r[0], r[2]),
      v(r[1], r[0], 0),
      v(0, r[0], -r[2])
    ]
    for (let j = 0; j < 3; j++) {
      const a = sec(rows[j]!)
      const b = sec(rows[j + 1]!)
      for (let i = 0; i < 4; i++) quad(a[i]!, a[(i + 1) % 4]!, b[(i + 1) % 4]!, b[i]!, i % 2 ? 0.94 : 0.78)
    }
    for (const s of [-1, 1]) {
      const poly: [number, number, number][] = [
        v(0, -0.31, 0.008),
        v(s * 0.143, -0.224, 0.008),
        v(s * 0.18, -0.126, 0),
        v(s * 0.094, -0.182, 0.014),
        v(0, -0.224, 0.018)
      ]
      const center = v(s * 0.078, -0.226, 0.047)
      const back = v(s * 0.078, -0.226, -0.034)
      for (let j = 0; j < 5; j++) {
        tri(poly[j]!, poly[(j + 1) % 5]!, center, 0.36)
        tri(poly[(j + 1) % 5]!, poly[j]!, back, 0.36)
      }
    }
    for (let j = 0; j < 4; j++) {
      const a = j * Math.PI * 0.5
      const b = a + Math.PI * 0.5
      quad(
        v(0.028 * Math.sin(a), -0.265, 0.028 * Math.cos(a)),
        v(0.028 * Math.sin(b), -0.265, 0.028 * Math.cos(b)),
        v(0.031 * Math.sin(b), -0.472, 0.031 * Math.cos(b)),
        v(0.031 * Math.sin(a), -0.472, 0.031 * Math.cos(a)),
        0.22
      )
      tri(
        v(0, -0.517, 0),
        v(0.05 * Math.sin(a), -0.465, 0.05 * Math.cos(a)),
        v(0.05 * Math.sin(b), -0.465, 0.05 * Math.cos(b)),
        0.43
      )
    }
    for (const s of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2
        const b = a + Math.PI / 2
        tri(
          v(0.059 * Math.sin(a), -0.238 + 0.073 * Math.cos(a), s * 0.034),
          v(0.059 * Math.sin(b), -0.238 + 0.073 * Math.cos(b), s * 0.034),
          v(0, -0.238, s * 0.074),
          0.02
        )
      }
    }
  } else {
    const base: [number, number, number][] = [
      v(-0.068, -0.21, 0),
      v(0, -0.21, 0.043),
      v(0.068, -0.21, 0),
      v(0, -0.21, -0.043)
    ]
    const upper = base.map((b): [number, number, number] => [b[0] * 0.65, 0.35, b[2] * 0.62])
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4
      quad(base[i]!, base[j]!, upper[j]!, upper[i]!, i % 2 ? 0.96 : 0.76)
      tri(upper[i]!, upper[j]!, v(0, 0.6, 0), i % 2 ? 0.96 : 0.76)
    }
    for (const side of [-1, 1]) {
      const a = v(0, -0.3, 0.036)
      const b = v(side * 0.16, -0.135, 0)
      const c = v(side * 0.083, -0.252, -0.033)
      const d = v(0, -0.211, -0.036)
      tri(a, b, c, 0.36)
      tri(a, c, d, 0.36)
      tri(a, d, b, 0.36)
      tri(d, c, b, 0.36)
    }
    const top: [number, number, number][] = [
      v(-0.037, -0.26, 0.024),
      v(0.037, -0.26, 0.024),
      v(0, -0.26, -0.031)
    ]
    const bottom = top.map((t): [number, number, number] => [t[0] * 0.9, -0.495, t[2] * 0.9])
    for (let i = 0; i < 3; i++) quad(top[i]!, top[(i + 1) % 3]!, bottom[(i + 1) % 3]!, bottom[i]!, 0.23)
    tri(bottom[0]!, bottom[1]!, bottom[2]!, 0.43)
  }

  const g = new T.InstancedBufferGeometry()
  g.setAttribute('position', new T.Float32BufferAttribute(p, 3))
  g.setAttribute('normal', new T.Float32BufferAttribute(n, 3))
  g.setAttribute('kind', new T.Float32BufferAttribute(part, 1))
  g.instanceCount = COUNT
  return g
}

const vertex = `uniform vec3 hiltView,tipView;varying float nearBlade;attribute float kind;varying float knd;varying vec3 N;varying float metalRnd;${shaderMove}void main(){vec3 p;vec4 q,m;float az;anchor(p,q,m,az);vec3 blade=qr(q,position*m.x);blade.xy=R(az)*blade.xy;vec3 nn=qr(q,normal);nn.xy=R(az)*nn.xy;N=normalize(normalMatrix*nn);knd=kind;metalRnd=m.z;vec4 vp=modelViewMatrix*vec4(p+blade,1.);vec2 seg=hiltView.xy-tipView.xy;float h=clamp(dot(vp.xy-tipView.xy,seg)/max(.0001,dot(seg,seg)),0.,1.);vec3 line=mix(tipView,hiltView,h);nearBlade=(1.-smoothstep(.12,.77,length(vp.xy-line.xy)))*smoothstep(-.48,.45,line.z-vp.z);gl_Position=projectionMatrix*vp;}`

const fragment = `varying float nearBlade;varying float knd,shine,wave,metalRnd;varying vec3 N,tint;void main(){vec3 n=normalize(N);float lit=abs(dot(n,normalize(vec3(-.55,.75,.72))));float spec=pow(abs(dot(n,normalize(vec3(.35,.32,.90)))),11.);float modl=.47+.59*lit+.28*metalRnd;vec3 c=tint*modl;if(knd>.6){c=mix(c,vec3(.80,.91,1.)*modl,.11);c*=knd>.9?.84:1.04;c+=spec*vec3(.28,.31,.34);}else if(knd>.3){c=mix(tint,vec3(.94,.78,.53),.48)*(.5+.68*lit);}else if(knd>.1){c=mix(vec3(.40,.48,.51),tint,.31)*(.86+.34*lit);}else c=mix(tint,vec3(.70,.94,1.),.4)*1.15;c+=tint*shine*.51+vec3(.19,.20,.2)*wave;gl_FragColor=vec4(c*(1.-nearBlade*.62),1.);}`

export function createXianlingTheatre(options: XianlingTheatreOptions): XianlingTheatre {
  const { host, canvas, handles, isReducedMotion, onFrameRate } = options
  let currentTier = options.tier

  const r = new T.WebGLRenderer({ canvas, antialias: true, alpha: true })
  const maxDprForTier = () => (currentTier === 'light' ? 1.1 : 1.6)
  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDprForTier()))
  r.setClearColor(0, 0)

  const scene = new T.Scene()
  const cam = new T.OrthographicCamera(-6, 6, 4, -4, 0.1, 100)
  cam.position.z = 22
  const root = new T.Group()
  const world = new T.Group()
  scene.add(root)
  root.add(world)

  const ctx = r.getContext()
  const info = ctx.getExtension('WEBGL_debug_renderer_info')
  const soft = Boolean(
    info && /swiftshader|llvmpipe|software/i.test(String(ctx.getParameter(info.UNMASKED_RENDERER_WEBGL)))
  )
  const eco = currentTier === 'light' || soft || window.innerWidth < 700
  const geo = archetype(eco)
  const cache = new Map<number, FormationLayout>()

  function layout(i: number): FormationLayout {
    let cached = cache.get(i)
    if (!cached) {
      cached = makeLayout(i)
      cache.set(i, cached)
    }
    return cached
  }

  let A = layout(0)
  let B = A

  const U = {
    hiltView: { value: new T.Vector3() },
    tipView: { value: new T.Vector3() },
    tm: { value: 0 },
    castTime: { value: -8 },
    morph: { value: 1 },
    form: { value: 0 },
    motion: { value: 1 }
  }
  const mat = new T.ShaderMaterial({
    uniforms: U,
    vertexShader: vertex,
    fragmentShader: fragment,
    side: T.DoubleSide
  })
  const swarm = new T.Mesh(geo, mat)
  swarm.frustumCulled = false
  world.add(swarm)

  const glints = new T.BufferGeometry()
  const isG: number[] = []
  for (let i = 0; i < COUNT; i += 47) isG.push(i)
  glints.setAttribute('position', new T.Float32BufferAttribute(new Float32Array(isG.length * 3), 3))
  const gm = new T.ShaderMaterial({
    uniforms: { ...U, px: { value: r.getPixelRatio() } },
    vertexShader: `uniform float px;varying float al;${shaderMove}void main(){vec3 p;vec4 q,m;float az;anchor(p,q,m,az);p+=qr(q,vec3(0.,.55*m.x,.005));al=pow(.5+.5*cos(tm*1.5+m.z*78.),9.)+wave*.7;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);gl_PointSize=px*(2.+al*6.);}`,
    fragmentShader: `varying float al;varying vec3 tint;void main(){vec2 v=gl_PointCoord*2.-1.;float l=length(v);float star=exp(-abs(v.x)*13.-abs(v.y)*3.)+exp(-abs(v.y)*17.-abs(v.x)*3.);gl_FragColor=vec4(mix(tint,vec3(1.),.52),al*(exp(-l*5.)+star*.36)*(1.-smoothstep(.72,1.,l)));}`,
    blending: T.AdditiveBlending,
    transparent: true,
    depthWrite: false
  })
  const glp = new T.Points(glints, gm)
  glp.frustumCulled = false
  world.add(glp)

  const frameP = new Float32Array(COUNT * 3)
  const frameQ = new Float32Array(COUNT * 4)
  const frameC = new Float32Array(COUNT * 3)
  const frameM = new Float32Array(COUNT * 4)
  const buffers: readonly [string, Float32Array, number][] = [
    ['curP', frameP, 3],
    ['curQ', frameQ, 4],
    ['curC', frameC, 3],
    ['curM', frameM, 4]
  ]
  for (const [key, arr, d] of buffers) {
    geo.setAttribute(key, new T.InstancedBufferAttribute(arr, d).setUsage(T.DynamicDrawUsage))
    glints.setAttribute(
      key,
      new T.Float32BufferAttribute(new Float32Array(isG.length * d), d).setUsage(T.DynamicDrawUsage)
    )
  }

  let chorus = false
  let bodyBeat = 0
  let danceScore: DanceScore | null = null
  let spirit: HeroFrameState | null = null
  let refClock = -9
  let spinSpeed = 1
  let spinAngle = 0
  const spinQ = new T.Quaternion()
  const spinAxis = new T.Vector3(0, 0, 1)
  const rq = new T.Quaternion()
  const re = new T.Euler()

  // Evaluate each rigid-body transform once per sword rather than re-running formation trigonometry at every vertex.
  function simulate(h: number, time: number, age: number, id: number): void {
    const blend = h < 0.99999
    const g = 1 - h
    const wob = blend ? Math.sin(Math.PI * h) : 0
    const bloom = age >= 0 && age <= 4.4 ? Math.sin((age * Math.PI) / 4.4) : 0
    const k = 1 - wob
    const sin = Math.sin
    const cos = Math.cos
    for (let i = 0; i < COUNT; i++) {
      const n3 = 3 * i
      const n4 = 4 * i
      let x = B.p[n3]!
      let y = B.p[n3 + 1]!
      let z = B.p[n3 + 2]!
      let qx = B.q[n4]!
      let qy = B.q[n4 + 1]!
      let qz = B.q[n4 + 2]!
      let qw = B.q[n4 + 3]!
      let sz = B.v[n4]!
      const rg = B.v[n4 + 1]!
      const seed = B.v[n4 + 3]!
      const random = B.v[n4 + 2]!
      if (blend) {
        const j = n4
        const sg = A.q[j]! * qx + A.q[j + 1]! * qy + A.q[j + 2]! * qz + A.q[j + 3]! * qw < 0 ? -h : h
        qx = A.q[j]! * g + qx * sg
        qy = A.q[j + 1]! * g + qy * sg
        qz = A.q[j + 2]! * g + qz * sg
        qw = A.q[j + 3]! * g + qw * sg
        const len = 1 / (Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw) || 1)
        qx *= len
        qy *= len
        qz *= len
        qw *= len
        x = A.p[n3]! * g + x * h + wob * (0.2 + 0.85 * seed) * sin(seed * 37.1 + h * 4.6)
        y = A.p[n3 + 1]! * g + y * h + wob * (0.2 + 0.85 * seed) * cos(seed * 29.2 + h * 4.6)
        z = A.p[n3 + 2]! * g + z * h + wob * (0.2 + 0.85 * seed) * sin(seed * 54.7)
        sz = A.v[j]! * g + sz * h
      }
      const radius = Math.sqrt(x * x + y * y)
      let az = 0
      const pulse = age >= 0 && age <= 4.4 ? Math.exp(-(((age * 1.55 - radius - 0.05) / 0.34) ** 2)) : 0
      switch (id) {
        case 0:
          az =
            k *
            (0.1 * sin(time * 0.29) +
              0.125 * sin(time * 0.34 - radius * 0.43) +
              bloom * (1 - Math.min(1, radius / 5)) * 0.94)
          z += k * (0.05 * sin(time * 0.55 + rg * 4) + 0.21 * bloom * cos(radius * 2))
          break
        case 1: {
          az = k * (0.11 * sin(time * 0.34) + 0.51 * bloom)
          const sep = k * (bloom * 0.48 + 0.052 * sin(time * 0.78)) * (rg > 0.3 ? -1 : 1)
          if (rg < 0.89) {
            z += sep
            x += sep * 0.39
          }
          break
        }
        case 2:
          y += k * (0.12 + 0.38 * bloom) * sin(1.43 * x - time * 1.32) + k * bloom * 0.15 * x
          z += k * (0.16 + 0.35 * bloom) * sin(1.1 * x - time * 1.1)
          break
        case 3: {
          const w = clamp((Math.abs(x) - 0.22) / 3.48, 0, 1)
          y += k * w * (0.31 + 0.85 * bloom) * sin(time * 1.43) + bloom * 0.12
          z += k * w * (0.56 + 0.78 * bloom) * cos(time * 1.43)
          break
        }
        case 4: {
          const j = k * (0.035 * sin(time * 0.77 + rg) + 0.19 * bloom) * (1 - 0.44 * rg)
          x *= 1 + j
          y *= 1 + j
          z += k * radius * (0.047 * sin(time * 0.78) + 0.21 * bloom)
          az = k * 0.06 * sin(time * 0.36)
          break
        }
        case 5:
          az = k * (rg > 0.6 ? 1 : -1) * (0.09 * sin(time * 0.57) + 1.0 * bloom)
          z += k * bloom * 0.6 * rg
          break
        case 6:
          y += k * (bloom * 0.9 + 0.042 * sin(time * 0.72 + rg * 2)) * rg
          break
        case 7: {
          const j = 1 + k * bloom * (0.035 + (radius > 2 ? 0.08 : 0))
          x *= j
          y *= j
          az = k * (0.12 * sin(time * 0.31) + bloom * 0.53 * (radius > 1.2 ? 1 : 0))
          z += 0.13 * k * sin(time + radius)
          break
        }
        case 8:
          z += k * (0.23 + 0.56 * bloom) * (rg < 0.4 ? -1 : 1) * sin(time * 0.62)
          y += k * (0.1 + 0.22 * bloom) * (rg < 0.4 ? -1 : 1) * cos(time * 0.62)
          az = k * (0.065 * sin(time * 0.31) + 0.46 * bloom)
          break
        case 9:
          y += k * (0.15 + 0.37 * bloom) * sin(time * 1.27 + x * 1.58)
          x += k * (0.08 + 0.17 * bloom) * cos(time * 1.27 + x)
          break
        case 10:
          if (rg > 0.7 && rg < 0.95) y += k * (0.16 + 0.29 * bloom) * sin(time * 2.2 + seed * 6.28)
          else y += k * bloom * 0.23 * rg
          break
        case 11:
          x += k * 0.085 * sin(time * 0.65 + y * 0.4)
          z += k * (0.045 + 0.35 * bloom) * sin(y * 2 + time)
          az = k * 0.045 * sin(time * 0.44)
          break
      }

      let echo = 0
      if (danceScore && spirit) {
        const { family: F, count, sign, v, weight } = danceScore
        const bucket = Math.min(
          63,
          Math.floor((0.54 * Math.min(1, radius / 4.9) + 0.38 * rg + 0.07 * random) * 63)
        )
        const row = v[Math.max(0, bucket)]!
        const vx = row[0]!
        const vy = row[1]!
        const vz = row[2]!
        const hx = row[3]!
        const hy = row[4]!
        const hz = row[5]!
        const hit = row[6]!
        const w = weight * k
        const sg = x < 0 ? -1 : 1
        echo = hit * w
        let fold = 0
        switch (F) {
          case 0:
            az += w * sign * (0.36 * vx + 0.23 * hy + 0.1 * hit) * (1 - 0.45 * rg)
            z += w * (0.32 * vy + 0.33 * hit) * radius * 0.37
            break
          case 1: {
            const flip = rg > 0.5 ? -1 : 1
            az += w * flip * (0.48 * hx + 0.23 * vy)
            fold = w * flip * (0.35 * hz + 0.38 * hit)
            break
          }
          case 2:
            y += w * sin(x * 1.15 - (spirit.phase ?? 0) * 0.9) * (0.32 + 0.4 * hit)
            z += w * 0.48 * cos(x * 1.2 - hy * 2)
            az += w * 0.14 * vx
            break
          case 3:
            fold = w * sg * (0.53 * vy + 0.34 * hit)
            y += w * Math.abs(x) * (0.22 * hy + 0.12 * hit)
            break
          case 4: {
            const petal = 0.5 + 0.5 * cos(count * Math.atan2(y, x))
            const open = w * (0.11 * hy + 0.12 * hit) * (0.5 + 0.5 * petal)
            x *= 1 + open
            y *= 1 + open
            z += w * (0.29 * vy + 0.54 * hit) * radius * 0.38
            az += w * 0.21 * vx
            break
          }
          case 5:
            y += w * (0.48 * vy + 0.34 * hit) * (0.42 + 0.67 * rg)
            az += w * (0.17 + 0.28 * rg) * hx
            break
          case 6: {
            const l = w * (0.53 * hit + 0.22 * vz)
            x += l * hx
            y += l * hy
            z += w * (0.6 * hit + 0.38 * hz) * (rg + 0.34)
            fold = w * 0.26 * vy
            break
          }
          case 7:
            x += w * 0.38 * vx * (rg - 0.5) * 2
            y += w * (0.42 * hit + 0.27 * vy) * sin(rg * count * 2 + 0.4)
            z += w * 0.37 * hz * cos(rg * count)
            break
        }
        if (fold) {
          const sn = sin(fold)
          const cs = cos(fold)
          const xx = x * cs + z * sn
          z = -x * sn + z * cs
          x = xx
        }
        const axRot = w * (0.26 * vx + 0.44 * vy + 0.23 * hit) + fold
        const ss = sin(axRot * 0.5)
        const cc = cos(axRot * 0.5)
        const qa = cc * qx + ss * qw
        const qb = cc * qy - ss * qz
        const qc = cc * qz + ss * qy
        const qd = cc * qw - ss * qx
        qx = qa
        qy = qb
        qz = qc
        qw = qd
        az += w * 0.21 * vx
      }

      const extra = bodyBeat * 0.28 * sin(radius * 2.1 - time * 4.8)
      az += extra * 0.16
      z += extra
      const ga = spirit?.gather ?? 0
      if (ga > 0 && spirit) {
        const e = spirit.tipMatrix.elements
        const an = seed * 6.283 + spirit.rec * 2.6 + (random - 0.5) * 2
        const rad = 0.43 + 0.59 * random
        const xx = rad * cos(an)
        const yy = 3.35 - 7.05 * rg - 0.32 * random
        const zz = rad * sin(an)
        const xx1 = e[0]! * xx + e[4]! * yy + e[8]! * zz + e[12]!
        const yy1 = e[1]! * xx + e[5]! * yy + e[9]! * zz + e[13]!
        const zz1 = e[2]! * xx + e[6]! * yy + e[10]! * zz + e[14]!
        x += (xx1 - x) * ga
        y += (yy1 - y) * ga
        z += (zz1 - z) * ga
        az += 1.15 * sin(ga * 3.1416)
        sz *= 1 - 0.48 * ga
      }

      let cs = cos(az)
      let sn = sin(az)
      frameP[n3] = cs * x - sn * y + B.p[n3]! * 0.05 * pulse + k * 0.017 * sin(time * 0.9 + seed * 48)
      frameP[n3 + 1] =
        sn * x + cs * y + B.p[n3 + 1]! * 0.05 * pulse + k * 0.015 * cos(time * 0.74 + seed * 34)
      frameP[n3 + 2] = z + B.p[n3 + 2]! * 0.03 * pulse
      cs = cos(az * 0.5)
      sn = sin(az * 0.5)
      frameQ[n4] = cs * qx - sn * qy
      frameQ[n4 + 1] = cs * qy + sn * qx
      frameQ[n4 + 2] = cs * qz + sn * qw
      frameQ[n4 + 3] = cs * qw - sn * qz
      for (let ch = 0; ch < 3; ch++)
        frameC[n3 + ch] = blend ? A.col[n3 + ch]! * g + B.col[n3 + ch]! * h : B.col[n3 + ch]!
      const sh = 0.5 + 0.5 * sin(time * 1.35 - radius * 2.7 + seed * 4)
      const s2 = sh * sh
      frameM[n4] = sz
      frameM[n4 + 1] =
        0.48 * s2 * s2 * s2 * sh + 1.12 * pulse + 0.78 * echo + 0.52 * wob + 0.42 * bodyBeat + 0.33 * ga
      frameM[n4 + 2] = random
      frameM[n4 + 3] = pulse
    }

    for (const [name, arr, d] of buffers) {
      ;(geo.attributes[name] as T.BufferAttribute).needsUpdate = true
      const attr = glints.attributes[name] as T.BufferAttribute
      const out = attr.array as Float32Array
      for (let i = 0; i < isG.length; i++) {
        const off = isG[i]! * d
        for (let ch = 0; ch < d; ch++) out[i * d + ch] = arr[off + ch]!
      }
      attr.needsUpdate = true
    }
  }

  const hero = makeConductor(scene, root, world, ATLAS)
  hero.select(0, B)
  const shuttle = scabbardExchange(world, hero.sheath, geo, mat)
  const bladeShuttle = scabbardExchange(world, hero.sword, geo, mat)
  const fusion = formationFusion(world, hero.sword, hero.sheath, COUNT)
  const ritual = createRitual(world, ATLAS)

  const atlasArt = new T.Group()
  world.add(atlasArt)
  let brushes: T.ShaderMaterial[] = []

  function pen(
    fn: (u: number) => [number, number, number?],
    color: string,
    width = 0.012,
    op = 0.52,
    loop = false
  ): void {
    const ps: number[] = []
    const uv: number[] = []
    const ids: number[] = []
    const len = 168
    for (let i = 0; i <= len; i++) {
      const u = i / len
      const v = fn(u)
      const w = fn(u + 0.0001)
      const dx = w[0] - v[0]
      const dy = w[1] - v[1]
      const l = Math.hypot(dx, dy) || 1
      const f = loop ? 1 : Math.max(0.02, Math.sin(u * Math.PI) ** 0.55)
      for (const k of [-1, 1]) {
        ps.push(v[0] - (dy / l) * width * k * f, v[1] + (dx / l) * width * k * f, v[2] ?? 0)
        uv.push(u, k)
      }
      if (i < len) {
        const a = i * 2
        ids.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    }
    const gg = new T.BufferGeometry()
    gg.setAttribute('position', new T.Float32BufferAttribute(ps, 3))
    gg.setAttribute('uv', new T.Float32BufferAttribute(uv, 2))
    gg.setIndex(ids)
    const m = new T.ShaderMaterial({
      uniforms: { tm: U.tm, col: { value: new T.Color(color) }, al: { value: op }, gate: { value: 1 } },
      transparent: true,
      depthWrite: false,
      side: T.DoubleSide,
      blending: T.AdditiveBlending,
      vertexShader: `varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `varying vec2 v;uniform float al,tm,gate;uniform vec3 col;void main(){float h=pow(.5+.5*cos(v.x*23.-tm*1.3),5.);gl_FragColor=vec4(mix(col,vec3(.95,1.,1.),h*.48),gate*al*(.38+.62*h)*exp(-2.8*abs(v.y)));}`
    })
    const o = new T.Mesh(gg, m)
    atlasArt.add(o)
    brushes.push(m)
  }

  function halo(x: number, y: number, z: number, size: number, color: string, al: number): void {
    const m = new T.ShaderMaterial({
      uniforms: {
        col: { value: new T.Color(color) },
        al: { value: al },
        size: { value: size },
        gate: { value: 1 }
      },
      transparent: true,
      depthWrite: false,
      blending: T.AdditiveBlending,
      vertexShader: `varying vec2 v;uniform float size;void main(){v=uv*2.-1.;vec4 p=modelViewMatrix*vec4(0.,0.,0.,1.);p.xy+=position.xy*size;gl_Position=projectionMatrix*p;}`,
      fragmentShader: `varying vec2 v;uniform vec3 col;uniform float al,gate;void main(){float r=length(v);gl_FragColor=vec4(col,al*gate*exp(-4.8*r*r-1.8*r)*(1.-smoothstep(.7,1.,r)));}`
    })
    const o = new T.Mesh(new T.PlaneGeometry(1, 1), m)
    o.position.set(x, y, z)
    o.frustumCulled = false
    atlasArt.add(o)
    brushes.push(m)
  }

  function ornament(i: number): void {
    ritual.build(i)
    atlasArt.traverse((o) => {
      if (o instanceof T.Mesh) {
        o.geometry.dispose()
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose())
        else o.material.dispose()
      }
    })
    atlasArt.clear()
    brushes = []
    const spec = ATLAS[i]!
    const a = spec.primary
    const b = spec.secondary
    const tau = 2 * Math.PI
    const orbitFn =
      (rx: number, ry: number, z: number, angle = 0, off = 0) =>
      (u: number): [number, number, number] => {
        const v = off + u * tau
        const x = rx * Math.cos(v)
        const y = ry * Math.sin(v)
        return [
          x * Math.cos(angle) - y * Math.sin(angle),
          x * Math.sin(angle) + y * Math.cos(angle),
          z + 0.07 * Math.sin(2 * v)
        ]
      }
    halo(0, 0, -1.25, 8.2, a, 0.17)
    if (i === 0) {
      halo(0, 0, 0.24, 2.12, b, 0.68)
      halo(0, 0, -0.32, 4.25, a, 0.27)
      for (let j = 0; j < 9; j++) {
        pen(
          (u) => {
            const rr = 0.22 + u * 4.02
            const an = (j * tau) / 9 + 0.72 * rr + 0.36 * Math.log(0.5 + rr) + 0.03
            return [rr * Math.cos(an), rr * Math.sin(an), 0.02]
          },
          j % 3 ? a : b,
          0.019,
          0.74
        )
      }
      for (const r0 of [3.82, 4.16, 4.52]) pen(orbitFn(r0, r0, -0.3), a, 0.014, 0.41, true)
    }
    if (i === 1 || i === 5 || i === 7) {
      for (const rr of [1.41, 3.62, 4.18]) pen(orbitFn(rr, rr, -0.19), rr === 1.41 ? b : a, 0.017, 0.55, true)
      halo(0, 0, -0.2, 3.2, b, 0.25)
    }
    if (i === 2) {
      halo(4.04, 2.0, 0.01, 0.62, b, 0.95)
      for (let j = 0; j < 4; j++) {
        pen(
          (u) => {
            const x = -4.2 + 6.37 * u
            return [
              x,
              -0.32 + 1.23 * Math.sin(u * tau * 1.24 - 0.68) + 1.44 * u + 0.13 * Math.sin(u * 17 + j),
              0.55 * Math.sin(u * tau * 1.44)
            ]
          },
          j % 2 ? b : a,
          0.024,
          0.59
        )
      }
    }
    if (i === 3) {
      halo(0, 0.5, -0.31, 2.72, b, 0.38)
      for (const s of [-1, 1]) {
        for (let j = 0; j < 3; j++) {
          pen(
            (u) => [
              s * (0.1 + u * (3.64 + 0.17 * j)),
              0.3 + u * u * (1.16 + 0.14 * j) + 0.2 * Math.sin(u * 6 + j),
              0.03
            ],
            b,
            0.018,
            0.58
          )
        }
      }
    }
    if (i === 4) {
      halo(0, 0, 0.18, 2.05, b, 0.57)
      for (let j = 0; j < 10; j++) {
        pen(
          (u) => {
            const an = (j * tau) / 10 + 0.27 * Math.sin(u * tau)
            const rr = 0.35 + 3.49 * Math.sin(u * Math.PI)
            return [Math.cos(an) * rr, Math.sin(an) * rr, -0.65 + 0.8 * Math.sin(u * Math.PI)]
          },
          a,
          0.016,
          0.57
        )
      }
    }
    if (i === 6 || i === 10) {
      pen(orbitFn(3.62, 0.68, -0.31, 0), a, 0.016, 0.47, true)
      halo(0, -1.7, -0.75, 5.1, b, 0.16)
    }
    if (i === 8) {
      for (const s of [-1, 1]) {
        halo(1.85 * s, 0.47 * s, -0.1, 3.7, s > 0 ? b : a, 0.31)
        pen(
          (u) => {
            const v = u * tau
            const r0 = s > 0 ? 1.98 : 2.37
            const an = s * 0.52
            const x = r0 * Math.cos(v)
            const y = r0 * 0.35 * Math.sin(v)
            return [
              1.85 * s + x * Math.cos(an) - y * Math.sin(an),
              0.47 * s + x * Math.sin(an) + y * Math.cos(an),
              r0 * 0.74 * Math.sin(v)
            ]
          },
          s > 0 ? b : a,
          0.021,
          0.72,
          true
        )
      }
    }
    if (i === 9) {
      halo(1.6, 1.5, -0.3, 2.62, b, 0.35)
      for (let j = 0; j < 4; j++)
        pen((u) => [-4 + u * 8, -1.84 + 0.12 * j + 0.29 * Math.sin(u * 9 + j * 0.4), 0.16], a, 0.015, 0.46)
    }
    if (i === 11) {
      halo(0, 1.47, 0.07, 1.72, a, 0.74)
      for (let j = 0; j < 3; j++) {
        pen(
          (u) => {
            const an = u * 6 + 0.35 * j
            return [(0.31 + 0.6 * u) * Math.sin(an), -2.61 + u * 4.33, 0.46 * Math.cos(an)]
          },
          a,
          0.019,
          0.64
        )
      }
    }
  }
  ornament(0)

  let suspended = false
  let disposed = false
  let rafId = 0
  let ct = -8
  let form = 0
  let clock = 0
  let last = 0
  let lastRender = 0
  let sampleStarted = 0
  let sampledFrames = 0
  let prog = 1
  let zoom = 1
  let targetZoom = 1
  let actionZoom = 1
  let auto = false
  let frozen = false
  let drag = false
  let oldTilt = ATLAS[0]!.tilt
  let oldRoll = ATLAS[0]!.roll
  let tilt = oldTilt
  let roll = oldRoll
  let frameCallback: FrameCallback = () => {}
  const touches = new Map<number, [number, number]>()

  // HDR-like selective bloom in two low-resolution bands. Draw geometry once; blur only the emission image.
  const off = new T.WebGLRenderTarget(1, 1, {
    depthBuffer: true,
    stencilBuffer: false,
    minFilter: T.LinearFilter,
    magFilter: T.LinearFilter
  })
  off.samples = eco ? 0 : Math.min(2, r.capabilities.maxSamples || 0)
  const low = () =>
    new T.WebGLRenderTarget(1, 1, {
      depthBuffer: false,
      minFilter: T.LinearFilter,
      magFilter: T.LinearFilter
    })
  const lum = low()
  const tmp = low()
  const narrow = low()
  const wide = low()
  const cam2 = new T.OrthographicCamera(-1, 1, 1, -1, 0.1, 2)
  cam2.position.z = 1
  const post = new T.Scene()
  const quadGeo = new T.PlaneGeometry(2, 2)
  const quad = new T.Mesh(quadGeo)
  quad.frustumCulled = false
  post.add(quad)

  function shader(uniforms: Record<string, T.IUniform>, frag: string): T.ShaderMaterial {
    return new T.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms,
      vertexShader: 'varying vec2 v;void main(){v=uv;gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader: 'varying vec2 v;' + frag
    })
  }

  const extract = shader(
    { img: { value: off.texture }, texel: { value: new T.Vector2() } },
    `uniform sampler2D img;uniform vec2 texel;void main(){vec3 c=(texture2D(img,v-texel).rgb+texture2D(img,v+texel).rgb+texture2D(img,v+vec2(texel.x,-texel.y)).rgb+texture2D(img,v+vec2(-texel.x,texel.y)).rgb)*.25;float l=max(max(c.r,c.g),c.b);gl_FragColor=vec4(c*smoothstep(.16,.81,l),1.);}`
  )
  const blur = shader(
    { img: { value: lum.texture }, stepv: { value: new T.Vector2() } },
    `uniform sampler2D img;uniform vec2 stepv;void main(){vec3 c=texture2D(img,v).rgb*.22703;c+=(texture2D(img,v+1.3846*stepv).rgb+texture2D(img,v-1.3846*stepv).rgb)*.316216;c+=(texture2D(img,v+3.23077*stepv).rgb+texture2D(img,v-3.23077*stepv).rgb)*.07027;gl_FragColor=vec4(c,1.);}`
  )
  const mixpass = shader(
    {
      img: { value: off.texture },
      edge: { value: narrow.texture },
      halo: { value: wide.texture },
      intensity: { value: 1 },
      accent: { value: new T.Color(ATLAS[0]!.primary) }
    },
    `uniform sampler2D img,edge,halo;uniform float intensity;uniform vec3 accent;void main(){vec4 a=texture2D(img,v);vec3 e=texture2D(edge,v).rgb,h=texture2D(halo,v).rgb;vec3 hue=mix(vec3(1.),accent,.57);vec3 glow=(e*.73+h*.82)*hue*intensity;glow=glow/(1.+glow*.55);vec3 c=a.rgb+glow*(1.-a.rgb*.74);gl_FragColor=vec4(min(c,vec3(1.)),min(1.,a.a+max(max(glow.r,glow.g),glow.b)*.84));}`
  )

  function fitBuffers(w: number, h: number): void {
    const px = r.getPixelRatio()
    const W = Math.max(1, Math.round(w * px))
    const H = Math.max(1, Math.round(h * px))
    const div = currentTier === 'light' ? 4 : 3
    const ww = Math.max(1, Math.round(W / div))
    const hh = Math.max(1, Math.round(H / div))
    off.setSize(W, H)
    for (const b of [lum, tmp, narrow, wide]) b.setSize(ww, hh)
    ;(extract.uniforms.texel!.value as T.Vector2).set(0.78 / W, 0.78 / H)
  }

  function pass(m: T.ShaderMaterial, target: T.WebGLRenderTarget | null): void {
    quad.material = m
    r.setRenderTarget(target)
    r.render(post, cam2)
  }

  function renderBloom(age: number): void {
    r.setRenderTarget(off)
    r.render(scene, cam)
    pass(extract, lum)
    blur.uniforms.img!.value = lum.texture
    ;(blur.uniforms.stepv!.value as T.Vector2).set(1.24 / lum.width, 0)
    pass(blur, tmp)
    blur.uniforms.img!.value = tmp.texture
    ;(blur.uniforms.stepv!.value as T.Vector2).set(0, 1.24 / lum.height)
    pass(blur, narrow)
    blur.uniforms.img!.value = narrow.texture
    ;(blur.uniforms.stepv!.value as T.Vector2).set(4.6 / lum.width, 0)
    pass(blur, tmp)
    blur.uniforms.img!.value = tmp.texture
    ;(blur.uniforms.stepv!.value as T.Vector2).set(0, 4.6 / lum.height)
    pass(blur, wide)
    ;(mixpass.uniforms.accent!.value as T.Color).set(ATLAS[form]!.primary)
    mixpass.uniforms.intensity!.value =
      0.86 + (age >= 0 && age < 4.4 ? 0.5 * Math.sin((age * Math.PI) / 4.4) : 0)
    pass(mixpass, null)
  }

  let curW = 0
  let curH = 0
  let curDpr = 0

  function resize(width: number, height: number, dpr: number): void {
    if (disposed || width <= 0 || height <= 0) return
    const clampedDpr = Math.min(dpr || 1, maxDprForTier())
    if (width === curW && height === curH && clampedDpr === curDpr) return
    curW = width
    curH = height
    curDpr = clampedDpr
    const span = Math.max(9.55, (11.35 * height) / width)
    cam.left = (-span * width) / height / 2
    cam.right = -cam.left
    cam.top = span / 2
    cam.bottom = -cam.top
    cam.updateProjectionMatrix()
    r.setPixelRatio(clampedDpr)
    gm.uniforms.px!.value = clampedDpr
    r.setSize(width, height, false)
    fitBuffers(width, height)
  }

  function mixData(a: FormationLayout, b: FormationLayout, f: number): FormationLayout {
    const o: FormationLayout = {
      p: new Float32Array(b.p.length),
      q: new Float32Array(b.q.length),
      col: new Float32Array(b.col.length),
      v: new Float32Array(b.v.length)
    }
    for (const key of ['p', 'q', 'col', 'v'] as const) {
      const dst = o[key]
      const sa = a[key]
      const sb = b[key]
      for (let j = 0; j < dst.length; j++) dst[j] = sa[j]! * (1 - f) + sb[j]! * f
    }
    for (let i = 0; i < COUNT; i++) {
      const j = i * 4
      let d = 0
      for (let k = 0; k < 4; k++) d += a.q[j + k]! * b.q[j + k]!
      let n = 0
      const sign = d < 0 ? -1 : 1
      for (let k = 0; k < 4; k++) {
        const z = a.q[j + k]! * (1 - f) + b.q[j + k]! * f * sign
        o.q[j + k] = z
        n += z * z
      }
      const invLen = 1 / (Math.sqrt(n) || 1)
      for (let k = 0; k < 4; k++) o.q[j + k] = o.q[j + k]! * invLen
    }
    return o
  }

  function choose(i: number): void {
    const idx = ((i % ATLAS.length) + ATLAS.length) % ATLAS.length
    if (idx === form) return
    const next = layout(idx)
    A = prog >= 1 ? B : mixData(A, B, U.morph.value)
    B = next
    refClock = -9
    hero.select(idx, B)
    oldTilt = tilt
    oldRoll = roll
    form = idx
    U.form.value = idx
    prog = isReducedMotion() ? 1 : 0
    U.morph.value = prog
    U.castTime.value = -8
    ct = -8
    targetZoom = 1
    ornament(idx)
  }

  const aim = new T.Quaternion()
  const axis = new T.Vector3()
  const turn = new T.Quaternion()
  const vx = new T.Vector3()
  const vy = new T.Vector3()
  const caseRig = new T.Group()
  const holder = new T.Group()
  caseRig.add(holder)
  scene.add(caseRig)
  caseRig.visible = false
  let focus = -1
  let saved: {
    parent: T.Object3D
    p: T.Vector3
    q: T.Quaternion
    s: T.Vector3
    z: number
    t: number
    flags: [T.Object3D, boolean][]
  } | null = null
  let focusTime = 0

  const views: readonly [number, number, number, number][] = [
    [0, 0.1, 0, 1.06],
    [0, 1.289, 0, 13],
    [0, 1.36, 0, 4.25],
    [0, 2.66, 0, 5.5],
    [0, -1.27, 0, 3.4]
  ]

  const tipCtl = tipGrip(
    host,
    cam,
    hero,
    () => focus >= 0,
    handles.tipHandle,
    handles.tipLabel,
    handles.getTipLabels
  )
  const posCtl = positionGrip(host, cam, hero, () => focus >= 0, [handles.swordHandle, handles.sheathHandle])

  function inspect(i: number): void {
    tipCtl.end()
    posCtl.end()
    if (i < 0) {
      if (!saved) return
      bladeShuttle.setInspect(false)
      const sw = hero.sword
      saved.parent.add(sw)
      sw.position.copy(saved.p)
      sw.quaternion.copy(saved.q)
      sw.scale.copy(saved.s)
      for (const [o, vis] of saved.flags) o.visible = vis
      caseRig.visible = false
      root.visible = true
      zoom = saved.z
      targetZoom = saved.t
      focus = -1
      saved = null
      cam.zoom = zoom
      cam.updateProjectionMatrix()
      return
    }
    if (!saved) {
      bladeShuttle.setInspect(true)
      const sw = hero.sword
      saved = {
        parent: sw.parent!,
        p: sw.position.clone(),
        q: sw.quaternion.clone(),
        s: sw.scale.clone(),
        z: zoom,
        t: targetZoom,
        flags: sw.children.map((o) => [o, o.visible])
      }
      holder.add(sw)
      sw.position.set(0, 0, 0)
      sw.quaternion.identity()
      sw.scale.setScalar(1)
      for (const o of sw.children) o.visible = !!o.userData.weaponPart
      caseRig.visible = true
      root.visible = false
      focusTime = clock
    }
    focus = i
    hero.sword.position.set(0, 0, 0)
    hero.sword.quaternion.identity()
    const [x, y, z, l] = views[i] ?? views[0]!
    holder.position.set(-x, -y, -z)
    caseRig.quaternion.setFromEuler(new T.Euler(0.025, i === 1 ? -0.035 : -0.16, -0.04))
    targetZoom = l
    zoom = l
    cam.zoom = l
    cam.updateProjectionMatrix()
  }

  const limitZoom = (v: number): number => clamp(v, focus < 0 ? 0.46 : 0.75, focus < 0 ? 9 : 26)
  function scaleZoom(m: number): void {
    targetZoom = limitZoom(targetZoom * m)
  }
  function orbitQ(): T.Quaternion {
    return focus < 0 ? aim : caseRig.quaternion
  }
  function rollBy(a: number): void {
    turn.setFromAxisAngle(axis.set(0, 0, 1), a)
    orbitQ().premultiply(turn).normalize()
  }

  function surface(px: number, py: number, b: DOMRect, out: T.Vector3): T.Vector3 {
    const rad = Math.min(b.width, b.height) * 0.46 || 1
    const x = (px - b.left - b.width / 2) / rad
    const y = (b.top + b.height / 2 - py) / rad
    const d = x * x + y * y
    return out.set(x, y, d < 0.5 ? Math.sqrt(1 - d) : 0.5 / Math.sqrt(d)).normalize()
  }

  const onContextMenu = (e: MouseEvent) => e.preventDefault()

  const onPointerDown = (e: PointerEvent) => {
    try {
      host.setPointerCapture(e.pointerId)
    } catch {
      // Best-effort capture
    }
    touches.set(e.pointerId, [e.clientX, e.clientY])
    drag = true
    host.dataset.dragging = 'true'
    if (touches.size === 1) {
      if (!tipCtl.start(e)) posCtl.start(e)
    } else {
      tipCtl.end()
      posCtl.end()
    }
  }

  const onPointerMove = (e: PointerEvent) => {
    if (posCtl.move(e)) {
      touches.set(e.pointerId, [e.clientX, e.clientY])
      return
    }
    if (tipCtl.move(e)) {
      touches.set(e.pointerId, [e.clientX, e.clientY])
      return
    }
    tipCtl.hover(e)
    const old = touches.get(e.pointerId)
    if (!old) return
    const next: [number, number] = [e.clientX, e.clientY]
    const otherEntry = [...touches].find(([key]) => key !== e.pointerId)
    const other = otherEntry?.[1]
    if (other) {
      const dx = old[0] - other[0]
      const dy = old[1] - other[1]
      const ex = next[0] - other[0]
      const ey = next[1] - other[1]
      scaleZoom(Math.hypot(ex, ey) / (Math.hypot(dx, dy) || 1))
      rollBy(Math.atan2(dy, dx) - Math.atan2(ey, ex))
    } else if (e.shiftKey || e.buttons === 2) {
      rollBy((old[0] - next[0]) * 0.012)
    } else {
      const rect = host.getBoundingClientRect()
      surface(old[0], old[1], rect, vx)
      surface(next[0], next[1], rect, vy)
      turn.setFromUnitVectors(vx, vy)
      orbitQ().premultiply(turn).normalize()
    }
    touches.set(e.pointerId, next)
  }

  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerId === tipCtl.id) tipCtl.end()
    if (e.pointerId === posCtl.id) posCtl.end()
    touches.delete(e.pointerId)
    drag = touches.size > 0
    host.dataset.dragging = String(drag)
  }

  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    scaleZoom(Math.exp(-e.deltaY * 0.0015))
  }

  const onDblClick = () => {
    if (focus < 0) targetZoom = targetZoom > 1.6 ? 1 : 2.6
    else inspect(focus)
  }

  host.addEventListener('contextmenu', onContextMenu)
  host.addEventListener('pointerdown', onPointerDown)
  host.addEventListener('pointermove', onPointerMove)
  host.addEventListener('pointerup', onPointerUp)
  host.addEventListener('pointercancel', onPointerUp)
  host.addEventListener('lostpointercapture', onPointerUp)
  host.addEventListener('wheel', onWheel, { passive: false })
  host.addEventListener('dblclick', onDblClick)

  function cancelDrag(): void {
    tipCtl.end()
    posCtl.end()
    touches.clear()
    drag = false
    host.dataset.dragging = 'false'
  }

  function renderStep(now: number, dt: number): void {
    if (focus >= 0) {
      focusTime += dt
      hero.inspectTick(focusTime)
      zoom += (targetZoom - zoom) * 0.25
      cam.zoom = zoom
      cam.updateProjectionMatrix()
      tipCtl.applyStudy()
      posCtl.apply()
      renderBloom(-1)
      tipCtl.place()
      posCtl.place()
      frameCallback(prog, -1, cam.zoom, dt, spirit)
      return
    }

    if (!frozen) clock += dt
    prog = Math.min(1, prog + (frozen ? 0 : dt) / 1.95)
    const f = prog * prog * (3 - 2 * prog)
    U.morph.value = f
    U.tm.value = clock
    U.castTime.value = ct < 0 ? -8 : clock - ct
    tilt = oldTilt + (ATLAS[form]!.tilt - oldTilt) * f
    roll = oldRoll + (ATLAS[form]!.roll - oldRoll) * f
    if (auto && (!drag || tipCtl.active || posCtl.active) && !frozen) {
      axis.set(0.36 * Math.sin(clock * 0.28), 1, 0.37 * Math.cos(clock * 0.21)).normalize()
      aim.premultiply(turn.setFromAxisAngle(axis, dt * 0.24)).normalize()
    }
    root.quaternion.slerp(aim, 1 - Math.exp(-dt * 21))
    zoom += (targetZoom - zoom) * 0.17
    const needsFraming = Boolean(spirit && (spirit.mode === 'close' || spirit.mode === 'open'))
    const framing = needsFraming ? Math.min(1, 0.55 / zoom) : 1
    actionZoom += (framing - actionZoom) * (1 - Math.exp(-dt * 5))
    cam.zoom = zoom * actionZoom
    cam.updateProjectionMatrix()

    const gate = f * (1 + 0.59 * Math.max(0, 1 - Math.abs(U.castTime.value - 1.65) / 2.4))
    for (const m of brushes) m.uniforms.gate!.value = gate

    spirit = hero.frame(clock, frozen ? 0 : dt, U.castTime.value, tipCtl.solve, posCtl.apply)
    bodyBeat = chorus ? spirit.beat : 0
    danceScore = chorus ? score(form, spirit.phase) : null
    if (!frozen) spinAngle = (spinAngle + dt * 0.24 * spinSpeed) % (Math.PI * 2)
    rq.setFromEuler(
      re.set(tilt + (danceScore?.x ?? 0), danceScore?.y ?? 0, roll + (danceScore?.z ?? 0), 'ZXY')
    ).multiply(spinQ.setFromAxisAngle(spinAxis, spinAngle))
    world.quaternion.slerp(rq, frozen ? 0 : 1 - Math.exp(-dt * 14))
    hero.sync()
    cam.updateMatrixWorld()
    for (const [vecU, y] of [
      [U.hiltView, 3.42],
      [U.tipView, -3.52]
    ] as const) {
      vecU.value.set(0, y, 0).applyMatrix4(hero.sword.matrixWorld).applyMatrix4(cam.matrixWorldInverse)
    }

    const refInterval = currentTier === 'light' || eco ? 0.09 : 0.035
    if (form >= 12 && Math.abs(clock - refClock) > refInterval) {
      const amp =
        chorus || spirit.rec >= 0 || (U.castTime.value >= 0 && U.castTime.value <= 4.5) ? spirit.amp : 0
      updateReference(B, form - 12, clock, amp)
      refClock = clock
    }
    ritual.tick(U.castTime.value < 0 ? -1 : U.castTime.value - 0.27)
    simulate(f, clock, U.castTime.value, form)
    shuttle.tick(frozen ? 0 : dt, clock, frameP, frameQ, frameC, frameM)
    bladeShuttle.tick(frozen ? 0 : dt, clock, frameP, frameQ, frameC, frameM)
    fusion.tick(
      frozen ? 0 : dt,
      frameP,
      frameQ,
      frameC,
      frameM,
      shuttle.progress === 0 && bladeShuttle.progress === 0
    )
    if (fusion.progress > 0) {
      for (const [name, arr, d] of buffers) {
        const attr = glints.attributes[name] as T.BufferAttribute
        const out = attr.array as Float32Array
        for (let i = 0; i < isG.length; i++) {
          const offIdx = isG[i]! * d
          for (let ch = 0; ch < d; ch++) out[i * d + ch] = arr[offIdx + ch]!
        }
        attr.needsUpdate = true
      }
      glp.visible = fusion.progress < 0.95
    } else {
      glp.visible = true
    }

    if (shuttle.progress === 0 && !shuttle.away) hero.setAbsent(false)
    spirit.fusionRemaining = fusion.remaining
    spirit.fusion = fusion.progress
    spirit.fusionTarget = fusion.target
    spirit.swordTransfer = bladeShuttle.progress
    spirit.swordAway = bladeShuttle.away
    spirit.swordJoined = bladeShuttle.joined
    spirit.transfer = shuttle.progress
    spirit.away = shuttle.away
    spirit.joined = shuttle.joined
    hero.links(frameP, clock, f * (1 - fusion.progress))
    renderBloom(U.castTime.value)
    tipCtl.place()
    posCtl.place()
    frameCallback(prog, U.castTime.value, cam.zoom, dt, spirit)

    if (onFrameRate) {
      if (!sampleStarted) sampleStarted = now
      sampledFrames += 1
      const sampleDuration = now - sampleStarted
      if (sampleDuration >= 3000) {
        const fps = (sampledFrames * 1000) / sampleDuration
        sampleStarted = now
        sampledFrames = 0
        onFrameRate(fps)
      }
    }
  }

  function scheduleLoop(): void {
    if (disposed || suspended || rafId) return
    last = 0
    lastRender = 0
    sampleStarted = performance.now()
    sampledFrames = 0
    rafId = requestAnimationFrame(draw)
  }

  function stopLoop(): void {
    if (rafId) cancelAnimationFrame(rafId)
    rafId = 0
    last = 0
    lastRender = 0
    sampleStarted = 0
    sampledFrames = 0
  }

  function draw(now: number): void {
    rafId = 0
    if (disposed || suspended) return
    const interval = currentTier === 'light' ? 1000 / 30 : 0
    if (!lastRender || interval === 0 || now - lastRender >= interval - 0.5) {
      const dt = last ? Math.min(0.1, Math.max(0, (now - last) * 0.001)) : 0
      last = now
      lastRender = now
      renderStep(now, dt)
    }
    if (!disposed && !suspended) {
      rafId = requestAnimationFrame(draw)
    }
  }

  // Initial sizing and first render
  resize(host.clientWidth || 800, host.clientHeight || 600, window.devicePixelRatio || 1)
  renderStep(performance.now(), 0)
  scheduleLoop()

  function dispose(releaseContext = false): void {
    if (disposed) return
    disposed = true
    stopLoop()
    cancelDrag()
    tipCtl.dispose()
    posCtl.dispose()
    host.removeEventListener('contextmenu', onContextMenu)
    host.removeEventListener('pointerdown', onPointerDown)
    host.removeEventListener('pointermove', onPointerMove)
    host.removeEventListener('pointerup', onPointerUp)
    host.removeEventListener('pointercancel', onPointerUp)
    host.removeEventListener('lostpointercapture', onPointerUp)
    host.removeEventListener('wheel', onWheel)
    host.removeEventListener('dblclick', onDblClick)

    ritual.dispose()
    shuttle.dispose()
    bladeShuttle.dispose()
    hero.dispose()

    const geometries = new Set<T.BufferGeometry>([geo, glints, quadGeo])
    const materials = new Set<T.Material>([mat, gm, extract, blur, mixpass, ...Object.values(hero.materials)])
    const textures = new Set<T.Texture>()

    const collect = (rootObj: T.Object3D) => {
      rootObj.traverse((obj) => {
        if (obj instanceof T.Mesh || obj instanceof T.Points || obj instanceof T.Line) {
          if (obj.geometry) geometries.add(obj.geometry)
          const m = obj.material
          if (Array.isArray(m)) m.forEach((item) => materials.add(item))
          else if (m) materials.add(m)
        }
      })
    }
    collect(scene)
    collect(post)

    materials.forEach((m) => {
      for (const value of Object.values(m)) {
        if (value instanceof T.Texture) textures.add(value)
      }
      m.dispose()
    })
    geometries.forEach((g) => g.dispose())
    textures.forEach((t) => t.dispose())
    for (const rt of [off, lum, tmp, narrow, wide]) rt.dispose()
    r.dispose()
    if (releaseContext) r.forceContextLoss()
  }

  return {
    choose,
    inspect,
    setChorus(v: boolean) {
      chorus = v
    },
    exchange() {
      if (fusion.target || fusion.progress > 0) return
      const a = shuttle.flip()
      hero.setAbsent(!!a || shuttle.progress > 0)
    },
    swordExchange() {
      if (fusion.target || fusion.progress > 0) return
      bladeShuttle.flip()
    },
    fusion() {
      const a = fusion.flip()
      if (a) {
        shuttle.returnHome()
        bladeShuttle.returnHome()
      }
    },
    setDance(v: boolean) {
      hero.setDance(v)
    },
    actuate(type: 'sheath' | 'recall' | 'cast') {
      hero.actuate(type)
      frozen = false
    },
    cast() {
      hero.actuate('cast')
      ct = clock
      frozen = false
    },
    reset() {
      if (focus >= 0) {
        inspect(focus)
        return
      }
      hero.resetBlade()
      hero.resetPosition()
      aim.identity()
      targetZoom = 1
    },
    zoom: scaleZoom,
    orbit(v: boolean) {
      auto = v
    },
    rotationSpeed(v: number) {
      spinSpeed = clamp(Number(v) || 0, 0, 3)
    },
    pause(v: boolean) {
      frozen = v
    },
    setSuspended(v: boolean) {
      if (v === suspended) return
      suspended = v
      if (suspended) {
        cancelDrag()
        stopLoop()
      } else {
        scheduleLoop()
      }
    },
    setTier(tier: 'full' | 'light') {
      if (tier === currentTier) return
      currentTier = tier
      sampleStarted = performance.now()
      sampledFrames = 0
      const w = host.clientWidth || curW
      const h = host.clientHeight || curH
      curDpr = 0 // force DPR / buffer recalc for new tier
      resize(w, h, window.devicePixelRatio || 1)
    },
    resize,
    cancelDrag,
    nudgeTip(dx: number, dy: number) {
      tipCtl.nudge(dx, dy)
    },
    resetFpsSampling() {
      sampleStarted = performance.now()
      sampledFrames = 0
    },
    onframe(fn: FrameCallback) {
      frameCallback = fn
    },
    dispose,
    get count() {
      return geo.instanceCount
    },
    renderer: r
  }
}
