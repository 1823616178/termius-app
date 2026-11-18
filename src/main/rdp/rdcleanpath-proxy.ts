import type { AddressInfo, Socket } from 'node:net'
import type { TLSSocket } from 'node:tls'
import { WebSocketServer, type WebSocket } from 'ws'
import {
  decodeRDCleanPathRequest,
  encodeRDCleanPathError,
  encodeRDCleanPathResponse,
  RDCLEANPATH_ERR
} from './asn1-der'
import {
  connectTcpWithTimeout,
  extractRdpCertInfo,
  inspectX224NegotiationResponse,
  readTpktPacket,
  upgradeSocketToTls,
  type InspectedRdpTlsCert
} from './tls-preflight'
import type { RdpCertPolicy } from '../../shared/rdp'

export interface RegisteredEmbeddedSession {
  sessionId: string
  ownerWindowId: number
  host: string
  port: number
  certPolicy: RdpCertPolicy
  connectTimeoutMs: number
  expiresAt: number
}

export type VerifyCertHandler = (params: {
  sessionId: string
  ownerWindowId: number
  host: string
  port: number
  certPolicy: RdpCertPolicy
  cert: InspectedRdpTlsCert
}) => Promise<boolean>

export interface ProxySessionHooks {
  verifyCertificate: VerifyCertHandler
  onSessionState?: (
    sessionId: string,
    ownerWindowId: number,
    status: 'active' | 'exited' | 'error',
    message?: string
  ) => void
}

function sendErrorFrame(
  ws: WebSocket,
  errorCode: number,
  extra?: { httpStatusCode?: number; tlsAlertCode?: number; x224?: Buffer }
): void {
  if (ws.readyState !== ws.OPEN) return
  try {
    ws.send(
      encodeRDCleanPathError({
        errorCode,
        httpStatusCode: extra?.httpStatusCode,
        tlsAlertCode: extra?.tlsAlertCode,
        x224ConnectionResponse: extra?.x224
      })
    )
  } catch {
    /* ignore closing socket */
  }
}

export class RdcPathProxyServer {
  private server: WebSocketServer | null = null
  private port: number | null = null
  private startPromise: Promise<number> | null = null
  private readonly tokens = new Map<string, RegisteredEmbeddedSession>()
  private readonly activeSockets = new Map<string, { ws: WebSocket; tls?: TLSSocket; tcp?: Socket }>()

  constructor(private readonly hooks: ProxySessionHooks) {}

  getPort(): number | null {
    return this.port
  }

  async ensureStarted(): Promise<number> {
    if (this.port !== null && this.server) return this.port
    if (this.startPromise) return this.startPromise

    this.startPromise = new Promise<number>((resolve, reject) => {
      const wss = new WebSocketServer({
        host: '127.0.0.1',
        port: 0,
        perMessageDeflate: false,
        maxPayload: 16 * 1024 * 1024
      })

      wss.once('error', (err) => {
        if (this.port === null) {
          this.startPromise = null
          reject(err)
        }
      })

      wss.once('listening', () => {
        const addr = wss.address() as AddressInfo | null
        if (!addr || typeof addr.port !== 'number') {
          this.startPromise = null
          reject(new Error('本地 RDCleanPath 代理绑定端口失败'))
          return
        }
        this.server = wss
        this.port = addr.port
        wss.on('connection', (ws) => this.handleConnection(ws))
        resolve(addr.port)
      })
    })

    return this.startPromise
  }

  registerToken(token: string, spec: RegisteredEmbeddedSession): void {
    this.tokens.set(token, spec)
  }

  closeSession(sessionId: string): void {
    for (const [token, spec] of this.tokens) {
      if (spec.sessionId === sessionId) this.tokens.delete(token)
    }
    const active = this.activeSockets.get(sessionId)
    if (active) {
      this.activeSockets.delete(sessionId)
      try {
        active.tls?.destroy()
      } catch {}
      try {
        active.tcp?.destroy()
      } catch {}
      try {
        active.ws.close(1000, 'Session closed')
      } catch {}
    }
  }

  closeWindowSessions(ownerWindowId: number): void {
    const ids = new Set<string>()
    for (const spec of this.tokens.values()) {
      if (spec.ownerWindowId === ownerWindowId) ids.add(spec.sessionId)
    }
    for (const sid of ids) this.closeSession(sid)
  }

  async shutdown(): Promise<void> {
    for (const sid of [...this.activeSockets.keys()]) this.closeSession(sid)
    this.tokens.clear()
    const wss = this.server
    this.server = null
    this.port = null
    this.startPromise = null
    if (!wss) return
    await new Promise<void>((resolve) => {
      wss.close(() => resolve())
    })
  }

