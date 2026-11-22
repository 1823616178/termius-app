<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Orbit,
  Pause,
  Play,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  SquareTerminal
} from '@lucide/vue'
import { instanceClass } from '../../../shared/classes'
import mountainsImg from '../assets/xianling/mountains.jpg'
import '../styles/xianling-fonts.css'
import { locale, t } from '../services/i18n'
import { ACTS, phaseAt } from '../services/xianling/draw-motion'
import {
  armoryCrestSvgDataUrl,
  astrolabeSvgDataUrl,
  ATLAS,
  COUNT,
  formatChineseOrdinal,
  glyphSvgDataUrl,
  STUDY_PARTS
} from '../services/xianling/layouts'
import type { HeroFrameState } from '../services/xianling/main-blade'
import {
  defaultShellProfile,
  openEditor,
  openLocal,
  recordMotionFrameRate,
  windowInstance
} from '../stores/workbench'
import BorderFlyingSword from './BorderFlyingSword.vue'
import XianlingStage3D from './XianlingStage3D.vue'

const props = defineProps<{
  active: boolean
}>()

const c = (base: string, token: string) => instanceClass(base, windowInstance(token))
const isEn = computed(() => locale.value === 'en-US')

const rootRef = ref<HTMLElement | null>(null)
const stageRef = ref<InstanceType<typeof XianlingStage3D> | null>(null)
const stageReady = ref(false)
const stageFailed = ref(false)
const stageStatusOverride = ref('')

// Xianling theatre state
const activeFormation = ref(0)
const savedPerVolume = [0, 12]
const examining = ref(false)
const activePart = ref(0)
const danceEnabled = ref(false)
const chorusEnabled = ref(false)
const touring = ref(false)
const orbiting = ref(false)
const paused = ref(false)
const isFullscreen = ref(false)
const rotationSpeed = ref(1.0)
const zoomValue = ref(1.0)

// Frame-driven reactive state
const activeAct = ref(-1)
const flightCount = ref(COUNT)
const stateText = ref('')
const captionVisible = ref(false)
const captionText = ref('')
const sheathed = ref(false)
const sheathDisabled = ref(false)
const swordAway = ref(false)
const swordTransfer = ref(0)
const swordExchangeDisabled = ref(false)
const swordSubText = ref('')
const fusionTarget = ref(false)
const fusionProgress = ref(0)
const fusionSubText = ref('')
const sheathAway = ref(false)
const sheathTransfer = ref(0)
const sheathExchangeDisabled = ref(false)
const sheathSubText = ref('')

let seconds = 0
let everCast = false

const astrolabeSrc = astrolabeSvgDataUrl()
const crestSrc = armoryCrestSvgDataUrl()
const cardGlyphs = ATLAS.map((spec, i) => glyphSvgDataUrl(i, spec.primary))

const currentSpec = computed(() => ATLAS[activeFormation.value] ?? ATLAS[0]!)
const currentPartSpec = computed(() => STUDY_PARTS[activePart.value] ?? STUDY_PARTS[0]!)
const currentVolume = computed(() => (activeFormation.value < 12 ? 0 : 1))
const formattedIndex = computed(() => String(activeFormation.value + 1).padStart(2, '0'))
const formattedOrdinal = computed(() =>
  isEn.value ? `NO. ${formattedIndex.value}` : formatChineseOrdinal(activeFormation.value)
)
const formattedFlightCount = computed(() => flightCount.value.toLocaleString('en-US'))
const displayFormationName = computed(() => currentSpec.value.name)
const displayStory = computed(() => (isEn.value ? currentSpec.value.storyEn : currentSpec.value.story))
const displayNucleus = computed(() => (isEn.value ? currentSpec.value.nucleusEn : currentSpec.value.nucleus))
const displaySpell = computed(() => (isEn.value ? currentSpec.value.spellEn : currentSpec.value.spell))
const displayTone = computed(() => (isEn.value ? currentSpec.value.toneEn : currentSpec.value.tone))

const displayedStateText = computed(() => {
  if (!stageReady.value && stageStatusOverride.value) return stageStatusOverride.value
  return stateText.value || t('xianling.stateRunning')
})

const rootStyle = computed(() => ({
  '--formation-accent': currentSpec.value.primary,
  '--formation-secondary': currentSpec.value.secondary
}))

const landStyle = computed(() => ({
  backgroundImage: `url(${mountainsImg})`
}))

function viewPart(index: number): void {
  const next = index >= 0
  examining.value = next
  if (next) activePart.value = index
  stageRef.value?.inspect(index)
}

function selectFormation(rawIndex: number): void {
  if (examining.value) viewPart(-1)
  const idx = ((rawIndex % ATLAS.length) + ATLAS.length) % ATLAS.length
  activeFormation.value = idx
  savedPerVolume[idx < 12 ? 0 : 1] = idx
  seconds = 0
  everCast = false
  stateText.value = t('xianling.stateMorphing')
  captionVisible.value = false
  stageRef.value?.choose(idx)
}

function switchVolume(volIndex: 0 | 1): void {
  savedPerVolume[currentVolume.value] = activeFormation.value
  selectFormation(savedPerVolume[volIndex]!)
}

function toggleDance(): void {
  if (examining.value) viewPart(-1)
  danceEnabled.value = !danceEnabled.value
  stageRef.value?.setDance(danceEnabled.value)
  if (!danceEnabled.value) activeAct.value = -1
}

function toggleChorus(): void {
  chorusEnabled.value = !chorusEnabled.value
  stageRef.value?.setChorus(chorusEnabled.value)
}

function triggerActuate(key: 'sheath' | 'recall'): void {
  if (examining.value) viewPart(-1)
  if (paused.value) togglePause()
  seconds = 0
  stageRef.value?.actuate(key)
}

function triggerCharge(): void {
  if (examining.value) viewPart(-1)
  if (paused.value) togglePause()
  stageRef.value?.cast()
  everCast = true
  seconds = 0
  captionVisible.value = true
  captionText.value = displaySpell.value
}

function triggerSwordExchange(): void {
  if (examining.value) viewPart(-1)
  if (paused.value) togglePause()
  stageRef.value?.swordExchange()
}

function triggerFusion(): void {
  if (examining.value) viewPart(-1)
  if (paused.value) togglePause()
  stageRef.value?.fusion()
}

function triggerSheathExchange(): void {
  if (examining.value) viewPart(-1)
  if (paused.value) togglePause()
  stageRef.value?.exchange()
}

function toggleTour(): void {
  touring.value = !touring.value
  seconds = 0
  if (touring.value && paused.value) togglePause()
}

function toggleOrbit(): void {
  orbiting.value = !orbiting.value
  stageRef.value?.orbit(orbiting.value)
}

function togglePause(): void {
  paused.value = !paused.value
  stageRef.value?.pause(paused.value)
  stateText.value = ''
}

function onRotationSpeedInput(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  rotationSpeed.value = value
  stageRef.value?.rotationSpeed(value)
}

function resetStageView(): void {
  stageRef.value?.reset()
}

function zoomCloser(): void {
  stageRef.value?.zoom(1.4)
}

function zoomFarther(): void {
  stageRef.value?.zoom(1 / 1.4)
}

function retryStage(): void {
  stageStatusOverride.value = ''
  stageRef.value?.retryInit()
}

async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen()
    } else if (rootRef.value) {
      await rootRef.value.requestFullscreen()
    }
  } catch {
    // Fullscreen can be blocked in restricted environments
  }
}

function handleFullscreenChange(): void {
  isFullscreen.value = Boolean(document.fullscreenElement)
}

