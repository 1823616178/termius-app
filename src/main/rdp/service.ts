import { randomBytes, randomUUID } from 'node:crypto'
import type { DataClient } from '../data-client'
import {
  DEFAULT_RDP_SETTINGS,
  rdpConnectSourceSchema,
  type KnownRdpHostEntry,
  type RdpCertPromptRequest,
  type RdpConnectSource,
  type RdpEnvironmentProbe,
  type RdpLaunchMode,
  type RdpProfile,
  type RdpProfileInput,
  type RdpProfileOptions,
  type RdpResolvedConfigSummary,
  type RdpSessionInfo,
  type RdpSessionStateEvent,
  type RdpSettings
} from '../../shared/rdp'
import type { AllProtocolSettings } from '../../shared/files'
import {
  launchExternalRdpSession,
  sweepStaleTempRdpFiles,
  type ManagedExternalProcess
} from './external-launcher'
import { probeRdpEnvironment } from './probe'
import { RdcPathProxyServer } from './rdcleanpath-proxy'
import { preflightRdpTlsCertificate, type InspectedRdpTlsCert } from './tls-preflight'

export interface RdpServiceHooks {
  data: DataClient
  encryptSecret: (plaintext: string) => Promise<Uint8Array>
  decryptSecret: (profileId: string, blob: Uint8Array) => Promise<string>
  emitSessionState: (ownerWindowId: number, event: RdpSessionStateEvent) => void
  emitCertPrompt: (ownerWindowId: number, prompt: RdpCertPromptRequest) => void
  probeFn?: typeof probeRdpEnvironment
}

export function resolveRdpLaunchConfig(params: {
  settings: RdpSettings
  options: RdpProfileOptions
  launchModeOverride?: RdpLaunchMode
  probe: RdpEnvironmentProbe
}): RdpResolvedConfigSummary {
  const { settings, options, launchModeOverride, probe } = params
  const requestedMode: RdpLaunchMode =
    launchModeOverride ??
    (options.launchMode === 'external' || options.launchMode === 'embedded'
      ? options.launchMode
      : settings.preferredMode)

  let effectiveMode: RdpLaunchMode = requestedMode
  let fallbackFromExternal = false
  let fallbackReason: string | undefined

  if (requestedMode === 'external' && !probe.schemeAAvailable) {
    if (settings.autoFallbackToEmbedded) {
      effectiveMode = 'embedded'
      fallbackFromExternal = true
      fallbackReason =
        probe.schemeAMissingReason ?? '当前系统未检测到可用的原生 RDP 客户端，已自动回退至内嵌画布'
    } else {
      const hint = probe.schemeAInstallHint ? `\n建议安装命令：${probe.schemeAInstallHint}` : ''
      throw new Error(
        `${probe.schemeAMissingReason ?? '未检测到系统原生 RDP 客户端'}${hint}\n可在设置中启用“系统缺失时自动回退至方案 B（内嵌画布）”或手动切换至方案 B。`
      )
    }
  }

  return {
    effectiveMode,
    fallbackFromExternal,
    fallbackReason,
    width: options.width ?? settings.defaultWidth,
    height: options.height ?? settings.defaultHeight,
    resolutionMode: options.resolutionMode ?? settings.resolutionMode,
    colorDepth: options.colorDepth ?? settings.colorDepth,
    qualityPreset: options.qualityPreset ?? settings.qualityPreset,
    securityLayer: options.securityLayer ?? settings.securityLayer,
    certPolicy: options.certPolicy ?? settings.certPolicy,
    enableClipboard: options.enableClipboard ?? settings.enableClipboard,
    enableAudio: options.enableAudio ?? settings.enableAudio,
    driveRedirect: options.driveRedirect ?? settings.driveRedirect,
    sharedDrivePath: options.sharedDrivePath ?? settings.sharedDrivePath
  }
}

interface ActiveRdpSessionRecord {
  sessionId: string
  ownerWindowId: number
  info: RdpSessionInfo
  external?: ManagedExternalProcess
}

