import { test as base, expect, _electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { generateKeyPairSync } from 'node:crypto'
import { Server, type Connection } from 'ssh2'
import { createServer, type AddressInfo } from 'node:net'
import { startMockSyncServer } from '../helpers/mock-sync-server'
import { startMockUpdateServer } from '../helpers/mock-update-server'
import { startMockSftpSshServer } from '../helpers/mock-sftp-server'
import { startMockS3Server } from '../helpers/mock-s3-server'
import { v2 as webdav } from 'webdav-server'
import {
  decryptSyncDocument,
  encryptSyncDocument,
  recoverVaultWithKey
} from '../../src/workers/data-crypto/sync-crypto'
import { normalizeRemoteDocument } from '../../src/workers/data-crypto/sync-merge'

type MotionTestWindow = Window & {
  __motionSceneContexts?: number
  __motionCanvasWrites?: number
  __motionDrawCalls?: number
  __motionDeleteCalls?: number
  __motionSampleReports?: number
}

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

async function enableTerminalTextForAssertions(page: Page) {
  // Accessibility rows expose the same terminal text for both GPU and DOM renderers.
  await page.evaluate(() => localStorage.setItem('orbit:screen-reader', 'true'))
  await page.reload()
  await expect(page.getByText('让连接，井然有序。')).toBeVisible()
}

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

async function instrumentMotionCanvas(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const testWindow = window as MotionTestWindow
    testWindow.__motionCanvasWrites = 0
    testWindow.__motionDrawCalls = 0
    testWindow.__motionDeleteCalls = 0
    for (const key of ['width', 'height'] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, key)
      if (!descriptor?.get || !descriptor.set) continue
      Object.defineProperty(HTMLCanvasElement.prototype, key, {
        configurable: descriptor.configurable,
        enumerable: descriptor.enumerable,
        get: function (this: HTMLCanvasElement) {
          return descriptor.get!.call(this)
        },
        set: function (this: HTMLCanvasElement, value: number) {
          testWindow.__motionCanvasWrites = (testWindow.__motionCanvasWrites ?? 0) + 1
          descriptor.set!.call(this, value)
        }
      })
    }
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args: Parameters<typeof getContext>
    ) {
      const context = getContext.apply(this, args)
      if (args[0] !== 'webgl2' || !context) return context
      const gl = context as unknown as Record<string, unknown>
      for (const method of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
        const original = gl[method]
        if (typeof original !== 'function') continue
        gl[method] = function (this: unknown, ...args: unknown[]) {
          testWindow.__motionDrawCalls = (testWindow.__motionDrawCalls ?? 0) + 1
          return original.apply(this, args)
        }
      }
      for (const method of ['deleteBuffer', 'deleteTexture', 'deleteProgram']) {
        const original = gl[method]
        if (typeof original !== 'function') continue
        gl[method] = function (this: unknown, ...args: unknown[]) {
          testWindow.__motionDeleteCalls = (testWindow.__motionDeleteCalls ?? 0) + 1
          return original.apply(this, args)
        }
      }
      return context
    } as typeof getContext
  })
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

test('titlebar home icon returns to welcome and preserves terminal sessions', async ({ orbit }, info) => {
  const { page } = orbit
  await enableTerminalTextForAssertions(page)
  const home = page.getByRole('button', { name: '返回首页', exact: true })
  await expect(home).toBeVisible()
  expect((await home.textContent())?.trim()).toBe('')
  await expect(home).toHaveAttribute('aria-current', 'page')
  expect(await home.evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region'))).toBe(
    'no-drag'
  )
  await page.getByRole('button', { name: '打开本地终端', exact: true }).click()
  await expect(page.locator('.xterm-accessibility-tree')).toContainText('PS ', { timeout: 15_000 })
  await page.locator('.xterm-helper-textarea').focus()
  await page.keyboard.type('Write-Output ("HOME_" + "PRESERVED")')
  await page.keyboard.press('Enter')
  await expect(page.locator('.xterm-accessibility-tree')).toContainText('HOME_PRESERVED')
  await home.click()
  await expect(page.getByText('让连接，井然有序。')).toBeVisible()
  await expect(page.locator('.xterm')).toHaveCount(1)
  await expect(page.locator('.xterm')).toBeHidden()
  await expect(page.getByRole('tab')).toHaveAttribute('aria-selected', 'false')
  await page.screenshot({ path: info.outputPath('home-with-live-session.png') })
  await checkClasses(page)
  await page.getByRole('tab').click()
  await expect(page.locator('.xterm-accessibility-tree')).toBeVisible()
  await expect(page.locator('.xterm-accessibility-tree')).toContainText('HOME_PRESERVED')
  await home.click()
  await page.getByRole('button', { name: '工作台', exact: true }).click()
  await expect(page.locator('.xterm-accessibility-tree')).toBeVisible()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await home.click()
  await expect(page.getByText('让连接，井然有序。')).toBeVisible()
  await page.keyboard.press('Control+Tab')
  await expect(page.locator('.xterm-accessibility-tree')).toBeVisible()
  await expect(page.locator('.xterm-accessibility-tree')).toContainText('HOME_PRESERVED')
})

test('connections move to the top on use, respect filters and persist after reload', async ({ orbit }) => {
  const { page } = orbit
  const server = await startMockSftpSshServer({ username: 'orbit-test', password: 'RecentPassword!9' })
  try {
    for (const name of ['Alpha', 'Bravo', 'Charlie'])
      await createHost(page, name, server.port, server.password)
    const names = page.locator('.container_hosts_list_row_name')
    await expect(names).toHaveText(['Alpha', 'Bravo', 'Charlie'])
    await page.getByRole('button', { name: '连接 Charlie', exact: true }).click()
    const trust = page.getByRole('dialog', { name: '确认服务器身份' })
    await expect(trust).toBeVisible()
    await expect(trust.getByRole('button', { name: '信任并继续' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByText('运行中', { exact: true })).toHaveCount(1)
    await page.getByRole('button', { name: '返回首页', exact: true }).click()
    await expect(names).toHaveText(['Charlie', 'Alpha', 'Bravo'])
    await page.getByRole('button', { name: '连接 Bravo', exact: true }).click()
    await expect(page.getByText('运行中', { exact: true })).toHaveCount(2)
    await expect(names).toHaveText(['Bravo', 'Charlie', 'Alpha'])
    await page.getByRole('button', { name: '返回首页', exact: true }).click()
    await page.getByRole('tab', { name: /Charlie/ }).click()
    await expect(names).toHaveText(['Charlie', 'Bravo', 'Alpha'])
    await page.getByRole('button', { name: '主机', exact: true }).click()
    await expect(page.locator('.container_hosts_card_body_name')).toHaveText(['Charlie', 'Bravo', 'Alpha'])
    const search = page.getByLabel('搜索主机', { exact: true })
    await search.fill('a')
    await expect(names).toHaveText(['Charlie', 'Bravo', 'Alpha'])
    await search.fill('Bravo')
    await expect(names).toHaveText(['Bravo'])
    await search.clear()
    await page.reload()
    await expect(page.getByText('让连接，井然有序。')).toBeVisible()
    await expect(names).toHaveText(['Charlie', 'Bravo', 'Alpha'])
  } finally {
    await server.close()
  }
})

test('homepage sword realm, border flight, resize and motion tiers', async ({ orbit }, info) => {
  const { page, app } = orbit
  await instrumentMotionCanvas(page)
  await page.reload()
  const stage = page.locator('[data-variant="welcome"]')
  const flight = page.locator('[class*="container_workspace_borderfx_overlay_flight"]')
  await expect(stage).toHaveAttribute('data-ready', 'true')
  const initialDistance = await flight.evaluate((element) => getComputedStyle(element).offsetDistance)
  await expect
    .poll(() => flight.evaluate((element) => getComputedStyle(element).offsetDistance))
    .not.toBe(initialDistance)

  const sceneState = page.locator('.container_workspace_welcome_body_scene-state')
  await page.getByRole('button', { name: '即刻归宗', exact: true }).click()
  await expect(sceneState).toContainText(/诛仙剑阵/)
  await page.waitForTimeout(1000)
  await page.screenshot({ path: info.outputPath('sword-climax.png') })

  const rail = page.locator('.container_workspace_welcome_body_formrail')
  await expect(rail).toBeVisible()
  await expect(rail.locator('button')).toHaveCount(12)
  await rail.locator('button').nth(9).click()
  await expect(sceneState).toContainText('九宫八卦剑阵')
  await expect(rail.locator('button').nth(9)).toHaveAttribute('data-active', 'true')
  await page.waitForTimeout(600)
  await page.screenshot({ path: info.outputPath('sword-jiugong.png') })
  await rail.locator('button').nth(0).click()
  await expect(sceneState).toContainText('诛仙剑阵')

  await page.getByRole('button', { name: '重展剑境', exact: true }).click()
  await expect(sceneState).toContainText('开阵启封')
  await page.waitForTimeout(720)
  await page.screenshot({ path: info.outputPath('sword-intro.png') })
  await expect(sceneState).toContainText(/万剑分身|凌虚归阵/)
  await page.screenshot({ path: info.outputPath('sword-intro-clones.png') })

  const initialPath = await flight.getAttribute('style')
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]!.setSize(1100, 700)
  })
  await expect.poll(() => flight.getAttribute('style')).not.toBe(initialPath)
  await expect(stage).toHaveAttribute('data-ready', 'true')
  await page.screenshot({ path: info.outputPath('sword-resized.png') })

  await page.getByRole('button', { name: '设置', exact: true }).click()
  await expect(page.getByRole('combobox', { name: '动效与性能档' })).toContainText('自动（推荐）')
  await expect(page.locator('.container_settings_motion_body_status')).toContainText('当前：完整动效')
  await page.getByRole('combobox', { name: '动效与性能档' }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('motion-auto-settings.png') })
  await page.getByRole('combobox', { name: '动效与性能档' }).click()
  await page.getByRole('option', { name: '轻量', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'light')
  await page.getByRole('button', { name: '工作台', exact: true }).click()
  await expect(stage).toHaveAttribute('data-ready', 'true')
  await expect(stage.locator('canvas')).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => (window as MotionTestWindow).__motionDrawCalls))
    .toBeGreaterThan(0)
  const deletedBeforeOff = await page.evaluate(() => (window as MotionTestWindow).__motionDeleteCalls ?? 0)

  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('combobox', { name: '动效与性能档' }).click()
  await page.getByRole('option', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '工作台', exact: true }).click()
  await expect(stage.locator('img')).toBeVisible()
  await expect(stage.locator('canvas')).toBeHidden()
  await expect(flight).toBeHidden()
  await expect(page.getByRole('button', { name: '即刻归宗', exact: true })).toBeHidden()
  await expect
    .poll(() => page.evaluate(() => (window as MotionTestWindow).__motionDeleteCalls))
    .toBeGreaterThan(deletedBeforeOff)
  const stoppedDrawCalls = await page.evaluate(() => (window as MotionTestWindow).__motionDrawCalls)
  await page.waitForTimeout(350)
  expect(await page.evaluate(() => (window as MotionTestWindow).__motionDrawCalls)).toBe(stoppedDrawCalls)
  expect(
    await stage.locator('canvas').evaluate((canvas) => {
      const gl = (canvas as HTMLCanvasElement).getContext('webgl2')
      return gl?.isContextLost() ?? true
    })
  ).toBe(false)

  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('combobox', { name: '动效与性能档' }).click()
  await page.getByRole('option', { name: '强制开启', exact: true }).click()
  await expect(page.locator('.container_settings_motion_body_status')).toContainText('强制开启')
  await expect(page.locator('.container_settings_motion_body_warning')).toBeVisible()
  await page.screenshot({ path: info.outputPath('motion-forced-settings.png') })
  await page.getByRole('button', { name: '工作台', exact: true }).click()
  await expect(stage).toHaveAttribute('data-ready', 'true')
  await expect(flight).toBeVisible()
  await expect(page.getByRole('button', { name: '即刻归宗', exact: true })).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => (window as MotionTestWindow).__motionDrawCalls))
    .toBeGreaterThan(stoppedDrawCalls!)
})

