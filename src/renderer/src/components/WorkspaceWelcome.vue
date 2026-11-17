<script setup lang="ts">
import { ref } from 'vue'
import { Plus, ShieldCheck, SquareTerminal } from '@lucide/vue'
import { instanceClass } from '../../../shared/classes'
import { FORMATIONS } from '../services/sword-motion'
import {
  defaultShellProfile,
  openEditor,
  openLocal,
  recordMotionFrameRate,
  windowInstance
} from '../stores/workbench'
import BorderFlyingSword from './BorderFlyingSword.vue'
import OrbitStage3D from './OrbitStage3D.vue'

defineProps<{
  active: boolean
}>()

const c = (base: string, token: string) => instanceClass(base, windowInstance(token))
const ctaHovered = ref(false)
const stageRef = ref<InstanceType<typeof OrbitStage3D> | null>(null)
const swordPhaseNote = ref('开阵启封 · 万锋初现')
const swordFormationIndex = ref(0)
const welcomeIntroKey = ref(0)

function replaySwordIntro() {
  welcomeIntroKey.value += 1
  swordPhaseNote.value = '开阵启封 · 万锋初现'
  stageRef.value?.replayIntro()
}

function triggerSwordClimax() {
  stageRef.value?.jumpToClimax()
}

function jumpSwordFormation(index: number) {
  swordFormationIndex.value = index
  stageRef.value?.jumpToFormation(index)
}
</script>

<template>
  <div class="container_workspace_welcome_body_base">
    <div :key="welcomeIntroKey" class="container_workspace_welcome_body_atmosphere" aria-hidden="true">
      <span class="container_workspace_welcome_body_moon" />
      <span class="container_workspace_welcome_body_mountains-far" />
      <span class="container_workspace_welcome_body_mountains-near" />
      <span class="container_workspace_welcome_body_cloud" />
    </div>
    <OrbitStage3D
      ref="stageRef"
      class="container_workspace_welcome_body_stage"
      :active="active"
      :boost="ctaHovered"
      :instance="windowInstance('welcome')"
      :on-frame-rate="recordMotionFrameRate"
      @phase="swordPhaseNote = $event"
      @formation="swordFormationIndex = $event"
    />
    <div class="container_workspace_welcome_body_scene-note" aria-hidden="true">
      <span class="container_workspace_welcome_body_scene-name">
        {{ FORMATIONS[swordFormationIndex]?.name ?? '万剑归宗' }}
      </span>
      <span class="container_workspace_welcome_body_scene-state">{{ swordPhaseNote }}</span>
      <span class="container_workspace_welcome_body_view-hint">
        拖动剑尖调倾角 · 拖动空白环视 · 滚轮缩放 · 双击复位
      </span>
    </div>
    <div class="container_workspace_welcome_body_controls">
      <button
        class="container_workspace_welcome_body_replay"
        type="button"
        title="重新播放开场展开与剑阵演武"
        @click="replaySwordIntro"
      >
        重展剑境
      </button>
      <button
        class="container_workspace_welcome_body_climax"
        type="button"
        title="立即催动诛仙剑阵四门杀劫"
        @click="triggerSwordClimax"
      >
        即刻归宗
      </button>
    </div>
    <nav class="container_workspace_welcome_body_formrail" aria-label="十二剑阵巡览">
      <button
        v-for="(formation, index) in FORMATIONS"
        :key="formation.name"
        :class="c('container_workspace_welcome_body_formseal', `rail-${index}`)"
        :data-active="index === swordFormationIndex"
        :data-name="formation.name"
        type="button"
        :title="`${formation.name} · ${formation.sub}`"
        :aria-label="`切换至${formation.name}`"
        :aria-current="index === swordFormationIndex ? 'true' : undefined"
        @click="jumpSwordFormation(index)"
      >
        {{ index + 1 }}
      </button>
    </nav>
    <div class="container_workspace_welcome_body_content">
      <div class="container_workspace_welcome_header_kicker">
        <span class="container_workspace_welcome_header_dot" />
        御剑凌虚 · 万象归宗
      </div>
      <h2 class="container_workspace_welcome_body_title">让连接，井然有序。</h2>
      <p class="container_workspace_welcome_body_description">
        一剑连接山海，一方收束万象。
        <br class="container_workspace_welcome_body_line-break" />
        远程主机与本地终端，皆在此归位。
      </p>
      <div
        class="container_workspace_welcome_body_actions"
        @mouseenter="ctaHovered = true"
        @mouseleave="ctaHovered = false"
      >
        <button
          class="container_workspace_welcome_body_create"
          type="button"
          data-primary
          @click="openEditor()"
        >
          <Plus :size="16" />
          新建 SSH 主机
        </button>
        <button
          class="container_workspace_welcome_body_local"
          type="button"
          :disabled="!defaultShellProfile"
          @click="defaultShellProfile && openLocal(defaultShellProfile)"
        >
          <SquareTerminal :size="16" />
          打开本地终端
        </button>
      </div>
      <div class="container_workspace_welcome_footer_base">
        <span class="container_workspace_welcome_footer_hint">
          <ShieldCheck :size="13" />
          离线可用
        </span>
        <span class="container_workspace_welcome_footer_separator">·</span>
        <span class="container_workspace_welcome_footer_keyboard">Ctrl + Shift + T 新建终端</span>
      </div>
    </div>
    <div class="container_workspace_welcome_footer_phase">
      <span class="container_workspace_welcome_footer_phase-label">壶中日月长 · 剑外山海阔</span>
      <span class="container_workspace_welcome_footer_phase-copy">真实连接 · 安全守护 · 静水流深</span>
    </div>
    <BorderFlyingSword :instance="windowInstance('border')" />
  </div>
