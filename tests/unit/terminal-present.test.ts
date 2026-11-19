import { afterEach, expect, it, vi } from 'vitest'
import {
  createTerminalOutput,
  TerminalOutputScheduler
} from '../../src/renderer/src/services/terminal-present'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function frameClock() {
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 16))
  vi.stubGlobal('cancelAnimationFrame', clearTimeout)
}

it('keeps hidden bytes in order and acknowledges only whole parsed messages', () => {
  frameClock()
  const slices: Uint8Array[] = []
  const callbacks: (() => void)[] = []
  const ack = vi.fn()
  const output = createTerminalOutput(
    (data, done) => {
      slices.push(data)
      callbacks.push(done)
    },
    ack,
    false,
    new TerminalOutputScheduler()
  )
  const bytes = Uint8Array.from({ length: 32768 }, (_, i) => i % 251)
  output.push({ sequence: 1, data: bytes })
  vi.advanceTimersByTime(60000)
  expect(slices).toHaveLength(0)
  output.setVisible(true)
  vi.advanceTimersByTime(16)
  expect(slices).toHaveLength(0)
  vi.advanceTimersByTime(16)
  expect(slices[0]).toHaveLength(8192)
  output.setVisible(false)
  callbacks.shift()!()
  vi.advanceTimersByTime(60000)
  expect(ack).not.toHaveBeenCalled()
  output.setVisible(true)
  vi.advanceTimersByTime(32)
  while (callbacks.length) callbacks.shift()!()
  expect(Buffer.concat(slices)).toEqual(Buffer.from(bytes))
  expect(ack.mock.calls).toEqual([[1]])
})

it('shares the parser budget across panes and yields when an asynchronous parse overruns', () => {
  frameClock()
  const scheduler = new TerminalOutputScheduler()
  const completions: (() => void)[] = []
  const write = vi.fn((_bytes: Uint8Array, done: () => void) => completions.push(done))
  const first = createTerminalOutput(write, vi.fn(), true, scheduler)
  const second = createTerminalOutput(write, vi.fn(), true, scheduler)
  first.push({ sequence: 1, data: Uint8Array.of(1) })
  second.push({ sequence: 1, data: Uint8Array.of(2) })
  first.push({ sequence: 2, data: Uint8Array.of(3) })
  expect(write).toHaveBeenCalledTimes(1)
  vi.advanceTimersByTime(10)
  completions.shift()!()
  expect(write).toHaveBeenCalledTimes(1)
  vi.advanceTimersByTime(16)
  expect(write.mock.calls[1]![0]).toEqual(Uint8Array.of(2))
  second.dispose()
  vi.advanceTimersByTime(16)
  expect(write.mock.calls[2]![0]).toEqual(Uint8Array.of(3))
  completions.shift()!() // callback from disposed terminal
  completions.shift()!()
})

it('reduces the next slice after a slow parse and enforces the shared byte ceiling', () => {
  frameClock()
  const callbacks: (() => void)[] = []
  const sizes: number[] = []
  const output = createTerminalOutput(
    (data, parsed) => {
      sizes.push(data.length)
      callbacks.push(parsed)
    },
    vi.fn(),
    true,
    new TerminalOutputScheduler()
  )
  output.push({ sequence: 1, data: new Uint8Array(128 * 1024) })
  vi.advanceTimersByTime(16)
  vi.advanceTimersByTime(12)
  callbacks.shift()!()
  expect(sizes).toEqual([8192])
  vi.advanceTimersByTime(16)
  expect(sizes[1]).toBe(4096)
  while (callbacks.length) callbacks.shift()!()
  expect(sizes.slice(1).reduce((sum, size) => sum + size, 0)).toBe(64 * 1024)
  output.dispose()
})
