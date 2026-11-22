// Per-formation light choreography. Ribbon paths, crest flares and expelled stardust are separate from the 10,000 solid sword instances.
import * as T from 'three'
import type { FormationSpec } from './layouts'

export interface RitualRig {
  build(id: number): void
  tick(t: number): void
  dispose(): void
}

type PathFn = (u: number) => [number, number, number]

export function createRitual(parent: T.Group, atlas: readonly FormationSpec[]): RitualRig {
  const fx = new T.Group()
  parent.add(fx)
  const age = { value: -10 }
  let heads: [T.Mesh<T.PlaneGeometry, T.ShaderMaterial>, number][] = []
  let paths: { fn: PathFn; delay: number; speed: number }[] = []
  const duration = 4.4
  const TAU = 2 * Math.PI
  const opts = {
    transparent: true,
    depthWrite: false,
    blending: T.AdditiveBlending,
    side: T.DoubleSide
  } as const
  const headGeo = new T.PlaneGeometry(1, 1)
  const pos = (a: number, r: number, z = 0): [number, number, number] => [r * Math.cos(a), r * Math.sin(a), z]
  const mix = (a: number, b: number, t: number): number => a + (b - a) * t

  function clearFx(): void {
    for (const o of [...fx.children]) {
      fx.remove(o)
      if (o instanceof T.Mesh || o instanceof T.Points) {
        if (o.geometry !== headGeo) o.geometry.dispose()
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose())
        else o.material.dispose()
      }
    }
    paths = []
    heads = []
  }

  function build(id: number): void {
    clearFx()
    const pal = atlas[id]!
    const A = pal.primary
    const B = pal.secondary
    let seed = 886 + id * 923
    const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const vertices: number[] = []
    const uv: number[] = []
    const colors: number[] = []
    const sw: number[] = []
    const idx: number[] = []
    const sp: number[] = []
    const sv: number[] = []
    const born: number[] = []
    const sizes: number[] = []
    const sc: number[] = []

    function path(fn: PathFn, color: string, delay: number, speed: number, w: number, flare = true): void {
      const C = new T.Color(color)
      const ord = paths.length
      paths.push({ fn, delay, speed })
      const len = 100
      for (let wire = 0; wire < 2; wire++) {
        const base = vertices.length / 3
        for (let k = 0; k <= len; k++) {
          const t = k / len
          const v = fn(t)
          const q = fn(t + 0.0002)
          const dx = q[0] - v[0]
          const dy = q[1] - v[1]
          const l = Math.hypot(dx, dy) || 1
          const k0 = wire ? 0.26 : 1
          for (const side of [-1, 1]) {
            const nr =
              (side * w * k0 + (wire ? 0.028 : 0)) * Math.pow(Math.max(0.015, Math.sin(t * Math.PI)), 0.43)
            vertices.push(v[0] - (dy / l) * nr, v[1] + (dx / l) * nr, v[2] + 0.006 * wire)
            uv.push(t, side)
            colors.push(C.r, C.g, C.b)
            sw.push(delay, speed, wire)
          }
          if (k < len) {
            const b = base + k * 2
            idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2)
          }
        }
      }
      if (flare) {
        const m = new T.ShaderMaterial({
          ...opts,
          uniforms: { col: { value: C }, al: { value: 0 } },
          vertexShader: `varying vec2 v;void main(){v=uv*2.-1.;vec4 p=modelViewMatrix*vec4(0.,0.,0.,1.);p.xy+=position.xy*1.05;gl_Position=projectionMatrix*p;}`,
          fragmentShader: `varying vec2 v;uniform vec3 col;uniform float al;void main(){float blur=exp(-length(v)*7.3),crossline=exp(-abs(v.x)*90.-abs(v.y)*6.)+exp(-abs(v.y)*120.-abs(v.x)*4.4);gl_FragColor=vec4(mix(col,vec3(.94,1.,1.),min(1.,crossline)),al*(blur+.8*crossline)*(1.-smoothstep(.7,1.,length(v))));}`
        })
        const h = new T.Mesh(headGeo, m)
        h.frustumCulled = false
        fx.add(h)
        heads.push([h, ord])
      }
      for (let j = 0; j < 58; j++) {
        const t = R()
        const v = fn(t)
        const an = R() * TAU
        const size = R()
        const v0 = 0.2 + 0.78 * R()
        sp.push(v[0], v[1], v[2])
        sv.push(Math.cos(an) * v0, 0.09 + Math.sin(an) * v0, (R() - 0.5) * 0.82)
        born.push(delay + t * speed)
        sizes.push(2.3 + size * 3)
        sc.push(C.r, C.g, C.b)
      }
    }

    const ring =
      (x: number, y: number, z: number, rx: number, ry: number, angle = 0): PathFn =>
      (u) => [x + rx * Math.cos(u * TAU + angle), y + ry * Math.sin(u * TAU + angle), z]

    if (id === 0) {
      for (let j = 0; j < 9; j++) {
        path(
          (u) => {
            const rr = 0.14 + 4.56 * u
            const a = (j * TAU) / 9 + 0.72 * rr + 0.36 * Math.log(0.5 + rr) + 0.03
            return pos(a, rr, 0.43 - 0.4 * u + 0.09 * Math.sin(u * 8))
          },
          j % 3 ? A : B,
          0.1 * j,
          1.78,
          0.085
        )
      }
      path(ring(0, 0, 0.12, 4.41, 4.41), B, 1.48, 1.61, 0.047)
    }
    if (id === 1) {
      for (const s of [-1, 1]) {
        path(
          (u) => {
            const v = u * TAU * 1.18
            const t = s < 0 ? Math.PI : 0
            const rr = 1.52 * (1 - 0.45 * u)
            return [rr * Math.cos(v + t), s * 1.64 + rr * Math.sin(v + t), 0.59 + 0.21 * Math.sin(v)]
          },
          s > 0 ? B : A,
          0.1,
          1.85,
          0.09
        )
        path(
          (u) => [
            s * (2.7 * Math.sin(u * Math.PI)),
            s * (3.31 - 6.62 * u),
            0.5 + 0.38 * Math.sin(u * Math.PI)
          ],
          s > 0 ? A : B,
          1.39,
          1.78,
          0.1
        )
      }
    }
    if (id === 2) {
      for (let j = 0; j < 6; j++) {
        path(
          (u) => [
            -4.2 + 7.35 * u,
            -0.32 +
              1.23 * Math.sin(Math.min(1, u * 1.14) * TAU * 1.24 - 0.68) +
              1.44 * Math.min(1, u * 1.14) +
              (0.1 + j * 0.032) * Math.cos(u * 28 + j),
            0.55 * Math.sin(Math.min(1, u * 1.14) * TAU * 1.44) + 0.26 * Math.sin(u * 28 + j)
          ],
          j % 2 ? A : B,
          j * 0.13,
          2.3,
          0.075,
          j % 2 === 0
        )
      }
      for (let k = 0; k < 3; k++) {
        path(
          (u) => [
            3.06 + 0.96 * u,
            2.06 + Math.sin((u * 2 + k) * Math.PI) * (0.37 - 0.23 * u),
            0.23 + 0.34 * Math.cos(u * 6)
          ],
          B,
          2.12 + k * 0.11,
          0.91,
          0.066
        )
      }
    }
    if (id === 3) {
      for (const s of [-1, 1]) {
        for (let j = 0; j < 7; j++) {
          path(
            (u) => [
              s * (0.14 + u * (4.08 - j * 0.24)),
              0.34 + 0.75 * Math.sin(Math.PI * u) + (1.77 - j * 0.32) * u * u,
              0.18 + 0.48 * Math.sin(Math.PI * u) + 0.23 * u
            ],
            j % 2 ? A : B,
            0.15 + j * 0.1,
            1.38 + 0.1 * j,
            0.081,
            j % 2 === 0
          )
        }
      }
      for (let j = -2; j <= 2; j++) {
        path(
          (u) => [
            j * 0.68 * u - 0.3 * Math.sin(u * 7),
            -0.24 - 2.9 * u + 0.26 * Math.abs(j) * u,
            0.15 + Math.sin(u * 4) * 0.19
          ],
          j % 2 ? A : B,
          1.66 + 0.13 * Math.abs(j),
          1.5,
          0.08
        )
      }
    }
    if (id === 4) {
      for (let j = 0; j < 10; j++) {
        path(
          (u) => {
            const q = u * Math.PI
            const r = 0.19 + 3.8 * Math.sin(q)
            const a = (j * TAU) / 10 + 0.29 * Math.sin(q * 2)
            return pos(a, r, -0.42 + 0.95 * Math.sin(q))
          },
          j % 2 ? A : B,
          j * 0.1,
          1.9,
          0.08
        )
      }
      for (let j = 0; j < 6; j++) {
        path(
          (u) => {
            const a = (j * TAU) / 6 + 2.2 * u
            return pos(a, 0.2 + 1.33 * Math.sin(u * Math.PI), 0.31 + 1.58 * u)
          },
          B,
          1.92 + j * 0.1,
          1.08,
          0.064
        )
      }
    }
    if (id === 5) {
      for (let j = 0; j < 8; j++) {
        const a = (j * TAU) / 8 + Math.PI / 2
        path(
          (u) => pos(a, 0.29 + 3.74 * u, 0.31 + 0.36 * Math.sin(u * Math.PI)),
          j % 2 ? A : B,
          j * 0.15,
          1.13,
          0.103
        )
        path(
          (u) => {
            const theta = a + (u * TAU) / 8
            return pos(theta, 3.7, 0.18)
          },
          B,
          1.6 + j * 0.12,
          0.65,
          0.068
        )
      }
      path(ring(0, 0, 0.29, 1.54, 1.54), A, 2.25, 0.94, 0.073)
    }
    if (id === 6) {
      for (let j = 0; j < 5; j++) {
        const w = 2.74 - j * 0.4
        const y = -1.4 + j * 0.83
        path(
          (u) => [
            w * Math.cos(u * TAU),
            y + 0.34 * Math.pow(Math.cos(u * TAU), 4),
            w * 0.57 * Math.sin(u * TAU)
          ],
          B,
          0.26 * j,
          1.16,
          0.089
        )
      }
      for (let j = 0; j < 4; j++) {
        path(
          (u) => {
            const rad = 2.74 * (1 - u) + 0.12
            const a = 4.8 * u + (j * TAU) / 4
            return [rad * Math.cos(a), -2.27 + 5.58 * u, rad * 0.64 * Math.sin(a)]
          },
          A,
          0.85 + j * 0.17,
          2.21,
          0.077
        )
      }
    }
    if (id === 7) {
      for (let j = 0; j < 6; j++) {
        const a = (j * TAU) / 6
        path((u) => pos(a, 0.19 + 3.97 * u, 0.29), A, j * 0.095, 1.44, 0.082)
        for (const s of [-1, 1]) {
          path(
            (u) => [
              1.68 * Math.cos(a) + 1.18 * u * Math.cos(a + s * 0.76),
              1.68 * Math.sin(a) + 1.18 * u * Math.sin(a + s * 0.76),
              0.34 + 0.18 * u
            ],
            B,
            1.19 + j * 0.16,
            0.99,
            0.062,
            false
          )
        }
      }
    }
    if (id === 8) {
      for (const s of [-1, 1]) {
        for (let j = 0; j < 3; j++) {
          path(
            (u) => {
              const a = u * TAU * 1.23 + j * 2.1
              const th = s * 0.52
              const rad = (s > 0 ? 1.03 : 1.27) * (1.73 + 0.13 * j)
              const x = rad * Math.cos(a)
              const y = rad * 0.35 * Math.sin(a)
              return [
                s * 1.85 + x * Math.cos(th) - y * Math.sin(th),
                s * 0.47 + x * Math.sin(th) + y * Math.cos(th),
                rad * 0.74 * Math.sin(a)
              ]
            },
            s > 0 ? B : A,
            j * 0.25,
            1.7,
            0.087
          )
        }
      }
      for (let j = 0; j < 4; j++) {
        path(
          (u) => [
            -1.85 + 3.7 * u,
            -0.47 + 0.94 * u + 0.57 * Math.sin(u * TAU + j * 0.42),
            0.49 * Math.sin(u * TAU + j * 0.6)
          ],
          j % 2 ? A : B,
          1.53 + j * 0.21,
          1.32,
          0.075
        )
      }
    }
    if (id === 9) {
      for (let j = 0; j < 12; j++) {
        path(
          (u) => {
            const v = 1 - u
            const k = j / 11
            return [
              -4 * v * v * v - 2.1 * v * v * u + (0.9 + 3.7 * k) * v * u * u + (2.4 + 0.74 * k) * u * u * u,
              (-1.56 + 0.8 * k) * v ** 3 +
                (-9 + 3 * k) * v * v * u +
                (9.24 + 2 * k) * v * u * u +
                (1.31 + 0.28 * k) * u ** 3,
              0.14 + 0.39 * Math.sin(u * 5 + j * 0.4)
            ]
          },
          j % 3 ? A : B,
          j * 0.077,
          1.73,
          0.086,
          j % 3 === 0
        )
      }
      for (let j = 0; j < 8; j++) {
        path(
          (u) => [
            2.13 + j * 0.13 + 0.34 * Math.sin(Math.PI * u) - 0.24 * u,
            1.96 - u * (1 + 0.065 * j),
            0.19 + 0.07 * j
          ],
          B,
          1.76 + j * 0.087,
          0.99,
          0.042
        )
      }
    }
    if (id === 10) {
      const xs = [-1.76, 0, 1.63] as const
      const hs = [3.21, 4.55, 3.13] as const
      for (let j = 0; j < 3; j++) {
        const x = xs[j]!
        const h = hs[j]!
        for (let k = 0; k < 3; k++) {
          path(
            (u) => [
              x + 0.22 * Math.sin(u * 6) + 0.13 * k,
              -1.96 + h * 0.82 - h * 0.92 * u,
              0.12 + 0.76 * u + 0.08 * k
            ],
            k === 1 ? B : A,
            j * 0.28 + k * 0.12,
            1.86,
            0.08,
            k === 1
          )
        }
      }
      path((u) => [-3.45 + 6.9 * u, -1.91 + 0.3 * Math.sin(u * 9), 0.59], B, 1.94, 1.45, 0.084)
    }
    if (id === 11) {
      for (const s of [-1, 1]) {
        path((u) => [s * (0.15 + 1.02 * Math.sin(u * Math.PI)), 2.16 - 1.23 * u, 0.2], B, 0.09, 1.02, 0.085)
        path((u) => [s * 0.25 * (1 - u ** 8), 0.99 - 4.63 * u, 0.17], A, 0.98, 1.39, 0.069)
      }
      for (let j = 0; j < 5; j++) {
        path(
          (u) => {
            const a = (j * TAU) / 5 + u * 5
            const rr = 0.19 + 0.7 * Math.sin(u * Math.PI)
            return [rr * Math.cos(a), 2.04 - 5.59 * u, rr * Math.sin(a)]
          },
          j % 2 ? A : B,
          1.21 + 0.13 * j,
          1.87,
          0.088
        )
      }
    }
    if (id >= 12) {
      const j = id - 12
      const n = [4, 12, 5, 5, 6, 3, 7, 6, 18, 9, 5, 9][j]!
      const wxColors = ['#efc177', '#7dd6a7', '#72bfee', '#f69375', '#c1a0de'] as const
      for (let a = 0; a < n; a++) {
        const theta = (TAU * a) / n
        path(
          (u) => {
            const k = TAU * u
            let an = theta
            let r = 0.18 + 3.3 * u
            let z = 0.38 + 0.22 * Math.sin(k)
            switch (j) {
              case 0:
                an += 0.12 * Math.sin(k)
                break
              case 1:
                return [
                  -3.4 + 6.8 * u,
                  (a - 5.5) * 0.36 + 0.83 * Math.sin(k * 0.6 + theta),
                  0.9 * Math.cos(theta)
                ]
              case 2:
                r = 0.22 + 3.4 * Math.sin(k * 0.5)
                an += 0.48 * Math.sin(k)
                break
              case 3:
                return [1.55 * Math.cos(theta + k * 1.5), -3.14 + 6.2 * u, 1.3 * Math.sin(theta + k * 1.5)]
              case 4:
                r = 0.72 + a * 0.51
                an = k
                z -= a * 0.18
                break
              case 5:
                return [
                  3.35 * Math.cos(k) * Math.cos(theta) - 1.4 * Math.sin(k) * Math.sin(theta),
                  3.35 * Math.cos(k) * Math.sin(theta) + 1.4 * Math.sin(k) * Math.cos(theta),
                  2.1 * Math.sin(k)
                ]
              case 6:
                r = 2.0 + 0.65 * Math.cos(k)
                an += 0.27 * Math.sin(k)
                break
              case 7:
                an += 0.26 * Math.sin(u * 4)
                break
              case 8:
                r = 1.9 + 0.6 * Math.sin(u * Math.PI)
                z = -1 + 3 * u
                break
              case 9:
                return [
                  mix(0, ((a % 3) - 1) * 2.5, u),
                  mix(0, (Math.floor(a / 3) - 1) * 2.5, u),
                  0.48 * Math.sin(k)
                ]
              case 10:
                r = 2 + 0.98 * Math.cos(k)
                an += 0.54 * Math.sin(k)
                break
              case 11:
                an += 1.56 * u
                break
            }
            return pos(an, r, z)
          },
          j === 10 ? wxColors[a % 5]! : a % 2 ? A : B,
          0.18 + (1.0 * a) / n,
          1.7,
          0.086
        )
      }
    }

    const geo = new T.BufferGeometry()
    for (const [name, arr, n] of [
      ['position', vertices, 3],
      ['uv', uv, 2],
      ['col', colors, 3],
      ['cue', sw, 3]
    ] as const) {
      geo.setAttribute(name, new T.Float32BufferAttribute(arr, n))
    }
    geo.setIndex(idx)
    const m = new T.ShaderMaterial({
      ...opts,
      uniforms: { age },
      vertexShader: `attribute vec3 col,cue;varying vec3 C,cu;varying vec2 v;void main(){C=col;cu=cue;v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `uniform float age;varying vec2 v;varying vec3 C,cu;void main(){float dt=(age-cu.x)/cu.y-v.x;float al=smoothstep(-.018,.022,dt)*exp(-max(0.,dt)*4.1);float ridge=exp(-abs(v.y)*5.);gl_FragColor=vec4(mix(C,vec3(.9,1.,1.),ridge*.72),al*(ridge+.49*(1.-abs(v.y)))*(1.+cu.z*.25));}`
    })
    const ribbons = new T.Mesh(geo, m)
    ribbons.frustumCulled = false
    fx.add(ribbons)

    const pg = new T.BufferGeometry()
    for (const [name, ar, n] of [
      ['position', sp, 3],
      ['vel', sv, 3],
      ['birth', born, 1],
      ['size', sizes, 1],
      ['col', sc, 3]
    ] as const) {
      pg.setAttribute(name, new T.Float32BufferAttribute(ar, n))
    }
    const pm = new T.ShaderMaterial({
      ...opts,
      uniforms: { age, px: { value: Math.min(1.6, window.devicePixelRatio || 1) } },
      vertexShader: `uniform float age,px;attribute vec3 vel,col;attribute float birth,size;varying vec3 C;varying float al;void main(){float d=age-birth,u=clamp(d,0.,1.55);al=step(0.,d)*(1.-smoothstep(.12,1.55,u));vec3 p=position+vel*(1.-exp(-u*1.8));p.y+=.09*u*u;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);gl_PointSize=size*px*(.48+.6*al);C=col;}`,
      fragmentShader: `varying float al;varying vec3 C;void main(){vec2 v=gl_PointCoord*2.-1.;float h=max(0.,1.-abs(v.x)-abs(v.y)*.72);gl_FragColor=vec4(mix(C,vec3(.98,1.,1.),h*.64),h*al);}`
    })
    const particles = new T.Points(pg, pm)
    particles.frustumCulled = false
    fx.add(particles)
    fx.visible = false
  }

  return {
    build,
    tick(t: number) {
      fx.visible = t >= 0 && t < duration
      if (!fx.visible) return
      age.value = t
      for (const [head, id] of heads) {
        const { fn, delay, speed } = paths[id]!
        const u = (t - delay) / speed
        head.visible = u >= 0 && u <= 1
        if (head.visible) {
          head.position.fromArray(fn(u))
          head.material.uniforms.al!.value = Math.min(1, u * 15, (1 - u) * 12) * 1.27
        }
      }
    },
    dispose() {
      clearFx()
      headGeo.dispose()
    }
  }
}
