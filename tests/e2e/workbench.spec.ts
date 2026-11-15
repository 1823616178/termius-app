import { test as base, expect, _electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { generateKeyPairSync } from 'node:crypto'
import { Server, type Connection } from 'ssh2'
import { createServer, type AddressInfo } from 'node:net'
import { startMockSyncServer } from '../helpers/mock-sync-server'
import { startMockUpdateServer } from '../helpers/mock-update-server'
import {
  decryptSyncDocument,
  encryptSyncDocument,
  recoverVaultWithKey
} from '../../src/workers/data-crypto/sync-crypto'
import { normalizeRemoteDocument } from '../../src/workers/data-crypto/sync-merge'

interface Orbit {
  app: ElectronApplication
  page: Page
  directory: string
}
async function launch(
  directory: string,
  extraEnv: Record<string, string> = {}
): Promise<{ app: ElectronApplication; page: Page }> {
  const environment = Object.fromEntries(
    Object.entries({
      ...process.env,
      ORBIT_USER_DATA: directory,
      ORBIT_UPDATE_DISABLE_AUTO: '1',
      ...extraEnv
    }).filter((entry): entry is [string, string] => entry[1] !== undefined)
  )
  delete environment.ELECTRON_RUN_AS_NODE
  const app = await _electron.launch({ args: ['.'], cwd: process.cwd(), env: environment })
  const page = await app.firstWindow()
  await expect(page.getByText('让连接，井然有序。')).toBeVisible()
  return { app, page }
}
async function stop(app: ElectronApplication) {
  await app
    .evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy()
    })
    .catch(() => {})
  await app.close().catch(() => {})
}
const test = base.extend<{ orbit: Orbit }>({
  orbit: async ({}, use, info) => {
    const directory = await mkdtemp(join(tmpdir(), 'orbit-e2e-'))
    const { app, page } = await launch(directory)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await use({ app, page, directory })
    if (info.status !== info.expectedStatus)
      await page.screenshot({ path: info.outputPath('failure.png') }).catch(() => {})
    await stop(app)
    expect(errors).toEqual([])
  }
})

async function createHost(page: Page, name: string, port = 22, password?: string) {
  await page.getByRole('button', { name: '新建主机', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: '新建主机' })
  await dialog.getByLabel('主机名称', { exact: true }).fill(name)
  await dialog.getByLabel('主机地址', { exact: true }).fill('127.0.0.1')
  await dialog.getByLabel('端口', { exact: true }).fill(String(port))
  await dialog.getByLabel('用户名', { exact: true }).fill('orbit-test')
  if (password) {
    await dialog.getByLabel('连接密码（可在连接时输入）', { exact: true }).fill(password)
    await dialog.getByLabel('使用 Windows 系统保护保存密码', { exact: true }).check()
  }
  await dialog.getByRole('button', { name: '保存主机' }).click()
  await expect(dialog).not.toBeVisible()
}

async function checkClasses(page: Page) {
  const registry = JSON.parse(await readFile('artifacts/semantic-classes.json', 'utf8')) as {
    class: string
  }[]
  const result = await page.evaluate(
    (bases) => {
      const missing = [...document.querySelectorAll('body *')]
        .filter((el) => {
          if (el.closest('.xterm') || el.closest('svg.lucide') || el.tagName === 'SCRIPT') return false
          return ![...el.classList].some((value) =>
            /^container_[a-z][a-z0-9-]*_[a-z][a-z0-9-]*_[a-z][a-z0-9-]*_[a-z][a-z0-9-]*$/.test(value)
          )
        })
        .map((el) => el.tagName + '.' + el.className)
      const duplicates = bases.filter((base) => {
        const elements = [...document.getElementsByClassName(base)]
        if (elements.length <= 1) return false
        const tokens = elements.map((el) => [...el.classList].find((value) => value.startsWith(base + '-iw')))
        return tokens.some((value) => !value) || new Set(tokens).size !== elements.length
      })
      return { missing, duplicates }
    },
    registry.map((entry) => entry.class)
  )
  expect(result).toEqual({ missing: [], duplicates: [] })
}

test('secure empty workspace, semantic DOM and saved host persistence', async ({ orbit }, info) => {
  const { page, app, directory } = orbit
  await expect(page.getByRole('button', { name: '打开本地终端', exact: true })).toBeEnabled()
  expect(
    await page.evaluate(() => ({
      require: typeof (window as any).require,
      process: typeof (window as any).process
    }))
  ).toEqual({ require: 'undefined', process: 'undefined' })
  const preferences = await app.evaluate(({ BrowserWindow }) =>
    (BrowserWindow.getAllWindows()[0]!.webContents as any).getLastWebPreferences()
  )
  expect(preferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false })
  await checkClasses(page)
  await expect(page.locator('[data-variant="welcome"][data-ready="true"]')).toBeVisible()
  await page.waitForTimeout(600)
  await page.screenshot({ path: info.outputPath('welcome.png') })
  const password = `fixture-secret-${crypto.randomUUID()}`
  await createHost(page, '中文开发服务器', 2222, password)
  await createHost(page, '第二台服务器')
  await page.getByRole('button', { name: '主机', exact: true }).click()
  await expect(page.getByRole('heading', { name: '中文开发服务器', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '编辑 中文开发服务器', exact: true }).click()
  const editor = page.getByRole('dialog', { name: '编辑主机' })
  await checkClasses(page)
  await expect(editor.getByLabel('替换密码（留空保留已保存密码）')).toHaveValue('')
  await editor.getByLabel('替换密码（留空保留已保存密码）').fill('new-secret-unsaved')
  await editor.getByLabel('使用 Windows 系统保护保存密码').uncheck()
  await editor.getByRole('button', { name: '保存主机' }).click()
  await expect(editor).toContainText('已输入新密码，请勾选')
  await editor.getByLabel('替换密码（留空保留已保存密码）').fill('')
  await editor.getByLabel('主机名称', { exact: true }).fill('第二台服务器')
  await editor.getByRole('button', { name: '保存主机' }).click()
  await expect(editor.getByRole('alert')).toContainText('名称已存在')
  await editor.getByRole('button', { name: '取消', exact: true }).click()
  await checkClasses(page)

  // Search hosts input sits inside a bordered wrapper and must not draw an inner focus outline.
  const searchInput = page.getByLabel('搜索主机', { exact: true })
  await page.keyboard.press('Control+k')
  await expect(searchInput).toBeFocused()
  const searchFocusStyles = await searchInput.evaluate((el) => {
    const cs = window.getComputedStyle(el)
    return {
      outlineStyle: cs.outlineStyle,
      outlineWidth: cs.outlineWidth,
      boxShadow: cs.boxShadow
    }
  })
  expect(searchFocusStyles.outlineStyle).toBe('none')
  expect(searchFocusStyles.outlineWidth).toBe('0px')
  expect(searchFocusStyles.boxShadow).toBe('none')

  await page.screenshot({ path: info.outputPath('hosts.png') })
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await checkClasses(page)
  await page.getByRole('button', { name: '快捷键说明', exact: true }).click()
  const shortcutsDialog = page.getByRole('dialog', { name: '常用快捷键' })
  await expect(shortcutsDialog).toBeVisible()
  await checkClasses(page)
  await shortcutsDialog.getByRole('button', { name: '知道了', exact: true }).click()
  await page.getByRole('button', { name: '主机', exact: true }).click()
  await stop(app)
  const resumed = await launch(directory)
  try {
    await resumed.page.getByRole('button', { name: '主机', exact: true }).click()
    await expect(resumed.page.getByRole('heading', { name: '中文开发服务器', exact: true })).toBeVisible()
    const records = await resumed.page.evaluate(() => window.orbit.bootstrap())
    expect(records.hosts.find((host) => host.name === '中文开发服务器')?.hasPassword).toBe(true)
    expect(JSON.stringify(records)).not.toContain(password)
    for (const name of (await readdir(directory)).filter((name) => name.includes('sqlite')))
      expect((await readFile(join(directory, name))).includes(Buffer.from(password))).toBe(false)
  } finally {
    await stop(resumed.app)
  }
})

