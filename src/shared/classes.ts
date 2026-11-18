const tokenPattern = /^[a-z0-9-]+$/

/** Ensures arbitrary dynamic identifiers (e.g. host:port or file names) produce a valid semantic class token. */
export function safeInstanceToken(raw: string): string {
  if (tokenPattern.test(raw)) return raw
  let hash = 2166136261
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 20)
  return `${slug || 'item'}-${(hash >>> 0).toString(36)}`
}

export function instanceClass(base: string, token: string): string[] {
  if (!tokenPattern.test(token)) throw new Error('Invalid instance token')
  return [base, `${base}-i${token}`]
}
