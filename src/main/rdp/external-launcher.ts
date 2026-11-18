import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { RdpResolvedConfigSummary } from '../../shared/rdp'

export interface ExternalLaunchParams {
  sessionId: string
  platform: string
  binaryPath: string
  host: string
  port: number
  username: string
  domain: string
  password: string
  resolved: RdpResolvedConfigSummary
  cmdkeyAvailable?: boolean
  onStateChange: (status: 'active' | 'exited' | 'error', exitCode?: number | null, message?: string) => void
  spawnFn?: typeof spawn
}

export interface ManagedExternalProcess {
  pid?: number
  commandLabel: string
  tempRdpPath?: string
  stop: () => Promise<void>
}

function assertNoControlChars(value: string, fieldName: string): void {
  if (/[\r\n\0]/.test(value)) {
    throw new Error(`${fieldName} 包含非法控制字符，已阻止生成外部 RDP 配置`)
  }
}

export function buildMstscRdpContent(params: {
  host: string
  port: number
  username: string
  domain: string
  resolved: RdpResolvedConfigSummary
}): string {
  assertNoControlChars(params.host, '主机地址')
  assertNoControlChars(params.username, '用户名')
  assertNoControlChars(params.domain, '域')
  if (params.resolved.sharedDrivePath) {
    assertNoControlChars(params.resolved.sharedDrivePath, '共享目录')
  }

  const lines: string[] = [
    `full address:s:${params.host}:${params.port}`,
    'screen mode id:i:1',
    `desktopwidth:i:${params.resolved.width}`,
    `desktopheight:i:${params.resolved.height}`,
    `smart sizing:i:${params.resolved.resolutionMode === 'fit' ? 1 : 0}`,
    `session bpp:i:${params.resolved.colorDepth}`,
    `redirectclipboard:i:${params.resolved.enableClipboard ? 1 : 0}`,
    `audiomode:i:${params.resolved.enableAudio ? 0 : 2}`,
    `authentication level:i:${params.resolved.certPolicy === 'strict' ? 2 : params.resolved.certPolicy === 'tofu' ? 2 : 0}`,
    `negotiate security layer:i:${params.resolved.securityLayer === 'tls' ? 1 : 1}`,
    'prompt for credentials:i:1',
    'compression:i:1'
  ]

  if (params.resolved.qualityPreset === 'lan') {
    lines.push('connection type:i:6', 'networkautodetect:i:1')
  } else if (params.resolved.qualityPreset === 'balanced') {
    lines.push('connection type:i:4', 'networkautodetect:i:1')
  } else {
    lines.push('connection type:i:1', 'disable wallpaper:i:1', 'disable themes:i:1')
  }

  if (params.username) lines.push(`username:s:${params.username}`)
  if (params.domain) lines.push(`domain:s:${params.domain}`)
  if (params.resolved.driveRedirect !== 'none' && params.resolved.sharedDrivePath) {
    lines.push(`drivestoredirect:s:${params.resolved.sharedDrivePath}`)
  }

  return `${lines.join('\r\n')}\r\n`
}

export function buildFreeRdpArgs(params: {
  host: string
  port: number
  username: string
  domain: string
  hasPassword: boolean
  resolved: RdpResolvedConfigSummary
}): string[] {
  assertNoControlChars(params.host, '主机地址')
  assertNoControlChars(params.username, '用户名')
  assertNoControlChars(params.domain, '域')
  if (params.resolved.sharedDrivePath) {
    assertNoControlChars(params.resolved.sharedDrivePath, '共享目录')
  }

  const args: string[] = [`/v:${params.host}:${params.port}`]
  if (params.username) args.push(`/u:${params.username}`)
  if (params.domain) args.push(`/d:${params.domain}`)
  if (params.hasPassword) args.push('/from-stdin')

  if (params.resolved.securityLayer === 'nla') args.push('/sec:nla')
  else if (params.resolved.securityLayer === 'tls') args.push('/sec:tls')

  if (params.resolved.certPolicy === 'warn-allow') args.push('/cert:ignore')
  else args.push('/cert:tofu')

  args.push(`/w:${params.resolved.width}`, `/h:${params.resolved.height}`)
  if (params.resolved.resolutionMode === 'fit') args.push('/dynamic-resolution')

  args.push(`/bpp:${params.resolved.colorDepth}`)
  if (params.resolved.qualityPreset === 'lan') args.push('/network:lan')
  else if (params.resolved.qualityPreset === 'balanced') args.push('/network:auto')
  else args.push('/network:modem', '-wallpaper', '-themes')

  args.push(params.resolved.enableClipboard ? '+clipboard' : '-clipboard')
  if (params.resolved.enableAudio) args.push('/sound:sys:alsa')
  if (params.resolved.driveRedirect !== 'none' && params.resolved.sharedDrivePath) {
    const modeSuffix = params.resolved.driveRedirect === 'readonly' ? ',ro' : ''
    args.push(`/drive:orbit-share,${params.resolved.sharedDrivePath}${modeSuffix}`)
  }

  return args
}

function getTempRdpDir(): string {
  return join(tmpdir(), 'graphite-orbit-rdp')
}