test('homepage sword realm, border flight, resize and motion tiers', async ({ orbit }, info) => {
  const { page, app } = orbit
  const stage = page.locator('[data-variant="welcome"]')
  const flight = page.locator('[class*="container_workspace_borderfx_overlay_flight"]')
  await expect(stage).toHaveAttribute('data-ready', 'true')
  const initialDistance = await flight.evaluate((element) => getComputedStyle(element).offsetDistance)
  await expect
    .poll(() => flight.evaluate((element) => getComputedStyle(element).offsetDistance))
    .not.toBe(initialDistance)

  const initialPath = await flight.getAttribute('style')
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]!.setSize(1100, 700)
  })
  await expect.poll(() => flight.getAttribute('style')).not.toBe(initialPath)
  await page.waitForTimeout(11_500)
  await page.screenshot({ path: info.outputPath('sword-gathering.png') })

  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('combobox', { name: '动效与性能档' }).click()
  await page.getByRole('option', { name: '轻量', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'light')
  await page.getByRole('button', { name: '工作台', exact: true }).click()
  await expect(stage).toHaveAttribute('data-ready', 'true')
  await expect(stage.locator('canvas')).toBeVisible()

  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('combobox', { name: '动效与性能档' }).click()
  await page.getByRole('option', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '工作台', exact: true }).click()
  await expect(stage.locator('img')).toBeVisible()
  await expect(stage.locator('canvas')).toBeHidden()
  await expect(flight).toBeHidden()

  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('combobox', { name: '动效与性能档' }).click()
  await page.getByRole('option', { name: '完整', exact: true }).click()
  await page.getByRole('button', { name: '工作台', exact: true }).click()
  await expect(stage).toHaveAttribute('data-ready', 'true')
  await expect(flight).toBeVisible()
})

test('real PowerShell and CMD, split resize, terminal input and lifecycle cleanup', async ({
  orbit
}, info) => {
  const { page, app } = orbit
  const initial = await page.evaluate(() => window.orbit.bootstrap())
  expect(initial.shells.some((profile) => profile.id === 'powershell')).toBe(true)
  expect(initial.shells.some((profile) => profile.id === 'cmd')).toBe(true)
  await page.getByRole('button', { name: '打开本地终端', exact: true }).click()
  await expect(page.getByText('运行中', { exact: true })).toHaveCount(1)
  await expect(page.locator('.xterm-rows').first()).toContainText('PS ', { timeout: 15_000 })
  const terminal = page.locator('.xterm-helper-textarea').first()
  await terminal.focus()
  await page.keyboard.type('Write-Output ("ORBIT_" + "LOCAL_READY")')
  await page.keyboard.press('Enter')
  await expect(page.locator('.xterm-rows').first()).toContainText('ORBIT_LOCAL_READY')
  await page.keyboard.type('Write-Output ("ORBIT_PID:" + $PID)')
  await page.keyboard.press('Enter')
  await expect(page.locator('.xterm-rows').first()).toContainText(/ORBIT_PID:\d+/)
  const bounds = await page.evaluate(() => {
    const surface = document
      .querySelector('.container_workspace_terminal_body_surface')!
      .getBoundingClientRect()
    const screen = document.querySelector('.xterm-screen')!.getBoundingClientRect()
    return {
      surfaceTop: surface.top,
      surfaceBottom: surface.bottom,
      screenTop: screen.top,
      screenBottom: screen.bottom
    }
  })
  expect(bounds.screenTop).toBeGreaterThanOrEqual(bounds.surfaceTop)
  expect(bounds.surfaceBottom - bounds.screenBottom).toBeGreaterThanOrEqual(8)
  const shellPid = Number(
    (await page.locator('.xterm-rows').first().innerText()).match(/ORBIT_PID:(\d+)/)![1]
  )
  const originalClipboard = await app.evaluate(({ clipboard }) => clipboard.readText())
  try {
    await app.evaluate(({ clipboard }) =>
      clipboard.writeText('Write-Output PASTE_PREVIEW_ONE\r\nWrite-Output PASTE_PREVIEW_TWO')
    )
    await page.getByRole('button', { name: '粘贴到终端', exact: true }).click()
    const pastePreview = page.getByRole('dialog', { name: '确认多行粘贴' })
    await expect(pastePreview).toBeVisible()
    await checkClasses(page)
    await expect(pastePreview.locator('pre')).toContainText('PASTE_PREVIEW_TWO')
    await expect(page.locator('.xterm-rows').first()).not.toContainText('PASTE_PREVIEW_ONE')
    await pastePreview.getByRole('button', { name: '取消', exact: true }).click()
    await app.evaluate(({ clipboard }) => clipboard.writeText('Write-Output ("PASTE_" + "ONCE")'))
    await terminal.focus()
    await page.keyboard.press('Control+Shift+V')
    await page.keyboard.press('Enter')
    await expect(page.locator('.xterm-rows').first()).toContainText('PASTE_ONCE')
    expect((await page.locator('.xterm-rows').first().innerText()).match(/PASTE_ONCE/g)).toHaveLength(1)
  } finally {
    await app.evaluate(({ clipboard }, original) => clipboard.writeText(original), originalClipboard)
  }
  await page.getByRole('button', { name: '左右分屏', exact: true }).click()
  await expect(page.getByText('运行中', { exact: true })).toHaveCount(2)
  await checkClasses(page)
  const divider = page.getByRole('separator')
  await divider.focus()
  await page.keyboard.press('ArrowRight')
  await expect(divider).toHaveAttribute('aria-valuenow', '55')
  await page.locator('.xterm-helper-textarea').first().focus()
  await page.keyboard.press('Control+Shift+F')
  const searchInput = page.getByLabel('终端搜索内容').first()
  await expect(searchInput).toBeFocused()
  await searchInput.fill('ORBIT_LOCAL_READY')
  await page.keyboard.press('Escape')
  await expect(searchInput).not.toBeVisible()
  await page.screenshot({ path: info.outputPath('split.png') })
  await page.getByRole('button', { name: '本地终端', exact: true }).click()
  await checkClasses(page)
  await page
    .locator('.container_local_profile_body_base')
    .filter({ hasText: '命令提示符' })
    .getByRole('button', { name: '打开终端' })
    .click()
  // Hidden tabs keep their sessions and continue parsing output, and active Tab 2 can split reliably.
  await expect(page.getByText('运行中', { exact: true })).toHaveCount(3)
  await page.getByRole('button', { name: '上下分屏', exact: true }).click()
  await expect(page.getByText('运行中', { exact: true })).toHaveCount(4)
  await checkClasses(page)
  const verticalDivider = page.getByRole('separator').last()
  await verticalDivider.focus()
  await page.keyboard.press('ArrowDown')
  await expect(verticalDivider).toHaveAttribute('aria-valuenow', '55')
  await page.locator('.xterm-helper-textarea').last().focus()
  await page.keyboard.type('echo ORBIT_CMD_READY')
  await page.keyboard.press('Enter')
  await expect(page.locator('.xterm-rows').last()).toContainText('ORBIT_CMD_READY')
  await page.keyboard.type('exit')
  await page.keyboard.press('Enter')
  await expect(page.getByText('已退出', { exact: true })).toBeVisible()
  await page.locator('.xterm-helper-textarea').last().focus()
  await page.keyboard.press('Control+Shift+W')
  await expect(page.locator('.xterm-rows').first()).not.toContainText('^W')
  await page.getByRole('button', { name: '关闭标签 Windows PowerShell', exact: true }).click()
  await expect(page.getByText('让连接，井然有序。')).toBeVisible()
  await expect
    .poll(
      () => {
        try {
          process.kill(shellPid, 0)
          return true
        } catch {
          return false
        }
      },
      { timeout: 10_000 }
    )
    .toBe(false)
  const windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
  expect(windows).toBe(1)
})

