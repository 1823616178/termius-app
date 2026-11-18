import { execFile } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import { access } from 'node:fs/promises'
import { posix, win32 } from 'node:path'
import type { RdpDisplaySessionType, RdpEnvironmentProbe, RdpExternalCandidate } from '../../shared/rdp'

export interface ProbeOptions {
  platform?: string
  env?: NodeJS.ProcessEnv
  customPath?: string
  fileExists?: (filePath: string) => Promise<boolean>
  readVersion?: (binaryPath: string) => Promise<string | undefined>
}

export function detectLinuxDisplayType(env: NodeJS.ProcessEnv = process.env): RdpDisplaySessionType {
  const sessionType = (env.XDG_SESSION_TYPE ?? '').trim().toLowerCase()
  if (sessionType === 'wayland' || env.WAYLAND_DISPLAY) return 'wayland'
  if (sessionType === 'x11' || env.DISPLAY) return 'x11'
  return 'headless'
}

async function defaultExecutableExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, process.platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

async function resolveCommandFromEnv(
  command: string,
  platform: string,
  env: NodeJS.ProcessEnv,
  fileExists: (filePath: string) => Promise<boolean>
): Promise<string | undefined> {
  const pathImpl = platform === 'win32' ? win32 : posix
  if (pathImpl.isAbsolute(command)) {
    return (await fileExists(command)) ? command : undefined
  }
  const pathDirs = (env.PATH ?? '').split(pathImpl.delimiter).filter(Boolean)
  const suffixes = platform === 'win32' && !command.toLowerCase().endsWith('.exe') ? ['.exe', ''] : ['']
  for (const dir of pathDirs) {
    for (const suffix of suffixes) {
      const candidate = pathImpl.join(dir, `${command}${suffix}`)
      if (await fileExists(candidate)) return candidate
    }
  }
  if (platform === 'linux') {
    for (const dir of ['/usr/bin', '/usr/local/bin', '/snap/bin']) {
      const candidate = posix.join(dir, command)
      if (await fileExists(candidate)) return candidate
    }
  }
  return undefined
}

function defaultReadVersion(binaryPath: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    // mstsc.exe shows a modal Help dialog if invoked with flags on Windows; never spawn it during probe.
    if (binaryPath.toLowerCase().endsWith('mstsc.exe')) {
      resolve('Windows Remote Desktop Connection')
      return
    }
    execFile(binaryPath, ['--version'], { timeout: 1800, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        resolve(undefined)
        return
      }
      const line = `${stdout}\n${stderr}`
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find(Boolean)
      resolve(line ? line.slice(0, 120) : undefined)
    })
  })
}

