import { createHash } from 'node:crypto'
import { isIP, Socket } from 'node:net'
import {
  connect as tlsConnect,
  type DetailedPeerCertificate,
  type PeerCertificate,
  type TLSSocket
} from 'node:tls'

export interface InspectedRdpTlsCert {
  fingerprint: string
  subject: string
  issuer: string
  validFrom: string
  validTo: string
  derChain: Buffer[]
}

/** Format an X.509 DER certificate's SHA-256 fingerprint as `AA:BB:CC:...`. */
export function formatCertSha256(der: Uint8Array): string {
  const hex = createHash('sha256').update(der).digest('hex').toUpperCase()
  const pairs: string[] = []
  for (let i = 0; i < hex.length; i += 2) {
    pairs.push(hex.slice(i, i + 2))
  }
  return pairs.join(':')
}

function formatDistinguishedName(name: PeerCertificate['subject'] | undefined): string {
  if (!name || typeof name !== 'object') return 'Unknown'
  const fields: string[] = []
  if (name.CN) fields.push(`CN=${Array.isArray(name.CN) ? name.CN.join(',') : name.CN}`)
  if (name.O) fields.push(`O=${Array.isArray(name.O) ? name.O.join(',') : name.O}`)
  if (name.OU) fields.push(`OU=${Array.isArray(name.OU) ? name.OU.join(',') : name.OU}`)
  return fields.length > 0 ? fields.join(', ') : JSON.stringify(name)
}

export function extractRdpCertInfo(socket: TLSSocket): InspectedRdpTlsCert {
  const leaf = socket.getPeerCertificate(true)
  if (!leaf || !leaf.raw || leaf.raw.length === 0) {
    throw new Error('远端 RDP 服务未提供有效的 TLS 证书')
  }
  const derChain: Buffer[] = []
  const visited = new Set<string>()
  let cursor: DetailedPeerCertificate | undefined = leaf
  while (cursor && cursor.raw && cursor.raw.length > 0 && derChain.length < 10) {
    const fp = formatCertSha256(cursor.raw)
    if (visited.has(fp)) break
    visited.add(fp)
    derChain.push(Buffer.from(cursor.raw))
    cursor = cursor.issuerCertificate
  }

  return {
    fingerprint: formatCertSha256(leaf.raw),
    subject: formatDistinguishedName(leaf.subject),
    issuer: formatDistinguishedName(leaf.issuer),
    validFrom: leaf.valid_from || '',
    validTo: leaf.valid_to || '',
    derChain
  }
}

/**
 * Standard RDP X.224 Connection Request PDU with RDP_NEG_REQ proposing
 * PROTOCOL_SSL (0x01) | PROTOCOL_HYBRID (0x02) (19 bytes total).
 */
export function buildX224NegotiationRequest(): Buffer {
  return Buffer.from([
    0x03,
    0x00,
    0x00,
    0x13, // TPKT header: version=3, reserved=0, length=19
    0x0e, // X.224 length indicator (14)
    0xe0, // X.224 Connection Request (CR)
    0x00,
    0x00, // DST-REF
    0x00,
    0x00, // SRC-REF
    0x00, // Class 0
    0x01, // RDP_NEG_REQ
    0x00, // flags
    0x08,
    0x00, // length = 8
    0x03,
    0x00,
    0x00,
    0x00 // requestedProtocols = PROTOCOL_SSL | PROTOCOL_HYBRID
  ])
}

/** Read one complete TPKT (RFC 1006 / X.224) packet from an active TCP socket. */
export function readTpktPacket(
  socket: Socket,
  timeoutMs: number
): Promise<{ packet: Buffer; trailing: Buffer }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    let done = false

    const finish = (fn: () => void) => {
      if (done) return
      done = true
      clearTimeout(timer)
      socket.removeListener('data', onData)
      socket.removeListener('error', onError)
      socket.removeListener('close', onClose)
      fn()
    }

    const onError = (err: Error) => finish(() => reject(err))
    const onClose = () => finish(() => reject(new Error('RDP 握手阶段连接被远端关闭')))

    const onData = (chunk: Buffer) => {
      chunks.push(chunk)
      total += chunk.length
      if (total < 4) return
      const joined = Buffer.concat(chunks, total)
      if (joined[0] !== 0x03) {
        finish(() => reject(new Error(`非法的 RDP TPKT 响应头: 0x${joined[0]!.toString(16)}`)))
        return
      }
      const pktLen = joined.readUInt16BE(2)
      if (pktLen < 7) {
        finish(() => reject(new Error(`非法的 TPKT 数据包长度: ${pktLen}`)))
        return
      }
      if (joined.length >= pktLen) {
        const packet = Buffer.from(joined.subarray(0, pktLen))
        const trailing = Buffer.from(joined.subarray(pktLen))
        finish(() => resolve({ packet, trailing }))
      }
    }

    const timer = setTimeout(() => {
      finish(() => reject(new Error('等待远端 RDP X.224 握手响应超时')))
    }, timeoutMs)

    socket.on('data', onData)
    socket.on('error', onError)
    socket.on('close', onClose)
  })
}

