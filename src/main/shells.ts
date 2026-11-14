import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { join, isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
import type { ShellProfile } from '../shared/contracts'

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
  extraCandidates: string[] = []
): string | undefined {
  const pathDirs = envPath
    .split(';')
    .map((entry) => entry.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean)
    .map((dir) => join(dir, binary))
  return [...extraCandidates, ...pathDirs].find((candidate) => isAbsolute(candidate) && existsSync(candidate))
}

export async function discoverShells(): Promise<ShellProfile[]> {
  if (process.platform !== 'win32') return []
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
