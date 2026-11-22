const RESUME_SETTLE_MS = 500

let documentVisible = typeof document === 'undefined' || document.visibilityState !== 'hidden'
let windowPresent = true
let foreground = documentVisible && windowPresent
let motionActive = foreground
const listeners = new Set<(active: boolean) => void>()
const motionListeners = new Set<() => void>()
let resumeFrame = 0
let settleTimer: ReturnType<typeof setTimeout> | undefined

function setSuspended(suspended: boolean): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.uiSuspended = suspended ? 'true' : 'false'
}

function setMotionActive(active: boolean): void {
  if (active === motionActive) return
  motionActive = active
  setSuspended(!active)
  for (const listener of motionListeners) listener()
}

function commit(next: boolean): void {
  if (next === foreground) return
  foreground = next
  if (!next) {
    cancelAnimationFrame(resumeFrame)
    resumeFrame = 0
    clearTimeout(settleTimer)
    settleTimer = undefined
    setMotionActive(false)
  } else {
    // A window can report itself visible before Chromium is painting again.
    // Give the foreground UI a frame before starting the motion settle timer.
    resumeFrame = requestAnimationFrame(() => {
      resumeFrame = requestAnimationFrame(() => {
        resumeFrame = 0
        settleTimer = setTimeout(() => {
          settleTimer = undefined
          setMotionActive(true)
        }, RESUME_SETTLE_MS)
      })
    })
  }
  for (const listener of listeners) listener(foreground)
}

function recompute(): void {
  commit(documentVisible && windowPresent)
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

export function isAppMotionActive(): boolean {
  return motionActive
}

export function onAppMotionChange(listener: () => void): () => void {
  motionListeners.add(listener)
  return () => {
    motionListeners.delete(listener)
  }
}

export function noteWindowPresence(present: boolean): void {
  windowPresent = present
  // Trust the main-process show/hide signal. The visibility API can lag behind win.hide()
  // or stay hidden after the window is shown again.
  documentVisible = present || (typeof document !== 'undefined' && document.visibilityState !== 'hidden')
  recompute()
}

export function installAppForeground(): void {
  if (typeof document === 'undefined') return
  document.addEventListener('visibilitychange', () => {
    documentVisible = document.visibilityState !== 'hidden'
    recompute()
  })
  const subscribe = window.orbit?.window?.onPresence
  if (subscribe) subscribe((present) => noteWindowPresence(present))
  setSuspended(!motionActive)
}