export function inspectX224NegotiationResponse(packet: Buffer): {
  tlsNegotiated: boolean
  failureCode?: number
} {
  // TPKT(4) + LI(1) + CC(1) + DST(2) + SRC(2) + CLASS(1) = 11 bytes min header
  if (packet.length < 11) {
    return { tlsNegotiated: false }
  }
  const pduCode = packet[5]! & 0xf0
  if (pduCode !== 0xd0) {
    return { tlsNegotiated: false }
  }
  if (packet.length >= 19) {
    const negType = packet[11]!
    if (negType === 0x03) {
      // TYPE_RDP_NEG_FAILURE
      const failureCode = packet.readUInt32LE(15)
      return { tlsNegotiated: false, failureCode }
    }
    if (negType === 0x02) {
      // TYPE_RDP_NEG_RSP -> selectedProtocol bitmask (0x01=SSL, 0x02=HYBRID)
      const selected = packet.readUInt32LE(15)
      return { tlsNegotiated: (selected & 0x03) !== 0 }
    }
  }
  return { tlsNegotiated: false }
}

export function connectTcpWithTimeout(host: string, port: number, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = new Socket()
    let settled = false
    const done = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.removeListener('error', onError)
      socket.removeListener('connect', onConnect)
      fn()
    }
    const onError = (err: Error) => {
      socket.destroy()
      done(() => reject(err))
    }
    const onConnect = () => done(() => resolve(socket))
    const timer = setTimeout(() => {
      socket.destroy()
      done(() => reject(new Error(`连接 ${host}:${port} 超时`)))
    }, timeoutMs)

    socket.once('error', onError)
    socket.once('connect', onConnect)
    socket.connect(port, host)
  })
}

export function upgradeSocketToTls(socket: Socket, host: string, timeoutMs: number): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    let settled = false
    const tlsSocket = tlsConnect({
      socket,
      rejectUnauthorized: false,
      ...(isIP(host) === 0 ? { servername: host } : {})
    })
    const done = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      tlsSocket.removeListener('error', onError)
      tlsSocket.removeListener('secureConnect', onSecure)
      fn()
    }
    const onError = (err: Error) => {
      tlsSocket.destroy()
      done(() => reject(err))
    }
    const onSecure = () => {
      // Pause immediately until caller attaches data pipe after TOFU verification.
      tlsSocket.pause()
      done(() => resolve(tlsSocket))
    }
    const timer = setTimeout(() => {
      tlsSocket.destroy()
      done(() => reject(new Error('RDP TLS 握手超时')))
    }, timeoutMs)

    tlsSocket.once('error', onError)
    tlsSocket.once('secureConnect', onSecure)
  })
}

export type PreflightTlsResult =
  | { status: 'cert'; cert: InspectedRdpTlsCert }
  | { status: 'no-tls'; failureCode?: number }
  | { status: 'unreachable'; message: string }

/**
 * Probes an RDP endpoint over TCP/X.224 and extracts its TLS certificate chain
 * without sending any user credentials. Used by Plan A prior to spawning external
 * OS clients so both Plan A and Plan B enforce the same `known_rdp_hosts` TOFU store.
 */
export async function preflightRdpTlsCertificate(params: {
  host: string
  port: number
  timeoutMs: number
}): Promise<PreflightTlsResult> {
  let socket: Socket | undefined
  let tlsSocket: TLSSocket | undefined
  try {
    socket = await connectTcpWithTimeout(params.host, params.port, params.timeoutMs)
    const req = buildX224NegotiationRequest()
    socket.write(req)
    const { packet } = await readTpktPacket(socket, params.timeoutMs)
    const x224 = inspectX224NegotiationResponse(packet)
    if (!x224.tlsNegotiated) {
      socket.destroy()
      return { status: 'no-tls', failureCode: x224.failureCode }
    }
    tlsSocket = await upgradeSocketToTls(socket, params.host, params.timeoutMs)
    const cert = extractRdpCertInfo(tlsSocket)
    tlsSocket.destroy()
    return { status: 'cert', cert }
  } catch (error) {
    tlsSocket?.destroy()
    socket?.destroy()
    return {
      status: 'unreachable',
      message: error instanceof Error ? error.message : '无法探测目标 RDP TLS 证书'
    }
  }
}
