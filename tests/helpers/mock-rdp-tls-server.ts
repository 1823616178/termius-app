import { createSign, generateKeyPairSync, randomBytes } from 'node:crypto'
import { createServer, type AddressInfo } from 'node:net'
import { TLSSocket } from 'node:tls'

function derLen(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len])
  const bytes: number[] = []
  let n = len
  while (n > 0) {
    bytes.unshift(n & 0xff)
    n >>>= 8
  }
  return Buffer.from([0x80 | bytes.length, ...bytes])
}

function derTlv(tag: number, content: Uint8Array): Buffer {
  const buf = Buffer.from(content)
  return Buffer.concat([Buffer.from([tag]), derLen(buf.length), buf])
}

function derSeq(items: Uint8Array[]): Buffer {
  return derTlv(0x30, Buffer.concat(items.map((x) => Buffer.from(x))))
}

function derInt(numBytes: number[]): Buffer {
  const arr = [...numBytes]
  if (arr[0]! >= 0x80) arr.unshift(0)
  return derTlv(0x02, Buffer.from(arr))
}

function buildName(cn: string): Buffer {
  const cnOid = Buffer.from([0x06, 0x03, 0x55, 0x04, 0x03]) // 2.5.4.3
  const cnVal = derTlv(0x0c, Buffer.from(cn, 'utf8'))
  const atv = derSeq([cnOid, cnVal])
  const rdn = derTlv(0x31, atv)
  return derSeq([rdn])
}

export function createSelfSignedRdpCert(cn = 'orbit-rdp.test'): {
  certPem: string
  keyPem: string
  certDer: Buffer
} {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const spki = publicKey.export({ type: 'spki', format: 'der' })
  const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

  // sha256WithRSAEncryption: 1.2.840.113549.1.1.11 + NULL
  const sigAlg = derSeq([
    Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b]),
    Buffer.from([0x05, 0x00])
  ])
  const version = derTlv(0xa0, derInt([2])) // v3
  const serial = derInt([...randomBytes(8)].map((b, idx) => (idx === 0 ? b & 0x7f || 1 : b)))
  const issuer = buildName(cn)
  const validity = derSeq([
    derTlv(0x17, Buffer.from('260101000000Z', 'ascii')),
    derTlv(0x17, Buffer.from('350101000000Z', 'ascii'))
  ])

  const tbs = derSeq([version, serial, sigAlg, issuer, validity, issuer, spki])
  const signature = createSign('RSA-SHA256').update(tbs).sign(privateKey)
  const bitStringSig = derTlv(0x03, Buffer.concat([Buffer.from([0x00]), signature]))
  const certDer = derSeq([tbs, sigAlg, bitStringSig])

  const b64 =
    certDer
      .toString('base64')
      .match(/.{1,64}/g)
      ?.join('\n') ?? ''
  const certPem = `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`
  return { certPem, keyPem, certDer }
}

export interface MockRdpTlsServer {
  port: number
  certPem: string
  certDer: Buffer
  rotateCertificate: (cn?: string) => Buffer
  receivedAppBytes: () => number
  close: () => Promise<void>
}

export async function startMockRdpTlsServer(initialCn = 'orbit-rdp.test'): Promise<MockRdpTlsServer> {
  let current = createSelfSignedRdpCert(initialCn)
  let appBytes = 0
  const openSockets = new Set<TLSSocket>()

  const server = createServer((tcpSocket) => {
    let upgraded = false
    const chunks: Buffer[] = []
    tcpSocket.on('data', (chunk: Buffer) => {
      if (upgraded) return
      chunks.push(chunk)
      const joined = Buffer.concat(chunks)
      if (joined.length < 7) return
      if (joined[0] !== 0x03) {
        tcpSocket.destroy()
        return
      }
      const pktLen = joined.readUInt16BE(2)
      if (joined.length < pktLen) return

      upgraded = true
      tcpSocket.removeAllListeners('data')

      // Standard X.224 Connection Confirm with RDP_NEG_RSP (PROTOCOL_HYBRID = 0x02)
      tcpSocket.write(
        Buffer.from([
          0x03, 0x00, 0x00, 0x13, 0x0e, 0xd0, 0x00, 0x00, 0x12, 0x34, 0x00, 0x02, 0x00, 0x08, 0x00, 0x02,
          0x00, 0x00, 0x00
        ])
      )

      const tlsSock = new TLSSocket(tcpSocket, {
        isServer: true,
        key: current.keyPem,
        cert: current.certPem
      })
      openSockets.add(tlsSock)
      tlsSock.on('data', (appData: Buffer) => {
        appBytes += appData.length
      })
      tlsSock.on('error', () => {})
      tlsSock.on('close', () => openSockets.delete(tlsSock))
    })
    tcpSocket.on('error', () => {})
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port

  return {
    port,
    get certPem() {
      return current.certPem
    },
    get certDer() {
      return current.certDer
    },
    rotateCertificate(cn = 'rotated-rdp.test') {
      current = createSelfSignedRdpCert(cn)
      return current.certDer
    },
    receivedAppBytes: () => appBytes,
    close: async () => {
      for (const s of openSockets) s.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}