test('motion performance healthy samples do not reset drawing buffers', async ({ orbit }) => {
  const { page } = orbit
  await page.addInitScript(() => {
    // Isolate sampling side effects from the test machine's actual GPU speed.
    let timestamp = performance.now()
    window.requestAnimationFrame = (callback: FrameRequestCallback): number =>
      window.setTimeout(() => callback((timestamp += 1000 / 60)), 0)
    window.cancelAnimationFrame = (handle: number) => window.clearTimeout(handle)
  })
  await instrumentMotionCanvas(page)
  await page.reload()
  await expect(page.locator('[data-variant="welcome"]')).toHaveAttribute('data-ready', 'true')
  await page.evaluate(() => {
    ;(window as MotionTestWindow).__motionSampleReports = 0
    new MutationObserver(() => {
      ;(window as MotionTestWindow).__motionSampleReports =
        ((window as MotionTestWindow).__motionSampleReports ?? 0) + 1
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion-reason'] })
  })
  await expect
    .poll(() => page.evaluate(() => (window as MotionTestWindow).__motionSampleReports), { timeout: 20_000 })
    .toBeGreaterThan(0)
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'full')
  const readCanvasState = () =>
    page.locator('[data-variant="welcome"] canvas').evaluate((canvas) => ({
      width: (canvas as HTMLCanvasElement).width,
      height: (canvas as HTMLCanvasElement).height,
      writes: (window as MotionTestWindow).__motionCanvasWrites
    }))
  const before = await readCanvasState()
  const samples = await page.evaluate(() => (window as MotionTestWindow).__motionSampleReports)
  await expect
    .poll(() => page.evaluate(() => (window as MotionTestWindow).__motionSampleReports), { timeout: 20_000 })
    .toBeGreaterThan(samples!)
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'full')
  expect(await readCanvasState()).toEqual(before)
})

test('motion performance saved off never creates a WebGL scene during startup', async ({ orbit }) => {
  const { page } = orbit
  await page.addInitScript(() => {
    localStorage.setItem('orbit:motion-tier', 'off')
    ;(window as MotionTestWindow).__motionSceneContexts = 0
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args: Parameters<typeof getContext>
    ) {
      if (args[0] === 'webgl2' && this.isConnected) {
        ;(window as MotionTestWindow).__motionSceneContexts =
          ((window as MotionTestWindow).__motionSceneContexts ?? 0) + 1
      }
      return getContext.apply(this, args)
    } as typeof getContext
  })
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'off')
  await page.waitForLoadState('networkidle')
  expect(
    await page.evaluate(() => ({
      sceneContexts: (window as MotionTestWindow).__motionSceneContexts
    }))
  ).toEqual({ sceneContexts: 0 })
})

test('motion performance detects weak graphics and persists force override', async ({ orbit }) => {
  const { page } = orbit
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      configurable: true,
      get: () => Number(localStorage.getItem('orbit:test-motion-cores') ?? 16)
    })
    ;(window as MotionTestWindow).__motionSceneContexts = 0
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args: Parameters<typeof getContext>
    ) {
      if (args[0] === 'webgl2' && this.isConnected) {
        ;(window as MotionTestWindow).__motionSceneContexts =
          ((window as MotionTestWindow).__motionSceneContexts ?? 0) + 1
      }
      const context = getContext.apply(this, args)
      if (args[0] === 'webgl2' && context) {
        const gl = context as WebGL2RenderingContext
        const getParameter = gl.getParameter.bind(gl)
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
        gl.getParameter = (parameter: number) =>
          debugInfo && parameter === debugInfo.UNMASKED_RENDERER_WEBGL
            ? localStorage.getItem('orbit:test-motion-software') === 'hardware'
              ? 'ANGLE (NVIDIA, GeForce RTX Test GPU)'
              : 'ANGLE (Google, SwiftShader Device (Subzero))'
            : getParameter(parameter)
      }
      return context
    } as typeof getContext
  })
  await page.reload()
  const stage = page.locator('[data-variant="welcome"]')
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'off')
  await expect(stage.locator('img')).toBeVisible()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await expect(page.locator('.container_settings_motion_body_status')).toContainText('软件渲染器')
  await page.waitForLoadState('networkidle')
  expect(
    await page.evaluate(() => ({
      sceneContexts: (window as MotionTestWindow).__motionSceneContexts
    }))
  ).toEqual({ sceneContexts: 0 })
  await page.getByRole('combobox', { name: '动效与性能档' }).click()
  await page.getByRole('option', { name: '强制开启', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'full')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'full')
  await expect(stage).toHaveAttribute('data-ready', 'true')
  await expect(stage.locator('canvas')).toBeVisible()
  const forcedFlight = page.locator('[class*="container_workspace_borderfx_overlay_flight"]')
  await expect(forcedFlight).toBeVisible()
  const forcedDistance = await forcedFlight.evaluate((element) => getComputedStyle(element).offsetDistance)
  await expect
    .poll(() => forcedFlight.evaluate((element) => getComputedStyle(element).offsetDistance))
    .not.toBe(forcedDistance)
  await expect(page.getByRole('button', { name: '即刻归宗', exact: true })).toBeVisible()

  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('combobox', { name: '动效与性能档' }).click()
  await page.getByRole('option', { name: '自动（推荐）', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'off')
  await expect(page.locator('.container_settings_motion_body_status')).toContainText('减少动态效果')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.evaluate(() => {
    localStorage.setItem('orbit:test-motion-cores', '2')
    localStorage.setItem('orbit:test-motion-software', 'hardware')
  })
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'off')
  await expect(page.locator('html')).toHaveAttribute('data-motion-preference', 'auto')
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await expect(page.locator('.container_settings_motion_body_status')).toContainText('资源不足')
  await page.evaluate(() => localStorage.setItem('orbit:test-motion-cores', '16'))
  await page.getByRole('button', { name: '重新检测动效性能', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'full')
  await expect(page.locator('html')).toHaveAttribute('data-motion-preference', 'auto')
  await page.getByRole('button', { name: '工作台', exact: true }).click()
  await expect(stage).toHaveAttribute('data-ready', 'true')
  expect(await page.evaluate(() => (window as MotionTestWindow).__motionSceneContexts)).toBeGreaterThan(0)
})

test('motion performance uses sustained real frame rate but never overrides force', async ({ orbit }) => {
  const { page } = orbit
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, get: () => 16 })
    window.requestAnimationFrame = (callback: FrameRequestCallback): number =>
      window.setTimeout(() => callback(performance.now()), 70)
    window.cancelAnimationFrame = (handle: number) => window.clearTimeout(handle)
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args: Parameters<typeof getContext>
    ) {
      const context = getContext.apply(this, args)
      if (args[0] === 'webgl2' && context) {
        const gl = context as WebGL2RenderingContext
        const getParameter = gl.getParameter.bind(gl)
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
        gl.getParameter = (parameter: number) =>
          debugInfo && parameter === debugInfo.UNMASKED_RENDERER_WEBGL
            ? 'ANGLE (NVIDIA, GeForce RTX Test GPU)'
            : getParameter(parameter)
      }
      return context
    } as typeof getContext
  })
  await page.reload()
  await expect(page.locator('[data-variant="welcome"]')).toHaveAttribute('data-ready', 'true')
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'light', { timeout: 15_000 })
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'off', { timeout: 15_000 })
  await expect(page.locator('[data-variant="welcome"] img')).toBeVisible()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await expect(page.locator('.container_settings_motion_body_status')).toContainText('帧率持续偏低')
  await page.getByRole('combobox', { name: '动效与性能档' }).click()
  await page.getByRole('option', { name: '轻量', exact: true }).click()
  await page.getByRole('button', { name: '工作台', exact: true }).click()
  await expect(page.locator('[data-variant="welcome"]')).toHaveAttribute('data-ready', 'true')
  await page.waitForTimeout(6800)
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'light')

  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('combobox', { name: '动效与性能档' }).click()
  await page.getByRole('option', { name: '强制开启', exact: true }).click()
  await page.getByRole('button', { name: '工作台', exact: true }).click()
  await expect(page.locator('[data-variant="welcome"]')).toHaveAttribute('data-ready', 'true')
  await page.waitForTimeout(6800)
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'full')

  await page.getByRole('button', { name: '设置', exact: true }).click()
  const previousGeneration = Number(await page.locator('html').getAttribute('data-motion-generation'))
  await page.getByRole('combobox', { name: '动效与性能档' }).click()
  await page.getByRole('option', { name: '自动（推荐）', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'full')
  const nextGeneration = Number(await page.locator('html').getAttribute('data-motion-generation'))
  expect(nextGeneration).toBeGreaterThan(previousGeneration)
  await page.getByRole('button', { name: '工作台', exact: true }).click()
  await page.waitForTimeout(500)
  await expect(page.locator('html')).toHaveAttribute('data-motion-reason', /初检通过/)
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'light', { timeout: 15_000 })
})

test('sword animation resumes after context loss and motion preference changes', async ({ orbit }) => {
  const { page } = orbit
  const stage = page.locator('[data-variant="welcome"]')
  const phase = page.locator('.container_workspace_welcome_body_scene-state')
  await expect(stage).toHaveAttribute('data-ready', 'true')
  // Check real rendered pixels, not only the ready flag or button-driven phase changes.
  const firstFrame = await stage.locator('canvas').screenshot()
  await expect.poll(async () => (await stage.locator('canvas').screenshot()).equals(firstFrame)).toBe(false)

  await stage.locator('canvas').evaluate((element) => {
    const canvas = element as HTMLCanvasElement & { restoreTestContext?: () => void }
    const gl = canvas.getContext('webgl2')!
    const extension = gl.getExtension('WEBGL_lose_context')!
    canvas.restoreTestContext = () => extension.restoreContext()
    extension.loseContext()
  })
  await expect(stage).toHaveAttribute('data-ready', 'false')
  await expect(phase).toContainText('图形连接中断')
  await stage.locator('canvas').evaluate((element) => {
    ;(element as HTMLCanvasElement & { restoreTestContext: () => void }).restoreTestContext()
  })
  await expect(stage).toHaveAttribute('data-ready', 'true')
  const restoredFrame = await stage.locator('canvas').screenshot()
  await expect
    .poll(async () => (await stage.locator('canvas').screenshot()).equals(restoredFrame))
    .toBe(false)
  const runningFrame = await stage.locator('canvas').screenshot()
  await expect.poll(async () => (await stage.locator('canvas').screenshot()).equals(runningFrame)).toBe(false)
  await page.getByRole('button', { name: '重展剑境', exact: true }).click()
  await expect(phase).toContainText('万剑分身')

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(stage.locator('canvas')).toBeHidden()
  await expect(phase).toContainText('系统已开启减少动态效果')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect(stage).toHaveAttribute('data-ready', 'true')
  await expect(stage.locator('canvas')).toBeVisible()
  await page.getByRole('button', { name: '即刻归宗', exact: true }).click()
  await expect(phase).toContainText('诛仙剑阵')
})

