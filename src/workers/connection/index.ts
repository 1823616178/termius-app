import { createHash } from 'node:crypto'
import { Client, type ClientChannel } from 'ssh2'
import { terminalChannel } from '../terminal-channel'

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
  if (data.type === 'shutdown') {
    for (const close of sessions.values()) close()
    process.exit(0)
  }
  if (data.type !== 'open' || !ports[0]) return
  const client = new Client()
  let stream: ClientChannel | undefined
  let ended = false
  let cols = data.cols as number,
    rows = data.rows as number
  let deadline: NodeJS.Timeout | undefined
  const secretPassword = data.host.auth === 'password' ? (data.password as string | undefined) : undefined

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
        stream?.close()
        client.destroy()
      }
    },
    () => {
      sessions.delete(data.id)
      process.parentPort.postMessage({ type: 'closed', id: data.id })
    }
  )
  sessions.set(data.id, channel.close)
  channel.send({ type: 'state', state: 'connecting' })
  client.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) => {
    if (secretPassword !== undefined && prompts.length === 1 && !prompts[0]?.echo) {
      finish([secretPassword])
      return
    }
    finish([])
  })
  client.on('ready', () => {
    clearTimeout(deadline)
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
    const message =
      error.level === 'client-authentication'
        ? 'SSH 认证失败，请检查用户名、密码或 OpenSSH Agent。'
        : error.level === 'client-timeout'
          ? 'SSH 连接超时，请检查网络与端口。'
          : 'SSH 连接失败，请检查地址、端口、网络和主机信任状态。'
    channel.finish({ type: 'state', state: 'error', message })
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
    armDeadline()
    client.connect({
      host: normalizeSshHost(data.host.address),
      port: data.host.port,
      username: data.host.username,
      password: secretPassword,
      tryKeyboard: data.host.auth === 'password' && secretPassword !== undefined,
      agent: data.host.auth === 'agent' ? '\\\\.\\pipe\\openssh-ssh-agent' : undefined,
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
