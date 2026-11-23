import { afterEach, describe, expect, it, vi } from 'vitest'

const mockState = {
  foreground: true,
  contextLost: false,
  loseContextCalls: 0,
  disposeCalls: 0,
  instances: 0
}

vi.mock('../../src/renderer/src/services/app-foreground', () => ({
  isAppForeground: () => mockState.foreground
}))

vi.mock('../../src/renderer/src/services/motion-performance', () => ({
  isSoftwareRenderer: () => false,
  probeMotionGraphics: () => ({ webgl2Supported: true, renderer: 'ANGLE (AMD, RX 6700 XT)' })
}))

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class MockWebglAddon {
    constructor() {
      mockState.instances += 1
    }
    onContextLoss() {
      return { dispose() {} }
    }
    dispose() {
      mockState.disposeCalls += 1
    }
  }
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  mockState.foreground = true
  mockState.contextLost = false
  mockState.loseContextCalls = 0
  mockState.disposeCalls = 0
  mockState.instances = 0
})

function setupDom() {
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 16)
  )
  vi.stubGlobal('cancelAnimationFrame', clearTimeout)
  vi.stubGlobal(
    'IntersectionObserver',
    class MockIO {
      observe() {}
      disconnect() {}
    }
  )

  const fakeGl = {
    isContextLost: () => mockState.contextLost,
    getExtension: (name: string) =>
      name === 'WEBGL_lose_context'
        ? {
            loseContext: () => {
              mockState.loseContextCalls += 1
            }
          }
        : null
  }
  const fakeCanvas = {
    getContext: (kind: string) => (kind === 'webgl2' ? fakeGl : null),
    addEventListener: () => {},
    removeEventListener: () => {}
  }
  const element = {
    clientWidth: 800,
    clientHeight: 600,
    querySelector: () => fakeCanvas
  }
  vi.stubGlobal('document', {
    createElement: () => fakeCanvas
  })

  const terminal = {
    element,
    loadAddon: vi.fn()
  }
  return { terminal }
}

describe('attachTerminalWebgl tray hibernation and context-loss recovery', () => {
  it('keeps WebGL warm across brief hides and releases it after prolonged tray hibernation', async () => {
    vi.resetModules()
    const { terminal } = setupDom()
    const { attachTerminalWebgl } = await import('../../src/renderer/src/services/terminal-webgl')
    const refresh = vi.fn()
    const binding = attachTerminalWebgl(
      terminal as never,
      refresh,
      () => true,
      () => false
    )

    await vi.advanceTimersByTimeAsync(32)
    expect(mockState.instances).toBe(1)

    // Brief 5s hide keeps the context warm.
    mockState.foreground = false
    binding.sync()
    await vi.advanceTimersByTimeAsync(5000)
    expect(mockState.disposeCalls).toBe(0)
    mockState.foreground = true
    binding.sync()
    await vi.advanceTimersByTimeAsync(20000)
    expect(mockState.disposeCalls).toBe(0)

    // Prolonged 15s tray hide releases dormant WebGL context and bloated atlas.
    mockState.foreground = false
    binding.sync()
    await vi.advanceTimersByTimeAsync(15000)
    expect(mockState.disposeCalls).toBe(1)
    expect(mockState.loseContextCalls).toBe(1)

    // Returning to foreground re-attaches a clean WebGL context.
    mockState.foreground = true
    binding.sync()
    await vi.advanceTimersByTimeAsync(32)
    expect(mockState.instances).toBe(2)

    binding.stop()
  })

  it('immediately releases and refreshes when a context is already lost on foreground wake', async () => {
    vi.resetModules()
    const { terminal } = setupDom()
    const { attachTerminalWebgl } = await import('../../src/renderer/src/services/terminal-webgl')
    const refresh = vi.fn()
    const binding = attachTerminalWebgl(
      terminal as never,
      refresh,
      () => true,
      () => false
    )

    await vi.advanceTimersByTimeAsync(32)
    expect(mockState.instances).toBe(1)
    refresh.mockClear()

    mockState.foreground = false
    binding.sync()
    // Context died while in tray (within grace period).
    mockState.contextLost = true
    mockState.foreground = true
    binding.sync()

    expect(mockState.disposeCalls).toBe(1)
    expect(refresh).toHaveBeenCalledTimes(1)

    mockState.contextLost = false
    await vi.advanceTimersByTimeAsync(32)
    expect(mockState.instances).toBe(2)
    binding.stop()
  })
})
