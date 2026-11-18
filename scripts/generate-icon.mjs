import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const electronPath = require('electron')

function buildIco(frames) {
  const headerSize = 6
  const entrySize = 16
  let offset = headerSize + entrySize * frames.length
  const header = Buffer.alloc(headerSize)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(frames.length, 4)

  const entries = []
  for (const { size, png } of frames) {
    const entry = Buffer.alloc(entrySize)
    entry.writeUInt8(size === 256 ? 0 : size, 0)
    entry.writeUInt8(size === 256 ? 0 : size, 1)
    entry.writeUInt8(0, 2)
    entry.writeUInt8(0, 3)
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += png.length
    entries.push(entry)
  }

  return Buffer.concat([header, ...entries, ...frames.map((frame) => frame.png)])
}

const svgText = await readFile(resolve('src/renderer/src/assets/orbit-icon.svg'), 'utf8')
const tempDir = await mkdtemp(join(tmpdir(), 'orbit-icon-'))

try {
  const sizes = [512, 256, 128, 64, 48, 32, 24, 16]
  const htmlPath = join(tempDir, 'render.html')
  const runnerPath = join(tempDir, 'main.cjs')
  const outJsonPath = join(tempDir, 'frames.json')

  await writeFile(
    htmlPath,
    `<!doctype html>
<html>
<body style="margin:0;background:transparent">
<script>
window.renderIcons = async function(svgBase64, sizes) {
  const img = new Image();
  img.src = 'data:image/svg+xml;base64,' + svgBase64;
  await img.decode();
  const out = {};
  for (const size of sizes) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    out[size] = canvas.toDataURL('image/png').split(',')[1];
  }
  return out;
};
</script>
</body>
</html>`
  )

  const svgBase64 = Buffer.from(svgText, 'utf8').toString('base64')
  await writeFile(
    runnerPath,
    `const { app, BrowserWindow } = require('electron');
const { writeFileSync } = require('fs');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 600,
    height: 600,
    webPreferences: { offscreen: true, sandbox: false }
  });
  await win.loadFile(${JSON.stringify(htmlPath)});
  const data = await win.webContents.executeJavaScript(
    'window.renderIcons(' + ${JSON.stringify(JSON.stringify(svgBase64))} + ',' + ${JSON.stringify(JSON.stringify(sizes))} + ')'
  );
  writeFileSync(${JSON.stringify(outJsonPath)}, JSON.stringify(data));
  app.quit();
}).catch((err) => {
  console.error(err);
  process.exit(1);
});`
  )

  const childEnv = { ...process.env }
  delete childEnv.ELECTRON_RUN_AS_NODE
  await new Promise((resolvePromise, reject) => {
    const child = spawn(electronPath, [runnerPath], {
      env: childEnv,
      stdio: 'inherit'
    })
    child.on('exit', (code) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`Electron icon renderer exited with code ${code}`))
    })
    child.on('error', reject)
  })

  const rendered = JSON.parse(await readFile(outJsonPath, 'utf8'))
  const png512 = Buffer.from(rendered['512'], 'base64')
  await writeFile(resolve('resources/icon.png'), png512)

  const icoSizes = [256, 128, 64, 48, 32, 24, 16]
  const frames = icoSizes.map((size) => ({
    size,
    png: Buffer.from(rendered[String(size)], 'base64')
  }))
  await writeFile(resolve('resources/icon.ico'), buildIco(frames))

  console.log(
    `Generated resources/icon.png (${png512.length} B) and resources/icon.ico (${icoSizes.join(',')} px)`
  )
} finally {
  await rm(tempDir, { recursive: true, force: true })
}