function handleStageFrame(
  progress: number,
  age: number,
  z: number,
  dt: number,
  hero: HeroFrameState | null
): void {
  zoomValue.value = z
  if (!hero) return

  const act = hero.phase == null ? -1 : phaseAt(hero.phase)
  if (act !== activeAct.value) activeAct.value = act

  if (!paused.value && !examining.value) seconds += dt
  if (touring.value && !examining.value && seconds > 19.0) {
    selectFormation(activeFormation.value + 1)
  }
  if (touring.value && !examining.value && seconds > 3 && seconds - dt <= 3) {
    stageRef.value?.cast()
    everCast = true
  }

  const recall = hero.rec >= 0
  const dance = hero.mode === 'dance'
  const charge = everCast && age >= 0 && age < 4.4

  let nextState = paused.value
    ? t('xianling.statePaused')
    : progress < 1
      ? t('xianling.stateMorphing')
      : recall
        ? t('xianling.stateRecalling')
        : dance
          ? chorusEnabled.value
            ? t('xianling.stateChorusDance')
            : t('xianling.stateSoloDance')
          : charge
            ? t('xianling.stateCharging')
            : t('xianling.stateRunning')

  let nextCapShow = recall || dance || charge
  let nextCapText = recall
    ? hero.rec < 2.5
      ? t('xianling.capRecallGather')
      : hero.rec < 3.1
        ? t('xianling.capRecallHalo')
        : t('xianling.capRecallRestore')
    : dance
      ? isEn.value
        ? (ACTS[phaseAt(hero.phase ?? 0)]?.titleEn ?? '')
        : (ACTS[phaseAt(hero.phase ?? 0)]?.title ?? '')
      : displaySpell.value

  sheathed.value = hero.sheathed

  const u = hero.transfer
  const going = hero.away
  const moving = u > 0 && u < 1
  const fp = hero.fusion
  const ft = Boolean(hero.fusionTarget)
  const bu = hero.swordTransfer
  const ba = hero.swordAway

  flightCount.value = hero.fusionRemaining + hero.joined + hero.swordJoined

  swordAway.value = ba
  swordTransfer.value = bu
  swordExchangeDisabled.value = ft || fp > 0
  swordSubText.value =
    bu > 0 && bu < 1
      ? `${ba ? t('xianling.swordExitSub') : t('xianling.swordEnterSub')} ${Math.round((ba ? bu : 1 - bu) * 100)}%`
      : ba
        ? t('xianling.swordEnterSub')
        : t('xianling.swordExitSub')

  fusionTarget.value = ft
  fusionProgress.value = fp
  fusionSubText.value =
    ft && fp === 0 && (bu > 0 || u > 0)
      ? t('xianling.fusionWait')
      : fp > 0 && fp < 1
        ? `${ft ? t('xianling.fusionExitSub') : t('xianling.fusionEnterSub')} ${Math.round((ft ? fp : 1 - fp) * 100)}%`
        : ft
          ? t('xianling.fusionEnterSub')
          : t('xianling.fusionExitSub')

  if (fp > 0 || ft) {
    nextCapShow = true
    nextCapText =
      fp >= 1 ? t('xianling.fusionExitSub') : ft ? t('xianling.stateFusing') : t('xianling.stateUnfusing')
    nextState =
      fp >= 1 ? t('xianling.stateFused') : ft ? t('xianling.stateFusing') : t('xianling.stateUnfusing')
  }

  sheathDisabled.value = going || u > 0 || ba || bu > 0 || ((ft || fp > 0) && !(ft && fp === 1))

  sheathAway.value = going
  sheathTransfer.value = u
  sheathExchangeDisabled.value = ft || fp > 0
  sheathSubText.value = moving
    ? `${going ? t('xianling.sheathDispersing') : t('xianling.sheathEnterSub')} ${Math.round((going ? u : 1 - u) * 100)}%`
    : going
      ? t('xianling.sheathEnterSub')
      : t('xianling.sheathExitSub')

  if (moving) {
    nextCapShow = true
    nextCapText = going ? t('xianling.sheathDispersing') : t('xianling.sheathEnterSub')
  } else if (bu > 0 && bu < 1) {
    nextCapShow = true
    nextCapText = ba ? t('xianling.capSwordDissolve') : t('xianling.capSwordReform')
  }

  if (nextState !== stateText.value) stateText.value = nextState
  captionVisible.value = nextCapShow
  captionText.value = nextCapText
}

function handleKeydown(e: KeyboardEvent): void {
  if (!props.active || !stageReady.value) return
  if (document.querySelector('dialog[open]')) return
  if (e.key === 'Escape' && examining.value) {
    e.preventDefault()
    viewPart(-1)
    return
  }
  if (e.altKey || e.ctrlKey || e.metaKey) return
  if (examining.value) return
  const tag = (e.target as HTMLElement | null)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
  if (e.key === 'ArrowLeft') {
    e.preventDefault()
    selectFormation(activeFormation.value - 1)
  } else if (e.key === 'ArrowRight') {
    e.preventDefault()
    selectFormation(activeFormation.value + 1)
  } else if (e.code === 'Space' && (e.target === document.body || e.target === rootRef.value)) {
    e.preventDefault()
    triggerCharge()
  }
}

onMounted(() => {
  stageRef.value?.setFrameCallback(handleStageFrame)
  document.addEventListener('keydown', handleKeydown)
  document.addEventListener('fullscreenchange', handleFullscreenChange)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('fullscreenchange', handleFullscreenChange)
})
</script>

