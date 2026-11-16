import { createHash } from 'node:crypto'
import { Client, type ClientChannel } from 'ssh2'
import { terminalChannel } from '../terminal-channel'
import { handleSftpRequest, type SftpSessionState, type SftpWorkerRequest } from './sftp-handler'

export function resolveSshAgentSocket(
  platform: NodeJS.Platform = process.platform,
  env: Record<string, string | undefined> = process.env
): string | undefined {
  if (platform === 'win32') return '\\\\.\\pipe\\openssh-ssh-agent'
  const sock = env.SSH_AUTH_SOCK?.trim()
  return sock ? sock : undefined
}

export function parseHostKeyAlgorithm(key: Buffer): string {
  if (key.length < 4) return 'unknown'
  const size = key.readUInt32BE(0)
  if (size <= 0 || 4 + size > key.length) return 'unknown'
  return key.subarray(4, 4 + size).toString('ascii')
}

export function normalizeSshHost(address: string): string {
  return address.trim().replace(/^\[(.*)\]$/, '$1')
}

const sessions = new Map<string, () => void>()
const sftpStates = new Map<string, SftpSessionState>()
const verifiers = new Map<string, (accept: boolean) => void>()

process.parentPort?.on('message', ({ data, ports }) => {
  if (data.type === 'close') {
    sessions.get(data.id)?.()
    return
  }
  if (data.type === 'verify') {
    verifiers.get(data.id)?.(data.accept === true)
    return
  }
  if (data.type === 'sftp:cancel') {
    sftpStates.get(data.sessionId)?.activeTransfers.get(data.transferId)?.abort()
    return
  }
  if (data.type === 'sftp:request') {
    const req = data as SftpWorkerRequest
    const state = sftpStates.get(req.sessionId)
    if (!state) {
      process.parentPort?.postMessage({
        type: 'sftp:response',
        requestId: req.requestId,
        ok: false,
        error: 'SSH 会话不存在或已断开，请重新连接后重试。'
      })
      return
    }
    void handleSftpRequest(state, req, (progress) => {
      process.parentPort?.postMessage({ type: 'sftp:progress', ...progress })
    }).then(
      (result) => {
        process.parentPort?.postMessage({
          type: 'sftp:response',
          requestId: req.requestId,
          ok: true,
          result
        })
      },
      (error) => {
        process.parentPort?.postMessage({
          type: 'sftp:response',
          requestId: req.requestId,
          ok: false,
          error: error instanceof Error ? error.message : 'SFTP 操作失败'
        })
      }
    )
    return
  }
  if (data.type === 'shutdown') {
    for (const close of sessions.values()) close()
    process.exit(0)
  }
  if (data.type !== 'open' || !ports[0]) return
  const client = new Client()
  const sftpState: SftpSessionState = { client, activeTransfers: new Map() }
  const mode = data.mode === 'sftp' ? 'sftp' : 'shell'
  let stream: ClientChannel | undefined
  let ended = false
  let cols = data.cols as number,
    rows = data.rows as number
  let deadline: NodeJS.Timeout | undefined
  const secretPassword = typeof data.password === 'string' ? data.password : undefined
  let keyboardAttempted = false

  const armDeadline = () => {
    clearTimeout(deadline)
    deadline = setTimeout(() => {
      ended = true
      channel.finish({ type: 'state', state: 'error', message: 'SSH 连接或认证超时，请重试。' })
    }, 15_000)
  }
  const channel = terminalChannel(
    ports[0],
    {
      write: (value) => {
        if (stream && !ended) stream.write(value)
      },
      resize: (c, r) => {
        cols = c
        rows = r
        stream?.setWindow(r, c, 0, 0)
      },
      pause: () => stream?.pause(),
      resume: () => stream?.resume(),
      close: () => {
        clearTimeout(deadline)
        ended = true
        verifiers.get(data.id)?.(false)
        for (const controller of sftpState.activeTransfers.values()) controller.abort()
        sftpState.activeTransfers.clear()
        try {
          sftpState.sftp?.end()
        } catch {
          /* Ignore SFTP close error */
        }
        sftpStates.delete(data.id)
        stream?.close()
        client.destroy()
      }
    },
    () => {
      sessions.delete(data.id)
      sftpStates.delete(data.id)
      process.parentPort.postMessage({ type: 'closed', id: data.id })
    }
  )
  sessions.set(data.id, channel.close)
  sftpStates.set(data.id, sftpState)
  channel.send({ type: 'state', state: 'connecting' })
  client.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) => {
    if (!keyboardAttempted && secretPassword !== undefined && prompts.length === 1 && !prompts[0]?.echo) {
      keyboardAttempted = true
      finish([secretPassword])
      return
    }
    finish([])
  })
  client.on('ready', () => {
    clearTimeout(deadline)
    if (mode === 'sftp') {
      channel.send({ type: 'state', state: 'authenticating', message: '认证成功，正在启动 SFTP 通道' })
      client.sftp((error, sftp) => {
        if (ended) {
          sftp?.end()
          return
        }
        if (error || !sftp) {
          ended = true
          channel.finish({ type: 'state', state: 'error', message: '服务器未启用或拒绝了 SFTP 子系统。' })
          return
        }
        sftpState.sftp = sftp
        sftp.once('close', () => {
          sftpState.sftp = undefined
          sftpState.sftpPromise = undefined
        })
        channel.send({ type: 'state', state: 'running' })
      })
      return
    }
    channel.send({ type: 'state', state: 'authenticating', message: '认证成功，正在请求终端' })
    client.shell(
      { term: 'xterm-256color', cols, rows },
      {
        env: {
          COLORTERM: 'truecolor',
          TERM_PROGRAM: 'GraphiteOrbit',
          TERM_PROGRAM_VERSION: '0.1.0',
          CLICOLOR: '1',
          LS_COLORS:
            'rs=0:di=01;36:ln=01;35:so=01;32:pi=40;33:ex=01;32:*.tar=01;31:*.gz=01;31:*.zip=01;31:*.jpg=01;35:*.png=01;35:*.json=01;33:*.yml=01;33:*.md=01;34'
        }
      },
      (error, shell) => {
        if (ended) {
          shell?.close()
          return
        }
        if (error) {
          ended = true
          channel.finish({ type: 'state', state: 'error', message: '服务器拒绝了交互式终端请求。' })
          return
        }
        stream = shell
        channel.send({ type: 'state', state: 'running' })
        shell.on('data', (chunk: Buffer) => channel.output(chunk))
        shell.stderr.on('data', (chunk: Buffer) => channel.output(chunk))
        shell.on('close', () => {
          ended = true
          channel.finish({ type: 'state', state: 'exited', message: '远程终端已关闭' })
        })
      }
    )
  })
  client.on('error', (error: Error & { level?: string }) => {
    ended = true
    clearTimeout(deadline)
    const isAuthError = error.level === 'client-authentication'
    const message = isAuthError
      ? data.host.auth === 'agent'
        ? 'SSH Agent 认证失败，请输入密码继续连接或检查 OpenSSH Agent。'
        : 'SSH 密码认证失败，请重新输入登录密码。'
      : error.level === 'client-timeout'
        ? 'SSH 连接超时，请检查网络与端口。'
        : 'SSH 连接失败，请检查地址、端口、网络和主机信任状态。'
    channel.finish({
      type: 'state',
      state: 'error',
      message,
      ...(isAuthError ? { reason: 'auth-failed' as const } : {})
    })
  })
  client.on('close', () => {
    clearTimeout(deadline)
    verifiers.get(data.id)?.(false)
    if (!ended) {
      ended = true
      channel.finish({ type: 'state', state: 'exited', message: 'SSH 连接已断开；未重放输入。' })
    }
  })
  try {
    const agentSocket =
      data.host.auth === 'agent' && secretPassword === undefined ? resolveSshAgentSocket() : undefined
    if (data.host.auth === 'agent' && secretPassword === undefined && !agentSocket) {
      ended = true
      channel.finish({
        type: 'state',
        state: 'error',
        message:
          process.platform === 'win32'
            ? 'OpenSSH Agent 管道不可用。'
            : '未检测到 SSH_AUTH_SOCK，请先启动 ssh-agent / gnome-keyring-daemon 并添加私钥。'
      })
      return
    }
    armDeadline()
    client.connect({
      host: normalizeSshHost(data.host.address),
      port: data.host.port,
      username: data.host.username,
      password: secretPassword,
      tryKeyboard: secretPassword !== undefined,
      agent: agentSocket,
      readyTimeout: 0,
      keepaliveInterval: 30_000,
      keepaliveCountMax: 3,
      hostVerifier: (key: Buffer, callback: (accept: boolean) => void) => {
        clearTimeout(deadline)
        channel.send({ type: 'state', state: 'verifying' })
        const fingerprint = `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`
        const algorithm = parseHostKeyAlgorithm(key)
        let timeout: NodeJS.Timeout
        const finish = (accept: boolean) => {
          if (!verifiers.delete(data.id)) return
          clearTimeout(timeout)
          if (accept) {
            armDeadline()
            channel.send({ type: 'state', state: 'authenticating' })
          }
          callback(accept)
        }
        timeout = setTimeout(() => finish(false), 60_000)
        verifiers.set(data.id, finish)
        process.parentPort.postMessage({ type: 'verify', id: data.id, fingerprint, algorithm })
      }
    })
  } catch {
    channel.send({ type: 'state', state: 'error', message: '无法启动 SSH 连接。' })
    channel.close()
  }
  data.password = undefined
})
