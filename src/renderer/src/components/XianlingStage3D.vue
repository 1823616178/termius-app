<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { instanceClass } from '../../../shared/classes'
import orbitIcon from '../assets/orbit-icon.svg'
import { isAppForeground, onAppForegroundChange } from '../services/app-foreground'
import { t, translateMotionReason } from '../services/i18n'
import { parseMotionTier, REDUCED_MOTION_REASON, type MotionTier } from '../services/motion-performance'
import type { FrameCallback, XianlingTheatre } from '../services/xianling/theatre'

const props = withDefaults(
  defineProps<{
    active?: boolean
    examining?: boolean
    instance?: string
    onFrameRate?: (fps: number) => void
  }>(),
  {
    active: true,
    examining: false,
    instance: 'main'
  }
)

const emit = defineEmits<{
  status: [message: string]
  readyChange: [ready: boolean]
  failedChange: [failed: boolean]
}>()

const c = (base: string) => instanceClass(base, props.instance)
const hostRef = ref<HTMLElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const tipHandleRef = ref<HTMLElement | null>(null)
const tipLabelRef = ref<HTMLElement | null>(null)
const swordHandleRef = ref<HTMLElement | null>(null)
const sheathHandleRef = ref<HTMLElement | null>(null)

const reducedMotion = ref(false)
const motionTier = ref<MotionTier>('off')
const ready = ref(false)
const failed = ref(false)
const motionDisabled = computed(() => reducedMotion.value || motionTier.value === 'off')
const fallbackVisible = computed(() => !ready.value || failed.value || motionDisabled.value)

let theatre: XianlingTheatre | null = null
let frameHandler: FrameCallback = () => {}
let motionGeneration = ''
let contextLost = false
let loading = false
let disposed = false
let visible = isAppForeground()
let stopForeground: (() => void) | undefined
let resumeTimer = 0
let attrObserver: MutationObserver | null = null
let resizeObserver: ResizeObserver | null = null
let lastWidth = 0
let lastHeight = 0
let lastDpr = 0

// Remember user state so context recovery / motion toggle restores seamlessly
let desiredFormation = 0
let desiredInspect = -1
let desiredChorus = false
let desiredDance = false
let desiredOrbit = false
let desiredPaused = false
let desiredRotationSpeed = 1

