import type { Terminal } from '@xterm/xterm'
import type { WebglAddon } from '@xterm/addon-webgl'
import { isAppForeground } from './app-foreground'
import { isSoftwareRenderer, probeMotionGraphics } from './motion-performance'

type WebglConstructor = typeof WebglAddon
let rendererClass: Promise<WebglConstructor | undefined> | undefined

function loadTerminalWebgl(): Promise<WebglConstructor | undefined> {
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
  refresh: () => void,
  isWanted: () => boolean
): { stop: () => void; sync: () => void } {
  let addon: WebglAddon | undefined
  let context: WebGL2RenderingContext | null = null
  let stopped = false
  let recoveredAt = -Infinity
  let recovering = false
  let intersecting = false
  let enableFrame = 0
  let canvas: HTMLCanvasElement | null = null

  const hasBox = () => {
    const element = terminal.element
    return Boolean(element && element.clientWidth > 0 && element.clientHeight > 0)
  }

  const release = () => {
    cancelAnimationFrame(enableFrame)
    enableFrame = 0
    if (!addon && !context) return
    canvas?.removeEventListener('webglcontextlost', onLoss)
    canvas?.removeEventListener('webglcontextrestored', onRestored)
    canvas = null
    const losing = context
    const current = addon
    addon = undefined
    context = null
    current?.dispose()
    if (losing && !losing.isContextLost()) losing.getExtension('WEBGL_lose_context')?.loseContext()
  }

  const stop = () => {
    stopped = true
    observer.disconnect()
    release()
  }

  function onLoss() {
    if (performance.now() - recoveredAt < 2000) {
      stop()
      refresh()
    } else {
      recovering = true
    }
  }

  function onRestored() {
    recoveredAt = performance.now()
    recovering = false
  }

  const canEnable = () => !stopped && !addon && isWanted() && isAppForeground() && intersecting && hasBox()
  let loading = false
  const enable = async () => {
    if (loading || !canEnable()) return
    loading = true
    try {
      const Webgl = await loadTerminalWebgl()
      if (!canEnable()) return
      if (!Webgl) {
        stop()
        return
      }
      addon = new Webgl()
      terminal.loadAddon(addon)
      canvas =
        terminal.element?.querySelector<HTMLCanvasElement>('.xterm-screen > canvas:last-of-type') ?? null
      context = canvas?.getContext('webgl2') ?? null
      canvas?.addEventListener('webglcontextlost', onLoss)
      canvas?.addEventListener('webglcontextrestored', onRestored)
      if (recovering) onRestored()
      addon.onContextLoss(() => {
        // xterm gives the browser three seconds to restore the original context.
        release()
        sync()
      })
      refresh()
    } catch {
      stop()
      refresh()
    } finally {
      loading = false
    }
  }

  const sync = () => {
    if (stopped) return
    cancelAnimationFrame(enableFrame)
    if (!isWanted()) {
      release()
      return
    }
    if (!canEnable()) return
    enableFrame = requestAnimationFrame(() => {
      enableFrame = requestAnimationFrame(() => {
        enableFrame = 0
        void enable()
      })
    })
  }

  const observer = new IntersectionObserver(([entry]) => {
    intersecting = Boolean(entry?.isIntersecting)
    sync()
  })
  const element = terminal.element
  if (!element) {
    observer.disconnect()
    return { stop: () => undefined, sync: () => undefined }
  }
  observer.observe(element)
  intersecting = element.clientWidth > 0 && element.clientHeight > 0
  sync()
  return { stop, sync }
}