test('sword initialization failure can be retried from the homepage', async ({ orbit }) => {
  const { page } = orbit
  await page.addInitScript(() => {
    localStorage.setItem('orbit:motion-tier', 'full')
    const getContext = HTMLCanvasElement.prototype.getContext
    let failOnce = true
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args: Parameters<typeof getContext>
    ) {
      if (args[0] === 'webgl2' && failOnce) {
        failOnce = false
        throw new Error('Simulated transient graphics initialization failure')
      }
      return getContext.apply(this, args)
    } as typeof getContext
  })
  await page.reload()
  const stage = page.locator('[data-variant="welcome"]')
  const phase = page.locator('.container_workspace_welcome_body_scene-state')
  await expect(phase).toContainText('剑境加载失败')
  await expect(stage.locator('img')).toBeVisible()
  await page.getByRole('button', { name: '重展剑境', exact: true }).click()
  await expect(stage).toHaveAttribute('data-ready', 'true')
  await expect(phase).toContainText('万剑分身')
})

test('terminal uses hardware WebGL when available and keeps the session after context loss', async ({
  orbit
}) => {
  const { page } = orbit
  const hardware = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2')
    if (!gl) return false
    const debug = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = String(gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER))
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return !/swiftshader|llvmpipe|softpipe|lavapipe|software|basic render/i.test(renderer)
  })
  const glyphFonts = await page.evaluateHandle(() => {
    const fonts = new Set<string>()
    for (const context of [CanvasRenderingContext2D, OffscreenCanvasRenderingContext2D]) {
      const fillText = context.prototype.fillText
      context.prototype.fillText = function (...args: Parameters<typeof fillText>) {
        fonts.add(this.font)
        fillText.apply(this, args)
      }
    }
    return fonts
  })
  await page.getByRole('button', { name: '打开本地终端', exact: true }).click()
  await expect(page.getByText('运行中', { exact: true })).toBeVisible()
  if (hardware) {
    const canvas = page.locator('.xterm-screen > canvas').last()
    await expect(canvas).toBeVisible()
    // Check the actual font used to rasterize glyphs, not just the terminal options.
    await expect
      .poll(() =>
        glyphFonts.evaluate((fonts) => {
          const size = `${14 * devicePixelRatio}px`
          return ['', '600 '].every((weight) =>
            [...fonts].some(
              (font) => font.startsWith(weight + size + ' ') && font.includes('Orbit JetBrains Mono')
            )
          )
        })
      )
      .toBe(true)
    const settings = page.getByRole('button', { name: '设置', exact: true })
    const workspace = page.getByRole('button', { name: '工作台', exact: true })
    const acceleration = page.getByRole('checkbox', { name: '启用终端 GPU 加速' })
    await settings.click()
    await page.getByTestId('settings-tab-ssh').click()
    await expect(acceleration).toBeChecked()
    await acceleration.uncheck()
    await expect(canvas).toHaveCount(0)
    await workspace.click()
    await expect(page.locator('.xterm-rows')).toContainText('PS ', { timeout: 15_000 })
    await page.locator('.xterm-helper-textarea').focus()
    await page.keyboard.type('Write-Output ("GPU_" + "SWITCH")')
    await page.keyboard.press('Enter')
    await expect(page.locator('.xterm-rows')).toContainText('GPU_SWITCH')
    await settings.click()
    await page.getByTestId('settings-tab-ssh').click()
    await acceleration.check()
    await workspace.click()
    await expect(canvas).toBeVisible()
    await canvas.evaluate((el) =>
      (el as HTMLCanvasElement).getContext('webgl2')!.getExtension('WEBGL_lose_context')!.loseContext()
    )
  }
  await expect(page.locator('.xterm-rows')).toContainText('PS ', { timeout: 15_000 })
  await page.locator('.xterm-helper-textarea').focus()
  await page.keyboard.type('Write-Output ("FALLBACK_" + "READY")')
  await page.keyboard.press('Enter')
  await expect(page.locator('.xterm-rows')).toContainText('FALLBACK_READY')
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByTestId('settings-tab-ssh').click()
  await page.getByRole('checkbox', { name: '启用终端 GPU 加速' }).uncheck()
  await page.reload()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByTestId('settings-tab-ssh').click()
  await expect(page.getByRole('checkbox', { name: '启用终端 GPU 加速' })).not.toBeChecked()
  await page.getByRole('button', { name: '返回首页', exact: true }).click()
  await page.getByRole('button', { name: '打开本地终端', exact: true }).click()
  await expect(page.locator('.xterm-rows')).toContainText('PS ', { timeout: 15_000 })
  await expect(page.locator('.xterm-screen > canvas')).toHaveCount(0)
})

