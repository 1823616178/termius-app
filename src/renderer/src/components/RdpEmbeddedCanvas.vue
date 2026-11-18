<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { KeyRound, Maximize2, ClipboardPaste, ClipboardCopy, RotateCw, PlugZap } from '@lucide/vue'
import type { UserInteraction } from '@devolutions/iron-remote-desktop'
import type { RdpClientSession } from '../services/rdp-workspace'
import { t } from '../services/i18n'

const props = defineProps<{
  session: RdpClientSession
}>()

const emit = defineEmits<{
  stateChange: [status: 'active' | 'exited' | 'error', message?: string]
  disconnect: []
  reconnect: []
}>()

let wasmInitPromise: Promise<typeof import('@devolutions/iron-remote-desktop-rdp')> | undefined

async function ensureIronRdpWasm() {
  if (!wasmInitPromise) {
    wasmInitPromise = (async () => {
      const mod = await import('@devolutions/iron-remote-desktop-rdp')
      await mod.init('INFO')
      return mod
    })()
  }
  return wasmInitPromise
}

const mountHostRef = ref<HTMLDivElement>()
const scaleMode = ref<'fit' | 'full' | 'real'>('fit')
const phase = ref<'initializing' | 'connecting' | 'connected' | 'closed' | 'error'>('initializing')
const statusDetail = ref('')
const desktopSizeText = ref(`${props.session.resolved.width}x${props.session.resolved.height}`)

let userInteraction: UserInteraction | null = null
let mountedEl: HTMLElement | null = null
let disposed = false

async function bootSession(): Promise<void> {
  const params = props.session.embeddedParams
  if (!params) {
    phase.value = 'error'
    statusDetail.value = '缺少内嵌 RDP 会话启动参数'
    emit('stateChange', 'error', statusDetail.value)
    return
  }

  try {
    phase.value = 'initializing'
    const [rdpMod] = await Promise.all([ensureIronRdpWasm(), import('@devolutions/iron-remote-desktop')])
    if (disposed || !mountHostRef.value) return

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
      const timeout = setTimeout(() => reject(new Error('IronRDP 组件初始化超时')), 15_000)
      el.addEventListener(
        'ready',
        (event: Event) => {
          clearTimeout(timeout)
          const detail = (event as CustomEvent<{ irgUserInteraction?: UserInteraction }>).detail
          if (!detail?.irgUserInteraction) {
            reject(new Error('未获取到 IronRDP 控制句柄'))
            return
          }
          resolve(detail.irgUserInteraction)
        },
        { once: true }
      )
      mountHostRef.value!.appendChild(el)
    })

    if (disposed) {
      el.remove()
      return
    }

    userInteraction = readyInteraction
    readyInteraction.setEnableClipboard(params.enableClipboard)
    readyInteraction.setEnableAutoClipboard(false)
    readyInteraction.onWarningCallback((warning) => {
      statusDetail.value = warning
    })

    phase.value = 'connecting'
    const rect = mountHostRef.value.getBoundingClientRect()
    const targetWidth =
      props.session.resolved.resolutionMode === 'fit' && rect.width >= 640
        ? Math.floor(rect.width)
        : params.width
    const targetHeight =
      props.session.resolved.resolutionMode === 'fit' && rect.height >= 480
        ? Math.floor(rect.height)
        : params.height

    const cfg = readyInteraction
      .configBuilder()
      .withDestination(params.destination)
      .withProxyAddress(params.proxyAddress)
      .withAuthToken(params.authToken)
      .withUsername(params.username)
      .withPassword(params.password)
      .withServerDomain(params.serverDomain)
      .withDesktopSize({ width: targetWidth, height: targetHeight })
      .withExtension(rdpMod.enableCredssp(params.enableCredssp))
      .withExtension(rdpMod.displayControl(params.enableDisplayControl))
      .build()

    const sessionInfo = await readyInteraction.connect(cfg)
    if (disposed) {
      readyInteraction.shutdown()
      return
    }

    readyInteraction.setVisibility(true)
    applyScale(scaleMode.value)
    desktopSizeText.value = `${sessionInfo.initialDesktopSize.width}x${sessionInfo.initialDesktopSize.height}`
    phase.value = 'connected'
    statusDetail.value = ''
    emit('stateChange', 'active')

    try {
      const term = await sessionInfo.run()
      if (disposed) return
      phase.value = 'closed'
      const reason = term.reason()
      statusDetail.value = reason
      emit('stateChange', 'exited', reason)
    } catch (runErr) {
      if (disposed) return
      const msg = formatIronError(runErr)
      phase.value = 'error'
      statusDetail.value = msg
      emit('stateChange', 'error', msg)
    }
  } catch (err) {
    if (disposed) return
    const msg = formatIronError(err)
    phase.value = 'error'
    statusDetail.value = msg
    emit('stateChange', 'error', msg)
  }
}

