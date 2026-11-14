import { app, Menu, Tray, nativeImage, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  trayPreferencesPatchSchema,
  trayPreferencesSchema,
  type TrayAction,
  type TrayPreferences,
  type TrayPreferencesPatch,
  type TrayState
} from '../shared/contracts'

export const DEFAULT_TRAY_PREFERENCES: TrayPreferences = trayPreferencesSchema.parse({})

export interface TrayCallbacks {
  getMainWindow: () => BrowserWindow | undefined
  getSessionCount: () => number
  getActiveTunnelCount: () => number
  getSyncLabel: () => string
  onDispatchAction: (action: TrayAction) => void
  onStateChanged: (state: TrayState) => void
  onQuit: () => void
}

function createFallbackTrayImage(): Electron.NativeImage {
  const size = 16
  const buf = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4
      const dx = x - 7.5
      const dy = y - 7.5
      const r = Math.hypot(dx, dy)
      if (r <= 2.8) {
        buf[idx] = 91
        buf[idx + 1] = 220
        buf[idx + 2] = 244
        buf[idx + 3] = 255
      } else if (r >= 5.2 && r <= 7.2) {
        buf[idx] = 167
        buf[idx + 1] = 139
        buf[idx + 2] = 250
        buf[idx + 3] = 255
      } else if (r < 7.8) {
        buf[idx] = 18
        buf[idx + 1] = 22
        buf[idx + 2] = 36
        buf[idx + 3] = 235
      }
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size })
}

function resolveTrayIconAsset(): string | Electron.NativeImage {
  const icoCandidates = app.isPackaged
    ? [join(process.resourcesPath, 'icon.ico')]
    : [join(__dirname, '../../resources/icon.ico')]
  const pngCandidates = app.isPackaged
    ? [join(process.resourcesPath, 'icon.png')]
    : [join(__dirname, '../../resources/icon.png')]

  if (process.platform === 'win32') {
    for (const icoPath of icoCandidates) {
      if (existsSync(icoPath)) return icoPath
    }
  }

  for (const pngPath of pngCandidates) {
    if (!existsSync(pngPath)) continue
    const img = nativeImage.createFromPath(pngPath)
    if (!img.isEmpty()) {
      return img.resize({ width: 32, height: 32 })
    }
  }

  return createFallbackTrayImage()
}

export class OrbitTrayManager {
  private readonly prefsPath: string
  private readonly callbacks: TrayCallbacks
  private readonly hiddenWindowIds = new Set<number>()
  private prefs: TrayPreferences
  private tray: Tray | undefined
  private balloonShown = false

  constructor(userDataDir: string, callbacks: TrayCallbacks) {
    this.prefsPath = join(userDataDir, 'tray-preferences.json')
    this.callbacks = callbacks
    this.prefs = this.loadPreferences()
  }

  private loadPreferences(): TrayPreferences {
    try {
      if (!existsSync(this.prefsPath)) return { ...DEFAULT_TRAY_PREFERENCES }
      const raw = JSON.parse(readFileSync(this.prefsPath, 'utf8'))
      return trayPreferencesSchema.parse(raw)
    } catch {
      return { ...DEFAULT_TRAY_PREFERENCES }
    }
  }

  private savePreferences(): void {
    try {
      mkdirSync(join(this.prefsPath, '..'), { recursive: true })
      const tempPath = `${this.prefsPath}.tmp`
      writeFileSync(tempPath, JSON.stringify(this.prefs, null, 2), 'utf8')
      renameSync(tempPath, this.prefsPath)
    } catch {
      /* ignore non-fatal preference write failure */
    }
  }

  getPreferences(): TrayPreferences {
    return { ...this.prefs }
  }

  getState(): TrayState {
    return {
      ...this.prefs,
      trayCreated: Boolean(this.tray && !this.tray.isDestroyed()),
      windowHiddenToTray: this.hiddenWindowIds.size > 0
    }
  }

  updatePreferences(rawPatch: unknown): TrayState {
    const patch = trayPreferencesPatchSchema.parse(rawPatch) as TrayPreferencesPatch
    this.prefs = trayPreferencesSchema.parse({
      ...this.prefs,
      ...patch
    })
    this.savePreferences()
    this.reconcileTrayVisibility()
    const state = this.getState()
    this.callbacks.onStateChanged(state)
    return state
  }

  isWindowHiddenToTray(windowId: number): boolean {
    return this.hiddenWindowIds.has(windowId)
  }

  private emitState(): void {
    this.callbacks.onStateChanged(this.getState())
  }

  private ensureTray(): Tray {
    if (this.tray && !this.tray.isDestroyed()) return this.tray
    const tray = new Tray(resolveTrayIconAsset())
    tray.on('click', () => {
      const win = this.callbacks.getMainWindow()
      if (!win || win.isDestroyed()) return
      if (this.hiddenWindowIds.has(win.id) || win.isMinimized() || !win.isVisible()) {
        this.restoreFromTray(win)
      } else {
        win.focus()
      }
    })
    tray.on('double-click', () => {
      this.restoreFromTray()
    })
    this.tray = tray
    this.refresh()
    return tray
  }