test('real PowerShell and CMD, split resize, terminal input and lifecycle cleanup', async ({
  orbit
}, info) => {
  const { page, app } = orbit
  await enableTerminalTextForAssertions(page)
  const initial = await page.evaluate(() => window.orbit.bootstrap())
  expect(initial.shells.some((profile) => profile.id === 'powershell')).toBe(true)
  expect(initial.shells.some((profile) => profile.id === 'cmd')).toBe(true)
  await page.getByRole('button', { name: '打开本地终端', exact: true }).click()
  await expect(page.getByText('运行中', { exact: true })).toHaveCount(1)
  await expect(page.locator('.xterm-accessibility-tree').first()).toContainText('PS ', { timeout: 15_000 })
  const terminal = page.locator('.xterm-helper-textarea').first()
  await terminal.focus()
  await page.keyboard.type('Write-Output ("ORBIT_" + "LOCAL_READY")')
  await page.keyboard.press('Enter')
  await expect(page.locator('.xterm-accessibility-tree').first()).toContainText('ORBIT_LOCAL_READY')
  await page.keyboard.type('Write-Output ("ORBIT_PID:" + $PID)')
  await page.keyboard.press('Enter')
  await expect(page.locator('.xterm-accessibility-tree').first()).toContainText(/ORBIT_PID:\d+/)
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
    (await page.locator('.xterm-accessibility-tree').first().innerText()).match(/ORBIT_PID:(\d+)/)![1]
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
    await expect(page.locator('.xterm-accessibility-tree').first()).not.toContainText('PASTE_PREVIEW_ONE')
    await page.keyboard.press('Escape')
    await expect(terminal).toBeFocused()
    await expect(page.locator('.xterm-accessibility-tree').first()).not.toContainText('PASTE_PREVIEW_ONE')
    await page.keyboard.press('Control+Shift+V')
    await expect(pastePreview.getByRole('button', { name: '确认粘贴', exact: true })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(pastePreview).toHaveCount(0)
    await expect(terminal).toBeFocused()
    await expect(page.locator('.xterm-accessibility-tree').first()).toContainText('PASTE_PREVIEW_TWO')
    await page.keyboard.press('Control+c')
    await app.evaluate(({ clipboard }) => clipboard.writeText('Write-Output ("PASTE_" + "ONCE")'))
    await terminal.focus()
    await page.keyboard.press('Control+Shift+V')
    await page.keyboard.press('Enter')
    await expect(page.locator('.xterm-accessibility-tree').first()).toContainText('PASTE_ONCE')
    expect(
      (await page.locator('.xterm-accessibility-tree').first().innerText()).match(/PASTE_ONCE/g)
    ).toHaveLength(1)
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
  await expect(page.locator('.xterm-accessibility-tree').last()).toContainText('ORBIT_CMD_READY')
  await page.keyboard.type('exit')
  await page.keyboard.press('Enter')
  await expect(page.getByText('已退出', { exact: true })).toBeVisible()
  await page.locator('.xterm-helper-textarea').last().focus()
  await page.keyboard.press('Control+Shift+W')
  await expect(page.locator('.xterm-accessibility-tree').first()).not.toContainText('^W')
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
  await enableTerminalTextForAssertions(page)
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
    await expect(page.locator('.xterm-accessibility-tree')).toContainText('ORBIT_SSH_READY 中文')
    await page.locator('.xterm-helper-textarea').focus()
    await page.keyboard.type('ssh-roundtrip')
    await expect(page.locator('.xterm-accessibility-tree')).toContainText('ssh-roundtrip')
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
    await expect(page.locator('.xterm-accessibility-tree')).toContainText('ORBIT_SSH_RETRY_OK')
    await page.getByRole('button', { name: '关闭标签 密码重试服务器', exact: true }).click()

    // Subsequent connection succeeds without prompt when the updated password was saved
    if (canSavePassword) {
      await page.getByRole('button', { name: '连接 密码重试服务器', exact: true }).click()
      await expect(page.locator('.xterm-accessibility-tree')).toContainText('ORBIT_SSH_RETRY_OK')
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

    // Verify non-loopback HTTP shows plaintext risk warning and blocks submit until opted in
    await page.getByRole('button', { name: '注册新账号', exact: true }).click()
    await page.getByPlaceholder('https://sync.example.com').fill('http://192.168.10.20:8080')
    await expect(page.locator('.container_sync_account_body_http-warn')).toBeVisible()
    await expect(page.locator('.container_sync_account_body_insecure-check')).not.toBeChecked()
    await checkClasses(page)
    await page.getByPlaceholder('name@example.com').fill(email)
    await page.locator('.container_sync_account_body_password-input').fill('AccountPass123!')
    await page.getByRole('button', { name: '注册并连接', exact: true }).click()
    await expect(page.locator('.container_sync_alert_body_error-text')).toContainText('HTTPS')

    // Register new account with loopback server URL and keepSignedIn checked
    await page.getByPlaceholder('https://sync.example.com').fill(server.url)
    await expect(page.locator('.container_sync_account_body_http-warn')).toHaveCount(0)
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
  await enableTerminalTextForAssertions(page)
  await page.getByRole('button', { name: '打开本地终端', exact: true }).click()
  await expect(page.getByText('运行中', { exact: true })).toHaveCount(1)
  await expect(page.locator('.xterm-accessibility-tree').first()).toContainText('PS ', { timeout: 15_000 })
  const firstTerminal = page.locator('.xterm-helper-textarea').first()
  await firstTerminal.focus()
  await page.keyboard.type('Write-Output ("TAB_ONE_" + "KEEP")')
  await page.keyboard.press('Enter')
  await expect(page.locator('.xterm-accessibility-tree').first()).toContainText('TAB_ONE_KEEP')

  // Returning a tab to its own terminal is a no-op, never a new session.
  await page
    .locator('.container_workspace_tabs_header_item')
    .dragTo(page.locator('.container_workspace_panes_body_pane'), { targetPosition: { x: 120, y: 120 } })
  await expect(page.getByRole('tab')).toHaveCount(1)
  await expect(page.locator('.xterm-accessibility-tree')).toHaveCount(1)
  await expect(page.locator('.container_workspace_split_overlay_base')).toBeHidden()

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
  await expect(page.locator('.xterm-accessibility-tree').last()).toContainText('TAB_TWO_KEEP')

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

  // Drag the selected second tab: the first workspace must become the drop target automatically.
  await page.getByRole('tab', { name: /命令提示符/ }).click()
  await cmdTabItem.dragTo(page.locator('.container_workspace_stage_body_panes'), {
    targetPosition: { x: Math.round(paneBox.width * 0.82), y: Math.round(paneBox.height * 0.5) }
  })

  await expect(page.getByRole('tab')).toHaveCount(1)
  await expect(page.locator('.container_workspace_tabs_header_split-badge')).toContainText('2分屏')
  await expect(page.locator('.xterm-accessibility-tree')).toHaveCount(2)
  await expect(page.locator('.xterm-accessibility-tree').nth(0)).toContainText('TAB_ONE_KEEP')
  await expect(page.locator('.xterm-accessibility-tree').nth(1)).toContainText('TAB_TWO_KEEP')
  await page.screenshot({ path: info.outputPath('drag-split-docked.png') })
  await checkClasses(page)

  // A pane dropped back on its owning tab stays in that split.
  await paneArea
    .locator('.container_workspace_terminal_header_base')
    .last()
    .dragTo(page.locator('.container_workspace_tabs_header_item'), { sourcePosition: { x: 80, y: 16 } })
  await expect(page.getByRole('tab')).toHaveCount(1)
  await expect(page.locator('.xterm-accessibility-tree')).toHaveCount(2)

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
  await expect(page.locator('.xterm-accessibility-tree').nth(0)).toContainText('TAB_TWO_KEEP')
  await expect(page.locator('.xterm-accessibility-tree').nth(1)).toContainText('TAB_ONE_KEEP')
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
  await expect(page.locator('.xterm-accessibility-tree').nth(0)).toContainText('TAB_ONE_KEEP')
  await expect(page.locator('.xterm-accessibility-tree').nth(1)).toContainText('TAB_TWO_KEEP')

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
  await expect(page.locator('.xterm-accessibility-tree').nth(0)).toContainText('TAB_TWO_KEEP')
  await expect(page.locator('.xterm-accessibility-tree').nth(1)).toContainText('TAB_ONE_KEEP')
  await checkClasses(page)

  await page.getByRole('button', { name: '关闭标签 命令提示符', exact: true }).click()
  await page.getByRole('button', { name: '关闭标签 Windows PowerShell', exact: true }).click()
  await expect(page.getByText('让连接，井然有序。')).toBeVisible()
})

test('selected tab drag previews adjacent and hovered terminals and restores selection on cancel', async ({
  orbit
}) => {
  const { page } = orbit
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: '新建本地会话', exact: true }).click()
  }
  const tabItems = page.locator('.container_workspace_tabs_header_item')
  const tabButtons = page.getByRole('tab')
  await expect(tabButtons).toHaveCount(3)

  // The last tab falls back to its left neighbor; dragging over another tab switches targets.
  await tabItems.nth(2).dispatchEvent('dragstart')
  await expect(tabButtons.nth(1)).toHaveAttribute('aria-selected', 'true')
  await tabItems.nth(0).dispatchEvent('dragover')
  await expect(tabButtons.nth(0)).toHaveAttribute('aria-selected', 'true')
  const paneArea = page.locator('.container_workspace_panes_body_base:visible')
  await paneArea.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    el.dispatchEvent(
      new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width * 0.5,
        clientY: rect.top + rect.height * 0.1
      })
    )
  })
  await expect(paneArea.locator('.container_workspace_split_overlay_base')).toHaveAttribute(
    'data-zone',
    'top'
  )
  await tabItems.nth(2).dispatchEvent('dragend')
  await expect(tabButtons.nth(2)).toHaveAttribute('aria-selected', 'true')
  await expect(tabButtons).toHaveCount(3)
  await expect(page.locator('.xterm')).toHaveCount(3)

  // Other tabs prefer their right neighbor and cancellation keeps the original selection.
  await tabButtons.nth(0).click()
  await tabItems.nth(0).dispatchEvent('dragstart')
  await expect(tabButtons.nth(1)).toHaveAttribute('aria-selected', 'true')
  await tabItems.nth(0).dispatchEvent('dragend')
  await expect(tabButtons.nth(0)).toHaveAttribute('aria-selected', 'true')

  // Dragging an inactive tab does not replace the already visible target.
  await tabItems.nth(2).dispatchEvent('dragstart')
  await expect(tabButtons.nth(0)).toHaveAttribute('aria-selected', 'true')
  await tabItems.nth(2).dispatchEvent('dragend')
  await expect(tabButtons.nth(0)).toHaveAttribute('aria-selected', 'true')
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
    await page.locator('.container_workspace_terminal_tunnel_lport').fill(String(freePort))
    await page.getByRole('button', { name: '添加转发', exact: true }).click()
    await expect(page.locator('.container_workspace_terminal_tunnel_list')).toContainText(
      `终端转发-L-${freePort}`
    )
    await page.screenshot({ path: info.outputPath('terminal-tunnel-drawer.png') })
    await checkClasses(page)
    await page.getByRole('button', { name: `删除 终端转发-L-${freePort}`, exact: true }).click()
    await expect(page.locator('.container_workspace_terminal_tunnel_list')).not.toContainText(
      `终端转发-L-${freePort}`
    )
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
    closeAction: 'quit',
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
  await expect(page.locator('.container_settings_tray_header_badge')).toContainText('托盘图标已显示')
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

  // Close button behavior selector: quit vs tray vs taskbar minimize
  const closeGroup = page.getByRole('radiogroup', { name: '点击关闭按钮时的行为', exact: true })
  await expect(closeGroup).toBeVisible()
  const quitRadio = closeGroup.getByRole('radio', { name: /彻底关闭程序/ })
  const trayRadio = closeGroup.getByRole('radio', { name: /最小化到后台托盘/ })
  const taskbarRadio = closeGroup.getByRole('radio', { name: /最小化到任务栏/ })
  await expect(quitRadio).toHaveAttribute('aria-checked', 'true')

  // 1) Tray mode: clicking TitleBar close (×) hides window to system tray instead of exiting
  await trayRadio.click()
  await expect(trayRadio).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click()
  await expect
    .poll(async () => page.evaluate(() => window.orbit.tray.getState()))
    .toMatchObject({
      closeAction: 'tray',
      closeToTray: true,
      trayCreated: true,
      windowHiddenToTray: true
    })
  await page.evaluate(() => window.orbit.window.restoreFromTray())
  await expect
    .poll(async () => page.evaluate(() => window.orbit.tray.getState()))
    .toMatchObject({ windowHiddenToTray: false })

  // 2) Taskbar mode: clicking TitleBar close (×) minimizes window to OS taskbar even with minimizeToTray=true
  await taskbarRadio.click()
  await expect(taskbarRadio).toHaveAttribute('aria-checked', 'true')
  await expect
    .poll(async () => page.evaluate(() => window.orbit.tray.getState()))
    .toMatchObject({
      closeAction: 'minimize',
      closeToTray: false
    })
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click()
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMinimized() ?? false))
    .toBe(true)
  expect(await page.evaluate(() => window.orbit.tray.getState()).then((s) => s.windowHiddenToTray)).toBe(
    false
  )
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win?.restore()
    win?.focus()
  })
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMinimized() ?? true))
    .toBe(false)

  // 3) Reset back to quit mode and verify persisted selection + layout
  await quitRadio.click()
  await expect(quitRadio).toHaveAttribute('aria-checked', 'true')
  await expect
    .poll(async () => page.evaluate(() => window.orbit.tray.getState()))
    .toMatchObject({
      closeAction: 'quit',
      closeToTray: false
    })
  await page.screenshot({ path: info.outputPath('settings-close-behavior.png') })
  await checkClasses(page)

  // 4) Quit mode: clicking TitleBar close (×) in a clean window exits the app cleanly
  const quitDir = await mkdtemp(join(tmpdir(), 'orbit-close-quit-'))
  const launchedQuit = await launch(quitDir)
  try {
    const closePromise = launchedQuit.app.waitForEvent('close', { timeout: 10_000 })
    await launchedQuit.page.getByRole('button', { name: '关闭窗口', exact: true }).click()
    await closePromise
  } finally {
    await stop(launchedQuit.app)
    await rm(quitDir, { recursive: true, force: true })
  }

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
    await expect(page.locator('.container_settings_update_header_badge')).toContainText(
      `发现新版 v${server.stableVersion}`,
      {
        timeout: 5000
      }
    )
    await expect(page.locator('.container_settings_update_release_notes')).toContainText('玄墨剑侠主题升级')
    await expect(page.locator('.container_app_window_header_update')).toContainText(
      `新版本 v${server.stableVersion}`
    )
    await expect(page.locator('.container_app_status_footer_version')).toContainText(
      `可升级 v${server.stableVersion}`
    )

    await page.getByRole('button', { name: /下载更新/ }).click()
    await expect(page.locator('.container_settings_update_header_badge')).toContainText('校验完成 · 待安装', {
      timeout: 5000
    })
    await expect(page.locator('.container_settings_update_release_verified')).toContainText('已校验 SHA256:')
    await expect(page.locator('.container_app_window_header_update')).toContainText(
      `就绪待装 v${server.stableVersion}`
    )
    await page.screenshot({ path: info.outputPath('settings-update-ready.png') })
    await checkClasses(page)

    const downloadedBytes = await readFile(
      join(directory, 'updates', `Graphite-Orbit-Setup-${server.stableVersion}.exe`)
    )
    expect(downloadedBytes.byteLength).toBeGreaterThan(65536)

    const dryInstallOk = await page.evaluate(() => window.orbit.update.installUpdate())
    expect(dryInstallOk).toBe(true)

    // Enable prerelease channel after server exposes prereleaseVersion
    server.setPrereleaseAvailable(true)
    await page.getByLabel('接收预发布测试版（Alpha / Beta / RC）更新提示', { exact: true }).check()
    await expect(page.locator('.container_settings_update_header_badge')).toContainText(
      `v${server.prereleaseVersion}`,
      {
        timeout: 5000
      }
    )
    await expect(page.locator('.container_settings_update_release_pretag')).toBeVisible()
    expect(errors).toEqual([])
  } finally {
    await stop(app)
    await server.close()
  }
})

