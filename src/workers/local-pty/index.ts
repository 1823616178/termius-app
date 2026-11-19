import * as pty from 'node-pty'
import { terminalChannel } from '../terminal-channel'

export function sanitizeShellEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue
    if (key.startsWith('ELECTRON_') || key === 'ORIGINAL_XDG_CURRENT_DESKTOP') continue
    env[key] = value
  }
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.TERM_PROGRAM = 'GraphiteOrbit'
  env.TERM_PROGRAM_VERSION = '1.3.0'
  env.CLICOLOR = '1'
  env.FORCE_COLOR = '3'
  if (platform === 'win32') {
    env.WSL_UTF8 = '1'
    if (!env.PROMPT) {
      env.PROMPT = '$E[95m●$E[0m $E[96m$P$E[90m›$E[0m '
    }
  }
  if (!env.LS_COLORS) {
    env.LS_COLORS =
      'rs=0:di=01;36:ln=01;35:mh=00:pi=40;33:so=01;32:do=01;35:bd=40;33;01:cd=40;33;01:or=40;31;01:mi=00:su=37;41:sg=30;43:ca=30;41:tw=30;42:ow=34;42:st=37;44:ex=01;32:*.tar=01;31:*.tgz=01;31:*.arc=01;31:*.arj=01;31:*.taz=01;31:*.lha=01;31:*.lz4=01;31:*.lzh=01;31:*.lzma=01;31:*.tlz=01;31:*.txz=01;31:*.tzo=01;31:*.t7z=01;31:*.zip=01;31:*.z=01;31:*.dz=01;31:*.gz=01;31:*.lrz=01;31:*.lz=01;31:*.lzo=01;31:*.xz=01;31:*.zst=01;31:*.tzst=01;31:*.bz2=01;31:*.bz=01;31:*.tbz=01;31:*.tbz2=01;31:*.tz=01;31:*.deb=01;31:*.rpm=01;31:*.jar=01;31:*.war=01;31:*.ear=01;31:*.sar=01;31:*.rar=01;31:*.alz=01;31:*.ace=01;31:*.zoo=01;31:*.cpio=01;31:*.7z=01;31:*.rz=01;31:*.cab=01;31:*.wim=01;31:*.swm=01;31:*.dwm=01;31:*.esd=01;31:*.jpg=01;35:*.jpeg=01;35:*.mjpg=01;35:*.mjpeg=01;35:*.gif=01;35:*.bmp=01;35:*.pbm=01;35:*.pgm=01;35:*.ppm=01;35:*.tga=01;35:*.xbm=01;35:*.xpm=01;35:*.tif=01;35:*.tiff=01;35:*.png=01;35:*.svg=01;35:*.svgz=01;35:*.webp=01;35:*.mp4=01;35:*.mkv=01;35:*.mp3=01;36:*.flac=01;36:*.json=01;33:*.yml=01;33:*.yaml=01;33:*.toml=01;33:*.md=01;34'
  }
  return env
}

const sessions = new Map<string, () => void>()
let shuttingDown = false

process.parentPort?.on('message', ({ data, ports }) => {
  if (data.type === 'close') {
    sessions.get(data.id)?.()
    return
  }
  if (data.type === 'shutdown') {
    shuttingDown = true
    if (sessions.size === 0) {
      process.exit(0)
    }
    for (const close of sessions.values()) close()
    setTimeout(() => process.exit(0), 1000)
    return
  }
  if (data.type !== 'open' || !ports[0]) return
  const port = ports[0]
  try {
    const ptyOptions: pty.IPtyForkOptions | pty.IWindowsPtyForkOptions = {
      name: 'xterm-256color',
      cols: data.cols,
      rows: data.rows,
      cwd: data.cwd,
      env: sanitizeShellEnv(),
      ...(process.platform === 'win32' ? { useConpty: true } : {})
    }
    const terminal = pty.spawn(data.executable, data.args, ptyOptions)
    const channel = terminalChannel(
      port,
      {
        write: (value) => terminal.write(value),
        resize: (cols, rows) => terminal.resize(cols, rows),
        pause: () => terminal.pause(),
        resume: () => terminal.resume(),
        close: () => {
          try {
            terminal.kill()
          } catch {
            /* already exited */
          }
        }
      },
      () => {
        sessions.delete(data.id)
        process.parentPort.postMessage({ type: 'closed', id: data.id })
        if (shuttingDown && sessions.size === 0) process.exit(0)
      }
    )
    sessions.set(data.id, channel.close)
    terminal.onData((value) => channel.output(value))
    terminal.onExit(({ exitCode }) => {
      channel.finish({ type: 'state', state: 'exited', exitCode, message: `进程已退出 · 退出码 ${exitCode}` })
    })
    channel.send({ type: 'state', state: 'running' })
    process.parentPort.postMessage({ type: 'spawned', id: data.id, pid: terminal.pid })
  } catch {
    port.postMessage({
      type: 'state',
      state: 'error',
      message: '本地终端启动失败，请检查 Shell、工作目录与原生模块。'
    })
    port.close()
    process.parentPort.postMessage({ type: 'closed', id: data.id })
  }
})
