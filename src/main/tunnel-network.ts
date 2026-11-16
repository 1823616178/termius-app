import { safeStorage } from 'electron'
import net from 'node:net'
import { createHash } from 'node:crypto'
import { Client as SshClient } from 'ssh2'
import type { Host, NetProbeResult, PortCheckResult, TunnelRuntimeStatus } from '../shared/contracts'
import type { SyncTunnel } from '../shared/sync'
import type { DataClient } from './data-client'
import { lookupOpenSshKnownHost } from './openssh-known-hosts'

interface ActiveTunnelEntry {
  tunnel: SyncTunnel
  server?: net.Server
  sshClient?: SshClient
  sockets: Set<net.Socket>
  status: TunnelRuntimeStatus
}

function normalizeHost(host: string): string {
  const trimmed = host.trim()
  if (!trimmed || trimmed === '0.0.0.0' || trimmed === '::') return '127.0.0.1'
  return trimmed
}

export async function probeTcpConnectivity(input: {
  host: string
  port: number
  timeoutMs?: number
}): Promise<NetProbeResult> {
  const host = input.host.trim()
  const port = input.port
  const timeoutMs = input.timeoutMs ?? 3500
  const started = performance.now()
  const checkedAt = Date.now()

  return new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false

    const finish = (reachable: boolean, message: string): void => {
      if (settled) return
      settled = true
      const latencyMs = reachable ? Math.max(1, Math.round(performance.now() - started)) : null
      socket.removeAllListeners()
      socket.destroy()
      resolve({
        host,
        port,
        reachable,
        latencyMs,
        message,
        checkedAt
      })
    }

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => {
      finish(true, `TCP 握手成功 (${Math.max(1, Math.round(performance.now() - started))} ms)`)
    })
    socket.once('timeout', () => {
      finish(false, `连接超时 (${timeoutMs} ms)`)
    })
    socket.once('error', (error: NodeJS.ErrnoException) => {
      const code = error.code ? ` (${error.code})` : ''
      finish(false, `无法建立连接${code}: ${error.message}`)
    })

    try {
      socket.connect({ host, port })
    } catch (error) {
      finish(false, error instanceof Error ? error.message : '发起 TCP 探测失败')
    }
  })
}

export class TunnelRuntimeManager {
  private readonly entries = new Map<string, ActiveTunnelEntry>()

  constructor(private readonly repository: DataClient) {}

  getActiveCount(): number {
    let count = 0
    for (const entry of this.entries.values()) {
      if (entry.status.active) count++
    }
    return count
  }

  listStatuses(tunnels: SyncTunnel[]): TunnelRuntimeStatus[] {
    return tunnels.map((tunnel) => {
      const activeEntry = this.entries.get(tunnel.id)
      if (activeEntry) {
        return {
          ...activeEntry.status,
          activeConnections: activeEntry.sockets.size
        }
      }
      return {
        tunnelId: tunnel.id,
        active: false,
        status: 'stopped',
        listenHost: tunnel.listenHost,
        listenPort: tunnel.listenPort,
        activeConnections: 0,
        message: '未运行',
        updatedAt: Date.now()
      }
    })
  }

