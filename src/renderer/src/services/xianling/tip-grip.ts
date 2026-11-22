// Pick the projected tip, then solve its direction on a fixed-radius sphere about the grip.
// No camera orbit and no stretch/translation of the sword's pivot during the gesture.
import * as T from 'three'
import type { Conductor } from './main-blade'

export interface TipGripController {
  place(): void
  start(e: PointerEvent): boolean
  move(e: PointerEvent): boolean
  end(): void
  solve(): T.Quaternion | null
  applyStudy(): void
  hover(e: PointerEvent): void
  nudge(dx: number, dy: number): void
  dispose(): void
  readonly active: boolean
  readonly id: number | null
}

export function tipGrip(
  host: HTMLElement,
  cam: T.OrthographicCamera,
  hero: Conductor,
  inStudy: () => boolean,
  flag: HTMLElement,
  labelEl: HTMLElement,
  getLabels: () => { idle: string; aiming: string }
): TipGripController {
  const tip = new T.Vector3()
  const grip = new T.Vector3()
  const from = new T.Vector3()
  const to = new T.Vector3()
  const project = new T.Vector3()
  const parentQ = new T.Quaternion()
  const initial = new T.Quaternion()
  const turn = new T.Quaternion()
  const local = new T.Quaternion()
  const offset = new T.Vector3()
  const pivot = new T.Vector3()
  let px = 0
  let py = 0
  let pointer: number | null = null
  let available = false
  let tx = 0
  let ty = 0
  let hx = 0
  let hy = 0
  let dx = 0
  let dy = 0
  let r = 1
  let sign = 1

  function place(): void {
    const sw = hero.sword
    const box = host.getBoundingClientRect()
    sw.updateWorldMatrix(true, false)
    cam.updateMatrixWorld()
    tip.set(0, -3.48015, 0).applyMatrix4(sw.matrixWorld)
    grip.set(0, 2.04, 0).applyMatrix4(sw.matrixWorld)
    project.copy(tip).project(cam)
    tx = box.left + ((project.x + 1) * box.width) / 2
    ty = box.top + ((1 - project.y) * box.height) / 2
    available =
      (pointer !== null || inStudy() || (hero.tipOK && hero.sword.visible)) &&
      Math.abs(project.x) < 0.995 &&
      Math.abs(project.y) < 0.995
    flag.hidden = !available
    flag.style.left = `${tx - box.left}px`
    flag.style.top = `${ty - box.top}px`
    project.copy(grip).project(cam)
    hx = box.left + ((project.x + 1) * box.width) / 2
    hy = box.top + ((1 - project.y) * box.height) / 2
    const tiltDeg = (Math.atan2(tx - hx, ty - hy) * 180) / Math.PI
    flag.dataset.tilt = tiltDeg.toFixed(1)
  }

  const hit = (e: PointerEvent): boolean =>
    available && Math.hypot(e.clientX - tx, e.clientY - ty) <= (e.pointerType === 'touch' ? 32 : 22)

  function beginAt(clientX: number, clientY: number, pointerId: number): void {
    const sw = hero.sword
    pointer = pointerId
    px = clientX
    py = clientY
    hero.holdTip(true)
    dx = tx - clientX
    dy = ty - clientY
    const b = host.getBoundingClientRect()
    r = (tip.distanceTo(grip) * b.height * cam.zoom) / (cam.top - cam.bottom)
    from.copy(tip).sub(grip).normalize().applyQuaternion(cam.quaternion.clone().invert())
    sign = from.z < -0.005 ? -1 : 1
    sw.getWorldQuaternion(initial)
    if (sw.parent) sw.parent.getWorldQuaternion(parentQ).invert()
    else parentQ.identity()
    pivot.copy(grip)
    sw.parent?.worldToLocal(pivot)
    host.dataset.aimingBlade = 'true'
    host.dataset.adjustingSword = 'true'
    labelEl.textContent = getLabels().aiming
  }

  function start(e: PointerEvent): boolean {
    if (!hit(e) || e.button !== 0 || e.shiftKey) return false
    beginAt(e.clientX, e.clientY, e.pointerId)
    return true
  }

  // Re-solve after this frame's dance pose and camera update, even while a finger is held still.
  function solve(): T.Quaternion | null {
    if (pointer === null) return null
    const sw = hero.sword
    const box = host.getBoundingClientRect()
    cam.updateMatrixWorld()
    sw.updateWorldMatrix(true, false)
    grip.set(0, 2.04, 0).applyMatrix4(sw.matrixWorld)
    tip.set(0, -3.48015, 0).applyMatrix4(sw.matrixWorld)
    r = (tip.distanceTo(grip) * box.height * cam.zoom) / (cam.top - cam.bottom) || 1
    project.copy(grip).project(cam)
    hx = box.left + ((1 + project.x) * box.width) / 2
    hy = box.top + ((1 - project.y) * box.height) / 2
    let x = (px + dx - hx) / r
    let y = (hy - py - dy) / r
    const l = x * x + y * y
    if (l > 1) {
      const s = Math.sqrt(l)
      x /= s
      y /= s
    }
    to.set(x, y, sign * Math.sqrt(Math.max(0, 1 - l)))
      .normalize()
      .applyQuaternion(cam.quaternion)
    turn.setFromUnitVectors(project.set(0, -1, 0).applyQuaternion(initial), to)
    if (sw.parent) sw.parent.getWorldQuaternion(parentQ).invert()
    else parentQ.identity()
    return local.copy(parentQ).multiply(turn).multiply(initial).normalize()
  }

  function applyStudy(): void {
    if (!inStudy() || pointer === null) return
    const sw = hero.sword
    const q = solve()
    if (!q) return
    sw.quaternion.copy(q)
    sw.position.copy(pivot).sub(offset.set(0, 2.04, 0).applyQuaternion(q))
  }

  function move(e: PointerEvent): boolean {
    if (e.pointerId !== pointer) return false
    px = e.clientX
    py = e.clientY
    if (inStudy()) applyStudy()
    else {
      const q = solve()
      if (q) hero.setBladeQuaternion(q)
    }
    return true
  }

  function end(): void {
    if (pointer === null) return
    pointer = null
    hero.holdTip(false)
    delete host.dataset.aimingBlade
    host.dataset.adjustingSword = 'false'
    labelEl.textContent = getLabels().idle
  }

  function nudge(stepX: number, stepY: number): void {
    place()
    if (!available) return
    beginAt(tx, ty, -999)
    px = tx + stepX
    py = ty + stepY
    if (inStudy()) applyStudy()
    else {
      const q = solve()
      if (q) hero.setBladeQuaternion(q)
    }
    end()
  }

  function dispose(): void {
    end()
    delete host.dataset.overTip
    flag.hidden = true
  }

  return {
    place,
    start,
    move,
    end,
    solve,
    applyStudy,
    hover(e: PointerEvent) {
      if (hit(e)) host.dataset.overTip = 'true'
      else delete host.dataset.overTip
    },
    nudge,
    dispose,
    get active() {
      return pointer !== null
    },
    get id() {
      return pointer
    }
  }
}
