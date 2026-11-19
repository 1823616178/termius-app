<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { isAppForeground, onAppForegroundChange } from '../services/app-foreground'
import {
  KeyRound,
  Maximize,
  Minimize,
  Maximize2,
  ClipboardPaste,
  ClipboardCopy,
  RotateCw,
  PlugZap,
  AlertTriangle,
  X
} from '@lucide/vue'
import type { UserInteraction } from '@devolutions/iron-remote-desktop'
import {
  consumeRdpEmbeddedSecrets,
  ensureIronRdpWasm,
  type RdpClientSession
} from '../services/rdp-workspace'
import { locale, t } from '../services/i18n'
import { notify } from '../stores/workbench'
import OrbitSelect from './OrbitSelect.vue'

const props = defineProps<{
  session: RdpClientSession
}>()

const emit = defineEmits<{
  stateChange: [status: 'active' | 'exited' | 'error', message?: string]
  disconnect: []
  reconnect: []
}>()

const rootFrameRef = ref<HTMLDivElement>()
const mountHostRef = ref<HTMLDivElement>()
const scaleMode = ref<'fit' | 'full' | 'real'>('fit')
const phase = ref<'initializing' | 'connecting' | 'connected' | 'closed' | 'error'>('initializing')
const statusDetail = ref('')
const liveWarning = ref('')
const remoteClipboardPending = ref(false)
const isFullscreen = ref(false)
const desktopSizeText = ref(`${props.session.resolved.width}x${props.session.resolved.height}`)

const canDynamicResize = computed(() => props.session.resolved.resolutionMode === 'fit')

const scaleOptions = computed(() => {
  void locale.value
  return [
    { value: 'fit', label: t('remotePage.scaleFit') },
    { value: 'full', label: t('remotePage.scaleFull') },
    { value: 'real', label: t('remotePage.scaleReal') }
  ]
})

let userInteraction: UserInteraction | null = null
let mountedEl: HTMLElement | null = null
let disposed = false
let manualDisconnect = false

function alignEven(value: number, min: number, max: number): number {
  const clamped = Math.min(max, Math.max(min, Math.floor(value)))
  return clamped & ~1
}

function measureViewportSize(): { width: number; height: number; scaleFactor: number } | null {
  const host = mountHostRef.value
  if (!host) return null
  const rect = host.getBoundingClientRect()
  if (rect.width < 320 || rect.height < 240) return null
  const dpr =
    typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio) ? window.devicePixelRatio : 1
  const scaleFactor = Math.max(100, Math.min(500, Math.round(dpr * 100)))
  return {
    width: alignEven(rect.width, 640, 7680),
    height: alignEven(rect.height, 480, 4320),
    scaleFactor
  }
}

