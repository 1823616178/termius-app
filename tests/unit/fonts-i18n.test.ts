import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { classifyFontFamily, parseFcListOutput, parseWindowsRegFontsOutput } from '../../src/main/fonts'
import {
  DEFAULT_PANEL_DISPLAY_FONT_ID,
  DEFAULT_PANEL_FONT_ID,
  DEFAULT_TERMINAL_FONT_ID,
  EMBEDDED_FONT_PRESETS,
  getFontDisplayName,
  mergeAvailableSystemFonts,
  quoteCssFontFamily,
  resolveEffectiveTerminalTheme,
  resolvePanelDisplayFontFamily,
  resolvePanelFontFamily,
  resolveTerminalFontFamily,
  sanitizeCssFontStack,
  toDynamicSystemFontId
} from '../../src/renderer/src/services/fonts'
import {
  locale,
  parseAppLocale,
  setLocale,
  t,
  toggleLocale,
  translateMotionReason,
  translateSwordPhaseLabel
} from '../../src/renderer/src/services/i18n'
import { enUS } from '../../src/renderer/src/services/locales/en-US'
import { zhCN } from '../../src/renderer/src/services/locales/zh-CN'
import { FORMATIONS } from '../../src/renderer/src/services/sword-motion'
import { TERMINAL_THEMES } from '../../src/renderer/src/services/terminal-themes'
import { UI_THEME_PRESETS } from '../../src/renderer/src/services/ui-themes'

function extractPlaceholders(text: string): string[] {
  return [...text.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]!).sort()
}

describe('Embedded woff2 fonts & @font-face catalog integrity', () => {
  it('stores every embedded font strictly in compressed .woff2 format with valid CSS urls', async () => {
    const fontsDir = join(process.cwd(), 'src/renderer/src/assets/fonts')
    const entries = await readdir(fontsDir)
    expect(entries.length).toBeGreaterThanOrEqual(30)
    for (const file of entries) {
      expect(file.endsWith('.woff2')).toBe(true)
    }

    const fontsCss = await readFile(join(process.cwd(), 'src/renderer/src/styles/fonts.css'), 'utf8')
    const urls = [...fontsCss.matchAll(/url\(['"]\.\.\/assets\/fonts\/([^'"]+)['"]\)/g)].map((m) => m[1]!)
    expect(urls.length).toBeGreaterThanOrEqual(entries.length)
    for (const relFile of urls) {
      expect(relFile.endsWith('.woff2')).toBe(true)
      expect(entries).toContain(relFile)
    }
    for (const preset of EMBEDDED_FONT_PRESETS) {
      expect(fontsCss).toContain(`font-family: '${preset.family}'`)
    }
  })
})

describe('Main-process system font discovery parsers', () => {
  it('classifies monospace, serif, sans, and generic font families accurately', () => {
    expect(classifyFontFamily('Cascadia Mono')).toBe('monospace')
    expect(classifyFontFamily('JetBrains Mono')).toBe('monospace')
    expect(classifyFontFamily('Maple Mono')).toBe('monospace')
    expect(classifyFontFamily('Custom Terminal Face', 100)).toBe('monospace')
    expect(classifyFontFamily('STZhongsong')).toBe('serif')
    expect(classifyFontFamily('Cinzel')).toBe('serif')
    expect(classifyFontFamily('Microsoft YaHei UI')).toBe('sans')
    expect(classifyFontFamily('Segoe UI')).toBe('sans')
  })

  it('parses Windows Registry Fonts output and deduplicates compounds/styles', () => {
    const sample = [
      'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
      '    Consolas (TrueType)    REG_SZ    consola.ttf',
      '    Consolas Bold (TrueType)    REG_SZ    consolab.ttf',
      '    Microsoft YaHei & Microsoft YaHei UI (TrueType)    REG_SZ    msyh.ttc',
      '    @SimSun & @NSimSun (TrueType)    REG_SZ    simsun.ttc',
      '    Wingdings (TrueType)    REG_SZ    wingding.ttf',
      '    Cascadia Mono Regular (TrueType)    REG_SZ    CascadiaMono.ttf'
    ].join('\r\n')

    const parsed = parseWindowsRegFontsOutput(sample)
    const names = parsed.map((f) => f.family)
    expect(names).toContain('Consolas')
    expect(names).toContain('Microsoft YaHei')
    expect(names).toContain('Microsoft YaHei UI')
    expect(names).toContain('Cascadia Mono')
    expect(names).not.toContain('Wingdings')
    expect(names.some((n) => n.startsWith('@'))).toBe(false)
    expect(names.filter((n) => n === 'Consolas')).toHaveLength(1)
    expect(parsed.find((f) => f.family === 'Consolas')?.category).toBe('monospace')
    expect(parsed.find((f) => f.family === 'Microsoft YaHei UI')?.category).toBe('sans')
  })

  it('parses Unix fc-list output including spacing hints and comma aliases', () => {
    const sample = [
      'JetBrains Mono,JetBrains Mono NL:spacing=100',
      'Noto Sans CJK SC:spacing=0',
      '.hiddenFont:spacing=100',
      'Liberation Mono:spacing=100'
    ].join('\n')

    const parsed = parseFcListOutput(sample)
    expect(parsed.find((f) => f.family === 'JetBrains Mono')?.category).toBe('monospace')
    expect(parsed.find((f) => f.family === 'Liberation Mono')?.category).toBe('monospace')
    expect(parsed.find((f) => f.family === 'Noto Sans CJK SC')?.category).toBe('sans')
    expect(parsed.some((f) => f.family.startsWith('.'))).toBe(false)
  })
})

