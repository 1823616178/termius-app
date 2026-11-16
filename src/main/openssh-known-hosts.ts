import { createHash, createHmac } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { normalizeSshHost } from '../workers/connection/index'

export interface OpenSshKnownHostMatch {
  fingerprint: string
  algorithm: string
  source: 'openssh'
  matchedPattern: string
}

export function getDefaultOpenSshKnownHostsPaths(home = homedir()): string[] {
  return [join(home, '.ssh', 'known_hosts'), '/etc/ssh/ssh_known_hosts']
}

function formatHostForKnownHosts(host: string, port: number): string {
  const normalized = normalizeSshHost(host).toLowerCase()
  if (port === 22) return normalized
  return `[${normalized}]:${port}`
}

function matchHashedOpenSshHost(pattern: string, target: string): boolean {
  if (!pattern.startsWith('|1|')) return false
  const parts = pattern.split('|')
  if (parts.length !== 4) return false
  const saltB64 = parts[2]
  const digestB64 = parts[3]
  if (!saltB64 || !digestB64) return false
  try {
    const salt = Buffer.from(saltB64, 'base64')
    const expected = Buffer.from(digestB64, 'base64')
    const actual = createHmac('sha1', salt).update(target, 'utf8').digest()
    return actual.length === expected.length && actual.equals(expected)
  } catch {
    return false
  }
}

export function matchOpenSshHostPattern(patternList: string, host: string, port: number): boolean {
  const target = formatHostForKnownHosts(host, port)
  const rawHost = normalizeSshHost(host).toLowerCase()
  const targets = port === 22 ? [target] : [target]
  const tokens = patternList
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  let positiveMatch = false
  for (const token of tokens) {
    const negated = token.startsWith('!')
    const pattern = negated ? token.slice(1) : token
    if (!pattern) continue

    let matched = false
    if (pattern.startsWith('|1|')) {
      matched = targets.some((candidate) => matchHashedOpenSshHost(pattern, candidate))
    } else if (pattern.includes('*') || pattern.includes('?')) {
      const escaped = pattern
        .toLowerCase()
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.')
      const regex = new RegExp(`^${escaped}$`)
      matched = targets.some((candidate) => regex.test(candidate)) || (port === 22 && regex.test(rawHost))
    } else {
      const lower = pattern.toLowerCase()
      matched = targets.includes(lower) || (port === 22 && lower === rawHost)
    }

    if (matched) {
      if (negated) return false
      positiveMatch = true
    }
  }
  return positiveMatch
}

export function fingerprintFromOpenSshKeyBase64(keyBase64: string): string | null {
  try {
    const bytes = Buffer.from(keyBase64, 'base64')
    if (bytes.length < 8) return null
    return `SHA256:${createHash('sha256').update(bytes).digest('base64').replace(/=+$/, '')}`
  } catch {
    return null
  }
}

export function parseOpenSshKnownHosts(content: string, host: string, port: number): OpenSshKnownHostMatch[] {
  const matches: OpenSshKnownHostMatch[] = []
  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const fields = trimmed.split(/\s+/)
    let idx = 0
    if (fields[0]?.startsWith('@')) {
      if (fields[0] === '@revoked' || fields[0] === '@cert-authority') {
        continue
      }
      idx = 1
    }
    const hostField = fields[idx]
    const algorithm = fields[idx + 1]
    const keyBase64 = fields[idx + 2]
    if (!hostField || !algorithm || !keyBase64) continue
    if (!matchOpenSshHostPattern(hostField, host, port)) continue

    const fingerprint = fingerprintFromOpenSshKeyBase64(keyBase64)
    if (!fingerprint) continue
    matches.push({
      fingerprint,
      algorithm,
      source: 'openssh',
      matchedPattern: hostField
    })
  }
  return matches
}

export function lookupOpenSshKnownHost(
  host: string,
  port: number,
  presentedFingerprint?: string,
  presentedAlgorithm?: string,
  paths = getDefaultOpenSshKnownHostsPaths()
): OpenSshKnownHostMatch | undefined {
  let firstMatch: OpenSshKnownHostMatch | undefined
  for (const filePath of paths) {
    if (!filePath || !existsSync(filePath)) continue
    try {
      const content = readFileSync(filePath, 'utf8')
      const matches = parseOpenSshKnownHosts(content, host, port)
      if (matches.length === 0) continue
      if (presentedFingerprint) {
        const exact = matches.find(
          (entry) =>
            entry.fingerprint === presentedFingerprint &&
            (!presentedAlgorithm || entry.algorithm === presentedAlgorithm)
        )
        if (exact) return exact
      }
      if (!firstMatch) firstMatch = matches[0]
    } catch {
      /* ignore unreadable known_hosts file */
    }
  }
  return firstMatch
}