test('real SSH handshake, trust prompt, encrypted credential and PTY data', async ({ orbit }, info) => {
  const { page } = orbit
  const hostKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
    type: 'pkcs1',
    format: 'pem'
  }) as string
  const password = `ssh-fixture-${crypto.randomUUID()}`
  const connections = new Set<Connection>()
  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    connections.add(client)
    client.on('error', () => {})
    client.on('close', () => connections.delete(client))
    client.on('authentication', (context) =>
      context.method === 'password' && context.username === 'orbit-test' && context.password === password
        ? context.accept()
        : context.reject()
    )
    client.on('ready', () =>
      client.on('session', (accept) => {
        const session = accept()
        session.on('pty', (acceptPty) => acceptPty?.())
        session.on('window-change', (acceptResize) => acceptResize?.())
        session.on('shell', (acceptShell) => {
          const stream = acceptShell()
          // Split a Unicode code point across packets to verify streaming decoding.
          const bytes = Buffer.from('ORBIT_SSH_READY 中文\r\n')
          stream.write(bytes.subarray(0, 17))
          stream.write(bytes.subarray(17))
          stream.on('data', (data: Buffer) => stream.write(data))
        })
      })
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  let replacement: Server | undefined
  try {
    await createHost(page, '协议测试服务器', (server.address() as AddressInfo).port, password)
    await page.getByRole('button', { name: '连接 协议测试服务器', exact: true }).click()
    const trust = page.getByRole('dialog', { name: '确认服务器身份' })
    await expect(trust).toBeVisible()
    await expect(trust.locator('code')).toContainText('SHA256:')
    await checkClasses(page)
    await page.screenshot({ path: info.outputPath('host-trust.png') })
    await trust.getByRole('button', { name: '信任并继续' }).click()
    await expect(page.getByText('运行中', { exact: true })).toBeVisible()
    await expect(page.locator('.xterm-rows')).toContainText('ORBIT_SSH_READY 中文')
    await page.locator('.xterm-helper-textarea').focus()
    await page.keyboard.type('ssh-roundtrip')
    await expect(page.locator('.xterm-rows')).toContainText('ssh-roundtrip')
    await page.getByRole('button', { name: '关闭标签 协议测试服务器', exact: true }).click()
    await page.getByRole('button', { name: '连接 协议测试服务器', exact: true }).click()
    await expect(page.getByText('运行中', { exact: true })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('button', { name: '关闭标签 协议测试服务器', exact: true }).click()
    const port = (server.address() as AddressInfo).port
    await new Promise<void>((resolve) => server.close(() => resolve()))
    const changedKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
      type: 'pkcs1',
      format: 'pem'
    }) as string
    replacement = new Server({ hostKeys: [changedKey] }, (client) => {
      connections.add(client)
      client.on('error', () => {})
      client.on('close', () => connections.delete(client))
      client.on('authentication', (context) => context.reject())
    })
    await new Promise<void>((resolve) => replacement!.listen(port, '127.0.0.1', resolve))
    await page.getByRole('button', { name: '连接 协议测试服务器', exact: true }).click()
    const changedTrust = page.getByRole('dialog', { name: '主机指纹已变化' })
    await expect(changedTrust).toBeVisible()
    await expect(changedTrust.locator('code')).toHaveCount(2)
    await expect(changedTrust.getByRole('button', { name: '信任并继续' })).toBeDisabled()
    await changedTrust.getByRole('button', { name: '取消', exact: true }).click()
    await expect(page.getByText('连接失败', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '关闭标签 协议测试服务器', exact: true }).click()

    // Password authentication failure should prompt to re-enter password rather than failing permanently
    await new Promise<void>((resolve) => replacement!.close(() => resolve()))
    replacement = new Server({ hostKeys: [hostKey] }, (client) => {
      connections.add(client)
      client.on('error', () => {})
      client.on('close', () => connections.delete(client))
      client.on('authentication', (context) =>
        context.method === 'password' && context.username === 'orbit-test' && context.password === password
          ? context.accept()
          : context.reject()
      )
      client.on('ready', () =>
        client.on('session', (accept) => {
          const session = accept()
          session.on('pty', (acceptPty) => acceptPty?.())
          session.on('window-change', (acceptResize) => acceptResize?.())
          session.on('shell', (acceptShell) => {
            const stream = acceptShell()
            stream.write('ORBIT_SSH_RETRY_OK\r\n')
            stream.on('data', (data: Buffer) => stream.write(data))
          })
        })
      )
    })
    await new Promise<void>((resolve) => replacement!.listen(port, '127.0.0.1', resolve))

    await createHost(page, '密码重试服务器', port, 'wrong-saved-password')
    await page.getByRole('button', { name: '连接 密码重试服务器', exact: true }).click()
    const retryPrompt1 = page.getByRole('dialog', { name: '重新输入密码 · 密码重试服务器' })
    await expect(retryPrompt1).toBeVisible()
    await expect(retryPrompt1.getByRole('alert')).toContainText('SSH 密码认证失败')
    await checkClasses(page)
    await page.screenshot({ path: info.outputPath('ssh-auth-retry-prompt.png') })

    // Submitting another wrong password should remind again instead of ending in permanent failure
    await retryPrompt1.getByLabel('本次连接密码', { exact: true }).fill('wrong-second-try')
    await retryPrompt1.getByRole('button', { name: '重新连接', exact: true }).click()
    const retryPrompt2 = page.getByRole('dialog', { name: '重新输入密码 · 密码重试服务器' })
    await expect(retryPrompt2).toBeVisible()
    await retryPrompt2.getByRole('button', { name: '取消', exact: true }).click()
    await expect(page.getByRole('button', { name: '输入密码重试' })).toBeVisible()

    // Re-opening from the retry button accepts the right password and can update the saved credential
    await page.getByRole('button', { name: '输入密码重试' }).click()
    const retryPrompt3 = page.getByRole('dialog', { name: '重新输入密码 · 密码重试服务器' })
    await expect(retryPrompt3).toBeVisible()
    await retryPrompt3.getByLabel('本次连接密码', { exact: true }).fill(password)
    const saveNewCheckbox = retryPrompt3.getByLabel(/保存密码到此主机/)
    const canSavePassword = await saveNewCheckbox.isVisible()
    if (canSavePassword) {
      await saveNewCheckbox.check()
    }
    await retryPrompt3.getByRole('button', { name: '重新连接', exact: true }).click()
    await expect(page.locator('.xterm-rows')).toContainText('ORBIT_SSH_RETRY_OK')
    await page.getByRole('button', { name: '关闭标签 密码重试服务器', exact: true }).click()

    // Subsequent connection succeeds without prompt when the updated password was saved
    if (canSavePassword) {
      await page.getByRole('button', { name: '连接 密码重试服务器', exact: true }).click()
      await expect(page.locator('.xterm-rows')).toContainText('ORBIT_SSH_RETRY_OK')
      await expect(page.getByRole('dialog')).toHaveCount(0)
    }
  } finally {
    for (const connection of connections) connection.end()
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
    if (replacement?.listening) await new Promise<void>((resolve) => replacement!.close(() => resolve()))
  }
})

