import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const MAX_LOG_BYTES = 1024 * 1024

export function redactDiagnostic(input: string): string {
  return input
    .replace(
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
      '[REDACTED_PRIVATE_KEY]'
    )
    .replace(/([A-Za-z]:\\Users\\)[^\\\s"']+/gi, '$1<user>')
    .replace(/(\/home\/)[^/\s"']+/g, '$1<user>')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(
      /((?:password|passphrase|token|secret|authorization)\s*[:=]\s*)(?:Bearer\s+)?(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      '$1[REDACTED]'
    )
    .replace(/[^\s"']*\.sqlite(?:-wal|-shm)?/gi, '<database>')
}

export class DiagnosticLog {
  private readonly filePath: string
  private queue = Promise.resolve()

  constructor(userDataDir: string) {
    this.filePath = join(userDataDir, 'logs', 'orbit.log')
  }

  write(source: string, message: string): void {
    const cleaned = redactDiagnostic(message).trim()
    if (!cleaned) return
    const line = `${new Date().toISOString()} [${source}] ${cleaned}\n`
    this.queue = this.queue
      .then(async () => {
        await mkdir(dirname(this.filePath), { recursive: true })
        try {
          const info = await stat(this.filePath)
          if (info.size + Buffer.byteLength(line) > MAX_LOG_BYTES) {
            await rename(this.filePath, `${this.filePath}.1`).catch(() => {})
          }
        } catch {
          /* log file does not exist yet */
        }
        await appendFile(this.filePath, line, 'utf8')
      })
      .catch(() => {})
  }

  async flush(): Promise<void> {
    await this.queue
  }
}
