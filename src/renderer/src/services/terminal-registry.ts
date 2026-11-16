import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import type { OpenSessionInput, SessionInfo, TerminalEvent } from '../../../shared/contracts'
import { getTerminalTheme, type CursorShape, type TerminalThemeId } from './terminal-themes'

export interface TerminalAppearanceOptions {
  themeId: TerminalThemeId
  fontSize: number
  lineHeight: number
  cursorStyle: CursorShape
  cursorBlink: boolean
}

export interface TerminalHandle {
  terminal: Terminal
  search: SearchAddon
  resize: () => void
  refresh: () => void
  clear: () => void
  selectAll: () => void
  writeInput: (data: string) => void
  applyAppearance: (opts: TerminalAppearanceOptions) => void
  getDimensions: () => { cols: number; rows: number }
  isConnected: () => boolean
  getLastState: () => Extract<TerminalEvent, { type: 'state' }>
  detachHost: (hostElement: HTMLElement) => void
  dispose: () => void
  connect: (
    input: { kind: 'local'; profileId: string } | { kind: 'ssh'; hostId: string; password?: string }
  ) => Promise<void>
}

interface RegistryEntry {
  terminal: Terminal
  applyAppearance: (opts: TerminalAppearanceOptions) => void
  reattach: (
    nextElement: HTMLElement,
    nextOnState: (event: Extract<TerminalEvent, { type: 'state' }>) => void,
    nextScreenReaderMode: boolean,
    nextAppearance: TerminalAppearanceOptions
  ) => TerminalHandle
  dispose: () => void
}

const DEFAULT_APPEARANCE: TerminalAppearanceOptions = {
  themeId: 'orbit-vivid',
  fontSize: 14,
  lineHeight: 1.28,
  cursorStyle: 'block',
  cursorBlink: true
}

const registry = new Map<string, RegistryEntry>()

export function getRegisteredTerminalCount(): number {
  return registry.size
}

export function updateAllTerminalsAppearance(opts: TerminalAppearanceOptions): void {
  for (const entry of registry.values()) {
    entry.applyAppearance(opts)
  }
}

export function disposeTerminalByToken(token: string): void {
  registry.get(token)?.dispose()
}