async function bootSession(): Promise<void> {
  const params = props.session.embeddedParams
  if (!params || !params.authToken) {
    phase.value = 'error'
    statusDetail.value = t('remotePage.wasmMissingParams')
    emit('stateChange', 'error', statusDetail.value)
    return
  }

  const connectParams = { ...params }
  consumeRdpEmbeddedSecrets(props.session.sessionId)

  try {
    phase.value = 'initializing'
    const [rdpMod] = await Promise.all([ensureIronRdpWasm(), import('@devolutions/iron-remote-desktop')])
    if (disposed || manualDisconnect || !mountHostRef.value) return

    mountHostRef.value.innerHTML = ''
    const el = document.createElement('iron-remote-desktop') as HTMLElement & {
      module?: unknown
      scale?: string
      flexcenter?: string
    }
    el.className = 'container_rdp-canvas_wasm_element_host'
    el.style.width = '100%'
    el.style.height = '100%'
    el.style.display = 'flex'
    el.style.flex = '1'
    el.scale = scaleMode.value
    el.flexcenter = 'true'
    el.module = rdpMod.Backend
    mountedEl = el

    const readyInteraction = await new Promise<UserInteraction>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(t('remotePage.wasmInitTimeout'))), 15_000)
      el.addEventListener(
        'ready',
        (event: Event) => {
          clearTimeout(timeout)
          const detail = (event as CustomEvent<{ irgUserInteraction?: UserInteraction }>).detail
          if (!detail?.irgUserInteraction) {
            reject(new Error(t('remotePage.wasmNoHandle')))
            return
          }
          resolve(detail.irgUserInteraction)
        },
        { once: true }
      )
      mountHostRef.value!.appendChild(el)
    })

    if (disposed || manualDisconnect) {
      el.remove()
      return
    }

    userInteraction = readyInteraction
    readyInteraction.setEnableClipboard(connectParams.enableClipboard)
    readyInteraction.setEnableAutoClipboard(false)
    readyInteraction.onWarningCallback((warning) => {
      if (phase.value === 'connected') liveWarning.value = warning
      else statusDetail.value = warning
    })
    readyInteraction.onClipboardRemoteUpdateCallback(() => {
      if (!disposed) remoteClipboardPending.value = true
    })

    phase.value = 'connecting'
    const measured = canDynamicResize.value ? measureViewportSize() : null
    const targetWidth = measured ? measured.width : alignEven(connectParams.width, 640, 7680)
    const targetHeight = measured ? measured.height : alignEven(connectParams.height, 480, 4320)

    const cfg = readyInteraction
      .configBuilder()
      .withDestination(connectParams.destination)
      .withProxyAddress(connectParams.proxyAddress)
      .withAuthToken(connectParams.authToken)
      .withUsername(connectParams.username)
      .withPassword(connectParams.password)
      .withServerDomain(connectParams.serverDomain)
      .withDesktopSize({ width: targetWidth, height: targetHeight })
      .withExtension(rdpMod.enableCredssp(connectParams.enableCredssp))
      .withExtension(rdpMod.displayControl(connectParams.enableDisplayControl))
      .build()

    connectParams.password = ''
    connectParams.authToken = ''

    const sessionInfo = await readyInteraction.connect(cfg)
    if (disposed || manualDisconnect) {
      readyInteraction.shutdown()
      return
    }

    phase.value = 'connected'
    applyRdpVisibility()
    applyScale(scaleMode.value)
    desktopSizeText.value = `${sessionInfo.initialDesktopSize.width}x${sessionInfo.initialDesktopSize.height}`
    statusDetail.value = ''
    scheduleAutoResize()
    emit('stateChange', 'active')

    try {
      const term = await sessionInfo.run()
      if (disposed) return
      phase.value = 'closed'
      const reason = manualDisconnect || props.session.manualDisconnect ? '' : term.reason()
      statusDetail.value = reason
      emit('stateChange', 'exited', reason || undefined)
    } catch (runErr) {
      if (disposed) return
      if (manualDisconnect || props.session.manualDisconnect) {
        phase.value = 'closed'
        statusDetail.value = ''
        emit('stateChange', 'exited')
        return
      }
      const msg = formatIronError(runErr)
      phase.value = 'error'
      statusDetail.value = msg
      emit('stateChange', 'error', msg)
    }
  } catch (err) {
    if (disposed) return
    if (manualDisconnect || props.session.manualDisconnect) {
      phase.value = 'closed'
      statusDetail.value = ''
      emit('stateChange', 'exited')
      return
    }
    const msg = formatIronError(err)
    phase.value = 'error'
    statusDetail.value = msg
    emit('stateChange', 'error', msg)
  } finally {
    connectParams.password = ''
    connectParams.authToken = ''
  }
}

function formatIronError(err: unknown): string {
  if (
    err &&
    typeof err === 'object' &&
    'backtrace' in err &&
    typeof (err as { backtrace: () => string }).backtrace === 'function'
  ) {
    return (err as { backtrace: () => string }).backtrace() || t('remotePage.connectFailed')
  }
  return err instanceof Error ? err.message : String(err)
}

let surfaceVisible = true
let lastVisibility: boolean | undefined
let stopForeground: (() => void) | undefined
let surfaceObserver: IntersectionObserver | undefined
let resizeObserver: ResizeObserver | undefined
let resizeDebounceTimer: ReturnType<typeof setTimeout> | undefined
let lastAppliedSize = ''

function applyRdpVisibility(): void {
  if (!userInteraction || phase.value !== 'connected') return
  const visible = surfaceVisible && isAppForeground()
  if (visible === lastVisibility) return
  lastVisibility = visible
  void window.orbit.rdp.setDisplayVisible(props.session.sessionId, visible).catch((err) => {
    if (!disposed) liveWarning.value = formatIronError(err)
  })
  try {
    userInteraction.setVisibility(visible)
  } catch {
    /* The session can close while a visibility event is in flight. */
  }
}