test('bounded high-volume ConPTY output and local worker failure recovery', async ({ orbit }) => {
  const { page, app } = orbit
  const result = await page.evaluate(async () => {
    const requestId = crypto.randomUUID()
    let port: MessagePort | undefined
    let bytes = 0,
      latest = '',
      sequence = 0
    const decoder = new TextDecoder()
    const stream = new Promise<{ bytes: number; sequence: number }>((resolve, reject) => {
      const timer = setTimeout(() => {
        port?.close()
        reject(new Error('ConPTY high-volume output timed out'))
      }, 25_000)
      const listener = (event: MessageEvent) => {
        if (event.source !== window || event.data?.requestId !== requestId || !event.ports[0]) return
        window.removeEventListener('message', listener)
        port = event.ports[0]
        port.onmessage = ({ data }) => {
          if (data.type === 'state' && data.state === 'running') {
            port!.postMessage({
              type: 'input',
              data: '$s="X"*8192; for($i=0;$i -lt 640;$i++){[Console]::Write($s)}; Write-Output ("ORBIT_"+"OUTPUT_DONE")\r'
            })
          } else if (data.type === 'data') {
            bytes += data.data.byteLength
            if (data.sequence !== sequence + 1) {
              clearTimeout(timer)
              reject(new Error('Output was reordered'))
              return
            }
            sequence = data.sequence
            latest = (latest + decoder.decode(data.data, { stream: true })).slice(-16384)
            port!.postMessage({ type: 'ack', sequence })
            if (latest.includes('ORBIT_OUTPUT_DONE')) {
              clearTimeout(timer)
              resolve({ bytes, sequence })
            }
          } else if (data.type === 'state' && data.state === 'error') {
            clearTimeout(timer)
            reject(new Error(data.message))
          }
        }
        port.start()
      }
      window.addEventListener('message', listener)
    })
    const session = await window.orbit.sessions.open({
      requestId,
      kind: 'local',
      profileId: 'powershell',
      cols: 120,
      rows: 30
    })
    try {
      return await stream
    } finally {
      port?.close()
      await window.orbit.sessions.close(session.id)
    }
  })
  expect(result.bytes).toBeGreaterThanOrEqual(5 * 1024 * 1024)
  expect(result.sequence).toBeGreaterThan(160)
  await page.getByRole('button', { name: '打开本地终端', exact: true }).click()
  await expect(page.getByText('运行中', { exact: true })).toBeVisible()
  const workerPid = await app.evaluate(
    ({ app }) => app.getAppMetrics().find((process) => process.name === 'Orbit Local PTY')!.pid
  )
  process.kill(workerPid)
  await expect(page.getByText('连接失败', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '新建本地会话', exact: true }).click()
  await expect(page.getByText('运行中', { exact: true })).toBeVisible()
})

