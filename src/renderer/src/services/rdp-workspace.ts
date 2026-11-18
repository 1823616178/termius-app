import { computed, ref } from 'vue'
import type {
  RdpCertPromptRequest,
  RdpConnectSource,
  RdpSessionInfo,
  RdpSessionStateEvent
} from '../../../shared/rdp'
import { refreshKnownRdpHosts } from '../stores/workbench'

export interface RdpClientSession extends RdpSessionInfo {
  lastError?: string
}

export const rdpSessions = ref<RdpClientSession[]>([])
export const activeRdpSessionId = ref<string>('')
export const rdpCertQueue = ref<RdpCertPromptRequest[]>([])
export const activeRdpCertPrompt = computed<RdpCertPromptRequest | undefined>(() => rdpCertQueue.value[0])
export const rdpConnecting = ref(false)
export const rdpConnectError = ref('')

export const activeRdpSessionCount = computed(
  () => rdpSessions.value.filter((item) => item.status === 'starting' || item.status === 'active').length
)

export const currentRdpSession = computed<RdpClientSession | undefined>(
  () => rdpSessions.value.find((item) => item.sessionId === activeRdpSessionId.value) ?? rdpSessions.value[0]
)

let removeSessionStateListener: (() => void) | undefined
let removeCertPromptListener: (() => void) | undefined

export function ensureRdpWorkspaceListeners(): void {
  if (!removeSessionStateListener) {
    removeSessionStateListener = window.orbit.rdp.onSessionState((event: RdpSessionStateEvent) => {
      const target = rdpSessions.value.find((item) => item.sessionId === event.sessionId)
      if (!target) return
      target.status = event.status
      if (event.message) target.lastError = event.message
      if (event.status === 'error' || event.status === 'exited') {
        rdpCertQueue.value = rdpCertQueue.value.filter((item) => item.sessionId !== event.sessionId)
      }
    })
  }
  if (!removeCertPromptListener) {
    removeCertPromptListener = window.orbit.rdp.onCertPrompt((req: RdpCertPromptRequest) => {
      if (rdpCertQueue.value.some((item) => item.promptId === req.promptId)) return
      rdpCertQueue.value = [...rdpCertQueue.value, req]
    })
  }
}

export function disposeRdpWorkspaceListeners(): void {
  removeSessionStateListener?.()
  removeSessionStateListener = undefined
  removeCertPromptListener?.()
  removeCertPromptListener = undefined
}

export async function connectRdpSession(source: RdpConnectSource): Promise<RdpClientSession> {
  ensureRdpWorkspaceListeners()
  rdpConnecting.value = true
  rdpConnectError.value = ''
  try {
    const info = await window.orbit.rdp.connect(source)
    const entry: RdpClientSession = { ...info }
    rdpSessions.value = [...rdpSessions.value, entry]
    activeRdpSessionId.value = info.sessionId
    return entry
  } catch (err) {
    const msg = err instanceof Error ? err.message : '发起 RDP 连接失败'
    rdpConnectError.value = msg
    throw err
  } finally {
    rdpConnecting.value = false
  }
}

export async function disconnectRdpSession(sessionId: string): Promise<void> {
  try {
    await window.orbit.rdp.disconnect(sessionId)
  } finally {
    const target = rdpSessions.value.find((item) => item.sessionId === sessionId)
    if (target) target.status = 'exited'
    rdpCertQueue.value = rdpCertQueue.value.filter((item) => item.sessionId !== sessionId)
  }
}

export async function closeRdpSessionTab(sessionId: string): Promise<void> {
  const existing = rdpSessions.value.find((item) => item.sessionId === sessionId)
  if (existing && (existing.status === 'starting' || existing.status === 'active')) {
    await window.orbit.rdp.disconnect(sessionId).catch(() => {})
  }
  rdpSessions.value = rdpSessions.value.filter((item) => item.sessionId !== sessionId)
  rdpCertQueue.value = rdpCertQueue.value.filter((item) => item.sessionId !== sessionId)
  if (activeRdpSessionId.value === sessionId) {
    activeRdpSessionId.value = rdpSessions.value.at(-1)?.sessionId ?? ''
  }
}

export function markRdpSessionStatus(
  sessionId: string,
  status: 'active' | 'exited' | 'error',
  message?: string
): void {
  const target = rdpSessions.value.find((item) => item.sessionId === sessionId)
  if (!target) return
  target.status = status
  if (message !== undefined) target.lastError = message
}

export async function decideRdpCertPrompt(accept: boolean): Promise<void> {
  const current = rdpCertQueue.value[0]
  if (!current) return
  rdpCertQueue.value = rdpCertQueue.value.slice(1)
  await window.orbit.rdp.decideCert(current.promptId, accept)
  if (accept) {
    void refreshKnownRdpHosts()
  }
}
