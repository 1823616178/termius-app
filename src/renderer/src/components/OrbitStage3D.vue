<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { instanceClass } from '../../../shared/classes'
import orbitIcon from '../assets/orbit-icon.svg'
import type { SwordScene, SwordSceneOptions } from '../services/sword-scene'

const props = withDefaults(
  defineProps<{
    variant?: 'welcome' | 'compact'
    state?: string
    active?: boolean
    paused?: boolean
    boost?: boolean
    instance?: string
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

const c = (base: string) => instanceClass(base, props.instance)
const canvas = ref<HTMLCanvasElement | null>(null)
const reducedMotion = ref(false)
const motionTier = ref<'full' | 'light' | 'off'>('full')
const ready = ref(false)
const failed = ref(false)
const motionDisabled = computed(() => reducedMotion.value || motionTier.value === 'off')
const fallbackVisible = computed(() => !ready.value || failed.value || motionDisabled.value)

let scene: SwordScene | null = null
let rafId = 0
let lastTick = 0
let elapsedSeconds = 0
let loading = false
let disposed = false
let visible = true
let mediaQuery: MediaQueryList | null = null
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
      text: cssColor(styles, '--color-text-primary', '#efe9da')
    }
  }
}

function resizeScene(): void {
  const element = canvas.value
  if (!element || !scene || !element.clientWidth || !element.clientHeight) return
  scene.resize(element.clientWidth, element.clientHeight, window.devicePixelRatio || 1)
}

function syncScene(): void {
  scene?.update(sceneOptions())
  resizeScene()
}

function stopLoop(): void {
  if (rafId) cancelAnimationFrame(rafId)
  rafId = 0
}

function tick(now: number): void {
  rafId = 0
  if (!scene || disposed) return
  const delta = lastTick ? Math.min(0.05, (now - lastTick) / 1000) : 0.016
  lastTick = now
  elapsedSeconds += delta
  scene.render(elapsedSeconds)
  if (props.active && !props.paused && visible && !fallbackVisible.value) {
    rafId = requestAnimationFrame(tick)
  }
}

function ensureRunning(): void {
  if (disposed || failed.value || motionDisabled.value || !props.active || props.paused || !visible) {
    stopLoop()
    return
  }
  if (!scene) {
    void initializeScene()
    return
  }
  syncScene()
  if (!rafId) {
    lastTick = performance.now()
    rafId = requestAnimationFrame(tick)
  }
}

async function initializeScene(): Promise<void> {
  if (loading || scene || failed.value || disposed || !canvas.value) return
  loading = true
  try {
    const { createSwordScene } = await import('../services/sword-scene')
    if (disposed || !canvas.value || motionDisabled.value || failed.value) return
    scene = createSwordScene(canvas.value, sceneOptions())
    ready.value = true
    await nextTick()
    if (disposed || !scene) return
    syncScene()
    scene.render(elapsedSeconds)
    ensureRunning()
  } catch (error) {
    console.warn('3D sword scene unavailable', error)
    failed.value = true
    ready.value = false
    stopLoop()
  } finally {
    loading = false
  }
}

function readPreferences(): void {
  reducedMotion.value = mediaQuery?.matches ?? false
  const tier = document.documentElement.dataset.motion
  motionTier.value = tier === 'off' || tier === 'light' ? tier : 'full'
}

function handleMotionChange(): void {
  readPreferences()
  ensureRunning()
}

function handleVisibilityChange(): void {
  visible = document.visibilityState !== 'hidden'
  ensureRunning()
}

function handleContextLost(event: Event): void {
  event.preventDefault()
  failed.value = true
  ready.value = false
  stopLoop()
  scene?.dispose()
  scene = null
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

onMounted(() => {
  mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  readPreferences()
  mediaQuery.addEventListener('change', handleMotionChange)
  attrObserver = new MutationObserver(() => {
    readPreferences()
    syncScene()
    ensureRunning()
  })
  attrObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-motion', 'data-contrast', 'data-ui-theme', 'style']
  })
  resizeObserver = new ResizeObserver(resizeScene)
  if (canvas.value) {
    resizeObserver.observe(canvas.value)
    canvas.value.addEventListener('webglcontextlost', handleContextLost)
  }
  document.addEventListener('visibilitychange', handleVisibilityChange)
  ensureRunning()
})

watch(
  () => [props.active, props.paused, props.state, props.boost, props.variant],
  () => {
    syncScene()
    ensureRunning()
  }
)

onBeforeUnmount(() => {
  disposed = true
  stopLoop()
  attrObserver?.disconnect()
  resizeObserver?.disconnect()
  mediaQuery?.removeEventListener('change', handleMotionChange)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  canvas.value?.removeEventListener('webglcontextlost', handleContextLost)
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
  filter: drop-shadow(0 16px 28px rgba(0, 0, 0, 0.48));
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
</style>
