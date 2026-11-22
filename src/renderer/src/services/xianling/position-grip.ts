// Drag the sword or the scabbard in the screen plane, as offsets on top of the live dance.
import * as T from 'three'
import type { Conductor } from './main-blade'

export interface PositionGripController {
  place(): void
  start(e: PointerEvent): boolean
  move(e: PointerEvent): boolean
  apply(): void
  end(): void
  dispose(): void
  readonly active: boolean
  readonly id: number | null
}

export function positionGrip(
  host: HTMLElement,
  cam: T.OrthographicCamera,
  hero: Conductor,
  inStudy: () => boolean,
  markers: [HTMLElement, HTMLElement]
): PositionGripController {
  const world = new T.Vector3()
  const project = new T.Vector3()
  const delta = new T.Vector3()
  const inv = new T.Matrix4()
  const ray = new T.Raycaster()
  const ndc = new T.Vector2()
  const grab = new T.Vector3()
  const point = new T.Vector3()
  const parentScaleVec = new T.Vector3()

  let active: 0 | 1 | null = null
  let id: number | null = null
  let px = 0
  let py = 0
  let dx = 0
  let dy = 0
  const points: [[number, number, number], [number, number, number]] = [
    [0, 0, 0],
    [0, 0, 0]
  ]
  const shown: [boolean, boolean] = [false, false]

  function projectPoint(obj: T.Object3D, local: T.Vector3): [number, number, number] {
    obj.updateWorldMatrix(true, false)
    world.copy(local).applyMatrix4(obj.matrixWorld)
    project.copy(world).project(cam)
    const b = host.getBoundingClientRect()
    return [b.left + ((project.x + 1) * b.width) / 2, b.top + ((1 - project.y) * b.height) / 2, project.z]
  }

  const objects = (): [T.Group, T.Group] => [hero.sword, hero.sheath]

  function place(): void {
    const b = host.getBoundingClientRect()
    const objs = objects()
    objs.forEach((o, i) => {
      const idx = i as 0 | 1
      const p = projectPoint(o, point.set(0, idx ? -0.4 : 0.4, 0))
      points[idx] = p
      shown[idx] =
        (idx ? !inStudy() && o.visible : inStudy() || o.visible) &&
        p[0] > b.left + 8 &&
        p[0] < b.right - 8 &&
        p[1] > b.top + 8 &&
        p[1] < b.bottom - 8
      const marker = markers[idx]
      marker.hidden = !shown[idx]
      marker.style.left = `${p[0] - b.left}px`
      marker.style.top = `${p[1] - b.top}px`
    })
  }

  function hit(e: PointerEvent): { index: 0 | 1; local: T.Vector3 } | null {
    const radius = e.pointerType === 'touch' ? 30 : 20
    for (const i of [0, 1] as const) {
      if (shown[i] && Math.hypot(points[i][0] - e.clientX, points[i][1] - e.clientY) < radius) {
        return { index: i, local: new T.Vector3(0, i ? -0.4 : 0.4, 0) }
      }
    }
    // Actual geometry hit, excluding attached effects and hidden parts. The sword tip takes priority before this controller.
    const b = host.getBoundingClientRect()
    ndc.set(((e.clientX - b.left) / b.width) * 2 - 1, 1 - ((e.clientY - b.top) / b.height) * 2)
    ray.setFromCamera(ndc, cam)
    const hits: { index: 0 | 1; hit: T.Intersection }[] = []
    const objs = objects()
    objs.forEach((obj, i) => {
      const idx = i as 0 | 1
      if ((idx && inStudy()) || !obj.visible) return
      const parts = obj.children.filter((x) => x.userData.weaponPart && x.visible)
      for (const h of ray.intersectObjects(parts, true)) hits.push({ index: idx, hit: h })
    })
    hits.sort((a, bHit) => a.hit.distance - bHit.hit.distance)
    if (!hits.length) return null
    const first = hits[0]!
    const obj = objs[first.index]
    return { index: first.index, local: obj.worldToLocal(first.hit.point.clone()) }
  }

  function start(e: PointerEvent): boolean {
    if (e.button !== 0 || e.shiftKey) return false
    const h = hit(e)
    if (!h) return false
    id = e.pointerId
    active = h.index
    grab.copy(h.local)
    px = e.clientX
    py = e.clientY
    const q = projectPoint(objects()[active], grab)
    dx = q[0] - px
    dy = q[1] - py
    host.dataset.movingObject = 'true'
    markers[active].dataset.selected = 'true'
    return true
  }

  function move(e: PointerEvent): boolean {
    if (e.pointerId !== id) return false
    px = e.clientX
    py = e.clientY
    return true
  }

  // Called after the choreographed pose is calculated. The same grabbed point tracks the pointer,
  // with the choreography and every effect clock continuing underneath.
  function apply(): void {
    if (id === null || active === null) return
    const o = objects()[active]
    const b = host.getBoundingClientRect()
    if (!b.height) return
    const p = projectPoint(o, grab)
    const scale = (cam.top - cam.bottom) / (cam.zoom * b.height)
    delta.set((px + dx - p[0]) * scale, (p[1] - py - dy) * scale, 0).applyQuaternion(cam.quaternion)
    if (o.parent) {
      o.parent.updateWorldMatrix(true, false)
      inv.copy(o.parent.matrixWorld).invert()
      delta.transformDirection(inv)
      const amount = Math.hypot(px + dx - p[0], p[1] - py - dy) * scale
      const parentScale = parentScaleVec.setFromMatrixScale(o.parent.matrixWorld).x || 1
      delta.multiplyScalar(amount / parentScale)
    }
    o.position.add(delta)
    if (!inStudy()) hero.addPositionOffset(active, delta)
  }

  function end(): void {
    if (id === null || active === null) return
    delete markers[active].dataset.selected
    delete host.dataset.movingObject
    id = null
    active = null
  }

  function dispose(): void {
    end()
    markers[0].hidden = true
    markers[1].hidden = true
  }

  return {
    place,
    start,
    move,
    apply,
    end,
    dispose,
    get active() {
      return id !== null
    },
    get id() {
      return id
    }
  }
}
