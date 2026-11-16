import { z } from 'zod'

export const DEFAULT_UPDATE_REPOSITORY = {
  owner: '1823616178',
  repo: 'termius-app'
} as const

export interface UpdateRepositoryConfig {
  owner: string
  repo: string
}

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export type UpdatePackageKind = 'nsis-exe' | 'appimage' | 'deb' | 'release-page'
export type UpdaterPlatform = 'win32' | 'linux' | 'darwin' | (string & {})

export interface UpdateReleaseInfo {
  version: string
  tagName: string
  title: string
  notes: string
  publishedAt: string | null
  releaseUrl: string
  prerelease: boolean
  assetName: string
  packageKind?: UpdatePackageKind
  downloadUrl: string
  sizeBytes: number | null
  sha256: string | null
  sha512: string | null
}

export interface UpdateDownloadProgress {
  transferredBytes: number
  totalBytes: number | null
  percent: number | null
}

export interface UpdatePreferences {
  autoCheckOnStartup: boolean
  allowPrerelease: boolean
  ignoredVersion: string | null
  lastCheckedAt: string | null
}

export type UpdatePreferencesPatch = Partial<UpdatePreferences>

export interface UpdateStatusSnapshot {
  phase: UpdatePhase
  currentVersion: string
  repository: UpdateRepositoryConfig
  preferences: UpdatePreferences
  latest: UpdateReleaseInfo | null
  progress: UpdateDownloadProgress | null
  downloadedFilePath: string | null
  verifiedHash: string | null
  message: string
  error: string | null
  checkedAt: string | null
}

export interface ParsedSemver {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

export interface LatestYmlFileEntry {
  url: string
  sha512: string | null
  size: number | null
}

export interface LatestYmlMetadata {
  version: string
  path: string
  sha512: string | null
  size: number | null
  releaseDate: string | null
}

export interface GitHubReleaseAssetWire {
  name: string
  size?: number
  browser_download_url: string
  digest?: string | null
}

export interface GitHubReleaseWire {
  tag_name: string
  name?: string | null
  body?: string | null
  draft?: boolean
  prerelease?: boolean
  published_at?: string | null
  html_url: string
  assets?: GitHubReleaseAssetWire[]
}

function isTrustedGitHubHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return (
    normalized === 'github.com' ||
    normalized === 'api.github.com' ||
    normalized.endsWith('.githubusercontent.com')
  )
}

export const updatePreferencesSchema = z
  .object({
    autoCheckOnStartup: z.boolean().default(true),
    allowPrerelease: z.boolean().default(false),
    ignoredVersion: z.string().trim().min(1).max(64).nullable().default(null),
    lastCheckedAt: z.string().trim().min(1).max(64).nullable().default(null)
  })
  .strict()

export const updatePreferencesPatchSchema = z
  .object({
    autoCheckOnStartup: z.boolean(),
    allowPrerelease: z.boolean(),
    ignoredVersion: z.string().trim().min(1).max(64).nullable(),
    lastCheckedAt: z.string().trim().min(1).max(64).nullable()
  })
  .partial()
  .strict()

export function normalizeVersionString(raw: string): string {
  return raw.trim().replace(/^[vV]+/, '')
}

export function parseSemver(raw: string): ParsedSemver | null {
  const cleaned = normalizeVersionString(raw)
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(cleaned)
  if (!match) return null
  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor) || !Number.isSafeInteger(patch)) {
    return null
  }
  const prerelease = match[4] ? match[4].split('.').filter(Boolean) : []
  return { major, minor, patch, prerelease }
}

export function compareSemver(leftRaw: string, rightRaw: string): number {
  const left = parseSemver(leftRaw)
  const right = parseSemver(rightRaw)
  if (!left || !right) {
    return normalizeVersionString(leftRaw).localeCompare(normalizeVersionString(rightRaw))
  }
  if (left.major !== right.major) return left.major > right.major ? 1 : -1
  if (left.minor !== right.minor) return left.minor > right.minor ? 1 : -1
  if (left.patch !== right.patch) return left.patch > right.patch ? 1 : -1

  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0
  if (left.prerelease.length === 0) return 1
  if (right.prerelease.length === 0) return -1

  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let i = 0; i < length; i++) {
    const a = left.prerelease[i]
    const b = right.prerelease[i]
    if (a === undefined) return -1
    if (b === undefined) return 1
    if (a === b) continue
    const aNum = /^\d+$/.test(a) ? Number(a) : null
    const bNum = /^\d+$/.test(b) ? Number(b) : null
    if (aNum !== null && bNum !== null) {
      return aNum > bNum ? 1 : -1
    }
    if (aNum !== null) return -1
    if (bNum !== null) return 1
    return a > b ? 1 : -1
  }
  return 0
}

export function isUpdateNewer(candidateVersion: string, currentVersion: string): boolean {
  return compareSemver(candidateVersion, currentVersion) > 0
}

