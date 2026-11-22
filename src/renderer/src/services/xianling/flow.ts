// Procedural surface caustic, synchronized cutting-edge light and 3D spirit trails.
import * as T from 'three'

export interface FlowRig {
  enable(on: boolean): void
  tick(t: number, boost: number, aura: boolean, draw?: number | null): void
}

export function buildFlow(params: {
  sword: T.Group
  sheath: T.Group
  bladeLight: T.Group
  effects: T.Group
}): FlowRig {
  const { sword, bladeLight, effects } = params
  const wave = { value: 0.22 }
  const active = { value: 1 }
  const power = { value: 0 }
  const reveal = { value: 1.02 }
  const forged = sword.children.find((o) => o.name.startsWith('04 ·'))
  if (forged) {
    for (const child of forged.children) {
      if (!(child instanceof T.Mesh)) continue
      const origMat = child.material as T.MeshStandardMaterial
      const m = origMat.clone()
      m.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, {
          flowWave: wave,
          flowOn: active,
          spiritBoost: power,
          drawReveal: reveal
        })
        shader.vertexShader =
          'varying vec3 vForged;\n' +
          shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvForged=position;')
        shader.fragmentShader =
          'varying vec3 vForged;uniform float flowWave,flowOn,spiritBoost,drawReveal;\n' +
          shader.fragmentShader.replace(
            '#include <opaque_fragment>',
            `float bladeU=clamp((vForged.y-197.)/354.,0.,1.);
float distAlong=fract(flowWave-bladeU-vForged.x*.0018+.5)-.5;
float crest=exp(-pow(distAlong/.026,2.));float tail=exp(-pow((distAlong-.075)/.088,2.));
float thread=.5+.5*cos(1.8*vForged.x+bladeU*24.-flowWave*6.283);float envelope=flowOn*(1.-smoothstep(drawReveal,drawReveal+.01,bladeU))*smoothstep(198.,217.,vForged.y);
outgoingLight=mix(outgoingLight,outgoingLight*vec3(.06,.56,1.)+vec3(.006,.06,.18),tail*envelope*.91);
outgoingLight+=envelope*(vec3(.26,2.5,4.5)*crest+vec3(.01,.28,.6)*tail*thread)*(1.+spiritBoost*.6);
#include <opaque_fragment>`
          )
      }
      m.customProgramCacheKey = () => 'forged-flow-v1'
      child.material = m
      child.userData.original = m
    }
  }

  const cutting = new T.Group()
  sword.add(cutting)
  cutting.name = '刃上流光 · 实时光学层'
  const all: ((time: number, boost: number) => void)[] = []
  let timer = 0

  const bladeWidth = (u: number): number => {
    const y = 197 + u * 354
    const rows: readonly [number, number][] = [
      [197, 6.3],
      [215, 12.6],
      [219, 12.8],
      [250, 9.5],
      [267, 8.6],
      [492, 7.8],
      [513, 7.6],
      [522, 6.55],
      [538, 2.5],
      [551, 0.06]
    ]
    let j = 1
    while (j < rows.length - 1 && rows[j]![0] < y) j++
    const a = rows[j - 1]!
    const b = rows[j]!
    return (a[1] + ((b[1] - a[1]) * (y - a[0])) / (b[0] - a[0])) * 0.01265
  }
  const by = (u: number): number => 3.49 - (197 + u * 354) * 0.01265

  for (const side of [-1, 1]) {
    const p: number[] = []
    const uv: number[] = []
    const ix: number[] = []
    for (let j = 0; j <= 160; j++) {
      const u = j / 160
      const x = side * bladeWidth(u)
      const y = by(u)
      for (const k of [0, 1]) {
        p.push(x + side * (k * 0.123 - 0.004), y, 0)
        uv.push(u, k)
      }
      if (j < 160) {
        const a = j * 2
        ix.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    }
    const geo = new T.BufferGeometry()
    geo.setAttribute('position', new T.Float32BufferAttribute(p, 3))
    geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2))
    geo.setIndex(ix)
    const mat = new T.ShaderMaterial({
      uniforms: { head: wave, drawReveal: reveal },
      transparent: true,
      blending: T.AdditiveBlending,
      side: T.DoubleSide,
      depthWrite: false,
      vertexShader: `varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `varying vec2 v;uniform float head,drawReveal;void main(){if(v.x>drawReveal)discard;float d=fract(head-v.x+.5)-.5;float h=exp(-pow(d/.039,2.));float tail=exp(-pow((d-.085)/.108,2.));float inner=exp(-v.y*17.);float mist=exp(-v.y*4.5);float a=(.09+tail*.63+h)*mist+inner*tail;gl_FragColor=vec4(mix(vec3(.05,.48,1.),vec3(.84,1.,1.),inner*h),a*smoothstep(0.,.025,v.x));}`
    })
    cutting.add(new T.Mesh(geo, mat))
  }

  // Soft glints computed analytically: no bitmap sprites. A single bright head rides the edge.
  function flare(parent: T.Group, col: number, size: number): T.Mesh<T.PlaneGeometry, T.ShaderMaterial> {
    const m = new T.ShaderMaterial({
      uniforms: { tint: { value: new T.Color(col) }, alpha: { value: 1 }, sz: { value: size } },
      transparent: true,
      depthWrite: false,
      blending: T.AdditiveBlending,
      vertexShader: `uniform float sz;varying vec2 v;void main(){v=uv*2.-1.;vec4 mid=modelViewMatrix*vec4(0.,0.,0.,1.);mid.xy+=position.xy*sz;gl_Position=projectionMatrix*mid;}`,
      fragmentShader: `varying vec2 v;uniform vec3 tint;uniform float alpha;void main(){float r=length(v);float halo=exp(-5.3*r);float core=exp(-24.*r);float ray=exp(-abs(v.x)*105.-abs(v.y)*5.)+exp(-abs(v.y)*140.-abs(v.x)*4.);float a=halo*.70+core+.52*ray;gl_FragColor=vec4(mix(tint,vec3(.88,.98,1.),clamp(core+ray*.3,0.,1.)),a*alpha*(1.-smoothstep(.7,1.,r)));}`
    })
    const o = new T.Mesh(new T.PlaneGeometry(1, 1), m)
    o.frustumCulled = false
    parent.add(o)
    return o
  }

  const edgeStar = flare(cutting, 0x75e7ff, 0.67)
  const tipStar = flare(cutting, 0x4dadff, 1.0)
  tipStar.position.set(0, by(1), 0)

  // Moving spirits: points on a non-planar figure-eight, followed by tapered luminous ribbons.
  function spirit(
    group: T.Group,
    phase: number,
    radius: number,
    y: number,
    col: number
  ): (t: number, b: number) => void {
    const head = flare(group, col, 0.53)
    const paths: { attr: T.BufferAttribute; n: number; k: number }[] = []
    function xyz(time: number, k: number): [number, number, number] {
      const a = time + phase
      const w = Math.sin(a * 0.89)
      return [
        radius * Math.cos(a) + k * 0.037 * Math.sin(3 * a),
        y + 0.55 * Math.sin(2 * a + 0.55) + 0.1 * w + k * 0.022 * Math.sin(a * 3),
        0.4 * Math.sin(a) + k * 0.025 * Math.cos(a * 3)
      ]
    }
    for (let k = 0; k < 3; k++) {
      const geo = new T.BufferGeometry()
      const n = 54
      const p = new Float32Array((n + 1) * 6)
      const uv: number[] = []
      const ix: number[] = []
      for (let i = 0; i <= n; i++) {
        const u = i / n
        uv.push(u, -1, u, 1)
        if (i < n) {
          const j = i * 2
          ix.push(j, j + 1, j + 2, j + 1, j + 3, j + 2)
        }
      }
      const attr = new T.BufferAttribute(p, 3).setUsage(T.DynamicDrawUsage)
      geo.setAttribute('position', attr)
      geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2))
      geo.setIndex(ix)
      const mat = new T.ShaderMaterial({
        uniforms: { col: { value: new T.Color(k === 1 ? 0xe2f9ff : col) } },
        side: T.DoubleSide,
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending,
        vertexShader: `varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
        fragmentShader: `varying vec2 v;uniform vec3 col;void main(){float d=abs(v.y);float a=pow(1.-v.x,1.3)*exp(-3.*d*d);gl_FragColor=vec4(mix(col,vec3(.82,1.,1.),exp(-d*8.)*(1.-v.x)),a*.94);}`
      })
      const obj = new T.Mesh(geo, mat)
      obj.frustumCulled = false
      group.add(obj)
      paths.push({ attr, n, k })
    }
    return (time: number, boost: number) => {
      const t = time * 1.7
      head.position.fromArray(xyz(t, 0))
      head.material.uniforms.sz!.value = 0.45 + 0.09 * Math.sin(t) + boost * 0.3
      for (const { attr, n, k } of paths) {
        for (let i = 0; i <= n; i++) {
          const u = i / n
          const s = t - u * (1.35 + k * 0.13)
          const [x, py, z] = xyz(s, k * u)
          const next = xyz(s + 0.006, k * u)
          const dx = next[0] - x
          const dy = next[1] - py
          const l = Math.hypot(dx, dy) || 1
          const wd = (k === 0 ? 0.063 : 0.024) * (1 - 0.93 * u) * (0.54 + 0.46 * Math.sin(Math.PI * (1 - u)))
          attr.setXYZ(i * 2, x - (dy / l) * wd, py + (dx / l) * wd, z)
          attr.setXYZ(i * 2 + 1, x + (dy / l) * wd, py - (dx / l) * wd, z)
        }
        attr.needsUpdate = true
      }
    }
  }

  all.push(
    spirit(effects, 0, 0.91, 1.36, 0x43bfff),
    spirit(effects, Math.PI * 0.84, 0.72, 1.28, 0x96a6ff),
    spirit(bladeLight, 2.1, 0.49, 1.36, 0x5fcfff)
  )

  let last: number | null = null
  return {
    enable(on: boolean) {
      cutting.visible = on
      active.value = on ? 1 : 0
    },
    tick(t: number, boost: number, aura: boolean, draw: number | null = null) {
      const dt = last === null ? 0 : Math.max(0, t - last)
      last = t
      timer += dt * (1 + 0.8 * boost)
      power.value = boost
      let cycle = (timer * 0.4 + 0.23) % 1
      reveal.value = draw === null ? 1.02 : draw
      if (draw !== null && draw < 1) cycle = Math.min(0.999, draw)
      wave.value = cycle
      edgeStar.visible = draw === null || draw > 0.012
      tipStar.visible = draw === null || draw >= 1
      edgeStar.position.set(bladeWidth(cycle), by(cycle), 0.026)
      edgeStar.material.uniforms.alpha!.value = 0.85 + 0.18 * Math.sin(cycle * Math.PI)
      tipStar.material.uniforms.alpha!.value = cycle > 0.88 ? (cycle - 0.88) / 0.12 : Math.exp(-cycle * 25)
      if (aura) for (const fn of all) fn(timer, boost)
    }
  }
}
