import type { Terminal } from '@xterm/xterm'
import type { WebglAddon } from '@xterm/addon-webgl'
import { isSoftwareRenderer, probeMotionGraphics } from './motion-performance'

type WebglConstructor = typeof WebglAddon
let rendererClass: Promise<WebglConstructor | undefined> | undefined

export function loadTerminalWebgl(): Promise<WebglConstructor | undefined> {
  if (!rendererClass) {
    const graphics = probeMotionGraphics(document.createElement('canvas'))
    rendererClass =
      graphics.webgl2Supported && !isSoftwareRenderer(graphics.renderer ?? '')
        ? import('@xterm/addon-webgl').then(
            (module) => module.WebglAddon,
            () => undefined
          )
        : Promise.resolve(undefined)
  }
  return rendererClass
}

export function attachTerminalWebgl(
  terminal: Terminal,
  Webgl: WebglConstructor,
  refresh: () => void
): () => void {
  let addon: WebglAddon | undefined
  let context: WebGL2RenderingContext | null = null
  let stopped = false
  const release = () => {
    addon?.dispose()
    addon = undefined
    // The addon removes its canvas but Chromium can retain the context until GC.
    if (context && !context.isContextLost()) context.getExtension('WEBGL_lose_context')?.loseContext()
    context = null
  }
  const stop = () => {
    stopped = true
    observer.disconnect()
    release()
  }
  const enable = () => {
    if (stopped || addon) return
    try {
      addon = new Webgl()
      terminal.loadAddon(addon)
      const canvas = terminal.element?.querySelector<HTMLCanvasElement>('.xterm-screen > canvas:last-of-type')
      context = canvas?.getContext('webgl2') ?? null
      addon.onContextLoss(() => {
        stop()
        refresh()
      })
      refresh()
    } catch {
      stop()
      refresh()
    }
  }
  const observer = new IntersectionObserver(([entry]) => {
    if (entry?.isIntersecting) enable()
    else release()
  })
  observer.observe(terminal.element!)
  // Fit the initial PTY with the final renderer's cell size before opening the session.
  if (terminal.element!.clientHeight && terminal.element!.clientWidth) enable()
  return stop
}