interface PendingCertPrompt {
  promptId: string
  sessionId: string
  ownerWindowId: number
  host: string
  port: number
  cert: InspectedRdpTlsCert
  resolve: (accepted: boolean) => void
  timer: NodeJS.Timeout
}

export class RdpService {
  private readonly sessions = new Map<string, ActiveRdpSessionRecord>()
  private readonly certPrompts = new Map<string, PendingCertPrompt>()
  private readonly proxy: RdcPathProxyServer
  private cachedProbe: RdpEnvironmentProbe | null = null
  private cachedCustomPath = ''

  constructor(private readonly hooks: RdpServiceHooks) {
    void sweepStaleTempRdpFiles()
    this.proxy = new RdcPathProxyServer({
      verifyCertificate: async ({ sessionId, ownerWindowId, host, port, certPolicy, cert }) =>
        this.verifyAndPromptCertificate({ sessionId, ownerWindowId, host, port, certPolicy, cert }),
      onSessionState: (sessionId, ownerWindowId, status, message) => {
        const rec = this.sessions.get(sessionId)
        if (!rec) return
        rec.info.status = status
        if (status === 'exited' || status === 'error') {
          this.sessions.delete(sessionId)
        }
        this.hooks.emitSessionState(ownerWindowId, { sessionId, status, message })
      }
    })
  }

  getProxyPort(): number | null {
    return this.proxy.getPort()
  }

  invalidateProbeCache(): void {
    this.cachedProbe = null
  }

  private async getSettings(): Promise<RdpSettings> {
    try {
      const all = await this.hooks.data.call<AllProtocolSettings>('protocolSettingsAll')
      return all.rdp
    } catch {
      return { ...DEFAULT_RDP_SETTINGS }
    }
  }

  async probe(refresh = false): Promise<RdpEnvironmentProbe> {
    const settings = await this.getSettings()
    const customPath = settings.externalClientPath.trim()
    if (!refresh && this.cachedProbe && this.cachedCustomPath === customPath) {
      return this.cachedProbe
    }
    const probeFn = this.hooks.probeFn ?? probeRdpEnvironment
    const result = await probeFn({ customPath })
    this.cachedProbe = result
    this.cachedCustomPath = customPath
    return result
  }

  async listProfiles(): Promise<RdpProfile[]> {
    return this.hooks.data.call<RdpProfile[]>('rdpProfilesList')
  }

  async saveProfile(input: RdpProfileInput): Promise<RdpProfile[]> {
    const encrypted =
      input.savePassword && input.password !== undefined && input.password !== ''
        ? await this.hooks.encryptSecret(input.password)
        : undefined
    return this.hooks.data.call<RdpProfile[]>('rdpProfileSave', { ...input, password: undefined }, encrypted)
  }

  async removeProfile(id: string): Promise<RdpProfile[]> {
    return this.hooks.data.call<RdpProfile[]>('rdpProfileRemove', id)
  }

  async listKnownHosts(): Promise<KnownRdpHostEntry[]> {
    return this.hooks.data.call<KnownRdpHostEntry[]>('rdpKnownHostsList')
  }

  async removeKnownHost(id: string): Promise<KnownRdpHostEntry[]> {
    return this.hooks.data.call<KnownRdpHostEntry[]>('rdpKnownHostRemove', id)
  }

