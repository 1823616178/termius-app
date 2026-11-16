<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { instanceClass } from '../../../shared/classes'
import orbitIcon from '../assets/orbit-icon.svg'
import { INTRO_SECONDS, MOVEMENT_SECONDS } from '../services/sword-motion'
import { parseMotionTier, REDUCED_MOTION_REASON, type MotionTier } from '../services/motion-performance'
import type { SwordScene, SwordSceneOptions } from '../services/sword-scene'

const props = withDefaults(
  defineProps<{
    variant?: 'welcome' | 'compact'
    state?: string
    active?: boolean
    paused?: boolean
    boost?: boolean
    instance?: string
    onFrameRate?: (fps: number) => void
  }>(),
  {
    variant: 'welcome',
    state: 'idle',
    active: true,
    paused: false,
    boost: false,
    instance: 'main'
  }
)

const emit = defineEmits<{
  phase: [label: string]
  formation: [index: number]
}>()

const c = (base: string) => instanceClass(base, props.instance)
const canvas = ref<HTMLCanvasElement | null>(null)
const reducedMotion = ref(false)
const motionTier = ref<MotionTier>('off')
const ready = ref(false)
const failed = ref(false)
const motionDisabled = computed(() => reducedMotion.value || motionTier.value === 'off')
const fallbackVisible = computed(() => !ready.value || failed.value || motionDisabled.value)

let scene: SwordScene | null = null
let rafId = 0
let lastTick = 0
let lastRenderTick = 0
let frameSeconds = 0
let sampleStarted = 0
let sampledFrames = 0
let motionGeneration = ''
let contextLost = false
let elapsedSeconds = 0
let introSeconds = 0
let lastPhaseLabel = ''
let lastFormationIndex = -1
let lastWidth = 0
let lastHeight = 0
let lastDpr = 0
let loading = false
let disposed = false
let visible = true
let attrObserver: MutationObserver | null = null
let resizeObserver: ResizeObserver | null = null

function cssColor(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = styles.getPropertyValue(name).trim()
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback
}

function sceneOptions(): SwordSceneOptions {
  const styles = getComputedStyle(document.documentElement)
  return {
    variant: props.variant,
    tier: motionTier.value === 'light' ? 'light' : 'full',
    state: props.state,
    boost: props.boost,
    palette: {
      accentA: cssColor(styles, '--color-accent-primary', '#d4af63'),
      accentB: cssColor(styles, '--color-accent-secondary', '#5ec4a6'),
      seal: cssColor(styles, '--color-seal', '#c94c38'),
      text: cssColor(styles, '--color-text-primary', '#efe9da'),
      bg: cssColor(styles, '--color-app-bg', '#080b0a')
    }
  }
}

function resizeScene(force = false): void {
  const element = canvas.value
  if (!element || !scene || !element.clientWidth || !element.clientHeight) return
  const width = element.clientWidth
  const height = element.clientHeight
  const dpr = window.devicePixelRatio || 1
  if (!force && width === lastWidth && height === lastHeight && dpr === lastDpr) return
  lastWidth = width
  lastHeight = height
  lastDpr = dpr
  scene.resize(width, height, dpr)
}

function syncSceneOptions(): void {
  scene?.update(sceneOptions())
}

function canAnimate(): boolean {
  return (
    !disposed &&
    !contextLost &&
    !failed.value &&
    !motionDisabled.value &&
    props.active &&
    !props.paused &&
    visible
  )
}

function stopLoop(): void {
  if (rafId) cancelAnimationFrame(rafId)
  rafId = 0
  lastTick = 0
  lastRenderTick = 0
  frameSeconds = 0
  sampleStarted = 0
  sampledFrames = 0
}

function reportPhase(label: string): void {
  if (label && label !== lastPhaseLabel) {
    lastPhaseLabel = label
    emit('phase', label)
  }
}

function reportFormation(index: number): void {
  if (index !== lastFormationIndex) {
    lastFormationIndex = index
    emit('formation', index)
  }
}

function renderCurrentFrame(): void {
  if (!scene || disposed) return
  try {
    const label = scene.render(elapsedSeconds, introSeconds)
    reportPhase(label)
    reportFormation(scene.formationIndex())
  } catch (error) {
    console.warn('3D sword scene render error', error)
    handleFailure()
  }
}

function handleFailure(): void {
  stopLoop()
  scene?.dispose(false)
  scene = null
  failed.value = true
  ready.value = false
  lastWidth = 0
  lastHeight = 0
  reportPhase('剑境加载失败 · 点击重展剑境重试')
}

