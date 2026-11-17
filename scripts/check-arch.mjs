import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const failures = []

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : join(dir, entry.name)))
  )
  return nested.flat()
}

const pkg = JSON.parse(await readFile('package.json', 'utf8'))
const rendererOnlyDeps = new Set([
  'vue',
  'three',
  '@lucide/vue',
  '@xterm/xterm',
  '@xterm/addon-fit',
  '@xterm/addon-search',
  '@xterm/addon-web-links'
])
for (const dep of Object.keys(pkg.dependencies ?? {})) {
  if (rendererOnlyDeps.has(dep)) {
    failures.push(`package.json: renderer-only dependency "${dep}" must live in devDependencies`)
  }
}

for (const file of await walk('src')) {
  if (!file.endsWith('.ts') && !file.endsWith('.vue')) continue
  const rel = relative('.', file).replaceAll('\\', '/')
  const content = await readFile(file, 'utf8')

  if (rel !== 'src/main/ipc-auth.ts' && /\bipcMain\.(handle|on)\s*\(/.test(content)) {
    failures.push(`${rel}: raw ipcMain.handle/on is forbidden; register via createIpcRegistrar`)
  }

  if (
    rel !== 'src/workers/data-crypto/argon2id.ts' &&
    rel !== 'src/workers/data-crypto/kdf-worker.ts' &&
    rel !== 'src/workers/data-crypto/kdf-client.ts' &&
    /\bargon2idSync\b/.test(content)
  ) {
    failures.push(`${rel}: direct argon2idSync usage is forbidden outside kdf-worker/kdf-client`)
  }

  if (
    (rel.startsWith('src/main/') || rel.startsWith('src/preload/') || rel.startsWith('src/workers/')) &&
    /from\s+['"](?:vue|three|lucide-vue-next|@lucide\/[^'"]+|@xterm\/[^'"]+)['"]/.test(content)
  ) {
    failures.push(`${rel}: main/preload/worker must not import renderer-only packages`)
  }

  if (
    rel.startsWith('src/renderer/src/') &&
    /import\s+(?!type\b)[^;\n]*from\s+['"]@xterm\/[^'"]+['"]/.test(content)
  ) {
    failures.push(
      `${rel}: static @xterm/* value imports are forbidden; use dynamic import() in terminal-registry`
    )
  }

  if (/keepaliveInterval\s*:\s*\d/.test(content)) {
    failures.push(`${rel}: keepaliveInterval must use resolveKeepaliveIntervalMs(...)`)
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else {
  console.log('架构约束检查通过：IPC 鉴权封装 / KDF 线程隔离 / 依赖边界 / keepalive 接线均正常')
}