  private async verifyAndPromptCertificate(params: {
    sessionId: string
    ownerWindowId: number
    host: string
    port: number
    certPolicy: 'tofu' | 'strict' | 'warn-allow'
    cert: InspectedRdpTlsCert
  }): Promise<boolean> {
    const check = await this.hooks.data.call<{
      status: 'unknown' | 'trusted' | 'mismatch'
      previousFingerprint?: string
    }>('rdpKnownHostVerify', params.host, params.port, params.cert.fingerprint)

    if (check.status === 'trusted') return true
    if (params.certPolicy === 'warn-allow') return true
    if (params.certPolicy === 'strict' && check.status === 'unknown') {
      throw new Error(
        `严格证书策略已拒绝未登记的主机证书（${params.host}:${params.port}，指纹 ${params.cert.fingerprint}）`
      )
    }

    const promptId = randomUUID()
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.certPrompts.delete(promptId)
        resolve(false)
      }, 120_000)

      this.certPrompts.set(promptId, {
        promptId,
        sessionId: params.sessionId,
        ownerWindowId: params.ownerWindowId,
        host: params.host,
        port: params.port,
        cert: params.cert,
        resolve,
        timer
      })

      this.hooks.emitCertPrompt(params.ownerWindowId, {
        promptId,
        sessionId: params.sessionId,
        host: params.host,
        port: params.port,
        fingerprint: params.cert.fingerprint,
        previousFingerprint: check.previousFingerprint,
        subject: params.cert.subject,
        issuer: params.cert.issuer,
        validFrom: params.cert.validFrom,
        validTo: params.cert.validTo,
        mismatch: check.status === 'mismatch'
      })
    })
  }

  async decideCertPrompt(ownerWindowId: number, promptId: string, accept: boolean): Promise<void> {
    const pending = this.certPrompts.get(promptId)
    if (!pending || pending.ownerWindowId !== ownerWindowId) {
      throw new Error('证书校验请求已过期，请重新发起连接')
    }
    this.certPrompts.delete(promptId)
    clearTimeout(pending.timer)

    if (accept) {
      await this.hooks.data.call('rdpKnownHostTrust', {
        host: pending.host,
        port: pending.port,
        fingerprint: pending.cert.fingerprint,
        subject: pending.cert.subject,
        issuer: pending.cert.issuer,
        validFrom: pending.cert.validFrom,
        validTo: pending.cert.validTo
      })
    }
    pending.resolve(accept)
  }

  async connect(ownerWindowId: number, rawSource: RdpConnectSource): Promise<RdpSessionInfo> {
    const source = rdpConnectSourceSchema.parse(rawSource)
    const settings = await this.getSettings()
    const probe = await this.probe(true)

    let title: string
    let host: string
    let port: number
    let domain: string
    let username: string
    let password = source.password ?? ''
    let profileId: string | undefined
    let options: RdpProfileOptions

    if (source.kind === 'profile') {
      const loaded = await this.hooks.data.call<{ profile: RdpProfile; secret?: Uint8Array }>(
        'rdpProfileGet',
        source.profileId
      )
      profileId = loaded.profile.id
      title = loaded.profile.name
      host = loaded.profile.host
      port = loaded.profile.port
      domain = loaded.profile.domain
      username = loaded.profile.username
      options = loaded.profile.options
      if (!password && loaded.secret) {
        password = await this.hooks.decryptSecret(loaded.profile.id, Uint8Array.from(loaded.secret))
      }
    } else {
      title = source.name?.trim() || `${source.host}:${source.port}`
      host = source.host
      port = source.port
      domain = source.domain
      username = source.username
      options = source.options
    }

    const resolved = resolveRdpLaunchConfig({
      settings,
      options,
      launchModeOverride: source.launchModeOverride,
      probe
    })

    const sessionId = randomUUID()
    const createdAt = new Date().toISOString()

    if (resolved.effectiveMode === 'external') {
      if (resolved.certPolicy !== 'warn-allow') {
        const preflight = await preflightRdpTlsCertificate({
          host,
          port,
          timeoutMs: Math.min(settings.connectTimeoutSec * 1000, 5000)
        })
        if (preflight.status === 'cert') {
          const ok = await this.verifyAndPromptCertificate({
            sessionId,
            ownerWindowId,
            host,
            port,
            certPolicy: resolved.certPolicy,
            cert: preflight.cert
          })
          if (!ok) {
            throw new Error('未信任远端 RDP TLS 证书，已取消启动系统客户端')
          }
        } else if (
          resolved.certPolicy === 'strict' &&
          (preflight.status === 'no-tls' || preflight.status === 'unreachable')
        ) {
          throw new Error(
            `严格证书校验无法完成：${preflight.status === 'unreachable' ? preflight.message : '远端未协商 TLS'}`
          )
        }
      }

      const info: RdpSessionInfo = {
        sessionId,
        title,
        host,
        port,
        username,
        domain,
        profileId,
        mode: 'external',
        fallbackFromExternal: false,
        status: 'starting',
        externalCommand: probe.schemeABinary,
        resolved,
        createdAt
      }

      const record: ActiveRdpSessionRecord = { sessionId, ownerWindowId, info }
      this.sessions.set(sessionId, record)

      try {
        const managed = await launchExternalRdpSession({
          sessionId,
          platform: probe.platform,
          binaryPath: probe.schemeABinaryPath!,
          host,
          port,
          username,
          domain,
          password,
          resolved,
          cmdkeyAvailable: probe.schemeACmdkeyAvailable,
          onStateChange: (status, exitCode, message) => {
            record.info.status = status
            if (status === 'exited' || status === 'error') {
              this.sessions.delete(sessionId)
            }
            this.hooks.emitSessionState(ownerWindowId, { sessionId, status, exitCode, message })
          }
        })
        record.external = managed
        info.externalPid = managed.pid
        info.status = 'active'
        return info
      } catch (err) {
        this.sessions.delete(sessionId)
        throw err
      }
    }

    // Scheme B: Embedded IronRDP WASM + loopback authenticated RDCleanPath proxy
    const proxyPort = await this.proxy.ensureStarted()
    const authToken = randomBytes(24).toString('base64url')
    this.proxy.registerToken(authToken, {
      sessionId,
      ownerWindowId,
      host,
      port,
      certPolicy: resolved.certPolicy,
      connectTimeoutMs: settings.connectTimeoutSec * 1000,
      expiresAt: Date.now() + 60_000
    })

    const info: RdpSessionInfo = {
      sessionId,
      title,
      host,
      port,
      username,
      domain,
      profileId,
      mode: 'embedded',
      fallbackFromExternal: resolved.fallbackFromExternal,
      fallbackReason: resolved.fallbackReason,
      status: 'starting',
      embeddedParams: {
        proxyAddress: `ws://127.0.0.1:${proxyPort}/rdcleanpath`,
        authToken,
        destination: `${host}:${port}`,
        username,
        password,
        serverDomain: domain,
        width: resolved.width,
        height: resolved.height,
        enableCredssp: resolved.securityLayer !== 'tls',
        enableClipboard: resolved.enableClipboard,
        enableDisplayControl: resolved.resolutionMode === 'fit'
      },
      resolved,
      createdAt
    }

    this.sessions.set(sessionId, { sessionId, ownerWindowId, info })
    return info
  }

  async disconnect(ownerWindowId: number, sessionId: string): Promise<void> {
    const rec = this.sessions.get(sessionId)
    if (!rec || rec.ownerWindowId !== ownerWindowId) return
    this.sessions.delete(sessionId)
    for (const [promptId, pending] of this.certPrompts) {
      if (pending.sessionId === sessionId) {
        clearTimeout(pending.timer)
        this.certPrompts.delete(promptId)
        pending.resolve(false)
      }
    }
    this.proxy.closeSession(sessionId)
    await rec.external?.stop()
    this.hooks.emitSessionState(ownerWindowId, { sessionId, status: 'exited', exitCode: 0 })
  }

  async closeWindowSessions(ownerWindowId: number): Promise<void> {
    const owned = [...this.sessions.values()].filter((item) => item.ownerWindowId === ownerWindowId)
    for (const item of owned) {
      this.sessions.delete(item.sessionId)
      await item.external?.stop().catch(() => {})
    }
    for (const [promptId, pending] of this.certPrompts) {
      if (pending.ownerWindowId === ownerWindowId) {
        clearTimeout(pending.timer)
        this.certPrompts.delete(promptId)
        pending.resolve(false)
      }
    }
    this.proxy.closeWindowSessions(ownerWindowId)
  }

  async shutdownAll(): Promise<void> {
    for (const [promptId, pending] of this.certPrompts) {
      clearTimeout(pending.timer)
      this.certPrompts.delete(promptId)
      pending.resolve(false)
    }
    const all = [...this.sessions.values()]
    this.sessions.clear()
    await Promise.all(all.map((item) => item.external?.stop().catch(() => {})))
    await this.proxy.shutdown()
  }
}
