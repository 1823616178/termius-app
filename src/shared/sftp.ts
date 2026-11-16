export type SftpEntryKind = 'file' | 'directory' | 'symlink' | 'other'

export interface SftpEntry {
  name: string
  path: string
  kind: SftpEntryKind
  targetKind?: SftpEntryKind
  linkTarget?: string
  size: number
  mode: number
  permissions: string
  mtime: number
  uid: number
  gid: number
}

export interface SftpListResult {
  path: string
  parentPath: string
  entries: SftpEntry[]
}

export interface SftpStatResult {
  exists: boolean
  entry?: SftpEntry
}

export type SftpTransferDirection = 'upload' | 'download'
export type SftpTransferStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
export type SftpConflictDecision = 'overwrite' | 'skip' | 'rename'

export interface SftpTransferItem {
  id: string
  sessionId: string
  direction: SftpTransferDirection
  name: string
  localPath: string
  remotePath: string
  totalBytes: number
  transferredBytes: number
  speedBps: number
  status: SftpTransferStatus
  error?: string
  startedAt: number
  updatedAt: number
}

export interface SftpProgressEvent {
  transferId: string
  sessionId: string
  direction: SftpTransferDirection
  name: string
  localPath: string
  remotePath: string
  totalBytes: number
  transferredBytes: number
  speedBps: number
  status: SftpTransferStatus
  error?: string
}

export interface SftpExpandedUploadManifest {
  dirs: string[]
  files: { localPath: string; relativePath: string; name: string; size: number }[]
  skippedSymlinks: number
}

export type SftpSortField = 'name' | 'size' | 'mtime'

const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const WINDOWS_ILLEGAL_CHARS = /[<>:"/\\|?*\x00-\x1f]/g

export function normalizeRemotePosixPath(input: string): string {
  if (input.includes('\0')) {
    throw new Error('路径不能包含空字符')
  }
  const replaced = input.trim().replaceAll('\\', '/')
  if (!replaced || replaced === '~') return replaced || '/'
  if (replaced.startsWith('~/')) {
    const rest = normalizeSegments(replaced.slice(2).split('/'))
    return rest.length ? `~/${rest.join('/')}` : '~'
  }
  const absolute = replaced.startsWith('/')
  const stack = normalizeSegments(replaced.split('/'))
  if (absolute || !stack.length) {
    return `/${stack.join('/')}`
  }
  return `/${stack.join('/')}`
}

function normalizeSegments(rawParts: string[]): string[] {
  const stack: string[] = []
  for (const part of rawParts) {
    if (!part || part === '.') continue
    if (part === '..') {
      stack.pop()
      continue
    }
    stack.push(part)
  }
  return stack
}

export function joinRemotePosixPath(base: string, ...parts: string[]): string {
  const normalizedBase = normalizeRemotePosixPath(base || '/')
  if (normalizedBase === '~' || normalizedBase.startsWith('~/')) {
    const baseParts = normalizedBase === '~' ? [] : normalizedBase.slice(2).split('/').filter(Boolean)
    const extra: string[] = []
    for (const part of parts) {
      if (part.includes('\0')) throw new Error('路径不能包含空字符')
      for (const seg of part.replaceAll('\\', '/').split('/')) {
        if (!seg || seg === '.') continue
        if (seg === '..') {
          if (extra.length) extra.pop()
          else if (baseParts.length) baseParts.pop()
        } else {
          extra.push(seg)
        }
      }
    }
    const merged = [...baseParts, ...extra]
    return merged.length ? `~/${merged.join('/')}` : '~'
  }
  const joined = [normalizedBase, ...parts].join('/')
  return normalizeRemotePosixPath(joined)
}

export function parentRemotePosixPath(remotePath: string): string {
  const normalized = normalizeRemotePosixPath(remotePath)
  if (normalized === '/' || normalized === '~') return normalized
  const idx = normalized.lastIndexOf('/')
  if (idx <= 0) return normalized.startsWith('~/') ? '~' : '/'
  return normalized.slice(0, idx)
}

export function remoteBaseName(remotePath: string): string {
  const normalized = normalizeRemotePosixPath(remotePath)
  if (normalized === '/' || normalized === '~') return ''
  const idx = normalized.lastIndexOf('/')
  return idx >= 0 ? normalized.slice(idx + 1) : normalized
}

export function remoteBreadcrumbs(remotePath: string): { label: string; path: string }[] {
  const normalized = normalizeRemotePosixPath(remotePath)
  if (normalized === '~') return [{ label: '~', path: '~' }]
  if (normalized.startsWith('~/')) {
    const parts = normalized.slice(2).split('/').filter(Boolean)
    const list = [{ label: '~', path: '~' }]
    let current = '~'
    for (const part of parts) {
      current = `${current}/${part}`
      list.push({ label: part, path: current })
    }
    return list
  }
  const parts = normalized.split('/').filter(Boolean)
  const list = [{ label: '/', path: '/' }]
  let current = ''
  for (const part of parts) {
    current = `${current}/${part}`
    list.push({ label: part, path: current })
  }
  return list
}

export function sanitizeDownloadFilename(rawName: string): string {
  const leaf = rawName
    .replaceAll('\0', '')
    .split(/[/\\]/)
    .filter((segment) => segment.length > 0)
    .pop()
  let cleaned = (leaf ?? '').replace(WINDOWS_ILLEGAL_CHARS, '_').replace(/[. ]+$/, '')
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    cleaned = 'downloaded_file'
  }
  const dotIdx = cleaned.indexOf('.')
  const stem = dotIdx >= 0 ? cleaned.slice(0, dotIdx) : cleaned
  if (WINDOWS_RESERVED_NAMES.test(stem)) {
    cleaned = `_${cleaned}`
  }
  return cleaned.slice(0, 240)
}

