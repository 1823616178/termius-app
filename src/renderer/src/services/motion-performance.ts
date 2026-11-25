export type MotionTier = 'full' | 'light' | 'off'
export type MotionPreference = 'auto' | MotionTier

export interface MotionEnvironment {
  webgl2Supported: boolean
  renderer?: string
  hardwareConcurrency?: number
  deviceMemory?: number
  reducedMotion?: boolean
}

export interface MotionCapability {
  tier: MotionTier
  reason: string
  webgl2Supported: boolean
  softwareRenderer: boolean
  cpuCores: number | null
  memoryGb: number | null
}

export interface MotionFrameSample {
  tier: MotionTier
  fps: number
  slowWindows: number
  reason: string
}

export const REDUCED_MOTION_REASON = '系统已开启减少动态效果，已自动关闭'

export function parseMotionPreference(value: string | null): MotionPreference {
  return value === 'full' || value === 'light' || value === 'off' ? value : 'auto'
}

export function parseMotionTier(value: string | undefined): MotionTier {
  return value === 'full' || value === 'light' ? value : 'off'
}

export function isSoftwareRenderer(renderer: string): boolean {
  return /swiftshader|llvmpipe|softpipe|lavapipe|software|basic render/i.test(renderer)
}

function optionalPositiveNumber(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

export function assessMotionCapability(input: MotionEnvironment): MotionCapability {
  const cpuCores = optionalPositiveNumber(input.hardwareConcurrency)
  const memoryGb = optionalPositiveNumber(input.deviceMemory)
  const softwareRenderer = isSoftwareRenderer(input.renderer ?? '')
  const base = {
    webgl2Supported: input.webgl2Supported,
    softwareRenderer,
    cpuCores,
    memoryGb
  }
  if (input.reducedMotion) {
    return { ...base, tier: 'off', reason: REDUCED_MOTION_REASON }
  }
  if (!input.webgl2Supported) {
    return { ...base, tier: 'off', reason: '未检测到可用的 WebGL2，已关闭 3D 动效' }
  }
  if (softwareRenderer) {
    return { ...base, tier: 'off', reason: '检测到软件渲染器，已关闭 3D 动效以节省资源' }
  }
  if ((cpuCores !== null && cpuCores <= 2) || (memoryGb !== null && memoryGb <= 2)) {
    return { ...base, tier: 'off', reason: '设备处理器或内存资源不足，已自动关闭动效' }
  }
  if ((cpuCores !== null && cpuCores <= 4) || (memoryGb !== null && memoryGb <= 4)) {
    return { ...base, tier: 'light', reason: '设备资源有限，已自动启用轻量动效' }
  }
  return { ...base, tier: 'full', reason: '图形与设备性能初检通过，将按实际帧率调整' }
}

export function resolveMotionPreference(
  preference: MotionPreference,
  capability: MotionCapability
): Pick<MotionFrameSample, 'tier' | 'reason'> {
  if (preference === 'full') {
    return { tier: 'full', reason: '已强制开启完整动效，不会自动降级' }
  }
  if (preference === 'light') {
    return { tier: 'light', reason: '已手动选择轻量动效，不会自动降级' }
  }
  if (preference === 'off') {
    return { tier: 'off', reason: '已手动关闭动效' }
  }
  return { tier: capability.tier, reason: capability.reason }
}

export function sampleMotionFrame(
  input: Pick<MotionFrameSample, 'tier' | 'fps' | 'slowWindows'>
): MotionFrameSample {
  const fps = Math.round(Math.max(0, input.fps))
  if (input.tier === 'off') {
    return { tier: 'off', fps, slowWindows: 0, reason: '动效已关闭' }
  }
  const nextTier =
    input.tier === 'full' && fps < 42 ? 'light' : input.tier === 'light' && fps < 24 ? 'off' : null
  if (!nextTier) {
    return { tier: input.tier, fps, slowWindows: 0, reason: `实测 ${fps} fps，运行正常` }
  }
  const slowWindows = input.slowWindows + 1
  if (slowWindows < 2) {
    return { tier: input.tier, fps, slowWindows, reason: `实测 ${fps} fps，继续观察性能` }
  }
  return {
    tier: nextTier,
    fps,
    slowWindows: 0,
    reason: nextTier === 'light' ? '实测帧率持续偏低，已切换轻量动效' : '实测帧率持续偏低，已关闭动效'
  }
}

export function probeMotionGraphics(
  canvas: HTMLCanvasElement
): Pick<MotionEnvironment, 'webgl2Supported' | 'renderer'> {
  let gl: WebGL2RenderingContext | null = null
  try {
    gl = canvas.getContext('webgl2')
    if (!gl) return { webgl2Supported: false }
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info') as {
      UNMASKED_RENDERER_WEBGL: number
    } | null
    const renderer = String(gl.getParameter(debugInfo?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER))
    return { webgl2Supported: true, renderer }
  } catch {
    return { webgl2Supported: false }
  } finally {
    try {
      gl?.getExtension('WEBGL_lose_context')?.loseContext()
    } catch {
      /* The temporary context will be reclaimed with its canvas. */
    }
  }
}
