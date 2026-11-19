const RESUME_SETTLE_MS = 420

let documentVisible = typeof document === 'undefined' || document.visibilityState !== 'hidden'
let windowPresent = true
let foreground = documentVisible && windowPresent
const listeners = new Set<(active: boolean) => void>()
let settleTimer: ReturnType<typeof setTimeout> | undefined

function setSuspended(suspended: boolean): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.uiSuspended = suspended ? 'true' : 'false'
}

function commit(next: boolean): void {
  if (next === foreground) return
  foreground = next
  clearTimeout(settleTimer)
  if (!next) {
    setSuspended(true)
  } else {
    // Keep expensive filters and CSS motion off until the first frames after restore have painted.
    setSuspended(true)
    settleTimer = setTimeout(() => {
      settleTimer = undefined
      if (foreground) setSuspended(false)
    }, RESUME_SETTLE_MS)
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
  setSuspended(!foreground)
}
