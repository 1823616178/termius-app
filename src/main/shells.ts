import { accessSync, constants, existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { basename, delimiter, isAbsolute, join } from 'node:path'
import { createHash } from 'node:crypto'
import type { ShellKind, ShellProfile } from '../shared/contracts'

const DISTRO_NAME_PATTERN = /^[\p{L}\p{N}_.-]{1,100}$/u

export function wslProfileId(name: string): string {
  return `wsl-${createHash('sha256').update(name, 'utf8').digest('hex').slice(0, 12)}`
}

export function decodeWslOutput(raw: Buffer | string): string {
  if (typeof raw === 'string') return raw.replace(/\0/g, '').replace(/^\uFEFF/, '')
  if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) {
    return raw
      .subarray(2)
      .toString('utf16le')
      .replace(/\0/g, '')
      .replace(/^\uFEFF/, '')
  }
  const hasNullBytes = raw.includes(0)
  const text = hasNullBytes ? raw.toString('utf16le') : raw.toString('utf8')
  return text.replace(/\0/g, '').replace(/^\uFEFF/, '')
}

export function parseWslDistributions(raw: Buffer | string): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const line of decodeWslOutput(raw).split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || !DISTRO_NAME_PATTERN.test(trimmed) || seen.has(trimmed)) continue
    seen.add(trimmed)
    names.push(trimmed)
  }
  return names
}

export function findExecutableOnPath(
  binary: string,
  envPath = process.env.PATH ?? '',
  extraCandidates: string[] = [],
  pathDelimiter: string = delimiter
): string | undefined {
  const pathDirs = envPath
    .split(pathDelimiter)
    .map((entry) => entry.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean)
    .map((dir) => join(dir, binary))
  return [...extraCandidates, ...pathDirs].find((candidate) => {
    if (!isAbsolute(candidate) || !existsSync(candidate)) return false
    try {
      return statSync(candidate).isFile()
    } catch {
      return false
    }
  })
}

function inferPosixShellKind(executable: string): ShellKind {
  const name = basename(executable).toLowerCase()
  if (name === 'zsh' || name.startsWith('zsh')) return 'zsh'
  if (name === 'fish' || name.startsWith('fish')) return 'fish'
  if (name === 'sh' || name === 'dash' || name === 'ash') return 'sh'
  return 'bash'
}

function formatPosixShellName(executable: string, isDefault: boolean): string {
  const kind = inferPosixShellKind(executable)
  const labelMap: Record<'bash' | 'zsh' | 'fish' | 'sh', string> = {
    bash: 'Bash',
    zsh: 'Zsh',
    fish: 'Fish',
    sh: 'POSIX sh'
  }
  const baseLabel =
    kind === 'bash' || kind === 'zsh' || kind === 'fish' || kind === 'sh'
      ? labelMap[kind]
      : basename(executable)
  return isDefault ? `${baseLabel}（默认 Shell）` : baseLabel
}

export function parseEtcShells(content: string): string[] {
  const paths: string[] = []
  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    if (isAbsolute(trimmed)) paths.push(trimmed)
  }
  return paths
}