test('terminal right-side SFTP drawer browses, uploads, downloads, chmods, renames and deletes over live SSH', async ({}, info) => {
  const sftpServer = await startMockSftpSshServer({
    username: 'orbit-test',
    password: 'SftpPassword!9'
  })
  const appDir = await mkdtemp(join(tmpdir(), 'orbit-sftp-app-'))
  const localTransferDir = await mkdtemp(join(tmpdir(), 'orbit-sftp-local-'))
  const localUploadFile = join(localTransferDir, 'upload-bundle.bin')
  const localDownloadFile = join(localTransferDir, 'downloaded-notes.txt')
  const uploadPayload = Buffer.concat([
    Buffer.from('ORBIT_SFTP_UPLOAD_HEADER\n', 'utf8'),
    Buffer.alloc(160 * 1024, 0x5a),
    Buffer.from('\nORBIT_SFTP_UPLOAD_TAIL', 'utf8')
  ])
  await writeFile(localUploadFile, uploadPayload)

  const { app, page } = await launch(appDir)
  await enableTerminalTextForAssertions(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  try {
    await page.getByRole('button', { name: '主机', exact: true }).click()
    await createHost(page, 'SFTP文件服务器', sftpServer.port, sftpServer.password)
    await page.getByRole('button', { name: '连接 SFTP文件服务器', exact: true }).click()

    const trust = page.getByRole('dialog', { name: '确认服务器身份' })
    await expect(trust).toBeVisible()
    await trust.getByRole('button', { name: '信任并继续' }).click()

    await expect(page.getByText('运行中', { exact: true })).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('.xterm-accessibility-tree').first()).toContainText('orbit@mock-sftp:~$')

    await page.getByRole('button', { name: '打开 SFTP 文件面板', exact: true }).click()
    const sftpAside = page.getByRole('complementary', { name: 'SFTP 文件管理', exact: true })
    await expect(sftpAside).toBeVisible()
    await expect(page.locator('.container_workspace_stage_body_sftp-dock')).not.toHaveClass(/motion_active/)

    // Verify SFTP panel docks cleanly to the right of the terminal pane
    const terminalBox = await page.locator('.container_workspace_stage_body_panes').boundingBox()
    const sftpBox = await sftpAside.boundingBox()
    expect(terminalBox).not.toBeNull()
    expect(sftpBox).not.toBeNull()
    expect(sftpBox!.x).toBeGreaterThanOrEqual(terminalBox!.x + terminalBox!.width - 4)

    await expect(sftpAside.getByText('readme.txt', { exact: true })).toBeVisible({ timeout: 10_000 })
    await expect(sftpAside.getByText('projects', { exact: true })).toBeVisible()
    await expect(sftpAside.getByText('.env', { exact: true })).toBeHidden()

    // Terminal drags must not advertise file uploads.
    await sftpAside.evaluate((el) => {
      const dataTransfer = new DataTransfer()
      dataTransfer.setData('text/plain', 'terminal-tab')
      el.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }))
    })
    await expect(sftpAside.locator('.container_workspace_sftp_drop_overlay')).toBeHidden()

    const panelToggle = page.getByRole('button', { name: 'SFTP 文件传输', exact: true })
    await panelToggle.click()
    await expect(sftpAside).toBeHidden()
    await panelToggle.click()
    await expect(sftpAside.getByText('readme.txt', { exact: true })).toBeVisible()
    const resizer = page.getByRole('separator', { name: '调整 SFTP 面板宽度' })
    const widthBefore = Number(await resizer.getAttribute('aria-valuenow'))
    await resizer.press('ArrowLeft')
    await expect(resizer).toHaveAttribute('aria-valuenow', String(widthBefore + 24))

    await sftpAside.getByRole('button', { name: '显示隐藏文件', exact: true }).click()
    await expect(sftpAside.getByText('.env', { exact: true })).toBeVisible()
    await sftpAside.getByRole('button', { name: '显示隐藏文件', exact: true }).click()
    await expect(sftpAside.getByText('.env', { exact: true })).toBeHidden()

    // Navigate into subdirectory and back via home/breadcrumb
    await sftpAside.getByText('projects', { exact: true }).dblclick()
    await expect(sftpAside.getByText('deploy.sh', { exact: true })).toBeVisible()
    await sftpAside.getByRole('button', { name: '主目录', exact: true }).click()
    await expect(sftpAside.getByText('readme.txt', { exact: true })).toBeVisible()

    // Create remote directory
    await sftpAside.getByRole('button', { name: '新建远端文件夹', exact: true }).click()
    await sftpAside.getByLabel('新建文件夹名称', { exact: true }).fill('release-build')
    await sftpAside.getByRole('button', { name: '创建', exact: true }).click()
    await expect(sftpAside.getByText('release-build', { exact: true })).toBeVisible()
    const createdDirStat = await stat(join(sftpServer.homeDir, 'release-build'))
    expect(createdDirStat.isDirectory()).toBe(true)

    // Rename remote file
    await sftpAside.getByRole('button', { name: '重命名 readme.txt', exact: true }).click()
    await sftpAside.getByLabel('重命名文件名', { exact: true }).fill('notes.txt')
    await sftpAside.getByRole('button', { name: '确定', exact: true }).click()
    await expect(sftpAside.getByText('notes.txt', { exact: true })).toBeVisible()
    await expect(sftpAside.getByText('readme.txt', { exact: true })).toBeHidden()

    // Chmod via context menu
    await sftpAside.getByText('notes.txt', { exact: true }).click({ button: 'right' })
    await sftpAside.getByRole('button', { name: '修改权限 (chmod)', exact: true }).click()
    const modeInput = sftpAside.getByLabel('八进制权限', { exact: true })
    await expect(modeInput).toBeFocused()
    await modeInput.fill('0750')
    await page.keyboard.press('Enter')
    await expect(
      sftpAside.locator('[class*="container_workspace_sftp_row_item"]').filter({ hasText: 'notes.txt' })
    ).toContainText('0750')

    // Stub Electron dialogs in main process for deterministic real upload/download testing
    await app.evaluate(
      ({ dialog }, paths) => {
        dialog.showOpenDialog = (async () => ({
          canceled: false,
          filePaths: [paths.uploadPath]
        })) as typeof dialog.showOpenDialog
        dialog.showSaveDialog = (async () => ({
          canceled: false,
          filePath: paths.downloadPath
        })) as typeof dialog.showSaveDialog
      },
      { uploadPath: localUploadFile, downloadPath: localDownloadFile }
    )

    // Real SFTP upload
    await sftpAside.getByRole('button', { name: '上传文件', exact: true }).click()
    const queue = sftpAside.getByRole('region', { name: 'SFTP 传输队列', exact: true })
    const uploadQueueItem = queue
      .locator('[class*="container_workspace_sftp_queue_item"]')
      .filter({ hasText: 'upload-bundle.bin' })
    await expect(uploadQueueItem).toContainText('已完成 ·', { timeout: 15_000 })
    await expect(
      sftpAside
        .locator('[class*="container_workspace_sftp_row_item"]')
        .filter({ hasText: 'upload-bundle.bin' })
    ).toBeVisible({ timeout: 10_000 })
    const remoteUploaded = await readFile(join(sftpServer.homeDir, 'upload-bundle.bin'))
    expect(remoteUploaded.equals(uploadPayload)).toBe(true)

    // Real OS drag-and-drop upload via CDP Input.dispatchDragEvent (verifies File[] + webUtils.getPathForFile)
    const localDragDropFile = join(localTransferDir, 'drag-drop-note.txt')
    await writeFile(localDragDropFile, 'ORBIT_SFTP_DRAG_DROP_OK\n', 'utf8')
    const sftpCenterBox = await sftpAside.boundingBox()
    expect(sftpCenterBox).not.toBeNull()
    const dropX = Math.round(sftpCenterBox!.x + sftpCenterBox!.width / 2)
    const dropY = Math.round(sftpCenterBox!.y + sftpCenterBox!.height / 2)
    const cdp = await page.context().newCDPSession(page)
    try {
      const dragData = {
        items: [],
        files: [localDragDropFile],
        dragOperationsMask: 1
      }
      await cdp.send('Input.dispatchDragEvent', { type: 'dragEnter', x: dropX, y: dropY, data: dragData })
      await cdp.send('Input.dispatchDragEvent', { type: 'dragOver', x: dropX, y: dropY, data: dragData })
      await expect(sftpAside.locator('.container_workspace_sftp_drop_overlay')).toBeVisible()
      await cdp.send('Input.dispatchDragEvent', { type: 'drop', x: dropX, y: dropY, data: dragData })
    } finally {
      await cdp.detach().catch(() => {})
    }
    await expect(sftpAside.locator('.container_workspace_sftp_drop_overlay')).toBeHidden()
    await expect(page.getByText(/未能解析拖入的本地文件路径/)).toHaveCount(0)
    await expect(
      sftpAside
        .locator('[class*="container_workspace_sftp_row_item"]')
        .filter({ hasText: 'drag-drop-note.txt' })
    ).toBeVisible({ timeout: 10_000 })
    expect(await readFile(join(sftpServer.homeDir, 'drag-drop-note.txt'), 'utf8')).toBe(
      'ORBIT_SFTP_DRAG_DROP_OK\n'
    )

    // Real OS directory drag-and-drop via CDP also resolves local folder and uploads recursively
    const localDragDropDir = join(localTransferDir, 'drag-drop-dir')
    await mkdir(localDragDropDir)
    await writeFile(join(localDragDropDir, 'nested.txt'), 'ORBIT_SFTP_DIR_DROP_OK\n', 'utf8')
    const dirCdp = await page.context().newCDPSession(page)
    try {
      const dirDragData = { items: [], files: [localDragDropDir], dragOperationsMask: 1 }
      await dirCdp.send('Input.dispatchDragEvent', {
        type: 'dragEnter',
        x: dropX,
        y: dropY,
        data: dirDragData
      })
      await dirCdp.send('Input.dispatchDragEvent', {
        type: 'dragOver',
        x: dropX,
        y: dropY,
        data: dirDragData
      })
      await expect(sftpAside.locator('.container_workspace_sftp_drop_overlay')).toBeVisible()
      await dirCdp.send('Input.dispatchDragEvent', { type: 'drop', x: dropX, y: dropY, data: dirDragData })
    } finally {
      await dirCdp.detach().catch(() => {})
    }
    await expect(sftpAside.locator('.container_workspace_sftp_drop_overlay')).toBeHidden()
    await expect(page.getByText(/未能解析拖入的本地文件路径/)).toHaveCount(0)
    await expect
      .poll(() => readFile(join(sftpServer.homeDir, 'drag-drop-dir', 'nested.txt'), 'utf8').catch(() => ''), {
        timeout: 15_000
      })
      .toBe('ORBIT_SFTP_DIR_DROP_OK\n')

    // Real SFTP download
    await sftpAside.getByRole('button', { name: '下载 notes.txt', exact: true }).click()
    const downloadQueueItem = queue
      .locator('[class*="container_workspace_sftp_queue_item"]')
      .filter({ hasText: 'notes.txt' })
    await expect(downloadQueueItem).toContainText('已完成 ·', { timeout: 15_000 })
    await expect
      .poll(async () => await readFile(localDownloadFile, 'utf8').catch(() => ''), { timeout: 15_000 })
      .toBe('Hello Orbit SFTP\nLine 2\n')

    await checkClasses(page)
    await page.screenshot({ path: info.outputPath('sftp-panel.png') })

    // Delete created directory
    await sftpAside.getByRole('button', { name: '删除 release-build', exact: true }).click()
    const deleteDialog = sftpAside.getByRole('dialog', { name: '确认删除远端项目', exact: true })
    await expect(deleteDialog).toBeVisible()
    await deleteDialog.getByRole('button', { name: '确认删除', exact: true }).click()
    await expect(sftpAside.getByText('release-build', { exact: true })).toBeHidden()
    expect(await readdir(sftpServer.homeDir)).not.toContain('release-build')

    expect(errors).toEqual([])
  } finally {
    await stop(app)
    await sftpServer.close()
    await rm(appDir, { recursive: true, force: true })
    await rm(localTransferDir, { recursive: true, force: true })
  }
})