function unquoteYamlValue(raw: string): string {
  const trimmed = raw.trim()
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

export function parseLatestYmlFiles(content: string): LatestYmlFileEntry[] {
  const entries: LatestYmlFileEntry[] = []
  let current: LatestYmlFileEntry | null = null
  let inFiles = false

  const flush = (): void => {
    if (current?.url) entries.push(current)
    current = null
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/\t/g, '  ')
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const topMatch = /^([A-Za-z0-9_]+)\s*:\s*(.*)$/.exec(line)
    if (topMatch && !line.startsWith(' ')) {
      flush()
      inFiles = topMatch[1] === 'files'
      continue
    }

    if (!inFiles) continue
    const listMatch = /^\s*-\s*([A-Za-z0-9_]+)\s*:\s*(.*)$/.exec(line)
    if (listMatch) {
      flush()
      current = { url: '', sha512: null, size: null }
      const key = listMatch[1]
      const value = unquoteYamlValue(listMatch[2] ?? '')
      if (key === 'url') current.url = value
      else if (key === 'sha512' && value) current.sha512 = value
      else if (key === 'size' && /^\d+$/.test(value)) current.size = Number(value)
      continue
    }

    const propMatch = /^\s+([A-Za-z0-9_]+)\s*:\s*(.*)$/.exec(line)
    if (propMatch && current) {
      const key = propMatch[1]
      const value = unquoteYamlValue(propMatch[2] ?? '')
      if (key === 'url') current.url = value
      else if (key === 'sha512' && value) current.sha512 = value
      else if (key === 'size' && /^\d+$/.test(value)) current.size = Number(value)
    }
  }
  flush()
  return entries
}

export function getLatestManifestFilename(platform: UpdaterPlatform = 'win32'): string {
  return platform === 'linux' ? 'latest-linux.yml' : 'latest.yml'
}

export function resolveUpdatePackageKind(assetName: string): UpdatePackageKind {
  const lower = assetName.toLowerCase()
  if (lower.endsWith('.appimage')) return 'appimage'
  if (lower.endsWith('.deb')) return 'deb'
  if (lower.endsWith('.exe')) return 'nsis-exe'
  return 'release-page'
}

export function parseLatestYml(content: string): LatestYmlMetadata | null {
  let version = ''
  let path = ''
  let sha512: string | null = null
  let size: number | null = null
  let releaseDate: string | null = null
  let firstFileUrl = ''
  let firstFileSha512: string | null = null
  let firstFileSize: number | null = null
  let inFiles = false

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/\t/g, '  ')
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const topMatch = /^([A-Za-z0-9_]+)\s*:\s*(.*)$/.exec(line)
    if (topMatch && !line.startsWith(' ')) {
      inFiles = topMatch[1] === 'files'
      const key = topMatch[1]
      const value = unquoteYamlValue(topMatch[2] ?? '')
      if (key === 'version') version = normalizeVersionString(value)
      else if (key === 'path') path = value
      else if (key === 'sha512' && value) sha512 = value
      else if (key === 'size' && /^\d+$/.test(value)) size = Number(value)
      else if (key === 'releaseDate' && value) releaseDate = value
      continue
    }

    if (inFiles) {
      const listMatch = /^\s*-\s*([A-Za-z0-9_]+)\s*:\s*(.*)$/.exec(line)
      const propMatch = /^\s+([A-Za-z0-9_]+)\s*:\s*(.*)$/.exec(line)
      const match = listMatch ?? propMatch
      if (match) {
        const key = match[1]
        const value = unquoteYamlValue(match[2] ?? '')
        if (key === 'url' && !firstFileUrl) firstFileUrl = value
        else if (key === 'sha512' && !firstFileSha512 && value) firstFileSha512 = value
        else if (key === 'size' && firstFileSize === null && /^\d+$/.test(value))
          firstFileSize = Number(value)
      }
    }
  }

  const resolvedPath = path || firstFileUrl
  if (!version || !resolvedPath) return null
  return {
    version,
    path: resolvedPath,
    sha512: sha512 || firstFileSha512,
    size: size ?? firstFileSize,
    releaseDate
  }
}

export function parseSha256Sums(content: string): Map<string, string> {
  const result = new Map<string, string>()
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const match = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(trimmed)
    if (!match) continue
    const hash = match[1]!.toLowerCase()
    const rawName = match[2]!.trim().replace(/^\.\//, '')
    if (!rawName) continue
    const baseName = rawName.split('/').pop() ?? rawName
    result.set(rawName.toLowerCase(), hash)
    result.set(baseName.toLowerCase(), hash)
  }
  return result
}

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return (
    normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1' || normalized === '[::1]'
  )
}

export function validateUpdateSourceUrl(rawUrl: string, allowedOverrideOrigin?: string): string {
  const trimmed = rawUrl.trim()
  if (!trimmed) throw new Error('更新地址不能为空')
  const parsed = new URL(trimmed)
  if (parsed.username || parsed.password) {
    throw new Error('出于安全限制，更新地址不能包含账号凭据')
  }
  const matchesOverride =
    Boolean(allowedOverrideOrigin) &&
    parsed.origin === allowedOverrideOrigin &&
    (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname)))

  if (parsed.protocol === 'http:') {
    if (!matchesOverride) {
      throw new Error('出于安全限制，正式更新源仅允许使用 HTTPS 协议')
    }
    return parsed.href
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('出于安全限制，仅支持 HTTPS 更新地址')
  }
  if (!matchesOverride && !isTrustedGitHubHost(parsed.hostname)) {
    throw new Error(`不受信任的更新域名：${parsed.hostname}`)
  }
  return parsed.href
}

