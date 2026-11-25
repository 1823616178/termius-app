const RESUME_SETTLE_MS = 500
const STYLE_FALLBACK_MS = 1200

let windowPresent: boolean | undefined
let foreground = typeof document === 'undefined' || document.visibilityState !== 'hidden'
const listeners = new Set<(active: boolean) => void>()
export interface MotionSceneHandle {
  readonly active: boolean
  dispose: () => void
}
type MotionScene = { active: boolean; update: () => void }
const scenes = new Set<MotionScene>()
const pendingScenes = new Set<MotionScene>()
let scenesReady = foreground
let uiSuspended = !foreground
let resumeFrame = 0
let wakeAckFrame = 0
let settleTimer: ReturnType<typeof setTimeout> | undefined
let styleFallbackTimer: ReturnType<typeof setTimeout> | undefined

function notifyWakePainted(): void {
  if (!foreground || typeof window === 'undefined') return
  window.orbit?.window?.ackWake?.()
}

function cancelWakeAck(): void {
  if (wakeAckFrame) {
    cancelAnimationFrame(wakeAckFrame)
    wakeAckFrame = 0
  }
}

function scheduleWakeAck(): void {
  cancelWakeAck()
  if (
    !foreground ||
    typeof window === 'undefined' ||
    typeof window.orbit?.window?.ackWake !== 'function' ||
    typeof requestAnimationFrame !== 'function'
  ) {
    return
  }
  wakeAckFrame = requestAnimationFrame(() => {
    wakeAckFrame = 0
    notifyWakePainted()
  })
}

function setSuspended(suspended: boolean): void {
  uiSuspended = suspended
  if (typeof document === 'undefined') return
  document.documentElement.dataset.uiSuspended = suspended ? 'true' : 'false'
}

function resumeNextScene(): void {
  resumeFrame = 0
  if (!foreground) return
  const scene = pendingScenes.values().next().value
  if (scene) {
    pendingScenes.delete(scene)
    scene.active = true
    scene.update()
  }
  if (!foreground) return
  if (pendingScenes.size) resumeFrame = requestAnimationFrame(resumeNextScene)
  else scenesReady = true
}

function restoreStyles(): void {
  resumeFrame = 0
  clearTimeout(styleFallbackTimer)
  styleFallbackTimer = undefined
  if (!foreground) return
  setSuspended(false)
  // Let Chromium paint the restored CSS layers before starting any WebGL scene.
  resumeFrame = requestAnimationFrame(resumeNextScene)
}

function commit(next: boolean): void {
  if (next === foreground) return
  foreground = next
  if (!next) {
    cancelAnimationFrame(resumeFrame)
    resumeFrame = 0
    cancelWakeAck()
    clearTimeout(settleTimer)
    settleTimer = undefined
    clearTimeout(styleFallbackTimer)
    styleFallbackTimer = undefined
    scenesReady = false
    pendingScenes.clear()
    setSuspended(true)
    for (const scene of scenes) {
      if (!scene.active) continue
      scene.active = false
      scene.update()
    }
  } else {
    for (const scene of scenes) pendingScenes.add(scene)
    // Ensure CSS animations/filters still unsuspend even if rAF is delayed while waking.
    clearTimeout(styleFallbackTimer)
    styleFallbackTimer = setTimeout(() => {
      styleFallbackTimer = undefined
      if (foreground && uiSuspended) setSuspended(false)
    }, STYLE_FALLBACK_MS)
    // A window can report itself visible before Chromium is painting again.
    // Give the foreground UI a frame before starting the motion settle timer.
    resumeFrame = requestAnimationFrame(() => {
      notifyWakePainted()
      resumeFrame = requestAnimationFrame(() => {
        resumeFrame = 0
        settleTimer = setTimeout(() => {
          settleTimer = undefined
          resumeFrame = requestAnimationFrame(restoreStyles)
        }, RESUME_SETTLE_MS)
      })
    })
  }
  for (const listener of listeners) listener(foreground)
}

export function isAppForeground(): boolean {
  return foreground
}

export function onAppForegroundChange(listener: (active: boolean) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function registerMotionScene(update: () => void): MotionSceneHandle {
  const scene = { active: scenesReady, update }
  scenes.add(scene)
  if (foreground && !scene.active) pendingScenes.add(scene)
  return {
    get active() {
      return scene.active
    },
    dispose() {
      scenes.delete(scene)
      pendingScenes.delete(scene)
    }
  }
}

export function noteWindowPresence(present: boolean): void {
  windowPresent = present
  const alreadyForeground = foreground
  commit(present)
  if (present && alreadyForeground) scheduleWakeAck()
}

export function installAppForeground(): void {
  if (typeof document === 'undefined') return
  const windowsDesktop = /Windows/i.test(navigator.userAgent)
  document.addEventListener('visibilitychange', () => {
    // Electron can deliver Chromium's hidden event after the native Windows
    // window has reopened. Its next visible event is not guaranteed to follow.
    if (windowPresent === false || (windowsDesktop && windowPresent === true)) return
    commit(document.visibilityState !== 'hidden')
  })
  const subscribe = window.orbit?.window?.onPresence
  if (subscribe) subscribe((present) => noteWindowPresence(present))
  setSuspended(uiSuspended)
}