test('all twelve sword formations support orbit, zoom and reset', async ({ orbit }, info) => {
  test.setTimeout(120_000)
  const { page } = orbit
  await page.evaluate(() => localStorage.setItem('orbit:motion-tier', 'full'))
  await page.reload()
  const stage = page.locator('[data-variant="welcome"]')
  await expect(stage).toHaveAttribute('data-ready', 'true')
  const rail = page.locator('.container_workspace_welcome_body_formrail button')
  await expect(rail).toHaveCount(12)
  const box = await stage.boundingBox()
  expect(box).not.toBeNull()
  const x = box!.x + box!.width * 0.76
  const y = box!.y + box!.height * 0.56
  for (let i = 0; i < 12; i++) {
    await rail.nth(i).click()
    await expect(rail.nth(i)).toHaveAttribute('data-active', 'true')
    await page.mouse.dblclick(x, y)
    await page.waitForTimeout(350)
    await page.screenshot({ path: info.outputPath(`formation-${i + 1}-front.png`) })
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x - 145, y - 28, { steps: 16 })
    await expect(stage).toHaveAttribute('data-dragging', 'true')
    await page.mouse.up()
    await expect(stage).toHaveAttribute('data-dragging', 'false')
    await page.waitForTimeout(350)
    await expect(stage).toHaveAttribute('data-ready', 'true')
    await page.screenshot({ path: info.outputPath(`formation-${i + 1}-orbit.png`) })
  }
  await page.mouse.wheel(0, -240)
  await page.waitForTimeout(300)
  await page.screenshot({ path: info.outputPath('formation-zoom.png') })
  await page.mouse.dblclick(x, y)
  await expect(stage).toHaveAttribute('data-ready', 'true')
})

test('hero sword tip tilts independently, clamps safely, cancels and resets after orbit and resize', async ({
  orbit
}, info) => {
  const { page, app } = orbit
  await page.evaluate(() => localStorage.setItem('orbit:motion-tier', 'full'))
  await page.reload()
  const stage = page.locator('[data-variant="welcome"]')
  await expect(stage).toHaveAttribute('data-ready', 'true')
  await page.getByRole('button', { name: '切换至春黎剑阵', exact: true }).click()
  const tip = page.getByRole('button', { name: '调整主剑倾斜度', exact: true })
  await expect(tip).toBeVisible()
  const angle = async () => Number(await tip.getAttribute('data-tilt'))
  const defaultAngle = await angle()
  expect(await tip.evaluate((el) => getComputedStyle(el).transitionProperty)).not.toContain('transform')
  expect(defaultAngle).toBeGreaterThan(15)
  expect(defaultAngle).toBeLessThan(35)
  await checkClasses(page)
  await page.screenshot({ path: info.outputPath('hero-default-tilt.png') })

  const start = (await tip.boundingBox())!
  const startX = start.x + start.width / 2
  const startY = start.y + start.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await expect(stage).toHaveAttribute('data-adjusting-sword', 'true')
  await page.mouse.move(startX + 110, startY + 25, { steps: 14 })
  await expect.poll(angle).toBeGreaterThan(defaultAngle + 8)
  await page.mouse.up()
  await expect(stage).toHaveAttribute('data-adjusting-sword', 'false')
  const adjustedAngle = await angle()
  await page.screenshot({ path: info.outputPath('hero-tip-dragged.png') })

  // Formation switches retain the adjustment rather than replacing the main sword.
  await page.getByRole('button', { name: '切换至九宫八卦剑阵', exact: true }).click()
  expect(Math.abs((await angle()) - adjustedAngle)).toBeLessThan(8)
  const next = (await tip.boundingBox())!
  await page.mouse.move(next.x + 18, next.y + 18)
  await page.mouse.down()
  await expect(stage).toHaveAttribute('data-adjusting-sword', 'true')
  await page.mouse.move(next.x + 280, next.y + 460, { steps: 12 })
  await expect.poll(angle).toBeGreaterThanOrEqual(64.5)
  expect(await angle()).toBeLessThanOrEqual(65.1)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(stage).toHaveAttribute('data-adjusting-sword', 'false')
  await expect.poll(angle).toBeLessThan(60)

  // Keyboard adjustment and double-click restore work on the tip itself.
  await tip.focus()
  const beforeKey = await angle()
  await tip.press('Shift+ArrowRight')
  await expect.poll(async () => Math.abs((await angle()) - beforeKey)).toBeGreaterThan(1)
  const reset = (await tip.boundingBox())!
  await page.mouse.dblclick(reset.x + 18, reset.y + 18)
  await expect.poll(angle).toBeLessThan(35)

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1100, 720))
  const bounds = (await stage.boundingBox())!
  const x = bounds.x + bounds.width * 0.8
  const y = bounds.y + bounds.height * 0.65
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - 65, y - 20, { steps: 12 })
  await expect(stage).toHaveAttribute('data-adjusting-sword', 'false')
  await page.mouse.up()
  await page.mouse.wheel(0, -120)
  // Let the resize, orbit inertia and zoom settle before picking the moving tip.
  await page.waitForTimeout(650)
  await expect(tip).toBeVisible()
  const sideTip = (await tip.boundingBox())!
  await page.mouse.move(sideTip.x + 18, sideTip.y + 18)
  await page.mouse.down()
  await expect(stage).toHaveAttribute('data-adjusting-sword', 'true')
  await page.mouse.move(sideTip.x + 75, sideTip.y + 30, { steps: 10 })
  await page.mouse.up()
  await expect(stage).toHaveAttribute('data-ready', 'true')
  await page.screenshot({ path: info.outputPath('hero-tilt-side-resized.png') })
})

test('workspace tab bar scrolls horizontally on overflow without showing a vertical scrollbar', async ({
  orbit
}, info) => {
  const { page } = orbit
  const addTabBtn = page.getByRole('button', { name: '新建本地会话', exact: true })
  for (let i = 0; i < 8; i++) {
    await addTabBtn.click()
  }
  await expect(page.getByRole('tab')).toHaveCount(8)

  const tabBarMetrics = await page.evaluate(() => {
    const el = document.querySelector('.container_workspace_tabs_header_list') as HTMLElement
    const cs = getComputedStyle(el)
    return {
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      overflowX: cs.overflowX,
      overflowY: cs.overflowY
    }
  })

  expect(tabBarMetrics.overflowX).toBe('auto')
  expect(tabBarMetrics.overflowY).toBe('hidden')
  expect(tabBarMetrics.scrollWidth).toBeGreaterThan(tabBarMetrics.clientWidth)
  expect(tabBarMetrics.scrollHeight).toBeLessThanOrEqual(tabBarMetrics.clientHeight)

  await expect(page.getByRole('button', { name: '向左滚动页签' })).toBeEnabled()
  await expect(page.getByRole('button', { name: '向右滚动页签' })).toBeDisabled()
  await page.keyboard.press('Control+Tab')
  await expect(page.getByRole('tab').first()).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('button', { name: '向左滚动页签' })).toBeDisabled()
  await page.getByRole('button', { name: '向右滚动页签' }).click()
  await expect(page.getByRole('button', { name: '向左滚动页签' })).toBeEnabled()
  const bounds = await page.evaluate(() => {
    const header = document.querySelector('.container_workspace_tabs_header_base')!.getBoundingClientRect()
    const action = document.querySelector('.container_workspace_tabs_header_sftp')!.getBoundingClientRect()
    return { headerRight: header.right, actionRight: action.right, viewport: window.innerWidth }
  })
  expect(bounds.headerRight).toBeLessThanOrEqual(bounds.viewport)
  expect(bounds.actionRight).toBeLessThanOrEqual(bounds.headerRight)

  // Verify mouse wheel vertical delta scrolls tab bar horizontally when overflowing
  const tabListBox = await page.locator('.container_workspace_tabs_header_list').boundingBox()
  expect(tabListBox).not.toBeNull()
  await page.mouse.move(tabListBox!.x + tabListBox!.width / 2, tabListBox!.y + tabListBox!.height / 2)
  await page.mouse.wheel(0, 180)
  await expect
    .poll(() =>
      page.evaluate(
        () => (document.querySelector('.container_workspace_tabs_header_list') as HTMLElement).scrollLeft
      )
    )
    .toBeGreaterThan(0)

  await page.screenshot({ path: info.outputPath('tabbar-overflow.png') })
  await orbit.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(960, 720))
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(960)
  const narrowBounds = await page.evaluate(() => {
    const header = document.querySelector('.container_workspace_tabs_header_base')!.getBoundingClientRect()
    const list = document.querySelector('.container_workspace_tabs_header_list')!.getBoundingClientRect()
    const action = document.querySelector('.container_workspace_tabs_header_sftp')!.getBoundingClientRect()
    return {
      headerRight: header.right,
      listWidth: list.width,
      actionRight: action.right,
      viewport: innerWidth
    }
  })
  expect(narrowBounds.listWidth).toBeGreaterThan(120)
  expect(narrowBounds.headerRight).toBeLessThanOrEqual(narrowBounds.viewport)
  expect(narrowBounds.actionRight).toBeLessThanOrEqual(narrowBounds.headerRight)
  await page.screenshot({ path: info.outputPath('tabbar-narrow.png') })
  await checkClasses(page)
})