test('E2EE sync lifecycle, keepSignedIn rotation, recovery key, conflict UI and vault key rotation', async ({}, info) => {
  const server = await startMockSyncServer()
  const directory = await mkdtemp(join(tmpdir(), 'orbit-e2e-sync-'))
  let firstApp: ElectronApplication | undefined
  let secondApp: ElectronApplication | undefined
  try {
    const email = 'sync-user@example.com'
    const first = await launch(directory)
    firstApp = first.app
    let page = first.page

    // Create a local host with saved Windows DPAPI password
    await page.getByRole('button', { name: '主机', exact: true }).click()
    await createHost(page, 'Sync-Prod-Box', 2222, 'SecretHostPass!9')

    // Open E2EE Sync page & verify semantic CSS classes
    await page.getByRole('button', { name: '远程同步', exact: true }).click()
    await expect(page.getByRole('heading', { name: '端到端加密远程同步' })).toBeVisible()
    await checkClasses(page)

    // Register new account with keepSignedIn checked
    await page.getByRole('button', { name: '注册新账号', exact: true }).click()
    await page.getByPlaceholder('https://sync.example.com').fill(server.url)
    await page.getByPlaceholder('name@example.com').fill(email)
    await page.locator('.container_sync_account_body_password-input').fill('AccountPass123!')
    await page.locator('.container_sync_account_body_keep-check').check()
    await page.getByRole('button', { name: '注册并连接', exact: true }).click()
    await expect(page.getByText(email, { exact: true })).toBeVisible()

    // Create E2EE Vault and capture one-time SPM1 recovery key
    await page.locator('.container_sync_vault_body_create-pw-input').fill('MasterVaultPass#1')
    await page.locator('.container_sync_vault_body_create-confirm-input').fill('MasterVaultPass#1')
    await page.getByRole('button', { name: '创建加密保管库并上传初始文档', exact: true }).click()
    const recoveryCode = page.locator('.container_sync_recovery_body_code')
    await expect(recoveryCode).toBeVisible()
    const recoveryKey = (await recoveryCode.innerText()).trim()
    expect(recoveryKey).toMatch(/^SPM1-/)
    await page.getByRole('button', { name: '我已保存，关闭', exact: true }).click()

    // Create Sync Group in IdentitiesPage and Tunnel Rule in TunnelsPage, then push from SyncPage
    await page.getByRole('button', { name: '凭据与分组', exact: true }).click()
    await page.getByPlaceholder('输入分组名称（例如：生产环境 / GPU 集群）').fill('Prod-Cluster')
    await page.getByRole('button', { name: '添加分组', exact: true }).click()
    await expect(page.getByText('Prod-Cluster', { exact: true }).first()).toBeVisible()

    await page.getByRole('button', { name: '端口转发', exact: true }).click()
    await page.getByPlaceholder('例如：内网数据库 3306 转发').fill('PG-Local-Tunnel')
    await page.getByRole('button', { name: '保存端口转发规则', exact: true }).click()
    await expect(page.getByText('PG-Local-Tunnel', { exact: true }).first()).toBeVisible()

    await page.getByRole('button', { name: '远程同步', exact: true }).click()
    await page.locator('.container_sync_vault_body_pwsync-check').check()
    await expect(page.getByText('rev-').first()).toBeVisible()

    // Assert server ciphertext holds ZERO plaintext secrets or host names/IPs
    const serverState1 = server.getUserState(email)
    expect(serverState1.latestRevision).toBeTruthy()
    const rawCipherJson = JSON.stringify(serverState1.latestRevision!.envelope)
    expect(rawCipherJson).not.toContain('SecretHostPass!9')
    expect(rawCipherJson).not.toContain('Sync-Prod-Box')
    expect(rawCipherJson).not.toContain('MasterVaultPass#1')

    await checkClasses(page)
    await stop(firstApp)
    firstApp = undefined

    // Restart app on same userData dir -> silent refresh token rotation restores signedIn state
    // and DPAPI restores the unlocked vault key automatically without prompting for master password
    const second = await launch(directory)
    secondApp = second.app
    page = second.page
    await page.getByRole('button', { name: '远程同步', exact: true }).click()
    await expect(page.getByRole('button', { name: '退出登录（保留本机主机数据）', exact: true })).toBeVisible(
      {
        timeout: 10000
      }
    )
    await expect(page.getByText(email)).toBeVisible({ timeout: 10000 })
    expect(server.getUserState(email).refreshRotateCount).toBeGreaterThanOrEqual(1)
    await expect(page.getByRole('button', { name: '立即同步', exact: true })).toBeEnabled({ timeout: 10000 })

    // Explicitly lock vault, then unlock using SPM1 recovery key
    await page.getByRole('button', { name: '立即锁定保管库', exact: true }).click()
    await page.getByRole('button', { name: 'SPM1 恢复密钥恢复', exact: true }).click()
    await page.getByPlaceholder('SPM1-...').fill(recoveryKey)
    await page.getByRole('button', { name: '校验恢复密钥并解锁', exact: true }).click()
    await expect(page.getByRole('button', { name: '立即同步', exact: true })).toBeEnabled({ timeout: 10000 })

    await page
      .getByRole('navigation', { name: '主导航' })
      .getByRole('button', { name: '主机', exact: true })
      .click()
    await page.getByRole('button', { name: '编辑 Sync-Prod-Box', exact: true }).click()
    const editorDialog = page.getByRole('dialog', { name: '编辑主机' })
    await editorDialog.getByLabel('端口', { exact: true }).fill('3333')
    await editorDialog.getByLabel('替换密码（留空保留已保存密码）', { exact: true }).fill('LocalSecret#33')
    await editorDialog.getByLabel('使用 Windows 系统保护保存密码', { exact: true }).check()
    await editorDialog.getByRole('button', { name: '保存主机' }).click()
    await expect(editorDialog).not.toBeVisible()

    // Push conflicting remote edit directly to mock server using the recovered vault key
    const stateBeforeConflict = server.getUserState(email)
    const { vaultKey } = await recoverVaultWithKey(stateBeforeConflict.vault!, recoveryKey)
    const remoteDecrypted = decryptSyncDocument(
      vaultKey,
      stateBeforeConflict.vault!.id,
      stateBeforeConflict.latestRevision!.envelope
    )
    const peerDoc = normalizeRemoteDocument(remoteDecrypted.rawDocument)
    peerDoc.updatedAt = new Date().toISOString()
    peerDoc.servers[0]!.profile.port = 4444
    peerDoc.servers[0]!.secrets = {
      ...(peerDoc.servers[0]!.secrets ?? {}),
      password: 'PeerSecret#44'
    }
    const peerEnvelope = encryptSyncDocument(vaultKey, stateBeforeConflict.vault!.id, 1, peerDoc)
    server.pushSimulatedRemoteRevision(email, peerEnvelope)

    await page.getByRole('button', { name: '远程同步', exact: true }).click()
    await page.getByRole('button', { name: '立即同步', exact: true }).click()
    await expect(page.getByRole('region', { name: '同步冲突处理' })).toBeVisible({ timeout: 10000 })
    await page.getByRole('button', { name: /采用远端：4444/ }).click()
    await page.getByRole('button', { name: /采用远端：已设置/ }).click()
    await page.getByRole('button', { name: '应用选择并完成同步', exact: true }).click()
    await expect(page.getByRole('region', { name: '同步冲突处理' })).not.toBeVisible()

    // Turn off password sync -> requires Vault Key Rotation (keyVersion: 2) and strips passwords on wire
    await page.locator('.container_sync_vault_body_pwsync-check').uncheck()
    await page.getByRole('textbox', { name: '输入当前账号登录密码以确认密钥轮换' }).fill('AccountPass123!')
    await page.getByRole('textbox', { name: '输入保管库新主密码以加密新密钥' }).fill('MasterVaultPass#1')
    await page.getByRole('button', { name: '确认轮换密钥并关闭密码同步', exact: true }).click()
    await expect(page.getByText('v2', { exact: true })).toBeVisible({ timeout: 10000 })
    await expect(page.locator('.container_sync_recovery_body_code')).toBeVisible()
    expect(server.getUserState(email).vault?.keyVersion).toBe(2)

    await checkClasses(page)
  } catch (error) {
    await secondApp
      ?.windows()[0]
      ?.screenshot({ path: info.outputPath('sync-failure.png') })
      .catch(() => {})
    throw error
  } finally {
    if (firstApp) await stop(firstApp)
    if (secondApp) await stop(secondApp)
    await server.close()
    await rm(directory, { recursive: true, force: true }).catch(() => {})
  }
})

