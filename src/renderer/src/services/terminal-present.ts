import { DEFAULT_TERMINAL_FRAME_RATE, type TerminalFrameRate } from '../../../shared/flow-control'

const MAX_PARSE_MS = 8
const FRAME_BYTES = 64 * 1024
const MAX_SLICE_BYTES = 32 * 1024
const MIN_SLICE_BYTES = 512
const ECHO_BYTES = 1024
const STALL_FRAME_MS = 48
const SEVERE_STALL_MS = 90
const FRAME_FALLBACK_MS = 250
const BACKGROUND_INTERVAL_MS = 100
const BACKGROUND_PARSE_MS = 6
const BACKGROUND_SLICE_BYTES = 32 * 1024
const BACKGROUND_BATCH_BYTES = 64 * 1024

type OutputChunk = { sequence: number; data: Uint8Array }
type WriteSlice = (limit: number, parsed: (bytes: number) => void) => void

// All panes share one xterm write in flight so parser callbacks never pile up.
// Visible panes run on the display frame clock with priority; hidden panes
// silently digest output on a low-frequency timer with a bounded CPU budget so
// background tasks never stall on backpressure or flood the screen on wake.
export class TerminalOutputScheduler {
  private ready = new Set<WriteSlice>()
  private backgroundReady = new Set<WriteSlice>()
  private active?: WriteSlice
  private frame = 0
  private fallbackTimer: ReturnType<typeof setTimeout> | undefined
  private backgroundTimer: ReturnType<typeof setTimeout> | undefined
  private remaining = 0
  private deadline = 0
  private nextFrameAt = -Infinity
  private workScheduledAt = -Infinity
  private frameRate?: TerminalFrameRate
  private parseBudget = MAX_PARSE_MS
  private sliceBytes = MAX_SLICE_BYTES

  constructor(private readonly getFrameRate: () => TerminalFrameRate = () => DEFAULT_TERMINAL_FRAME_RATE) {}

  request(write: WriteSlice, idleEcho = false): void {
    this.backgroundReady.delete(write)
    if (this.backgroundReady.size === 0) this.clearBackgroundTimer()
    this.ready.add(write)
    if (!this.active && !this.frame && idleEcho && this.ready.size === 1) {
      this.beginFrame(performance.now())
    } else {
      this.schedule()
    }
  }

  requestBackground(write: WriteSlice): void {
    this.ready.delete(write)
    if (this.ready.size === 0) this.clearForegroundSchedule()
    this.backgroundReady.add(write)
    this.scheduleBackground()
  }

  cancel(write: WriteSlice, disposing = false): void {
    this.ready.delete(write)
    this.backgroundReady.delete(write)
    // xterm discards pending callbacks on dispose.
    if (disposing && this.active === write) this.active = undefined
    if (this.ready.size === 0) {
      this.clearForegroundSchedule()
    } else {
      this.schedule()
    }
    if (this.backgroundReady.size === 0) {
      this.clearBackgroundTimer()
    } else {
      this.scheduleBackground()
    }
  }

  private clearForegroundSchedule(): void {
    cancelAnimationFrame(this.frame)
    this.frame = 0
    clearTimeout(this.fallbackTimer)
    this.fallbackTimer = undefined
    this.workScheduledAt = -Infinity
  }

  private clearBackgroundTimer(): void {
    if (this.backgroundTimer !== undefined) {
      clearTimeout(this.backgroundTimer)
      this.backgroundTimer = undefined
    }
  }

  private schedule(): void {
    if (this.active || this.frame || !this.ready.size) return
    this.frame = requestAnimationFrame((timestamp) => {
      this.frame = 0
      clearTimeout(this.fallbackTimer)
      this.fallbackTimer = undefined
      this.beginFrame(timestamp)
    })
    if (this.fallbackTimer === undefined) {
      this.fallbackTimer = setTimeout(() => {
        this.fallbackTimer = undefined
        if (!this.frame || this.active || !this.ready.size) return
        cancelAnimationFrame(this.frame)
        this.frame = 0
        this.beginFrame(performance.now())
      }, FRAME_FALLBACK_MS)
    }
  }