function applyScale(next: 'fit' | 'full' | 'real'): void {
  scaleMode.value = next
  if (!userInteraction) return
  const enumCode = next === 'fit' ? 1 : next === 'full' ? 2 : 3
  userInteraction.setScale(enumCode)
}

function fitToViewport(): void {
  if (!userInteraction || !canDynamicResize.value || phase.value !== 'connected') return
  const measured = measureViewportSize()
  if (!measured) return
  const key = `${measured.width}x${measured.height}@${measured.scaleFactor}`
  if (key === lastAppliedSize) return
  try {
    userInteraction.resize(measured.width, measured.height, measured.scaleFactor)
    lastAppliedSize = key
    desktopSizeText.value = `${measured.width}x${measured.height}`
  } catch (err) {
    liveWarning.value = formatIronError(err)
  }
}

function scheduleAutoResize(): void {
  if (
    !canDynamicResize.value ||
    scaleMode.value !== 'fit' ||
    phase.value !== 'connected' ||
    !surfaceVisible
  ) {
    return
  }
  clearTimeout(resizeDebounceTimer)
  resizeDebounceTimer = setTimeout(() => {
    resizeDebounceTimer = undefined
    if (
      canDynamicResize.value &&
      scaleMode.value === 'fit' &&
      phase.value === 'connected' &&
      surfaceVisible
    ) {
      fitToViewport()
    }
  }, 420)
}

async function sendClipboard(): Promise<void> {
  if (!userInteraction) return
  try {
    await userInteraction.sendClipboardData()
    liveWarning.value = ''
    notify(t('remotePage.clipboardPushed'))
  } catch (err) {
    liveWarning.value = formatIronError(err)
  }
}

async function saveClipboard(): Promise<void> {
  if (!userInteraction) return
  try {
    await userInteraction.saveRemoteClipboardData()
    remoteClipboardPending.value = false
    liveWarning.value = ''
    notify(t('remotePage.clipboardPulled'))
  } catch (err) {
    liveWarning.value = formatIronError(err)
  }
}

async function toggleFullscreen(): Promise<void> {
  const root = rootFrameRef.value
  if (!root) return
  try {
    if (document.fullscreenElement === root) {
      await document.exitFullscreen()
    } else {
      await root.requestFullscreen()
    }
  } catch (err) {
    liveWarning.value = formatIronError(err)
  }
}

function handleFullscreenChange(): void {
  isFullscreen.value = Boolean(rootFrameRef.value && document.fullscreenElement === rootFrameRef.value)
  scheduleAutoResize()
}

function handleManualDisconnect(): void {
  manualDisconnect = true
  try {
    userInteraction?.shutdown()
  } catch {
    /* ignore */
  }
  phase.value = 'closed'
  statusDetail.value = ''
  liveWarning.value = ''
  emit('disconnect')
}

onMounted(() => {
  stopForeground = onAppForegroundChange(() => applyRdpVisibility())
  document.addEventListener('fullscreenchange', handleFullscreenChange)
  if (mountHostRef.value) {
    surfaceObserver = new IntersectionObserver((entries) => {
      const latest = entries.at(-1)
      surfaceVisible = Boolean(latest?.isIntersecting)
      applyRdpVisibility()
      if (surfaceVisible) scheduleAutoResize()
    })
    surfaceObserver.observe(mountHostRef.value)
    resizeObserver = new ResizeObserver(() => scheduleAutoResize())
    resizeObserver.observe(mountHostRef.value)
  }
  void bootSession()
})

onBeforeUnmount(() => {
  disposed = true
  clearTimeout(resizeDebounceTimer)
  document.removeEventListener('fullscreenchange', handleFullscreenChange)
  if (rootFrameRef.value && document.fullscreenElement === rootFrameRef.value) {
    void document.exitFullscreen().catch(() => {})
  }
  stopForeground?.()
  surfaceObserver?.disconnect()
  resizeObserver?.disconnect()
  try {
    userInteraction?.shutdown()
  } catch {}
  userInteraction = null
  mountedEl?.remove()
  mountedEl = null
})
</script>