test('drag tab into workspace triggers animated split preview, lossless docking and unsplit', async ({
  orbit
}, info) => {
  const { page } = orbit
  await page.getByRole('button', { name: '打开本地终端', exact: true }).click()
  await expect(page.getByText('运行中', { exact: true })).toHaveCount(1)
  await expect(page.locator('.xterm-rows').first()).toContainText('PS ', { timeout: 15_000 })
  const firstTerminal = page.locator('.xterm-helper-textarea').first()
  await firstTerminal.focus()
  await page.keyboard.type('Write-Output ("TAB_ONE_" + "KEEP")')
  await page.keyboard.press('Enter')
  await expect(page.locator('.xterm-rows').first()).toContainText('TAB_ONE_KEEP')

  await page.getByRole('button', { name: '本地终端', exact: true }).click()
  await page
    .locator('.container_local_profile_body_base')
    .filter({ hasText: '命令提示符' })
    .getByRole('button', { name: '打开终端' })
    .click()
  await expect(page.getByRole('tab')).toHaveCount(2)
  await expect(page.getByText('运行中', { exact: true })).toHaveCount(2)
  const secondTerminal = page.locator('.xterm-helper-textarea').last()
  await secondTerminal.focus()
  await page.keyboard.type('echo TAB_TWO_KEEP')
  await page.keyboard.press('Enter')
  await expect(page.locator('.xterm-rows').last()).toContainText('TAB_TWO_KEEP')

  // Switch back to the first tab while leaving the second tab in the tab strip.
  await page.getByRole('tab', { name: /Windows PowerShell/ }).click()
  const activeTabItem = page.locator(".container_workspace_tabs_header_item[data-active='true']")
  const activeTabButton = activeTabItem.locator('.container_workspace_tabs_header_select')
  await activeTabButton.hover()
  const topBarStyle = await activeTabItem.evaluate((el) => {
    const after = window.getComputedStyle(el, '::after')
    const btn = el.querySelector('.container_workspace_tabs_header_select') as HTMLElement
    const btnBg = window.getComputedStyle(btn).backgroundColor
    return { opacity: after.opacity, height: after.height, top: after.top, zIndex: after.zIndex, btnBg }
  })
  expect(topBarStyle.opacity).toBe('1')
  expect(topBarStyle.height).toBe('2px')
  expect(topBarStyle.top).toBe('0px')
  expect(Number(topBarStyle.zIndex)).toBeGreaterThanOrEqual(2)
  expect(topBarStyle.btnBg).toBe('rgba(0, 0, 0, 0)')

  const cmdTabItem = page.locator('.container_workspace_tabs_header_item').filter({ hasText: '命令提示符' })
  const paneArea = page.locator('.container_workspace_panes_body_base:visible').first()
  const paneBox = (await paneArea.boundingBox())!

  // Verify live drag-over preview HUD & compass alignment and semantic class compliance while visible.
  await page.evaluate(
    ({ x, y }) => {
      const tabsEls = [...document.querySelectorAll('.container_workspace_tabs_header_item')]
      const sourceEl = tabsEls.find((el) => el.textContent?.includes('命令提示符'))!
      const paneEl = [...document.querySelectorAll('.container_workspace_panes_body_base')].find(
        (el) => (el as HTMLElement).offsetParent !== null
      )!
      const dataTransfer = new DataTransfer()
      sourceEl.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }))
      paneEl.dispatchEvent(
        new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          dataTransfer
        })
      )
    },
    { x: paneBox.x + paneBox.width * 0.85, y: paneBox.y + paneBox.height * 0.5 }
  )
  const overlay = paneArea.locator('.container_workspace_split_overlay_base')
  await expect(overlay).toBeVisible()
  await expect(overlay).toHaveAttribute('data-zone', 'right')
  await expect(overlay).toContainText('并入右侧分屏')
  await checkClasses(page)
  await page.screenshot({ path: info.outputPath('drag-split-preview.png') })
  await cmdTabItem.dispatchEvent('dragend')
  await expect(overlay).not.toBeVisible()

  // Perform real Chromium dragTo from second tab into right split zone of first workspace.
  await cmdTabItem.dragTo(paneArea, {
    targetPosition: { x: Math.round(paneBox.width * 0.82), y: Math.round(paneBox.height * 0.5) }
  })

  await expect(page.getByRole('tab')).toHaveCount(1)
  await expect(page.locator('.container_workspace_tabs_header_split-badge')).toContainText('2分屏')
  await expect(page.locator('.xterm-rows')).toHaveCount(2)
  await expect(page.locator('.xterm-rows').nth(0)).toContainText('TAB_ONE_KEEP')
  await expect(page.locator('.xterm-rows').nth(1)).toContainText('TAB_TWO_KEEP')
  await page.screenshot({ path: info.outputPath('drag-split-docked.png') })
  await checkClasses(page)

  // Drag the right split pane's header over the left pane's left zone to verify preview & lossless swap.
  const visiblePanes = paneArea.locator('.container_workspace_panes_body_pane')
  const leftPane = visiblePanes.nth(0)
  const rightHeader = visiblePanes.nth(1).locator('.container_workspace_terminal_header_base')
  const leftPaneBox = (await leftPane.boundingBox())!
  await page.evaluate(
    ({ x, y }) => {
      const headers = [
        ...document.querySelectorAll(
          '.container_workspace_panes_body_base:not([style*="display: none"]) .container_workspace_terminal_header_base'
        )
      ]
      const panes = [
        ...document.querySelectorAll(
          '.container_workspace_panes_body_base:not([style*="display: none"]) .container_workspace_panes_body_pane'
        )
      ]
      const sourceHeader = headers[1]!
      const targetPane = panes[0]!
      const dataTransfer = new DataTransfer()
      sourceHeader.dispatchEvent(
        new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer })
      )
      targetPane.dispatchEvent(
        new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          dataTransfer
        })
      )
    },
    { x: leftPaneBox.x + leftPaneBox.width * 0.22, y: leftPaneBox.y + leftPaneBox.height * 0.5 }
  )
  await expect(overlay).toBeVisible()
  await expect(overlay).toHaveAttribute('data-zone', 'left')
  await expect(overlay).toContainText('移至左侧分屏')
  await rightHeader.dispatchEvent('dragend')
  await expect(overlay).not.toBeVisible()

  await rightHeader.dragTo(leftPane, {
    sourcePosition: { x: 80, y: 16 },
    targetPosition: { x: Math.round(leftPaneBox.width * 0.22), y: Math.round(leftPaneBox.height * 0.5) }
  })
  await expect(page.locator('.xterm-rows').nth(0)).toContainText('TAB_TWO_KEEP')
  await expect(page.locator('.xterm-rows').nth(1)).toContainText('TAB_ONE_KEEP')
  await page.screenshot({ path: info.outputPath('pane-header-drag-reposition.png') })
  await checkClasses(page)

  // Drag the bottom-right pane header onto the top edge of the left pane to switch into vertical top/bottom split.
  const newTopTarget = paneArea.locator('.container_workspace_panes_body_pane').nth(0)
  const newTopTargetBox = (await newTopTarget.boundingBox())!
  const swappedRightHeader = paneArea
    .locator('.container_workspace_panes_body_pane')
    .nth(1)
    .locator('.container_workspace_terminal_header_base')
  await swappedRightHeader.dragTo(newTopTarget, {
    sourcePosition: { x: 80, y: 16 },
    targetPosition: {
      x: Math.round(newTopTargetBox.width * 0.5),
      y: Math.round(newTopTargetBox.height * 0.12)
    }
  })
  await expect(paneArea).toHaveAttribute('data-direction', 'vertical')
  await expect(page.locator('.xterm-rows').nth(0)).toContainText('TAB_ONE_KEEP')
  await expect(page.locator('.xterm-rows').nth(1)).toContainText('TAB_TWO_KEEP')

  // Drag the top split pane header up into blank tab-bar space to detach back into a standalone tab losslessly.
  const tabList = page.locator('.container_workspace_tabs_header_list')
  const tabListBox = (await tabList.boundingBox())!
  const topHeader = paneArea
    .locator('.container_workspace_panes_body_pane')
    .nth(0)
    .locator('.container_workspace_terminal_header_base')
  await topHeader.dragTo(tabList, {
    sourcePosition: { x: 80, y: 16 },
    targetPosition: { x: Math.round(tabListBox.width - 28), y: Math.round(tabListBox.height * 0.5) }
  })
  await expect(page.getByRole('tab')).toHaveCount(2)
  await expect(page.locator('.xterm-rows').nth(0)).toContainText('TAB_TWO_KEEP')
  await expect(page.locator('.xterm-rows').nth(1)).toContainText('TAB_ONE_KEEP')
  await checkClasses(page)

  await page.getByRole('button', { name: '关闭标签 命令提示符', exact: true }).click()
  await page.getByRole('button', { name: '关闭标签 Windows PowerShell', exact: true }).click()
  await expect(page.getByText('让连接，井然有序。')).toBeVisible()
})