  private scheduleBackground(): void {
    if (this.backgroundTimer !== undefined || !this.backgroundReady.size) return
    this.backgroundTimer = setTimeout(() => {
      this.backgroundTimer = undefined
      if (!this.backgroundReady.size) return
      if (this.active || this.ready.size) {
        // Never compete with active foreground panes; retry on the next background tick.
        this.scheduleBackground()
        return
      }
      this.beginBackgroundBatch()
    }, BACKGROUND_INTERVAL_MS)
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

  private beginBackgroundBatch(): void {
    this.remaining = BACKGROUND_BATCH_BYTES
    this.deadline = performance.now() + BACKGROUND_PARSE_MS
    this.runBackgroundSlice()
  }

  private runSlice(): void {
    if (this.active) return
    const write = this.ready.values().next().value
    if (!write) {
      if (this.backgroundReady.size) this.scheduleBackground()
      return
    }
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
      if (this.remaining && performance.now() < this.deadline && this.ready.size) {
        this.runSlice()
      } else {
        if (this.ready.size) {
          this.workScheduledAt = performance.now()
          this.schedule()
        } else if (this.backgroundReady.size) {
          this.scheduleBackground()
        }
      }
    }
    try {
      write(limit, onParsed)
    } catch {
      if (this.active === write) {
        this.active = undefined
        if (this.ready.size) this.schedule()
        else if (this.backgroundReady.size) this.scheduleBackground()
      }
    }
  }

  private runBackgroundSlice(): void {
    if (this.active) return
    if (this.ready.size) {
      this.schedule()
      if (this.backgroundReady.size) this.scheduleBackground()
      return
    }
    const write = this.backgroundReady.values().next().value
    if (!write) return
    this.backgroundReady.delete(write)
    this.active = write
    const limit = Math.min(BACKGROUND_SLICE_BYTES, this.remaining)
    const onParsed = (bytes: number) => {
      if (this.active !== write) return
      this.remaining = Math.max(0, this.remaining - bytes)
      this.active = undefined
      if (this.ready.size) {
        this.schedule()
        if (this.backgroundReady.size) this.scheduleBackground()
        return
      }
      if (this.remaining > 0 && performance.now() < this.deadline && this.backgroundReady.size) {
        this.runBackgroundSlice()
      } else if (this.backgroundReady.size) {
        this.scheduleBackground()
      }
    }
    try {
      write(limit, onParsed)
    } catch {
      if (this.active === write) {
        this.active = undefined
        if (this.ready.size) this.schedule()
        else if (this.backgroundReady.size) this.scheduleBackground()
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
  let resumeTimer: ReturnType<typeof setTimeout> | undefined
  let lastInputAt = -Infinity

  const requestSlice = (idleEcho = false) => {
    if (!queue.length) {
      scheduler.cancel(writeSlice)
      return
    }
    if (visible) {
      if (!resumeFrame) scheduler.request(writeSlice, idleEcho)
    } else {
      scheduler.requestBackground(writeSlice)
    }
  }

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
      requestSlice()
      parsed(length)
    })
  }

  return {
    noteInput() {
      lastInputAt = performance.now()
    },
    push(chunk: OutputChunk) {
      const idleEcho =
        visible &&
        !queue.length &&
        performance.now() - lastInputAt < 100 &&
        chunk.data.length <= ECHO_BYTES &&
        !chunk.data.includes(0x1b)
      lastInputAt = -Infinity
      queue.push(chunk)
      requestSlice(idleEcho)
    },
    setVisible(next: boolean) {
      if (visible === next) return
      visible = next
      cancelAnimationFrame(resumeFrame)
      resumeFrame = 0
      clearTimeout(resumeTimer)
      resumeTimer = undefined
      scheduler.cancel(writeSlice)
      if (visible) {
        if (!queue.length) return
        const kick = () => {
          cancelAnimationFrame(resumeFrame)
          resumeFrame = 0
          clearTimeout(resumeTimer)
          resumeTimer = undefined
          if (visible && queue.length) scheduler.request(writeSlice)
        }
        // Give Chromium a paint opportunity before scheduling any remaining backlog,
        // with a timer fallback if the compositor frame clock is still waking.
        resumeFrame = requestAnimationFrame(kick)
        resumeTimer = setTimeout(kick, FRAME_FALLBACK_MS)
      } else if (queue.length) {
        scheduler.requestBackground(writeSlice)
      }
    },
    dispose() {
      disposed = true
      cancelAnimationFrame(resumeFrame)
      clearTimeout(resumeTimer)
      resumeTimer = undefined
      queue.length = 0
      scheduler.cancel(writeSlice, true)
    }
  }
}