  async checkLocalPort(input: { listenHost: string; listenPort: number }): Promise<PortCheckResult> {
    const listenHost = input.listenHost.trim() || '127.0.0.1'
    const listenPort = input.listenPort
    const checkedAt = Date.now()

    for (const entry of this.entries.values()) {
      if (
        entry.status.active &&
        entry.tunnel.listenPort === listenPort &&
        (entry.tunnel.listenHost === listenHost ||
          entry.tunnel.listenHost === '0.0.0.0' ||
          listenHost === '0.0.0.0' ||
          normalizeHost(entry.tunnel.listenHost) === normalizeHost(listenHost))
      ) {
        return {
          listenHost,
          listenPort,
          available: false,
          occupiedByOrbit: true,
          tunnelId: entry.tunnel.id,
          message: `端口 ${listenPort} 正由转发规则「${entry.tunnel.name}」监听运行中`,
          checkedAt
        }
      }
    }

    return new Promise((resolve) => {
      const server = net.createServer()
      let settled = false
      const done = (available: boolean, message: string): void => {
        if (settled) return
        settled = true
        server.removeAllListeners()
        try {
          server.close()
        } catch {
          /* Ignore close on unstarted server */
        }
        resolve({
          listenHost,
          listenPort,
          available,
          occupiedByOrbit: false,
          message,
          checkedAt
        })
      }

      server.once('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          done(false, `本地端口 ${listenHost}:${listenPort} 已被其他进程占用 (EADDRINUSE)`)
          return
        }
        if (error.code === 'EACCES') {
          done(false, `绑定端口 ${listenPort} 权限不足 (EACCES)`)
          return
        }
        done(false, `端口检测异常: ${error.message}`)
      })

      server.once('listening', () => {
        done(true, `本地端口 ${listenHost}:${listenPort} 空闲可用`)
      })

      try {
        server.listen(listenPort, listenHost)
      } catch (error) {
        done(false, error instanceof Error ? error.message : '端口检测失败')
      }
    })
  }

  async toggle(tunnel: SyncTunnel, active: boolean): Promise<void> {
    if (!active) {
      await this.stop(tunnel.id)
      return
    }
    if (this.entries.has(tunnel.id)) {
      await this.stop(tunnel.id)
    }
    if (tunnel.type === 'R') {
      await this.startRemoteForward(tunnel)
      return
    }
    await this.startLocalOrDynamicForward(tunnel)
  }

  async stop(tunnelId: string): Promise<void> {
    const entry = this.entries.get(tunnelId)
    if (!entry) return
    this.entries.delete(tunnelId)
    for (const sock of entry.sockets) {
      sock.destroy()
    }
    entry.sockets.clear()
    try {
      entry.sshClient?.end()
    } catch {
      /* Ignore cleanup error */
    }
    if (entry.server) {
      await new Promise<void>((resolve) => {
        try {
          entry.server!.close(() => resolve())
        } catch {
          resolve()
        }
      })
    }
  }

  async dispose(): Promise<void> {
    const ids = [...this.entries.keys()]
    await Promise.all(ids.map((id) => this.stop(id)))
  }

  private async connectSshForTunnel(hostId: string): Promise<{ client: SshClient; host: Host }> {
    const record = await this.repository.call<{ host: Host; secret?: Uint8Array }>('get', hostId)
    const host = record.host
    let password: string | undefined
    if (host.auth === 'password' && record.secret) {
      try {
        const dec = await safeStorage.decryptStringAsync(Buffer.from(record.secret))
        password = dec.result
      } catch {
        throw new Error(`无法解锁主机「${host.name}」的已保存密码，请确认系统 Keyring / 凭据保护已就绪。`)
      }
    }
    if (host.auth === 'password' && !password) {
      throw new Error(`主机「${host.name}」未保存密码，无法自动建立加密转发通道`)
    }
    if (host.auth === 'agent' && process.platform !== 'win32' && !process.env.SSH_AUTH_SOCK?.trim()) {
      throw new Error('未检测到 SSH_AUTH_SOCK 环境变量，无法通过 SSH Agent 建立隧道连接')
    }
    const known = await this.repository.call<{ fingerprint: string } | undefined>(
      'known',
      host.address,
      host.port
    )
    const fallbackKnown = known ?? lookupOpenSshKnownHost(host.address, host.port)

    const client = new SshClient()
    return new Promise((resolve, reject) => {
      let settled = false
      const fail = (err: Error): void => {
        if (settled) return
        settled = true
        try {
          client.end()
        } catch {
          /* Ignore */
        }
        reject(err)
      }

      client.once('ready', () => {
        if (settled) return
        settled = true
        resolve({ client, host })
      })
      client.once('error', (err) => fail(err))
      client.once('close', () => fail(new Error('SSH 隧道连接已断开')))

      client.connect({
        host: host.address,
        port: host.port,
        username: host.username,
        ...(password !== undefined
          ? { password }
          : {
              agent:
                process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : process.env.SSH_AUTH_SOCK
            }),
        keepaliveInterval: (host.keepalive ?? 30) * 1000,
        readyTimeout: 10000,
        hostVerifier: (key: Buffer) => {
          const fp = `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`
          if (!fallbackKnown) return true
          return fallbackKnown.fingerprint === fp
        }
      })
    })
  }

  private async startLocalOrDynamicForward(tunnel: SyncTunnel): Promise<void> {
    const sockets = new Set<net.Socket>()
    const server = net.createServer((clientSocket) => {
      sockets.add(clientSocket)
      clientSocket.once('close', () => {
        sockets.delete(clientSocket)
      })
      clientSocket.on('error', () => {
        sockets.delete(clientSocket)
      })

      void (async () => {
        try {
          const { client } = await this.connectSshForTunnel(tunnel.serverId)
          if (tunnel.type === 'D') {
            this.handleSocks5Socket(clientSocket, client, tunnel.listenHost, tunnel.listenPort)
          } else {
            client.forwardOut(
              clientSocket.remoteAddress || tunnel.listenHost,
              clientSocket.remotePort || tunnel.listenPort,
              tunnel.destHost,
              tunnel.destPort,
              (err, stream) => {
                if (err || !stream) {
                  client.end()
                  clientSocket.destroy()
                  return
                }
                clientSocket.pipe(stream).pipe(clientSocket)
                stream.on('error', () => {
                  client.end()
                  clientSocket.destroy()
                })
                stream.once('close', () => {
                  client.end()
                  clientSocket.destroy()
                })
                clientSocket.once('close', () => {
                  stream.end()
                  client.end()
                })
              }
            )
          }
        } catch (err) {
          const current = this.entries.get(tunnel.id)
          if (current) {
            current.status.message = `转发连接失败: ${err instanceof Error ? err.message : String(err)}`
            current.status.updatedAt = Date.now()
          }
          clientSocket.destroy()
        }
      })()
    })

    await new Promise<void>((resolve, reject) => {
      server.once('error', (error: NodeJS.ErrnoException) => {
        reject(
          new Error(
            error.code === 'EADDRINUSE'
              ? `本地端口 ${tunnel.listenHost}:${tunnel.listenPort} 已被占用 (EADDRINUSE)`
              : error.message
          )
        )
      })
      server.once('listening', () => resolve())
      server.listen(tunnel.listenPort, tunnel.listenHost)
    })

    const modeLabel =
      tunnel.type === 'D' ? 'SOCKS5 动态代理' : `本地端口转发 -> ${tunnel.destHost}:${tunnel.destPort}`
    this.entries.set(tunnel.id, {
      tunnel,
      server,
      sockets,
      status: {
        tunnelId: tunnel.id,
        active: true,
        status: 'active',
        listenHost: tunnel.listenHost,
        listenPort: tunnel.listenPort,
        activeConnections: 0,
        message: `监听中 (${tunnel.listenHost}:${tunnel.listenPort}) · ${modeLabel}`,
        updatedAt: Date.now()
      }
    })
  }

  private async startRemoteForward(tunnel: SyncTunnel): Promise<void> {
    const { client } = await this.connectSshForTunnel(tunnel.serverId)
    const sockets = new Set<net.Socket>()

    await new Promise<void>((resolve, reject) => {
      client.forwardIn(tunnel.listenHost, tunnel.listenPort, (err) => {
        if (err) {
          client.end()
          reject(new Error(`远端端口绑定失败: ${err.message}`))
          return
        }
        resolve()
      })
    })

    client.on('tcp connection', (_info, accept) => {
      const upstream = accept()
      const localSocket = net.connect({ host: tunnel.destHost, port: tunnel.destPort })
      sockets.add(localSocket)
      localSocket.once('close', () => sockets.delete(localSocket))
      localSocket.on('error', () => {
        upstream.end()
        localSocket.destroy()
      })
      upstream.pipe(localSocket).pipe(upstream)
    })

    this.entries.set(tunnel.id, {
      tunnel,
      sshClient: client,
      sockets,
      status: {
        tunnelId: tunnel.id,
        active: true,
        status: 'active',
        listenHost: tunnel.listenHost,
        listenPort: tunnel.listenPort,
        activeConnections: 0,
        message: `远端转发运行中 (${tunnel.listenHost}:${tunnel.listenPort} -> ${tunnel.destHost}:${tunnel.destPort})`,
        updatedAt: Date.now()
      }
    })
  }

  private handleSocks5Socket(
    clientSocket: net.Socket,
    sshClient: SshClient,
    listenHost: string,
    listenPort: number
  ): void {
    let stage: 'greeting' | 'request' = 'greeting'
    const onData = (chunk: Buffer): void => {
      if (stage === 'greeting') {
        if (chunk.length < 2 || chunk[0] !== 0x05) {
          sshClient.end()
          clientSocket.destroy()
          return
        }
        stage = 'request'
        clientSocket.write(Buffer.from([0x05, 0x00]))
        return
      }
      if (chunk.length < 7 || chunk[0] !== 0x05 || chunk[1] !== 0x01) {
        sshClient.end()
        clientSocket.destroy()
        return
      }
      const atyp = chunk[3]
      let targetHost = ''
      let offset = 4
      if (atyp === 0x01) {
        targetHost = `${chunk[4]}.${chunk[5]}.${chunk[6]}.${chunk[7]}`
        offset = 8
      } else if (atyp === 0x03) {
        const len = chunk[4] ?? 0
        targetHost = chunk.subarray(5, 5 + len).toString('utf8')
        offset = 5 + len
      } else {
        sshClient.end()
        clientSocket.destroy()
        return
      }
      const targetPort = chunk.readUInt16BE(offset)
      clientSocket.removeListener('data', onData)
      sshClient.forwardOut(listenHost, listenPort, targetHost, targetPort, (err, stream) => {
        if (err || !stream) {
          clientSocket.write(Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
          sshClient.end()
          clientSocket.destroy()
          return
        }
        clientSocket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
        clientSocket.pipe(stream).pipe(clientSocket)
        stream.on('error', () => {
          sshClient.end()
          clientSocket.destroy()
        })
        stream.once('close', () => {
          sshClient.end()
          clientSocket.destroy()
        })
        clientSocket.once('close', () => {
          stream.end()
          sshClient.end()
        })
      })
    }
    clientSocket.on('data', onData)
  }
}