<template>
  <div
    ref="rootRef"
    class="container_workspace_welcome_body_base"
    :style="rootStyle"
    :data-examining="examining"
    :data-dance-enabled="danceEnabled"
    :data-stage-ready="stageReady"
  >
    <!-- Top Armory Header Bar -->
    <header class="container_workspace_xianling_header_bar">
      <div class="container_workspace_xianling_header_identity">
        <img class="container_workspace_xianling_header_crest" :src="crestSrc" alt="" draggable="false" />
        <strong class="container_workspace_xianling_header_brand">{{ t('xianling.brand') }}</strong>
        <span class="container_workspace_xianling_header_sep" aria-hidden="true" />
        <small class="container_workspace_xianling_header_sub">{{ t('xianling.brandSub') }}</small>
      </div>

      <div class="container_workspace_xianling_header_nav">
        <button
          class="container_workspace_xianling_header_ballet"
          type="button"
          role="switch"
          :aria-label="t('xianling.ballet')"
          :aria-checked="danceEnabled"
          :title="t('xianling.balletTitle')"
          @click="toggleDance"
        >
          <span class="container_workspace_xianling_header_ballet-track" aria-hidden="true" />
          {{ t('xianling.ballet') }}
          <b class="container_workspace_xianling_header_ballet-state">
            {{ danceEnabled ? t('xianling.switchOn') : t('xianling.switchOff') }}
          </b>
        </button>

        <button
          class="container_workspace_xianling_header_chorus"
          type="button"
          role="switch"
          :aria-label="t('xianling.chorusAria')"
          :aria-checked="chorusEnabled"
          :title="t('xianling.chorusTitle')"
          @click="toggleChorus"
        >
          <span class="container_workspace_xianling_header_chorus-track" aria-hidden="true" />
          {{ t('xianling.chorus') }}
          <b class="container_workspace_xianling_header_chorus-state">
            {{ chorusEnabled ? t('xianling.switchOn') : t('xianling.switchOff') }}
          </b>
        </button>

        <button
          class="container_workspace_xianling_header_sheath"
          type="button"
          :disabled="sheathDisabled"
          :aria-label="sheathed ? t('xianling.sheathOut') : t('xianling.sheathIn')"
          :title="sheathed ? t('xianling.sheathOutTitle') : t('xianling.sheathInTitle')"
          @click="triggerActuate('sheath')"
        >
          {{ sheathed ? t('xianling.sheathOut') : t('xianling.sheathIn') }}
        </button>

        <button
          class="container_workspace_xianling_header_inspect"
          type="button"
          :aria-pressed="examining"
          @click="viewPart(examining ? -1 : 1)"
        >
          {{ examining ? t('xianling.returnStage') : t('xianling.inspect') }}
        </button>
      </div>

      <div class="container_workspace_xianling_header_right">
        <span class="container_workspace_xianling_header_live">
          <span class="container_workspace_xianling_header_live-dot" aria-hidden="true" />
          {{ t('xianling.liveBadge') }}
        </span>
        <span class="container_workspace_xianling_header_rsep" aria-hidden="true" />
        <button
          class="container_workspace_xianling_header_full"
          type="button"
          :title="isFullscreen ? t('xianling.exitFullscreen') : t('xianling.fullscreen')"
          :aria-label="isFullscreen ? t('xianling.exitFullscreen') : t('xianling.fullscreen')"
          @click="toggleFullscreen"
        >
          <Minimize2 v-if="isFullscreen" :size="15" />
          <Maximize2 v-else :size="15" />
        </button>
      </div>
    </header>

    <!-- Main Interactive 3D Theatre Area -->
    <div class="container_workspace_xianling_main_body">
      <div class="container_workspace_xianling_main_land" :style="landStyle" aria-hidden="true" />
      <div class="container_workspace_xianling_main_wash" aria-hidden="true" />
      <img
        class="container_workspace_xianling_main_astrolabe"
        :src="astrolabeSrc"
        alt=""
        aria-hidden="true"
        draggable="false"
      />

      <div class="container_workspace_welcome_body_stage">
        <XianlingStage3D
          ref="stageRef"
          :active="active"
          :examining="examining"
          :instance="windowInstance('welcome')"
          :on-frame-rate="recordMotionFrameRate"
          @status="stageStatusOverride = $event"
          @ready-change="stageReady = $event"
          @failed-change="stageFailed = $event"
        />
      </div>

      <BorderFlyingSword :instance="windowInstance('border')" />

      <div class="container_workspace_xianling_main_fig" aria-hidden="true">
        FIG.
        <b class="container_workspace_xianling_main_fig-num">{{ formattedIndex }}</b>
        <span class="container_workspace_xianling_main_fig-line" />
        MOTION STUDY
      </div>

      <!-- Left Column: Graphite Orbit Welcome Hero (hidden during Object Study) -->
      <div class="container_workspace_welcome_body_content">
        <div class="container_workspace_welcome_header_kicker">
          <span class="container_workspace_welcome_header_dot" />
          {{ t('welcome.kicker') }}
        </div>
        <h2 class="container_workspace_welcome_body_title">{{ t('welcome.title') }}</h2>
        <p class="container_workspace_welcome_body_description">
          {{ t('welcome.descLine1') }}
          <br class="container_workspace_welcome_body_line-break" />
          {{ t('welcome.descLine2') }}
        </p>
        <div class="container_workspace_welcome_body_actions">
          <button
            class="container_workspace_welcome_body_create"
            type="button"
            data-primary
            @click="openEditor()"
          >
            <Plus :size="15" />
            {{ t('welcome.createSsh') }}
          </button>
          <button
            class="container_workspace_welcome_body_local"
            type="button"
            :disabled="!defaultShellProfile"
            @click="defaultShellProfile && openLocal(defaultShellProfile)"
          >
            <SquareTerminal :size="15" />
            {{ t('welcome.openLocal') }}
          </button>
        </div>
        <div class="container_workspace_welcome_footer_base">
          <span class="container_workspace_welcome_footer_hint">
            <ShieldCheck :size="13" />
            {{ t('welcome.offlineReady') }}
          </span>
          <span class="container_workspace_welcome_footer_separator">·</span>
          <span class="container_workspace_welcome_footer_keyboard">{{ t('welcome.shortcutHint') }}</span>
        </div>
      </div>

      <!-- Left Column (Object Study Mode): Main Sword Inspection Dossier -->
      <aside class="container_workspace_xianling_exhibit_panel" :aria-label="t('xianling.exhibitAria')">
        <div class="container_workspace_xianling_exhibit_kicker">
          <span class="container_workspace_xianling_exhibit_kline" aria-hidden="true" />
          OBJECT STUDY / 仙灵
        </div>
        <h2 class="container_workspace_xianling_exhibit_title">
          {{ isEn ? currentPartSpec.nameEn : currentPartSpec.name }}
        </h2>
        <div class="container_workspace_xianling_exhibit_en">{{ currentPartSpec.english }}</div>
        <p class="container_workspace_xianling_exhibit_note">
          {{ isEn ? currentPartSpec.noteEn : currentPartSpec.note }}
        </p>
        <button class="container_workspace_xianling_exhibit_back" type="button" @click="viewPart(-1)">
          {{ t('xianling.backstage') }}
        </button>
      </aside>

      <!-- Right Column: Xianling 24-Formation Dossier & 5 Formation Actions -->
      <aside class="container_workspace_xianling_dossier_panel">
        <div class="container_workspace_xianling_dossier_kicker">
          <span class="container_workspace_xianling_dossier_kline" aria-hidden="true" />
          SWORDMASTER / XXIV FORMATIONS
        </div>
        <div class="container_workspace_xianling_dossier_edition">
          <span class="container_workspace_xianling_dossier_ed-text">{{ t('xianling.edition') }}</span>
          <b class="container_workspace_xianling_dossier_ord">{{ formattedOrdinal }}</b>
        </div>
        <h1 class="container_workspace_xianling_dossier_name">{{ displayFormationName }}</h1>
        <div class="container_workspace_xianling_dossier_en">{{ currentSpec.english }}</div>
        <p class="container_workspace_xianling_dossier_story">{{ displayStory }}</p>

        <div class="container_workspace_xianling_dossier_census">
          <div class="container_workspace_xianling_dossier_census-wrap">
            <small class="container_workspace_xianling_dossier_census-label">
              {{ t('xianling.censusLabel') }}
            </small>
            <div class="container_workspace_xianling_dossier_census-row">
              <b class="container_workspace_xianling_dossier_count">{{ formattedFlightCount }}</b>
              <span class="container_workspace_xianling_dossier_unit">{{ t('xianling.censusUnit') }}</span>
            </div>
          </div>
          <div class="container_workspace_xianling_dossier_grid" aria-hidden="true" />
        </div>

        <div class="container_workspace_xianling_dossier_detail">
          <small class="container_workspace_xianling_dossier_dlabel">{{ t('xianling.nucleusLabel') }}</small>
          <span class="container_workspace_xianling_dossier_nucleus">{{ displayNucleus }}</span>
        </div>

        <div class="container_workspace_xianling_dossier_actions">
          <button class="container_workspace_xianling_action_charge" type="button" @click="triggerCharge">
            <Sparkles :size="15" />
            <b class="container_workspace_xianling_action_charge-title">{{ t('xianling.charge') }}</b>
            <small class="container_workspace_xianling_action_charge-sub">{{ displaySpell }}</small>
            <span class="container_workspace_xianling_action_charge-arrow" aria-hidden="true">↗</span>
          </button>

          <button
            class="container_workspace_xianling_action_recall"
            type="button"
            @click="triggerActuate('recall')"
          >
            <b class="container_workspace_xianling_action_recall-title">{{ t('xianling.recall') }}</b>
            <small class="container_workspace_xianling_action_recall-sub">
              {{ t('xianling.recallSub') }}
            </small>
            <span class="container_workspace_xianling_action_recall-arrow" aria-hidden="true">⟲</span>
          </button>

          <button
            class="container_workspace_xianling_action_sword-ex"
            type="button"
            :disabled="swordExchangeDisabled"
            :title="t('xianling.swordExchangeTitle')"
            :style="{ '--action-progress': `${swordTransfer * 100}%` }"
            @click="triggerSwordExchange"
          >
            <b class="container_workspace_xianling_action_sword-title">
              {{ swordAway ? t('xianling.swordEnter') : t('xianling.swordExit') }}
            </b>
            <small class="container_workspace_xianling_action_sword-sub">
              {{ swordSubText || t('xianling.swordExitSub') }}
            </small>
            <ArrowLeftRight :size="13" />
          </button>

          <button
            class="container_workspace_xianling_action_fusion"
            type="button"
            :title="t('xianling.fusionTitle')"
            :style="{ '--action-progress': `${fusionProgress * 100}%` }"
            @click="triggerFusion"
          >
            <b class="container_workspace_xianling_action_fusion-title">
              {{ fusionTarget ? t('xianling.fusionEnter') : t('xianling.fusionExit') }}
            </b>
            <small class="container_workspace_xianling_action_fusion-sub">
              {{ fusionSubText || t('xianling.fusionExitSub') }}
            </small>
            <ArrowLeftRight :size="13" />
          </button>

          <button
            class="container_workspace_xianling_action_sheath-ex"
            type="button"
            :disabled="sheathExchangeDisabled"
            :title="t('xianling.sheathExchangeTitle')"
            :style="{ '--action-progress': `${sheathTransfer * 100}%` }"
            @click="triggerSheathExchange"
          >
            <b class="container_workspace_xianling_action_sheath-title">
              {{ sheathAway ? t('xianling.sheathEnter') : t('xianling.sheathExit') }}
            </b>
            <small class="container_workspace_xianling_action_sheath-sub">
              {{ sheathSubText || t('xianling.sheathExitSub') }}
            </small>
            <ArrowLeftRight :size="13" />
          </button>
        </div>

        <button
          v-if="stageFailed"
          class="container_workspace_xianling_dossier_retry"
          type="button"
          @click="retryStage"
        >
          <RotateCcw :size="13" />
          {{ t('xianling.retryStage') }}
        </button>

        <div class="container_workspace_xianling_dossier_sig">
          <span class="container_workspace_xianling_dossier_sig-dot" aria-hidden="true" />
          <span class="container_workspace_welcome_body_scene-state">{{ displayedStateText }}</span>
          <span class="container_workspace_xianling_dossier_sig-line" aria-hidden="true" />
          <span class="container_workspace_xianling_dossier_tone">{{ displayTone }}</span>
        </div>
      </aside>

      <!-- Object Study Part Tabs -->
      <div class="container_workspace_xianling_study_tabs" :aria-label="t('xianling.partTabsAria')">
        <button
          v-for="(partItem, pIdx) in STUDY_PARTS"
          :key="partItem.tab"
          :class="c('container_workspace_xianling_study_tab', `part-${pIdx}`)"
          type="button"
          :aria-pressed="activePart === pIdx"
          @click="viewPart(pIdx)"
        >
          {{ isEn ? partItem.tabEn : partItem.tab }}
        </button>
      </div>

      <!-- Stage Floating Caption -->
      <div class="container_workspace_xianling_stage_caption" :data-show="captionVisible" aria-live="polite">
        <span class="container_workspace_xianling_stage_cap-icon" aria-hidden="true">✧</span>
        <b class="container_workspace_xianling_stage_cap-name">{{ captionText || displaySpell }}</b>
        <span class="container_workspace_xianling_stage_cap-line" aria-hidden="true" />
        <small class="container_workspace_xianling_stage_cap-en">RESONANCE</small>
      </div>

      <!-- Bottom-Center Controls: Array Spin Slider + View Tools + Zoom -->
      <div class="container_workspace_xianling_tools_dock">
        <div class="container_workspace_xianling_tools_rotation" :title="t('xianling.rotationSpeedTitle')">
          <label class="container_workspace_xianling_tools_rot-label" for="xianling-rotation-speed">
            {{ t('xianling.rotationSpeed') }}
          </label>
          <input
            id="xianling-rotation-speed"
            class="container_workspace_xianling_tools_rot-slider"
            type="range"
            min="0"
            max="3"
            step="0.1"
            :value="rotationSpeed"
            :aria-label="t('xianling.rotationSpeedAria')"
            :aria-valuetext="t('xianling.rotationSpeedText', { value: rotationSpeed.toFixed(1) })"
            @input="onRotationSpeedInput"
          />
          <output class="container_workspace_xianling_tools_rot-value" for="xianling-rotation-speed">
            {{ rotationSpeed.toFixed(1) }}×
          </output>
        </div>

        <div class="container_workspace_xianling_tools_view">
          <button
            class="container_workspace_xianling_tools_orbit"
            type="button"
            :aria-pressed="orbiting"
            @click="toggleOrbit"
          >
            <Orbit :size="13" />
            <span class="container_workspace_xianling_tools_orbit-text">{{ t('xianling.autoOrbit') }}</span>
          </button>
          <span class="container_workspace_xianling_tools_vsep1" aria-hidden="true" />
          <button
            class="container_workspace_xianling_tools_pause"
            type="button"
            :aria-pressed="paused"
            @click="togglePause"
          >
            <Play v-if="paused" :size="13" />
            <Pause v-else :size="13" />
            <span class="container_workspace_xianling_tools_pause-text">
              {{ paused ? t('xianling.resume') : t('xianling.pause') }}
            </span>
          </button>
          <span class="container_workspace_xianling_tools_vsep2" aria-hidden="true" />
          <button class="container_workspace_xianling_tools_reset" type="button" @click="resetStageView">
            <RotateCcw :size="13" />
            <span class="container_workspace_xianling_tools_reset-text">{{ t('xianling.resetView') }}</span>
          </button>
        </div>

        <div class="container_workspace_xianling_tools_zoom">
          <button
            class="container_workspace_xianling_tools_closer"
            type="button"
            :aria-label="t('xianling.zoomIn')"
            @click="zoomCloser"
          >
            ＋
          </button>
          <small class="container_workspace_xianling_tools_zoom-val">{{ zoomValue.toFixed(1) }}×</small>
          <button
            class="container_workspace_xianling_tools_farther"
            type="button"
            :aria-label="t('xianling.zoomOut')"
            @click="zoomFarther"
          >
            −
          </button>
        </div>
      </div>
    </div>

    <!-- Bottom 24-Formation Library Dock -->
    <section class="container_workspace_xianling_library_dock">
      <div class="container_workspace_xianling_library_head">
        <div class="container_workspace_xianling_library_left">
          <span class="container_workspace_xianling_library_diamond" aria-hidden="true">◈</span>
          <strong class="container_workspace_xianling_library_title">{{ t('xianling.libraryTitle') }}</strong>
          <span class="container_workspace_xianling_library_en">FORMATION INDEX</span>
          <button
            class="container_workspace_xianling_library_vol1"
            type="button"
            :aria-pressed="currentVolume === 0"
            @click="switchVolume(0)"
          >
            {{ t('xianling.vol1') }}
          </button>
          <button
            class="container_workspace_xianling_library_vol2"
            type="button"
            :aria-pressed="currentVolume === 1"
            @click="switchVolume(1)"
          >
            {{ t('xianling.vol2') }}
          </button>
        </div>

        <div class="container_workspace_xianling_library_right">
          <button
            class="container_workspace_xianling_library_tour"
            type="button"
            :aria-pressed="touring"
            @click="toggleTour"
          >
            <span class="container_workspace_xianling_library_tour-dot" aria-hidden="true" />
            <span class="container_workspace_xianling_library_tour-text">{{ t('xianling.autoTour') }}</span>
          </button>
          <span class="container_workspace_xianling_library_rsep" aria-hidden="true" />
          <button
            class="container_workspace_xianling_library_prev"
            type="button"
            :title="t('xianling.prevFormation')"
            :aria-label="t('xianling.prevFormation')"
            @click="selectFormation(activeFormation - 1)"
          >
            <ChevronLeft :size="15" />
          </button>
          <span class="container_workspace_xianling_library_index">{{ formattedIndex }} / 24</span>
          <button
            class="container_workspace_xianling_library_next"
            type="button"
            :title="t('xianling.nextFormation')"
            :aria-label="t('xianling.nextFormation')"
            @click="selectFormation(activeFormation + 1)"
          >
            <ChevronRight :size="15" />
          </button>
        </div>
      </div>

      <!-- Seven-Act Dance Progress Bar (visible when 剑舞 is enabled) -->
      <div class="container_workspace_xianling_music_bar" :title="t('xianling.musicTitle')">
        <span
          v-for="(act, actIdx) in ACTS"
          :key="act.label"
          :class="c('container_workspace_xianling_music_act', `act-${actIdx}`)"
          :data-on="activeAct === actIdx"
        >
          <span :class="c('container_workspace_xianling_music_line', `actl-${actIdx}`)" aria-hidden="true" />
          {{ isEn ? act.labelEn : act.label }}
        </span>
      </div>

      <!-- 24-Formation Cards (12 visible per active volume) -->
      <div class="container_workspace_xianling_cards_grid" role="group" :aria-label="t('xianling.cardsAria')">
        <button
          v-for="(spec, idx) in ATLAS"
          :key="spec.name"
          :class="c('container_workspace_xianling_card_item', `card-${idx}`)"
          type="button"
          :hidden="idx < 12 !== (currentVolume === 0)"
          :data-active="activeFormation === idx"
          :aria-pressed="activeFormation === idx"
          :title="`${spec.name} · ${isEn ? spec.spellEn : spec.spell}`"
          :aria-label="t('xianling.cardAria', { index: idx + 1, name: spec.name })"
          :style="{ '--card-tint': spec.primary }"
          @click="selectFormation(idx)"
        >
          <span :class="c('container_workspace_xianling_card_num', `cnum-${idx}`)">
            {{ String(idx + 1).padStart(2, '0') }}
          </span>
          <img
            :class="c('container_workspace_xianling_card_glyph', `cgly-${idx}`)"
            :src="cardGlyphs[idx]"
            alt=""
            aria-hidden="true"
            draggable="false"
          />
          <b :class="c('container_workspace_xianling_card_name', `cnam-${idx}`)">{{ spec.short }}</b>
        </button>
      </div>
    </section>

    <!-- Bottom Status Footer -->
    <footer class="container_workspace_xianling_footer_bar">
      <span class="container_workspace_xianling_footer_left">
        <span class="container_workspace_xianling_footer_dot" aria-hidden="true" />
        {{ t('xianling.footerEngine') }}
      </span>
      <span class="container_workspace_xianling_footer_center">{{ t('xianling.footerControls') }}</span>
      <span class="container_workspace_xianling_footer_right">CELESTIAL ARMORY ✧</span>
    </footer>
  </div>