export function createTerminal(
  token: string,
  element: HTMLElement,
  onState: (event: Extract<TerminalEvent, { type: 'state' }>) => void,
  initialScreenReaderMode = false,
  initialAppearance: TerminalAppearanceOptions = DEFAULT_APPEARANCE
): TerminalHandle {
  const existing = registry.get(token)
  if (existing) {
    return existing.reattach(element, onState, initialScreenReaderMode, initialAppearance)
  }
  const preset = getTerminalTheme(initialAppearance.themeId)
  const terminal = new Terminal({
    fontFamily:
      "'Cascadia Mono', 'Cascadia Code', 'JetBrains Mono', 'Sarasa Term SC', 'Consolas', 'Microsoft YaHei UI', monospace",
    fontSize: initialAppearance.fontSize,
    lineHeight: initialAppearance.lineHeight,
    fontWeight: '400',
    fontWeightBold: '600',
    cursorStyle: initialAppearance.cursorStyle,
    cursorWidth: 2,
    cursorBlink: initialAppearance.cursorBlink,
    cursorInactiveStyle: 'outline',
    minimumContrastRatio: 4.5,
    drawBoldTextInBrightColors: true,
    customGlyphs: true,
    rescaleOverlappingGlyphs: true,
    smoothScrollDuration: 80,
    scrollback: 10_000,
    allowProposedApi: true,
    overviewRuler: { width: 10 },
    screenReaderMode: initialScreenReaderMode,
    theme: preset.theme
  })
  const fit = new FitAddon()
  const search = new SearchAddon()
  const webLinks = new WebLinksAddon((_event, uri) => {
    void window.orbit.shell.openExternal(uri).catch(() => {})
  })
  terminal.loadAddon(fit)
  terminal.loadAddon(search)
  terminal.loadAddon(webLinks)
  terminal.open(element)

  let port: MessagePort | undefined
  let session: SessionInfo | undefined
  let currentElement = element
  let currentOnState = onState
  let lastState: Extract<TerminalEvent, { type: 'state' }> = { type: 'state', state: 'connecting' }
  let connected = false
  let connectPromise: Promise<void> | undefined
  let disposed = false
  let finished = false
  let frame = 0
  let lastSize = ''
  let dprMedia: MediaQueryList | undefined

  const send = (message: unknown) => port?.postMessage(message)

  const emitState = (event: Extract<TerminalEvent, { type: 'state' }>) => {
    lastState = event
    currentOnState(event)
  }

  const resize = () => {
    if (disposed || !currentElement.clientWidth || !currentElement.clientHeight) return
    const activeBuffer = terminal.buffer.active
    const wasAtBottom = activeBuffer.viewportY >= activeBuffer.baseY
    fit.fit()
    if (wasAtBottom) terminal.scrollToBottom()
    const size = `${terminal.cols}:${terminal.rows}`
    if (size !== lastSize) {
      lastSize = size
      if (!finished) send({ type: 'resize', cols: terminal.cols, rows: terminal.rows })
    }
  }

  const scheduleFit = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(resize)
  }

  const refresh = () => {
    if (disposed || !currentElement.clientWidth || !currentElement.clientHeight) return
    scheduleFit()
    if (terminal.rows > 0) terminal.refresh(0, terminal.rows - 1)
  }

  void document.fonts?.ready.then(() => {
    if (disposed) return
    terminal.clearTextureAtlas()
    refresh()
  })

  const applyAppearance = (opts: TerminalAppearanceOptions) => {
    if (disposed) return
    const nextPreset = getTerminalTheme(opts.themeId)
    terminal.options.theme = nextPreset.theme
    terminal.options.fontSize = opts.fontSize
    terminal.options.lineHeight = opts.lineHeight
    terminal.options.cursorStyle = opts.cursorStyle
    terminal.options.cursorBlink = opts.cursorBlink
    terminal.clearTextureAtlas()
    refresh()
  }

  const watchDpr = () => {
    dprMedia?.removeEventListener('change', onDprChange)
    dprMedia = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    dprMedia.addEventListener('change', onDprChange, { once: true })
  }

  const onDprChange = () => {
    if (disposed) return
    terminal.clearTextureAtlas()
    refresh()
    watchDpr()
  }
  watchDpr()

  const observer = new ResizeObserver(scheduleFit)
  observer.observe(element)

  let inputQueue: string[] = []
  let pumpingInput = false

  const flushInputQueue = () => {
    if (disposed || finished || !port) {
      inputQueue = []
      pumpingInput = false
      return
    }
    // Pace large pastes to stay comfortably below the 1 MiB/s worker input guard.
    let sentThisTick = 0
    while (inputQueue.length && sentThisTick < 131072) {
      const chunk = inputQueue.shift()!
      send({ type: 'input', data: chunk })
      sentThisTick += chunk.length
    }
    if (inputQueue.length) {
      setTimeout(flushInputQueue, 160)
    } else {
      pumpingInput = false
    }
  }

  const enqueueInput = (data: string) => {
    if (finished || disposed || !data) return
    for (let start = 0; start < data.length; ) {
      let end = Math.min(start + 16384, data.length)
      const last = data.charCodeAt(end - 1)
      if (end < data.length && last >= 0xd800 && last <= 0xdbff) end--
      inputQueue.push(data.slice(start, end))
      start = end
    }
    if (!pumpingInput) {
      pumpingInput = true
      flushInputQueue()
    }
  }

  const input = terminal.onData(enqueueInput)

  const removeFailure = window.orbit.onSessionFailure((event) => {
    if (session?.id !== event.id || disposed) return
    finished = true
    emitState({ type: 'state', state: 'error', message: event.message })
  })

  const detachHost = (hostElement: HTMLElement) => {
    if (disposed || currentElement !== hostElement) return
    observer.disconnect()
  }

  const dispose = () => {
    if (disposed) return
    disposed = true
    connected = false
    inputQueue = []
    observer.disconnect()
    dprMedia?.removeEventListener('change', onDprChange)
    cancelAnimationFrame(frame)
    input.dispose()
    removeFailure()
    if (port) {
      send({ type: 'close' })
      port.close()
    }
    if (session) void window.orbit.sessions.close(session.id).catch(() => {})
    terminal.dispose()
    registry.delete(token)
  }

  const handle: TerminalHandle = {
    terminal,
    search,
    resize: scheduleFit,
    refresh,
    clear: () => {
      if (!disposed) terminal.clear()
    },
    selectAll: () => {
      if (!disposed) terminal.selectAll()
    },
    writeInput: enqueueInput,
    applyAppearance,
    getDimensions: () => ({ cols: terminal.cols, rows: terminal.rows }),
    isConnected: () => connected,
    getLastState: () => lastState,
    detachHost,
    dispose,
    async connect(connectInput) {
      if (connected) {
        scheduleFit()
        return
      }
      if (connectPromise) return connectPromise
      connectPromise = (async () => {
        resize()
        const requestId = crypto.randomUUID()
        let listener: ((event: MessageEvent) => void) | undefined
        let timeout: ReturnType<typeof setTimeout> | undefined
        let timedOut = false
        const delivered = new Promise<MessagePort>((resolve, reject) => {
          listener = (event) => {
            const expectedOrigin = window.location.protocol === 'file:' ? 'null' : window.location.origin
            if (
              event.source !== window ||
              event.origin !== expectedOrigin ||
              event.data?.type !== 'orbit:terminal-port' ||
              event.data.requestId !== requestId ||
              !event.ports[0]
            )
              return
            resolve(event.ports[0])
          }
          window.addEventListener('message', listener)
          timeout = setTimeout(() => {
            timedOut = true
            reject(new Error('终端数据通道初始化超时'))
          }, 20_000)
        })
        // Observe early rejection while the control request is still awaiting the backend.
        void delivered.catch(() => {})
        try {
          const payload: OpenSessionInput =
            connectInput.kind === 'local'
              ? {
                  kind: 'local',
                  profileId: connectInput.profileId,
                  requestId,
                  cols: terminal.cols,
                  rows: terminal.rows
                }
              : {
                  kind: 'ssh',
                  hostId: connectInput.hostId,
                  ...(connectInput.password !== undefined ? { password: connectInput.password } : {}),
                  requestId,
                  cols: terminal.cols,
                  rows: terminal.rows
                }
          const opened = await window.orbit.sessions.open(payload)
          if (disposed || timedOut) {
            await window.orbit.sessions.close(opened.id).catch(() => {})
            return
          }
          session = opened
          port = await delivered
          if (disposed) {
            port.close()
            await window.orbit.sessions.close(session.id).catch(() => {})
            return
          }
          connected = true
          const isWinPlatform = typeof navigator !== 'undefined' && /windows/i.test(navigator.userAgent)
          const banner = `\x1b[38;2;167;139;250m╭─\x1b[0m \x1b[1;38;2;91;220;244m● ${opened.title}\x1b[0m \x1b[90m·\x1b[0m \x1b[38;2;89;214;160m${
            connectInput.kind === 'ssh'
              ? 'SSH 256-Color / TrueColor'
              : isWinPlatform
                ? 'ConPTY 256-Color / TrueColor'
                : 'PTY 256-Color / TrueColor'
          }\x1b[0m  \x1b[31m━━\x1b[33m━━\x1b[32m━━\x1b[36m━━\x1b[34m━━\x1b[35m━━\x1b[0m`
          terminal.writeln(banner)
          port.onmessage = ({ data }: MessageEvent<TerminalEvent>) => {
            if (data.type === 'data') {
              terminal.write(data.data, () => {
                if (!disposed) send({ type: 'ack', sequence: data.sequence })
              })
            } else {
              finished = data.state === 'exited' || data.state === 'error'
              emitState(data)
            }
          }
          port.addEventListener('close', () => {
            if (!disposed && !finished)
              emitState({ type: 'state', state: 'error', message: '终端后台通道已关闭，请新建会话。' })
          })
          port.start()
          terminal.focus()
        } catch (error) {
          if (session) await window.orbit.sessions.close(session.id).catch(() => {})
          throw error
        } finally {
          if (listener) window.removeEventListener('message', listener)
          clearTimeout(timeout)
          connectPromise = undefined
        }
      })()
      return connectPromise
    }
  }

  const reattach = (
    nextElement: HTMLElement,
    nextOnState: (event: Extract<TerminalEvent, { type: 'state' }>) => void,
    nextScreenReaderMode: boolean,
    nextAppearance: TerminalAppearanceOptions
  ): TerminalHandle => {
    currentElement = nextElement
    currentOnState = nextOnState
    if (terminal.element && terminal.element.parentElement !== nextElement) {
      nextElement.appendChild(terminal.element)
    }
    observer.disconnect()
    observer.observe(nextElement)
    terminal.options.screenReaderMode = nextScreenReaderMode
    applyAppearance(nextAppearance)
    emitState(lastState)
    scheduleFit()
    return handle
  }

  registry.set(token, { terminal, applyAppearance, reattach, dispose })

  return handle
}