export async function sweepStaleTempRdpFiles(): Promise<void> {
  const dir = getTempRdpDir()
  try {
    const entries = await readdir(dir)
    await Promise.all(
      entries.filter((name) => name.endsWith('.rdp')).map((name) => unlink(join(dir, name)).catch(() => {}))
    )
  } catch {
    /* directory may not exist yet */
  }
}

function runCmdkey(args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile('cmdkey.exe', args, { timeout: 3000, windowsHide: true }, (error, stdout) => {
      resolve({
        code:
          error && typeof (error as { code?: number }).code === 'number'
            ? (error as { code: number }).code
            : error
              ? 1
              : 0,
        stdout: stdout ?? ''
      })
    })
  })
}

async function hasExistingCmdkeyEntry(target: string): Promise<boolean> {
  const res = await runCmdkey([`/list:${target}`])
  return res.code === 0 && res.stdout.includes(target)
}

export async function launchExternalRdpSession(
  params: ExternalLaunchParams
): Promise<ManagedExternalProcess> {
  const binaryName = basename(params.binaryPath).toLowerCase()
  const isWindowsMstsc = params.platform === 'win32' && binaryName === 'mstsc.exe'
  const spawnImpl = params.spawnFn ?? spawn

  let tempRdpPath: string | undefined
  let injectedCmdkeyTarget: string | undefined
  let args: string[] = []
  let pipePasswordToStdin = false

  if (isWindowsMstsc) {
    const dir = getTempRdpDir()
    await mkdir(dir, { recursive: true, mode: 0o700 })
    tempRdpPath = join(dir, `${params.sessionId}.rdp`)
    const content = buildMstscRdpContent({
      host: params.host,
      port: params.port,
      username: params.username,
      domain: params.domain,
      resolved: params.resolved
    })
    await writeFile(tempRdpPath, content, { encoding: 'utf8', mode: 0o600 })
    args = [tempRdpPath]

    if (params.password && params.username && params.cmdkeyAvailable) {
      const target = `TERMSRV/${params.host}`
      const alreadyExists = await hasExistingCmdkeyEntry(target)
      if (!alreadyExists) {
        const userForCmdkey = params.domain ? `${params.domain}\\${params.username}` : params.username
        const addRes = await runCmdkey([
          `/generic:${target}`,
          `/user:${userForCmdkey}`,
          `/pass:${params.password}`
        ])
        if (addRes.code === 0) injectedCmdkeyTarget = target
      }
    }
  } else {
    args = buildFreeRdpArgs({
      host: params.host,
      port: params.port,
      username: params.username,
      domain: params.domain,
      hasPassword: Boolean(params.password),
      resolved: params.resolved
    })
    pipePasswordToStdin = Boolean(params.password)
  }

  let cleanupPromise: Promise<void> | null = null
  const cleanupArtifacts = (): Promise<void> => {
    if (cleanupPromise) return cleanupPromise
    cleanupPromise = (async () => {
      if (tempRdpPath) {
        await unlink(tempRdpPath).catch(() => {})
      }
      if (injectedCmdkeyTarget) {
        await runCmdkey([`/delete:${injectedCmdkeyTarget}`]).catch(() => {})
      }
    })()
    return cleanupPromise
  }

  let child: ChildProcess
  try {
    child = spawnImpl(params.binaryPath, args, {
      stdio: pipePasswordToStdin ? ['pipe', 'ignore', 'pipe'] : ['ignore', 'ignore', 'pipe'],
      windowsHide: false
    })
  } catch (error) {
    await cleanupArtifacts()
    throw error
  }

  if (pipePasswordToStdin && child.stdin) {
    try {
      child.stdin.write(`${params.password}\n`)
      child.stdin.end()
    } catch {
      /* process may exit immediately */
    }
  }

  const stderrLines: string[] = []
  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8').trim()
    if (!text) return
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue
      stderrLines.push(line.trim().slice(0, 240))
      if (stderrLines.length > 8) stderrLines.shift()
    }
  })

  let manualStop = false
  let settledExit = false

  child.once('error', (err) => {
    if (settledExit) return
    settledExit = true
    void cleanupArtifacts().finally(() => {
      params.onStateChange('error', null, `启动外部 RDP 客户端失败：${err.message}`)
    })
  })

  child.once('exit', (code) => {
    if (settledExit) return
    settledExit = true
    void cleanupArtifacts().finally(() => {
      if (manualStop || code === 0 || code === null) {
        params.onStateChange('exited', code)
      } else {
        const tail = stderrLines.at(-1)
        const msg = tail
          ? `外部 RDP 客户端退出 (code=${code}): ${tail}`
          : `外部 RDP 客户端已退出 (code=${code})`
        params.onStateChange('error', code, msg)
      }
    })
  })

  params.onStateChange('active')

  return {
    pid: child.pid,
    commandLabel: basename(params.binaryPath),
    tempRdpPath,
    stop: async () => {
      manualStop = true
      if (!child.killed && child.exitCode === null) {
        try {
          child.kill('SIGTERM')
        } catch {}
      }
      await cleanupArtifacts()
    }
  }
}
