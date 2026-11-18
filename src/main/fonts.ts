import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { homedir } from 'node:os'
import type { SystemFontInfo } from '../shared/contracts'

const IGNORED_FAMILIES = new Set([
  'marlett',
  'symbol',
  'webdings',
  'wingdings',
  'wingdings 2',
  'wingdings 3',
  'hololens mdl2 assets',
  'segoe mdl2 assets',
  'segoe fluent icons'
])

const STYLE_SUFFIX_RE =
  /(?:\s+(?:Regular|Bold|Italic|Oblique|Light|ExtraLight|UltraLight|SemiLight|Medium|SemiBold|DemiBold|ExtraBold|UltraBold|Black|Heavy|Thin|Book|Roman|Narrow|Condensed|Extended|Mono\s*NL))+$/i

const MONOSPACE_HINT_RE =
  /\b(?:mono|monospace|consolas|courier|code|hack|iosevka|fira\s*code|jetbrains|maple|sarasa|victor|menlo|monaco|dejavu\s+sans\s+mono|liberation\s+mono|ubuntu\s+mono|source\s+code|terminus|fixed|droid\s+sans\s+mono|noto\s+sans\s+mono|cascadia|inconsolata|anonymous|meslo|roboto\s+mono|space\s+mono|geist\s+mono|ibm\s+plex\s+mono|commit\s+mono|fantasque|input|simsun|nsimsun|fangsong|kaiti)\b/i

const SERIF_HINT_RE =
  /\b(?:serif|times|georgia|cambria|palatino|garamond|constantia|stzhongsong|song|ming|fangsong|kaiti|stkaiti|stsong|stfangsong|simsun|nsimsun|baskerville|didot|cinzel)\b/i

const SANS_HINT_RE =
  /\b(?:sans|segoe|yahei|microsoft\s+yahei|dengxian|pingfang|noto\s+sans|ubuntu|cantarell|roboto|inter|arial|calibri|candara|corbel|tahoma|verdana|helvetica|bahnschrift|trebuchet|franklin|harmonyos|alibaba|wenquanyi)\b/i

export function classifyFontFamily(family: string, spacingHint?: number): SystemFontInfo['category'] {
  if (spacingHint !== undefined && spacingHint >= 90) return 'monospace'
  if (MONOSPACE_HINT_RE.test(family)) return 'monospace'
  if (SERIF_HINT_RE.test(family)) return 'serif'
  if (SANS_HINT_RE.test(family)) return 'sans'
  return 'other'
}

function cleanFontFamilyName(raw: string): string {
  let name = raw
    .replace(/\s*\((?:TrueType|OpenType|All res|Type 1)\)\s*$/i, '')
    .replace(/\s+10,\d+\s*$/, '')
    .trim()
  let previous = ''
  while (name !== previous) {
    previous = name
    name = name.replace(STYLE_SUFFIX_RE, '').trim()
  }
  return name
}

function shouldSkipFontFamily(family: string): boolean {
  if (!family || family.startsWith('@') || family.startsWith('.')) return true
  if (IGNORED_FAMILIES.has(family.toLowerCase())) return true
  return false
}

function mergeFontList(entries: SystemFontInfo[]): SystemFontInfo[] {
  const byLower = new Map<string, SystemFontInfo>()
  for (const entry of entries) {
    if (shouldSkipFontFamily(entry.family)) continue
    const key = entry.family.toLowerCase()
    const existing = byLower.get(key)
    if (!existing) {
      byLower.set(key, entry)
    } else if (existing.category !== 'monospace' && entry.category === 'monospace') {
      byLower.set(key, entry)
    }
  }
  return [...byLower.values()].sort((a, b) => a.family.localeCompare(b.family, 'en'))
}

export function parseWindowsRegFontsOutput(output: string): SystemFontInfo[] {
  const results: SystemFontInfo[] = []
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s{4}(.+?)\s{4}REG_(?:SZ|EXPAND_SZ)\s{4}/.exec(line)
    if (!match?.[1]) continue
    const rawValueName = match[1].replace(/\s*\((?:TrueType|OpenType|All res|Type 1)\)\s*$/i, '').trim()
    for (const part of rawValueName.split(/\s*&\s*/)) {
      const family = cleanFontFamilyName(part)
      if (!family) continue
      results.push({
        family,
        category: classifyFontFamily(family)
      })
    }
  }
  return mergeFontList(results)
}

export function parseFcListOutput(output: string): SystemFontInfo[] {
  const results: SystemFontInfo[] = []
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const [rawFamilies, rawProps] = trimmed.split(':')
    if (!rawFamilies) continue
    const spacingMatch = /spacing=(\d+)/i.exec(rawProps ?? '')
    const spacing = spacingMatch ? Number(spacingMatch[1]) : undefined
    for (const part of rawFamilies.split(',')) {
      const family = part.trim()
      if (!family) continue
      results.push({
        family,
        category: classifyFontFamily(family, spacing)
      })
    }
  }
  return mergeFontList(results)
}

function execFileText(command: string, args: string[], timeoutMs = 4000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (err, out) => {
        if (err) reject(err)
        else resolve(out ?? '')
      }
    )
  })
}

async function discoverWindowsFonts(): Promise<SystemFontInfo[]> {
  const keys = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
    'HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'
  ]
  const chunks = await Promise.all(keys.map((key) => execFileText('reg.exe', ['query', key]).catch(() => '')))
  return parseWindowsRegFontsOutput(chunks.join('\n'))
}

async function discoverLinuxFonts(): Promise<SystemFontInfo[]> {
  const output = await execFileText('fc-list', [':', 'family', 'spacing']).catch(() => '')
  return parseFcListOutput(output)
}

async function discoverDarwinFonts(): Promise<SystemFontInfo[]> {
  const fcOut = await execFileText('fc-list', [':', 'family', 'spacing']).catch(() => '')
  if (fcOut.trim()) return parseFcListOutput(fcOut)
  const dirs = ['/System/Library/Fonts', '/Library/Fonts', join(homedir(), 'Library/Fonts')]
  const entries: SystemFontInfo[] = []
  for (const dir of dirs) {
    const names = await readdir(dir).catch(() => [])
    for (const file of names) {
      const ext = extname(file).toLowerCase()
      if (ext !== '.ttf' && ext !== '.otf' && ext !== '.ttc') continue
      const family = cleanFontFamilyName(basename(file, ext).replace(/[-_]/g, ' '))
      if (family) entries.push({ family, category: classifyFontFamily(family) })
    }
  }
  return mergeFontList(entries)
}

let cachedSystemFonts: SystemFontInfo[] | null = null

export async function discoverSystemFonts(forceRefresh = false): Promise<SystemFontInfo[]> {
  if (cachedSystemFonts && !forceRefresh) return cachedSystemFonts
  let fonts: SystemFontInfo[] = []
  if (process.platform === 'win32') {
    fonts = await discoverWindowsFonts()
  } else if (process.platform === 'linux') {
    fonts = await discoverLinuxFonts()
  } else if (process.platform === 'darwin') {
    fonts = await discoverDarwinFonts()
  }
  cachedSystemFonts = fonts
  return fonts
}