</template>

<style scoped lang="scss">
.container_workspace_welcome_body_base {
  --formation-accent: #78d8ff;
  --formation-secondary: #f9c27f;
  --xianling-gold: #dfc79f;
  --xianling-font: 'Xianling Engraved', var(--font-display), serif;

  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  isolation: isolate;
  overflow: hidden;
  container-type: size;
  color: #e6edf0;
  background: radial-gradient(ellipse at 56% 42%, #142a35, #0b1821 74%);
}

/* === Top Armory Header === */
.container_workspace_xianling_header_bar {
  flex: none;
  height: 44px;
  padding: 0 24px;
  display: flex;
  align-items: center;
  gap: 14px;
  border-bottom: 1px solid rgba(173, 200, 191, 0.16);
  background: linear-gradient(90deg, rgba(9, 21, 27, 0.92), rgba(10, 25, 34, 0.9));
  position: relative;
  z-index: 5;
}
.container_workspace_xianling_header_identity {
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--xianling-gold);
  flex: none;
}
.container_workspace_xianling_header_crest {
  width: 22px;
  height: 26px;
  display: block;
}
.container_workspace_xianling_header_brand {
  font-family: var(--xianling-font);
  font-size: 19px;
  font-weight: 400;
  letter-spacing: 3px;
  color: #eeeee1;
  white-space: nowrap;
}
.container_workspace_xianling_header_sep,
.container_workspace_xianling_header_rsep {
  width: 1px;
  height: 16px;
  background: rgba(165, 187, 186, 0.24);
}
.container_workspace_xianling_header_sub {
  font:
    8px/1.4 Georgia,
    serif;
  letter-spacing: 1.8px;
  color: #b3c2bf;
  white-space: nowrap;
}
.container_workspace_xianling_header_nav {
  margin-left: 22px;
  display: flex;
  align-items: center;
  gap: 18px;
  font-size: 12px;
  letter-spacing: 1.6px;
  color: #94a5a7;
}
.container_workspace_xianling_header_ballet,
.container_workspace_xianling_header_chorus,
.container_workspace_xianling_header_sheath,
.container_workspace_xianling_header_inspect {
  min-height: 28px;
  padding: 4px 6px;
  border: 0;
  background: transparent;
  color: #9eb2b4;
  font-size: 12px;
  letter-spacing: 1.5px;
  white-space: nowrap;
  gap: 6px;
  &:hover:not(:disabled) {
    background: transparent;
    color: #fff2ce;
  }
}
.container_workspace_xianling_header_ballet-track,
.container_workspace_xianling_header_chorus-track {
  width: 22px;
  height: 12px;
  border-radius: 9px;
  background: #30414b;
  border: 1px solid rgba(122, 144, 147, 0.36);
  position: relative;
  display: inline-block;
  flex: none;
  &::after {
    content: '';
    position: absolute;
    left: 2px;
    top: 2px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #acbaba;
    transition: transform 0.18s;
  }
}
.container_workspace_xianling_header_ballet[aria-checked='true']
  .container_workspace_xianling_header_ballet-track {
  background: #376565;
  &::after {
    background: #cef5e6;
    transform: translateX(10px);
  }
}
.container_workspace_xianling_header_chorus[aria-checked='true']
  .container_workspace_xianling_header_chorus-track {
  background: #386760;
  &::after {
    background: #cef5e6;
    transform: translateX(10px);
  }
}
.container_workspace_xianling_header_ballet-state,
.container_workspace_xianling_header_chorus-state {
  font-size: 10px;
  font-weight: 400;
  color: #aabbbc;
}
.container_workspace_xianling_header_ballet[aria-checked='true']
  .container_workspace_xianling_header_ballet-state,
