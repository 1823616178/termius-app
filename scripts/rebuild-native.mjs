import { rebuild } from '@electron/rebuild'
import { createRequire } from 'node:module'
import { chmodSync, existsSync } from 'node:fs'
import { join } from 'node:path'
const require = createRequire(import.meta.url)
const { version } = require('electron/package.json')
if (process.platform === 'win32') {
  // node-pty 1.1 ships Node-API prebuilds; rebuilding them unnecessarily requires
  // the VS Spectre toolchain. Other dependencies follow their rebuild metadata.
  const prebuild = join(
    process.cwd(),
    'node_modules/node-pty/prebuilds',
    `win32-${process.arch}`,
    'conpty.node'
  )
  if (!existsSync(prebuild)) throw new Error(`Missing node-pty Node-API prebuild: ${prebuild}`)
}
await rebuild({
  buildPath: process.cwd(),
  electronVersion: version,
  arch: process.arch,
  onlyModules:
    process.platform === 'win32'
      ? ['better-sqlite3', 'cpu-features']
      : ['better-sqlite3', 'cpu-features', 'node-pty']
})
if (process.platform !== 'win32') {
  for (const helper of [
    join(process.cwd(), 'node_modules/node-pty/build/Release/spawn-helper'),
    join(
      process.cwd(),
      'node_modules/node-pty/prebuilds',
      `${process.platform}-${process.arch}`,
      'spawn-helper'
    )
  ]) {
    if (existsSync(helper)) chmodSync(helper, 0o755)
  }
}
console.log(`Native modules ready for Electron ${version} / ${process.arch} (${process.platform}).`)
