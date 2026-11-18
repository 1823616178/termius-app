import { test, expect, _electron } from '@playwright/test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('Desktop packaged app loads SQLite, preload and PTY from ASAR', async ({}, info) => {
  const directory = await mkdtemp(join(tmpdir(), 'orbit-packaged-'))
  const isLinux = process.platform === 'linux'
  const defaultExe = isLinux
    ? 'release/linux-unpacked/graphite-orbit'
    : 'release/win-unpacked/Graphite Orbit.exe'
  const env = Object.fromEntries(
    Object.entries({
      ...process.env,
      ORBIT_USER_DATA: directory,
      ORBIT_UPDATE_DISABLE_AUTO: '1'
    }).filter((entry): entry is [string, string] => entry[1] !== undefined)
  )
  delete env.ELECTRON_RUN_AS_NODE
  const app = await _electron.launch({
    executablePath: resolve(process.env.ORBIT_PACKAGED_EXE || defaultExe),
    args: isLinux ? ['--no-sandbox'] : [],
    env
  })
  const page = await app.firstWindow()
  try {
    await expect(page.getByText('让连接，井然有序。')).toBeVisible()
    const profile = await page.evaluate(() => window.orbit.bootstrap())
    expect(profile.platform).toBe(process.platform)
    expect(profile.shells.length).toBeGreaterThan(0)
    const defaultShell = profile.shells[0]!
    if (isLinux) {
      expect(['bash', 'zsh', 'fish', 'sh']).toContain(defaultShell.kind)
    } else {
      expect(profile.shells.some((shell) => shell.id === 'powershell')).toBe(true)
    }
    expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true)
    await page.getByRole('button', { name: '打开本地终端', exact: true }).click()
    await expect(page.getByText('运行中', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '切换终端屏幕阅读器模式' }).click()
    await page.locator('.xterm-helper-textarea').focus()
    await page.keyboard.type(
      isLinux ? 'printf "PACKAGED_%s\\n" PTY_READY' : 'Write-Output ("PACKAGED_" + "PTY_READY")'
    )
    await page.keyboard.press('Enter')
    await expect(page.locator('.xterm-accessibility-tree')).toContainText('PACKAGED_PTY_READY', {
      timeout: 15_000
    })
    await page.screenshot({ path: info.outputPath('packaged-terminal.png') })
    const closeTarget = isLinux ? defaultShell.name : 'Windows PowerShell'
    await page.getByRole('button', { name: `关闭标签 ${closeTarget}`, exact: true }).click()
    await expect(page.getByText('让连接，井然有序。')).toBeVisible()
  } finally {
    await app
      .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.destroy()))
      .catch(() => {})
    await app.close().catch(() => {})
  }
})
