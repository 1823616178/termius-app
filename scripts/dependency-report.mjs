import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

const manifest = JSON.parse(await readFile('package.json', 'utf8'))
const runtimeRoots = new Set(Object.keys(manifest.dependencies ?? {}))
const devRoots = new Set(Object.keys(manifest.devDependencies ?? {}))
const packages = []

async function inspect(directory) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const path = join(directory, entry.name)
    if (entry.name.startsWith('@')) {
      await inspect(path)
      continue
    }
    try {
      const metadata = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'))
      const licenseFiles = (await readdir(path)).filter((name) =>
        /^(licen[sc]e|copying|notice)(\.|$)/i.test(name)
      )
      const scope = runtimeRoots.has(metadata.name)
        ? 'runtime-direct'
        : devRoots.has(metadata.name)
          ? 'dev-direct'
          : 'transitive'
      packages.push({
        name: metadata.name,
        version: metadata.version,
        scope,
        license: metadata.license ?? 'UNDECLARED',
        repository: metadata.repository,
        engines: metadata.engines,
        path: relative('.', path).replaceAll('\\', '/'),
        licenseFiles
      })
      await inspect(join(path, 'node_modules'))
    } catch {
      /* scope entries and optional absent packages are not dependencies */
    }
  }
}

await inspect('node_modules')
packages.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))

const byLicense = {}
for (const pkg of packages) {
  const key = typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license)
  byLicense[key] = (byLicense[key] ?? 0) + 1
}

await mkdir('artifacts', { recursive: true })
await writeFile(
  'artifacts/dependencies.json',
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      node: process.version,
      packageManager: manifest.packageManager,
      summary: { total: packages.length, byLicense },
      direct: { dependencies: manifest.dependencies ?? {}, devDependencies: manifest.devDependencies ?? {} },
      packages
    },
    null,
    2
  )
)
console.log(
  `Dependency/license inventory: ${packages.length} installed package records → artifacts/dependencies.json`
)
