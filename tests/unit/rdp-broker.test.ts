import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import {
  decodeRDCleanPathRequest,
  encodeRDCleanPathError,
  encodeRDCleanPathResponse,
  RDCLEANPATH_ERR,
  RDCLEANPATH_VERSION_1
} from '../../src/main/rdp/asn1-der'
import {
  buildFreeRdpArgs,
  buildMstscRdpContent,
  launchExternalRdpSession
} from '../../src/main/rdp/external-launcher'
import { probeRdpEnvironment } from '../../src/main/rdp/probe'
import { RdcPathProxyServer } from '../../src/main/rdp/rdcleanpath-proxy'
import {
  buildX224NegotiationRequest,
  formatCertSha256,
  preflightRdpTlsCertificate
} from '../../src/main/rdp/tls-preflight'
import { type RdpResolvedConfigSummary } from '../../src/shared/rdp'
import { startMockRdpTlsServer } from '../helpers/mock-rdp-tls-server'

function buildDerTestRDCleanPathRequest(params: {
  destination: string
  proxyAuth: string
  x224: Uint8Array
}): Buffer {
  const derLen = (n: number) => (n < 0x80 ? Buffer.from([n]) : Buffer.from([0x81, n]))
  const tlv = (tag: number, val: Uint8Array) =>
    Buffer.concat([Buffer.from([tag]), derLen(val.length), Buffer.from(val)])
  const ctx = (no: number, inner: Uint8Array) => tlv(0xa0 | no, inner)
  const ver = tlv(0x02, Buffer.from([0x0d, 0x3e])) // 3390
  const body = Buffer.concat([
    ctx(0, ver),
    ctx(2, tlv(0x0c, Buffer.from(params.destination, 'utf8'))),
    ctx(3, tlv(0x0c, Buffer.from(params.proxyAuth, 'utf8'))),
    ctx(6, tlv(0x04, params.x224))
  ])
  return tlv(0x30, body)
}

const resolvedSummary: RdpResolvedConfigSummary = {
  effectiveMode: 'external',
  fallbackFromExternal: false,
  width: 1440,
  height: 900,
  resolutionMode: 'fit',
  colorDepth: 32,
  qualityPreset: 'balanced',
  securityLayer: 'negotiate',
  certPolicy: 'tofu',
  enableClipboard: true,
  enableAudio: false,
  driveRedirect: 'none',
  sharedDrivePath: ''
}

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()!()
  }
})

describe('RDCleanPath ASN.1 DER codec', () => {
  it('decodes client RDCleanPathRequest and encodes valid Response & Error frames', () => {
    const x224 = buildX224NegotiationRequest()
    const rawReq = buildDerTestRDCleanPathRequest({
      destination: '10.0.0.5:3389',
      proxyAuth: 'tok-abc-123',
      x224
    })
    const decoded = decodeRDCleanPathRequest(rawReq)
    expect(decoded.version).toBe(RDCLEANPATH_VERSION_1)
    expect(decoded.destination).toBe('10.0.0.5:3389')
    expect(decoded.proxyAuth).toBe('tok-abc-123')
    expect(decoded.x224ConnectionPdu).toEqual(x224)

    const resp = encodeRDCleanPathResponse({
      x224ConnectionResponse: x224,
      serverCertChain: [Buffer.from([1, 2, 3, 4])],
      serverAddr: '10.0.0.5:3389'
    })
    expect(resp[0]).toBe(0x30)
    expect(resp.includes(Buffer.from('10.0.0.5:3389', 'utf8'))).toBe(true)

    const errBuf = encodeRDCleanPathError({
      errorCode: RDCLEANPATH_ERR.TLS_HANDSHAKE_FAILED,
      tlsAlertCode: 46
    })
    expect(errBuf[0]).toBe(0x30)
    expect(() => decodeRDCleanPathRequest(Buffer.from([0x30, 0x00]))).toThrow(/版本/)
  })
})