</template>

<style scoped lang="scss">
.container_workspace_welcome_body_base {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  position: relative;
  isolation: isolate;
  container-type: inline-size;
  background:
    radial-gradient(ellipse at 70% 40%, var(--color-accent-secondary-soft), transparent 38%),
    radial-gradient(
      ellipse at 24% 72%,
      var(--color-scene-wine-soft, rgba(179, 107, 43, 0.1)),
      transparent 40%
    ),
    linear-gradient(145deg, var(--color-surface-canvas), var(--color-app-bg) 56%, #050807);
  &::before {
    content: '';
    position: absolute;
    inset: 10px;
    z-index: 2;
    border: 1px solid var(--color-accent-primary-soft);
    border-radius: 20px;
    box-shadow:
      inset 0 1px 0 var(--color-scene-metal-soft, rgba(244, 218, 166, 0.08)),
      0 0 42px var(--color-accent-primary-soft);
    pointer-events: none;
    animation: workspace-frame-unfold 760ms cubic-bezier(0.22, 1, 0.36, 1) both;
  }
}
.container_workspace_welcome_body_atmosphere {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    background:
      linear-gradient(90deg, color-mix(in srgb, var(--color-app-bg) 88%, transparent), transparent 52%),
      radial-gradient(
        ellipse at center,
        transparent 40%,
        color-mix(in srgb, var(--color-app-bg) 82%, transparent)
      );
  }
}
.container_workspace_welcome_body_moon {
  position: absolute;
  top: 11%;
  right: 15%;
  width: clamp(110px, 14vw, 190px);
  aspect-ratio: 1;
  border-radius: 50%;
  border: 1px solid var(--color-accent-primary-ring);
  background:
    radial-gradient(circle at 38% 34%, var(--color-accent-primary-soft), transparent 45%),
    radial-gradient(circle, var(--color-scene-metal-soft, rgba(239, 221, 180, 0.12)), transparent 70%);
  box-shadow:
    0 0 80px var(--color-accent-primary-soft),
    inset 0 0 32px var(--color-accent-primary-soft);
  opacity: 0.72;
  animation: workspace-moon-unfold 920ms cubic-bezier(0.22, 1, 0.36, 1) 80ms both;
}
.container_workspace_welcome_body_mountains-far,
.container_workspace_welcome_body_mountains-near {
  position: absolute;
  left: -4%;
  right: -4%;
  bottom: -2%;
  height: 47%;
  transform-origin: bottom;
  pointer-events: none;
}
.container_workspace_welcome_body_mountains-far {
  clip-path: polygon(
    0 76%,
    8% 54%,
    14% 66%,
    24% 28%,
    31% 58%,
    41% 37%,
    50% 65%,
    60% 19%,
    68% 51%,
    78% 31%,
    88% 61%,
    95% 43%,
    100% 69%,
    100% 100%,
    0 100%
  );
  background: linear-gradient(
    180deg,
    var(--color-accent-secondary-soft),
    color-mix(in srgb, var(--color-surface-1) 88%, transparent)
  );
  filter: blur(3px);
  opacity: 0.46;
  animation: workspace-mountain-far-unfold 960ms cubic-bezier(0.22, 1, 0.36, 1) 60ms both;
}
.container_workspace_welcome_body_mountains-near {
  height: 34%;
  clip-path: polygon(
    0 57%,
    10% 34%,
    20% 72%,
    32% 40%,
    43% 77%,
    55% 46%,
    67% 71%,
    78% 34%,
    88% 62%,
    100% 39%,
    100% 100%,
    0 100%
  );
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--color-surface-1) 90%, transparent),
    var(--color-app-bg)
  );
  opacity: 0.86;
  animation: workspace-mountain-near-unfold 860ms cubic-bezier(0.22, 1, 0.36, 1) 140ms both;
}
.container_workspace_welcome_body_cloud {
  position: absolute;
  left: 18%;
  right: 4%;
  bottom: 12%;
  height: 28%;
  background:
    radial-gradient(ellipse at 20% 60%, var(--color-accent-secondary-soft), transparent 42%),
    radial-gradient(ellipse at 58% 40%, var(--color-scene-mist, rgba(165, 193, 179, 0.09)), transparent 50%),
    radial-gradient(ellipse at 85% 68%, var(--color-accent-primary-soft), transparent 40%);
  filter: blur(18px);
  opacity: 0.68;
  animation:
    workspace-cloud-unfold 950ms ease-out 180ms both,
    workspace-cloud-drift 18s ease-in-out 1130ms infinite alternate;
}
.container_workspace_welcome_body_stage {
  position: absolute;
  inset: 0;
  z-index: 1;
  min-height: 0;
}
.container_workspace_welcome_body_content {
  position: absolute;
  z-index: 4;
  left: clamp(36px, 5.5vw, 82px);
  top: 49%;
  transform: translateY(-50%);
  width: min(400px, 38%);
  isolation: isolate;
  pointer-events: none;
  &::before {
    content: '';
    position: absolute;
    z-index: -1;
    inset: -64px -72px;
    background: radial-gradient(
      ellipse at 34% 46%,
      color-mix(in srgb, var(--color-app-bg) 94%, transparent) 0%,
      color-mix(in srgb, var(--color-app-bg) 68%, transparent) 46%,
      transparent 74%
    );
    pointer-events: none;
  }
  button {
    pointer-events: auto;
  }
}
.container_workspace_welcome_header_kicker {
  font-family: var(--font-display);
  font-size: 13px;
  letter-spacing: 4px;
  color: var(--color-accent-primary-hover);
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 20px;
  animation: workspace-hero-rise 460ms cubic-bezier(0.22, 1, 0.36, 1) 40ms both;
}
.container_workspace_welcome_header_dot {
  width: 7px;
  height: 7px;
  border-radius: 1px;
  transform: rotate(45deg);
  background: var(--color-seal);
  box-shadow: 0 0 12px var(--color-seal-ring);
}
.container_workspace_welcome_body_title {
  font-family: var(--font-display);
  font-size: clamp(30px, 3vw, 42px);
  font-weight: 600;
  line-height: 1.35;
  letter-spacing: 2px;
  white-space: nowrap;
  margin: 0 0 20px;
  color: var(--color-text-primary);
  text-shadow: 0 3px 24px var(--color-accent-primary-glow);
  animation: workspace-hero-rise 500ms cubic-bezier(0.22, 1, 0.36, 1) 90ms both;
}
.container_workspace_welcome_body_description {
  font-size: 14px;
  color: var(--color-text-secondary);
  line-height: 2;
  letter-spacing: 0.5px;
  margin: 0;
  animation: workspace-hero-rise 480ms cubic-bezier(0.22, 1, 0.36, 1) 130ms both;
}
.container_workspace_welcome_body_actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 32px;
  animation: workspace-hero-rise 420ms cubic-bezier(0.22, 1, 0.36, 1) 160ms both;
  button {
    font-size: 13px;
    min-height: 38px;
    padding: 9px 17px;
    border: 1px solid var(--color-border-control);
    backdrop-filter: blur(12px);
  }
}
.container_workspace_welcome_footer_base {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  color: var(--color-text-muted);
  font-size: 11px;
  margin-top: 24px;
  animation: workspace-hero-rise 460ms cubic-bezier(0.22, 1, 0.36, 1) 220ms both;
}
.container_workspace_welcome_footer_hint {
  display: flex;
  align-items: center;
  gap: 5px;
}
.container_workspace_welcome_body_scene-note {
  position: absolute;
  z-index: 3;
  top: 34px;
  right: 38px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 7px;
  padding-right: 14px;
  border-right: 2px solid var(--color-seal);
  pointer-events: none;
  animation: workspace-seal-unfold 620ms cubic-bezier(0.22, 1, 0.36, 1) 240ms both;
}
.container_workspace_welcome_body_scene-name {
  font-family: var(--font-display);
  font-size: 23px;
  letter-spacing: 6px;
  color: var(--color-accent-primary-bright);
}
.container_workspace_welcome_body_scene-state {
  font-size: 10px;
  letter-spacing: 2px;
  color: var(--color-text-muted);
}
.container_workspace_welcome_body_view-hint {
  font-size: 10px;
  color: var(--color-text-muted);
  letter-spacing: 0.5px;
}
.container_workspace_welcome_body_controls {
  position: absolute;
  z-index: 4;
  top: 120px;
  right: 38px;
  display: flex;
  gap: 8px;
  animation: workspace-seal-unfold 620ms cubic-bezier(0.22, 1, 0.36, 1) 320ms both;
}
.container_workspace_welcome_body_replay,
.container_workspace_welcome_body_climax {
  min-height: 32px;
  padding: 4px 12px;
  font-size: 11px;
  letter-spacing: 1.5px;
  color: var(--color-text-secondary);
  background: color-mix(in srgb, var(--color-surface-1) 76%, transparent);
  border: 1px solid var(--color-accent-primary-soft);
  border-radius: var(--radius-control);
  backdrop-filter: blur(8px);
  &:hover:not(:disabled) {
    color: var(--color-accent-primary-bright);
    border-color: var(--color-accent-primary-ring);
    background: color-mix(in srgb, var(--color-surface-2) 86%, transparent);
    box-shadow: 0 0 18px var(--color-accent-primary-soft);
  }
}
:global(:root[data-motion='off'] .container_workspace_welcome_body_controls) {
  display: none;
}
@media (prefers-reduced-motion: reduce) {
  :global(:root:not([data-motion-preference='full']) .container_workspace_welcome_body_controls) {
    display: none;
  }
}
.container_workspace_welcome_body_formrail {
  position: absolute;
  z-index: 4;
  top: 164px;
  right: 38px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
  animation: workspace-seal-unfold 620ms cubic-bezier(0.22, 1, 0.36, 1) 400ms both;
}
.container_workspace_welcome_body_formseal {
  position: relative;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  min-height: 22px;
  padding: 0;
  font-size: 9px;
  font-family: var(--font-display);
  color: var(--color-text-muted);
  background: color-mix(in srgb, var(--color-surface-1) 70%, transparent);
  border: 1px solid var(--color-accent-primary-soft);
  border-radius: 5px;
  cursor: pointer;
  backdrop-filter: blur(6px);
  transition:
    color 0.2s,
    border-color 0.2s,
    box-shadow 0.2s,
    background 0.2s;
  &::after {
    content: attr(data-name);
    position: absolute;
    right: calc(100% + 8px);
    top: 50%;
    translate: 0 -50%;
    max-width: 0;
    opacity: 0;
    overflow: hidden;
    white-space: nowrap;
    font-size: 10px;
    letter-spacing: 2px;
    color: var(--color-accent-primary-bright);
    text-shadow: 0 0 12px var(--color-accent-primary-soft);
    transition:
      max-width 0.3s cubic-bezier(0.22, 1, 0.36, 1),
      opacity 0.2s;
    pointer-events: none;
  }
  &:hover,
  &[data-active='true'] {
    color: var(--color-accent-primary-bright);
    border-color: var(--color-accent-primary-ring);
    background: color-mix(in srgb, var(--color-surface-2) 86%, transparent);
    box-shadow: 0 0 14px var(--color-accent-primary-soft);
    &::after {
      max-width: 180px;
      opacity: 1;
    }
  }
  &[data-active='true'] {
    border-color: var(--color-seal);
  }
}
:global(:root[data-motion='off'] .container_workspace_welcome_body_formrail) {
  display: none;
}
@media (prefers-reduced-motion: reduce) {
  :global(:root:not([data-motion-preference='full']) .container_workspace_welcome_body_formrail) {
    display: none;
  }
}
@media (max-width: 900px), (max-height: 560px) {
  .container_workspace_welcome_body_formrail {
    display: none;
  }
}
.container_workspace_welcome_footer_phase {
  position: absolute;
  z-index: 3;
  bottom: 26px;
  left: 50%;
  transform: translateX(-10%);
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-end;
  pointer-events: none;
  animation: workspace-seal-unfold 620ms cubic-bezier(0.22, 1, 0.36, 1) 300ms both;
}
.container_workspace_welcome_footer_phase-label {
  font-family: var(--font-display);
  font-size: 12px;
  letter-spacing: 2px;
  color: var(--color-accent-primary-hover);
}
.container_workspace_welcome_footer_phase-copy {
  font-size: 10px;
  letter-spacing: 1.2px;
  color: var(--color-text-muted);
}
@keyframes workspace-frame-unfold {
  from {
    opacity: 0;
    transform: scale(0.972);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
@keyframes workspace-moon-unfold {
  from {
    opacity: 0;
    transform: scale(0.74) translateY(14px);
  }
  to {
    opacity: 0.72;
    transform: scale(1) translateY(0);
  }
}
@keyframes workspace-mountain-far-unfold {
  from {
    opacity: 0;
    transform: translateY(34px) scaleY(0.88);
  }
  to {
    opacity: 0.46;
    transform: translateY(0) scaleY(1);
  }
}
@keyframes workspace-mountain-near-unfold {
  from {
    opacity: 0;
    transform: translateY(28px) scaleY(0.9);
  }
  to {
    opacity: 0.86;
    transform: translateY(0) scaleY(1);
  }
}
@keyframes workspace-cloud-unfold {
  from {
    opacity: 0;
    transform: translate3d(-4%, 12px, 0) scaleX(0.92);
  }
  to {
    opacity: 0.68;
    transform: translate3d(-2%, 0, 0) scaleX(0.96);
  }
}
@keyframes workspace-hero-rise {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@keyframes workspace-seal-unfold {
  from {
    opacity: 0;
    transform: translateX(14px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}
@keyframes workspace-cloud-drift {
  from {
    transform: translate3d(-2%, 0, 0) scaleX(0.96);
    opacity: 0.48;
  }
  to {
    transform: translate3d(3%, -3%, 0) scaleX(1.04);
    opacity: 0.72;
  }
}
@container (max-width: 820px) {
  .container_workspace_welcome_body_stage {
    height: 54%;
    bottom: auto;
  }
  .container_workspace_welcome_body_content {
    left: 28px;
    right: 28px;
    top: auto;
    bottom: 58px;
    width: auto;
    transform: none;
    text-align: center;
  }
  .container_workspace_welcome_header_kicker,
  .container_workspace_welcome_footer_base,
  .container_workspace_welcome_body_actions {
    justify-content: center;
  }
  .container_workspace_welcome_body_title {
    white-space: normal;
    font-size: 30px;
  }
  .container_workspace_welcome_footer_phase {
    display: none;
  }
}
@container (max-width: 580px) {
  .container_workspace_welcome_body_scene-note,
  .container_workspace_welcome_body_controls {
    display: none;
  }
}
</style>
