import * as T from 'three'
import { BEATS, bladePoint, CLEAR, DRAW_LENGTH, drawPose, phaseAt, smooth } from './draw-motion'

export interface SwordDanceRig {
  hide(): void
  show(t: number, enabled: boolean, px: number): void
}

// A thin motion-capture cache of the actual blade. Seekable, frame-rate independent afterimages.
const hz = 90
const frames = Math.ceil(DRAW_LENGTH * hz) + 2
const history: [number, number, number, number, number, number][] = []
for (let i = 0; i < frames; i++) {
  const t = i / hz
  const a = bladePoint(t, 0.86)
  const b = bladePoint(t, -3.48)
  history.push([a[0], a[1], a[2], b[0], b[1], b[2]])
}

function hist(t: number): [number, number, number, number, number, number] {
  const f = Math.min(frames - 2, Math.max(0, t * hz))
  const i = Math.floor(f)
  const u = f - i
  const cur = history[i]!
  const nxt = history[i + 1]!
  return [
    cur[0] + (nxt[0] - cur[0]) * u,
    cur[1] + (nxt[1] - cur[1]) * u,
    cur[2] + (nxt[2] - cur[2]) * u,
    cur[3] + (nxt[3] - cur[3]) * u,
    cur[4] + (nxt[4] - cur[4]) * u,
    cur[5] + (nxt[5] - cur[5]) * u
  ]
}