export function sanitizeInstallerFilename(
  rawName: string,
  fallbackVersion: string,
  platform: UpdaterPlatform = 'win32'
): string {
  const base = rawName.split(/[\\/]/).pop()?.trim() ?? ''
  const cleaned = base.replace(/[^0-9A-Za-z._-]/g, '-').replace(/^-+/, '')
  const lower = cleaned.toLowerCase()
  const hasSupportedExt = lower.endsWith('.exe') || lower.endsWith('.appimage') || lower.endsWith('.deb')
  if (!cleaned || cleaned === '.' || cleaned === '..' || !hasSupportedExt) {
    const version = normalizeVersionString(fallbackVersion)
    return platform === 'linux'
      ? `Graphite-Orbit-${version}-linux-x64.AppImage`
      : `Graphite-Orbit-Setup-${version}.exe`
  }
  return cleaned
}

export function extractSha256FromDigest(digest?: string | null): string | null {
  if (!digest) return null
  const match = /^sha256:([0-9a-fA-F]{64})$/.exec(digest.trim())
  return match ? match[1]!.toLowerCase() : null
}

function matchesTargetArch(filename: string, arch: string): boolean {
  const lower = filename.toLowerCase()
  if (arch === 'arm64' || arch === 'aarch64') {
    return lower.includes('arm64') || lower.includes('aarch64')
  }
  if (arch === 'x64') {
    if (lower.includes('arm64') || lower.includes('aarch64')) return false
    return lower.includes('x64') || lower.includes('amd64') || lower.includes('x86_64')
  }
  return false
}

export function selectLinuxInstallerAsset(
  assets: GitHubReleaseAssetWire[],
  options: {
    arch?: string
    preferredFormat?: 'appimage' | 'deb'
    latestYml?: LatestYmlMetadata | null
  } = {}
): GitHubReleaseAssetWire | undefined {
  const arch = options.arch ?? 'x64'
  const preferredFormat = options.preferredFormat ?? 'appimage'
  const linuxAssets = assets.filter((asset) => {
    const lower = asset.name.toLowerCase()
    return (lower.endsWith('.appimage') || lower.endsWith('.deb')) && !lower.endsWith('.blockmap')
  })
  if (linuxAssets.length === 0) return undefined

  const preferredExt = preferredFormat === 'deb' ? '.deb' : '.appimage'
  const archMatched = linuxAssets.filter((item) => matchesTargetArch(item.name, arch))
  const pool = archMatched.length > 0 ? archMatched : linuxAssets

  const byPreferredExt = pool.filter((item) => item.name.toLowerCase().endsWith(preferredExt))
  const orderedPool = byPreferredExt.length > 0 ? byPreferredExt : pool

  if (options.latestYml?.path) {
    const expected = options.latestYml.path.toLowerCase()
    const exact = orderedPool.find((item) => item.name.toLowerCase() === expected)
    if (exact) return exact
  }

  return (
    orderedPool.find((item) => item.name.toLowerCase().endsWith('.appimage')) ??
    orderedPool.find((item) => item.name.toLowerCase().endsWith('.deb')) ??
    orderedPool[0]
  )
}

export function selectWindowsInstallerAsset(
  assets: GitHubReleaseAssetWire[],
  latestYml?: LatestYmlMetadata | null
): GitHubReleaseAssetWire | undefined {
  const exeAssets = assets.filter((asset) => {
    const lower = asset.name.toLowerCase()
    return lower.endsWith('.exe') && !lower.endsWith('.blockmap')
  })
  if (exeAssets.length === 0) return undefined

  if (latestYml?.path) {
    const expected = latestYml.path.toLowerCase()
    const exact = exeAssets.find((item) => item.name.toLowerCase() === expected)
    if (exact) return exact
  }

  return (
    exeAssets.find((item) => /setup/i.test(item.name) && /x64/i.test(item.name)) ??
    exeAssets.find((item) => /setup/i.test(item.name)) ??
    exeAssets[0]
  )
}

export function selectInstallerAssetForPlatform(
  assets: GitHubReleaseAssetWire[],
  options: {
    platform: UpdaterPlatform
    arch?: string
    preferredLinuxFormat?: 'appimage' | 'deb'
    latestYml?: LatestYmlMetadata | null
  }
): GitHubReleaseAssetWire | undefined {
  if (options.platform === 'linux') {
    return selectLinuxInstallerAsset(assets, {
      arch: options.arch,
      preferredFormat: options.preferredLinuxFormat,
      latestYml: options.latestYml
    })
  }
  return selectWindowsInstallerAsset(assets, options.latestYml)
}
