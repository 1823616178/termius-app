import * as T from 'three'
import { CLEAR, drawPose, type DrawPose, MOUTH, smooth } from './draw-motion'

export interface DrawEffectsRig {
  hide(): void
  show(t: number, p: DrawPose, enabled: boolean, px: number): void
}

// Deterministic VFX: particles, moving fronts and trail positions all follow the same scrub time as the weapon.
export function drawEffects(root: T.Group): DrawEffectsRig {
  const fx = new T.Group()
  root.add(fx)
  fx.name = '离鞘 · 光波'
  const throat = new T.Group()
  fx.add(throat)

  function mouthAt(t: number): T.Vector3 {
    const p = drawPose(t)
    return new T.Vector3(0, MOUTH, 0)
      .applyQuaternion(new T.Quaternion().setFromEuler(new T.Euler(0, p.by, p.bz, 'ZYX')))
      .add(new T.Vector3(p.sh[0], p.sh[1], p.sh[2]))
  }

  const add = <M extends T.Material>(
    g: T.Group,
    geo: T.BufferGeometry,
    mat: M
  ): T.Mesh<T.BufferGeometry, M> => {
    const o = new T.Mesh(geo, mat)
    g.add(o)
    return o
  }
  const blend = {
    blending: T.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    side: T.DoubleSide
  } as const

  // A white-hot sliver at the throat with blue falloff, not a full-screen flash.
  const glint = new T.ShaderMaterial({
    ...blend,
    uniforms: { amp: { value: 0 } },
    vertexShader: `varying vec2 v;void main(){v=uv*2.-1.;vec4 p=modelViewMatrix*vec4(0.,0.,0.,1.);p.xy+=position.xy;gl_Position=projectionMatrix*p;}`,
    fragmentShader: `varying vec2 v;uniform float amp;void main(){float r=length(v);float core=exp(-32.*r);float ray=exp(-abs(v.y)*130.-abs(v.x)*4.1)+.56*exp(-abs(v.x)*88.-abs(v.y)*6.5);float a=(.68*exp(-5.*r)+core+ray)*amp;gl_FragColor=vec4(mix(vec3(.06,.53,1.),vec3(.91,1.,1.),min(1.,ray+core)),a*(1.-smoothstep(.74,1.,r)));}`
  })
  add(throat, new T.PlaneGeometry(2.5, 2.5), glint)

  // Three water-like toroidal fronts.
  const rings: T.Mesh<T.BufferGeometry, T.ShaderMaterial>[] = []
  for (let j = 0; j < 3; j++) {
    const p: number[] = []
    const uv: number[] = []
    const ix: number[] = []
    const N = 176
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2
      for (let k = 0; k <= 5; k++) {
        p.push(Math.cos(a), Math.sin(a), 0)
        uv.push(i / N, k / 5)
        if (i < N && k < 5) {
          const h = i * 6 + k
          ix.push(h, h + 1, h + 6, h + 1, h + 7, h + 6)
        }
      }
    }
    const gg = new T.BufferGeometry()
    gg.setAttribute('position', new T.Float32BufferAttribute(p, 3))
    gg.setAttribute('uv', new T.Float32BufferAttribute(uv, 2))
    gg.setIndex(ix)
    const m = new T.ShaderMaterial({
      ...blend,
      uniforms: { age: { value: 0 }, id: { value: j } },
      vertexShader: `uniform float age,id;varying vec2 v;void main(){v=uv;float a=6.283185*v.x;float k=clamp(age/2.05,0.,1.);float r=.12+(3.18+.27*id)*(1.-pow(1.-k,2.));float und=.016*sin(5.*a+age*3.+id)+.011*cos(9.*a-age*3.-id);vec3 p=position*(r+(v.y-.5)*(.19+.26*k)+und*r);p.z=(.026*sin(a*7.+age*5.)+.05*sin(a*3.-id))*r;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
      fragmentShader: `uniform float age,id;varying vec2 v;void main(){float k=age/2.05,a=v.x*6.283185;float d=v.y-.49-.034*sin(a*11.-age*7.);float ridge=exp(-abs(d)*15.);float fringe=exp(-abs(d-.21)*26.);float gl=exp(-abs(d)*5.);float sheen=.71+.29*pow(.5+.5*cos(a*3.+age*2.+id),2.);float env=smoothstep(0.,.065,age)*(1.-smoothstep(.22,1.,k));vec3 c=mix(vec3(.06,.47,1.),vec3(.77,.98,1.),ridge*.89+.10*fringe);gl_FragColor=vec4(c,env*sheen*(1.3*ridge+.63*fringe+.56*gl));}`
    })
    const ring = add(fx, gg, m)
    ring.frustumCulled = false
    ring.rotation.set(0.76 + j * 0.09, 0.11, -0.77)
    rings.push(ring)
  }

  // Icy droplets thrown off the moving crest.
  const ps: number[] = []
  const dirs: number[] = []
  const del: number[] = []
  const sz: number[] = []
  let seed = 1721
  const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let i = 0; i < 240; i++) {
    const a = R() * Math.PI * 2
    const v = 0.6 + R() * 2
    ps.push(0, 0, 0)
    dirs.push(Math.cos(a) * v, Math.sin(a) * v * (0.39 + R() * 0.8), Math.sin(a + 0.76) * (0.2 + 0.65 * R()))
    del.push(R() * 0.34)
    sz.push(0.6 + R() * 1.7)
  }
  const gg = new T.BufferGeometry()
  for (const [key, val, n] of [
    ['position', ps, 3],
    ['vel', dirs, 3],
    ['delay', del, 1],
    ['sz', sz, 1]
  ] as const) {
    gg.setAttribute(key, new T.Float32BufferAttribute(val, n))
  }
  const dm = new T.ShaderMaterial({
    ...blend,
    uniforms: { age: { value: 0 }, px: { value: 1 } },
    vertexShader: `uniform float age,px;attribute vec3 vel;attribute float delay,sz;varying float al;void main(){float u=max(0.,age-delay);vec3 p=vel*(1.-exp(-u*1.9))*1.27;p.y+=u*u*.09;al=step(delay,age)*exp(-u*1.45);gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);gl_PointSize=(1.5+sz*al*2.)*px;}`,
    fragmentShader: `varying float al;void main(){vec2 p=gl_PointCoord*2.-1.;float d=abs(p.x)+abs(p.y)*.76;float a=max(0.,1.-d);gl_FragColor=vec4(mix(vec3(.09,.51,1.),vec3(.87,1.,1.),a),al*a);}`
  })
  const specks = new T.Points(gg, dm)
  specks.frustumCulled = false
  fx.add(specks)

  // Wisps spiral into the luminous throat in anticipation.
  const threads: [T.BufferAttribute, T.ShaderMaterial, number][] = []
  for (let j = 0; j < 8; j++) {
    const N = 44
    const p = new Float32Array((N + 1) * 6)
    const uv: number[] = []
    const ix: number[] = []
    for (let i = 0; i <= N; i++) {
      uv.push(i / N, -1, i / N, 1)
      if (i < N) {
        const a = i * 2
        ix.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    }
    const g = new T.BufferGeometry()
    const posAttr = new T.BufferAttribute(p, 3).setUsage(T.DynamicDrawUsage)
    g.setAttribute('position', posAttr)
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2))
    g.setIndex(ix)
    const sm = new T.ShaderMaterial({
      ...blend,
      uniforms: { al: { value: 0 } },
      vertexShader: `varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `varying vec2 v;uniform float al;void main(){float e=1.-abs(v.y);gl_FragColor=vec4(mix(vec3(.07,.53,1.),vec3(.80,1.,1.),pow(e,4.)),al*e*pow(max(0.,sin(v.x*3.14159)),.48));}`
    })
    const o = add(throat, g, sm)
    o.frustumCulled = false
    threads.push([posAttr, sm, j])
  }

  const peakAt = mouthAt(CLEAR)
  return {
    hide() {
      fx.visible = false
    },
    show(t: number, p: DrawPose, enabled: boolean, px: number) {
      fx.visible = enabled
      if (!enabled) return
      throat.position.copy(mouthAt(t))
      throat.rotation.z = p.bz
      const charge = smooth(0, 0.72, t) * (1 - smooth(1.18, 1.74, t))
      const travel = smooth(1.02, 1.55, t) * (1 - smooth(2.01, 2.63, t))
      const pop = Math.exp(-Math.pow((t - CLEAR) / 0.18, 2))
      glint.uniforms.amp!.value = 0.06 + charge * 0.72 + travel * 0.83 + pop * 1.4
      for (const [a, m, j] of threads) {
        m.uniforms.al!.value = 0.9 * charge + 0.82 * travel
        for (let i = 0; i <= 44; i++) {
          const u = i / 44
          const ang = j * 2.399 + u * 3.1 - t * 2.8
          const rr = (0.1 + u * 0.82 * (1 - 0.63 * charge)) * (1 - p.open * 0.45)
          const x = rr * Math.cos(ang)
          const y = u * (0.22 + 0.55 * Math.sin(ang) + 1.5 * p.open)
          const z = rr * Math.sin(ang)
          const w = (0.01 + 0.023 * Math.sin(u * Math.PI)) * (j % 3 ? 0.68 : 1)
          a.setXYZ(i * 2, x - w, y, z)
          a.setXYZ(i * 2 + 1, x + w, y, z)
        }
        a.needsUpdate = true
      }
      rings.forEach((o, j) => {
        const moment = CLEAR + j * 0.18
        const age = t - moment
        o.visible = age >= 0 && age < 2.05
        o.position.copy(mouthAt(moment))
        o.material.uniforms.age!.value = age
      })
      specks.position.copy(peakAt)
      specks.visible = t > CLEAR && t < CLEAR + 2.7
      dm.uniforms.age!.value = t - CLEAR
      dm.uniforms.px!.value = Math.min(px, 1.65)
    }
  }
}
