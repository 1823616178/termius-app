import { computed, ref } from 'vue'
import type {
  RdpCertPromptRequest,
  RdpConnectSource,
  RdpLaunchMode,
  RdpProfile,
  RdpProfileOptions,
  RdpSessionInfo,
  RdpSessionStateEvent
} from '../../../shared/rdp'
import { refreshKnownRdpHosts } from '../stores/workbench'

export interface RdpClientSession extends RdpSessionInfo {
  lastError?: string
  manualDisconnect?: boolean
  adhocOptions?: RdpProfileOptions
}

export interface RdpPasswordPromptState {
  title: string
  endpoint: string
  source: RdpConnectSource
  replaceSessionId?: string
}

export const rdpSessions = ref<RdpClientSession[]>([])
export const activeRdpSessionId = ref<string>('')
export const rdpCertQueue = ref<RdpCertPromptRequest[]>([])
export const activeRdpCertPrompt = computed<RdpCertPromptRequest | undefined>(() => rdpCertQueue.value[0])
export const rdpConnecting = ref(false)
export const rdpConnectError = ref('')
export const rdpPasswordPrompt = ref<RdpPasswordPromptState | null>(null)

export const activeRdpSessionCount = computed(
  () => rdpSessions.value.filter((item) => item.status === 'starting' || item.status === 'active').length
)

export const currentRdpSession = computed<RdpClientSession | undefined>(
  () => rdpSessions.value.find((item) => item.sessionId === activeRdpSessionId.value) ?? rdpSessions.value[0]
)

let wasmInitPromise: Promise<typeof import('@devolutions/iron-remote-desktop-rdp')> | undefined

/**
 * Module-level singleton initializer for IronRDP WASM.
 * Resets on failure so subsequent connection attempts can recover cleanly.
 */
export async function ensureIronRdpWasm(): Promise<typeof import('@devolutions/iron-remote-desktop-rdp')> {
  if (!wasmInitPromise) {
    wasmInitPromise = (async () => {
      const mod = await import('@devolutions/iron-remote-desktop-rdp')
      await mod.init('INFO')
      return mod
    })().catch((err) => {
      wasmInitPromise = undefined
      throw err
    })
  }
  return wasmInitPromise
}

export function extractRdpOptionsFromSession(session: RdpClientSession): RdpProfileOptions {
  if (session.adhocOptions) return { ...session.adhocOptions }
  return {
    resolutionMode: session.resolved.resolutionMode,
    width: session.resolved.width,
    height: session.resolved.height,
    colorDepth: session.resolved.colorDepth,
    qualityPreset: session.resolved.qualityPreset,
    securityLayer: session.resolved.securityLayer,
    certPolicy: session.resolved.certPolicy,
    enableClipboard: session.resolved.enableClipboard,
    enableAudio: session.resolved.enableAudio,
    driveRedirect: session.resolved.driveRedirect,
    sharedDrivePath: session.resolved.sharedDrivePath
  }
}

export function findSavedRdpProfile(list: RdpProfile[], id?: string, name?: string): RdpProfile | undefined {
  if (id) {
    const byId = list.find((item) => item.id === id)
    if (byId) return byId
  }
  if (!name) return undefined
  const matches = list.filter((item) => item.name === name)
  if (matches.length <= 1) return matches[0]
  return [...matches].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
}

export function consumeRdpEmbeddedSecrets(sessionId: string): void {
  const target = rdpSessions.value.find((item) => item.sessionId === sessionId)
  if (!target?.embeddedParams) return
  target.embeddedParams.password = ''
  target.embeddedParams.authToken = ''
}

export function requestRdpPasswordPrompt(prompt: RdpPasswordPromptState): void {
  rdpPasswordPrompt.value = prompt
}

export function cancelRdpPasswordPrompt(): void {
  rdpPasswordPrompt.value = null
}

let removeSessionStateListener: (() => void) | undefined
let removeCertPromptListener: (() => void) | undefined

export function ensureRdpWorkspaceListeners(): void {
  if (!removeSessionStateListener) {
    removeSessionStateListener = window.orbit.rdp.onSessionState((event: RdpSessionStateEvent) => {
      const target = rdpSessions.value.find((item) => item.sessionId === event.sessionId)
      if (!target) return
      if (target.manualDisconnect && event.status === 'error') {
        target.status = 'exited'
      } else {
        target.status = event.status
        if (event.message) target.lastError = event.message
      }
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
    const entry: RdpClientSession = {
      ...info,
      ...(source.kind === 'adhoc' && source.options ? { adhocOptions: { ...source.options } } : {})
    }
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
  const target = rdpSessions.value.find((item) => item.sessionId === sessionId)
  if (target) {
    target.manualDisconnect = true
  }
  try {
    await window.orbit.rdp.disconnect(sessionId)
  } finally {
    const current = rdpSessions.value.find((item) => item.sessionId === sessionId)
    if (current) {
      current.status = 'exited'
      current.lastError = undefined
    }
    rdpCertQueue.value = rdpCertQueue.value.filter((item) => item.sessionId !== sessionId)
  }
}

export async function closeRdpSessionTab(sessionId: string): Promise<void> {
  const existing = rdpSessions.value.find((item) => item.sessionId === sessionId)
  if (existing) existing.manualDisconnect = true
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
  if (target.manualDisconnect && status === 'error') {
    target.status = 'exited'
    return
  }
  target.status = status
  if (message !== undefined) target.lastError = message
}

export function buildReconnectSourceForSession(
  session: RdpClientSession,
  modeOverride?: RdpLaunchMode
): RdpConnectSource {
  const mode = modeOverride ?? session.mode
  if (session.profileId) {
    return {
      kind: 'profile',
      profileId: session.profileId,
      launchModeOverride: mode
    }
  }
  return {
    kind: 'adhoc',
    name: session.title,
    host: session.host,
    port: session.port,
    domain: session.domain,
    username: session.username,
    launchModeOverride: mode,
    options: extractRdpOptionsFromSession(session)
  }
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