function isExecutableFile(candidate: string): boolean {
  if (!isAbsolute(candidate) || !existsSync(candidate)) return false
  try {
    if (!statSync(candidate).isFile()) return false
    accessSync(candidate, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export function discoverPosixShells(
  options: {
    envShell?: string
    envPath?: string
    etcShellsContent?: string
    candidates?: string[]
    pathDelimiter?: string
    checkExecutable?: (filePath: string) => boolean
    resolveRealpath?: (filePath: string) => string
  } = {}
): ShellProfile[] {
  const checkExec = options.checkExecutable ?? isExecutableFile
  const getRealpath =
    options.resolveRealpath ??
    ((filePath: string) => {
      try {
        return realpathSync(filePath)
      } catch {
        return filePath
      }
    })

  const rawCandidates: string[] = []
  const envShell = options.envShell?.trim()
  if (envShell) rawCandidates.push(envShell)

  if (options.etcShellsContent !== undefined) {
    rawCandidates.push(...parseEtcShells(options.etcShellsContent))
  } else if (existsSync('/etc/shells')) {
    try {
      rawCandidates.push(...parseEtcShells(readFileSync('/etc/shells', 'utf8')))
    } catch {
      /* ignore unreadable /etc/shells */
    }
  }

  const fallbackBinaries = options.candidates ?? [
    '/bin/bash',
    '/usr/bin/bash',
    '/bin/zsh',
    '/usr/bin/zsh',
    '/usr/bin/fish',
    '/bin/sh',
    '/usr/bin/sh'
  ]
  rawCandidates.push(...fallbackBinaries)

  for (const name of ['bash', 'zsh', 'fish', 'sh']) {
    const found = findExecutableOnPath(
      name,
      options.envPath ?? process.env.PATH ?? '',
      [],
      options.pathDelimiter ?? delimiter
    )
    if (found) rawCandidates.push(found)
  }

  const seenRealPaths = new Set<string>()
  const usedIds = new Set<string>()
  const profiles: ShellProfile[] = []

  for (const candidate of rawCandidates) {
    if (!candidate || !checkExec(candidate)) continue
    const real = getRealpath(candidate)
    if (seenRealPaths.has(real)) continue
    seenRealPaths.add(real)

    const kind = inferPosixShellKind(candidate)
    const isDefault = profiles.length === 0
    const baseId = basename(candidate)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
    let id = usedIds.has(baseId) ? `${baseId}-${profiles.length}` : baseId
    if (!id) id = `shell-${profiles.length}`
    usedIds.add(id)

    profiles.push({
      id,
      name: formatPosixShellName(candidate, isDefault),
      executable: candidate,
      args: [],
      kind,
      detail: candidate
    })
  }

  return profiles
}

export async function discoverShells(): Promise<ShellProfile[]> {
  if (process.platform !== 'win32') {
    return discoverPosixShells({ envShell: process.env.SHELL })
  }
  const root = process.env.SystemRoot ?? 'C:\\Windows'
  const profiles: ShellProfile[] = []
  const add = (
    id: string,
    name: string,
    executable: string,
    args: string[],
    kind: ShellProfile['kind'],
    detail: string
  ) => {
    if (isAbsolute(executable) && existsSync(executable))
      profiles.push({ id, name, executable, args, kind, detail })
  }
  add(
    'powershell',
    'Windows PowerShell',
    join(root, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoLogo'],
    'powershell',
    'Windows PowerShell 5.1'
  )
  const pwshExtras = [join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PowerShell/7/pwsh.exe')]
  if (process.env.LOCALAPPDATA) {
    pwshExtras.push(join(process.env.LOCALAPPDATA, 'Microsoft/WindowsApps/pwsh.exe'))
  }
  const pwsh = findExecutableOnPath('pwsh.exe', process.env.PATH, pwshExtras)
  if (pwsh) add('pwsh', 'PowerShell 7', pwsh, ['-NoLogo'], 'powershell', 'PowerShell · pwsh')
  add('cmd', '命令提示符', join(root, 'System32/cmd.exe'), [], 'cmd', 'Windows CMD')
  const wsl = join(root, 'System32/wsl.exe')
  if (existsSync(wsl)) {
    const rawOutput = await new Promise<Buffer>((resolve) => {
      execFile(
        wsl,
        ['--list', '--quiet'],
        {
          encoding: 'buffer',
          env: { ...process.env, WSL_UTF8: '1' },
          windowsHide: true,
          timeout: 4000,
          maxBuffer: 65536
        },
        (error, stdout) => resolve(error ? Buffer.alloc(0) : stdout)
      )
    })
    for (const name of parseWslDistributions(rawOutput)) {
      add(wslProfileId(name), name, wsl, ['--distribution', name], 'wsl', 'WSL 发行版')
    }
  }
  return profiles
}
