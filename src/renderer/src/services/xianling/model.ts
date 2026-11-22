/* Xianling / geometry edition. All visible weapon ornament is solid mesh. Units in the sculpting frame follow proportions measured from the reference; no UVs, texture maps, height fields or image sampling. */
import * as T from 'three'

export interface ArmoryResult {
  sword: T.Group
  sheath: T.Group
  rotors: T.Group[]
  materials: Record<string, T.MeshStandardMaterial>
}

interface SweepOptions {
  n?: number
  radial?: number
  axis?: T.Vector3
  width?: (u: number) => number
  taper?: boolean
}

export function buildArmory(): ArmoryResult {
  const S = 0.01265
  const mats: Record<string, T.MeshStandardMaterial> = {}

  function material(
    key: string,
    color: number,
    metalness: number,
    roughness: number
  ): T.MeshStandardMaterial {
    const m = new T.MeshStandardMaterial({ color, metalness, roughness })
    m.name = key
    mats[key] = m
    return m
  }

  const Ag = material('01 · 锻银', 0xcad8e4, 0.85, 0.27)
  const Hi = material('02 · 抛光银边', 0xf3f5f1, 0.91, 0.18)
  const Ox = material('03 · 氧化银槽', 0x596b80, 0.79, 0.3)
  const Iv = material('04 · 白玉', 0xd8e5df, 0.2, 0.28)
  const Sn = material('05 · 霜钢', 0xc0d4e5, 0.86, 0.21)
  const En = material('06 · 冰蓝珐琅', 0x559eca, 0.45, 0.19)
  const Gs = material('07 · 月白金丝', 0xc0b298, 0.78, 0.27)
  const Cb = material('08 · 浅冰蓝晶壳', 0xa3e5ff, 0.07, 0.16)
  const Si = material('09 · 银白流苏', 0xc0d4d6, 0.28, 0.41)
  const Bk = material('10 · 鞘腔', 0x1c303b, 0.55, 0.38)
  const J = material('11 · 切面冰玉', 0x60c7f2, 0.48, 0.11)
  J.emissive.setHex(0x0e467e)
  J.emissiveIntensity = 0.23

  const sword = new T.Group()
  const sheath = new T.Group()
  sword.name = '仙灵 · 出鞘长剑'
  sheath.name = '仙灵 · 佩鞘陈列'
  const pieces: T.Group[] = []

  function part(g: T.Group, name: string): T.Group {
    const h = new T.Group()
    h.name = name
    h.userData.weaponPart = true
    g.add(h)
    h.scale.set(S, -S, S)
    h.position.y = g === sword ? 3.49 : 3.57
    pieces.push(h)
    return h
  }

  function mesh(
    g: T.Object3D,
    geo: T.BufferGeometry,
    mat: T.Material | T.Material[],
    x = 0,
    y = 0,
    z = 0
  ): T.Mesh {
    const m = new T.Mesh(geo, mat)
    m.position.set(x, y, z)
    g.add(m)
    return m
  }

  function vec(p: readonly number[]): T.Vector3 {
    return new T.Vector3(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0)
  }

  function buf(p: number[], i: number[]): T.BufferGeometry {
    const geo = new T.BufferGeometry()
    geo.setAttribute('position', new T.Float32BufferAttribute(p, 3))
    geo.setIndex(i)
    geo.computeVertexNormals()
    return geo
  }

  function sample(rows: readonly (readonly [number, number, number?])[], y: number): [number, number] {
    if (y <= rows[0]![0]) return [rows[0]![1], rows[0]![2] ?? rows[0]![1]]
    for (let i = 1; i < rows.length; i++) {
      const b = rows[i]!
      if (y <= b[0]) {
        const a = rows[i - 1]!
        const v = (y - a[0]) / (b[0] - a[0])
        const a2 = a[2] ?? a[1]
        const b2 = b[2] ?? b[1]
        return [a[1] + (b[1] - a[1]) * v, a2 + (b2 - a2) * v]
      }
    }
    const last = rows[rows.length - 1]!
    return [last[1], last[2] ?? last[1]]
  }

  // Continuous closed cross-sections. An actual inner sleeve is modeled at the throat.
  function turn(
    g: T.Object3D,
    rows: readonly (readonly [number, number, number?])[],
    mat: T.Material,
    N = 40
  ): T.Mesh {
    const p: number[] = []
    const ix: number[] = []
    for (let j = 0; j < rows.length; j++) {
      const [y, rx, rzOpt] = rows[j]!
      const rz = rzOpt ?? rx
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2
        p.push(rx * Math.sin(a), y, rz * Math.cos(a))
        const b = j * N + i
        const c = j * N + ((i + 1) % N)
        if (j < rows.length - 1) ix.push(b, c, b + N, c, c + N, b + N)
      }
    }
    for (let i = 1; i < N - 1; i++) {
      ix.push(0, i + 1, i, (rows.length - 1) * N, (rows.length - 1) * N + i, (rows.length - 1) * N + i + 1)
    }
    return mesh(g, buf(p, ix), mat)
  }

  function ball(
    g: T.Object3D,
    x: number,
    y: number,
    z: number,
    r: number,
    mat: T.Material,
    sx = 1,
    sy = 1,
    sz = 1
  ): T.Mesh {
    const m = mesh(g, new T.SphereGeometry(r, r < 1 ? 9 : 18, r < 1 ? 6 : 12), mat, x, y, z)
    m.scale.set(sx, sy, sz)
    return m
  }

  // A tapered swept solid with elliptical cross section. Used for raised filigree, wire, ridges and broad chiseled blades of silver.
  function sweep(
    g: T.Object3D,
    points: readonly (readonly number[])[],
    width: number,
    depth: number,
    mat: T.Material,
    options: SweepOptions = {}
  ): T.Mesh {
    const cv = new T.CatmullRomCurve3(points.map(vec))
    const n = options.n ?? Math.max(13, points.length * 3)
    const N = options.radial ?? (width < 1.2 ? 6 : 8)
    const p: number[] = []
    const ix: number[] = []
    for (let j = 0; j <= n; j++) {
      const u = j / n
      const v = cv.getPoint(u)
      const t = cv.getTangent(u).normalize()
      const axis = options.axis ?? new T.Vector3(0, 0, 1)
      const left = new T.Vector3().crossVectors(axis, t)
      if (left.lengthSq() < 0.0001) left.set(1, 0, 0)
      left.normalize()
      const up = new T.Vector3().crossVectors(t, left).normalize()
      const f = options.width
        ? options.width(u)
        : options.taper === false
          ? 1
          : Math.max(0.035, Math.pow(Math.sin(u * Math.PI), 0.56))
      for (let i = 0; i < N; i++) {
        const a = (i / N) * 2 * Math.PI
        const q = v
          .clone()
          .addScaledVector(left, Math.cos(a) * width * f)
          .addScaledVector(up, Math.sin(a) * depth * (options.taper === false ? 1 : Math.sqrt(f)))
        p.push(q.x, q.y, q.z)
        const k = j * N + i
        const b = j * N + ((i + 1) % N)
        if (j < n) ix.push(k, b, k + N, b, b + N, k + N)
      }
    }
    for (let j = 1; j < N - 1; j++) ix.push(0, j + 1, j, n * N, n * N + j, n * N + j + 1)
    return mesh(g, buf(p, ix), mat)
  }

  function wire(
    g: T.Object3D,
    points: readonly (readonly number[])[],
    rad: number,
    mat: T.Material,
    n?: number
  ): T.Mesh {
    const cv = new T.CatmullRomCurve3(points.map(vec))
    return mesh(g, new T.TubeGeometry(cv, n ?? Math.max(12, points.length * 3), rad, 7, false), mat)
  }

  function loop(
    g: T.Object3D,
    x: number,
    y: number,
    z: number,
    rx: number,
    ry: number,
    r: number,
    mat: T.Material,
    skew = 0
  ): T.Mesh {
    const arr: [number, number, number][] = []
    for (let i = 0; i <= 36; i++) {
      const a = (i / 36) * Math.PI * 2
      arr.push([x + rx * Math.cos(a), y + ry * Math.sin(a), z + skew * Math.cos(a)])
    }
    return wire(g, arr, r, mat, 30)
  }

  function spiral(
    x: number,
    y: number,
    rx: number,
    ry: number,
    a: number,
    turns: number,
    z: number,
    s = 1
  ): [number, number, number][] {
    const pts: [number, number, number][] = []
    for (let j = 0; j <= 16; j++) {
      const t = j / 16
      const b = a + t * Math.PI * 2 * turns
      const k = 1 - 0.87 * t
      pts.push([s * (x + rx * k * Math.cos(b)), y + ry * k * Math.sin(b), z + 0.6 * t])
    }
    return pts
  }

  function gem(
    g: T.Object3D,
    x: number,
    y: number,
    z: number,
    rx: number,
    ry: number,
    depth: number,
    mat: T.Material = J
  ): void {
    const N = 10
    const p: number[] = []
    const ix: number[] = []
    const rings: readonly [number, number, number][] = [
      [0.06, -0.52, 0],
      [1, 0, 0],
      [0.71, 0.69, 0.21],
      [0.42, 0.99, 0]
    ]
    for (const [rr, zz, off] of rings) {
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2 + off
        p.push(x + rx * rr * Math.cos(a), y + ry * rr * Math.sin(a), z + depth * zz)
      }
    }
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < N; i++) {
        const a = j * N + i
        const b = j * N + ((i + 1) % N)
        ix.push(a, b, b + N, a, b + N, a + N)
      }
    }
    for (let i = 1; i < N - 1; i++) ix.push(3 * N, 3 * N + i, 3 * N + i + 1)
    const gg = buf(p, ix).toNonIndexed()
    gg.computeVertexNormals()
    mesh(g, gg, mat)
    loop(g, x, y, z - 0.1, rx + 0.44, ry + 0.44, 0.63, Hi)
    for (const a of [0.6, 2.54, 3.74, 5.68]) {
      ball(g, x + rx * 0.91 * Math.cos(a), y + ry * 0.92 * Math.sin(a), z + 0.64, 0.65, Ag, 1, 1, 1.25)
    }
  }

  function mirror(g: T.Object3D, back: boolean): T.Group {
    const q = new T.Group()
    g.add(q)
    if (back) q.rotation.y = Math.PI
    return q
  }

  function hilt(g: T.Group): void {
    const q = part(g, '01 · 白玉柄与錾银箍')
    const rows: readonly [number, number, number][] = [
      [0, 7.8, 6.8],
      [0.7, 10.3, 7.5],
      [2.6, 10.5, 7.8],
      [4.1, 9, 7.2],
      [6, 8.1, 6.8],
      [13, 7.8, 6.1],
      [15, 8.6, 6.6],
      [18, 7.5, 6.1],
      [32, 6.2, 5.3],
      [49, 5, 4.6],
      [79, 4.35, 4.35],
      [102, 4.6, 4.65],
      [119, 5.4, 5.1],
      [125, 6.4, 5.7],
      [133, 5.9, 5.9],
      [136, 7.8, 6.8],
      [139, 5.1, 5.2],
      [146, 3.5, 4.3]
    ]
    turn(q, rows, Iv)
    for (const y of [1.6, 5.4, 14.6, 17.2, 31.8, 51.7, 89.7, 103, 118, 122, 128, 135.7, 138.4]) {
      const [a, b] = sample(rows, y)
      turn(
        q,
        [
          [y - 0.9, a + 0.25, b + 0.2],
          [y - 0.35, a + 0.8, b + 0.66],
          [y + 0.55, a + 0.74, b + 0.65],
          [y + 0.91, a + 0.22, b + 0.22]
        ],
        Hi,
        32
      )
    }
    for (const [lo, hi] of [
      [4, 30],
      [104, 134]
    ] as const) {
      for (let k = 0; k < 8; k++) {
        for (const s of [-1, 1]) {
          const pts: [number, number, number][] = []
          for (let i = 0; i <= 12; i++) {
            const t = i / 12
            const y = lo + (hi - lo) * t
            const [a, b] = sample(rows, y)
            const an = (k * Math.PI) / 4 + s * (0.45 * Math.sin(Math.PI * t) * Math.cos(t * 4.0))
            pts.push([(a + 0.23) * Math.sin(an), y, (b + 0.23) * Math.cos(an)])
          }
          wire(q, pts, 0.35, Ag, 20)
        }
      }
    }
    for (const s of [-1, 1]) {
      const pts: [number, number, number][] = []
      for (let i = 0; i <= 100; i++) {
        const y = 34 + i * 0.67
        const [a, b] = sample(rows, y)
        const an = 0.28 * i * s
        pts.push([(a + 0.04) * Math.sin(an), y, (b + 0.04) * Math.cos(an)])
      }
      wire(q, pts, 0.23, Ag, 120)
    }
    for (const y of [8, 22, 109, 130]) {
      const [a, b] = sample(rows, y)
      for (let i = 0; i < 10; i++) {
        const t = (i * Math.PI) / 5
        ball(q, (a + 0.23) * Math.sin(t), y, (b + 0.24) * Math.cos(t), 0.64, Hi)
      }
    }
    const l = part(g, '02 · 编绳、连环与分股剑穗')
    for (const s of [-1, 1]) {
      const ps: [number, number, number][] = []
      const cv = new T.CatmullRomCurve3(
        [
          [-8, 3, 0],
          [-12, 5, 1],
          [-16, 26, 1],
          [-23, 57, 1],
          [-29, 77, 3]
        ].map(vec)
      )
      for (let i = 0; i <= 80; i++) {
        const t = i / 80
        const pt = cv.getPoint(t)
        ps.push([pt.x + s * 0.37 * Math.cos(t * 80), pt.y, pt.z + s * 0.37 * Math.sin(t * 80)])
      }
      wire(l, ps, 0.43, s > 0 ? Hi : Gs, 90)
    }
    ball(l, -29, 77, 3, 3.1, J, 1, 1.21, 1)
    loop(l, -30, 87, 2, 7.3, 7.7, 0.84, Ag, 1.4)
    loop(l, -30, 87, 2, 5.4, 6, 0.4, Hi, -1)
    gem(l, -30, 87, 2, 2.9, 3.2, 2.2)
    for (let i = 0; i < 6; i++) {
      loop(l, -32 - i * 0.86, 96 + i * 3.36, 2.5, 2.15, 3.12, 0.64, i % 2 ? Hi : Ag, i % 2 ? 1.6 : 0.3)
    }
    // Thirty-six individual closed strands form three flowing bundles.
    for (let k = 0; k < 3; k++) {
      for (let j = 0; j < 12; j++) {
        const a = (j * Math.PI) / 6
        const u = Math.cos(a)
        const v = Math.sin(a)
        const pts: [number, number, number][] = [
          [-36.5 + u * 0.7, 114, 2.6 + v * 0.7],
          [-38.6 + u, 126, 2.6 + v],
          [-42 - k * 1.0 + u * 1.1, 140 - k * 5, 3 + v],
          [-(75 - k * 18) + u * (k ? 1.5 : 3.4), 197 - k * 22.5 + 1.4 * Math.sin(j * 2.1), 3 + v * 1.3]
        ]
        sweep(l, pts, k ? 0.4 : 0.51, 0.38, j % 4 === 0 ? Ag : Si, { taper: false, n: 24, radial: 5 })
      }
    }
  }

  // Paired silver tongues are independent swept solids, with a dorsal ridge and a second incised contour.
  function plume(
    g: T.Object3D,
    path: readonly (readonly [number, number, number?])[],
    w: number,
    mat: T.Material = Ag,
    z = 3,
    inc = true
  ): void {
    const p: [number, number, number][] = path.map(([x, y, d]) => [x, y, d ?? z])
    sweep(g, p, w, w * 0.53, mat)
    const top: [number, number, number][] = p.map(([x, y, d], i) => [
      x,
      y,
      d + w * 0.44 * Math.pow(Math.sin((Math.PI * i) / (p.length - 1)), 0.4)
    ])
    sweep(g, top, w * 0.16, 0.46, Hi)
    if (inc && w > 2.4) {
      const a: [number, number, number][] = p.map(([x, y, d], i) => [
        x + w * 0.36 * Math.sin((Math.PI * i) / (p.length - 1)),
        y,
        d + w * 0.49 * Math.sin((Math.PI * i) / (p.length - 1))
      ])
      sweep(g, a, 0.39, 0.23, Ox)
    }
  }

  const rotors: T.Group[] = []
  const lagoon = material('13 · 浅蓝灵珠内胆', 0x76c9ec, 0.15, 0.24)
  const ink = material('14 · 青金卦爻', 0x153d63, 0.35, 0.29)
  const frost = material('15 · 月白阳鱼', 0xe8faff, 0.23, 0.27)
  Cb.transparent = true
  Cb.opacity = 0.3
  Cb.depthWrite = false
  Cb.envMapIntensity = 0.94
  // Fresnel edge and a soft off-axis reflection define the clear shell without veiling the trigrams.
  Cb.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <opaque_fragment>',
      `vec3 V=normalize(vViewPosition);float rim=pow(1.-max(0.,dot(normal,V)),2.4);float gleam=pow(max(0.,dot(normal,normalize(vec3(-.46,.52,.75)))),110.);outgoingLight+=vec3(.19,.56,.91)*rim+vec3(.62,.89,1.)*gleam;diffuseColor.a=mix(.24,.66,rim)+.23*gleam;
#include <opaque_fragment>`
    )
  }
  Cb.customProgramCacheKey = () => 'xianling-pearl-shell-v1'

  // Geometry only: an ice-blue pearl surrounding a separately pivoted, two-sided Bagua rotor.
  function pearl(g: T.Group, q: T.Group, cy: number): void {
    const outer = mesh(q, new T.SphereGeometry(13.2, 64, 48), Cb, 0, cy, 0)
    outer.scale.z = 0.84
    const rb = part(g, '03 · 先天八卦转芯')
    rb.position.y -= cy * S
    rb.scale.setScalar(S)
    rb.userData.rotor = true
    rotors.push(rb)
    const R = 10.68
    const D = 6.3
    const Z = (r: number) => D * Math.sqrt(Math.max(0.04, 1 - (r / R) ** 2))
    mesh(rb, new T.SphereGeometry(1, 52, 36), lagoon).scale.set(R, R, D)
    for (const back of [false, true]) {
      const f = mirror(rb, back)
      for (const [radius, w, mat] of [
        [10.0, 0.15, Hi],
        [9.52, 0.13, ink],
        [5.63, 0.16, Hi],
        [5.26, 0.14, ink]
      ] as const) {
        mesh(f, new T.TorusGeometry(radius, w, 6, 96), mat, 0, 0, Z(radius) + 0.19)
      }
      // 先天方位，自上顺时针：乾、巽、坎、艮、坤、震、离、兑。初爻靠内。
      const codes = ['111', '011', '010', '001', '000', '100', '101', '110'] as const
      codes.forEach((code, j) => {
        const section = new T.Group()
        f.add(section)
        section.rotation.z = (-j * Math.PI) / 4
        for (let i = 0; i < 3; i++) {
          const rr = 6.27 + i * 1.18
          const w = 3.98 + i * 0.26
          const gap = 1.04
          const seg: readonly [number, number][] =
            code[i] === '1'
              ? [[0, w]]
              : [
                  [-(w + gap) / 4, (w - gap) / 2],
                  [(w + gap) / 4, (w - gap) / 2]
                ]
          for (const [x, ww] of seg) {
            const h = 0.71
            const dep = 0.38
            const pts: number[] = []
            for (const bottom of [0, 1]) {
              for (const [x0, y0] of [
                [-1, -1],
                [1, -1],
                [1, 1],
                [-1, 1]
              ] as const) {
                const xx = x + (x0 * ww) / 2
                const yy = rr + (y0 * h) / 2
                pts.push(xx, yy, Z(Math.hypot(xx, yy)) + 0.16 + bottom * dep)
              }
            }
            const idx = [
              0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0,
              4, 3, 4, 7
            ]
            mesh(section, buf(pts, idx), ink)
          }
        }
        const a = ((j + 0.5) * Math.PI) / 4
        ball(f, Math.sin(a) * 9.02, Math.cos(a) * 9.02, Z(9.02) + 0.16, 0.26, Hi)
      })
      // The two fish are closed solids raised slightly above the convex inner lens.
      const r = 4.68
      for (let k = 0; k < 2; k++) {
        const s = new T.Shape()
        s.moveTo(0, r)
        s.absarc(0, 0, r, Math.PI / 2, -Math.PI / 2, true)
        s.absarc(0, -r / 2, r / 2, -Math.PI / 2, Math.PI / 2, false)
        s.absarc(0, r / 2, r / 2, -Math.PI / 2, Math.PI / 2, true)
        s.closePath()
        const geo = new T.ExtrudeGeometry(s, { depth: 0.34, bevelEnabled: false, curveSegments: 20 })
        const o = mesh(f, geo, k === 0 ? ink : frost, 0, 0, D + 0.12)
        o.rotation.z = k * Math.PI
        ball(f, 0, ((k ? 1 : -1) * r) / 2, D + 0.52, 0.69, k === 0 ? ink : frost, 1, 1, 0.4)
      }
    }
  }

  function guard(g: T.Group, big: boolean): void {
    const q = part(g, big ? '03 · 镂空双层云冠' : '03 · 旋云剑格')
    const outer = big ? part(g, '03b · 镂空托月鞘冠') : null
    const hub = big ? 173 : 174
    pearl(g, q, hub)
    turn(
      q,
      [
        [140, 3.6, 3.5],
        [143, 5.8, 4.7],
        [146, 4.6, 4.4],
        [150, 6, 4.8],
        [156, 4.2, 4.5],
        [160, 5, 4.8]
      ],
      Ag,
      32
    )
    for (const back of [false, true]) {
      const face = mirror(q, back)
      const outerFace = outer ? mirror(outer, back) : null
      for (const s of [-1, 1]) {
        const map = (arr: readonly (readonly [number, number, number?])[]): [number, number, number?][] =>
          arr.map(([x, y, z]) => [s * x, y + (big ? 0 : 1), z])
        function wing(
          arr: readonly (readonly [number, number, number?])[],
          w: number,
          mat: T.Material,
          z: number
        ): void {
          plume(face, map(arr), w, mat, z)
        }
        // Twisted crescent gripping the central midnight pearl.
        wing(
          [
            [0, 204],
            [9, 195],
            [20, 186],
            [25, 179],
            [22, 171],
            [17, 163],
            [15, 154]
          ],
          3.25,
          Ag,
          2.7
        )
        wing(
          [
            [1, 196],
            [12, 190],
            [17, 183],
            [15, 178],
            [10, 175]
          ],
          3.55,
          Iv,
          4.2
        )
        wing(
          [
            [5, 190],
            [14, 187],
            [22, 179],
            [26, 170],
            [24, 160],
            [22, 154]
          ],
          2.1,
          Hi,
          3.0
        )
        wing(
          [
            [16, 185],
            [24, 184],
            [28, 178],
            [31, 169]
          ],
          1.5,
          Ag,
          2
        )
        wing(
          [
            [6, 168],
            [11, 162],
            [12, 157],
            [9, 151],
            [10, 145]
          ],
          1.7,
          Hi,
          2
        )
        wing(
          [
            [1, 163],
            [4.3, 156],
            [2.1, 151],
            [0, 145]
          ],
          1.4,
          Hi,
          3.7
        )
        sweep(face, spiral(16, 184, 5.1, 4.8, -1.2, 1.17, 5, s), 1.25, 1.05, Ag)
        gem(face, s * 19, 177, 4.9, 1.9, 2.7, 1.35)
        if (big && outerFace) {
          const outerWing = (
            arr: readonly (readonly [number, number, number?])[],
            w: number,
            mat: T.Material,
            z: number
          ) => plume(outerFace, map(arr), w, mat, z)
          outerWing(
            [
              [7, 214],
              [19, 209],
              [32, 200],
              [40, 190],
              [43, 178],
              [40.3, 166],
              [34, 160],
              [31, 151],
              [32, 143],
              [26, 137],
              [19, 130],
              [17, 120]
            ],
            4.08,
            Ag,
            1.2
          )
          outerWing(
            [
              [8, 213],
              [22, 206],
              [27, 199],
              [31, 194],
              [35, 188],
              [36, 182],
              [31, 181]
            ],
            3.2,
            Iv,
            3.9
          )
          outerWing(
            [
              [28, 195],
              [38, 192],
              [43, 182],
              [41, 173],
              [37, 167],
              [32, 165]
            ],
            2.86,
            Hi,
            3.7
          )
          outerWing(
            [
              [33, 165],
              [32, 159],
              [29, 155],
              [27, 151],
              [28, 146],
              [24, 142],
              [19, 141]
            ],
            2.2,
            Ag,
            2.2
          )
          outerWing(
            [
              [31, 154],
              [35, 147],
              [33, 140],
              [27, 136],
              [24, 130],
              [23, 125]
            ],
            1.24,
            Hi,
            1.6
          )
          const arr = spiral(34.2, 171.5, 6.2, 6.2, -2.1, 1.15, 3.2, s)
          sweep(outerFace, arr, 2.2, 1.65, En)
          sweep(
            outerFace,
            arr.map(([x, y, z]) => [x + s * 0.42, y, z + 1.45]),
            0.44,
            0.35,
            Hi
          )
          sweep(outerFace, spiral(26.3, 153, 5.1, 4.9, -1, 1.1, 2.7, s), 1.26, 1.1, En)
          sweep(outerFace, spiral(24, 194, 7.8, 6.8, -2.6, 1.25, 4.4, s), 2.0, 1.3, Ag)
          gem(outerFace, s * 37.3, 170.4, 5.2, 2.4, 3.3, 1.8)
          gem(outerFace, s * 23.7, 193.7, 6.6, 2.5, 3.2, 1.8)
          for (let i = 0; i < 13; i++) {
            const t = i / 12
            ball(outerFace, s * (19 + 22 * Math.sin(t * 1.37)), 206 - 27 * t, 4.5, 0.68, Hi)
          }
        }
      }
      // Four short talons at the rim leave the entire trigram wheel visible.
      for (const side of [-1, 1]) {
        plume(
          face,
          [
            [side * 15, 179, 3],
            [side * 13.4, 183, 4.3],
            [side * 10, 185.8, 4.9],
            [side * 8.3, 184.5, 5.2]
          ],
          1.24,
          Hi
        )
      }
      for (const s of [-1, 1]) {
        const pp: [number, number, number][] = [
          [0, 207, 4],
          [s * 5, 199, 5],
          [s * 8, 193, 5],
          [s * 8, 188, 5],
          [s * 4.3, 189, 5.5],
          [s * 3.1, 192, 6]
        ]
        plume(face, pp, 2.0, Ag)
        sweep(face, spiral(7.8, 194.4, 3.1, 3.3, -0.9, 1.22, 6, s), 0.83, 0.58, Hi)
      }
    }
  }

  const sc: readonly [number, number, number][] = [
    [202, 20.5, 8.3],
    [205, 24.6, 9.2],
    [210, 24.2, 9],
    [215, 22.8, 8.5],
    [226, 23.0, 8.6],
    [243, 22.4, 8.7],
    [264, 22.3, 8.6],
    [279, 20.6, 8.4],
    [299, 17.4, 7.9],
    [346, 16.0, 7.6],
    [389, 15.2, 7.4],
    [408, 16, 7.5],
    [427, 18.3, 8],
    [441, 18.0, 8],
    [455, 22.1, 8.5],
    [465, 23.1, 8.9],
    [475, 20.1, 8.4],
    [485, 21.1, 8.6],
    [498, 23.9, 9.1],
    [514, 22.3, 8.8],
    [527, 18.8, 8.1],
    [542, 13.8, 6.9],
    [552, 9.3, 5.3],
    [560, 3.9, 2.8],
    [563, 0.3, 0.4]
  ]

  function shellZ(x: number, y: number): number {
    const [a, b] = sample(sc, y)
    return b * Math.sqrt(Math.max(0.018, 1 - (x / a) ** 2))
  }

  function sheathBody(): void {
    const q = part(sheath, '04 · 中空玉鞘、内衬与包银')
    const N = 64
    const p: number[] = []
    const ix: number[] = []
    const layers: [number, number, number][] = [
      ...sc.map(([y, x, z]): [number, number, number] => [y, x, z]),
      ...sc
        .slice(0, -2)
        .reverse()
        .map(([y, x, z]): [number, number, number] => [y, x * 0.64, z * 0.6])
    ]
    for (let j = 0; j < layers.length; j++) {
      const [y, rx, rz] = layers[j]!
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2
        p.push(rx * Math.sin(a), y, rz * Math.cos(a))
        const b = j * N + i
        const c = j * N + ((i + 1) % N)
        const k = ((j + 1) % layers.length) * N
        ix.push(b, c, k + i, c, k + ((i + 1) % N), k + i)
      }
    }
    const geo = buf(p, ix)
    geo.addGroup(0, sc.length * N * 6, 0)
    geo.addGroup(sc.length * N * 6, (layers.length - sc.length) * N * 6, 1)
    mesh(q, geo, [Iv, Bk])
    for (const [y, h] of [
      [204, 2.2],
      [211, 1.3],
      [277, 1.4],
      [463, 1.1],
      [484, 1.4],
      [542, 1.1]
    ] as const) {
      const [a, b] = sample(sc, y)
      const pts: [number, number, number][] = []
      for (let i = 0; i <= 60; i++) {
        const an = (i / 60) * Math.PI * 2
        pts.push([(a + 0.45) * Math.sin(an), y + 0.5 * Math.cos(4 * an), (b + 0.32) * Math.cos(an)])
      }
      wire(q, pts, h * 0.7, Ag, 64)
    }
    for (const s of [-1, 1]) {
      for (const k of [-1, 1]) {
        const pts = sc.map(([y, x, z]) => [s * x * 0.89, y, k * z * 0.477])
        wire(q, pts, 0.82, Ag, 100)
        const rail = sc.map(([y, x, z]) => [s * x * 0.78, y, k * (z * 0.632 + 0.17)])
        wire(q, rail, 0.39, Hi, 95)
      }
    }
  }

  function filigree(): void {
    const q = part(sheath, '05 · 双面银胎花丝、宝座与鞘尾')
    for (const b of [false, true]) {
      const f = mirror(q, b)
      const curvePts = (
        arr: readonly (readonly [number, number, number?])[],
        s = 1,
        lift = 0.6
      ): [number, number, number][] => arr.map(([x, y, z]) => [s * x, y, shellZ(x, y) + (z ?? lift)])
      function relief(
        arr: readonly (readonly [number, number, number?])[],
        w: number,
        mat: T.Material,
        s = 1
      ): void {
        const p = curvePts(arr, s, w * 0.22)
        sweep(f, p, w, w * 0.65, mat)
        if (w > 1.6) {
          sweep(
            f,
            p.map(([x, y, z], i) => [x, y, z + w * 0.46 * Math.sin((i / (p.length - 1)) * Math.PI)]),
            w * 0.13,
            0.32,
            Hi
          )
        }
      }
      function sw(
        cx: number,
        cy: number,
        rx: number,
        ry: number,
        ang: number,
        tr: number,
        s: number,
        w = 1.1,
        mat: T.Material = Ag
      ): void {
        const p: [number, number, number][] = spiral(cx, cy, rx, ry, ang, tr, 0, s).map(([x, y]) => [
          x,
          y,
          shellZ(x, y) + w * 0.52
        ])
        sweep(f, p, w, w * 0.67, mat)
      }
      function mount(x: number, y: number, rx: number, ry: number): void {
        const z = shellZ(x, y)
        ball(f, x, y, z + 0.25, 1, Ox, rx + 1.6, ry + 1.8, 1.4)
        gem(f, x, y, z + 1.6, rx, ry, Math.min(rx, ry) * 0.65)
      }
      // Decorative throat
      for (const s of [-1, 1]) {
        relief(
          [
            [1.0, 284],
            [5.2, 272],
            [6.3, 254],
            [9.1, 245],
            [8.3, 236],
            [4.8, 231],
            [5.4, 225],
            [10, 218],
            [12, 208],
            [10.4, 203]
          ],
          2.08,
          Ag,
          s
        )
        relief(
          [
            [13.2, 292],
            [15.1, 268],
            [16.8, 250],
            [18.5, 241],
            [16, 233],
            [16, 226],
            [21, 218],
            [22.3, 209]
          ],
          1.65,
          Ag,
          s
        )
        relief(
          [
            [1.2, 265],
            [4, 258],
            [4.5, 250],
            [3, 244],
            [0.8, 240]
          ],
          1.25,
          Hi,
          s
        )
        relief(
          [
            [0, 229],
            [5.4, 225],
            [7.3, 217],
            [12.5, 214],
            [14.9, 209],
            [15, 204]
          ],
          2.45,
          Ag,
          s
        )
        sw(14.1, 228, 5.5, 7.5, -2.1, 1.22, s, 1.46)
        sw(13.4, 244, 4.1, 6.2, -0.5, 1.2, s, 1.17)
        sw(6.0, 212, 5.5, 6.8, -0.3, 1.17, s, 1.52)
        sw(4.6, 235, 3.0, 3.35, 1.4, 1.12, s, 0.88)
        sw(14.4, 258.7, 2.5, 3.4, -1.4, 1.12, s, 0.85)
        for (let k = 0; k < 17; k++) {
          const y = 213 + k * 3.9
          const x = sample(sc, y)[0] * 0.82
          ball(f, s * x, y, shellZ(x, y) + 0.1, 0.63, Hi)
        }
      }
      mount(0, 217.5, 2.8, 3.4)
      mount(0, 236.0, 3.5, 4.55)
      mount(0, 255.0, 2.2, 2.8)
      mount(0, 271.2, 1.45, 2.7)
      // Four silver rosettes bridge crown and throat
      for (const s of [-1, 1]) {
        const pl = ([x, y, z]: readonly [number, number, number]): [number, number, number] => [s * x, y, z]
        for (const [arr, w] of [
          [
            [
              [4, 213, 8.5],
              [9, 205, 8.1],
              [13, 201, 7.4],
              [19, 201, 6.4],
              [23, 197, 5],
              [24, 192, 3.8]
            ],
            2.65
          ],
          [
            [
              [10, 218, 7.8],
              [14, 210, 7.8],
              [20, 206, 6.8],
              [25, 202, 5.4],
              [29, 194, 4.4],
              [32, 191, 3.7]
            ],
            1.9
          ]
        ] as const) {
          plume(f, arr.map(pl), w, Ag)
        }
        const a = spiral(16.2, 204.4, 5.8, 5.7, 2.2, 1.36, 7.8, s)
        sweep(f, a, 1.75, 1.0, Ag)
        gem(f, s * 16, 204.3, 8.95, 1.55, 1.8, 0.96)
      }
      // Sparse engraved central rib
      for (const s of [-1, 1]) {
        relief(
          [
            [0.2, 286],
            [1.4, 303],
            [1, 324],
            [0.6, 351],
            [0.8, 370],
            [3.9, 381],
            [4.1, 390],
            [0.2, 397]
          ],
          0.65,
          Ag,
          s
        )
        relief(
          [
            [0.2, 365],
            [1.3, 378],
            [5.7, 385],
            [4.5, 391],
            [1.2, 397],
            [0, 405]
          ],
          0.67,
          Ox,
          s
        )
        relief(
          [
            [10.5, 298],
            [11.8, 332],
            [11.1, 365],
            [10.4, 387],
            [8.8, 406]
          ],
          0.44,
          Hi,
          s
        )
      }
      // Ferrule
      for (const s of [-1, 1]) {
        relief(
          [
            [0.4, 411],
            [2, 424],
            [6.6, 435],
            [8.6, 444],
            [6.2, 451],
            [2.7, 461]
          ],
          1.64,
          Ag,
          s
        )
        relief(
          [
            [0.5, 554],
            [4.7, 541],
            [9.4, 531],
            [13.8, 521],
            [16.4, 508],
            [18.7, 496],
            [15.2, 487],
            [13.4, 480],
            [16.8, 470],
            [17.3, 458],
            [13.4, 450],
            [12.6, 439],
            [9.7, 428],
            [7.6, 417]
          ],
          2.2,
          Ag,
          s
        )
        relief(
          [
            [0.5, 530],
            [4.8, 521],
            [5.9, 513],
            [9.5, 505],
            [10.3, 497],
            [8.3, 491],
            [8.9, 483],
            [12.9, 477],
            [12.8, 468],
            [9.6, 463],
            [8.7, 456]
          ],
          1.79,
          Ag,
          s
        )
        relief(
          [
            [0.8, 493],
            [2.7, 484],
            [6.8, 477],
            [6.4, 469],
            [3.5, 465],
            [2.5, 459],
            [0.3, 453]
          ],
          1.8,
          Hi,
          s
        )
        relief(
          [
            [0.6, 550],
            [6.2, 539],
            [6.2, 533],
            [3.2, 529]
          ],
          1.08,
          Hi,
          s
        )
        for (const [x, y, rx, ry, a, tr, w] of [
          [10.6, 442, 3, 5, -2.3, 1.13, 1.0],
          [13.5, 456, 5.1, 8.2, -0.9, 1.32, 1.62],
          [7.2, 464.4, 4.1, 5.4, 2.4, 1.29, 1.23],
          [15.6, 474.6, 4.4, 6.9, -1.2, 1.23, 1.33],
          [9.6, 483, 4.2, 6.4, -0.8, 1.18, 1.22],
          [15.8, 496.7, 5.5, 7.9, -0.6, 1.33, 1.65],
          [8.5, 506.2, 3.8, 7.2, 1.1, 1.19, 1.23],
          [12.4, 515.4, 4.9, 6.9, -0.5, 1.24, 1.34],
          [7.6, 527.8, 4.8, 6.3, 2.7, 1.2, 1.05],
          [4.0, 539, 2.5, 3.7, 2.5, 1.13, 0.91]
        ] as const) {
          sw(x, y, rx, ry, a, tr, s, w)
        }
        for (let n = 0; n < 28; n++) {
          const y = 442 + n * 3.8
          const x = sample(sc, y)[0] * 0.81
          ball(f, x * s, y, shellZ(x, y) + 0.2, 0.66, Hi)
        }
        for (const [x, y] of [
          [15, 459],
          [15.3, 495],
          [11.2, 518]
        ] as const) {
          mount(x * s, y, 1.38, 2.02)
        }
      }
      mount(0, 429, 1.55, 2.6)
      mount(0, 451.2, 2.46, 3.15)
      mount(0, 482.5, 2.15, 2.65)
      mount(0, 508.5, 4.7, 6.25)
      mount(0, 533.3, 1.82, 2.7)
      for (let i = 0; i < 5; i++) {
        const y = 543.2 + i * 2.8
        for (const s of [-1, 1]) {
          relief(
            [
              [0, y + 4],
              [s * 2.8, y + 1.8],
              [s * (6.5 - i * 0.86), y - 0.8]
            ],
            0.56,
            Ag
          )
        }
      }
    }
  }

  function forgedBlade(): void {
    const q = part(sword, '04 · 锻刃、中脊、刃槽')
    const stations: readonly [number, number, number][] = [
      [197, 6.3, 3.7],
      [205, 8.4, 4],
      [215, 12.6, 4.75],
      [219, 12.8, 4.7],
      [228, 11.8, 4.6],
      [250, 9.5, 4.2],
      [267, 8.6, 4],
      [386, 8.0, 3.6],
      [492, 7.8, 3.5],
      [513, 7.6, 3.28],
      [522, 6.55, 3],
      [538, 2.5, 1.5],
      [551, 0.06, 0.08]
    ]
    const cr: readonly [number, number][] = [
      [-1, 0],
      [-0.76, 0.56],
      [-0.27, 0.74],
      [-0.15, 0.59],
      [0, 1],
      [0.15, 0.59],
      [0.27, 0.74],
      [0.76, 0.56],
      [1, 0],
      [0.76, -0.56],
      [0.27, -0.74],
      [0.15, -0.59],
      [0, -1],
      [-0.15, -0.59],
      [-0.27, -0.74],
      [-0.76, -0.56]
    ]
    const facetMats = [Hi, Sn, Ox, Ag, Sn, Ox, Ag, Hi, Hi, Sn, Ox, Ag, Sn, Ox, Ag, Hi] as const
    for (let i = 0; i < cr.length; i++) {
      const pts: number[] = []
      const idx: number[] = []
      for (const [y, w, h] of stations) {
        for (const k of [i, (i + 1) % cr.length]) {
          pts.push(cr[k]![0] * w, y, cr[k]![1] * h)
        }
      }
      for (let j = 0; j < stations.length - 1; j++) {
        idx.push(j * 2, j * 2 + 1, j * 2 + 2, j * 2 + 1, j * 2 + 3, j * 2 + 2)
      }
      mesh(q, buf(pts, idx), facetMats[i]!)
    }
    for (const back of [false, true]) {
      const f = mirror(q, back)
      for (const s of [-1, 1]) {
        plume(
          f,
          [
            [0, 248, 3.9],
            [s * 3, 237, 4.2],
            [s * 7, 229, 4.0],
            [s * 8.7, 218, 3.3],
            [s * 6.8, 213, 3.7],
            [s * 2.9, 208, 4.3],
            [s * 2.4, 199, 4.1]
          ],
          1.5,
          Ag
        )
        sweep(f, spiral(4.6, 219.4, 3.7, 5.4, -1.4, 1.1, 4.1, s), 1.23, 0.88, Hi)
        plume(
          f,
          [
            [0, 524, 3.5],
            [s * 2.1, 516, 3.55],
            [s * 3.8, 509, 3.25],
            [s * 3.2, 503, 3.1],
            [s * 0.3, 494, 3.65]
          ],
          0.74,
          Ag
        )
      }
      gem(f, 0, 221.5, 4.9, 2.7, 4.2, 2)
      gem(f, 0, 235.2, 4.4, 1.65, 2.7, 1.1)
      gem(f, 0, 513, 3.7, 1.53, 2.35, 0.9)
    }
  }

  hilt(sword)
  guard(sword, false)
  forgedBlade()
  hilt(sheath)
  guard(sheath, true)
  sheathBody()
  filigree()

  // Batch by physical component and material to keep the hundreds of small silver pieces inexpensive to orbit.
  function batch(p: T.Group): void {
    p.updateWorldMatrix(true, true)
    const inv = p.matrixWorld.clone().invert()
    const sets = new Map<T.Material, { p: number[]; n: number[]; i: number[] }>()
    p.traverse((o) => {
      if (!(o instanceof T.Mesh)) return
      const g = o.geometry as T.BufferGeometry
      const xx = inv.clone().multiply(o.matrixWorld)
      const nn = new T.Matrix3().getNormalMatrix(xx)
      const pos = g.attributes.position as T.BufferAttribute
      const nor = g.attributes.normal as T.BufferAttribute
      const index = g.index
      const groups = Array.isArray(o.material)
        ? g.groups
        : [{ start: 0, count: index ? index.count : pos.count, materialIndex: 0 }]
      for (const gr of groups) {
        const m = Array.isArray(o.material) ? o.material[gr.materialIndex ?? 0]! : o.material
        let v = sets.get(m)
        if (!v) {
          v = { p: [], n: [], i: [] }
          sets.set(m, v)
        }
        const ids = new Map<number, number>()
        for (let k = gr.start; k < gr.start + gr.count; k++) {
          const old = index ? index.getX(k) : k
          let mapped = ids.get(old)
          if (mapped === undefined) {
            const pt = new T.Vector3().fromBufferAttribute(pos, old).applyMatrix4(xx)
            const nm = new T.Vector3().fromBufferAttribute(nor, old).applyMatrix3(nn).normalize()
            mapped = v.p.length / 3
            ids.set(old, mapped)
            v.p.push(pt.x, pt.y, pt.z)
            v.n.push(nm.x, nm.y, nm.z)
          }
          v.i.push(mapped)
        }
      }
    })
    p.traverse((o) => {
      if (o instanceof T.Mesh) o.geometry.dispose()
    })
    p.clear()
    for (const [m, a] of sets) {
      const g = new T.BufferGeometry()
      g.setAttribute('position', new T.Float32BufferAttribute(a.p, 3))
      g.setAttribute('normal', new T.Float32BufferAttribute(a.n, 3))
      g.setIndex(a.i)
      g.computeBoundingSphere()
      const obj = mesh(p, g, m)
      obj.name = m.name
    }
  }

  pieces.forEach(batch)
  sheath.children.forEach((p) => {
    p.userData.displayOnly = /^(01|02|03 ·)/.test(p.name)
  })
  return { sword, sheath, rotors, materials: mats }
}