test('activated tunnels & identities pages, horizontal host actions, sync write mode, and WuXing-Bagua UI themes', async ({
  orbit
}, info) => {
  const { page } = orbit
  const tcpProbeServer = createServer((socket) => {
    socket.end()
  })
  await new Promise<void>((resolve) => tcpProbeServer.listen(0, '127.0.0.1', resolve))
  const boundPort = (tcpProbeServer.address() as AddressInfo).port

  const ephemeralServer = createServer()
  await new Promise<void>((resolve) => ephemeralServer.listen(0, '127.0.0.1', resolve))
  const freePort = (ephemeralServer.address() as AddressInfo).port
  await new Promise<void>((resolve) => ephemeralServer.close(() => resolve()))

  try {
    await createHost(page, 'Dao-Node-Alpha', boundPort)
    await page.getByRole('button', { name: '主机', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Dao-Node-Alpha', exact: true })).toBeVisible()

    // Toggle sync write mode between realtime and local-only
    await page.getByRole('button', { name: '仅保留本地修改', exact: true }).click()
    await expect(page.getByRole('button', { name: '仅保留本地修改', exact: true })).toHaveAttribute(
      'data-active',
      'true'
    )
    await page.getByRole('button', { name: '实时同步到服务端', exact: true }).click()
    await expect(page.getByRole('button', { name: '实时同步到服务端', exact: true })).toHaveAttribute(
      'data-active',
      'true'
    )

    // Probe TCP connectivity directly on horizontal host row
    const hostCard = page.locator('.container_hosts_card_body_base').filter({ hasText: 'Dao-Node-Alpha' })
    await hostCard.getByRole('button', { name: '测速', exact: true }).click()
    await expect(hostCard.locator('.container_hosts_row_latency_pill')).toContainText('ms', {
      timeout: 5000
    })

    // Expand per-host port-forwarding drawer, add rule, and check local port occupancy
    await hostCard.getByRole('button', { name: '端口转发', exact: true }).click()
    await hostCard.getByPlaceholder('规则名称').fill('Host-Inline-Fwd')
    await hostCard.locator('.container_hosts_drawer_input_lport').fill(String(freePort))
    await hostCard.getByRole('button', { name: '测端口', exact: true }).click()
    await expect(hostCard).toContainText('端口检测结果：', { timeout: 5000 })
    await hostCard.getByRole('button', { name: '新增转发', exact: true }).click()
    await expect(hostCard).toContainText('Host-Inline-Fwd')
    await page.screenshot({ path: info.outputPath('hosts-horizontal-tunnels.png') })
    await checkClasses(page)

    // Activated NavRail Tunnels page: manual TCP probe & occupied/free local port check
    const nav = page.getByRole('navigation', { name: '主导航' })
    await nav.getByRole('button', { name: '端口转发', exact: true }).click()
    await expect(page.getByRole('heading', { name: '端口转发与网络探测中心' })).toBeVisible()
    await page.getByLabel('探测目标主机', { exact: true }).fill('127.0.0.1')
    await page.getByLabel('探测目标端口', { exact: true }).fill(String(boundPort))
    await page.getByRole('button', { name: '测试连通性', exact: true }).click()
    await expect(page.locator('.container_tunnels_probe_result_banner')).toHaveAttribute('data-ok', 'true')

    await page.getByLabel('检测监听地址', { exact: true }).fill('127.0.0.1')
    await page.getByLabel('检测本地端口', { exact: true }).fill(String(boundPort))
    await page.getByRole('button', { name: '检测端口占用', exact: true }).click()
    await expect(page.locator('.container_tunnels_portcheck_result_badge')).toContainText('已被占用')

    await page.getByLabel('检测本地端口', { exact: true }).fill(String(freePort))
    await page.getByRole('button', { name: '检测端口占用', exact: true }).click()
    await expect(page.locator('.container_tunnels_portcheck_result_badge')).toContainText('空闲可用')
    await page.screenshot({ path: info.outputPath('tunnels-page.png') })
    await checkClasses(page)

    // Activated NavRail Identities & Sync Groups page
    await page.getByRole('button', { name: '凭据与分组', exact: true }).click()
    await page.getByPlaceholder('输入分组名称（例如：生产环境 / GPU 集群）').fill('WuXing-Cluster')
    await page.getByRole('button', { name: '添加分组', exact: true }).click()
    await expect(page.getByText('WuXing-Cluster', { exact: true }).first()).toBeVisible()
    await page.screenshot({ path: info.outputPath('identities-page.png') })
    await checkClasses(page)

    // SettingsPage Daoist WuXing-Bagua UI theme switching + TitleBar quick cycler + custom theme
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await expect(page.locator('.container_settings_uitheme_card_base')).toHaveCount(6)
    await page.getByRole('button', { name: /东方青龙/ }).click()
    expect(await page.evaluate(() => document.documentElement.dataset.uiTheme)).toBe('wuxing-mu')
    expect(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--color-accent-primary').trim()
      )
    ).toBe('#34d399')
    await page.screenshot({ path: info.outputPath('settings-wuxing-mu.png') })

    await page.getByRole('button', { name: '切换界面主题配色', exact: true }).click()
    expect(await page.evaluate(() => document.documentElement.dataset.uiTheme)).toBe('wuxing-huo')

    await page.getByRole('button', { name: '启用自定义配色', exact: true }).click()
    expect(await page.evaluate(() => document.documentElement.dataset.uiTheme)).toBe('custom')
    await page.getByRole('button', { name: '恢复默认玄墨古剑', exact: true }).click()
    expect(await page.evaluate(() => document.documentElement.dataset.uiTheme)).toBe('bagua-taiji')
    await checkClasses(page)

    // TerminalPane inline port forwarding & probe drawer
    await page.getByRole('button', { name: '工作台', exact: true }).click()
    await page.screenshot({ path: info.outputPath('welcome-bagua-3d.png') })
    await page.getByRole('button', { name: '打开本地终端', exact: true }).click()
    await expect(page.getByText('运行中', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '端口转发与网络探测', exact: true }).click()
    await page.locator('.container_workspace_terminal_tunnel_probeport').fill(String(boundPort))
    await page.getByRole('button', { name: '测试连通', exact: true }).click()
    await expect(page.locator('.container_workspace_terminal_tunnel_proberes')).toContainText('ms', {
      timeout: 5000
    })
    await page.screenshot({ path: info.outputPath('terminal-tunnel-drawer.png') })
    await checkClasses(page)
    await page.getByRole('button', { name: '关闭标签 Windows PowerShell', exact: true }).click()
  } finally {
    await new Promise<void>((resolve) => tcpProbeServer.close(() => resolve()))
  }
})

test('background system tray icon appears on minimize and restores window cleanly', async ({
  orbit
}, info) => {
  const { app, page } = orbit

  const initialTray = await page.evaluate(() => window.orbit.tray.getState())
  expect(initialTray).toEqual({
    minimizeToTray: true,
    closeToTray: false,
    trayVisibility: 'when-minimized',
    trayCreated: false,
    windowHiddenToTray: false
  })

  // Clicking TitleBar Minimize sends window to background and creates system tray icon
  await page.getByRole('button', { name: '最小化', exact: true }).click()
  await expect
    .poll(async () => page.evaluate(() => window.orbit.tray.getState()))
    .toMatchObject({
      trayCreated: true,
      windowHiddenToTray: true
    })
  const visibleAfterMinimize = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    return win ? win.isVisible() : null
  })
  expect(visibleAfterMinimize).toBe(false)

  // Restore window from tray clears tray icon in when-minimized mode
  await page.evaluate(() => window.orbit.window.restoreFromTray())
  await expect
    .poll(async () => page.evaluate(() => window.orbit.tray.getState()))
    .toMatchObject({
      trayCreated: false,
      windowHiddenToTray: false
    })
  const visibleAfterRestore = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    return win ? win.isVisible() : null
  })
  expect(visibleAfterRestore).toBe(true)

  // Explicit TitleBar "后台托盘" button also minimizes cleanly to system tray
  await page.getByRole('button', { name: '后台托盘', exact: true }).click()
  await expect
    .poll(async () => page.evaluate(() => window.orbit.tray.getState()))
    .toMatchObject({
      trayCreated: true,
      windowHiddenToTray: true
    })
  await page.evaluate(() => window.orbit.window.restoreFromTray())
  await expect
    .poll(async () => page.evaluate(() => window.orbit.tray.getState()))
    .toMatchObject({
      trayCreated: false,
      windowHiddenToTray: false
    })

  // SettingsPage tray preferences toggle "always" visibility via custom OrbitSelect
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '设置', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: '后台运行与系统托盘' })).toBeVisible()
  const trayVisibilityCombo = page.getByRole('combobox', {
    name: '系统托盘图标显示时机',
    exact: true
  })
  await trayVisibilityCombo.click()
  const alwaysOption = page.getByRole('option', { name: '程序运行期间始终显示图标', exact: true })
  await expect(alwaysOption).toBeVisible()
  await page.screenshot({ path: info.outputPath('orbit-select-open.png') })
  await checkClasses(page)
  await alwaysOption.click()
  await expect
    .poll(async () => page.evaluate(() => window.orbit.tray.getState()))
    .toMatchObject({
      trayVisibility: 'always',
      trayCreated: true,
      windowHiddenToTray: false
    })
  await expect(page.locator('.container_settings_tray_header_badge')).toContainText(
    '托盘图标已在右侧工具栏显示'
  )
  await page.screenshot({ path: info.outputPath('settings-tray-background.png') })
  await checkClasses(page)

  // Switching back to when-minimized destroys tray while foregrounded
  await trayVisibilityCombo.click()
  await page.getByRole('option', { name: '仅最小化或收到后台时显示（推荐）', exact: true }).click()
  await expect
    .poll(async () => page.evaluate(() => window.orbit.tray.getState()))
    .toMatchObject({
      trayVisibility: 'when-minimized',
      trayCreated: false,
      windowHiddenToTray: false
    })

  // Also verify WorkspacePage OrbitSelect menu (theme preset with color swatches) renders and switches cleanly
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '工作台', exact: true })
    .click()
  const themeCombo = page.getByRole('combobox', { name: '切换终端配色主题', exact: true })
  await themeCombo.click()
  const tokyoOption = page.getByRole('option', { name: /Tokyo Night/i })
  await expect(tokyoOption).toBeVisible()
  await checkClasses(page)
  await page.screenshot({ path: info.outputPath('workspace-theme-select.png') })
  await tokyoOption.click()
  await expect(themeCombo).toContainText('Tokyo Night')
})

