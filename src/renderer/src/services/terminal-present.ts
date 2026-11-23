import { DEFAULT_TERMINAL_FRAME_RATE, type TerminalFrameRate } from '../../../shared/flow-control'

const MAX_PARSE_MS = 8
const FRAME_BYTES = 64 * 1024
const MAX_SLICE_BYTES = 32 * 1024
const MIN_SLICE_BYTES = 512
const ECHO_BYTES = 1024
const STALL_FRAME_MS = 48
const SEVERE_STALL_MS = 90

type OutputChunk = { sequence: number; data: Uint8Array }
type WriteSlice = (limit: number, parsed: (bytes: number) => void) => void

// All visible panes share one xterm write in flight. The parser callback may run
// in a later task, so charge the time through completion against the same frame.
export class TerminalOutputScheduler {
  private ready = new Set<WriteSlice>()
  private active?: WriteSlice
  private frame = 0
  private remaining = 0
  private deadline = 0
  private nextFrameAt = -Infinity
  private workScheduledAt = -Infinity
  private frameRate?: TerminalFrameRate
  private parseBudget = MAX_PARSE_MS
  private sliceBytes = MAX_SLICE_BYTES

  constructor(private readonly getFrameRate: () => TerminalFrameRate = () => DEFAULT_TERMINAL_FRAME_RATE) {}

  request(write: WriteSlice, idleEcho = false): void {
    this.ready.add(write)
    if (!this.active && !this.frame && idleEcho && this.ready.size === 1) {
      this.beginFrame(performance.now())
    } else {
      this.schedule()
    }
  }

  cancel(write: WriteSlice, disposing = false): void {
    this.ready.delete(write)
    // xterm discards pending callbacks on dispose.
    if (disposing && this.active === write) this.active = undefined
    if (this.ready.size === 0) {
      cancelAnimationFrame(this.frame)
      this.frame = 0
      this.workScheduledAt = -Infinity
    } else {
      this.schedule()
    }
  }

  private schedule(): void {
    if (this.active || this.frame || !this.ready.size) return
    this.frame = requestAnimationFrame((timestamp) => {
      this.frame = 0
      this.beginFrame(timestamp)
    })
  }

  private beginFrame(timestamp: number): void {
    const now = performance.now()
    const frameGap = this.workScheduledAt > 0 ? now - this.workScheduledAt : 0
    this.workScheduledAt = -Infinity
    const rate = this.getFrameRate()
    const interval = 1000 / rate
    if (rate !== this.frameRate) this.nextFrameAt = -Infinity
    this.frameRate = rate
    if (timestamp + 0.1 < this.nextFrameAt) {
      this.schedule()
      return
    }
    // Keep fractional intervals when the monitor refresh rate is not a multiple
    // of the target. Drop missed frames after idle instead of trying to catch up.
    this.nextFrameAt = (timestamp - this.nextFrameAt >= interval ? timestamp : this.nextFrameAt) + interval
    const stalled = frameGap >= Math.max(STALL_FRAME_MS, interval * 2.5)
    if (stalled) {
      this.sliceBytes = Math.max(MIN_SLICE_BYTES, Math.floor(this.sliceBytes / 2))
      if (frameGap >= Math.max(SEVERE_STALL_MS, interval * 4)) {
        // Yield one clean frame for user input and compositor presentation after
        // a heavy WebGL glyph rasterization / texture atlas stall. Since
        // workScheduledAt was cleared above, the next frame is guaranteed to run.
        this.schedule()
        return
      }
    }
    this.parseBudget = Math.min(MAX_PARSE_MS, interval / 2)
    this.remaining = stalled ? Math.min(FRAME_BYTES, this.sliceBytes) : FRAME_BYTES
    this.deadline = now + this.parseBudget
    this.runSlice()
  }