  private handleConnection(ws: WebSocket): void {
    let stage: 'await-rdcleanpath' | 'bridging' | 'closed' = 'await-rdcleanpath'
    let currentSessionId: string | undefined
    let currentOwnerId: number | undefined
    let tcpSocket: Socket | undefined
    let tlsSocket: TLSSocket | undefined

    const cleanup = (notifyExit: boolean, message?: string) => {
      if (stage === 'closed') return
      stage = 'closed'
      if (currentSessionId) this.activeSockets.delete(currentSessionId)
      try {
        tlsSocket?.destroy()
      } catch {}
      try {
        tcpSocket?.destroy()
      } catch {}
      try {
        if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close()
      } catch {}
      if (notifyExit && currentSessionId && currentOwnerId !== undefined) {
        this.hooks.onSessionState?.(currentSessionId, currentOwnerId, message ? 'error' : 'exited', message)
      }
    }

    ws.on('close', () => cleanup(stage === 'bridging'))
    ws.on('error', (err) => cleanup(stage === 'bridging', err.message))

    ws.on('message', (rawData, isBinary) => {
      const buf = Buffer.isBuffer(rawData)
        ? rawData
        : Array.isArray(rawData)
          ? Buffer.concat(rawData)
          : Buffer.from(rawData)

      if (stage === 'closed') return
      if (stage === 'bridging') {
        if (isBinary && tlsSocket && !tlsSocket.destroyed) {
          tlsSocket.write(buf)
        }
        return
      }

      // First message must be ASN.1 DER RDCleanPathRequest.
      void (async () => {
        try {
          const req = decodeRDCleanPathRequest(buf)
          const spec = req.proxyAuth ? this.tokens.get(req.proxyAuth) : undefined
          if (!spec || spec.expiresAt < Date.now()) {
            sendErrorFrame(ws, RDCLEANPATH_ERR.REVOKED, { httpStatusCode: 401 })
            cleanup(false)
            return
          }
          // Single-use token: consume immediately.
          this.tokens.delete(req.proxyAuth!)
          currentSessionId = spec.sessionId
          currentOwnerId = spec.ownerWindowId
          this.activeSockets.set(spec.sessionId, { ws })

          if (!req.x224ConnectionPdu || req.x224ConnectionPdu.length === 0) {
            sendErrorFrame(ws, RDCLEANPATH_ERR.GENERAL)
            cleanup(true, '缺少 X.224 握手请求负载')
            return
          }

          try {
            tcpSocket = await connectTcpWithTimeout(spec.host, spec.port, spec.connectTimeoutMs)
          } catch (connErr) {
            const msg = connErr instanceof Error ? connErr.message : '无法连接目标 RDP 端口'
            sendErrorFrame(ws, RDCLEANPATH_ERR.TARGET_UNREACHABLE)
            cleanup(true, msg)
            return
          }
          this.activeSockets.set(spec.sessionId, { ws, tcp: tcpSocket })

          tcpSocket.write(req.x224ConnectionPdu)
          const { packet: x224Resp } = await readTpktPacket(tcpSocket, spec.connectTimeoutMs)
          const parsedNeg = inspectX224NegotiationResponse(x224Resp)
          if (!parsedNeg.tlsNegotiated) {
            sendErrorFrame(ws, RDCLEANPATH_ERR.NEGOTIATION, { x224: x224Resp })
            cleanup(true, '远端 RDP 服务器拒绝了 TLS / CredSSP 安全协商')
            return
          }

          try {
            tlsSocket = await upgradeSocketToTls(tcpSocket, spec.host, spec.connectTimeoutMs)
          } catch (tlsErr) {
            sendErrorFrame(ws, RDCLEANPATH_ERR.TLS_HANDSHAKE_FAILED, { tlsAlertCode: 40 })
            cleanup(true, tlsErr instanceof Error ? tlsErr.message : 'RDP TLS 握手失败')
            return
          }
          this.activeSockets.set(spec.sessionId, { ws, tcp: tcpSocket, tls: tlsSocket })

          const certInfo = extractRdpCertInfo(tlsSocket)
          const accepted = await this.hooks.verifyCertificate({
            sessionId: spec.sessionId,
            ownerWindowId: spec.ownerWindowId,
            host: spec.host,
            port: spec.port,
            certPolicy: spec.certPolicy,
            cert: certInfo
          })

          if (!accepted || stage !== 'await-rdcleanpath' || ws.readyState !== ws.OPEN) {
            sendErrorFrame(ws, RDCLEANPATH_ERR.TLS_HANDSHAKE_FAILED, { tlsAlertCode: 46 })
            cleanup(true, '用户拒绝信任远端 RDP 证书，已终止连接')
            return
          }

          const resolvedAddr = `${tlsSocket.remoteAddress || spec.host}:${spec.port}`
          const respFrame = encodeRDCleanPathResponse({
            x224ConnectionResponse: x224Resp,
            serverCertChain: certInfo.derChain,
            serverAddr: resolvedAddr
          })

          stage = 'bridging'
          ws.send(respFrame)

          tlsSocket.on('data', (chunk: Buffer) => {
            if (ws.readyState === ws.OPEN) ws.send(chunk)
          })
          tlsSocket.on('end', () => cleanup(true))
          tlsSocket.on('close', () => cleanup(true))
          tlsSocket.on('error', (err) => cleanup(true, err.message))
          tlsSocket.resume()

          this.hooks.onSessionState?.(spec.sessionId, spec.ownerWindowId, 'active')
        } catch (err) {
          sendErrorFrame(ws, RDCLEANPATH_ERR.GENERAL)
          cleanup(true, err instanceof Error ? err.message : 'RDCleanPath 代理失败')
        }
      })()
    })
  }
}
