export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1')
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1'
}

export function isHttpsOrLoopbackUrl(parsed: URL): boolean {
  const protocol = parsed.protocol.toLowerCase()
  return protocol === 'https:' || (protocol === 'http:' && isLoopbackHostname(parsed.hostname))
}
