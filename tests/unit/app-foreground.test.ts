import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
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
  const motion = vi.fn(() => foreground.isAppMotionActive())
  foreground.installAppForeground()
  foreground.onAppMotionChange(motion)

  foreground.noteWindowPresence(false)
  expect(dataset.uiSuspended).toBe('true')
  foreground.noteWindowPresence(true)
  expect(foreground.isAppForeground()).toBe(true)
  vi.advanceTimersByTime(10_000)
  expect(motion.mock.results.map(({ value }) => value)).toEqual([false])

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
  expect(dataset.uiSuspended).toBe('false')
  expect(motion.mock.results.map(({ value }) => value)).toEqual([false, true])
})
