import { afterEach, describe, expect, it, vi } from 'vitest'
import { terminalChannel, type ChannelPort, type TerminalAdapter } from '../../src/workers/terminal-channel'

function createHarness(options?: {
  coalesceMs?: number
  stallTimeoutMs?: number
  watchdogIntervalMs?: number
}) {
  const listeners = new Map<string, ((event: { data: unknown }) => void)[]>()
  const closeListeners: (() => void)[] = []
  const posted: unknown[] = []
  let portClosed = false

  const port: ChannelPort = {
    postMessage(message) {
      posted.push(message)
    },
    on(event, listener) {
      if (event === 'close') closeListeners.push(listener as () => void)
      else {
        const list = listeners.get(event) ?? []
        list.push(listener as (event: { data: unknown }) => void)
        listeners.set(event, list)
      }
      return port
    },
    close() {
      portClosed = true
    },
    start() {}
  }

  const written: string[] = []
  const resized: { cols: number; rows: number }[] = []
  let paused = 0
  let resumed = 0
  let adapterClosed = 0
  let channelClosed = 0

  const adapter: TerminalAdapter = {
    write(data) {
      written.push(data)
    },
    resize(cols, rows) {
      resized.push({ cols, rows })
    },
    pause() {
      paused += 1
    },
    resume() {
      resumed += 1
    },
    close() {
      adapterClosed += 1
    }
  }

  const channel = terminalChannel(
    port,
    adapter,
    () => {
      channelClosed += 1
    },
    options
  )

  return {
    channel,
    posted,
    written,
    resized,
    emit(data: unknown) {
      for (const fn of listeners.get('message') ?? []) fn({ data })
    },
    get stats() {
      return { paused, resumed, adapterClosed, channelClosed, portClosed }
    }
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('terminalChannel coalescing, flow control, and rate limits', () => {
  it('delivers idle echoes immediately and batches closely spaced output even after an ACK', () => {
    vi.useFakeTimers()
    const h = createHarness()

    h.emit({ type: 'input', data: 'a' })
    h.channel.output('a')
    expect(h.posted).toHaveLength(1)
    h.emit({ type: 'ack', sequence: 1 })

    h.channel.output('b')
    h.channel.output('c')
    expect(h.posted).toHaveLength(1)
    vi.advanceTimersByTime(8)
    expect(h.posted).toHaveLength(2)
    expect(Buffer.from((h.posted[1] as { data: Uint8Array }).data).toString()).toBe('bc')
    h.emit({ type: 'ack', sequence: 2 })
    vi.advanceTimersByTime(20)

    h.channel.output('d')
    expect(h.posted).toHaveLength(3)
    h.channel.close()
  })

  it('coalesces trailing output within 8ms and flushes immediately at 32 KiB or on finish', () => {
    vi.useFakeTimers()
    const h = createHarness()
    h.emit({ type: 'presentation', visible: true, frameRate: 60 })

    h.channel.output('first')
    h.channel.output('hello ')
    h.channel.output('world')
    expect(h.posted).toHaveLength(1)

    vi.advanceTimersByTime(8)
    expect(h.posted).toHaveLength(2)
    expect(h.posted[1]).toMatchObject({ type: 'data', sequence: 2 })
    expect(Buffer.from((h.posted[1] as { data: Uint8Array }).data).toString()).toBe('hello world')

    // Large chunk >= 32768 bytes flushes synchronously without waiting 8ms
    h.channel.output('x'.repeat(32768))
    expect(h.posted).toHaveLength(3)

    // Buffered small chunk flushes before finish state event
    h.channel.output('tail')
    expect(h.posted).toHaveLength(3)
    h.channel.finish({ type: 'state', state: 'exited', exitCode: 0, message: 'done' })
    expect(h.posted).toHaveLength(5)
    expect(h.posted[3]).toMatchObject({ type: 'data', sequence: 4 })
    expect(h.posted[4]).toMatchObject({ type: 'state', state: 'exited' })

    // Not closed yet until all unacked sequences are acknowledged in order
    expect(h.stats.channelClosed).toBe(0)
    h.emit({ type: 'ack', sequence: 1 })
    h.emit({ type: 'ack', sequence: 2 })
    h.emit({ type: 'ack', sequence: 3 })
    h.emit({ type: 'ack', sequence: 4 })
    expect(h.stats.channelClosed).toBe(1)
  })

  it('shortens the worker batching window when a live session switches to 150 FPS', () => {
    vi.useFakeTimers()
    const h = createHarness()
    h.emit({ type: 'presentation', visible: true, frameRate: 30 })
    h.channel.output('a')
    h.channel.output('b')
    vi.advanceTimersByTime(10)
    expect(h.posted).toHaveLength(1)
    h.emit({ type: 'presentation', visible: true, frameRate: 150 })
    expect(h.posted).toHaveLength(2)
    h.channel.output('c')
    vi.advanceTimersByTime(2)
    expect(h.posted).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(h.posted).toHaveLength(3)
    h.channel.close()
  })

  it('resets stall timer on ACK progress while paused and closes on real stall', () => {
    vi.useFakeTimers()
    const h = createHarness({ coalesceMs: 0, stallTimeoutMs: 1000, watchdogIntervalMs: 250 })

    // 1 MiB threshold triggers pause across 32 KiB chunks (33 chunks > 1 MiB)
    for (let i = 0; i < 33; i += 1) {
      h.channel.output(Buffer.alloc(32768, 65))
    }
    expect(h.stats.paused).toBe(1)

    // Advance 750ms, then send one progressive ACK -> resets stalledAt
    vi.advanceTimersByTime(750)
    h.emit({ type: 'ack', sequence: 1 })
    vi.advanceTimersByTime(500)
    expect(h.stats.channelClosed).toBe(0)

    // Out-of-order future ACK grants no credit; sequential ACKs drain below low-water (256 KiB) -> resumes
    h.emit({ type: 'ack', sequence: 28 })
    expect(h.stats.resumed).toBe(0)
    for (let seq = 2; seq <= 25; seq += 1) {
      h.emit({ type: 'ack', sequence: seq })
    }
    expect(h.stats.resumed).toBe(1)

    // Pause again and stall with no ACKs past timeout -> closes with error
    for (let i = 0; i < 33; i += 1) {
      h.channel.output(Buffer.alloc(32768, 66))
    }
    expect(h.stats.paused).toBe(2)
    vi.advanceTimersByTime(1250)
    expect(h.stats.channelClosed).toBe(1)
    expect(h.posted.at(-1)).toMatchObject({ type: 'state', state: 'error' })
  })

  it('drains hidden sessions with bounded in-flight IPC while keeping stall watchdog paused', () => {
    vi.useFakeTimers()
    const h = createHarness({ coalesceMs: 0 })
    h.emit({ type: 'presentation', visible: false })
    h.channel.output(Buffer.alloc(1024 * 1024))
    // Hidden sessions still send up to 64 KiB in-flight so the renderer can silently digest
    // output without stalling background tasks, while preserving sessions if ACKs pause in sleep.
    expect(h.posted).toHaveLength(2)
    vi.advanceTimersByTime(90_000)
    expect(h.stats).toMatchObject({ paused: 1, resumed: 0, channelClosed: 0 })

    // ACKs received while still hidden drain the held buffer and resume upstream reads.
    for (let seq = 1; seq <= 24; seq++) h.emit({ type: 'ack', sequence: seq })
    expect(h.stats.resumed).toBe(1)

    // Ending while hidden waits safely across long suspensions until all chunks are acknowledged.
    h.channel.finish({ type: 'state', state: 'exited' })
    vi.advanceTimersByTime(90_000)
    expect(h.stats.channelClosed).toBe(0)
    h.emit({ type: 'presentation', visible: true })
    h.emit({ type: 'input', data: 'echo alive' })
    expect(h.written).toEqual(['echo alive'])
    for (let seq = 25; seq <= 32; seq++) h.emit({ type: 'ack', sequence: seq })
    expect(h.stats.channelClosed).toBe(1)
    expect(h.posted.filter((event) => (event as { type: string }).type === 'data')).toHaveLength(32)
  })

  it('coalesces small background bursts at low frequency and flushes immediately on restore', () => {
    vi.useFakeTimers()
    const h = createHarness()
    h.emit({ type: 'presentation', visible: false, frameRate: 150 })

    h.channel.output('line1\n')
    h.channel.output('line2\n')
    expect(h.posted).toHaveLength(0)

    vi.advanceTimersByTime(99)
    expect(h.posted).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(h.posted).toHaveLength(1)
    expect(Buffer.from((h.posted[0] as { data: Uint8Array }).data).toString()).toBe('line1\nline2\n')
    h.emit({ type: 'ack', sequence: 1 })

    // Returning to foreground immediately flushes any coalesced tail without waiting 100ms.
    h.channel.output('tail')
    expect(h.posted).toHaveLength(1)
    h.emit({ type: 'presentation', visible: true, frameRate: 150 })
    expect(h.posted).toHaveLength(2)
    expect(Buffer.from((h.posted[1] as { data: Uint8Array }).data).toString()).toBe('tail')
    h.channel.close()
  })

  it('closes stalled ending sessions after drain timeout', () => {
    vi.useFakeTimers()
    const h = createHarness({ coalesceMs: 0, stallTimeoutMs: 1000, watchdogIntervalMs: 250 })

    h.channel.output('pending-output')
    h.channel.finish({ type: 'state', state: 'exited', exitCode: 0, message: 'exit 0' })
    expect(h.stats.channelClosed).toBe(0)

    vi.advanceTimersByTime(1250)
    expect(h.stats.channelClosed).toBe(1)
  })

  it('enforces UTF-8 byte rate limit on input rather than UTF-16 code units', () => {
    vi.useFakeTimers()
    const h = createHarness()

    // '中' is 1 UTF-16 code unit but 3 UTF-8 bytes.
    // 17477 chars = 52431 bytes (< 65536 char schema cap), 20 messages = 1,048,620 bytes > 1 MiB/sec
    const chunk = '中'.repeat(17477)
    for (let i = 0; i < 20; i += 1) {
      h.emit({ type: 'input', data: chunk })
    }
    expect(h.written).toHaveLength(19)
    expect(h.stats.channelClosed).toBe(1)
    expect(h.posted.at(-1)).toMatchObject({
      type: 'state',
      state: 'error',
      message: '输入超过速率限制，会话已停止。'
    })
  })

  it('caps in-flight IPC bursts to 64 KiB and defers resizes while paused', () => {
    vi.useFakeTimers()
    const h = createHarness({ coalesceMs: 0 })

    // Simulate a 2 MiB synchronous burst (e.g. ssh2/ConPTY resume after tray wake)
    h.channel.output(Buffer.alloc(2 * 1024 * 1024, 65))
    expect(h.posted).toHaveLength(2)
    expect(h.stats.paused).toBe(1)

    // Resizes while the output pipe is paused must wait until resume to avoid ConPTY deadlock.
    h.emit({ type: 'resize', cols: 100, rows: 30 })
    h.emit({ type: 'resize', cols: 140, rows: 42 })
    expect(h.resized).toEqual([])

    // Drain enough ACKs to cross lowWater (256 KiB): 64 chunks total -> 56 ACKs leave 256 KiB
    for (let seq = 1; seq <= 56; seq += 1) {
      h.emit({ type: 'ack', sequence: seq })
    }
    expect(h.stats.resumed).toBe(1)
    expect(h.resized).toEqual([{ cols: 140, rows: 42 }])

    // Immediate resize once resumed
    h.emit({ type: 'resize', cols: 120, rows: 36 })
    expect(h.resized).toEqual([
      { cols: 140, rows: 42 },
      { cols: 120, rows: 36 }
    ])
    h.channel.close()
  })
})
