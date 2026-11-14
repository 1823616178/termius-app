/** Counts bytes until the terminal parser acknowledges consumption, not IPC delivery. */
export class OutputWindow {
  private sequence = 0
  private acknowledged = 0
  private pending = new Map<number, number>()
  bytes = 0
  constructor(
    readonly highWater = 1024 * 1024,
    readonly lowWater = 256 * 1024,
    readonly limit = 16 * 1024 * 1024
  ) {}
  push(size: number): number {
    if (!Number.isSafeInteger(size) || size < 0 || this.bytes + size > this.limit)
      throw new Error('OUTPUT_OVERFLOW')
    const sequence = ++this.sequence
    this.pending.set(sequence, size)
    this.bytes += size
    return sequence
  }
  ack(sequence: number): boolean {
    // Acknowledgements are ordered; forged future or skipped acknowledgements grant no credit.
    if (sequence !== this.acknowledged + 1 || !this.pending.has(sequence)) return false
    this.bytes -= this.pending.get(sequence)!
    this.pending.delete(sequence)
    this.acknowledged = sequence
    return true
  }
  get shouldPause(): boolean {
    return this.bytes >= this.highWater
  }
  get shouldResume(): boolean {
    return this.bytes <= this.lowWater
  }
}