export async function probeRdpEnvironment(options: ProbeOptions = {}): Promise<RdpEnvironmentProbe> {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const fileExists = options.fileExists ?? defaultExecutableExists
  const readVersion = options.readVersion ?? defaultReadVersion
  const customPath = (options.customPath ?? '').trim()

  const displaySession: RdpDisplaySessionType =
    platform === 'win32' ? 'windows' : platform === 'linux' ? detectLinuxDisplayType(env) : 'unknown'

  const candidates: RdpExternalCandidate[] = []

  if (customPath) {
    const resolved = await resolveCommandFromEnv(customPath, platform, env, fileExists)
    candidates.push({
      id: 'custom',
      label: '自定义客户端',
      command: customPath,
      found: Boolean(resolved),
      resolvedPath: resolved,
      version: resolved ? await readVersion(resolved) : undefined,
      recommendedForSession: true
    })
  }

  let cmdkeyAvailable = false
  if (platform === 'win32') {
    const systemRoot = env.SystemRoot || 'C:\\Windows'
    const mstscDefault = win32.join(systemRoot, 'System32', 'mstsc.exe')
    const resolvedMstsc = (await fileExists(mstscDefault))
      ? mstscDefault
      : await resolveCommandFromEnv('mstsc.exe', platform, env, fileExists)
    candidates.push({
      id: 'mstsc',
      label: 'Windows mstsc.exe',
      command: 'mstsc.exe',
      found: Boolean(resolvedMstsc),
      resolvedPath: resolvedMstsc,
      version: resolvedMstsc ? 'Windows Remote Desktop Connection' : undefined,
      recommendedForSession: true
    })
    const cmdkeyDefault = win32.join(systemRoot, 'System32', 'cmdkey.exe')
    cmdkeyAvailable =
      (await fileExists(cmdkeyDefault)) ||
      Boolean(await resolveCommandFromEnv('cmdkey.exe', platform, env, fileExists))
  } else if (platform === 'linux') {
    const ordered: Array<{
      id: RdpExternalCandidate['id']
      label: string
      command: string
      recommended: boolean
    }> =
      displaySession === 'wayland'
        ? [
            { id: 'wlfreerdp3', label: 'FreeRDP 3 (Wayland)', command: 'wlfreerdp3', recommended: true },
            { id: 'wlfreerdp', label: 'FreeRDP 2 (Wayland)', command: 'wlfreerdp', recommended: true },
            { id: 'xfreerdp3', label: 'FreeRDP 3 (X11/XWayland)', command: 'xfreerdp3', recommended: false },
            { id: 'xfreerdp', label: 'FreeRDP 2 (X11/XWayland)', command: 'xfreerdp', recommended: false }
          ]
        : [
            { id: 'xfreerdp3', label: 'FreeRDP 3 (X11)', command: 'xfreerdp3', recommended: true },
            { id: 'xfreerdp', label: 'FreeRDP 2 (X11)', command: 'xfreerdp', recommended: true },
            { id: 'wlfreerdp3', label: 'FreeRDP 3 (Wayland)', command: 'wlfreerdp3', recommended: false }
          ]

    for (const spec of ordered) {
      const resolved = await resolveCommandFromEnv(spec.command, platform, env, fileExists)
      candidates.push({
        id: spec.id,
        label: spec.label,
        command: spec.command,
        found: Boolean(resolved),
        resolvedPath: resolved,
        version: resolved ? await readVersion(resolved) : undefined,
        recommendedForSession: spec.recommended
      })
    }
  }

  const activeCandidate = customPath
    ? candidates.find((item) => item.id === 'custom' && item.found)
    : candidates.find((item) => item.found)
  let missingReason: string | undefined
  let installHint: string | undefined
  if (!activeCandidate) {
    if (customPath) {
      missingReason = `未找到自定义 RDP 客户端可执行文件：${customPath}`
      if (platform === 'linux') {
        installHint =
          displaySession === 'wayland'
            ? 'sudo apt update && sudo apt install -y freerdp3-wayland'
            : 'sudo apt update && sudo apt install -y freerdp3-x11'
      }
    } else if (platform === 'linux') {
      missingReason =
        displaySession === 'wayland'
          ? 'Ubuntu 当前为 Wayland 会话，未检测到 wlfreerdp3 / xfreerdp3'
          : 'Ubuntu 未检测到 xfreerdp3 / xfreerdp 系统客户端'
      installHint =
        displaySession === 'wayland'
          ? 'sudo apt update && sudo apt install -y freerdp3-wayland'
          : 'sudo apt update && sudo apt install -y freerdp3-x11'
    } else if (platform === 'win32') {
      missingReason = '未检测到 Windows mstsc.exe（可在设置中指定自定义客户端路径）'
    } else {
      missingReason = `当前平台（${platform}）暂无默认外部 RDP 客户端配置，请在设置中指定路径或切换方案 B`
    }
  }

  return {
    platform,
    displaySession,
    schemeAAvailable: Boolean(activeCandidate),
    schemeABinary: activeCandidate?.command,
    schemeABinaryPath: activeCandidate?.resolvedPath,
    schemeAVersion: activeCandidate?.version,
    schemeACmdkeyAvailable: cmdkeyAvailable,
    schemeAMissingReason: missingReason,
    schemeAInstallHint: installHint,
    schemeBAvailable: true,
    schemeBEngine: 'ironrdp-wasm',
    candidates
  }
}
