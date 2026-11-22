import { DEFAULT_TERMINAL_FRAME_RATE, OutputWindow } from '../shared/flow-control'
import { MAX_INPUT_BYTES_PER_SEC, terminalInputSchema, type TerminalEvent } from '../shared/contracts'

// Leave at least half of the output interval for IPC, parsing and paint.
const batchDelayMs = (frameRate: number) => Math.floor(500 / frameRate)
const CHUNK_BYTES = 32768
const STALL_TIMEOUT_MS = 30_000

export interface ChannelPort {
  postMessage(message: unknown): void
  on(event: 'message', listener: (event: { data: unknown }) => void): unknown
  on(event: 'close', listener: () => void): unknown
  close(): void
  start(): void
}

export interface TerminalAdapter {
  write(data: string): void
  resize(cols: number, rows: number): void
  pause(): void
  resume(): void
  close(): void
}

export function terminalChannel(
  port: ChannelPort,
  adapter: TerminalAdapter,
  onClose: () => void,
  options: { coalesceMs?: number; stallTimeoutMs?: number; watchdogIntervalMs?: number } = {}
) {
  let coalesceMs = options.coalesceMs ?? batchDelayMs(DEFAULT_TERMINAL_FRAME_RATE)
  const stallTimeoutMs = options.stallTimeoutMs ?? STALL_TIMEOUT_MS
  const watchdogIntervalMs = options.watchdogIntervalMs ?? 5000
  const flow = new OutputWindow()
  let paused = false
  let visible = true
  let closed = false
  let ending = false
  let finalState: Extract<TerminalEvent, { type: 'state' }> | undefined
  let pendingChunks: Buffer[] = []
  let pendingBytes = 0
  const held: Buffer[] = []
  let heldBytes = 0
  let lastFlushAt = -Infinity
  let flushTimer: NodeJS.Timeout | undefined
  let inputBytes = 0
  let inputStart = Date.now()
  let stalledAt = 0
  let endingAt = 0

  const send = (event: TerminalEvent) => {
    if (closed) return
    try {
      port.postMessage(event)
    } catch {
      close()
    }
  }

  const clearPending = () => {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = undefined
    }
    pendingChunks = []
    pendingBytes = 0
  }

  const close = () => {
    if (closed) return
    closed = true
    clearPending()
    held.length = 0
    heldBytes = 0
    clearInterval(watchdog)
    adapter.close()
    port.close()
    onClose()
  }

  const buffered = () => flow.bytes + heldBytes + pendingBytes

  const updateBackpressure = () => {
    if (closed) return
    if (!paused && buffered() >= flow.highWater) {
      paused = true
      stalledAt = Date.now()
      adapter.pause()
    } else if (paused && buffered() <= flow.lowWater) {
      paused = false
      stalledAt = 0
      adapter.resume()
    }
  }

  const postChunk = (chunk: Buffer) => {
    const sequence = flow.push(chunk.length)
    send({ type: 'data', sequence, data: new Uint8Array(chunk) })
  }

  const drainHeld = () => {
    while (visible && held.length && flow.bytes < 2 * CHUNK_BYTES) {
      const chunk = held.shift()!
      heldBytes -= chunk.length
      postChunk(chunk)
    }
    if (finalState && !heldBytes && !pendingBytes) {
      send(finalState)
      finalState = undefined
    }
  }

  const stopOverflow = () => {
    send({
      type: 'state',
      state: 'error',
      message: '输出超过 16 MiB 缓冲上限，已停止会话；输出可能不完整。'
    })
    close()
  }

  const flush = () => {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = undefined
    }
    if (closed) return
    if (pendingBytes) {
      lastFlushAt = performance.now()
      const bytes =
        pendingChunks.length === 1 ? pendingChunks[0]! : Buffer.concat(pendingChunks, pendingBytes)
      pendingChunks = []
      pendingBytes = 0
      for (let offset = 0; !closed && offset < bytes.length; offset += CHUNK_BYTES) {
        const chunk = bytes.subarray(offset, offset + CHUNK_BYTES)
        if (visible && !held.length) postChunk(chunk)
        else {
          held.push(chunk)
          heldBytes += chunk.length
        }
      }
    }
    drainHeld()
    updateBackpressure()
  }

  const watchdog = setInterval(() => {
    if (!visible) return
    const now = Date.now()
    if (paused && stalledAt && now - stalledAt > stallTimeoutMs) {
      send({
        type: 'state',
        state: 'error',
        message: '终端超过 30 秒未确认输出，已停止会话以防缓冲无限增长。'
      })
      close()
    } else if (ending && flow.bytes > 0 && endingAt && now - endingAt > stallTimeoutMs) {
      close()
    }
  }, watchdogIntervalMs)

  port.on('message', ({ data }) => {
    const parsed = terminalInputSchema.safeParse(data)
    if (!parsed.success || closed) return
    const message = parsed.data
    try {
      if (message.type === 'input') {
        const now = Date.now()
        if (now - inputStart > 1000) {
          inputBytes = 0
          inputStart = now
        }
        inputBytes += Buffer.byteLength(message.data)
        if (inputBytes > MAX_INPUT_BYTES_PER_SEC) {
          send({ type: 'state', state: 'error', message: '输入超过速率限制，会话已停止。' })
          close()
          return
        }
        adapter.write(message.data)
      } else if (message.type === 'resize') {
        adapter.resize(message.cols, message.rows)
      } else if (message.type === 'close') {
        close()
      } else if (message.type === 'presentation') {
        if (message.frameRate !== undefined) {
          const delay = options.coalesceMs ?? batchDelayMs(message.frameRate)
          if (coalesceMs !== delay) {
            coalesceMs = delay
            if (flushTimer && visible && message.visible) flush()
          }
        }
        if (visible !== message.visible) {
          visible = message.visible
          if (visible && paused) stalledAt = Date.now()
          if (visible && ending) endingAt = Date.now()
          if (visible) flush()
        }
      } else if (flow.ack(message.sequence)) {
        const now = Date.now()
        if (paused) stalledAt = now
        if (ending) endingAt = now
        drainHeld()
        if (ending && buffered() === 0) {
          close()
          return
        }
        updateBackpressure()
      }
    } catch {
      send({ type: 'state', state: 'error', message: '终端通道已不可用，请新建会话。' })
      close()
    }
  })

  port.on('close', close)
  port.start()

  return {
    send,
    flush,
    close,
    finish(event: Extract<TerminalEvent, { type: 'state' }>) {
      if (closed || ending) return
      ending = true
      finalState = event
      flush()
      if (closed) return
      if (buffered() === 0) close()
      else endingAt = Date.now()
    },
    output(data: Buffer | string) {
      if (closed || ending) return
      const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
      if (bytes.length === 0) return
      if (bytes.length > flow.limit - buffered()) {
        stopOverflow()
        return
      }
      pendingChunks.push(bytes)
      pendingBytes += bytes.length
      // Show the first output after an idle period immediately. Keep batching
      // bursts while the renderer is busy or the previous send was recent.
      const idle = !flushTimer && flow.bytes === 0 && performance.now() - lastFlushAt >= coalesceMs
      if ((visible && idle) || pendingBytes >= CHUNK_BYTES || coalesceMs <= 0) {
        flush()
      } else if (visible && !flushTimer) {
        flushTimer = setTimeout(flush, coalesceMs)
      } else if (!visible) {
        updateBackpressure()
      }
    }
  }
}
