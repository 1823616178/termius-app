import { app, Menu, Tray, nativeImage, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  normalizeStoredTrayPreferences,
  resolveTrayPreferences,
  trayPreferencesSchema,
  type AppLocale,
  type TrayAction,
  type TrayPreferences,
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
  private readonly pendingMinimizes = new Map<number, NodeJS.Immediate>()
  private readonly suppressNativeTrayUntil = new Map<number, number>()
  private prefs: TrayPreferences
  private tray: Tray | undefined
  private balloonShown = false
  private locale: AppLocale = 'zh-CN'

  constructor(userDataDir: string, callbacks: TrayCallbacks) {
    this.prefsPath = join(userDataDir, 'tray-preferences.json')
    this.callbacks = callbacks
    this.prefs = this.loadPreferences()
  }

  setLocale(locale: AppLocale): void {
    if (this.locale === locale) return
    this.locale = locale
    this.refresh()
  }

  private loadPreferences(): TrayPreferences {
    try {
      if (!existsSync(this.prefsPath)) return { ...DEFAULT_TRAY_PREFERENCES }
      const raw = JSON.parse(readFileSync(this.prefsPath, 'utf8'))
      return normalizeStoredTrayPreferences(raw)
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
    this.prefs = resolveTrayPreferences(this.prefs, rawPatch)
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

  private ensureTray(): Tray | undefined {
    if (this.tray && !this.tray.isDestroyed()) return this.tray
    try {
      const icon = resolveTrayIconAsset()
      const finalIcon =
        process.platform === 'linux' && typeof icon !== 'string' && !icon.isEmpty()
          ? icon.resize({ width: 22, height: 22 })
          : icon
      const tray = new Tray(finalIcon)
      const activate = () => {
        // Restoring can destroy this icon in when-minimized mode. Let the
        // native notification callback return before changing its window/tray.
        setImmediate(() => {
          if (tray.isDestroyed()) return
          const win = this.callbacks.getMainWindow()
          if (!win || win.isDestroyed()) return
          if (this.hiddenWindowIds.has(win.id) || win.isMinimized() || !win.isVisible()) {
            this.restoreFromTray(win)
          } else {
            win.focus()
          }
        })
      }
      tray.on('click', activate)
      tray.on('double-click', activate)
      this.tray = tray
      this.refresh()
      return tray
    } catch {
      this.tray = undefined
      return undefined
    }
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
    const en = this.locale === 'en-US'
    const sessionCount = this.callbacks.getSessionCount()
    const tunnelCount = this.callbacks.getActiveTunnelCount()
    const syncLabel = this.callbacks.getSyncLabel()
    const hidden = this.hiddenWindowIds.size > 0
    const modeLabel = en
      ? hidden
        ? 'Running in Background'
        : 'Active'
      : hidden
        ? '后台运行中'
        : '前台运行中'
    this.tray.setToolTip(
      en
        ? `Graphite Orbit · ${modeLabel}\nActive Terminals: ${sessionCount} · Active Tunnels: ${tunnelCount}`
        : `Graphite Orbit · ${modeLabel}\n活动终端: ${sessionCount} · 活动隧道: ${tunnelCount}`
    )

    const openFromMenu = (action: TrayAction) => {
      setImmediate(() => {
        this.restoreFromTray()
        this.callbacks.onDispatchAction(action)
      })
    }
    const template: MenuItemConstructorOptions[] = [
      {
        label: `Graphite Orbit · ${modeLabel}`,
        enabled: false
      },
      {
        label: en
          ? `Terminals ${sessionCount} · Tunnels ${tunnelCount} · ${syncLabel}`
          : `终端 ${sessionCount} · 隧道 ${tunnelCount} · ${syncLabel}`,
        enabled: false
      },
      { type: 'separator' },
      {
        label: en
          ? hidden
            ? 'Show Graphite Orbit Window'
            : 'Hide to System Tray'
          : hidden
            ? '显示 Graphite Orbit 主窗口'
            : '隐藏到后台托盘',
        click: () => setImmediate(() => this.toggleMainWindow())
      },
      {
        label: en ? 'New Local Terminal' : '新建本地终端',
        click: () => openFromMenu('new-local')
      },
      {
        label: en ? 'Open Hosts' : '打开主机列表',
        click: () => openFromMenu('open-hosts')
      },
      {
        label: en ? 'Open Port Forwarding' : '打开端口转发中心',
        click: () => openFromMenu('open-tunnels')
      },
      { type: 'separator' },
      {
        label: en ? 'Minimize to System Tray' : '最小化时隐藏到右下角系统托盘',
        type: 'checkbox',
        checked: this.prefs.minimizeToTray,
        click: (item) => {
          this.updatePreferences({ minimizeToTray: item.checked })
        }
      },
      {
        label: en ? 'When Closing Window (×)' : '点击关闭按钮（×）时',
        submenu: [
          {
            label: en ? 'Quit Application' : '彻底关闭并退出程序',
            type: 'radio',
            checked: this.prefs.closeAction === 'quit',
            click: () => {
              this.updatePreferences({ closeAction: 'quit' })
            }
          },
          {
            label: en ? 'Minimize to System Tray' : '最小化到后台系统托盘',
            type: 'radio',
            checked: this.prefs.closeAction === 'tray',
            click: () => {
              this.updatePreferences({ closeAction: 'tray' })
            }
          },
          {
            label: en ? 'Minimize to Taskbar' : '最小化到系统任务栏',
            type: 'radio',
            checked: this.prefs.closeAction === 'minimize',
            click: () => {
              this.updatePreferences({ closeAction: 'minimize' })
            }
          }
        ]
      },
      {
        label: en ? 'Always Show System Tray Icon' : '始终显示系统托盘图标',
        type: 'checkbox',
        checked: this.prefs.trayVisibility === 'always',
        click: (item) => {
          this.updatePreferences({ trayVisibility: item.checked ? 'always' : 'when-minimized' })
        }
      },
      { type: 'separator' },
      {
        label: en ? 'Quit Graphite Orbit' : '退出 Graphite Orbit',
        click: () => setImmediate(() => this.callbacks.onQuit())
      }
    ]
    this.tray.setContextMenu(Menu.buildFromTemplate(template))
  }

  minimizeToTray(win: BrowserWindow, options?: { notifyBalloon?: boolean }): void {
    if (win.isDestroyed()) return
    this.cancelNativeMinimize(win.id)
    this.hiddenWindowIds.add(win.id)
    const tray = this.ensureTray()
    if (!tray && process.platform === 'linux') {
      this.hiddenWindowIds.delete(win.id)
      if (!win.isMinimized()) win.minimize()
      this.emitState()
      return
    }
    this.refresh()
    win.setSkipTaskbar(true)
    win.hide()
    this.emitState()

    if (
      tray &&
      process.platform === 'win32' &&
      !this.balloonShown &&
      options?.notifyBalloon !== false &&
      !process.env.ORBIT_DISABLE_BALLOON &&
      !process.env.ORBIT_USER_DATA
    ) {
      this.balloonShown = true
      tray.displayBalloon({
        title:
          this.locale === 'en-US' ? 'Graphite Orbit is running in background' : 'Graphite Orbit 已在后台运行',
        content:
          this.locale === 'en-US'
            ? 'Click the system tray icon at the bottom-right anytime to restore the window.'
            : '最小化图标已出现在右侧系统托盘，点击图标即可随时恢复窗口。'
      })
    }
  }

  restoreFromTray(target?: BrowserWindow): void {
    const win = target ?? this.callbacks.getMainWindow()
    if (!win || win.isDestroyed()) return
    this.cancelNativeMinimize(win.id)
    this.hiddenWindowIds.delete(win.id)
    if (win.isMinimized()) win.restore()
    if (!win.isVisible()) win.show()
    win.setSkipTaskbar(false)
    if (process.platform === 'win32') win.moveTop()
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

  minimizeToTaskbar(win: BrowserWindow): void {
    if (win.isDestroyed()) return
    this.cancelNativeMinimize(win.id)
    this.suppressNativeTrayUntil.set(win.id, Date.now() + 800)
    if (!win.isMinimized()) {
      win.minimize()
    }
  }

  private cancelNativeMinimize(windowId: number): void {
    const pending = this.pendingMinimizes.get(windowId)
    if (pending) clearImmediate(pending)
    this.pendingMinimizes.delete(windowId)
  }

  handleNativeMinimize(win: BrowserWindow): void {
    this.cancelNativeMinimize(win.id)
    const suppressUntil = this.suppressNativeTrayUntil.get(win.id) ?? 0
    if (Date.now() < suppressUntil) {
      this.suppressNativeTrayUntil.delete(win.id)
      return
    }
    if (!this.prefs.minimizeToTray || this.hiddenWindowIds.has(win.id)) return
    const windowId = win.id
    const pending = setImmediate(() => {
      this.pendingMinimizes.delete(windowId)
      if (!win.isDestroyed() && win.isMinimized() && this.prefs.minimizeToTray) {
        this.minimizeToTray(win)
      }
    })
    this.pendingMinimizes.set(windowId, pending)
  }

  handleWindowShown(win: BrowserWindow): void {
    this.cancelNativeMinimize(win.id)
    this.suppressNativeTrayUntil.delete(win.id)
    if (!this.hiddenWindowIds.has(win.id)) return
    this.hiddenWindowIds.delete(win.id)
    win.setSkipTaskbar(false)
    this.reconcileTrayVisibility()
    this.emitState()
  }

  handleWindowClosed(windowId: number): void {
    this.cancelNativeMinimize(windowId)
    this.suppressNativeTrayUntil.delete(windowId)
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
