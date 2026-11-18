/**
 * Minimal ASN.1 DER encoder/decoder strictly scoped to IronRDP's `RDCleanPathPdu` (VERSION_1 = 3390).
 *
 * Matches `crates/ironrdp-rdcleanpath/src/lib.rs` (`#[asn1(tag_mode = "EXPLICIT")]`):
 *   RDCleanPathPdu ::= SEQUENCE {
 *     version             [0] EXPLICIT INTEGER,          -- 3390
 *     error               [1] EXPLICIT RDCleanPathErr OPTIONAL,
 *     destination         [2] EXPLICIT UTF8String OPTIONAL,
 *     proxy_auth          [3] EXPLICIT UTF8String OPTIONAL,
 *     server_auth         [4] EXPLICIT UTF8String OPTIONAL,
 *     preconnection_blob  [5] EXPLICIT UTF8String OPTIONAL,
 *     x224_connection_pdu [6] EXPLICIT OCTET STRING OPTIONAL,
 *     server_cert_chain   [7] EXPLICIT SEQUENCE OF OCTET STRING OPTIONAL,
 *     server_addr         [9] EXPLICIT UTF8String OPTIONAL
 *   }
 */

export const RDCLEANPATH_VERSION_1 = 3390

export const RDCLEANPATH_ERR = {
  GENERAL: 1,
  NEGOTIATION: 2,
  EXPIRED: 100,
  NOT_YET_VALID: 101,
  REVOKED: 102,
  TARGET_UNREACHABLE: 103,
  DNS_RESOLUTION_FAILED: 104,
  TLS_HANDSHAKE_FAILED: 105
} as const

const TAG_INTEGER = 0x02
const TAG_OCTET_STRING = 0x04
const TAG_UTF8_STRING = 0x0c
const TAG_SEQUENCE = 0x30

function encodeDerLength(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len])
  const bytes: number[] = []
  let n = len
  while (n > 0) {
    bytes.unshift(n & 0xff)
    n >>>= 8
  }
  return Buffer.from([0x80 | bytes.length, ...bytes])
}

function wrapTlv(tag: number, value: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), encodeDerLength(value.length), value])
}

function wrapContextExplicit(tagNumber: number, inner: Buffer): Buffer {
  return wrapTlv(0xa0 | (tagNumber & 0x1f), inner)
}

