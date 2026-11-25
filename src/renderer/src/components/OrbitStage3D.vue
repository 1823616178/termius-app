<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { instanceClass } from '../../../shared/classes'
import orbitIcon from '../assets/orbit-icon.svg'
import { t, translateMotionReason } from '../services/i18n'
import { INTRO_SECONDS, MOVEMENT_SECONDS } from '../services/sword-motion'
import { registerMotionScene, type MotionSceneHandle } from '../services/app-foreground'
import { parseMotionTier, REDUCED_MOTION_REASON, type MotionTier } from '../services/motion-performance'
import type { SwordScene, SwordSceneOptions, SwordTipProjection } from '../services/sword-scene'

const props = withDefaults(
  defineProps<{
    variant?: 'welcome' | 'compact'
    state?: string
    active?: boolean
    paused?: boolean
    boost?: boolean
    sheathed?: boolean
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
const swordTipControl = ref<HTMLButtonElement | null>(null)
const adjustingSword = ref(false)
const tipProjection: SwordTipProjection = { x: 0, y: 0, visible: false, tiltDegrees: 0 }
const reducedMotion = ref(false)
const motionTier = ref<MotionTier>('off')
const ready = ref(false)
const dragging = ref(false)
const failed = ref(false)
const canvasKey = ref(0)
const motionDisabled = computed(() => reducedMotion.value || motionTier.value === 'off')
const fallbackVisible = computed(() => !ready.value || failed.value || motionDisabled.value)

const BACKGROUND_RELEASE_MS = 15_000

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
let sceneMotion: MotionSceneHandle | undefined
let attrObserver: MutationObserver | null = null
let resizeObserver: ResizeObserver | null = null
let boundCanvas: HTMLCanvasElement | null = null
let backgroundReleaseTimer: ReturnType<typeof setTimeout> | undefined

function isMotionActive(): boolean {
  return Boolean(sceneMotion?.active)
}

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
    sheathed: props.sheathed,
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
  if (!element || !scene || !isMotionActive() || !element.clientWidth || !element.clientHeight) return
  const width = element.clientWidth
  const height = element.clientHeight
  const dpr = window.devicePixelRatio || 1
  if (!force && width === lastWidth && height === lastHeight && dpr === lastDpr) return
  cancelDrag()
  lastWidth = width
  lastHeight = height
  lastDpr = dpr
  scene.resize(width, height, dpr)
}

function syncSceneOptions(): void {
  if (isMotionActive()) scene?.update(sceneOptions())
}

function canAnimate(): boolean {
  return (
    !disposed &&
    !contextLost &&
    !failed.value &&
    !motionDisabled.value &&
    props.active &&
    !props.paused &&
    isMotionActive()
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
  if (!scene || disposed || !isMotionActive()) return
  try {
    const label = scene.render(elapsedSeconds, introSeconds)
    if (swordTipControl.value) {
      scene.projectSwordTip(tipProjection)
      const control = swordTipControl.value
      control.hidden = !tipProjection.visible
      control.style.transform = `translate3d(${tipProjection.x}px, ${tipProjection.y}px, 0) translate(-50%, -50%)`
      control.dataset.tilt = tipProjection.tiltDegrees.toFixed(1)
    }
    reportPhase(label)
    reportFormation(scene.formationIndex())
  } catch (error) {
    console.warn('3D sword scene render error', error)
    handleFailure()
  }
}

function bindCanvas(next: HTMLCanvasElement | null): void {
  if (boundCanvas === next) return
  if (boundCanvas) {
    resizeObserver?.unobserve(boundCanvas)
    boundCanvas.removeEventListener('webglcontextlost', handleContextLost)
    boundCanvas.removeEventListener('webglcontextrestored', handleContextRestored)
  }
  boundCanvas = next
  if (boundCanvas) {
    resizeObserver?.observe(boundCanvas)
    boundCanvas.addEventListener('webglcontextlost', handleContextLost)
    boundCanvas.addEventListener('webglcontextrestored', handleContextRestored)
  }
}

function clearBackgroundReleaseTimer(): void {
  if (backgroundReleaseTimer !== undefined) {
    clearTimeout(backgroundReleaseTimer)
    backgroundReleaseTimer = undefined
  }
}

function releaseDormantScene(): void {
  clearBackgroundReleaseTimer()
  cancelDrag()
  stopLoop()
  const current = scene
  scene = null
  if (current) {
    bindCanvas(null)
    current.dispose(true)
    canvasKey.value += 1
  }
  ready.value = false
  lastWidth = 0
  lastHeight = 0
}

function handleFailure(): void {
  clearBackgroundReleaseTimer()
  cancelDrag()
  stopLoop()
  scene?.dispose(false)
  scene = null
  failed.value = true
  ready.value = false
  lastWidth = 0
  lastHeight = 0
  reportPhase(t('stage.loadFailed'))
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
  if (!canAnimate()) cancelDrag()
  if (motionDisabled.value) {
    const reason = document.documentElement.dataset.motionReason
    reportPhase(
      reducedMotion.value
        ? t('stage.reducedMotion')
        : reason
          ? translateMotionReason(reason)
          : t('stage.motionOff')
    )
    releaseDormantScene()
    return
  }
  if (!canAnimate()) {
    stopLoop()
    if (scene && (!props.active || !isMotionActive()) && backgroundReleaseTimer === undefined) {
      backgroundReleaseTimer = setTimeout(() => {
        backgroundReleaseTimer = undefined
        if (!canAnimate() && (!props.active || !isMotionActive())) {
          releaseDormantScene()
        }
      }, BACKGROUND_RELEASE_MS)
    }
    return
  }
  clearBackgroundReleaseTimer()
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
  if (loading || scene || failed.value || disposed) return
  loading = true
  reportPhase(t('stage.loading'))
  try {
    await nextTick()
    const { createSwordScene } = await import('../services/sword-scene')
    if (disposed || !canvas.value || !canAnimate()) return
    bindCanvas(canvas.value)
    const created = createSwordScene(canvas.value, sceneOptions())
    if (disposed || !canAnimate()) {
      bindCanvas(null)
      created.dispose(true)
      canvasKey.value += 1
      return
    }
    scene = created
    ready.value = true
    await nextTick()
    if (scene !== created || !isMotionActive()) return
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

function handleContextLost(event: Event): void {
  clearBackgroundReleaseTimer()
  cancelDrag()
  event.preventDefault()
  contextLost = true
  stopLoop()
  scene?.dispose(false)
  scene = null
  ready.value = false
  failed.value = true
  lastWidth = 0
  lastHeight = 0
  reportPhase(t('stage.contextLost'))
}

function handleContextRestored(): void {
  if (disposed) return
  contextLost = false
  failed.value = false
  ready.value = false
  ensureRunning()
}

const DRAG_CLICK_THRESHOLD = 5

let dragPointerId = -1
let dragLastX = 0
let dragLastY = 0
let dragDistance = 0
let suppressNextClick = false

function canOrbit(): boolean {
  return props.variant === 'welcome' && !!scene && !reducedMotion.value && canAnimate()
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0 || dragPointerId !== -1 || !canOrbit()) return
  dragPointerId = event.pointerId
  dragLastX = event.clientX
  dragLastY = event.clientY
  dragDistance = 0
  suppressNextClick = false
  try {
    ;(event.currentTarget as HTMLElement | null)?.setPointerCapture(event.pointerId)
  } catch {
    // Pointer capture is best-effort; dragging still works inside the stage.
  }
  const rect = canvas.value!.getBoundingClientRect()
  adjustingSword.value = scene!.beginSwordTilt(event.clientX - rect.left, event.clientY - rect.top)
  if (!adjustingSword.value) scene?.beginOrbit()
  dragging.value = true
}

function endDrag(event: PointerEvent): void {
  if (event.pointerId !== dragPointerId) return
  dragPointerId = -1
  dragging.value = false
  suppressNextClick = adjustingSword.value || dragDistance > DRAG_CLICK_THRESHOLD
  try {
    ;(event.currentTarget as HTMLElement | null)?.releasePointerCapture(event.pointerId)
  } catch {
    // Capture may already be released by the browser.
  }
  if (adjustingSword.value) scene?.endSwordTilt(event.type !== 'pointerup')
  else scene?.endOrbit()
  adjustingSword.value = false
}

function cancelDrag(): void {
  if (dragPointerId === -1) return
  const pointerId = dragPointerId
  dragPointerId = -1
  scene?.endSwordTilt(true)
  scene?.endOrbit()
  dragging.value = false
  adjustingSword.value = false
  suppressNextClick = true
  const host = canvas.value?.parentElement
  if (host?.hasPointerCapture(pointerId)) host.releasePointerCapture(pointerId)
}

function onPointerMove(event: PointerEvent): void {
  const element = canvas.value
  if (!element || !scene || reducedMotion.value) return
  const rect = element.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  if (event.pointerId === dragPointerId) {
    const dx = event.clientX - dragLastX
    const dy = event.clientY - dragLastY
    dragLastX = event.clientX
    dragLastY = event.clientY
    dragDistance += Math.hypot(dx, dy)
    if (adjustingSword.value) scene.moveSwordTilt(event.clientX - rect.left, event.clientY - rect.top)
    else scene.orbitBy(dx, dy)
  }
  if (adjustingSword.value) return
  scene.setPointer(
    ((event.clientX - rect.left) / rect.width - 0.5) * 2,
    -((event.clientY - rect.top) / rect.height - 0.5) * 2
  )
}

function onSwordTipKeydown(event: KeyboardEvent): void {
  if (!canOrbit() || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
  event.preventDefault()
  event.stopPropagation()
  const step = event.shiftKey ? 24 : 8
  const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
  const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
  scene!.projectSwordTip(tipProjection)
  if (scene!.beginSwordTilt(tipProjection.x, tipProjection.y)) {
    scene!.moveSwordTilt(tipProjection.x + dx, tipProjection.y + dy)
    scene!.endSwordTilt()
    renderCurrentFrame()
  }
}

function onPointerLeave(): void {
  scene?.setPointer(0, 0)
}

function onWheel(event: WheelEvent): void {
  if (!canOrbit()) return
  event.preventDefault()
  if (adjustingSword.value) return
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? lastHeight : 1
  scene?.zoomBy(event.deltaY * unit)
}

function onStageDoubleClick(): void {
  if (canOrbit()) scene?.resetView()
}

function onStageClick(event: MouseEvent): void {
  if (suppressNextClick || event.target === swordTipControl.value) {
    suppressNextClick = false
    return
  }
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

function resetView(): void {
  scene?.resetView()
}

defineExpose({
  fallbackVisible,
  replayIntro,
  jumpToClimax,
  jumpToFormation,
  resetView,
  triggerBurst
})

onMounted(() => {
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
  bindCanvas(canvas.value)
  sceneMotion = registerMotionScene(ensureRunning)
  ensureRunning()
})

watch(canvas, (next) => {
  if (!disposed) bindCanvas(next)
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
  () => [props.active, props.paused, props.state, props.boost, props.variant, props.sheathed],
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
  clearBackgroundReleaseTimer()
  cancelDrag()
  disposed = true
  sceneMotion?.dispose()
  sceneMotion = undefined
  stopLoop()
  attrObserver?.disconnect()
  bindCanvas(null)
  resizeObserver?.disconnect()
  scene?.dispose(true)
  scene = null
})
</script>

<template>
  <div
    :class="c('container_workspace_orbit_body_stage')"
    :data-variant="variant"
    :data-state="state"
    :data-ready="ready && !fallbackVisible"
    :data-dragging="dragging"
    :data-adjusting-sword="adjustingSword"
    :aria-hidden="variant === 'compact' ? true : undefined"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="endDrag"
    @pointercancel="endDrag"
    @lostpointercapture="endDrag"
    @pointerleave="onPointerLeave"
    @wheel="onWheel"
    @dblclick="onStageDoubleClick"
    @click="onStageClick"
    @keydown.esc.prevent="cancelDrag"
  >
    <canvas
      :key="canvasKey"
      v-show="!fallbackVisible"
      ref="canvas"
      :class="c('container_workspace_orbit_body_canvas')"
      aria-hidden="true"
    />
    <button
      v-if="variant === 'welcome' && !fallbackVisible"
      ref="swordTipControl"
      :class="c('container_workspace_orbit_body_sword-tip')"
      type="button"
      hidden
      :aria-label="t('welcome.swordTipAria')"
      :title="t('welcome.swordTipTitle')"
      @keydown="onSwordTipKeydown"
    />
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
  &[data-variant='welcome'][data-ready='true'] {
    cursor: grab;
    &[data-dragging='true'] {
      cursor: grabbing;
    }
    &[data-adjusting-sword='true'] {
      cursor: move;
    }
  }
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
[class*='container_workspace_orbit_body_sword-tip'] {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 1;
  width: 36px;
  height: 36px;
  min-height: 0;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  cursor: move;
  touch-action: none;
  // Screen tracking must not inherit the generic button transform transition.
  transition: background 160ms ease;
  &[hidden] {
    display: none;
  }
  &::after {
    content: '';
    position: absolute;
    inset: 10px;
    border: 1px solid var(--color-accent-primary);
    border-radius: 50%;
    opacity: 0.45;
    transition:
      opacity 160ms ease,
      transform 160ms ease;
  }
  &:hover:not(:disabled),
  &:active:not(:disabled),
  &:focus-visible {
    background: var(--color-accent-primary-soft);
    &::after {
      opacity: 1;
      transform: scale(1.3);
    }
  }
  [data-adjusting-sword='true'] & {
    background: var(--color-accent-primary-soft);
    &::after {
      opacity: 1;
      transform: scale(1.3);
    }
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
