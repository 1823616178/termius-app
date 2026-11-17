import type { Terminal } from '@xterm/xterm'
import type { SearchAddon } from '@xterm/addon-search'
import type { OpenSessionInput, SessionInfo, TerminalEvent } from '../../../shared/contracts'
import { createTerminalLinkIntegration } from './terminal-links'
import { getTerminalTheme, type CursorShape, type TerminalThemeId } from './terminal-themes'

interface XtermModules {
  Terminal: typeof import('@xterm/xterm').Terminal
  FitAddon: typeof import('@xterm/addon-fit').FitAddon
  SearchAddon: typeof import('@xterm/addon-search').SearchAddon
}

let xtermModulesPromise: Promise<XtermModules> | undefined

function loadXtermModules(): Promise<XtermModules> {
  if (!xtermModulesPromise) {
    xtermModulesPromise = Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
      import('@xterm/addon-search')
    ])
      .then(([xtermPkg, fitPkg, searchPkg]) => ({
        Terminal: xtermPkg.Terminal,
        FitAddon: fitPkg.FitAddon,
        SearchAddon: searchPkg.SearchAddon
      }))
      .catch((error) => {
        xtermModulesPromise = undefined
        throw error
      })
  }
  return xtermModulesPromise
}

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
  getSessionId: () => string | undefined
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
  writeInput: (data: string) => void
  applyAppearance: (opts: TerminalAppearanceOptions) => void
  reattach: (
    nextElement: HTMLElement,
    nextOnState: (event: Extract<TerminalEvent, { type: 'state' }>) => void,
    nextScreenReaderMode: boolean,
    nextAppearance: TerminalAppearanceOptions
  ) => TerminalHandle
  snapshot: () => { connected: boolean; state: Extract<TerminalEvent, { type: 'state' }> }
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

/**
 * Returns the live state of an already-connected terminal for this token, if any.
 * Used by a freshly mounted pane (e.g. after a drag moved it to another parent) so it can
 * resume the existing session without flashing the "connecting" UI.
 */
export function peekConnectedTerminal(
  token: string
): { state: Extract<TerminalEvent, { type: 'state' }> } | undefined {
  const snap = registry.get(token)?.snapshot()
  return snap?.connected ? { state: snap.state } : undefined
}

export function disposeTerminalByToken(token: string): void {
  registry.get(token)?.dispose()
}

export function writeTerminalInputByToken(token: string, data: string): boolean {
  const entry = registry.get(token)
  if (!entry) return false
  entry.writeInput(data)
  return true
}

export async function createTerminal(
  token: string,
  element: HTMLElement,
  onState: (event: Extract<TerminalEvent, { type: 'state' }>) => void,
  initialScreenReaderMode = false,
  initialAppearance: TerminalAppearanceOptions = DEFAULT_APPEARANCE
): Promise<TerminalHandle> {
  const existingBeforeLoad = registry.get(token)
  if (existingBeforeLoad) {
    return existingBeforeLoad.reattach(element, onState, initialScreenReaderMode, initialAppearance)
  }
  const { Terminal, FitAddon, SearchAddon } = await loadXtermModules()
  const existingAfterLoad = registry.get(token)
  if (existingAfterLoad) {
    return existingAfterLoad.reattach(element, onState, initialScreenReaderMode, initialAppearance)
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
  const links = createTerminalLinkIntegration(terminal, (uri) => {
    void window.orbit.shell.openExternal(uri).catch(() => {})
  })
  terminal.options.linkHandler = links.linkHandler
  const linkProviderSub = terminal.registerLinkProvider(links.provider)
  const linkScrollSub = terminal.onScroll(() => links.hideHover())
  terminal.loadAddon(fit)
  terminal.loadAddon(search)
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
  let resizeTimer: ReturnType<typeof setTimeout> | undefined
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

  // Panel transitions generate a size change every frame. Fit once they settle,
  // avoiding repeated PTY resizes and scrollback reflow during the animation.
  const observer = new ResizeObserver(() => {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(scheduleFit, 60)
  })
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
    links.hideHover()
    observer.disconnect()
    clearTimeout(resizeTimer)
    cancelAnimationFrame(frame)
  }

  const dispose = () => {
    if (disposed) return
    disposed = true
    connected = false
    inputQueue = []
    observer.disconnect()
    clearTimeout(resizeTimer)
    dprMedia?.removeEventListener('change', onDprChange)
    cancelAnimationFrame(frame)
    linkProviderSub.dispose()
    linkScrollSub.dispose()
    links.dispose()
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
    getSessionId: () => session?.id,
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
          // A resize before the port arrived was only applied locally.
          lastSize = ''
          scheduleFit()
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
    // Connected panes re-sync via getLastState() (silently) in the caller; replaying here would
    // re-trigger side effects such as auth prompts on a pane that was merely moved.
    if (!connected) emitState(lastState)
    scheduleFit()
    return handle
  }

  registry.set(token, {
    terminal,
    writeInput: enqueueInput,
    applyAppearance,
    reattach,
    snapshot: () => ({ connected, state: lastState }),
    dispose
  })

  return handle
}