function isReducedMotionActive(): boolean {
  const root = document.documentElement
  return (
    root.dataset.motionPreference !== 'full' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function canAnimate(): boolean {
  return !disposed && !contextLost && !failed.value && !motionDisabled.value && props.active && visible
}

function syncReadyState(): void {
  emit('readyChange', ready.value && !fallbackVisible.value)
  emit('failedChange', failed.value)
}

function resizeStage(force = false): void {
  const host = hostRef.value
  if (!host || !theatre) return
  const width = host.clientWidth
  const height = host.clientHeight
  if (!width || !height) return
  const dpr = window.devicePixelRatio || 1
  if (!force && width === lastWidth && height === lastHeight && dpr === lastDpr) return
  lastWidth = width
  lastHeight = height
  lastDpr = dpr
  theatre.resize(width, height, dpr)
}

function handleFailure(): void {
  theatre?.dispose(false)
  theatre = null
  failed.value = true
  ready.value = false
  lastWidth = 0
  lastHeight = 0
  syncReadyState()
  emit('status', t('stage.loadFailed'))
}

async function initializeTheatre(): Promise<void> {
  if (
    loading ||
    theatre ||
    failed.value ||
    disposed ||
    !hostRef.value ||
    !canvasRef.value ||
    !tipHandleRef.value ||
    !tipLabelRef.value ||
    !swordHandleRef.value ||
    !sheathHandleRef.value
  ) {
    return
  }
  loading = true
  emit('status', t('stage.loading'))
  try {
    const { createXianlingTheatre } = await import('../services/xianling/theatre')
    if (disposed || !hostRef.value || !canvasRef.value || !canAnimate()) return
    const created = createXianlingTheatre({
      host: hostRef.value,
      canvas: canvasRef.value,
      handles: {
        tipHandle: tipHandleRef.value,
        tipLabel: tipLabelRef.value,
        swordHandle: swordHandleRef.value,
        sheathHandle: sheathHandleRef.value,
        getTipLabels: () => ({
          idle: t('xianling.tipIdle'),
          aiming: t('xianling.tipAiming')
        })
      },
      tier: motionTier.value === 'light' ? 'light' : 'full',
      isReducedMotion: isReducedMotionActive,
      onFrameRate: props.onFrameRate
    })
    if (disposed || !canAnimate()) {
      created.dispose(false)
      return
    }
    theatre = created
    theatre.onframe(frameHandler)
    if (desiredFormation !== 0) theatre.choose(desiredFormation)
    if (desiredChorus) theatre.setChorus(true)
    if (desiredDance) theatre.setDance(true)
    if (desiredOrbit) theatre.orbit(true)
    if (desiredRotationSpeed !== 1) theatre.rotationSpeed(desiredRotationSpeed)
    if (desiredPaused) theatre.pause(true)
    if (desiredInspect >= 0) theatre.inspect(desiredInspect)

    ready.value = true
    syncReadyState()
    await nextTick()
    if (disposed) {
      theatre?.dispose(false)
      theatre = null
      return
    }
    resizeStage(true)
    theatre.setSuspended(!canAnimate())
  } catch (error) {
    console.warn('Xianling 3D theatre unavailable', error)
    handleFailure()
  } finally {
    loading = false
  }
}

function ensureRunning(): void {
  if (motionDisabled.value) {
    const reason = document.documentElement.dataset.motionReason
    emit(
      'status',
      reducedMotion.value
        ? t('stage.reducedMotion')
        : reason
          ? translateMotionReason(reason)
          : t('stage.motionOff')
    )
    if (theatre) {
      theatre.dispose(false)
      theatre = null
    }
    ready.value = false
    lastWidth = 0
    lastHeight = 0
    syncReadyState()
    return
  }
  if (!canAnimate()) {
    theatre?.setSuspended(true)
    return
  }
  if (!theatre) {
    void initializeTheatre()
    return
  }
  theatre.setTier(motionTier.value === 'light' ? 'light' : 'full')
  resizeStage()
  theatre.setSuspended(false)
}

function readPreferences(): void {
  const root = document.documentElement
  const nextTier = parseMotionTier(root.dataset.motion)
  const nextGeneration = root.dataset.motionGeneration ?? ''
  if (nextTier !== motionTier.value || nextGeneration !== motionGeneration) {
    motionGeneration = nextGeneration
    theatre?.resetFpsSampling()
  }
  motionTier.value = nextTier
  reducedMotion.value =
    root.dataset.motionPreference !== 'full' && root.dataset.motionReason === REDUCED_MOTION_REASON
}

function handleMotionChange(): void {
  readPreferences()
  void nextTick(() => {
    ensureRunning()
  })
}

function applyForeground(active: boolean, immediate = false): void {
  visible = active
  window.clearTimeout(resumeTimer)
  resumeTimer = 0
  if (!active || immediate) {
    ensureRunning()
    return
  }
  resumeTimer = window.setTimeout(() => {
    resumeTimer = 0
    if (visible) ensureRunning()
  }, 500)
}

function handleContextLost(event: Event): void {
  event.preventDefault()
  contextLost = true
  theatre?.dispose(false)
  theatre = null
  ready.value = false
  failed.value = true
  lastWidth = 0
  lastHeight = 0
  syncReadyState()
  emit('status', t('stage.contextLost'))
}

function handleContextRestored(): void {
  if (disposed) return
  contextLost = false
  failed.value = false
  ready.value = false
  syncReadyState()
  ensureRunning()
}

function retryInit(): void {
  if (!contextLost) failed.value = false
  ready.value = false
  syncReadyState()
  ensureRunning()
}

function onTipKeydown(event: KeyboardEvent): void {
  if (!theatre || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
  event.preventDefault()
  event.stopPropagation()
  const step = event.shiftKey ? 24 : 8
  const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
  const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
  theatre.nudgeTip(dx, dy)
}

function choose(index: number): void {
  desiredFormation = index
  theatre?.choose(index)
}
function inspect(partIndex: number): void {
  desiredInspect = partIndex
  theatre?.inspect(partIndex)
}
function setChorus(v: boolean): void {
  desiredChorus = v
  theatre?.setChorus(v)
}
function setDance(v: boolean): void {
  desiredDance = v
  theatre?.setDance(v)
}
function actuate(type: 'sheath' | 'recall' | 'cast'): void {
  desiredPaused = false
  theatre?.actuate(type)
}
function cast(): void {
  desiredPaused = false
  theatre?.cast()
}
function exchange(): void {
  desiredPaused = false
  theatre?.exchange()
}
function swordExchange(): void {
  desiredPaused = false
  theatre?.swordExchange()
}
function fusion(): void {
  desiredPaused = false
  theatre?.fusion()
}
function reset(): void {
  theatre?.reset()
}
function zoom(multiplier: number): void {
  theatre?.zoom(multiplier)
}
function orbit(v: boolean): void {
  desiredOrbit = v
  theatre?.orbit(v)
}
function rotationSpeed(v: number): void {
  desiredRotationSpeed = v
  theatre?.rotationSpeed(v)
}
function pause(v: boolean): void {
  desiredPaused = v
  theatre?.pause(v)
}
function setFrameCallback(fn: FrameCallback): void {
  frameHandler = fn
  theatre?.onframe(fn)
}

defineExpose({
  fallbackVisible,
  failed,
  ready,
  choose,
  inspect,
  setChorus,
  setDance,
  actuate,
  cast,
  exchange,
  swordExchange,
  fusion,
  reset,
  zoom,
  orbit,
  rotationSpeed,
  pause,
  retryInit,
  setFrameCallback
})

onMounted(() => {
  visible = isAppForeground()
  stopForeground = onAppForegroundChange((active) => applyForeground(active))
  readPreferences()
  attrObserver = new MutationObserver(() => {
    handleMotionChange()
  })
  attrObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-motion', 'data-motion-preference', 'data-motion-generation']
  })
  resizeObserver = new ResizeObserver(() => resizeStage())
  if (hostRef.value) resizeObserver.observe(hostRef.value)
  if (canvasRef.value) {
    canvasRef.value.addEventListener('webglcontextlost', handleContextLost)
    canvasRef.value.addEventListener('webglcontextrestored', handleContextRestored)
  }
  ensureRunning()
})

watch(
  () => props.active,
  () => {
    ensureRunning()
  }
)

watch(
  () => props.examining,
  () => {
    void nextTick(() => resizeStage(true))
  }
)

onBeforeUnmount(() => {
  disposed = true
  window.clearTimeout(resumeTimer)
  stopForeground?.()
  attrObserver?.disconnect()
  resizeObserver?.disconnect()
  canvasRef.value?.removeEventListener('webglcontextlost', handleContextLost)
  canvasRef.value?.removeEventListener('webglcontextrestored', handleContextRestored)
  theatre?.dispose(false)
  theatre = null
})
</script>

<template>
  <div
    ref="hostRef"
    :class="c('container_workspace_xianling_stage_base')"
    data-variant="welcome"
    :data-ready="ready && !fallbackVisible"
    :data-examining="examining"
    data-dragging="false"
    data-adjusting-sword="false"
    :aria-label="t('xianling.stageAria')"
    @keydown.esc="theatre?.cancelDrag()"
  >
    <canvas
      v-show="!fallbackVisible"
      ref="canvasRef"
      :class="c('container_workspace_xianling_stage_canvas')"
      aria-hidden="true"
    />
    <button
      ref="tipHandleRef"
      :class="c('container_workspace_xianling_stage_tip-handle')"
      type="button"
      hidden
      :aria-label="t('welcome.swordTipAria')"
      :title="t('welcome.swordTipTitle')"
      @keydown="onTipKeydown"
    >
      <span :class="c('container_workspace_xianling_stage_tip-ring')" aria-hidden="true" />
      <span ref="tipLabelRef" :class="c('container_workspace_xianling_stage_tip-label')" aria-hidden="true">
        {{ t('xianling.tipIdle') }}
      </span>
    </button>
    <div
      ref="swordHandleRef"
      :class="c('container_workspace_xianling_stage_sword-handle')"
      hidden
      aria-hidden="true"
    >
      <span :class="c('container_workspace_xianling_stage_sword-icon')">✥</span>
      <span :class="c('container_workspace_xianling_stage_sword-label')">{{ t('xianling.dragSword') }}</span>
    </div>
    <div
      ref="sheathHandleRef"
      :class="c('container_workspace_xianling_stage_sheath-handle')"
      hidden
      aria-hidden="true"
    >
      <span :class="c('container_workspace_xianling_stage_sheath-icon')">✥</span>
      <span :class="c('container_workspace_xianling_stage_sheath-label')">
        {{ t('xianling.dragSheath') }}
      </span>
    </div>
    <img
      v-if="fallbackVisible"
      :class="c('container_workspace_xianling_stage_fallback')"
      :src="orbitIcon"
      alt=""
      draggable="false"
    />
  </div>
</template>

<style scoped lang="scss">
[class*='container_workspace_xianling_stage_base'] {
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  min-height: 0;
  margin: 0;
  user-select: none;
  touch-action: none;
  isolation: isolate;
  cursor: grab;
  &:active,
  &[data-dragging='true'],
  &[data-aiming-blade='true'],
  &[data-moving-object='true'] {
    cursor: grabbing;
  }
  &[data-over-tip='true'] {
    cursor: crosshair;
  }
}
[class*='container_workspace_xianling_stage_canvas'] {
  width: 100%;
  height: 100%;
  display: block;
}
[class*='container_workspace_xianling_stage_tip-handle'] {
  position: absolute;
  z-index: 2;
  width: 18px;
  height: 18px;
  min-height: 0;
  padding: 0;
  border: 0;
  background: transparent;
  transform: translate(-50%, -50%);
  display: grid;
  place-items: center;
  color: #d5ecee;
  pointer-events: none;
  transition: none;
  &[hidden] {
    display: none;
  }
  &:focus-visible {
    pointer-events: auto;
  }
}
[class*='container_workspace_xianling_stage_tip-ring'] {
  width: 14px;
  height: 14px;
  border: 1px solid #d4f7ffb0;
  border-radius: 50%;
  box-shadow: 0 0 6px #81dfff72;
  [data-aiming-blade='true'] &,
  [data-over-tip='true'] & {
    border-color: #ffe9ae;
    box-shadow: 0 0 8px #efcf99;
  }
}
[class*='container_workspace_xianling_stage_tip-label'] {
  position: absolute;
  left: 20px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 9px;
  line-height: 1.6;
  letter-spacing: 1px;
  white-space: nowrap;
  color: #d3eeeea3;
  text-shadow: 0 1px 3px #08232d;
  [data-aiming-blade='true'] &,
  [data-over-tip='true'] & {
    color: #ffedbd;
  }
}
[class*='container_workspace_xianling_stage_sword-handle'],
[class*='container_workspace_xianling_stage_sheath-handle'] {
  position: absolute;
  pointer-events: none;
  z-index: 2;
  transform: translate(-50%, -50%);
  width: 19px;
  height: 19px;
  display: grid;
  place-items: center;
  color: #c9e9ed;
  &[hidden] {
    display: none;
  }
}
[class*='container_workspace_xianling_stage_sword-icon'],
[class*='container_workspace_xianling_stage_sheath-icon'] {
  font-size: 14px;
  line-height: 19px;
  text-align: center;
  width: 19px;
  height: 19px;
  border: 1px solid #b3e1e9a0;
  border-radius: 50%;
  background: #0c283580;
  box-shadow: 0 0 8px #90e1f253;
}
[class*='container_workspace_xianling_stage_sheath-icon'] {
  border-color: #ead3a3aa;
  color: #f1dbb2;
}
[data-selected='true'] [class*='container_workspace_xianling_stage_sword-icon'],
[data-selected='true'] [class*='container_workspace_xianling_stage_sheath-icon'] {
  color: #fff0c2;
  border-color: #ffe7a7;
  box-shadow: 0 0 12px #f2dfae;
}
[class*='container_workspace_xianling_stage_sword-label'],
[class*='container_workspace_xianling_stage_sheath-label'] {
  position: absolute;
  left: 22px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 9px;
  white-space: nowrap;
  letter-spacing: 0.7px;
  color: #d1e9eaaa;
  text-shadow: 0 1px 4px #03131c;
}
[class*='container_workspace_xianling_stage_fallback'] {
  width: clamp(92px, 16vw, 196px);
  height: auto;
  opacity: 0.82;
  filter: drop-shadow(0 0 28px var(--color-accent-secondary-glow));
}
</style>