export function swordDance(root: T.Group): SwordDanceRig {
  const stage = new T.Group()
  root.add(stage)
  stage.name = '月照七章 · 舞台光迹'

  const add = <M extends T.Material>(
    g: T.Group,
    geo: T.BufferGeometry,
    m: M
  ): T.Mesh<T.BufferGeometry, M> => {
    const o = new T.Mesh(geo, m)
    g.add(o)
    return o
  }
  const opt = {
    transparent: true,
    depthWrite: false,
    blending: T.AdditiveBlending,
    side: T.DoubleSide
  } as const
  const palette = [0x32a7ff, 0x33e8ed, 0xffb252, 0xa58cff, 0x53baff, 0x5cf3c4, 0xfbd99a].map(
    (c) => new T.Color(c)
  )

  const num = 120
  const cols = 6
  const ps = new Float32Array((num + 1) * (cols + 1) * 3)
  const uv: number[] = []
  const ix: number[] = []
  const colors = new Float32Array(ps.length)
  for (let i = 0; i <= num; i++) {
    for (let j = 0; j <= cols; j++) {
      uv.push(i / num, j / cols)
      if (j < cols && i < num) {
        const a = i * (cols + 1) + j
        ix.push(a, a + 1, a + cols + 1, a + 1, a + cols + 2, a + cols + 1)
      }
    }
  }
  const gg = new T.BufferGeometry()
  gg.setAttribute('position', new T.BufferAttribute(ps, 3).setUsage(T.DynamicDrawUsage))
  gg.setAttribute('color', new T.BufferAttribute(colors, 3).setUsage(T.DynamicDrawUsage))
  gg.setAttribute('uv', new T.Float32BufferAttribute(uv, 2))
  gg.setIndex(ix)
  const mat = new T.ShaderMaterial({
    ...opt,
    vertexColors: true,
    uniforms: { t: { value: 0 }, amp: { value: 1 } },
    vertexShader: `varying vec2 v;varying vec3 C;void main(){v=uv;C=color;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `varying vec2 v;varying vec3 C;uniform float t,amp;void main(){float age=v.x,r=v.y;float fade=pow(max(0.,1.-age),1.38)*smoothstep(0.,.035,age);float edge=exp(-abs(1.-r)*55.);float wire=exp(-abs(.928-r+.007*sin(age*11.+t*2.))*115.);float w=.5+.5*sin(52.*r+4.*sin(age*6.+r*13.-t*3.)-age*15.);float fine=pow(w,6.);float mist=pow(r,1.7)*(.25+.37*fine);vec3 hue=mix(C,vec3(.84,.99,1.),edge*.95+wire*.51);gl_FragColor=vec4(hue,fade*amp*(edge*1.3+.64*wire+mist+.09*fine*smoothstep(0.,.2,r)));}`
  })
  const strip = add(stage, gg, mat)
  strip.frustumCulled = false

  // Three narrow silk threads run outside the broad cutting-edge wake.
  const silks: T.Mesh<T.BufferGeometry, T.ShaderMaterial>[] = []
  for (let n = 0; n < 3; n++) {
    const g = new T.BufferGeometry()
    const p = new Float32Array((num + 1) * 6)
    const u: number[] = []
    const ind: number[] = []
    for (let i = 0; i <= num; i++) {
      u.push(i / num, -1, i / num, 1)
      if (i < num) {
        const k = i * 2
        ind.push(k, k + 1, k + 2, k + 1, k + 3, k + 2)
      }
    }
    g.setAttribute('position', new T.BufferAttribute(p, 3).setUsage(T.DynamicDrawUsage))
    g.setAttribute('uv', new T.Float32BufferAttribute(u, 2))
    g.setIndex(ind)
    const m = new T.ShaderMaterial({
      ...opt,
      uniforms: { col: { value: palette[0]!.clone() } },
      vertexShader: `varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `varying vec2 v;uniform vec3 col;void main(){float e=1.-abs(v.y),f=pow(1.-v.x,1.65);gl_FragColor=vec4(mix(col,vec3(.94,1.,1.),e*.62),f*e*.85);}`
    })
    const o = add(stage, g, m)
    o.frustumCulled = false
    silks.push(o)
  }

  // Beat-triggered micro-flares and seeded ice showers, emitted at the exact recorded tip position.
  let seed = 24813
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const dat = {
    p: [] as number[],
    d: [] as number[],
    v: [] as number[],
    size: [] as number[],
    col: [] as number[]
  }
  const sparks: T.Mesh<T.PlaneGeometry, T.ShaderMaterial>[] = []
  for (const [i, b] of BEATS.entries()) {
    const ph = phaseAt(b)
    const c = palette[ph]!
    const origin = i === BEATS.length - 1 ? bladePoint(b, 1.29) : bladePoint(b, -3.42)
    for (let j = 0; j < 74; j++) {
      const a = rand() * 6.28
      const sp = 0.25 + rand() * (ph === 2 ? 3.2 : 1.9)
      const y = (rand() - 0.48) * 1.7
      dat.p.push(origin[0], origin[1], origin[2])
      dat.d.push(b + rand() * 0.16)
      dat.v.push(sp * Math.cos(a), sp * (Math.sin(a) * 0.72 + y * 0.3), sp * y)
      dat.size.push(1.4 + rand() * 3.1)
      dat.col.push(c.r, c.g, c.b)
    }
    const m = new T.ShaderMaterial({
      ...opt,
      uniforms: { col: { value: c }, a: { value: 0 } },
      vertexShader: `varying vec2 v;void main(){v=uv*2.-1.;vec4 p=modelViewMatrix*vec4(0.,0.,0.,1.);p.xy+=position.xy;gl_Position=projectionMatrix*p;}`,
      fragmentShader: `varying vec2 v;uniform vec3 col;uniform float a;void main(){float r=length(v);float w=exp(-6.*r)+exp(-abs(v.y)*130.-4.8*abs(v.x))+exp(-abs(v.x)*105.-5.8*abs(v.y));gl_FragColor=vec4(mix(col,vec3(1.),clamp(w-.35,0.,1.)),a*w*(1.-smoothstep(.75,1.,r)));}`
    })
    const o = add(stage, new T.PlaneGeometry(ph === 2 ? 2.15 : 1.63, 1.35), m) as T.Mesh<
      T.PlaneGeometry,
      T.ShaderMaterial
    >
    o.position.fromArray(origin)
    sparks.push(o)
  }
  const sg = new T.BufferGeometry()
  for (const [name, a, k] of [
    ['position', dat.p, 3],
    ['birth', dat.d, 1],
    ['vel', dat.v, 3],
    ['size', dat.size, 1],
    ['color', dat.col, 3]
  ] as const) {
    sg.setAttribute(name, new T.Float32BufferAttribute(a, k))
  }
  const sm = new T.ShaderMaterial({
    ...opt,
    vertexColors: true,
    uniforms: { t: { value: 0 }, px: { value: 1 } },
    vertexShader: `attribute float birth,size;attribute vec3 vel;uniform float t,px;varying float a;varying vec3 c;void main(){float d=t-birth,u=clamp(d,0.,1.5);a=step(0.,d)*(1.-smoothstep(.10,1.5,u));vec3 p=position+vel*(1.-exp(-2.4*u));p.y-=.22*u*u;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);gl_PointSize=size*px*(.35+.8*a);c=color;}`,
    fragmentShader: `varying float a;varying vec3 c;void main(){vec2 p=gl_PointCoord*2.-1.;float v=max(0.,1.-abs(p.x)-abs(p.y)*.8);gl_FragColor=vec4(mix(c,vec3(1.),v*.8),v*a);}`
  })
  const points = new T.Points(sg, sm)
  points.frustumCulled = false
  stage.add(points)

  // Gold constellation lines join only after each of the three star accents lands.
  const stars = [4.89, 5.6, 6.32] as const
  const links: T.Line<T.BufferGeometry, T.LineDashedMaterial>[] = []
  for (let i = 0; i < 3; i++) {
    const a = bladePoint(stars[i]!, -3.42)
    const b = bladePoint(stars[(i + 1) % 3]!, -3.42)
    const g = new T.BufferGeometry().setFromPoints([new T.Vector3(...a), new T.Vector3(...b)])
    const m = new T.LineDashedMaterial({ color: 0xffe4a6, dashSize: 0.09, gapSize: 0.055, ...opt })
    const l = new T.Line(g, m)
    l.computeLineDistances()
    stage.add(l)
    links.push(l)
  }

  // Frost crystals follow the tip's recorded figure-eight.
  const snowGeo = new T.OctahedronGeometry(1, 0)
  const snowMat = new T.MeshBasicMaterial({ color: 0xc1c4ff, ...opt })
  const flakes = new T.InstancedMesh(snowGeo, snowMat, 112)
  const fs: [number, [number, number, number], number, number, number, number, number][] = []
  stage.add(flakes)
  flakes.frustumCulled = false
  for (let i = 0; i < 112; i++) {
    const b = 6.77 + rand() * 2.45
    const sz = 0.009 + rand() * 0.026
    fs.push([
      b,
      bladePoint(b, -1.4 - rand() * 2.08),
      (rand() - 0.5) * 0.8,
      (rand() - 0.5) * 0.7,
      rand() * 0.6,
      sz,
      rand() * 6.28
    ])
  }
  const ob = new T.Object3D()

  // Six low-poly solid ghost echoes retained at accents.
  const ghosts: [T.Group, T.MeshBasicMaterial, number, number][] = []
  for (const [i, b] of [1.72, 1.83, 1.95, 9.96, 10.52, 11.13].entries()) {
    const g = new T.Group()
    const p = drawPose(b)
    const m = new T.MeshBasicMaterial({ color: i < 3 ? 0x7acfff : 0x8fbeff, ...opt })
    stage.add(g)
    const verts = [
      [-0.1, 0.88, 0],
      [0, 0.88, 0.064],
      [0.1, 0.88, 0],
      [-0.087, -3.04, 0],
      [0, -3.04, 0.036],
      [0.087, -3.04, 0],
      [0, -3.48, 0]
    ].flat()
    const bg = new T.BufferGeometry()
    bg.setAttribute('position', new T.Float32BufferAttribute(verts, 3))
    bg.setIndex([0, 3, 1, 1, 3, 4, 1, 4, 2, 2, 4, 5, 3, 6, 4, 4, 6, 5])
    add(g, bg, m)
    const stem = add(g, new T.CylinderGeometry(0.062, 0.075, 1.72, 12), m)
    stem.position.y = 2.6
    const bBall = add(g, new T.IcosahedronGeometry(0.145, 1), m)
    bBall.position.y = 1.34
    for (const side of [-1, 1]) {
      const curve = new T.CatmullRomCurve3(
        [
          [0, 0.92, 0],
          [side * 0.19, 1.12, 0.03],
          [side * 0.33, 1.39, 0],
          [side * 0.22, 1.61, 0]
        ].map((v) => new T.Vector3(v[0]!, v[1]!, v[2]!))
      )
      add(g, new T.TubeGeometry(curve, 24, 0.025, 6, false), m)
    }
    g.rotation.set(p.ax, p.ay, p.az, 'ZYX')
    g.position.fromArray(p.sw)
    ghosts.push([g, m, b, i < 3 ? 0.46 : 1.48])
  }

  // Final eight-petal lotus: volumetric ribbons arch forward, inner and outer layers open in succession.
  const flower = new T.Group()
  stage.add(flower)
  flower.position.set(0.42, 0.04, -0.92)
  const petals: [T.Mesh<T.BufferGeometry, T.ShaderMaterial>, number, number][] = []
  for (let layer = 0; layer < 2; layer++) {
    for (let j = 0; j < 8; j++) {
      const pos: number[] = []
      const u: number[] = []
      const idx: number[] = []
      const N = 92
      for (let i = 0; i <= N; i++) {
        const v = i / N
        const theta = v * 2 * Math.PI
        const h = Math.pow(Math.max(0, Math.sin(Math.PI * v)), 1.04)
        const x = Math.sin(theta) * h * (layer ? 0.91 : 1.2)
        const y = 0.23 + (layer ? 2.22 : 3.1) * h
        const z = h * (layer ? 0.75 : 0.42) + Math.sin(theta) * 0.14
        for (const e of [-1, 1]) {
          const w = layer ? 0.046 : 0.079
          const dh =
            1.04 * Math.pow(Math.max(0.00001, Math.sin(Math.PI * v)), 0.04) * Math.PI * Math.cos(Math.PI * v)
          const dx = (layer ? 0.91 : 1.2) * (Math.PI * 2 * Math.cos(theta) * h + Math.sin(theta) * dh)
          const dy = (layer ? 2.22 : 3.1) * dh
          const n = Math.hypot(dx, dy) || 1
          pos.push(x - (e * w * dy) / n, y + (e * w * dx) / n, z)
          u.push(v, e)
        }
        if (i < N) {
          const k = i * 2
          idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2)
        }
      }
      const geo = new T.BufferGeometry()
      geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3))
      geo.setAttribute('uv', new T.Float32BufferAttribute(u, 2))
      geo.setIndex(idx)
      const m = new T.ShaderMaterial({
        ...opt,
        uniforms: {
          al: { value: 0 },
          reveal: { value: 0 },
          col: { value: new T.Color(layer ? 0xf1d7a0 : 0x6cf3d0) }
        },
        vertexShader: `varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
        fragmentShader: `varying vec2 v;uniform float al,reveal;uniform vec3 col;void main(){float e=exp(-3.8*abs(v.y));float head=exp(-65.*abs(reveal-v.x));gl_FragColor=vec4(mix(col,vec3(1.),e*.6+head*.32),al*(e+.28*(1.-abs(v.y))+.6*head)*(1.-smoothstep(reveal,reveal+.035,v.x)));}`
      })
      const o = add(flower, geo, m)
      o.rotation.z = (j * Math.PI) / 4 + (layer * Math.PI) / 8
      petals.push([o, j, layer])
    }
  }
  const seal = new T.Group()
  flower.add(seal)
  const trig: number[] = []
  const trigCodes = ['111', '011', '010', '001', '000', '100', '101', '110'] as const
  for (let j = 0; j < 8; j++) {
    const an = (j * Math.PI) / 4
    const cs = Math.cos(an)
    const sn = Math.sin(an)
    for (let i = 0; i < 3; i++) {
      const y = 1.19 + i * 0.085
      const segs: readonly [number, number][] =
        trigCodes[j]![i] === '1'
          ? [[-0.18, 0.18]]
          : [
              [-0.18, -0.042],
              [0.042, 0.18]
            ]
      for (const [a, b] of segs) {
        trig.push(a * cs - y * sn, a * sn + y * cs, 0.02, b * cs - y * sn, b * sn + y * cs, 0.02)
      }
    }
  }
  const tg = new T.BufferGeometry()
  tg.setAttribute('position', new T.Float32BufferAttribute(trig, 3))
  const tm = new T.LineBasicMaterial({ color: 0xf4deb1, ...opt })
  seal.add(new T.LineSegments(tg, tm))
  for (const r of [0.97, 1.49]) {
    const pts: T.Vector3[] = []
    for (let i = 0; i < 120; i++)
      pts.push(new T.Vector3(r * Math.cos((i * Math.PI) / 60), r * Math.sin((i * Math.PI) / 60), 0))
    seal.add(new T.LineLoop(new T.BufferGeometry().setFromPoints(pts), tm))
  }

  // The pearl projects a segmented trigram lock: the eight sectors spring apart on the unsheathing beat and reunite on return.
  const gate = new T.Group()
  stage.add(gate)
  const sectors: [T.Group, T.LineBasicMaterial, T.MeshBasicMaterial, number][] = []
  const polar = (a: number, r: number): [number, number, number] => [Math.sin(a) * r, Math.cos(a) * r, 0]
  for (let j = 0; j < 8; j++) {
    const group = new T.Group()
    gate.add(group)
    const s = (j * Math.PI) / 4
    const m = new T.LineBasicMaterial({ color: j % 2 ? 0x9adcff : 0xf2d8a5, ...opt })
    const arr: number[] = []
    const seg = (a: [number, number, number], b: [number, number, number]) => {
      arr.push(a[0], a[1], a[2], b[0], b[1], b[2])
    }
    for (const r of [0.9, 0.968, 1.055]) {
      for (let i = 0; i < 18; i++) {
        const a = s - 0.345 + (0.69 * i) / 18
        seg(polar(a, r), polar(a + 0.69 / 18, r))
      }
    }
    for (let i = -3; i <= 3; i++) {
      const a = s + i * 0.093
      seg(polar(a, 0.97), polar(a, i === 0 ? 1.075 : 1.025))
    }
    const xy = (x: number, y: number): [number, number, number] => [
      x * Math.cos(s) + y * Math.sin(s),
      -x * Math.sin(s) + y * Math.cos(s),
      0.005
    ]
    for (let k = 0; k < 3; k++) {
      const r = 0.69 + k * 0.068
      const spans: readonly [number, number][] =
        trigCodes[j]![k] === '1'
          ? [[-0.139, 0.139]]
          : [
              [-0.139, -0.035],
              [0.035, 0.139]
            ]
      for (const [x, X] of spans) {
        seg(xy(x, r), xy(X, r))
        seg(xy(x, r + 0.013), xy(X, r + 0.013))
      }
    }
    const g = new T.BufferGeometry()
    g.setAttribute('position', new T.Float32BufferAttribute(arr, 3))
    group.add(new T.LineSegments(g, m))
    const qm = new T.MeshBasicMaterial({ color: j % 2 ? 0x7bdcff : 0xf1cf94, ...opt })
    const spark = add(group, new T.OctahedronGeometry(0.044, 0), qm)
    spark.position.fromArray(polar(s, 1.075))
    spark.rotation.z = -s
    spark.scale.y = 1.9
    sectors.push([group, m, qm, s])
  }

  function sealFrame(t: number): void {
    gate.visible = t < 2.94 || t > 15.4
    if (!gate.visible) return
    const outro = t > 15.4
    const p = drawPose(outro ? t : Math.min(t, CLEAR))
    const rot = p.bz
    const cy = 0.99
    gate.position.set(p.sh[0] - Math.sin(rot) * cy, p.sh[1] + Math.cos(rot) * cy, p.sh[2] + 0.07)
    const split = outro ? 1 - smooth(15.52, 16.86, t) : smooth(1.86, 2.89, t)
    const fade = outro
      ? smooth(15.4, 16.15, t) * (1 - smooth(16.99, 17.7, t))
      : smooth(0.04, 0.5, t) * (1 - smooth(2.08, 2.91, t))
    gate.rotation.set(0.28 + 0.08 * Math.sin(t), -0.12, rot + 0.3 * t)
    gate.scale.setScalar(outro ? 0.8 : 1.25 - 0.47 * smooth(0.6, 1.39, t) + 0.21 * smooth(1.79, 1.97, t))
    for (const [o, m, q, a] of sectors) {
      o.position.set(Math.sin(a) * split * 1.44, Math.cos(a) * split * 1.44, 0.13 * split * Math.sin(a))
      o.rotation.z = split * 0.27
      o.rotation.x = split * 0.32 * Math.cos(a)
      m.opacity = fade * 0.96
      q.opacity = fade
    }
  }

  return {
    hide() {
      stage.visible = false
    },
    show(t: number, enabled: boolean, px: number) {
      stage.visible = enabled
      if (!enabled) return
      sealFrame(t)
      const ph = phaseAt(t)
      const span = [0.55, 1.02, 0.55, 1.22, 0.73, 0.9, 0.64][ph]!
      const vis = t > 1.6 && t < 16.98
      strip.visible = vis
      mat.uniforms.t!.value = t
      mat.uniforms.amp!.value = ph === 3 ? 1.6 : 1.4
      for (const o of silks) {
        o.visible = vis
        ;(o.material.uniforms.col!.value as T.Color).copy(palette[ph]!)
      }
      if (vis) {
        for (let i = 0; i <= num; i++) {
          const age = i / num
          const tt = Math.max(1.59, t - age * span)
          const h = hist(tt)
          const C = palette[phaseAt(tt)]!
          const p = drawPose(tt)
          const ex = tt < 2.3 || tt > 15.5 ? Math.min(1, p.length / 4.43) : 1
          for (let j = 0; j <= cols; j++) {
            const f = (0.08 + (0.92 * j) / cols) * ex
            const k = (i * (cols + 1) + j) * 3
            for (let d = 0; d < 3; d++) ps[k + d] = h[d]! + (h[d + 3]! - h[d]!) * f
            colors[k] = C.r
            colors[k + 1] = C.g
            colors[k + 2] = C.b
          }
          for (const [n, o] of silks.entries()) {
            const f = ex * (1.014 + 0.024 * n) + 0.017 * Math.sin(age * 14 + t * 3 + n)
            const a = o.geometry.attributes.position as T.BufferAttribute
            const xx = h[0] + (h[3] - h[0]) * f
            const yy = h[1] + (h[4] - h[1]) * f
            const zz = h[2] + (h[5] - h[2]) * f + 0.035 * Math.sin(age * 8 + n)
            const w = 0.013 + 0.012 * (1 - age)
            a.setXYZ(i * 2, xx - (h[3] - h[0]) * w, yy - (h[4] - h[1]) * w, zz)
            a.setXYZ(i * 2 + 1, xx + (h[3] - h[0]) * w, yy + (h[4] - h[1]) * w, zz)
          }
        }
        ;(gg.attributes.position as T.BufferAttribute).needsUpdate = true
        ;(gg.attributes.color as T.BufferAttribute).needsUpdate = true
        for (const o of silks) (o.geometry.attributes.position as T.BufferAttribute).needsUpdate = true
      }
      sm.uniforms.t!.value = t
      sm.uniforms.px!.value = Math.min(1.8, px)
      sparks.forEach((o, i) => {
        const age = t - BEATS[i]!
        o.visible = age >= 0 && age < 1.15
        o.material.uniforms.a!.value = age < 0 ? 0 : 1.9 * Math.exp(-age * 4.5)
      })
      links.forEach((l, i) => {
        const b = stars[Math.min(2, i + 1)]!
        l.visible = t > b && t < 7.15
        l.material.opacity = 0.64 * smooth(b, b + 0.1, t) * (1 - smooth(6.48, 7.15, t))
      })
      flakes.visible = t > 6.65 && t < 10.4
      if (flakes.visible) {
        fs.forEach(([b, p, vx, vy, vz, sz, s], i) => {
          const age = t - b
          const f = 1 - smooth(0.28, 1.45, age)
          ob.position.set(p[0] + vx * age, p[1] + vy * age + 0.15 * age * age, p[2] + vz * age)
          ob.rotation.set(age, s + age, -0.5 + s)
          ob.scale.setScalar(age > 0 && f > 0 ? sz * f : 0.00001)
          ob.scale.y *= 2.6
          ob.updateMatrix()
          flakes.setMatrixAt(i, ob.matrix)
        })
        flakes.instanceMatrix.needsUpdate = true
      }
      ghosts.forEach(([o, m, b, d]) => {
        const a = t - b
        o.visible = a >= 0 && a < d
        if (o.visible) m.opacity = 0.52 * (1 - smooth(0.01, d, a))
      })
      flower.visible = t > 11.53 && t < 15.76
      if (flower.visible) {
        flower.rotation.set(0.19 * Math.sin(t * 0.65), 0.26 * Math.cos(t * 0.72), 0.07 * (t - 12))
        const fade = 1 - smooth(14.47, 15.75, t)
        for (const [o, j, layer] of petals) {
          const u = smooth(11.54 + j * 0.082 + layer * 0.28, 12.78 + j * 0.092 + layer * 0.28, t)
          o.material.uniforms.reveal!.value = u * 1.04
          o.material.uniforms.al!.value = fade * 1.18
          o.scale.setScalar(0.58 + 0.42 * u)
        }
        seal.rotation.z = -(t - 11.55) * 0.36
        tm.opacity = fade * smooth(12, 13.4, t) * 0.8
      }
    }
  }
}