test('terminal recognizes links with hover underline, pointer cursor and clickable tooltip', async ({
  orbit
}) => {
  const { page, app } = orbit
  // This test inspects DOM spans and their underline styling on the fallback renderer.
  await page.evaluate(() => {
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args: Parameters<typeof getContext>
    ) {
      return args[0] === 'webgl2' ? null : getContext.apply(this, args)
    } as typeof getContext
  })
  await page.getByRole('button', { name: '打开本地终端', exact: true }).click()
  await expect(page.getByText('运行中', { exact: true })).toHaveCount(1)
  await expect(page.locator('.xterm-rows').first()).toContainText('PS ', { timeout: 15_000 })

  const terminalInput = page.locator('.xterm-helper-textarea').first()
  await terminalInput.focus()
  await page.keyboard.type('Write-Output ("LINK1 " + "https://example.com/" + "orbit-docs，完成")')
  await page.keyboard.press('Enter')
  await expect(page.locator('.xterm-rows').first()).toContainText('https://example.com/orbit-docs', {
    timeout: 15_000
  })

  await page.keyboard.type('Write-Output ("LINK2 " + "localhost:5173/" + "panel")')
  await page.keyboard.press('Enter')
  await expect(page.locator('.xterm-rows').first()).toContainText('localhost:5173/panel', {
    timeout: 15_000
  })

  const locateTerminalSubstring = async (rowMatch: string, needle = rowMatch) =>
    page.evaluate(
      ({ rowNeedle, target }) => {
        const rows = document.querySelectorAll('.xterm-rows > div')
        for (const row of rows) {
          if (!(row.textContent ?? '').includes(rowNeedle)) continue
          const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
          let node = walker.nextNode()
          while (node) {
            const text = node.textContent ?? ''
            const idx = text.indexOf(target)
            if (idx !== -1) {
              const range = document.createRange()
              range.setStart(node, idx)
              range.setEnd(node, idx + target.length)
              const rect = range.getBoundingClientRect()
              if (rect.width > 0 && rect.height > 0) {
                return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
              }
            }
            node = walker.nextNode()
          }
        }
        return null
      },
      { rowNeedle: rowMatch, target: needle }
    )

  const link1Pos = await locateTerminalSubstring('https://example.com/orbit-docs', 'orbit-docs')
  expect(link1Pos).not.toBeNull()

  await app.evaluate(({ dialog }) => {
    const g = globalThis as {
      __origShowMessageBox?: typeof dialog.showMessageBox
      __openedLinkPrompts?: Array<{ title?: string; detail?: string }>
    }
    g.__origShowMessageBox = dialog.showMessageBox.bind(dialog)
    g.__openedLinkPrompts = []
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const options = (args.length >= 2 ? args[1] : args[0]) as { title?: string; detail?: string }
      g.__openedLinkPrompts!.push({ title: options.title, detail: options.detail })
      return { response: 0, checkboxChecked: false }
    }) as typeof dialog.showMessageBox
  })

  try {
    await page.mouse.move(link1Pos!.x, link1Pos!.y)
    await expect(page.locator('.xterm .xterm-cursor-pointer')).toHaveCount(1)
    const link1Style = await page.evaluate(({ x, y }) => {
      const target = document.elementFromPoint(x, y) as HTMLElement | null
      const linkRow = [...document.querySelectorAll('.xterm-rows > div')].find((row) =>
        (row.textContent ?? '').includes('https://example.com/orbit-docs')
      )
      const linkSpan = linkRow
        ? ([...linkRow.querySelectorAll('span')].find((el) =>
            (el.textContent ?? '').includes('orbit-docs')
          ) as HTMLElement | undefined)
        : undefined
      return {
        cursor: target ? getComputedStyle(target).cursor : '',
        underline: linkSpan ? getComputedStyle(linkSpan).textDecorationLine : '',
        thickness: linkSpan ? getComputedStyle(linkSpan).textDecorationThickness : ''
      }
    }, link1Pos!)
    expect(link1Style.cursor).toBe('pointer')
    expect(link1Style.underline).toContain('underline')
    expect(link1Style.thickness).toBe('1.5px')

    const hoverTip = page.locator('.xterm .xterm-hover.xterm-link-preview')
    await expect(hoverTip).toBeVisible()
    await expect(hoverTip).toContainText('https://example.com/orbit-docs')
    await expect(hoverTip).toContainText('可点击打开')
    await checkClasses(page)

    await hoverTip.click()
    await expect
      .poll(() =>
        app.evaluate(
          () => (globalThis as { __openedLinkPrompts?: Array<{ detail?: string }> }).__openedLinkPrompts
        )
      )
      .toEqual([{ title: '打开外部链接？', detail: 'https://example.com/orbit-docs' }])

    // Moving off link clears pointer cursor, underline, and tooltip
    await page.mouse.move(4, 4)
    await expect(page.locator('.xterm .xterm-cursor-pointer')).toHaveCount(0)
    await expect(hoverTip).toBeHidden()

    // Bare localhost:port link is also recognized and clickable directly on the terminal cell
    const link2Pos = await locateTerminalSubstring('localhost:5173/panel')
    expect(link2Pos).not.toBeNull()
    await page.mouse.move(link2Pos!.x, link2Pos!.y)
    await expect(page.locator('.xterm .xterm-cursor-pointer')).toHaveCount(1)
    await expect(hoverTip).toBeVisible()
    await expect(hoverTip).toContainText('http://localhost:5173/panel')

    await page.mouse.click(link2Pos!.x, link2Pos!.y)
    await expect
      .poll(() =>
        app.evaluate(
          () => (globalThis as { __openedLinkPrompts?: Array<{ detail?: string }> }).__openedLinkPrompts
        )
      )
      .toEqual([
        { title: '打开外部链接？', detail: 'https://example.com/orbit-docs' },
        { title: '打开外部链接？', detail: 'http://localhost:5173/panel' }
      ])
  } finally {
    await app.evaluate(({ dialog }) => {
      const g = globalThis as {
        __origShowMessageBox?: typeof dialog.showMessageBox
        __openedLinkPrompts?: unknown
      }
      if (g.__origShowMessageBox) {
        dialog.showMessageBox = g.__origShowMessageBox
        delete g.__origShowMessageBox
      }
      delete g.__openedLinkPrompts
    })
  }
})

test('bilingual zh/en switch, separate terminal/panel typography & color settings, and select-to-copy', async ({
  orbit
}, info) => {
  const { page, app } = orbit
  await enableTerminalTextForAssertions(page)

  // 1. Default Simplified Chinese UI + quick language toggle in TitleBar
  await expect(page.getByText('玄剑天枢 · Graphite Orbit')).toBeVisible()
  await page.getByTestId('titlebar-lang-toggle').click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US')
  await expect(page.getByText('Connections, Effortlessly Aligned.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible()

  // Navigate to Settings and verify language radio cards + 3 protocol domains sync cleanly
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByTestId('lang-card-en-US')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('settings-domain-tabs')).toBeVisible()
  await expect(page.getByTestId('panel-typography-section')).toBeVisible()
  await checkClasses(page)

  // 2. Panel typography & custom text color live on General tab, completely independent from Terminal
  const panelSection = page.getByTestId('panel-typography-section')
  await expect(page.getByTestId('terminal-typography-section')).toHaveCount(0)

  await panelSection.getByRole('combobox', { name: 'Panel Body Font' }).click()
  await checkClasses(page)
  await page.getByRole('option', { name: /LXGW WenKai \(CJK\)/ }).click()

  await panelSection.locator('input[type="range"]').first().fill('16')
  const primaryColorHex = panelSection.locator('.container_settings_typo_pcswatch_phex')
  await primaryColorHex.fill('#ffe6a7')
  await expect
    .poll(() =>
      page.evaluate(() => ({
        uiFont: getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim(),
        uiSize: getComputedStyle(document.documentElement).getPropertyValue('--font-ui-size').trim(),
        uiColor: getComputedStyle(document.documentElement).getPropertyValue('--color-text-primary').trim()
      }))
    )
    .toMatchObject({
      uiSize: '16px',
      uiColor: '#ffe6a7'
    })
  const uiFontApplied = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--font-ui')
  )
  expect(uiFontApplied).toContain('Orbit LXGW WenKai')

  const panelCopyCheck = panelSection.getByRole('checkbox', {
    name: /Copy panel text to clipboard automatically on selection/i
  })
  await panelCopyCheck.check()
  await expect(panelCopyCheck).toBeChecked()

  // Switch to SSH & Terminal domain and configure independent Terminal font, size, colors, and copy-on-select
  await page.getByTestId('settings-tab-ssh').click()
  const terminalSection = page.getByTestId('terminal-typography-section')
  await expect(terminalSection).toBeVisible()
  await expect(panelSection).toHaveCount(0)
  await checkClasses(page)

  await terminalSection.getByRole('combobox', { name: 'Terminal Font' }).click()
  await page.getByRole('option', { name: /Maple Mono/ }).click()
  await terminalSection.locator('input[type="range"]').first().fill('17')
  await terminalSection.locator('.container_settings_typo_tcswatch_fghex').fill('#a6e22e')
  await terminalSection.locator('.container_settings_typo_tcswatch_bghex').fill('#101820')

  // Verify Panel font & size did NOT get overwritten by Terminal changes
  const uiAfterTermChange = await page.evaluate(() => ({
    uiFont: getComputedStyle(document.documentElement).getPropertyValue('--font-ui'),
    uiSize: getComputedStyle(document.documentElement).getPropertyValue('--font-ui-size').trim()
  }))
  expect(uiAfterTermChange.uiFont).toContain('Orbit LXGW WenKai')
  expect(uiAfterTermChange.uiSize).toBe('16px')

  const termCopyCheck = terminalSection.getByRole('checkbox', {
    name: /Copy terminal text automatically on selection/i
  })
  await termCopyCheck.check()
  await expect(termCopyCheck).toBeChecked()

  // Return to General tab so Panel Live Preview is visible for drag-select copy check
  await page.getByTestId('settings-tab-general').click()

  await app.evaluate(({ clipboard }) => {
    const g = globalThis as { __origWriteText?: typeof clipboard.writeText; __clipboardWrites?: string[] }
    g.__origWriteText = clipboard.writeText.bind(clipboard)
    g.__clipboardWrites = []
    clipboard.writeText = ((text: string) => {
      g.__clipboardWrites!.push(text)
      return g.__origWriteText!(text)
    }) as typeof clipboard.writeText
  })

  try {
    // Test Panel select-to-copy by dragging across text inside Panel Live Preview box
    const panelBodyText = panelSection.locator('.container_settings_typo_ppreview_body')
    await panelBodyText.scrollIntoViewIfNeeded()
    const bodyBox = await panelBodyText.boundingBox()
    expect(bodyBox).not.toBeNull()
    await page.mouse.move(bodyBox!.x + 12, bodyBox!.y + 12)
    await page.mouse.down()
    await page.mouse.move(bodyBox!.x + Math.min(220, bodyBox!.width - 12), bodyBox!.y + 12, { steps: 6 })
    await page.mouse.up()
    await expect
      .poll(() =>
        app.evaluate(
          () => (globalThis as { __clipboardWrites?: string[] }).__clipboardWrites?.slice(-1)[0] ?? ''
        )
      )
      .not.toBe('')

    await page.screenshot({ path: info.outputPath('settings-typography-en.png') })

    // Open a local terminal and verify terminal renders custom colors + drag-end select-to-copy copies once
    await page.getByRole('button', { name: 'Home', exact: true }).click()
    await page.getByRole('button', { name: 'Open Local Terminal', exact: true }).click()
    await expect(page.getByText('Running', { exact: true })).toBeVisible()
    const termTextLocator = page.locator('.xterm-accessibility-tree, .xterm-rows').first()
    await expect(termTextLocator).toContainText('PS ', { timeout: 15_000 })
    const paneBg = await page
      .locator('.container_workspace_terminal_root_base')
      .first()
      .evaluate((el) => getComputedStyle(el).getPropertyValue('--pane-terminal-bg').trim())
    expect(paneBg).toBe('#101820')

    await page.locator('.xterm-helper-textarea').focus()
    await page.keyboard.type('Write-Output ("CLIP_" + "MARKER")')
    await page.keyboard.press('Enter')
    await expect(termTextLocator).toContainText('CLIP_MARKER', { timeout: 10_000 })

    // Drag across the row containing CLIP_MARKER and release: should copy once on pointerup
    const targetBox = await page.evaluate(() => {
      const candidates = [
        ...document.querySelectorAll('.xterm-accessibility-tree [role="listitem"]'),
        ...document.querySelectorAll('.xterm-rows > div')
      ]
      const row = candidates.find((r) => (r.textContent ?? '').includes('CLIP_MARKER'))
      if (!row) return null
      const rect = row.getBoundingClientRect()
      const screenRect = document.querySelector('.xterm-screen')?.getBoundingClientRect()
      const maxWidth = screenRect ? Math.max(120, screenRect.right - rect.left - 8) : 340
      const width = Math.min(maxWidth, 340)
      return { x: rect.left, y: rect.top + rect.height / 2, width }
    })
    expect(targetBox).not.toBeNull()
    const writesBeforeDrag = await app.evaluate(
      () => ((globalThis as { __clipboardWrites?: string[] }).__clipboardWrites ?? []).length
    )
    await page.mouse.move(targetBox!.x + 4, targetBox!.y)
    await page.mouse.down()
    await page.mouse.move(targetBox!.x + targetBox!.width, targetBox!.y, { steps: 8 })
    // Mid-drag should NOT spam clipboard!
    const writesMidDrag = await app.evaluate(
      () => ((globalThis as { __clipboardWrites?: string[] }).__clipboardWrites ?? []).length
    )
    expect(writesMidDrag).toBe(writesBeforeDrag)
    await page.mouse.up()
    await expect
      .poll(() =>
        app.evaluate(
          () => (globalThis as { __clipboardWrites?: string[] }).__clipboardWrites?.slice(-1)[0] ?? ''
        )
      )
      .toContain('CLIP_MARKER')
    await expect(page.locator('.container_app_status_footer_copied')).toBeVisible()

    // Reload app and confirm persisted en-US locale, fonts, colors, and copy-on-select checkboxes
    await page.reload()
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(page.getByTestId('lang-card-en-US')).toHaveAttribute('aria-checked', 'true')
    await expect(panelCopyCheck).toBeChecked()
    await expect(panelSection.getByRole('combobox', { name: 'Panel Body Font' })).toContainText('LXGW WenKai')
    await page.getByTestId('settings-tab-ssh').click()
    await expect(termCopyCheck).toBeChecked()
    await expect(terminalSection.getByRole('combobox', { name: 'Terminal Font' })).toContainText('Maple Mono')
  } finally {
    await app.evaluate(({ clipboard }) => {
      const g = globalThis as { __origWriteText?: typeof clipboard.writeText; __clipboardWrites?: unknown }
      if (g.__origWriteText) {
        clipboard.writeText = g.__origWriteText
        delete g.__origWriteText
      }
      delete g.__clipboardWrites
    })
  }
})