.container_workspace_xianling_header_chorus[aria-checked='true']
  .container_workspace_xianling_header_chorus-state {
  color: #bdecd9;
}
.container_workspace_xianling_header_inspect[aria-pressed='true'] {
  color: #e9d09a;
}
.container_workspace_xianling_header_right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 12px;
}
.container_workspace_xianling_header_live {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  letter-spacing: 1.8px;
  color: #a5bfbc;
  white-space: nowrap;
}
.container_workspace_xianling_header_live-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #99d0bd;
  box-shadow: 0 0 8px rgba(121, 204, 167, 0.45);
}
.container_workspace_xianling_header_full {
  min-height: 26px;
  padding: 4px;
  border: 0;
  background: transparent;
  color: #a5bfbc;
  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.06);
    color: #fff2ce;
  }
}

/* === Main Stage Area === */
.container_workspace_xianling_main_body {
  flex: 1;
  min-height: 0;
  position: relative;
  isolation: isolate;
  overflow: hidden;
}
.container_workspace_xianling_main_land,
.container_workspace_xianling_main_wash {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.container_workspace_xianling_main_land {
  z-index: 0;
  background-position: center 68%;
  background-size: cover;
  filter: saturate(0.89) brightness(0.58);
}
.container_workspace_xianling_main_wash {
  z-index: 0;
  background:
    linear-gradient(
      90deg,
      rgba(7, 21, 28, 0.88) 0%,
      rgba(8, 22, 27, 0.68) 20%,
      rgba(8, 22, 32, 0.24) 44%,
      rgba(7, 19, 35, 0.22) 66%,
      rgba(7, 21, 28, 0.78) 100%
    ),
    linear-gradient(0deg, rgba(9, 23, 32, 0.94), transparent 28%, transparent 78%, rgba(8, 23, 32, 0.62));
  [data-examining='true'] & {
    background: rgba(7, 21, 29, 0.92);
  }
}
.container_workspace_xianling_main_astrolabe {
  position: absolute;
  z-index: 0;
  pointer-events: none;
  width: min(46vw, 62vh);
  aspect-ratio: 1;
  top: 48%;
  left: 50%;
  transform: translate(-50%, -50%);
  opacity: 0.36;
  [data-examining='true'] & {
    display: none;
  }
}
.container_workspace_welcome_body_stage {
  position: absolute;
  inset: 0;
  z-index: 1;
  min-height: 0;
  [data-examining='true'] & {
    bottom: 92px;
  }
}
.container_workspace_xianling_main_fig {
  position: absolute;
  z-index: 2;
  left: 50%;
  top: 12px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 5px;
  font:
    8px/1 Arial,
    sans-serif;
  letter-spacing: 1.7px;
  color: #a0b5b7;
  pointer-events: none;
  [data-examining='true'] & {
    opacity: 0.55;
  }
}
.container_workspace_xianling_main_fig-num {
  font:
    italic 11px Georgia,
    serif;
  color: #e2d0b1;
}
.container_workspace_xianling_main_fig-line {
  width: 26px;
  height: 1px;
  background: rgba(168, 186, 185, 0.35);
  margin: 0 4px;
}

/* === Left Welcome Hero === */
.container_workspace_welcome_body_content {
  position: absolute;
  z-index: 6;
  left: clamp(20px, 2.8vw, 40px);
  top: 48%;
  transform: translateY(-50%);
  width: clamp(244px, 25%, 326px);
  isolation: isolate;
  pointer-events: none;
  &::before {
    content: '';
    position: absolute;
    z-index: -1;
    inset: -32px -38px;
    background: radial-gradient(
      ellipse at 36% 50%,
      rgba(7, 20, 28, 0.78) 0%,
      rgba(7, 20, 28, 0.42) 56%,
      transparent 78%
    );
    pointer-events: none;
  }
  button {
    pointer-events: auto;
  }
  [data-examining='true'] & {
    display: none;
  }
}
.container_workspace_welcome_header_kicker {
  font-family: var(--xianling-font);
  font-size: 11px;
  letter-spacing: 3px;
  color: var(--color-accent-primary-hover);
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
}
.container_workspace_welcome_header_dot {
  width: 6px;
  height: 6px;
  border-radius: 1px;
  transform: rotate(45deg);
  background: var(--color-seal);
  box-shadow: 0 0 10px var(--color-seal-ring);
}
.container_workspace_welcome_body_title {
  font-family: var(--xianling-font);
  font-size: clamp(20px, 1.85vw, 26px);
  font-weight: var(--font-ui-heading-weight);
  line-height: 1.3;
  letter-spacing: 1.2px;
  margin: 0 0 12px;
  color: #f3f1e3;
  text-wrap: balance;
  text-shadow: 0 3px 22px rgba(189, 223, 255, 0.14);
}
.container_workspace_welcome_body_description {
  font-size: 12px;
  color: #b6c5c6;
  line-height: 1.75;
  margin: 0;
}
.container_workspace_welcome_body_actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 20px;
  button {
    font-size: 12px;
    min-height: 34px;
    padding: 7px 13px;
    border: 1px solid rgba(133, 157, 163, 0.32);
    backdrop-filter: blur(10px);
  }
}
.container_workspace_welcome_body_local {
  background: rgba(12, 32, 42, 0.72);
  color: #d7e6e8;
  &:hover:not(:disabled) {
    background: rgba(24, 54, 68, 0.85);
    color: #f4f1e4;
    border-color: rgba(120, 216, 255, 0.45);
  }
}
.container_workspace_welcome_footer_base {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  color: #8ea7ac;
  font-size: 10px;
  margin-top: 14px;
}
.container_workspace_welcome_footer_hint {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* === Left Object Study Exhibit Panel === */
.container_workspace_xianling_exhibit_panel {
  display: none;
  position: absolute;
  z-index: 6;
  left: clamp(20px, 3vw, 42px);
  top: 48%;
  transform: translateY(-50%);
  width: clamp(232px, 24%, 300px);
  pointer-events: none;
  button {
    pointer-events: auto;
  }
  [data-examining='true'] & {
    display: block;
  }
}
.container_workspace_xianling_exhibit_kicker,
.container_workspace_xianling_dossier_kicker {
  display: flex;
  align-items: center;
  gap: 8px;
  letter-spacing: 2px;
  font:
    8.5px Georgia,
    serif;
  color: #d2c09d;
}
.container_workspace_xianling_exhibit_kline,
.container_workspace_xianling_dossier_kline {
  width: 18px;
  height: 1px;
  background: #baa178;
}
.container_workspace_xianling_exhibit_title {
  font-family: var(--xianling-font);
  font-size: clamp(26px, 2.5vw, 34px);
  font-weight: 400;
  letter-spacing: 3px;
  color: #f0eddd;
  margin: 14px 0 4px;
}
.container_workspace_xianling_exhibit_en {
  font:
    9px Georgia,
    serif;
  letter-spacing: 2.2px;
  color: var(--formation-accent);
}
.container_workspace_xianling_exhibit_note {
  font-size: 12.5px;
  line-height: 1.85;
  color: #c0ccce;
  margin: 14px 0 16px;
}
.container_workspace_xianling_exhibit_back {
  min-height: 30px;
  padding: 5px 12px;
  border: 1px solid rgba(162, 179, 173, 0.42);
  background: rgba(11, 28, 36, 0.78);
  color: #e4d1ac;
  font-size: 12px;
  border-radius: 3px;
  &:hover:not(:disabled) {
    background: rgba(24, 52, 64, 0.88);
    color: #fff2ce;
    border-color: rgba(223, 199, 159, 0.65);
  }
}

/* === Right Formation Dossier Panel === */
.container_workspace_xianling_dossier_panel {
  position: absolute;
  z-index: 6;
  right: clamp(16px, 2.4vw, 32px);
  top: 48%;
  transform: translateY(-50%);
  width: clamp(220px, 21vw, 268px);
  isolation: isolate;
  pointer-events: none;
  &::before {
    content: '';
    position: absolute;
    z-index: -1;
    inset: -26px -22px;
    background: radial-gradient(
      ellipse at 56% 50%,
      rgba(7, 20, 28, 0.8) 0%,
      rgba(7, 20, 28, 0.5) 58%,
      transparent 82%
    );
    pointer-events: none;
  }
  button {
    pointer-events: auto;
  }
  [data-examining='true'] & {
    display: none;
  }
}
.container_workspace_xianling_dossier_edition {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  font-size: 10px;
  letter-spacing: 1.6px;
  color: #bccfce;
}
.container_workspace_xianling_dossier_ord {
  font-family: var(--xianling-font);
  font-size: 10px;
  font-weight: 400;
  color: var(--xianling-gold);
  letter-spacing: 0.8px;
  border-left: 1px solid rgba(164, 176, 166, 0.32);
  padding-left: 8px;
}
.container_workspace_xianling_dossier_name {
  font-family: var(--xianling-font);
  font-size: clamp(26px, 2.6vw, 38px);
  font-weight: 400;
  line-height: 1.2;
  color: #f3f1e3;
  letter-spacing: 2.5px;
  margin: 6px 0 3px;
  white-space: nowrap;
  text-shadow: 0 3px 20px rgba(189, 223, 255, 0.14);
}
.container_workspace_xianling_dossier_en {
  font:
    8.5px/1.4 Georgia,
    serif;
  color: #b9cbd0;
  letter-spacing: 2.2px;
}
.container_workspace_xianling_dossier_story {
  margin: 9px 0 10px;
  font-family: var(--xianling-font);
  font-size: 12px;
  line-height: 1.68;
  color: #b6c5c6;
  letter-spacing: 0.6px;
}
.container_workspace_xianling_dossier_census,
.container_workspace_xianling_dossier_detail {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid rgba(149, 181, 178, 0.22);
}
.container_workspace_xianling_dossier_census {
  padding: 7px 0 6px;
}
.container_workspace_xianling_dossier_census-label,
.container_workspace_xianling_dossier_dlabel {
  display: block;
  font-size: 9.5px;
  letter-spacing: 1.8px;
  color: #a7b7b4;
}
.container_workspace_xianling_dossier_census-row {
  display: flex;
  align-items: baseline;
  gap: 5px;
}
.container_workspace_xianling_dossier_count {
  font:
    22px/1.15 Georgia,
    serif;
  letter-spacing: 0.8px;
  color: #eee6d2;
}
.container_workspace_xianling_dossier_unit {
  font-family: var(--xianling-font);
  font-size: 11px;
  color: #c3cdc5;
}
.container_workspace_xianling_dossier_grid {
  width: 36px;
  height: 20px;
  background: radial-gradient(circle, var(--formation-accent) 0.85px, transparent 1px) 0 0 / 5px 5px;
  opacity: 0.5;
}
.container_workspace_xianling_dossier_detail {
  height: 28px;
  border-bottom: 1px solid rgba(162, 189, 187, 0.16);
}
.container_workspace_xianling_dossier_nucleus {
  font-family: var(--xianling-font);
  font-size: 12.5px;
  letter-spacing: 1.4px;
  color: #e0e2d3;
}
.container_workspace_xianling_dossier_actions {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 10px;
}
.container_workspace_xianling_action_charge {
  width: 100%;
  min-height: 34px;
  height: 34px;
  padding: 0 11px;
  justify-content: flex-start;
  gap: 7px;
  color: #d4eef3;
  background: linear-gradient(110deg, rgba(22, 66, 85, 0.9), rgba(22, 50, 60, 0.65));
  border: 1px solid rgba(117, 175, 193, 0.55);
  border-radius: 2px;
  box-shadow: inset 0 0 14px rgba(66, 119, 139, 0.15);
  &:hover:not(:disabled) {
    background: #254a5b;
    color: #fff6de;
  }
}
.container_workspace_xianling_action_charge-title {
  font-family: var(--xianling-font);
  font-size: 13px;
  font-weight: 400;
  letter-spacing: 1.8px;
}
.container_workspace_xianling_action_charge-sub {
  font-size: 9.5px;
  letter-spacing: 1px;
  color: #adc5cc;
}
.container_workspace_xianling_action_charge-arrow,
.container_workspace_xianling_action_recall-arrow {
  margin-left: auto;
  color: #d5d9c7;
}
.container_workspace_xianling_action_recall,
.container_workspace_xianling_action_sword-ex,
.container_workspace_xianling_action_fusion,
.container_workspace_xianling_action_sheath-ex {
  width: 100%;
  min-height: 28px;
  height: 28px;
  padding: 0 10px;
  justify-content: flex-start;
  gap: 7px;
  border-radius: 2px;
  svg {
    margin-left: auto;
    flex: none;
  }
}
.container_workspace_xianling_action_recall {
  border: 1px solid rgba(192, 176, 131, 0.38);
  background: rgba(21, 41, 43, 0.86);
  color: #efdbb5;
  &:hover:not(:disabled) {
    background: rgba(34, 62, 65, 0.92);
    color: #fff2ce;
  }
}
.container_workspace_xianling_action_sword-ex {
  border: 1px solid rgba(160, 182, 185, 0.45);
  background: linear-gradient(
    90deg,
    #3b5262 var(--action-progress, 0%),
    rgba(21, 42, 50, 0.88) var(--action-progress, 0%)
  );
  color: #d9e9e5;
  &:hover:not(:disabled) {
    border-color: rgba(188, 215, 220, 0.72);
    color: #fff6de;
  }
}
.container_workspace_xianling_action_fusion {
  border: 1px solid rgba(184, 168, 124, 0.52);
  background: linear-gradient(
    90deg,
    #675a43 var(--action-progress, 0%),
    rgba(32, 45, 48, 0.88) var(--action-progress, 0%)
  );
  color: #f0dfbf;
  &:hover:not(:disabled) {
    border-color: rgba(226, 204, 152, 0.78);
    color: #fff6de;
  }
}
.container_workspace_xianling_action_sheath-ex {
  border: 1px solid rgba(139, 171, 187, 0.42);
  background: linear-gradient(
    90deg,
    #2a5363 var(--action-progress, 0%),
    rgba(17, 41, 49, 0.88) var(--action-progress, 0%)
  );
  color: #cce6e5;
  &:hover:not(:disabled) {
    border-color: rgba(164, 210, 224, 0.72);
    color: #fff6de;
  }
}
.container_workspace_xianling_action_recall-title,
.container_workspace_xianling_action_sword-title,
.container_workspace_xianling_action_fusion-title,
.container_workspace_xianling_action_sheath-title {
  font-family: var(--xianling-font);
  font-size: 12px;
  font-weight: 400;
  letter-spacing: 1.6px;
  white-space: nowrap;
}
.container_workspace_xianling_action_recall-sub,
.container_workspace_xianling_action_sword-sub,
.container_workspace_xianling_action_fusion-sub,
.container_workspace_xianling_action_sheath-sub {
  font-size: 9px;
  color: #adbec1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.container_workspace_xianling_dossier_retry {
  margin-top: 8px;
  width: 100%;
  min-height: 30px;
  padding: 4px 10px;
  font-size: 11px;
  letter-spacing: 1.2px;
  color: #f2dab0;
  background: rgba(25, 48, 58, 0.86);
  border: 1px solid rgba(212, 175, 99, 0.45);
  border-radius: 3px;
  &:hover:not(:disabled) {
    background: rgba(38, 70, 82, 0.92);
    color: #fff4d6;
  }
}
.container_workspace_xianling_dossier_sig {
  display: flex;
  align-items: center;
  margin-top: 8px;
  gap: 5px;
  font-size: 9px;
  letter-spacing: 1px;
  color: #8fa7ac;
}
.container_workspace_xianling_dossier_sig-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--formation-accent);
  flex: none;
}
.container_workspace_welcome_body_scene-state {
  color: #b4c8cc;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.container_workspace_xianling_dossier_sig-line {
  width: 14px;
  height: 1px;
  background: rgba(129, 151, 142, 0.45);
  margin: 0 3px;
  flex: none;
}
.container_workspace_xianling_dossier_tone {
  white-space: nowrap;
}