function formatIronError(err: unknown): string {
  if (
    err &&
    typeof err === 'object' &&
    'backtrace' in err &&
    typeof (err as { backtrace: () => string }).backtrace === 'function'
  ) {
    return (err as { backtrace: () => string }).backtrace() || 'RDP 连接失败'
  }
  return err instanceof Error ? err.message : String(err)
}

function applyScale(next: 'fit' | 'full' | 'real'): void {
  scaleMode.value = next
  if (!userInteraction) return
  const enumCode = next === 'fit' ? 1 : next === 'full' ? 2 : 3
  userInteraction.setScale(enumCode)
}

function fitToViewport(): void {
  if (!userInteraction || !mountHostRef.value) return
  const rect = mountHostRef.value.getBoundingClientRect()
  const w = Math.max(640, Math.floor(rect.width))
  const h = Math.max(480, Math.floor(rect.height))
  userInteraction.resize(w, h)
  desktopSizeText.value = `${w}x${h}`
}

async function sendClipboard(): Promise<void> {
  if (!userInteraction) return
  try {
    await userInteraction.sendClipboardData()
  } catch (err) {
    statusDetail.value = formatIronError(err)
  }
}

async function saveClipboard(): Promise<void> {
  if (!userInteraction) return
  try {
    await userInteraction.saveRemoteClipboardData()
  } catch (err) {
    statusDetail.value = formatIronError(err)
  }
}

onMounted(() => {
  void bootSession()
})

onBeforeUnmount(() => {
  disposed = true
  try {
    userInteraction?.shutdown()
  } catch {}
  userInteraction = null
  mountedEl?.remove()
  mountedEl = null
})
</script>

<template>
  <div class="container_rdp-canvas_root_frame_base" data-testid="rdp-embedded-canvas">
    <div class="container_rdp-canvas_toolbar_row_base">
      <div class="container_rdp-canvas_toolbar_left_group">
        <span class="container_rdp-canvas_toolbar_mode_badge" :data-phase="phase">
          {{ desktopSizeText }} · {{ t('remotePage.modeBadgeB') }}
        </span>
        <select
          class="container_rdp-canvas_toolbar_scale_select"
          :value="scaleMode"
          @change="applyScale(($event.target as HTMLSelectElement).value as 'fit' | 'full' | 'real')"
        >
          <option class="container_rdp-canvas_toolbar_scale_optfit" value="fit">
            {{ t('remotePage.scaleFit') }}
          </option>
          <option class="container_rdp-canvas_toolbar_scale_optfull" value="full">
            {{ t('remotePage.scaleFull') }}
          </option>
          <option class="container_rdp-canvas_toolbar_scale_optreal" value="real">
            {{ t('remotePage.scaleReal') }}
          </option>
        </select>
        <button
          class="container_rdp-canvas_toolbar_resize_btn"
          type="button"
          :disabled="phase !== 'connected'"
          @click="fitToViewport"
        >
          <Maximize2 :size="13" />
          {{ t('remotePage.resizeToViewBtn') }}
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
          @click="saveClipboard"
        >
          <ClipboardCopy :size="13" />
          {{ t('remotePage.pullClipboardBtn') }}
        </button>
        <button
          v-if="phase === 'connected' || phase === 'connecting' || phase === 'initializing'"
          class="container_rdp-canvas_toolbar_disconnect_btn"
          type="button"
          @click="emit('disconnect')"
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
.container_rdp-canvas_toolbar_disconnect_btn {
  border-color: rgba(239, 68, 68, 0.45);
  color: #fca5a5;
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
