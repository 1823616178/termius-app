// MS-RDPBCGR 2.2.11.3. The embedded client has no suppress-output API.
// Observe activation on the existing TLS bridge and leave every original byte
// untouched. Only negotiated sessions receive the optional graphics control PDU.
class FrameReader {
  private partial?: Buffer
  private skip = 0
  private disabled = false

  get atBoundary(): boolean {
    return !this.disabled && !this.partial && !this.skip
  }

  read(chunk: Buffer, visit: (packet: Buffer) => void): void {
    if (this.disabled) return
    const data = this.partial ? Buffer.concat([this.partial, chunk]) : chunk
    let pos = Math.min(this.skip, data.length)
    this.skip -= pos
    this.partial = undefined
    while (data.length - pos >= 2) {
      const tpkt = data[pos] === 3
      const longLength = (data[pos + 1]! & 0x80) !== 0
      const header = tpkt ? 4 : longLength ? 3 : 2
      if (data.length - pos < header) break
      const size = tpkt
        ? data.readUInt16BE(pos + 2)
        : longLength
          ? data.readUInt16BE(pos + 1) & 0x7fff
          : data[pos + 1]!
      if (size < header || (tpkt && data[pos + 1] !== 0)) {
        this.disabled = true
        return
      }
      if (size > data.length - pos) {
        // Fast-path graphics do not carry activation. Skip large fragmented
        // bitmaps without retaining or copying their contents on the main thread.
        if (!tpkt) {
          this.skip = size - (data.length - pos)
          return
        }
        break
      }
      if (tpkt) visit(data.subarray(pos, pos + size))
      pos += size
    }
    if (pos !== data.length) this.partial = data.subarray(pos)
  }
}

function sharePayload(packet: Buffer, mcsType: number): Buffer | undefined {
  if (packet.length < 21 || packet.readUIntBE(4, 3) !== 0x02f080 || packet[7] !== mcsType) return
  const long = (packet[13]! & 0x80) !== 0
  const start = long ? 15 : 14
  const size = long ? packet.readUInt16BE(13) & 0x7fff : packet[13]!
  if (size < 6 || start + size !== packet.length || packet.readUInt16LE(start) !== size) return
  return packet.subarray(start)
}

function displayCapabilities(share: Buffer) {
  if (share.length < 18) return
  const start = 14 + share.readUInt16LE(10)
  const end = start + share.readUInt16LE(12)
  if (end > share.length || start + 4 > end) return
  let supported = false
  let width = 0
  let height = 0
  let offset = start + 4
  for (let count = share.readUInt16LE(start); count > 0; count--) {
    if (offset + 4 > end) return
    const type = share.readUInt16LE(offset)
    const size = share.readUInt16LE(offset + 2)
    if (size < 4 || offset + size > end) return
    if (type === 1 && size >= 24) supported = share[offset + 23] !== 0
    if (type === 2 && size >= 16) {
      width = share.readUInt16LE(offset + 12)
      height = share.readUInt16LE(offset + 14)
    }
    offset += size
  }
  if (supported && width && height) return { shareId: share.readUInt32LE(6), width, height }
}

export class RdpDisplayControl {
  private readonly client = new FrameReader()
  private readonly server = new FrameReader()
  private negotiating = false
  private ready = false
  private visible = true
  private suppressed = false
  private channel = 0
  private initiator?: number
  private display?: ReturnType<typeof displayCapabilities>

  constructor(private readonly send: (packet: Buffer) => void) {}

  clientBytes(chunk: Buffer): void {
    // The first client TPKT starts MCS after CredSSP (if enabled).
    if (!this.negotiating && chunk[0] !== 3) return
    this.negotiating = true
    this.client.read(chunk, (packet) => {
      const share = sharePayload(packet, 0x64)
      if (share?.readUInt16LE(2) === 0x13 && packet.readUInt16BE(10) === this.channel) {
        const user = packet.readUInt16BE(8)
        if (user <= 65535 - 1001) this.initiator = user
      }
    })
    this.sync()
  }

  serverBytes(chunk: Buffer): void {
    if (!this.negotiating) return
    this.server.read(chunk, (packet) => {
      const share = sharePayload(packet, 0x68)
      if (!share) return
      const type = share.readUInt16LE(2)
      if (type === 0x11 || (type === 0x16 && packet.readUInt16BE(10) === this.channel)) {
        this.display = type === 0x11 ? displayCapabilities(share) : undefined
        this.channel = packet.readUInt16BE(10)
        this.initiator = undefined
        this.ready = false
        this.suppressed = false
      } else if (type === 0x17 && packet.readUInt16BE(10) === this.channel && share[14] === 0x28) {
        // Server Font Map completes activation, including desktop resize/reactivation.
        this.ready = true
      }
    })
    this.sync()
  }

  setVisible(visible: boolean): void {
    this.visible = visible
    this.sync()
  }

  private sync(): void {
    if (
      !this.ready ||
      !this.display ||
      this.initiator === undefined ||
      !this.client.atBoundary ||
      this.suppressed === !this.visible
    )
      return
    const shareLength = this.visible ? 30 : 22
    const packet = Buffer.alloc(14 + shareLength)
    packet[0] = 3
    packet.writeUInt16BE(packet.length, 2)
    packet.writeUInt32BE(0x02f08064, 4) // X.224 Data + MCS Send Data Request
    packet.writeUInt16BE(this.initiator, 8)
    packet.writeUInt16BE(this.channel, 10)
    packet[12] = 0x70
    packet[13] = shareLength
    packet.writeUInt16LE(shareLength, 14)
    packet.writeUInt16LE(0x17, 16)
    packet.writeUInt16LE(this.initiator + 1001, 18)
    packet.writeUInt32LE(this.display.shareId, 20)
    packet[25] = 1
    packet.writeUInt16LE(shareLength, 26)
    packet[28] = 0x23
    if (this.visible) {
      packet[32] = 1
      packet.writeUInt16LE(this.display.width - 1, 40)
      packet.writeUInt16LE(this.display.height - 1, 42)
    }
    this.send(packet)
    this.suppressed = !this.visible
  }
}