/* === Object Study Part Tabs === */
.container_workspace_xianling_study_tabs {
  display: none;
  align-items: center;
  gap: 3px;
  position: absolute;
  z-index: 7;
  bottom: 50px;
  left: 50%;
  transform: translateX(-50%);
  padding: 3px;
  border: 1px solid rgba(140, 165, 163, 0.36);
  background: rgba(8, 22, 31, 0.94);
  backdrop-filter: blur(10px);
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.45);
  border-radius: 3px;
  white-space: nowrap;
  [data-examining='true'] & {
    display: flex;
  }
}
[class*='container_workspace_xianling_study_tab'] {
  min-height: 26px;
  padding: 4px 11px;
  border: 0;
  border-radius: 2px;
  font-family: var(--xianling-font);
  font-size: 12.5px;
  color: #b7c8ca;
  background: transparent;
  &:hover:not(:disabled) {
    color: #fff2ce;
    background: rgba(192, 184, 147, 0.12);
  }
  &[aria-pressed='true'] {
    color: #e9d09a;
    background: rgba(192, 184, 147, 0.16);
    box-shadow: inset 0 -1px #dac595;
  }
}

/* === Stage Floating Caption === */
.container_workspace_xianling_stage_caption {
  position: absolute;
  z-index: 3;
  pointer-events: none;
  left: 50%;
  bottom: 54px;
  transform: translateX(-50%) translateY(5px);
  display: flex;
  gap: 9px;
  align-items: center;
  white-space: nowrap;
  opacity: 0;
  transition:
    opacity 0.35s,
    transform 0.35s;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(8, 25, 34, 0.72) 20%,
    rgba(8, 25, 34, 0.72) 80%,
    transparent
  );
  padding: 5px 18px;
  &[data-show='true'] {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
  [data-examining='true'] & {
    display: none;
  }
}
.container_workspace_xianling_stage_cap-icon {
  color: var(--formation-accent);
}
.container_workspace_xianling_stage_cap-name {
  font-family: var(--xianling-font);
  font-size: 16px;
  font-weight: 400;
  color: #eff6ed;
  letter-spacing: 3.5px;
}
.container_workspace_xianling_stage_cap-line {
  width: 15px;
  height: 1px;
  background: rgba(192, 211, 195, 0.6);
}
.container_workspace_xianling_stage_cap-en {
  font:
    8px Georgia,
    serif;
  letter-spacing: 2px;
  color: #bdc9c6;
}