<template>
  <div
    ref="rootFrameRef"
    class="container_rdp-canvas_root_frame_base"
    data-testid="rdp-embedded-canvas"
    :data-rdp-capture="phase === 'connected' ? 'true' : 'false'"
  >
    <div class="container_rdp-canvas_toolbar_row_base">
      <div class="container_rdp-canvas_toolbar_left_group">
        <span class="container_rdp-canvas_toolbar_mode_badge" :data-phase="phase">
          {{ desktopSizeText }} · {{ t('remotePage.modeBadgeB') }}
        </span>
        <OrbitSelect
          :model-value="scaleMode"
          :options="scaleOptions"
          :aria-label="t('remotePage.scaleFit')"
          size="sm"
          width="126px"
          :instance="`rdp-scale-${session.sessionId.slice(0, 8)}`"
          @update:model-value="applyScale($event as 'fit' | 'full' | 'real')"
        />
        <button
          class="container_rdp-canvas_toolbar_resize_btn"
          type="button"
          :disabled="phase !== 'connected' || !canDynamicResize"
          :title="canDynamicResize ? t('remotePage.resizeToViewBtn') : t('remotePage.fixedResHint')"
          @click="fitToViewport"
        >
          <Maximize2 :size="13" />
          {{ t('remotePage.resizeToViewBtn') }}
        </button>
        <button
          class="container_rdp-canvas_toolbar_fullscr_btn"
          type="button"
          :title="isFullscreen ? t('remotePage.exitFullscreenBtn') : t('remotePage.fullscreenBtn')"
          @click="toggleFullscreen"
        >
          <Minimize v-if="isFullscreen" :size="13" />
          <Maximize v-else :size="13" />
          {{ isFullscreen ? t('remotePage.exitFullscreenBtn') : t('remotePage.fullscreenBtn') }}
        </button>
      </div>
      <div class="container_rdp-canvas_toolbar_right_group">
        <button
          class="container_rdp-canvas_toolbar_cad_btn"
          type="button"
          :disabled="phase !== 'connected'"
          @click="userInteraction?.ctrlAltDel()"
        >
          <KeyRound :size="13" />
          {{ t('remotePage.sendCadBtn') }}
        </button>
        <button
          class="container_rdp-canvas_toolbar_meta_btn"
          type="button"
          :disabled="phase !== 'connected'"
          @click="userInteraction?.metaKey()"
        >
          {{ t('remotePage.sendMetaBtn') }}
        </button>
        <button
          v-if="session.resolved.enableClipboard"
          class="container_rdp-canvas_toolbar_pushclip_btn"
          type="button"
          :disabled="phase !== 'connected'"
          @click="sendClipboard"
        >
          <ClipboardPaste :size="13" />
          {{ t('remotePage.pushClipboardBtn') }}
        </button>
        <button
          v-if="session.resolved.enableClipboard"
          class="container_rdp-canvas_toolbar_pullclip_btn"
          type="button"
          :disabled="phase !== 'connected'"
          :data-pending="remoteClipboardPending ? 'true' : 'false'"
          :title="
            remoteClipboardPending ? t('remotePage.clipboardUpdatedHint') : t('remotePage.pullClipboardBtn')
          "
          @click="saveClipboard"
        >
          <ClipboardCopy :size="13" />
          {{ t('remotePage.pullClipboardBtn') }}
          <span v-if="remoteClipboardPending" class="container_rdp-canvas_toolbar_clipdot_badge" />
        </button>
        <button
          v-if="phase === 'connected' || phase === 'connecting' || phase === 'initializing'"
          class="container_rdp-canvas_toolbar_disconnect_btn"
          type="button"
          @click="handleManualDisconnect"
        >
          <PlugZap :size="13" />
          {{ t('remotePage.disconnectBtn') }}
        </button>
        <button
          v-else
          class="container_rdp-canvas_toolbar_reconnect_btn"
          type="button"
          @click="emit('reconnect')"
        >
          <RotateCw :size="13" />
          {{ t('remotePage.reconnectBtn') }}
        </button>
      </div>
    </div>

    <div
      v-if="liveWarning && phase === 'connected'"
      class="container_rdp-canvas_warning_strip_bar"
      role="status"
    >
      <AlertTriangle :size="13" />
      <span class="container_rdp-canvas_warning_strip_text">{{ liveWarning }}</span>
      <button
        class="container_rdp-canvas_warning_strip_close"
        type="button"
        :aria-label="t('remotePage.warningDismiss')"
        @click="liveWarning = ''"
      >
        <X :size="12" />
      </button>
    </div>

    <div class="container_rdp-canvas_stage_body_base">
      <div ref="mountHostRef" class="container_rdp-canvas_mount_viewport_box" data-testid="rdp-wasm-mount" />
      <div v-if="phase !== 'connected'" class="container_rdp-canvas_status_overlay_panel" :data-phase="phase">
        <strong class="container_rdp-canvas_status_overlay_title">
          {{
            phase === 'error'
              ? t('remotePage.statusError')
              : phase === 'closed'
                ? t('remotePage.statusExited')
                : t('remotePage.embeddedConnecting')
          }}
        </strong>
        <p v-if="statusDetail" class="container_rdp-canvas_status_overlay_detail">
          {{ statusDetail }}
        </p>
        <button
          v-if="phase === 'error' || phase === 'closed'"
          class="container_rdp-canvas_status_overlay_retry"
          type="button"
          @click="emit('reconnect')"
        >
          <RotateCw :size="13" />
          {{ t('remotePage.reconnectBtn') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.container_rdp-canvas_root_frame_base {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--color-surface-canvas);
}
.container_rdp-canvas_toolbar_row_base {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-panel);
}
.container_rdp-canvas_toolbar_left_group,
.container_rdp-canvas_toolbar_right_group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.container_rdp-canvas_toolbar_mode_badge {
  padding: 4px 8px;
  border-radius: 999px;
  font-family: var(--font-term);
  font-size: 11px;
  background: var(--color-surface-1);
  border: 1px solid var(--color-border-control);
  color: var(--color-text-secondary);
  &[data-phase='connected'] {
    border-color: var(--color-success);
    color: var(--color-success);
  }
  &[data-phase='error'] {
    border-color: var(--color-error);
    color: var(--color-error);
  }
}
.container_rdp-canvas_toolbar_resize_btn,
.container_rdp-canvas_toolbar_fullscr_btn,
.container_rdp-canvas_toolbar_cad_btn,
.container_rdp-canvas_toolbar_meta_btn,
.container_rdp-canvas_toolbar_pushclip_btn,
.container_rdp-canvas_toolbar_pullclip_btn,
.container_rdp-canvas_toolbar_disconnect_btn,
.container_rdp-canvas_toolbar_reconnect_btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  min-height: 28px;
  border-radius: 7px;
  border: 1px solid var(--color-border-control);
  background: var(--color-surface-1);
  color: var(--color-text-primary);
  font-size: var(--font-size-ui-xs);
  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
}
.container_rdp-canvas_toolbar_pullclip_btn[data-pending='true'] {
  border-color: var(--color-accent-primary);
  background: var(--color-accent-primary-soft);
  color: var(--color-accent-primary-bright);
}
.container_rdp-canvas_toolbar_clipdot_badge {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-accent-primary-bright);
}
.container_rdp-canvas_toolbar_disconnect_btn {
  border-color: rgba(239, 68, 68, 0.45);
  color: #fca5a5;
}
.container_rdp-canvas_warning_strip_bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid rgba(245, 158, 11, 0.35);
  background: rgba(245, 158, 11, 0.14);
  color: #fde68a;
  font-size: var(--font-size-ui-xs);
}
.container_rdp-canvas_warning_strip_text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.container_rdp-canvas_warning_strip_close {
  min-height: 20px;
  padding: 2px 4px;
  color: inherit;
}
.container_rdp-canvas_stage_body_base {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  background: #070a10;
}
.container_rdp-canvas_mount_viewport_box {
  flex: 1;
  min-height: 0;
  display: flex;
}
.container_rdp-canvas_status_overlay_panel {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px;
  background: rgba(8, 12, 18, 0.84);
  backdrop-filter: blur(4px);
  text-align: center;
}
.container_rdp-canvas_status_overlay_title {
  color: var(--color-text-heading);
  font-size: var(--font-size-ui-md);
}
.container_rdp-canvas_status_overlay_detail {
  margin: 0;
  max-width: 560px;
  color: var(--color-text-secondary);
  font-family: var(--font-term);
  font-size: var(--font-size-ui-xs);
  white-space: pre-wrap;
  word-break: break-word;
}
.container_rdp-canvas_status_overlay_retry {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: 8px;
  border: 1px solid var(--color-accent-primary);
  background: var(--color-accent-primary-soft);
  color: var(--color-accent-primary-bright);
}
</style>