  reconcileTrayVisibility(): void {
    const shouldExist = this.prefs.trayVisibility === 'always' || this.hiddenWindowIds.size > 0
    if (shouldExist) {
      this.ensureTray()
      this.refresh()
    } else {
      this.destroy()
    }
  }

  refresh(): void {
    if (!this.tray || this.tray.isDestroyed()) return
    const sessionCount = this.callbacks.getSessionCount()
    const tunnelCount = this.callbacks.getActiveTunnelCount()
    const syncLabel = this.callbacks.getSyncLabel()
    const hidden = this.hiddenWindowIds.size > 0
    const modeLabel = hidden ? '后台运行中' : '前台运行中'
    this.tray.setToolTip(
      `Graphite Orbit · ${modeLabel}\n活动终端: ${sessionCount} · 活动隧道: ${tunnelCount}`
    )

    const template: MenuItemConstructorOptions[] = [
      {
        label: `Graphite Orbit · ${modeLabel}`,
        enabled: false
      },
      {
        label: `终端 ${sessionCount} · 隧道 ${tunnelCount} · ${syncLabel}`,
        enabled: false
      },
      { type: 'separator' },
      {
        label: hidden ? '显示 Graphite Orbit 主窗口' : '隐藏到后台托盘',
        click: () => this.toggleMainWindow()
      },
      {
        label: '新建本地终端',
        click: () => {
          this.restoreFromTray()
          this.callbacks.onDispatchAction('new-local')
        }
      },
      {
        label: '打开主机列表',
        click: () => {
          this.restoreFromTray()
          this.callbacks.onDispatchAction('open-hosts')
        }
      },
      {
        label: '打开端口转发中心',
        click: () => {
          this.restoreFromTray()
          this.callbacks.onDispatchAction('open-tunnels')
        }
      },
      { type: 'separator' },
      {
        label: '最小化时隐藏到右下角系统托盘',
        type: 'checkbox',
        checked: this.prefs.minimizeToTray,
        click: (item) => {
          this.updatePreferences({ minimizeToTray: item.checked })
        }
      },
      {
        label: '关闭窗口时隐藏到系统托盘',
        type: 'checkbox',
        checked: this.prefs.closeToTray,
        click: (item) => {
          this.updatePreferences({ closeToTray: item.checked })
        }
      },
      {
        label: '始终显示系统托盘图标',
        type: 'checkbox',
        checked: this.prefs.trayVisibility === 'always',
        click: (item) => {
          this.updatePreferences({ trayVisibility: item.checked ? 'always' : 'when-minimized' })
        }
      },
      { type: 'separator' },
      {
        label: '退出 Graphite Orbit',
        click: () => this.callbacks.onQuit()
      }
    ]
    this.tray.setContextMenu(Menu.buildFromTemplate(template))
  }

  minimizeToTray(win: BrowserWindow, options?: { notifyBalloon?: boolean }): void {
    if (win.isDestroyed()) return
    this.hiddenWindowIds.add(win.id)
    const tray = this.ensureTray()
    this.refresh()
    win.setSkipTaskbar(true)
    win.hide()
    this.emitState()

    if (
      process.platform === 'win32' &&
      !this.balloonShown &&
      options?.notifyBalloon !== false &&
      !process.env.ORBIT_DISABLE_BALLOON &&
      !process.env.ORBIT_USER_DATA
    ) {
      this.balloonShown = true
      tray.displayBalloon({
        title: 'Graphite Orbit 已在后台运行',
        content: '最小化图标已出现在右侧系统托盘，点击图标即可随时恢复窗口。'
      })
    }
  }

  restoreFromTray(target?: BrowserWindow): void {
    const win = target ?? this.callbacks.getMainWindow()
    if (!win || win.isDestroyed()) return
    this.hiddenWindowIds.delete(win.id)
    win.setSkipTaskbar(false)
    if (win.isMinimized()) win.restore()
    if (!win.isVisible()) win.show()
    win.focus()
    this.reconcileTrayVisibility()
    this.emitState()
  }

  toggleMainWindow(): void {
    const win = this.callbacks.getMainWindow()
    if (!win || win.isDestroyed()) return
    if (this.hiddenWindowIds.has(win.id) || win.isMinimized() || !win.isVisible()) {
      this.restoreFromTray(win)
    } else {
      this.minimizeToTray(win)
    }
  }

  handleNativeMinimize(win: BrowserWindow): void {
    if (!this.prefs.minimizeToTray || this.hiddenWindowIds.has(win.id)) return
    setImmediate(() => {
      if (!win.isDestroyed() && this.prefs.minimizeToTray) {
        this.minimizeToTray(win)
      }
    })
  }

  handleWindowShown(win: BrowserWindow): void {
    if (!this.hiddenWindowIds.has(win.id)) return
    this.hiddenWindowIds.delete(win.id)
    win.setSkipTaskbar(false)
    this.reconcileTrayVisibility()
    this.emitState()
  }

  handleWindowClosed(windowId: number): void {
    if (!this.hiddenWindowIds.delete(windowId)) return
    this.reconcileTrayVisibility()
    this.emitState()
  }

  destroy(): void {
    if (this.tray && !this.tray.isDestroyed()) {
      this.tray.destroy()
    }
    this.tray = undefined
  }
}