/* === Bottom-Center Stage Tools Dock === */
.container_workspace_xianling_tools_dock {
  position: absolute;
  z-index: 7;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}
.container_workspace_xianling_tools_rotation {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 4px 10px;
  background: rgba(10, 28, 37, 0.9);
  border: 1px solid rgba(133, 157, 163, 0.28);
  border-radius: 3px;
  color: #c9d9d9;
  [data-examining='true'] & {
    display: none;
  }
}
.container_workspace_xianling_tools_rot-label {
  font-size: 10px;
  letter-spacing: 0.8px;
}
.container_workspace_xianling_tools_rot-slider {
  width: 84px;
  height: 14px;
  padding: 0;
  margin: 0;
  border: 0;
  background: transparent;
  accent-color: #c9e8dd;
  cursor: pointer;
}
.container_workspace_xianling_tools_rot-value {
  font:
    10px Georgia,
    serif;
  color: #e6d2ae;
  min-width: 24px;
  text-align: right;
}
.container_workspace_xianling_tools_view {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px 4px;
  background: rgba(10, 28, 37, 0.9);
  border: 1px solid rgba(133, 157, 163, 0.28);
  border-radius: 3px;
}
.container_workspace_xianling_tools_orbit,
.container_workspace_xianling_tools_pause,
.container_workspace_xianling_tools_reset {
  min-height: 26px;
  padding: 4px 8px;
  gap: 5px;
  font-size: 10px;
  letter-spacing: 0.8px;
  color: #b2c1c2;
  border: 0;
  background: transparent;
  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.06);
    color: #fff2ce;
  }
  &[aria-pressed='true'] {
    color: #e2c99e;
  }
}
.container_workspace_xianling_tools_vsep1,
.container_workspace_xianling_tools_vsep2 {
  width: 1px;
  height: 12px;
  background: rgba(165, 187, 186, 0.24);
}
[data-examining='true'] {
  .container_workspace_xianling_tools_orbit,
  .container_workspace_xianling_tools_pause,
  .container_workspace_xianling_tools_vsep1,
  .container_workspace_xianling_tools_vsep2 {
    display: none;
  }
}
.container_workspace_xianling_tools_zoom {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  background: rgba(10, 28, 37, 0.9);
  border: 1px solid rgba(133, 157, 163, 0.28);
  border-radius: 3px;
  color: #a6babb;
}
.container_workspace_xianling_tools_closer,
.container_workspace_xianling_tools_farther {
  min-height: 24px;
  padding: 2px 5px;
  font-size: 13px;
  border: 0;
  background: transparent;
  color: #b8cccc;
  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.06);
    color: #fff2ce;
  }
}
.container_workspace_xianling_tools_zoom-val {
  font:
    9.5px Georgia,
    serif;
  min-width: 26px;
  text-align: center;
  color: #c0d0d3;
}