test('standalone multi-protocol Files page (SFTP, WebDAV, S3) and protocol-scoped Settings persist end-to-end', async ({}, info) => {
  const davRoot = await mkdtemp(join(tmpdir(), 'orbit-e2e-dav-'))
  const sftpServer = await startMockSftpSshServer({
    username: 'orbit-test',
    password: 'SftpFilesPass!1'
  })
  const s3Server = await startMockS3Server()
  const appDir = await mkdtemp(join(tmpdir(), 'orbit-files-e2e-'))
  const localTransferDir = await mkdtemp(join(tmpdir(), 'orbit-files-local-'))
  const sampleFile = join(localTransferDir, 'e2e-upload.txt')
  const sampleBytes = Buffer.from('ORBIT_V110_FILES_PAGE_CONTENT', 'utf8')
  await writeFile(sampleFile, sampleBytes)

  const userManager = new webdav.SimpleUserManager()
  const davUser = userManager.addUser('davuser', 'DavE2ePass!88', false)
  const privilegeManager = new webdav.SimplePathPrivilegeManager()
  privilegeManager.setRights(davUser, '/', ['all'])
  const davServer = new webdav.WebDAVServer({
    port: 0,
    httpAuthentication: new webdav.HTTPBasicAuthentication(userManager, 'OrbitE2E'),
    privilegeManager
  })
  await new Promise<void>((resolve, reject) => {
    davServer.setFileSystem('/', new webdav.PhysicalFileSystem(davRoot), (ok) =>
      ok ? resolve() : reject(new Error('WebDAV init failed'))
    )
  })
  const davHttp = await new Promise<{ address(): { port: number } }>((resolve) => {
    davServer.start((srv) => resolve(srv as unknown as { address(): { port: number } }))
  })
  const davUrl = `http://127.0.0.1:${davHttp.address().port}`

  const { app, page } = await launch(appDir)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  try {
    // 0. Version badge reports v1.1.0
    await expect(page.locator('.container_app_status_footer_version')).toContainText('v1.1.0')

    // 1. Settings domain separation & persistence (SSH defaults + Files concurrency/S3 defaults)
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByTestId('settings-tab-ssh').click()
    const sshSec = page.getByTestId('ssh-protocol-settings-section')
    await expect(sshSec).toBeVisible()
    await sshSec.locator('.container_settings_sshproto_port_input').fill('2222')
    await sshSec.locator('.container_settings_sshproto_port_input').press('Tab')
    await sshSec.locator('.container_settings_sshproto_keepalive_input').fill('45')
    await sshSec.locator('.container_settings_sshproto_keepalive_input').press('Tab')

    await page.getByTestId('settings-tab-files').click()
    const filesSec = page.getByTestId('files-protocol-settings-section')
    await expect(filesSec).toBeVisible()
    await filesSec.locator('.container_settings_fileproto_conc_input').fill('5')
    await filesSec.locator('.container_settings_fileproto_conc_input').press('Tab')
    await filesSec.locator('.container_settings_fileproto_pathstyle_check').check()
    await checkClasses(page)

    await page.reload()
    await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByTestId('settings-tab-ssh').click()
    await expect(sshSec.locator('.container_settings_sshproto_port_input')).toHaveValue('2222')
    await page.getByTestId('settings-tab-files').click()
    await expect(filesSec.locator('.container_settings_fileproto_conc_input')).toHaveValue('5')
    await expect(filesSec.locator('.container_settings_fileproto_pathstyle_check')).toBeChecked()

    // New Host form should pre-fill SSH default port 2222
    await page.getByRole('button', { name: '新建主机', exact: true }).first().click()
    const hostDialog = page.getByRole('dialog', { name: '新建主机' })
    await expect(hostDialog.getByLabel('端口', { exact: true })).toHaveValue('2222')
    await hostDialog.getByRole('button', { name: '取消', exact: true }).click()

    // 2. Open standalone Files page via NavRail icon
    await page.getByTestId('nav-files-btn').click()
    const filesPage = page.getByTestId('files-page')
    await expect(filesPage).toBeVisible()
    await checkClasses(page)

    // 3. Create & connect a WebDAV file profile (encrypted credentials)
    await page.getByTestId('files-add-server-btn').click()
    const editor = page.getByTestId('file-profile-editor')
    await expect(editor).toBeVisible()
    await editor.getByRole('combobox', { name: '文件协议' }).click()
    await page.getByRole('option', { name: 'WebDAV' }).click()
    await editor.locator('.container_files_editor_input_name').fill('Prod-WebDAV')
    await editor.locator('.container_files_editor_input_davurl').fill(davUrl)
    await editor.locator('.container_files_editor_input_user').fill('davuser')
    await editor.locator('.container_files_editor_input_password').fill('DavE2ePass!88')
    await editor.locator('.container_files_editor_input_savepw').check()
    await checkClasses(page)
    await editor.locator('.container_files_editor_btn_savego').click()
    await expect(editor).toHaveCount(0)

    await expect(
      filesPage.locator('.container_files_group_files_section').getByText('Prod-WebDAV')
    ).toBeVisible()
    await expect(filesPage.locator('.container_files_tabs_item_proto').first()).toContainText('WEBDAV')

    // Create folder on WebDAV and verify on physical filesystem
    await filesPage.locator('.container_files_toolbar_mkdir_btn').click()
    await filesPage.locator('.container_files_modal_dialog_input').fill('dav-folder')
    await filesPage.locator('.container_files_modal_btn_confirm').click()
    await expect(filesPage.getByText('dav-folder', { exact: true })).toBeVisible({ timeout: 5000 })
    expect((await stat(join(davRoot, 'dav-folder'))).isDirectory()).toBe(true)

    // 4. Add SSH host via FilesPage ("SFTP" protocol) -> connects directly into standalone SFTP tab
    await page.getByTestId('files-add-server-btn').click()
    await editor.getByRole('combobox', { name: '文件协议' }).click()
    await page.getByRole('option', { name: 'SFTP (SSH)' }).click()
    await editor.locator('.container_files_editor_input_name').fill('Files-SSH-Box')
    await editor.locator('.container_files_editor_input_host').fill('127.0.0.1')
    await editor.locator('.container_files_editor_input_port').fill(String(sftpServer.port))
    await editor.locator('.container_files_editor_input_user').fill('orbit-test')
    await editor.locator('.container_files_editor_input_password').fill('SftpFilesPass!1')
    await editor.locator('.container_files_editor_input_savepw').check()
    await editor.locator('.container_files_editor_btn_sftpgo').click()

    const trust = page.getByRole('dialog', { name: '确认服务器身份' })
    await expect(trust).toBeVisible({ timeout: 10_000 })
    await trust.getByRole('button', { name: '信任并继续' }).click()
    await expect(filesPage.getByText('readme.txt', { exact: true })).toBeVisible({ timeout: 10_000 })

    // 5. Ad-hoc Quick Connect to Mock S3 server (does not save to file_profiles)
    await page.getByTestId('files-quick-connect-btn').click()
    await editor.getByRole('combobox', { name: '文件协议' }).click()
    await page.getByRole('option', { name: /S3/ }).click()
    await expect(editor.locator('.container_files_editor_input_pathstyle')).toBeChecked()
    await editor.locator('.container_files_editor_input_name').fill('Temp-S3')
    await editor.locator('.container_files_editor_input_s3ep').fill(s3Server.url)
    await editor.locator('.container_files_editor_input_s3bucket').fill(s3Server.bucket)
    await editor.locator('.container_files_editor_input_user').fill(s3Server.accessKeyId)
    await editor.locator('.container_files_editor_input_s3secret').fill(s3Server.secretAccessKey)
    await editor.locator('.container_files_editor_btn_adhoc').click()

    await expect(filesPage.locator('.container_files_s3_notice_banner')).toBeVisible({ timeout: 10_000 })
    await filesPage.locator('.container_files_toolbar_mkdir_btn').click()
    await filesPage.locator('.container_files_modal_dialog_input').fill('s3-prefix')
    await filesPage.locator('.container_files_modal_btn_confirm').click()
    await expect.poll(() => s3Server.listKeys()).toContain('s3-prefix/')
    // Ad-hoc session must NOT be persisted in saved File Servers list
    await expect(filesPage.locator('.container_files_group_files_section')).not.toContainText('Temp-S3')

    // 6. Reload and confirm saved WebDAV profile still connects silently with DPAPI-encrypted password
    await page.reload()
    await page.getByTestId('nav-files-btn').click()
    const davCard = filesPage.locator('.container_files_group_files_section').getByText('Prod-WebDAV')
    await expect(davCard).toBeVisible()
    await filesPage.locator('[class*="container_files_card_profile_connect"]').first().click()
    await expect(filesPage.getByText('dav-folder', { exact: true })).toBeVisible({ timeout: 10_000 })
    await checkClasses(page)
    await page.screenshot({ path: info.outputPath('files-page-workbench.png') })
    expect(errors).toEqual([])
  } finally {
    await stop(app)
    await sftpServer.close()
    await s3Server.close()
    await new Promise<void>((resolve) => {
      try {
        davServer.stop(() => resolve())
      } catch {
        resolve()
      }
    })
    await rm(davRoot, { recursive: true, force: true }).catch(() => {})
    await rm(localTransferDir, { recursive: true, force: true }).catch(() => {})
    await rm(appDir, { recursive: true, force: true }).catch(() => {})
  }
})