describe('Renderer typography & separate terminal/panel font resolution', () => {
  it('sanitizes and quotes CSS font stacks safely', () => {
    expect(sanitizeCssFontStack(' "Fira Code"; } <script> ')).toBe('"Fira Code"  script')
    expect(quoteCssFontFamily('Cascadia Mono')).toBe("'Cascadia Mono'")
    expect(quoteCssFontFamily('Inter')).toBe('Inter')
  })

  it('resolves terminal and panel fonts independently without cross-coupling', () => {
    const defaultTerm = resolveTerminalFontFamily(DEFAULT_TERMINAL_FONT_ID)
    const defaultPanel = resolvePanelFontFamily(DEFAULT_PANEL_FONT_ID)
    expect(defaultTerm).toContain("'Orbit JetBrains Mono'")
    expect(defaultPanel).not.toContain("'Orbit JetBrains Mono'")

    const sysTerm = resolveTerminalFontFamily(toDynamicSystemFontId('Consolas'))
    expect(sysTerm.startsWith('Consolas,')).toBe(true)

    const panelBody = resolvePanelFontFamily('embedded-lxgw-wenkai')
    expect(panelBody).toContain("'Orbit LXGW WenKai'")
    expect(resolvePanelDisplayFontFamily('follow-panel', panelBody)).toBe(panelBody)
    expect(resolvePanelDisplayFontFamily(DEFAULT_PANEL_DISPLAY_FONT_ID, panelBody)).not.toBe(panelBody)
    expect(resolvePanelDisplayFontFamily('custom', panelBody, 'Noto Serif SC')).toContain('Noto Serif SC')

    expect(getFontDisplayName('follow-panel', 'zh-CN')).toBe('跟随面板正文字体')
    expect(getFontDisplayName('follow-panel', 'en-US')).toBe('Follow Panel Body Font')
  })

  it('merges curated OS presets and discovered fonts deduplicated case-insensitively', () => {
    const merged = mergeAvailableSystemFonts(
      [
        { family: 'consolas', category: 'monospace' },
        { family: 'Sarasa Term SC', category: 'monospace' }
      ],
      'win32'
    )
    expect(merged.filter((f) => f.family.toLowerCase() === 'consolas')).toHaveLength(1)
    expect(merged.some((f) => f.family === 'Sarasa Term SC')).toBe(true)
  })

  it('resolves effective terminal theme with optional custom color overrides', () => {
    const base = resolveEffectiveTerminalTheme('orbit-vivid', false, {
      foreground: '#112233',
      background: '#445566'
    })
    expect(base.background).toMatch(/^#080b0a$/i)

    const custom = resolveEffectiveTerminalTheme('orbit-vivid', true, {
      foreground: '#abcdef',
      background: '#101820',
      cursor: '#ff8800',
      selection: '#3399ff'
    })
    expect(custom.background).toBe('#101820')
    expect(custom.theme.foreground).toBe('#abcdef')
    expect(custom.theme.cursor).toBe('#ff8800')
    expect(custom.theme.selectionBackground).toBe('rgba(51, 153, 255, 0.3)')
  })
})

describe('Bilingual i18n dictionary parity & theme metadata completeness', () => {
  it('has identical translation keys and matching interpolation params in zh-CN and en-US', () => {
    const zhKeys = Object.keys(zhCN).sort()
    const enKeys = Object.keys(enUS).sort()
    expect(enKeys).toEqual(zhKeys)

    for (const key of zhKeys as (keyof typeof zhCN)[]) {
      const zhVal = zhCN[key]
      const enVal = enUS[key]
      expect(typeof zhVal).toBe('string')
      expect(typeof enVal).toBe('string')
      expect(zhVal.trim().length).toBeGreaterThan(0)
      expect(enVal.trim().length).toBeGreaterThan(0)
      expect(extractPlaceholders(enVal)).toEqual(extractPlaceholders(zhVal))
    }
  })

  it('switches locales, formats parameters, and translates dynamic sword/motion labels cleanly', () => {
    setLocale('zh-CN')
    expect(parseAppLocale('unknown')).toBe('zh-CN')
    expect(parseAppLocale('en-US')).toBe('en-US')
    expect(t('nav.settings')).toBe('设置')
    expect(t('status.copiedFeedback', { count: 42 })).toBe('已复制 42 字符')

    toggleLocale()
    expect(locale.value).toBe('en-US')
    expect(t('nav.settings')).toBe('Settings')
    expect(t('status.copiedFeedback', { count: 42 })).toBe('Copied 42 chars')
    expect(translateSwordPhaseLabel('开阵启封 · 万锋初现')).toBe('Formations Awakening · First Blades')
    expect(translateMotionReason('实测 58 fps，运行正常')).toBe('Measured 58 fps, running smoothly')

    setLocale('zh-CN')
  })

  it('includes complete English labels across UI themes, terminal themes, and sword formations', () => {
    for (const preset of UI_THEME_PRESETS) {
      expect(preset.nameEn.trim().length).toBeGreaterThan(0)
      expect(preset.elementEn.trim().length).toBeGreaterThan(0)
      expect(preset.taglineEn.trim().length).toBeGreaterThan(0)
    }
    for (const theme of TERMINAL_THEMES) {
      expect(theme.nameEn.trim().length).toBeGreaterThan(0)
      expect(theme.badgeEn.trim().length).toBeGreaterThan(0)
    }
    for (const f of FORMATIONS) {
      expect(f.nameEn.trim().length).toBeGreaterThan(0)
      expect(f.subEn.trim().length).toBeGreaterThan(0)
    }
  })
})