/* === Bottom 24-Formation Library Dock === */
.container_workspace_xianling_library_dock {
  flex: none;
  padding: 8px 24px 8px;
  background: linear-gradient(120deg, #0e2028, #0a1a23 70%);
  border-top: 1px solid rgba(152, 183, 183, 0.22);
  position: relative;
  z-index: 4;
}
.container_workspace_xianling_library_head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.container_workspace_xianling_library_left,
.container_workspace_xianling_library_right {
  display: flex;
  align-items: center;
  gap: 10px;
}
.container_workspace_xianling_library_diamond {
  color: #d4c09a;
}
.container_workspace_xianling_library_title {
  font-family: var(--xianling-font);
  font-size: 14px;
  font-weight: 400;
  letter-spacing: 2px;
  color: #e8e3d3;
}
.container_workspace_xianling_library_en {
  font:
    8px Arial,
    sans-serif;
  letter-spacing: 1.8px;
  color: #8ea7ac;
}
.container_workspace_xianling_library_vol1,
.container_workspace_xianling_library_vol2 {
  min-height: 22px;
  padding: 2px 8px;
  font-size: 10.5px;
  letter-spacing: 0.8px;
  border: 1px solid rgba(130, 154, 157, 0.26);
  border-radius: 2px;
  color: #9eafb4;
  background: transparent;
  &:hover:not(:disabled) {
    color: #f3e4c3;
    background: rgba(198, 175, 129, 0.12);
  }
  &[aria-pressed='true'] {
    color: #eed8ac;
    background: rgba(198, 175, 129, 0.19);
    border-color: rgba(181, 161, 123, 0.54);
  }
}
.container_workspace_xianling_library_tour {
  min-height: 22px;
  padding: 2px 6px;
  gap: 5px;
  border: 0;
  background: transparent;
  font-size: 10px;
  letter-spacing: 1px;
  color: #a5bfbc;
  &:hover:not(:disabled) {
    color: #fff2ce;
    background: rgba(255, 255, 255, 0.05);
  }
}
.container_workspace_xianling_library_tour-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #62767b;
  .container_workspace_xianling_library_tour[aria-pressed='true'] & {
    background: var(--xianling-gold);
    box-shadow: 0 0 6px rgba(223, 199, 159, 0.6);
  }
}
.container_workspace_xianling_library_rsep {
  width: 1px;
  height: 12px;
  background: rgba(165, 187, 186, 0.24);
}
.container_workspace_xianling_library_prev,
.container_workspace_xianling_library_next {
  min-height: 22px;
  padding: 2px 4px;
  border: 0;
  background: transparent;
  color: #c8d6d5;
  &:hover:not(:disabled) {
    color: #fff2ce;
    background: rgba(255, 255, 255, 0.06);
  }
}
.container_workspace_xianling_library_index {
  font:
    10px Georgia,
    serif;
  letter-spacing: 1px;
  color: #c0cbca;
  min-width: 44px;
  text-align: center;
}

/* === Seven-Act Dance Bar === */
.container_workspace_xianling_music_bar {
  display: none;
  gap: 5px;
  margin: 0 0 6px;
  color: #87a2a8;
  font-family: var(--xianling-font);
  font-size: 10px;
  letter-spacing: 2px;
  [data-dance-enabled='true'] & {
    display: flex;
  }
}
[class*='container_workspace_xianling_music_act'] {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  &[data-on='true'] {
    color: #f5d7a3;
  }
}
[class*='container_workspace_xianling_music_line'] {
  height: 1px;
  background: rgba(114, 153, 153, 0.3);
  flex: 1;
  [data-on='true'] & {
    background: #d9c292;
    box-shadow: 0 0 7px #efcb84;
  }
}

/* === 24-Formation Cards Grid === */
.container_workspace_xianling_cards_grid {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  border: 1px solid rgba(140, 165, 163, 0.22);
  border-radius: 3px;
  overflow: hidden;
}
[class*='container_workspace_xianling_card_item'] {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 50px;
  padding: 5px 1px 5px;
  gap: 2px;
  color: #85a3a9;
  border: 0;
  border-right: 1px solid rgba(140, 165, 163, 0.16);
  border-radius: 0;
  background: rgba(7, 24, 32, 0.24);
  transition: background 0.18s;
  &[hidden] {
    display: none;
  }
  &:nth-child(12),
  &:last-child {
    border-right: 0;
  }
  &:hover:not(:disabled) {
    background: rgba(49, 80, 91, 0.34);
  }
  &[data-active='true'] {
    background: linear-gradient(150deg, rgba(50, 86, 106, 0.56), rgba(28, 54, 66, 0.72));
    box-shadow: inset 0 -2px var(--card-tint, #78d8ff);
  }
}
[class*='container_workspace_xianling_card_num'] {
  position: absolute;
  top: 4px;
  left: 5px;
  font:
    7.5px Georgia,
    serif;
  color: #829594;
  [data-active='true'] & {
    color: #f6e9cc;
  }
}
[class*='container_workspace_xianling_card_glyph'] {
  width: 34px;
  height: 24px;
  opacity: 0.78;
  display: block;
  [data-active='true'] & {
    opacity: 1;
    filter: drop-shadow(0 0 4px color-mix(in srgb, var(--card-tint, #78d8ff) 55%, transparent));
  }
}
[class*='container_workspace_xianling_card_name'] {
  font-family: var(--xianling-font);
  font-size: 11px;
  font-weight: 400;
  letter-spacing: 1.5px;
  color: #c3cecd;
  [data-active='true'] & {
    color: #f6e9cc;
  }
}

/* === Bottom Footer === */
.container_workspace_xianling_footer_bar {
  flex: none;
  height: 24px;
  padding: 0 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 9px;
  letter-spacing: 1.1px;
  color: #8aa2a8;
  background: #091820;
  border-top: 1px solid rgba(155, 184, 178, 0.12);
  position: relative;
  z-index: 4;
}
.container_workspace_xianling_footer_left {
  display: flex;
  align-items: center;
  gap: 6px;
}
.container_workspace_xianling_footer_dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #99d0bd;
}
.container_workspace_xianling_footer_right {
  font:
    8px Georgia,
    serif;
  letter-spacing: 1.6px;
}

/* === Motion Off & Reduced Motion Guards === */
:global(:root[data-motion='off'] .container_workspace_xianling_header_nav),
:global(:root[data-motion='off'] .container_workspace_xianling_dossier_actions),
:global(:root[data-motion='off'] .container_workspace_xianling_tools_dock),
:global(:root[data-motion='off'] .container_workspace_xianling_library_dock),
:global(:root[data-motion='off'] .container_workspace_xianling_main_astrolabe) {
  display: none;
}
@media (prefers-reduced-motion: reduce) {
  :global(:root:not([data-motion-preference='full']) .container_workspace_xianling_header_nav),
  :global(:root:not([data-motion-preference='full']) .container_workspace_xianling_dossier_actions),
  :global(:root:not([data-motion-preference='full']) .container_workspace_xianling_tools_dock),
  :global(:root:not([data-motion-preference='full']) .container_workspace_xianling_library_dock),
  :global(:root:not([data-motion-preference='full']) .container_workspace_xianling_main_astrolabe) {
    display: none;
  }
}

/* === Responsive Container Queries === */
@container (max-height: 620px) {
  .container_workspace_xianling_header_bar {
    height: 38px;
  }
  .container_workspace_xianling_dossier_story {
    display: none;
  }
  .container_workspace_xianling_dossier_census {
    padding: 4px 0;
  }
  .container_workspace_xianling_dossier_count {
    font-size: 18px;
  }
  .container_workspace_xianling_dossier_detail {
    height: 24px;
  }
  .container_workspace_xianling_dossier_actions {
    gap: 4px;
    margin-top: 7px;
  }
  .container_workspace_xianling_action_charge {
    min-height: 29px;
    height: 29px;
  }
  .container_workspace_xianling_action_recall,
  .container_workspace_xianling_action_sword-ex,
  .container_workspace_xianling_action_fusion,
  .container_workspace_xianling_action_sheath-ex {
    min-height: 25px;
    height: 25px;
  }
  .container_workspace_xianling_library_dock {
    padding: 6px 18px;
  }
  [class*='container_workspace_xianling_card_item'] {
    min-height: 42px;
    padding: 3px 1px;
  }
  [class*='container_workspace_xianling_card_glyph'] {
    height: 20px;
  }
}

@container (max-width: 960px) {
  .container_workspace_xianling_header_sub,
  .container_workspace_xianling_header_sep,
  .container_workspace_xianling_header_live,
  .container_workspace_xianling_header_rsep,
  .container_workspace_xianling_library_en,
  .container_workspace_xianling_footer_right {
    display: none;
  }
  .container_workspace_xianling_header_nav {
    margin-left: 8px;
    gap: 10px;
  }
  .container_workspace_welcome_body_content {
    width: 215px;
  }
  .container_workspace_xianling_dossier_panel {
    width: 206px;
  }
  .container_workspace_xianling_dossier_name {
    font-size: 24px;
  }
  [class*='container_workspace_xianling_card_num'] {
    display: none;
  }
}

@container (max-width: 720px) {
  .container_workspace_xianling_cards_grid {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
  .container_workspace_xianling_tools_rot-slider {
    width: 58px;
  }
  .container_workspace_xianling_footer_center {
    display: none;
  }
  .container_workspace_welcome_body_description,
  .container_workspace_welcome_footer_base {
    display: none;
  }
}
</style>