function tick(now: number): void {
  rafId = 0
  if (!scene || !canAnimate()) return
  const delta = lastTick ? Math.min(0.1, Math.max(0, (now - lastTick) / 1000)) : 0
  lastTick = now
  frameSeconds += delta
  const interval = 1000 / (motionTier.value === 'light' || props.variant === 'compact' ? 30 : 60)
  if (!lastRenderTick || now - lastRenderTick >= interval - 0.5) {
    elapsedSeconds += frameSeconds
    introSeconds = Math.min(INTRO_SECONDS, introSeconds + frameSeconds)
    frameSeconds = 0
    lastRenderTick = now
    renderCurrentFrame()
    if (props.variant === 'welcome' && scene && canAnimate()) {
      if (!sampleStarted) sampleStarted = now
      sampledFrames += 1
      const sampleDuration = now - sampleStarted
      if (sampleDuration >= 3000) {
        const fps = (sampledFrames * 1000) / sampleDuration
        sampleStarted = now
        sampledFrames = 0
        props.onFrameRate?.(fps)
      }
    }
  }
  if (canAnimate() && scene) {
    rafId = requestAnimationFrame(tick)
  }
}

function ensureRunning(): void {
  if (motionDisabled.value) {
    const reason = document.documentElement.dataset.motionReason
    reportPhase(
      reducedMotion.value ? '系统已开启减少动态效果 · 静态展示' : reason || '动效已关闭 · 可在设置中开启'
    )
    stopLoop()
    if (scene) {
      scene.dispose(false)
      scene = null
    }
    ready.value = false
    return
  }
  if (!canAnimate()) {
    stopLoop()
    return
  }
  if (!scene) {
    void initializeScene()
    return
  }
  syncSceneOptions()
  resizeScene()
  if (!rafId) {
    lastTick = performance.now()
    sampleStarted = lastTick
    rafId = requestAnimationFrame(tick)
  }
}

async function initializeScene(): Promise<void> {
  if (loading || scene || failed.value || disposed || !canvas.value) return
  loading = true
  reportPhase('剑境加载中')
  try {
    const { createSwordScene } = await import('../services/sword-scene')
    if (disposed || !canvas.value || !canAnimate()) return
    const created = createSwordScene(canvas.value, sceneOptions())
    if (disposed || !canAnimate()) {
      created.dispose(false)
      return
    }
    scene = created
    ready.value = true
    await nextTick()
    if (disposed) {
      scene?.dispose()
      scene = null
      return
    }
    if (!canAnimate()) {
      resizeScene(true)
      renderCurrentFrame()
      return
    }
    syncSceneOptions()
    resizeScene(true)
    renderCurrentFrame()
    ensureRunning()
  } catch (error) {
    console.warn('3D sword scene unavailable', error)
    handleFailure()
  } finally {
    loading = false
  }
}

function readPreferences(): void {
  const root = document.documentElement
  const nextTier = parseMotionTier(root.dataset.motion)
  const nextGeneration = root.dataset.motionGeneration ?? ''
  if (nextTier !== motionTier.value || nextGeneration !== motionGeneration) {
    sampleStarted = 0
    sampledFrames = 0
    motionGeneration = nextGeneration
  }
  motionTier.value = nextTier
  reducedMotion.value =
    root.dataset.motionPreference !== 'full' && root.dataset.motionReason === REDUCED_MOTION_REASON
}

function handleMotionChange(): void {
  readPreferences()
  // v-show must reveal the canvas before measuring its dimensions.
  void nextTick(() => {
    syncSceneOptions()
    resizeScene(true)
    ensureRunning()
  })
}

function handleVisibilityChange(): void {
  visible = document.visibilityState !== 'hidden'
  ensureRunning()
}

function handleContextLost(event: Event): void {
  event.preventDefault()
  contextLost = true
  stopLoop()
  scene?.dispose(false)
  scene = null
  ready.value = false
  failed.value = true
  lastWidth = 0
  lastHeight = 0
  reportPhase('图形连接中断 · 等待恢复')
}

function handleContextRestored(): void {
  if (disposed) return
  contextLost = false
  failed.value = false
  ready.value = false
  ensureRunning()
}

function onPointerMove(event: PointerEvent): void {
  const element = canvas.value
  if (!element || !scene || reducedMotion.value) return
  const rect = element.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  scene.setPointer(
    ((event.clientX - rect.left) / rect.width - 0.5) * 2,
    -((event.clientY - rect.top) / rect.height - 0.5) * 2
  )
}

function onPointerLeave(): void {
  scene?.setPointer(0, 0)
}

