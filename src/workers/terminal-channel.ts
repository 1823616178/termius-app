import { OutputWindow } from '../shared/flow-control'
import { MAX_INPUT_BYTES_PER_SEC, terminalInputSchema, type TerminalEvent } from '../shared/contracts'

const COALESCE_MS = 8
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
  const coalesceMs = options.coalesceMs ?? COALESCE_MS
  const stallTimeoutMs = options.stallTimeoutMs ?? STALL_TIMEOUT_MS
  const watchdogIntervalMs = options.watchdogIntervalMs ?? 5000
  const flow = new OutputWindow()
  let paused = false
  let closed = false
  let ending = false
  let pendingChunks: Buffer[] = []
  let pendingBytes = 0
  let lastFlushAt = -Infinity
  let flushTimer: NodeJS.Timeout | undefined
  let inputBytes = 0
  let inputStart = Date.now()
  let stalledAt = 0
  let endingAt = 0

  const send = (event: TerminalEvent) => {
    if (!closed) port.postMessage(event)
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
    clearInterval(watchdog)
    adapter.close()
    port.close()
    onClose()
  }

  const flush = () => {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = undefined
    }
    if (closed || pendingBytes === 0) return
    lastFlushAt = performance.now()
    const bytes = pendingChunks.length === 1 ? pendingChunks[0]! : Buffer.concat(pendingChunks, pendingBytes)
    pendingChunks = []
    pendingBytes = 0
    try {
      for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
        const chunk = bytes.subarray(offset, offset + CHUNK_BYTES)
        const sequence = flow.push(chunk.length)
        send({ type: 'data', sequence, data: new Uint8Array(chunk) })
      }
      if (!paused && flow.shouldPause) {
        paused = true
        stalledAt = Date.now()
        adapter.pause()
      }
    } catch {
      send({
        type: 'state',
        state: 'error',
        message: '输出超过 16 MiB 缓冲上限，已停止会话；输出可能不完整。'
      })
      close()
    }
  }

  const watchdog = setInterval(() => {
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
      } else if (flow.ack(message.sequence)) {
        const now = Date.now()
        if (paused) stalledAt = now
        if (ending) endingAt = now
        if (ending && flow.bytes === 0) {
          close()
          return
        }
        if (paused && flow.shouldResume) {
          paused = false
          stalledAt = 0
          adapter.resume()
        }
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
      flush()
      if (closed) return
      ending = true
      send(event)
      if (flow.bytes === 0) close()
      else endingAt = Date.now()
    },
    output(data: Buffer | string) {
      if (closed || ending) return
      const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
      if (bytes.length === 0) return
      pendingChunks.push(bytes)
      pendingBytes += bytes.length
      // Show the first output after an idle period immediately. Keep batching
      // bursts while the renderer is busy or the previous send was recent.
      const idle = !flushTimer && flow.bytes === 0 && performance.now() - lastFlushAt >= coalesceMs
      if (idle || pendingBytes >= CHUNK_BYTES || coalesceMs <= 0) {
        flush()
      } else if (!flushTimer) {
        flushTimer = setTimeout(flush, coalesceMs)
      }
    }
  }
}