export function formatOctalMode(mode: number): string {
  const masked = mode & 0o7777
  return masked.toString(8).padStart(4, '0').slice(-4)
}

export function formatUnixPermissions(mode: number, kind: SftpEntryKind = 'file'): string {
  const typeChar = kind === 'directory' ? 'd' : kind === 'symlink' ? 'l' : '-'
  const bits = mode & 0o777
  const perms = [
    bits & 0o400 ? 'r' : '-',
    bits & 0o200 ? 'w' : '-',
    bits & 0o100 ? (mode & 0o4000 ? 's' : 'x') : mode & 0o4000 ? 'S' : '-',
    bits & 0o040 ? 'r' : '-',
    bits & 0o020 ? 'w' : '-',
    bits & 0o010 ? (mode & 0o2000 ? 's' : 'x') : mode & 0o2000 ? 'S' : '-',
    bits & 0o004 ? 'r' : '-',
    bits & 0o002 ? 'w' : '-',
    bits & 0o001 ? (mode & 0o1000 ? 't' : 'x') : mode & 0o1000 ? 'T' : '-'
  ]
  return `${typeChar}${perms.join('')}`
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }
  return `${value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[unitIndex]}`
}

export function formatSpeed(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '0 B/s'
  return `${formatBytes(bytesPerSec)}/s`
}

export function sortSftpEntries(
  entries: SftpEntry[],
  sortBy: SftpSortField = 'name',
  ascending = true
): SftpEntry[] {
  const factor = ascending ? 1 : -1
  return [...entries].sort((a, b) => {
    const aDir = a.kind === 'directory' || a.targetKind === 'directory' ? 0 : 1
    const bDir = b.kind === 'directory' || b.targetKind === 'directory' ? 0 : 1
    if (aDir !== bDir) return aDir - bDir
    if (sortBy === 'size') {
      if (a.size !== b.size) return (a.size - b.size) * factor
    } else if (sortBy === 'mtime') {
      if (a.mtime !== b.mtime) return (a.mtime - b.mtime) * factor
    }
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) * factor
  })
}