describe('Cross-platform RDP probe (Windows & Ubuntu X11 / Wayland)', () => {
  it('detects Windows mstsc.exe + cmdkey.exe and honors missing custom path strictly', async () => {
    const existing = new Set(['C:\\Windows\\System32\\mstsc.exe', 'C:\\Windows\\System32\\cmdkey.exe'])
    const winOk = await probeRdpEnvironment({
      platform: 'win32',
      env: { SystemRoot: 'C:\\Windows', PATH: '' },
      fileExists: async (p) => existing.has(p)
    })
    expect(winOk.schemeAAvailable).toBe(true)
    expect(winOk.schemeABinary).toBe('mstsc.exe')
    expect(winOk.schemeACmdkeyAvailable).toBe(true)
    expect(winOk.schemeBAvailable).toBe(true)

    const badCustom = await probeRdpEnvironment({
      platform: 'win32',
      customPath: 'C:\\nonexistent\\custom-rdp.exe',
      env: { SystemRoot: 'C:\\Windows', PATH: '' },
      fileExists: async (p) => existing.has(p)
    })
    expect(badCustom.schemeAAvailable).toBe(false)
    expect(badCustom.schemeAMissingReason).toContain('custom-rdp.exe')
  })

  it('prefers wlfreerdp3 on Ubuntu Wayland, xfreerdp3 on X11, and provides apt hint when absent', async () => {
    const linuxWaylandMissing = await probeRdpEnvironment({
      platform: 'linux',
      env: { XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-0', PATH: '/usr/bin' },
      fileExists: async () => false
    })
    expect(linuxWaylandMissing.displaySession).toBe('wayland')
    expect(linuxWaylandMissing.schemeAAvailable).toBe(false)
    expect(linuxWaylandMissing.schemeAInstallHint).toContain('freerdp3-wayland')

    const linuxWaylandReady = await probeRdpEnvironment({
      platform: 'linux',
      env: { XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-0', PATH: '/usr/bin' },
      fileExists: async (p) => p === '/usr/bin/wlfreerdp3' || p === '/usr/bin/xfreerdp3',
      readVersion: async () => 'This is FreeRDP version 3.5.1'
    })
    expect(linuxWaylandReady.schemeAAvailable).toBe(true)
    expect(linuxWaylandReady.schemeABinary).toBe('wlfreerdp3')
    expect(linuxWaylandReady.schemeAVersion).toContain('FreeRDP version 3.5.1')

    const linuxX11Ready = await probeRdpEnvironment({
      platform: 'linux',
      env: { XDG_SESSION_TYPE: 'x11', DISPLAY: ':0', PATH: '/usr/bin' },
      fileExists: async (p) => p === '/usr/bin/xfreerdp3',
      readVersion: async () => 'This is FreeRDP version 3.5.1'
    })
    expect(linuxX11Ready.displaySession).toBe('x11')
    expect(linuxX11Ready.schemeABinary).toBe('xfreerdp3')
  })
})

describe('Scheme A external launcher builders & lifecycle cleanup', () => {
  it('builds safe .rdp & FreeRDP arguments without leaking passwords in argv or allowing CRLF injection', () => {
    expect(() =>
      buildMstscRdpContent({
        host: '10.0.0.1\nredirectclipboard:i:0',
        port: 3389,
        username: 'u',
        domain: '',
        resolved: resolvedSummary
      })
    ).toThrow(/非法控制字符/)

    const rdpText = buildMstscRdpContent({
      host: '10.0.0.5',
      port: 3389,
      username: 'alice',
      domain: 'CORP',
      resolved: resolvedSummary
    })
    expect(rdpText).toContain('full address:s:10.0.0.5:3389')
    expect(rdpText).toContain('desktopwidth:i:1440')
    expect(rdpText).not.toContain('SecretPw')

    const args = buildFreeRdpArgs({
      host: '10.0.0.5',
      port: 3389,
      username: 'alice',
      domain: 'CORP',
      hasPassword: true,
      resolved: resolvedSummary
    })
    expect(args).toContain('/v:10.0.0.5:3389')
    expect(args).toContain('/from-stdin')
    expect(args).toContain('/dynamic-resolution')
    expect(args.join(' ')).not.toContain('/p:')
  })

  it('creates temp .rdp for mstsc, pipes password on Linux/FreeRDP, and cleans up files & child on stop()', async () => {
    const events: string[] = []
    let capturedArgs: string[] = []
    const emitter = new EventEmitter()
    const fakeChild = Object.assign(emitter, {
      pid: 42424,
      killed: false,
      exitCode: null as number | null,
      stdin: { write: () => true, end: () => {} },
      stderr: new EventEmitter(),
      kill() {
        this.killed = true
        this.exitCode = 0
        emitter.emit('exit', 0)
        return true
      }
    })

    const proc = await launchExternalRdpSession({
      sessionId: 'unit-mstsc-1',
      platform: 'win32',
      binaryPath: 'C:\\Windows\\System32\\mstsc.exe',
      host: '10.0.0.5',
      port: 3389,
      username: 'alice',
      domain: '',
      password: '',
      resolved: resolvedSummary,
      cmdkeyAvailable: false,
      onStateChange: (s) => events.push(s),
      spawnFn: ((_cmd: string, args: string[]) => {
        capturedArgs = args
        return fakeChild as never
      }) as never
    })

    expect(capturedArgs[0]).toBe(proc.tempRdpPath)
    expect(existsSync(proc.tempRdpPath!)).toBe(true)
    await proc.stop()
    expect(existsSync(proc.tempRdpPath!)).toBe(false)
    expect(events).toEqual(['active', 'exited'])
  })
})

describe('Loopback RDCleanPath proxy & TLS TOFU preflight', () => {
  it('validates single-use token, runs X.224 -> TLS -> TOFU verification -> pipes traffic, and blocks rejected certs', async () => {
    const mockRdp = await startMockRdpTlsServer('rdp-unit.test')
    cleanups.push(() => mockRdp.close())

    // 1. Preflight TLS probe returns exact leaf certificate SHA-256
    const pre = await preflightRdpTlsCertificate({
      host: '127.0.0.1',
      port: mockRdp.port,
      timeoutMs: 3000
    })
    expect(pre.status).toBe('cert')
    if (pre.status === 'cert') {
      expect(pre.cert.fingerprint).toBe(formatCertSha256(mockRdp.certDer))
    }

    // 2. Proxy enforces token and cert verification
    let allowCert = true
    const verifiedFingerprints: string[] = []
    const proxy = new RdcPathProxyServer({
      verifyCertificate: async ({ cert }) => {
        verifiedFingerprints.push(cert.fingerprint)
        return allowCert
      }
    })
    cleanups.push(() => proxy.shutdown())
    const proxyPort = await proxy.ensureStarted()

    const x224Req = buildX224NegotiationRequest()
    proxy.registerToken('valid-token-1', {
      sessionId: 'sess-1',
      ownerWindowId: 1,
      host: '127.0.0.1',
      port: mockRdp.port,
      certPolicy: 'tofu',
      connectTimeoutMs: 3000,
      expiresAt: Date.now() + 30_000
    })

    // First connection: accepted cert -> returns RDCleanPathResponse then bridges TLS bytes
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${proxyPort}/rdcleanpath`)
      ws.on('open', () => {
        ws.send(
          buildDerTestRDCleanPathRequest({
            destination: `127.0.0.1:${mockRdp.port}`,
            proxyAuth: 'valid-token-1',
            x224: x224Req
          })
        )
      })
      ws.once('message', (data: Buffer) => {
        try {
          expect(data[0]).toBe(0x30)
          expect(data.includes(mockRdp.certDer)).toBe(true)
          ws.send(Buffer.from('HELLO-CREDSSP-BYTES'))
          setTimeout(() => {
            ws.close()
            resolve()
          }, 120)
        } catch (err) {
          reject(err)
        }
      })
      ws.on('error', reject)
    })

    expect(verifiedFingerprints[0]).toBe(formatCertSha256(mockRdp.certDer))
    expect(mockRdp.receivedAppBytes()).toBeGreaterThan(0)

    // Second connection: rejected cert returns RDCleanPathErr (105 TLS_HANDSHAKE_FAILED) and sends 0 bytes upstream
    const beforeRejectBytes = mockRdp.receivedAppBytes()
    allowCert = false
    proxy.registerToken('valid-token-2', {
      sessionId: 'sess-2',
      ownerWindowId: 1,
      host: '127.0.0.1',
      port: mockRdp.port,
      certPolicy: 'tofu',
      connectTimeoutMs: 3000,
      expiresAt: Date.now() + 30_000
    })

    const errFrame = await new Promise<Buffer>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${proxyPort}/rdcleanpath`)
      ws.on('open', () => {
        ws.send(
          buildDerTestRDCleanPathRequest({
            destination: `127.0.0.1:${mockRdp.port}`,
            proxyAuth: 'valid-token-2',
            x224: x224Req
          })
        )
      })
      ws.once('message', (data: Buffer) => {
        ws.close()
        resolve(Buffer.from(data))
      })
      ws.on('error', reject)
    })

    expect(errFrame[0]).toBe(0x30)
    expect(errFrame.includes(Buffer.from([0xa1]))).toBe(true)
    expect(mockRdp.receivedAppBytes()).toBe(beforeRejectBytes)
  })
})