function onStageClick(): void {
  if (props.variant === 'welcome' && canAnimate()) {
    scene?.triggerPulse()
  }
}

function replayIntro(): void {
  if (!contextLost) failed.value = false
  stopLoop()
  elapsedSeconds = 0
  introSeconds = 0
  lastPhaseLabel = ''
  lastFormationIndex = -1
  if (scene && !disposed) {
    renderCurrentFrame()
  }
  ensureRunning()
}

function jumpToClimax(): void {
  if (!contextLost) failed.value = false
  stopLoop()
  introSeconds = INTRO_SECONDS
  elapsedSeconds = 2
  lastPhaseLabel = ''
  scene?.triggerPulse()
  if (scene && !disposed) {
    renderCurrentFrame()
  }
  ensureRunning()
}

function jumpToFormation(index: number): void {
  if (!contextLost) failed.value = false
  stopLoop()
  introSeconds = INTRO_SECONDS
  elapsedSeconds = index * MOVEMENT_SECONDS + MOVEMENT_SECONDS * 0.5
  lastPhaseLabel = ''
  if (scene && !disposed) {
    renderCurrentFrame()
  }
  ensureRunning()
}

function triggerBurst(): void {
  scene?.triggerPulse()
}

defineExpose({
  replayIntro,
  jumpToClimax,
  jumpToFormation,
  triggerBurst
})

onMounted(() => {
  visible = document.visibilityState !== 'hidden'
  readPreferences()
  attrObserver = new MutationObserver(() => {
    handleMotionChange()
  })
  attrObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [
      'data-motion',
      'data-motion-preference',
      'data-motion-generation',
      'data-contrast',
      'data-ui-theme',
      'style'
    ]
  })
  resizeObserver = new ResizeObserver(() => resizeScene())
  if (canvas.value) {
    resizeObserver.observe(canvas.value)
    canvas.value.addEventListener('webglcontextlost', handleContextLost)
    canvas.value.addEventListener('webglcontextrestored', handleContextRestored)
  }
  document.addEventListener('visibilitychange', handleVisibilityChange)
  ensureRunning()
})

watch(
  () => props.boost,
  (next, prev) => {
    if (next && !prev && props.variant === 'welcome') {
      scene?.triggerPulse()
    }
  }
)

watch(
  () => [props.active, props.paused, props.state, props.boost, props.variant],
  ([nextActive], [prevActive]) => {
    if (nextActive && !prevActive) {
      lastTick = performance.now()
    }
    syncSceneOptions()
    resizeScene()
    ensureRunning()
  }
)

onBeforeUnmount(() => {
  disposed = true
  stopLoop()
  attrObserver?.disconnect()
  resizeObserver?.disconnect()
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  canvas.value?.removeEventListener('webglcontextlost', handleContextLost)
  canvas.value?.removeEventListener('webglcontextrestored', handleContextRestored)
  scene?.dispose()
  scene = null
})
</script>

<template>
  <div
    :class="c('container_workspace_orbit_body_stage')"
    :data-variant="variant"
    :data-state="state"
    :data-ready="ready && !fallbackVisible"
    aria-hidden="true"
    @pointermove="onPointerMove"
    @pointerleave="onPointerLeave"
    @click="onStageClick"
  >
    <canvas v-show="!fallbackVisible" ref="canvas" :class="c('container_workspace_orbit_body_canvas')" />
    <img
      v-if="fallbackVisible"
      :class="c('container_workspace_orbit_body_fallback')"
      :src="orbitIcon"
      alt=""
      draggable="false"
    />
  </div>
</template>

<style scoped lang="scss">
[class*='container_workspace_orbit_body_stage'] {
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  min-height: 300px;
  margin: 0;
  user-select: none;
  touch-action: none;
  isolation: isolate;
  &[data-variant='compact'] {
    width: 108px;
    height: 92px;
    min-height: 92px;
  }
}
[class*='container_workspace_orbit_body_canvas'] {
  width: 100%;
  height: 100%;
  display: block;
  [data-ready='true'] & {
    animation: orbit-stage-reveal 420ms cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  [data-variant='compact'] & {
    filter: drop-shadow(0 6px 14px rgba(0, 0, 0, 0.45));
  }
}
[class*='container_workspace_orbit_body_fallback'] {
  width: clamp(92px, 18vw, 210px);
  height: auto;
  opacity: 0.82;
  filter: drop-shadow(0 0 28px var(--color-accent-secondary-glow));
  [data-variant='compact'] & {
    width: 68px;
  }
}
@keyframes orbit-stage-reveal {
  from {
    opacity: 0;
    transform: scale(0.97);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
</style>