  private runSlice(): void {
    if (this.active) return
    const write = this.ready.values().next().value
    if (!write) return
    this.ready.delete(write)
    this.active = write
    const limit = Math.min(this.sliceBytes, this.remaining)
    const started = performance.now()
    const onParsed = (bytes: number) => {
      if (this.active !== write) return
      const elapsed = performance.now() - started
      if (elapsed >= this.parseBudget && bytes > 0) {
        const baseline = Math.min(this.sliceBytes, Math.max(MIN_SLICE_BYTES * 2, bytes))
        this.sliceBytes = Math.max(MIN_SLICE_BYTES, Math.floor(baseline / 2))
      } else if (bytes === this.sliceBytes && elapsed < this.parseBudget / 2) {
        this.sliceBytes = Math.min(MAX_SLICE_BYTES, this.sliceBytes * 2)
      }
      this.remaining = Math.max(0, this.remaining - bytes)
      this.active = undefined
      if (this.remaining && performance.now() < this.deadline) {
        this.runSlice()
      } else {
        if (this.ready.size) this.workScheduledAt = performance.now()
        this.schedule()
      }
    }
    try {
      write(limit, onParsed)
    } catch {
      if (this.active === write) {
        this.active = undefined
        this.schedule()
      }
    }
  }
}

export function createTerminalOutput(
  write: (bytes: Uint8Array, parsed: () => void) => void,
  acknowledge: (sequence: number) => void,
  visible: boolean,
  scheduler: TerminalOutputScheduler
) {
  let queue: OutputChunk[] = []
  let head = 0
  let offset = 0
  let disposed = false
  let resumeFrame = 0
  let lastInputAt = -Infinity
  const writeSlice: WriteSlice = (limit, parsed) => {
    // Give xterm adjacent updates in one write when they fit. The cursor move,
    // erase and replacement text of a TUI redraw can arrive in separate messages.
    let nextHead = head
    let nextOffset = offset
    let length = 0
    const parts: Uint8Array[] = []
    while (nextHead < queue.length && length < limit) {
      const data = queue[nextHead]!.data
      const part = data.subarray(nextOffset, nextOffset + limit - length)
      parts.push(part)
      length += part.length
      nextOffset += part.length
      if (nextOffset === data.length) {
        nextHead++
        nextOffset = 0
      }
    }
    if (!parts.length) {
      parsed(0)
      return
    }
    let bytes = parts[0]!
    if (parts.length > 1) {
      bytes = new Uint8Array(length)
      let position = 0
      for (const part of parts) {
        bytes.set(part, position)
        position += part.length
      }
    }
    write(bytes, () => {
      if (disposed) return
      for (; head < nextHead; head++) acknowledge(queue[head]!.sequence)
      offset = nextOffset
      if (head === queue.length || (head >= 256 && head * 2 >= queue.length)) {
        queue = queue.slice(head)
        head = 0
      }
      if (visible && !resumeFrame && queue.length) scheduler.request(writeSlice)
      else scheduler.cancel(writeSlice)
      parsed(length)
    })
  }

  return {
    noteInput() {
      lastInputAt = performance.now()
    },
    push(chunk: OutputChunk) {
      const idleEcho =
        !queue.length &&
        performance.now() - lastInputAt < 100 &&
        chunk.data.length <= ECHO_BYTES &&
        !chunk.data.includes(0x1b)
      lastInputAt = -Infinity
      queue.push(chunk)
      if (visible && !resumeFrame) scheduler.request(writeSlice, idleEcho)
    },
    setVisible(next: boolean) {
      if (visible === next) return
      visible = next
      cancelAnimationFrame(resumeFrame)
      resumeFrame = 0
      scheduler.cancel(writeSlice)
      if (visible) {
        // Give Chromium a paint opportunity before scheduling the backlog.
        resumeFrame = requestAnimationFrame(() => {
          resumeFrame = 0
          if (queue.length) scheduler.request(writeSlice)
        })
      }
    },
    dispose() {
      disposed = true
      cancelAnimationFrame(resumeFrame)
      queue.length = 0
      scheduler.cancel(writeSlice, true)
    }
  }
}
