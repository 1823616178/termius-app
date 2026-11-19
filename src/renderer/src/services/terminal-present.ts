const FRAME_MS = 8
const FRAME_BYTES = 64 * 1024
const MAX_SLICE_BYTES = 8 * 1024
const MIN_SLICE_BYTES = 512
const ECHO_BYTES = 1024

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
  private echoArmed = true
  private sliceBytes = MAX_SLICE_BYTES

  request(write: WriteSlice, idleEcho = false): void {
    this.ready.add(write)
    if (!this.active && !this.frame && idleEcho && this.ready.size === 1 && this.echoArmed) {
      this.beginFrame()
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
    } else {
      this.schedule()
    }
  }

  private schedule(): void {
    if (this.active || this.frame || !this.ready.size) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.beginFrame()
    })
  }

  private beginFrame(): void {
    this.echoArmed = false
    requestAnimationFrame(() => {
      this.echoArmed = true
    })
    this.remaining = FRAME_BYTES
    this.deadline = performance.now() + FRAME_MS
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
    write(limit, (bytes) => {
      if (this.active !== write) return
      const elapsed = performance.now() - started
      if (bytes === this.sliceBytes) {
        if (elapsed >= FRAME_MS) this.sliceBytes = Math.max(MIN_SLICE_BYTES, this.sliceBytes / 2)
        else if (elapsed < FRAME_MS / 2) this.sliceBytes = Math.min(MAX_SLICE_BYTES, this.sliceBytes * 2)
      }
      this.remaining -= bytes
      this.active = undefined
      if (this.remaining && performance.now() < this.deadline) {
        this.runSlice()
      } else {
        this.schedule()
      }
    })
  }
}

const sharedScheduler = new TerminalOutputScheduler()

export function createTerminalOutput(
  write: (bytes: Uint8Array, parsed: () => void) => void,
  acknowledge: (sequence: number) => void,
  visible: boolean,
  scheduler = sharedScheduler
) {
  let queue: OutputChunk[] = []
  let head = 0
  let offset = 0
  let disposed = false
  let resumeFrame = 0
  const writeSlice: WriteSlice = (limit, parsed) => {
    const chunk = queue[head]!
    const end = Math.min(offset + limit, chunk.data.length)
    const slice = chunk.data.subarray(offset, end)
    write(slice, () => {
      if (disposed) return
      offset = end
      if (end === chunk.data.length) {
        head++
        if (head === queue.length || (head >= 256 && head * 2 >= queue.length)) {
          queue = queue.slice(head)
          head = 0
        }
        offset = 0
        acknowledge(chunk.sequence)
      }
      if (visible && !resumeFrame && queue.length) scheduler.request(writeSlice)
      else scheduler.cancel(writeSlice)
      parsed(slice.length)
    })
  }

  return {
    push(chunk: OutputChunk) {
      const idleEcho = !queue.length && chunk.data.length <= ECHO_BYTES
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
