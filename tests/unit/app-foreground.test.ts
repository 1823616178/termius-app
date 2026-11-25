import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it('keeps a restored native window active when Chromium delivers a late hidden notification', async () => {
  vi.resetModules()
  vi.useFakeTimers()
  const doc = Object.assign(new EventTarget(), {
    visibilityState: 'visible',
    documentElement: { dataset: {} }
  })
  vi.stubGlobal('document', doc)
  vi.stubGlobal('window', {})
  vi.stubGlobal('navigator', { userAgent: 'Windows NT 10.0' })
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 16))
  vi.stubGlobal('cancelAnimationFrame', clearTimeout)
  const foreground = await import('../../src/renderer/src/services/app-foreground')
  foreground.installAppForeground()
  const changed = vi.fn()
  foreground.onAppForegroundChange(changed)
  foreground.noteWindowPresence(false)
  foreground.noteWindowPresence(true)
  doc.visibilityState = 'hidden'
  doc.dispatchEvent(new Event('visibilitychange'))
  expect(foreground.isAppForeground()).toBe(true)
  vi.advanceTimersByTime(600)
  expect(doc.documentElement.dataset).toMatchObject({ uiSuspended: 'false' })
  foreground.noteWindowPresence(false)
  doc.visibilityState = 'visible'
  doc.dispatchEvent(new Event('visibilitychange'))
  expect(foreground.isAppForeground()).toBe(false)
  expect(changed.mock.calls).toEqual([[false], [true], [false]])
})

it('keeps motion suspended until the restored window has frames and stays in the foreground', async () => {
  vi.resetModules()
  vi.useFakeTimers()
  const dataset: DOMStringMap = {}
  vi.stubGlobal(
    'document',
    Object.assign(new EventTarget(), {
      visibilityState: 'visible',
      documentElement: { dataset }
    })
  )
  vi.stubGlobal('window', {})

  let nextFrameId = 0
  const frames = new Map<number, () => void>()
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
    frames.set(++nextFrameId, callback)
    return nextFrameId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  const paint = () => {
    const callbacks = [...frames.values()]
    frames.clear()
    for (const callback of callbacks) callback()
  }

  const foreground = await import('../../src/renderer/src/services/app-foreground')
  foreground.installAppForeground()
  const updates = vi.fn()
  const first = foreground.registerMotionScene(updates)

  foreground.noteWindowPresence(false)
  expect(dataset.uiSuspended).toBe('true')
  foreground.noteWindowPresence(true)
  expect(foreground.isAppForeground()).toBe(true)
  vi.advanceTimersByTime(10_000)
  expect(first.active).toBe(false)
  expect(updates).toHaveBeenCalledTimes(1)

  paint()
  foreground.noteWindowPresence(false)
  expect(frames.size).toBe(0)
  foreground.noteWindowPresence(true)
  paint()
  paint()
  foreground.noteWindowPresence(false)
  vi.advanceTimersByTime(10_000)
  expect(dataset.uiSuspended).toBe('true')

  foreground.noteWindowPresence(true)
  paint()
  paint()
  vi.advanceTimersByTime(500)
  expect(dataset.uiSuspended).toBe('true')
  paint()
  expect(dataset.uiSuspended).toBe('false')
  expect(first.active).toBe(false)
  const removed = foreground.registerMotionScene(vi.fn())
  const second = foreground.registerMotionScene(vi.fn())
  removed.dispose()
  paint()
  expect(first.active).toBe(true)
  expect(second.active).toBe(false)
  foreground.noteWindowPresence(false)
  paint()
  expect(dataset.uiSuspended).toBe('true')
  expect(first.active).toBe(false)
  expect(second.active).toBe(false)

  foreground.noteWindowPresence(true)
  paint()
  paint()
  vi.advanceTimersByTime(500)
  paint() // styles
  paint() // first scene
  expect(first.active).toBe(true)
  expect(second.active).toBe(false)
  paint() // second scene
  expect(second.active).toBe(true)
  expect(removed.active).toBe(false)
  expect(frames.size).toBe(0)

  // A re-entrant hide triggered during scene activation must keep scenes suspended.
  let hideOnResume = false
  const reentrant = foreground.registerMotionScene(() => {
    if (hideOnResume) {
      hideOnResume = false
      foreground.noteWindowPresence(false)
    }
  })
  foreground.noteWindowPresence(false)
  hideOnResume = true
  foreground.noteWindowPresence(true)
  paint()
  paint()
  vi.advanceTimersByTime(500)
  paint() // styles
  paint() // first
  paint() // second
  paint() // reentrant triggers hide
  expect(dataset.uiSuspended).toBe('true')
  expect(first.active).toBe(false)
  expect(second.active).toBe(false)
  expect(reentrant.active).toBe(false)
  expect(frames.size).toBe(0)
  const mountedWhileHidden = foreground.registerMotionScene(vi.fn())
  expect(mountedWhileHidden.active).toBe(false)
  reentrant.dispose()
  mountedWhileHidden.dispose()
})

it('acknowledges wake paints to main process and clears uiSuspended via fallback if rAF stalls', async () => {
  vi.resetModules()
  vi.useFakeTimers()
  const dataset: DOMStringMap = {}
  const ackWake = vi.fn()
  vi.stubGlobal(
    'document',
    Object.assign(new EventTarget(), {
      visibilityState: 'visible',
      documentElement: { dataset }
    })
  )
  vi.stubGlobal('window', {
    orbit: {
      window: {
        ackWake
      }
    }
  })
  vi.stubGlobal('navigator', { userAgent: 'Windows NT 10.0' })

  let nextFrameId = 0
  const frames = new Map<number, () => void>()
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
    frames.set(++nextFrameId, callback)
    return nextFrameId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  const paint = () => {
    const callbacks = [...frames.values()]
    frames.clear()
    for (const callback of callbacks) callback()
  }

  const foreground = await import('../../src/renderer/src/services/app-foreground')
  foreground.installAppForeground()

  // Hide then wake, but cancel before rAF paints: no wake ack should fire.
  foreground.noteWindowPresence(false)
  expect(dataset.uiSuspended).toBe('true')
  foreground.noteWindowPresence(true)
  expect(ackWake).not.toHaveBeenCalled()
  foreground.noteWindowPresence(false)
  expect(frames.size).toBe(0)
  expect(ackWake).not.toHaveBeenCalled()

  // Wake while rAF is completely stalled: fallback timer clears uiSuspended after 1200ms.
  foreground.noteWindowPresence(true)
  vi.advanceTimersByTime(1199)
  expect(dataset.uiSuspended).toBe('true')
  vi.advanceTimersByTime(1)
  expect(dataset.uiSuspended).toBe('false')
  expect(ackWake).not.toHaveBeenCalled()

  // Once compositor paints a frame, wake ack is sent to main process.
  paint()
  expect(ackWake).toHaveBeenCalledTimes(1)

  // Re-sending windowPresence(true) while already foreground schedules a fresh wake ack on next rAF.
  foreground.noteWindowPresence(true)
  expect(ackWake).toHaveBeenCalledTimes(1)
  paint()
  expect(ackWake).toHaveBeenCalledTimes(2)
})