function encodeUnsignedInteger(value: number): Buffer {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid DER unsigned integer: ${value}`)
  }
  if (value === 0) return wrapTlv(TAG_INTEGER, Buffer.from([0]))
  const bytes: number[] = []
  let n = value
  while (n > 0) {
    bytes.unshift(n & 0xff)
    n >>>= 8
  }
  if (bytes[0]! >= 0x80) bytes.unshift(0)
  return wrapTlv(TAG_INTEGER, Buffer.from(bytes))
}

function encodeUtf8String(text: string): Buffer {
  return wrapTlv(TAG_UTF8_STRING, Buffer.from(text, 'utf8'))
}

function encodeOctetString(data: Uint8Array): Buffer {
  return wrapTlv(TAG_OCTET_STRING, Buffer.from(data))
}

interface DerTlv {
  tag: number
  value: Buffer
  nextOffset: number
}

function readDerTlv(buf: Buffer, offset: number): DerTlv {
  if (offset + 2 > buf.length) throw new Error('Incomplete ASN.1 DER header')
  const tag = buf[offset]!
  const lenByte = buf[offset + 1]!
  let length = 0
  let headerEnd = offset + 2
  if ((lenByte & 0x80) === 0) {
    length = lenByte
  } else {
    const count = lenByte & 0x7f
    if (count === 0 || count > 4 || headerEnd + count > buf.length) {
      throw new Error('Unsupported ASN.1 DER length encoding')
    }
    for (let i = 0; i < count; i += 1) {
      length = (length << 8) | buf[headerEnd + i]!
    }
    headerEnd += count
  }
  if (headerEnd + length > buf.length) throw new Error('Truncated ASN.1 DER value')
  return {
    tag,
    value: buf.subarray(headerEnd, headerEnd + length),
    nextOffset: headerEnd + length
  }
}

function decodeUnsignedInteger(buf: Buffer): number {
  const tlv = readDerTlv(buf, 0)
  if (tlv.tag !== TAG_INTEGER || tlv.nextOffset !== buf.length || tlv.value.length === 0) {
    throw new Error('Expected DER INTEGER')
  }
  if ((tlv.value[0]! & 0x80) !== 0) {
    throw new Error('Expected non-negative DER INTEGER')
  }
  let out = 0
  for (const byte of tlv.value) {
    out = out * 256 + byte
  }
  return out
}

function decodeUtf8OrString(buf: Buffer): string {
  const tlv = readDerTlv(buf, 0)
  if (
    tlv.nextOffset !== buf.length ||
    (tlv.tag !== TAG_UTF8_STRING && tlv.tag !== 0x16 && tlv.tag !== 0x13)
  ) {
    throw new Error('Expected DER UTF8String')
  }
  return tlv.value.toString('utf8')
}

function decodeOctetString(buf: Buffer): Buffer {
  const tlv = readDerTlv(buf, 0)
  if (tlv.tag !== TAG_OCTET_STRING || tlv.nextOffset !== buf.length) {
    throw new Error('Expected DER OCTET STRING')
  }
  return Buffer.from(tlv.value)
}

export interface DecodedRDCleanPathRequest {
  version: number
  destination?: string
  proxyAuth?: string
  serverAuth?: string
  preconnectionBlob?: string
  x224ConnectionPdu?: Buffer
}

export function decodeRDCleanPathRequest(buf: Buffer): DecodedRDCleanPathRequest {
  const outer = readDerTlv(buf, 0)
  if (outer.tag !== TAG_SEQUENCE || outer.nextOffset !== buf.length) {
    throw new Error('RDCleanPath PDU 根节点必须是 ASN.1 SEQUENCE')
  }
  const fields = outer.value
  const decoded: DecodedRDCleanPathRequest = { version: 0 }
  let offset = 0
  let sawVersion = false

  while (offset < fields.length) {
    const field = readDerTlv(fields, offset)
    offset = field.nextOffset
    if ((field.tag & 0xe0) !== 0xa0) {
      throw new Error(`Unexpected RDCleanPath field tag: 0x${field.tag.toString(16)}`)
    }
    const tagNo = field.tag & 0x1f
    switch (tagNo) {
      case 0:
        decoded.version = decodeUnsignedInteger(field.value)
        sawVersion = true
        break
      case 2:
        decoded.destination = decodeUtf8OrString(field.value)
        break
      case 3:
        decoded.proxyAuth = decodeUtf8OrString(field.value)
        break
      case 4:
        decoded.serverAuth = decodeUtf8OrString(field.value)
        break
      case 5:
        decoded.preconnectionBlob = decodeUtf8OrString(field.value)
        break
      case 6:
        decoded.x224ConnectionPdu = decodeOctetString(field.value)
        break
      default:
        break
    }
  }

  if (!sawVersion || decoded.version !== RDCLEANPATH_VERSION_1) {
    throw new Error(`不支持的 RDCleanPath 协议版本: ${decoded.version}`)
  }
  return decoded
}

export function encodeRDCleanPathResponse(params: {
  x224ConnectionResponse?: Uint8Array
  serverCertChain: Uint8Array[]
  serverAddr: string
}): Buffer {
  const parts: Buffer[] = [wrapContextExplicit(0, encodeUnsignedInteger(RDCLEANPATH_VERSION_1))]
  if (params.x224ConnectionResponse && params.x224ConnectionResponse.length > 0) {
    parts.push(wrapContextExplicit(6, encodeOctetString(params.x224ConnectionResponse)))
  }
  const certSeq = Buffer.concat(params.serverCertChain.map((derCert) => encodeOctetString(derCert)))
  parts.push(wrapContextExplicit(7, wrapTlv(TAG_SEQUENCE, certSeq)))
  parts.push(wrapContextExplicit(9, encodeUtf8String(params.serverAddr)))
  return wrapTlv(TAG_SEQUENCE, Buffer.concat(parts))
}

export function encodeRDCleanPathError(params: {
  errorCode: number
  httpStatusCode?: number
  wsaLastError?: number
  tlsAlertCode?: number
  x224ConnectionResponse?: Uint8Array
}): Buffer {
  const errParts: Buffer[] = [wrapContextExplicit(0, encodeUnsignedInteger(params.errorCode))]
  if (params.httpStatusCode !== undefined) {
    errParts.push(wrapContextExplicit(1, encodeUnsignedInteger(params.httpStatusCode)))
  }
  if (params.wsaLastError !== undefined) {
    errParts.push(wrapContextExplicit(2, encodeUnsignedInteger(params.wsaLastError)))
  }
  if (params.tlsAlertCode !== undefined) {
    errParts.push(wrapContextExplicit(3, encodeUnsignedInteger(params.tlsAlertCode)))
  }

  const parts: Buffer[] = [
    wrapContextExplicit(0, encodeUnsignedInteger(RDCLEANPATH_VERSION_1)),
    wrapContextExplicit(1, wrapTlv(TAG_SEQUENCE, Buffer.concat(errParts)))
  ]
  if (params.x224ConnectionResponse && params.x224ConnectionResponse.length > 0) {
    parts.push(wrapContextExplicit(6, encodeOctetString(params.x224ConnectionResponse)))
  }
  return wrapTlv(TAG_SEQUENCE, Buffer.concat(parts))
}
