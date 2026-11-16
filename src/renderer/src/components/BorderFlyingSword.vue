<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, type CSSProperties } from 'vue'
import { instanceClass } from '../../../shared/classes'
import { createBorderFlightPath } from '../services/border-flight'

const props = withDefaults(defineProps<{ instance?: string }>(), { instance: 'main' })
const c = (base: string) => instanceClass(base, props.instance)
const root = ref<HTMLElement | null>(null)
const path = ref(createBorderFlightPath(800, 500))
const flightStyle = computed<CSSProperties>(() => ({ offsetPath: `path("${path.value}")` }))
let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  resizeObserver = new ResizeObserver(([entry]) => {
    const rect = entry?.contentRect
    if (!rect) return
    path.value = createBorderFlightPath(rect.width, rect.height, 24, 22)
  })
  if (root.value) resizeObserver.observe(root.value)
})

onBeforeUnmount(() => resizeObserver?.disconnect())
</script>

<template>
  <div ref="root" :class="c('container_workspace_borderfx_overlay_base')" aria-hidden="true">
    <div :class="c('container_workspace_borderfx_overlay_flight')" :style="flightStyle">
      <div :class="c('container_workspace_borderfx_overlay_rig')">
        <span :class="c('container_workspace_borderfx_overlay_grip')" />
        <span :class="c('container_workspace_borderfx_overlay_pommel')" />
        <span :class="c('container_workspace_borderfx_overlay_guard')" />
        <span :class="c('container_workspace_borderfx_overlay_blade')" />
        <span :class="c('container_workspace_borderfx_overlay_ridge')" />
        <span :class="c('container_workspace_borderfx_overlay_tassel')" />
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
[class*='container_workspace_borderfx_overlay_base'] {
  position: absolute;
  inset: 0;
  z-index: 5;
  overflow: hidden;
  pointer-events: none;
}
:global(:root[data-motion='off'] [class*='container_workspace_borderfx_overlay_base']) {
  display: none;
}
[class*='container_workspace_borderfx_overlay_flight'] {
  position: absolute;
  top: 0;
  left: 0;
  width: 112px;
  height: 44px;
  offset-anchor: 50% 50%;
  offset-rotate: auto;
  animation:
    workspace-border-flight 16s linear infinite,
    workspace-border-enter 680ms cubic-bezier(0.22, 1, 0.36, 1) 420ms both;
  filter: drop-shadow(0 0 8px var(--color-accent-secondary-glow));
  &::before {
    content: '';
    position: absolute;
    top: 19px;
    right: 76px;
    width: 132px;
    height: 7px;
    background: linear-gradient(
      90deg,
      transparent,
      var(--color-accent-primary-soft) 35%,
      var(--color-accent-secondary-soft) 62%,
      var(--color-accent-secondary)
    );
    border-radius: 50%;
    filter: blur(1px);
    opacity: 0.72;
    transform: perspective(100px) rotateX(12deg);
  }
}
:global(:root[data-motion='light'] [class*='container_workspace_borderfx_overlay_flight']) {
  animation-duration: 26s;
  filter: none;
}
:global(:root[data-motion='light'] [class*='container_workspace_borderfx_overlay_flight']::before) {
  width: 72px;
  filter: none;
  opacity: 0.4;
}
[class*='container_workspace_borderfx_overlay_rig'] {
  position: relative;
  width: 100%;
  height: 100%;
  transform: perspective(180px) rotateX(22deg) rotateY(-18deg);
  transform-style: preserve-3d;
  animation: workspace-border-bank 4s ease-in-out infinite;
}
[class*='container_workspace_borderfx_overlay_blade'] {
  position: absolute;
  left: 43px;
  top: 17px;
  width: 61px;
  height: 11px;
  clip-path: polygon(0 18%, 77% 3%, 100% 50%, 77% 97%, 0 82%);
  background: linear-gradient(
    180deg,
    #f5f0dc 0%,
    var(--color-scene-steel, #a8c5bc) 42%,
    #354a46 52%,
    #b8d0c6 100%
  );
  box-shadow: inset 0 1px 0 #fff9;
}
[class*='container_workspace_borderfx_overlay_ridge'] {
  position: absolute;
  left: 45px;
  top: 21px;
  width: 53px;
  height: 2px;
  clip-path: polygon(0 0, 100% 50%, 0 100%);
  background: linear-gradient(90deg, var(--color-accent-primary), #fff7da);
  opacity: 0.82;
}
[class*='container_workspace_borderfx_overlay_guard'] {
  position: absolute;
  left: 37px;
  top: 10px;
  width: 8px;
  height: 25px;
  clip-path: polygon(28% 0, 70% 8%, 100% 36%, 72% 50%, 100% 64%, 70% 92%, 28% 100%, 0 72%, 22% 50%, 0 28%);
  background: linear-gradient(90deg, #725021, var(--color-accent-primary-bright), #7f5c2a);
}
[class*='container_workspace_borderfx_overlay_grip'] {
  position: absolute;
  left: 17px;
  top: 19px;
  width: 23px;
  height: 7px;
  border-radius: 40% 2px 2px 40%;
  background: repeating-linear-gradient(135deg, #291d18 0 3px, var(--color-seal) 3px 4px, #291d18 4px 7px);
  box-shadow: inset 0 1px 1px #e2b47744;
}
[class*='container_workspace_borderfx_overlay_pommel'] {
  position: absolute;
  left: 10px;
  top: 16px;
  width: 13px;
  height: 13px;
  transform: rotate(45deg);
  border: 2px solid var(--color-accent-primary);
  background: radial-gradient(circle, transparent 30%, #8d672d 36% 58%, #e0bd76 64%);
}
[class*='container_workspace_borderfx_overlay_tassel'] {
  position: absolute;
  left: 8px;
  top: 27px;
  width: 25px;
  height: 15px;
  border-left: 2px solid var(--color-seal);
  border-bottom: 2px solid var(--color-seal);
  border-radius: 0 0 0 100%;
  transform: rotate(12deg);
  transform-origin: right top;
  opacity: 0.85;
}
@keyframes workspace-border-flight {
  from {
    offset-distance: 0%;
  }
  to {
    offset-distance: 100%;
  }
}
@keyframes workspace-border-enter {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@keyframes workspace-border-bank {
  0%,
  100% {
    transform: perspective(180px) rotateX(22deg) rotateY(-18deg) translateZ(0);
  }
  50% {
    transform: perspective(180px) rotateX(-8deg) rotateY(20deg) translateZ(5px);
  }
}
@media (prefers-reduced-motion: reduce) {
  :global(:root:not([data-motion-preference='full']) [class*='container_workspace_borderfx_overlay_base']) {
    display: none;
  }
}
</style>
