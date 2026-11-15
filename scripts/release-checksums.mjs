import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const releaseDir = join(process.cwd(), 'release')
if (!existsSync(releaseDir)) {
  throw new Error('release directory does not exist; build artifacts first')
}

const candidates = readdirSync(releaseDir, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .filter(
    (name) =>
      name.endsWith('.exe') ||
      name.endsWith('.exe.blockmap') ||
      (name.startsWith('latest') && name.endsWith('.yml'))
  )
  .sort((a, b) => a.localeCompare(b))

if (existsSync(join(releaseDir, 'win-unpacked', 'Graphite Orbit.exe'))) {
  candidates.push('win-unpacked/Graphite Orbit.exe')
}

if (candidates.length === 0) {
  throw new Error('no release artifacts found in release/')
}

const lines = candidates.map((relPath) => {
  const bytes = readFileSync(join(releaseDir, relPath))
  const hash = createHash('sha256').update(bytes).digest('hex').toLowerCase()
  return `${hash}  ${relPath}`
})

const outPath = join(releaseDir, 'SHA256SUMS.txt')
writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf8')
console.log(`Generated ${outPath} (${lines.length} entries)`)
for (const line of lines) {
  console.log(`  ${line}`)
}
