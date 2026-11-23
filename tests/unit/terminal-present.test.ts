import { afterEach, expect, it, vi } from 'vitest'
import {
  createTerminalOutput,
  TerminalOutputScheduler
} from '../../src/renderer/src/services/terminal-present'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function frameClock(interval = 16) {
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), interval)
  )
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
  const bytes = Uint8Array.from({ length: 65536 }, (_, i) => i % 251)
  output.push({ sequence: 1, data: bytes })
  vi.advanceTimersByTime(60000)
  expect(slices).toHaveLength(0)
  output.setVisible(true)
  vi.advanceTimersByTime(16)
  expect(slices).toHaveLength(0)
  vi.advanceTimersByTime(16)
  expect(slices[0]).toHaveLength(32768)
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
  first.noteInput()
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
  expect(sizes).toEqual([32768])
  vi.advanceTimersByTime(16)
  expect(sizes[1]).toBe(16384)
  while (callbacks.length) callbacks.shift()!()
  expect(sizes.slice(1).reduce((sum, size) => sum + size, 0)).toBe(64 * 1024)
  output.dispose()
})

it('writes adjacent erase and replacement messages together and acknowledges them after parsing', () => {
  frameClock()
  const write = vi.fn((_bytes: Uint8Array, _done: () => void) => {})
  const ack = vi.fn()
  const output = createTerminalOutput(write, ack, true, new TerminalOutputScheduler())
  const encoder = new TextEncoder()
  output.noteInput()
  output.push({ sequence: 1, data: encoder.encode('\x1b[2K\r') })
  output.push({ sequence: 2, data: encoder.encode('新的一行') })
  expect(write).not.toHaveBeenCalled()
  vi.advanceTimersByTime(16)
  expect(write).toHaveBeenCalledTimes(1)
  const [bytes, parsed] = write.mock.calls[0]!
  expect(new TextDecoder().decode(bytes)).toBe('\x1b[2K\r新的一行')
  expect(ack).not.toHaveBeenCalled()
  parsed()
  expect(ack.mock.calls).toEqual([[1], [2]])
})

it('paces continuous output on a fast display and applies a live change from 30 to 150 FPS', () => {
  frameClock(4)
  let rate: 30 | 150 = 30
  const write = vi.fn((_bytes: Uint8Array, parsed: () => void) => parsed())
  const output = createTerminalOutput(write, vi.fn(), true, new TerminalOutputScheduler(() => rate))
  let sequence = 0
  const stream = setInterval(() => output.push({ sequence: ++sequence, data: Uint8Array.of(65) }), 1)
  vi.advanceTimersByTime(1000)
  expect(write.mock.calls.length).toBe(30)
  rate = 150
  write.mockClear()
  vi.advanceTimersByTime(1000)
  expect(write.mock.calls.length).toBe(150)
  clearInterval(stream)
  output.dispose()
  expect(vi.getTimerCount()).toBe(0)
})

it('yields a clean paint frame and shrinks slice size after a heavy render stall', () => {
  vi.useFakeTimers()
  const frameQueue: FrameRequestCallback[] = []
  let nextId = 0
  const handles = new Map<number, FrameRequestCallback>()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++nextId
    handles.set(id, callback)
    frameQueue.push(callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    handles.delete(id)
  })
  const runNextFrame = (deltaMs: number) => {
    vi.advanceTimersByTime(deltaMs)
    const cb = frameQueue.shift()
    if (!cb) return
    for (const [id, fn] of handles) {
      if (fn === cb) {
        handles.delete(id)
        cb(performance.now())
        return
      }
    }
  }

  const sizes: number[] = []
  const output = createTerminalOutput(
    (bytes, done) => {
      sizes.push(bytes.length)
      done()
    },
    vi.fn(),
    true,
    new TerminalOutputScheduler(() => 150)
  )
  output.push({ sequence: 1, data: new Uint8Array(128 * 1024) })
  // First normal frame parses 64 KiB (2 x 32 KiB)
  runNextFrame(16)
  expect(sizes).toEqual([32768, 32768])

  // Simulate a 140ms WebGL TextureAtlas render stall before the next rAF fires:
  // scheduler must halve slice size and yield one clean frame with zero writes.
  runNextFrame(140)
  expect(sizes).toEqual([32768, 32768])

  // Next clean frame resumes with the halved 16 KiB slice.
  runNextFrame(16)
  expect(sizes[2]).toBe(16384)
  output.dispose()
})

it('recovers scheduler state if a terminal write throws synchronously', () => {
  frameClock()
  const scheduler = new TerminalOutputScheduler()
  let shouldThrow = true
  const healthyWrites: Uint8Array[] = []
  const broken = createTerminalOutput(
    (_bytes, done) => {
      if (shouldThrow) {
        shouldThrow = false
        throw new Error('simulated xterm failure')
      }
      done()
    },
    vi.fn(),
    true,
    scheduler
  )
  const healthy = createTerminalOutput(
    (bytes, done) => {
      healthyWrites.push(bytes)
      done()
    },
    vi.fn(),
    true,
    scheduler
  )
  broken.push({ sequence: 1, data: Uint8Array.of(65) })
  healthy.push({ sequence: 1, data: Uint8Array.of(66) })
  vi.advanceTimersByTime(16)
  vi.advanceTimersByTime(16)
  expect(healthyWrites).toEqual([Uint8Array.of(66)])
  broken.dispose()
  healthy.dispose()
})
