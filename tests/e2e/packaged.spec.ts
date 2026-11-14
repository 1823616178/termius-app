import { test, expect, _electron } from '@playwright/test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('Windows x64 packaged app loads SQLite, preload and ConPTY from ASAR', async ({}, info) => {
  const directory = await mkdtemp(join(tmpdir(), 'orbit-packaged-'))
  const env = Object.fromEntries(
    Object.entries({ ...process.env, ORBIT_USER_DATA: directory }).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  )
  delete env.ELECTRON_RUN_AS_NODE
  const app = await _electron.launch({
    executablePath: resolve(process.env.ORBIT_PACKAGED_EXE || 'release/win-unpacked/Graphite Orbit.exe'),
    args: [],
    env
  })
  const page = await app.firstWindow()
  try {
    await expect(page.getByText('让连接，井然有序。')).toBeVisible()
    const profile = await page.evaluate(() => window.orbit.bootstrap())
    expect(profile.shells.some((shell) => shell.id === 'powershell')).toBe(true)
    expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true)
    await page.getByRole('button', { name: '打开本地终端', exact: true }).click()
    await expect(page.getByText('运行中', { exact: true })).toBeVisible()
    await page.locator('.xterm-helper-textarea').focus()
    await page.keyboard.type('Write-Output ("PACKAGED_" + "PTY_READY")')
    await page.keyboard.press('Enter')
    await expect(page.locator('.xterm-rows')).toContainText('PACKAGED_PTY_READY')
    await page.screenshot({ path: info.outputPath('packaged-terminal.png') })
    await page.getByRole('button', { name: '关闭标签 Windows PowerShell', exact: true }).click()
    await expect(page.getByText('让连接，井然有序。')).toBeVisible()
  } finally {
    await app
      .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.destroy()))
      .catch(() => {})
    await app.close().catch(() => {})
  }
})