test('checks GitHub releases, downloads verified installer and respects prerelease toggle', async ({}, info) => {
  const server = await startMockUpdateServer()
  const directory = await mkdtemp(join(tmpdir(), 'orbit-update-e2e-'))
  const { app, page } = await launch(directory, {
    ORBIT_UPDATE_FEED_URL: server.url,
    ORBIT_UPDATE_TEST_DRY_INSTALL: '1'
  })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  try {
    await page
      .getByRole('navigation', { name: '主导航' })
      .getByRole('button', { name: '设置', exact: true })
      .click()

    await expect(page.getByRole('heading', { name: '版本演进与 GitHub 自动更新' })).toBeVisible()
    await expect(page.locator('.container_settings_update_meta_grid')).toContainText('1823616178/termius-app')

    await page.getByRole('button', { name: '检查更新', exact: true }).click()
    await expect(page.locator('.container_settings_update_header_badge')).toContainText('发现新版 v0.2.0', {
      timeout: 5000
    })
    await expect(page.locator('.container_settings_update_release_notes')).toContainText('玄墨剑侠主题升级')
    await expect(page.locator('.container_app_window_header_update')).toContainText('新版本 v0.2.0')
    await expect(page.locator('.container_app_status_footer_version')).toContainText('可升级 v0.2.0')

    await page.getByRole('button', { name: /下载更新/ }).click()
    await expect(page.locator('.container_settings_update_header_badge')).toContainText('校验完成 · 待安装', {
      timeout: 5000
    })
    await expect(page.locator('.container_settings_update_release_verified')).toContainText('已校验 SHA256:')
    await expect(page.locator('.container_app_window_header_update')).toContainText('就绪待装 v0.2.0')
    await page.screenshot({ path: info.outputPath('settings-update-ready.png') })
    await checkClasses(page)

    const downloadedBytes = await readFile(join(directory, 'updates', 'Graphite-Orbit-Setup-0.2.0.exe'))
    expect(downloadedBytes.byteLength).toBeGreaterThan(65536)

    const dryInstallOk = await page.evaluate(() => window.orbit.update.installUpdate())
    expect(dryInstallOk).toBe(true)

    // Enable prerelease channel after server exposes v0.3.0-beta.1
    server.setPrereleaseAvailable(true)
    await page.getByLabel('接收预发布测试版（Alpha / Beta / RC）更新提示', { exact: true }).check()
    await expect(page.locator('.container_settings_update_header_badge')).toContainText('v0.3.0-beta.1', {
      timeout: 5000
    })
    await expect(page.locator('.container_settings_update_release_pretag')).toBeVisible()
    expect(errors).toEqual([])
  } finally {
    await stop(app)
    await server.close()
  }
})
