import type { ITheme } from '@xterm/xterm'
import type { OrbitPlatform, SystemFontInfo } from '../../../shared/contracts'
import { getTerminalTheme, type TerminalThemeId } from './terminal-themes'
import { normalizeHexColor } from './ui-themes'

export type FontSourceKind = 'embedded' | 'system' | 'custom'
export type FontTargetRole = 'terminal' | 'panel' | 'display'

export interface FontPresetOption {
  id: string
  family: string
  cssStack: string
  source: Exclude<FontSourceKind, 'custom'>
  role: FontTargetRole | 'both'
  category: 'monospace' | 'sans' | 'serif' | 'display'
  labelZh: string
  labelEn: string
  badgeZh: string
  badgeEn: string
  descriptionZh: string
  descriptionEn: string
  supportsCjk: boolean
  ligatures?: boolean
}

export interface TerminalCustomColors {
  foreground: string
  background: string
  cursor: string
  selection: string
}

export interface PanelTextColors {
  primary: string
  secondary: string
  muted: string
  heading: string
}

export const DEFAULT_TERMINAL_CUSTOM_COLORS: TerminalCustomColors = {
  foreground: '#ede7d9',
  background: '#080b0a',
  cursor: '#d4af63',
  selection: '#5ec4a6'
}

export const DEFAULT_PANEL_TEXT_COLORS: PanelTextColors = {
  primary: '#efe9da',
  secondary: '#bfb7a4',
  muted: '#827b6d',
  heading: '#f2dab0'
}

export const DEFAULT_TERMINAL_FONT_ID = 'embedded-jetbrains-mono'
export const DEFAULT_PANEL_FONT_ID = 'system-default-ui'
export const DEFAULT_PANEL_DISPLAY_FONT_ID = 'system-default-display'

const CJK_MONO_FALLBACK =
  "'Orbit LXGW WenKai Mono', 'Sarasa Term SC', 'Microsoft YaHei UI', 'PingFang SC', 'Noto Sans Mono CJK SC', monospace"
const CJK_UI_FALLBACK =
  "'Segoe UI Variable', 'Segoe UI', 'Microsoft YaHei UI', 'PingFang SC', 'Noto Sans CJK SC', sans-serif"
const CJK_DISPLAY_FALLBACK =
  "'STZhongsong', 'Noto Serif SC', 'Source Han Serif SC', 'FangSong', 'KaiTi', 'Microsoft YaHei UI', serif"

export const EMBEDDED_FONT_PRESETS: FontPresetOption[] = [
  // === Terminal / Monospace Embedded WOFF2 Fonts ===
  {
    id: 'embedded-jetbrains-mono',
    family: 'Orbit JetBrains Mono',
    cssStack: `'Orbit JetBrains Mono', ${CJK_MONO_FALLBACK}`,
    source: 'embedded',
    role: 'both',
    category: 'monospace',
    labelZh: 'JetBrains Mono',
    labelEn: 'JetBrains Mono',
    badgeZh: '内置 woff2',
    badgeEn: 'Built-in woff2',
    descriptionZh: '高 x 字高、锐利易读，内置编程连字与双字重（默认终端字体）',
    descriptionEn: 'Crisp developer monospace with high x-height and ligatures (Default Terminal)',
    supportsCjk: false,
    ligatures: true
  },
  {
    id: 'embedded-maple-mono',
    family: 'Orbit Maple Mono',
    cssStack: `'Orbit Maple Mono', ${CJK_MONO_FALLBACK}`,
    source: 'embedded',
    role: 'both',
    category: 'monospace',
    labelZh: 'Maple Mono · 圆润手写斜体',
    labelEn: 'Maple Mono',
    badgeZh: '内置 woff2',
    badgeEn: 'Built-in woff2',
    descriptionZh: '圆润舒适字形与优雅手写斜体，代码与终端视觉柔和不刺眼',
    descriptionEn: 'Rounded monospace with expressive cursive italics and smooth ligatures',
    supportsCjk: false,
    ligatures: true
  },
  {
    id: 'embedded-cascadia-code',
    family: 'Orbit Cascadia Code',
    cssStack: `'Orbit Cascadia Code', ${CJK_MONO_FALLBACK}`,
    source: 'embedded',
    role: 'terminal',
    category: 'monospace',
    labelZh: 'Cascadia Code · 现代终端连字',
    labelEn: 'Cascadia Code',
    badgeZh: '内置 woff2',
    badgeEn: 'Built-in woff2',
    descriptionZh: '内置制表符框线与 Powerline 符号子集，现代终端首选',
    descriptionEn: 'Modern terminal typeface with built-in box-drawing glyphs and ligatures',
    supportsCjk: false,
    ligatures: true
  },
  {
    id: 'embedded-fira-code',
    family: 'Orbit Fira Code',
    cssStack: `'Orbit Fira Code', ${CJK_MONO_FALLBACK}`,
    source: 'embedded',
    role: 'terminal',
    category: 'monospace',
    labelZh: 'Fira Code · 经典连字',
    labelEn: 'Fira Code',
    badgeZh: '内置 woff2',
    badgeEn: 'Built-in woff2',
    descriptionZh: '经典的运算符连字等宽字体，箭头与逻辑符号清晰醒目',
    descriptionEn: 'Classic ligature monospace with clean arithmetic and arrow combinations',
    supportsCjk: false,
    ligatures: true
  },
  {
    id: 'embedded-victor-mono',
    family: 'Orbit Victor Mono',
    cssStack: `'Orbit Victor Mono', ${CJK_MONO_FALLBACK}`,
    source: 'embedded',
    role: 'terminal',
    category: 'monospace',
    labelZh: 'Victor Mono · 纤细草书斜体',
    labelEn: 'Victor Mono',
    badgeZh: '内置 woff2',
    badgeEn: 'Built-in woff2',
    descriptionZh: '修长干练的几何等宽与飘逸斜体，高密度终端信息利器',
    descriptionEn: 'Slender high-density monospace paired with signature cursive italics',
    supportsCjk: false,
    ligatures: true
  },
  {
    id: 'embedded-ibm-plex-mono',
    family: 'Orbit IBM Plex Mono',
    cssStack: `'Orbit IBM Plex Mono', ${CJK_MONO_FALLBACK}`,
    source: 'embedded',
    role: 'both',
    category: 'monospace',
    labelZh: 'IBM Plex Mono · 工业质感',
    labelEn: 'IBM Plex Mono',
    badgeZh: '内置 woff2',
    badgeEn: 'Built-in woff2',
    descriptionZh: '中性克制的工业工程美感，数字与符号区分度极高',
    descriptionEn: 'Engineered neutrality with unmistakable distinction across glyphs',
    supportsCjk: false,
    ligatures: false
  },
  {
    id: 'embedded-geist-mono',
    family: 'Orbit Geist Mono',
    cssStack: `'Orbit Geist Mono', ${CJK_MONO_FALLBACK}`,
    source: 'embedded',
    role: 'both',
    category: 'monospace',
    labelZh: 'Geist Mono · 极简现代',
    labelEn: 'Geist Mono',
    badgeZh: '内置 woff2',
    badgeEn: 'Built-in woff2',
    descriptionZh: '现代极客工作台风格，冷峻精确的几何等宽字型',
    descriptionEn: 'Sharp contemporary geometric monospace built for dense developer interfaces',
    supportsCjk: false,
    ligatures: false
  },
  {
    id: 'embedded-lxgw-wenkai-mono',
    family: 'Orbit LXGW WenKai Mono',
    cssStack: `'Orbit LXGW WenKai Mono', 'JetBrains Mono', monospace`,
    source: 'embedded',
    role: 'both',
    category: 'monospace',
    labelZh: '霞鹜文楷等宽 · 中英一体',
    labelEn: 'LXGW WenKai Mono (CJK)',
    badgeZh: '内置中文 woff2',
    badgeEn: 'Built-in CJK woff2',
    descriptionZh: '全中英文温润楷体等宽字库，TUI 与中文输出浑然一体',
    descriptionEn: 'Warm bilingual CJK + Latin monospace with unified calligraphy strokes',
    supportsCjk: true,
    ligatures: false
  },

  // === Panel / UI & Display Embedded WOFF2 Fonts ===
  {
    id: 'embedded-lxgw-wenkai',
    family: 'Orbit LXGW WenKai',
    cssStack: `'Orbit LXGW WenKai', ${CJK_UI_FALLBACK}`,
    source: 'embedded',
    role: 'both',
    category: 'serif',
    labelZh: '霞鹜文楷 · 温润人文面板',
    labelEn: 'LXGW WenKai (CJK)',
    badgeZh: '内置中文 woff2',
    badgeEn: 'Built-in CJK woff2',
    descriptionZh: '清隽温润的中英文楷体，契合国风剑意与长文阅读体验',
    descriptionEn: 'Graceful bilingual CJK humanist kai script ideal for panels and headings',
    supportsCjk: true
  },
  {
    id: 'embedded-smiley-sans',
    family: 'Orbit Smiley Sans',
    cssStack: `'Orbit Smiley Sans', ${CJK_UI_FALLBACK}`,
    source: 'embedded',
    role: 'both',
    category: 'display',
    labelZh: '得意黑 · 锐意几何国潮',
    labelEn: 'Smiley Sans (CJK)',
    badgeZh: '内置中文 woff2',
    badgeEn: 'Built-in CJK woff2',
    descriptionZh: '兼具人文手绘感与现代斜切张力的中英双语显示字体',
    descriptionEn: 'Expressive oblique geometric CJK + Latin display typeface',
    supportsCjk: true
  },
  {
    id: 'embedded-inter',
    family: 'Orbit Inter',
    cssStack: `'Orbit Inter', ${CJK_UI_FALLBACK}`,
    source: 'embedded',
    role: 'panel',
    category: 'sans',
    labelZh: 'Inter · 现代中性界面',
    labelEn: 'Inter',
    badgeZh: '内置 woff2',
    badgeEn: 'Built-in woff2',
    descriptionZh: '专为屏幕面板优化的现代无衬线字体，英文数字极度清晰',
    descriptionEn: 'Purpose-built UI sans-serif with crisp tabular numerals and high clarity',
    supportsCjk: false
  },
  {
    id: 'embedded-plus-jakarta',
    family: 'Orbit Plus Jakarta Sans',
    cssStack: `'Orbit Plus Jakarta Sans', ${CJK_UI_FALLBACK}`,
    source: 'embedded',
    role: 'panel',
    category: 'sans',
    labelZh: 'Plus Jakarta Sans · 柔和几何',
    labelEn: 'Plus Jakarta Sans',
    badgeZh: '内置 woff2',
    badgeEn: 'Built-in woff2',
    descriptionZh: '干净大气的现代几何无衬线体，卡片与仪表盘观感出众',
    descriptionEn: 'Modern geometric sans-serif with balanced proportions for dashboards',
    supportsCjk: false
  },
  {
    id: 'embedded-outfit',
    family: 'Orbit Outfit',
    cssStack: `'Orbit Outfit', ${CJK_UI_FALLBACK}`,
    source: 'embedded',
    role: 'panel',
    category: 'sans',
    labelZh: 'Outfit · 极简圆润无衬线',
    labelEn: 'Outfit',
    badgeZh: '内置 woff2',
    badgeEn: 'Built-in woff2',
    descriptionZh: '柔和简洁的几何字型，兼具精致感与高可读性',
    descriptionEn: 'Minimalist geometric sans-serif with refined open apertures',
    supportsCjk: false
  },
  {
    id: 'embedded-cinzel',
    family: 'Orbit Cinzel',
    cssStack: `'Orbit Cinzel', ${CJK_DISPLAY_FALLBACK}`,
    source: 'embedded',
    role: 'display',
    category: 'display',
    labelZh: 'Cinzel · 古典铭文大标题',
    labelEn: 'Cinzel Display',
    badgeZh: '内置 woff2',
    badgeEn: 'Built-in woff2',
    descriptionZh: '古典铭文衬线体，适合英文界面标题与剑道仪式感徽标',
    descriptionEn: 'Classical inscribed serif display font for ceremonial titles',
    supportsCjk: false
  }
]

export const CURATED_SYSTEM_PRESETS: FontPresetOption[] = [
  {
    id: 'system-default-ui',
    family: 'Segoe UI Variable',
    cssStack: `'Segoe UI Variable', 'Segoe UI', 'Microsoft YaHei UI', 'PingFang SC', 'Noto Sans CJK SC', sans-serif`,
    source: 'system',
    role: 'panel',
    category: 'sans',
    labelZh: '系统默认面板字体',
    labelEn: 'System Default UI',
    badgeZh: '系统默认',
    badgeEn: 'System Default',
    descriptionZh: '自动匹配当前系统原生界面字体（Segoe UI / 微软雅黑 / 苹方 / Noto Sans）',
    descriptionEn: 'Follows native OS UI typeface (Segoe UI / YaHei / PingFang / Noto Sans)',
    supportsCjk: true
  },
  {
    id: 'system-default-display',
    family: 'STZhongsong',
    cssStack: CJK_DISPLAY_FALLBACK,
    source: 'system',
    role: 'display',
    category: 'serif',
    labelZh: '玄墨默认衬线 · 华文中宋',
    labelEn: 'Classic Serif · STZhongsong',
    badgeZh: '系统默认',
    badgeEn: 'System Default',
    descriptionZh: '华文中宋 / 思源宋体衬线字体，还原古典金石牌匾气质',
    descriptionEn: 'Classic Chinese & Latin serif display stack',
    supportsCjk: true
  },
  {
    id: 'system-consolas',
    family: 'Consolas',
    cssStack: `'Consolas', 'Microsoft YaHei UI', monospace`,
    source: 'system',
    role: 'terminal',
    category: 'monospace',
    labelZh: 'Consolas (Windows 经典)',
    labelEn: 'Consolas',
    badgeZh: '系统字体',
    badgeEn: 'System',
    descriptionZh: 'Windows 经典 ClearType 等宽终端字体',
    descriptionEn: 'Classic Windows ClearType monospace terminal font',
    supportsCjk: false
  },
  {
    id: 'system-cascadia-mono',
    family: 'Cascadia Mono',
    cssStack: `'Cascadia Mono', 'Microsoft YaHei UI', monospace`,
    source: 'system',
    role: 'terminal',
    category: 'monospace',
    labelZh: 'Cascadia Mono (系统版)',
    labelEn: 'Cascadia Mono (System)',
    badgeZh: '系统字体',
    badgeEn: 'System',
    descriptionZh: 'Windows Terminal 原生自带无连字等宽版本',
    descriptionEn: 'Windows Terminal native non-ligature monospace',
    supportsCjk: false
  },
  {
    id: 'system-microsoft-yahei',
    family: 'Microsoft YaHei UI',
    cssStack: `'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif`,
    source: 'system',
    role: 'panel',
    category: 'sans',
    labelZh: '微软雅黑 UI (Windows)',
    labelEn: 'Microsoft YaHei UI',
    badgeZh: '系统字体',
    badgeEn: 'System',
    descriptionZh: 'Windows 清晰高对比中英文面板黑体',
    descriptionEn: 'Sharp Windows Chinese & Latin sans-serif UI font',
    supportsCjk: true
  },
  {
    id: 'system-kaiti',
    family: 'KaiTi',
    cssStack: `'KaiTi', 'STKaiti', 'LXGW WenKai Lite', serif`,
    source: 'system',
    role: 'both',
    category: 'serif',
    labelZh: '楷体 (KaiTi / 华文楷体)',
    labelEn: 'KaiTi Calligraphy',
    badgeZh: '系统字体',
    badgeEn: 'System',
    descriptionZh: 'Windows / macOS 原生楷书字体',
    descriptionEn: 'System Chinese KaiTi script',
    supportsCjk: true
  },
  {
    id: 'system-fangsong',
    family: 'FangSong',
    cssStack: `'FangSong', 'STFangsong', serif`,
    source: 'system',
    role: 'both',
    category: 'serif',
    labelZh: '仿宋 (FangSong)',
    labelEn: 'FangSong Serif',
    badgeZh: '系统字体',
    badgeEn: 'System',
    descriptionZh: 'Windows / macOS 原生秀丽仿宋体',
    descriptionEn: 'System Chinese FangSong serif typeface',
    supportsCjk: true
  }
]

const PRESET_BY_ID = new Map<string, FontPresetOption>(
  [...EMBEDDED_FONT_PRESETS, ...CURATED_SYSTEM_PRESETS].map((item) => [item.id, item])
)

export function sanitizeCssFontStack(raw: string): string {
  return raw.replace(/[\r\n;{}<>]/g, '').trim()
}

export function quoteCssFontFamily(family: string): string {
  const clean = sanitizeCssFontStack(family).replace(/^['"]+|['"]+$/g, '')
  if (!clean) return 'monospace'
  if (/^[a-zA-Z0-9_-]+$/.test(clean)) return clean
  return `'${clean.replace(/'/g, "\\'")}'`
}

export function getEmbeddedFontById(id: string): FontPresetOption | undefined {
  return PRESET_BY_ID.get(id)
}

export function isDynamicSystemFontId(fontId: string): boolean {
  return fontId.startsWith('os:')
}

export function extractDynamicSystemFamily(fontId: string): string {
  return fontId.startsWith('os:') ? fontId.slice(3) : fontId
}

export function toDynamicSystemFontId(family: string): string {
  return `os:${family}`
}

export function getCuratedSystemFontsForPlatform(platform?: OrbitPlatform): SystemFontInfo[] {
  if (platform === 'linux') {
    return [
      { family: 'DejaVu Sans Mono', category: 'monospace' },
      { family: 'Liberation Mono', category: 'monospace' },
      { family: 'Ubuntu Mono', category: 'monospace' },
      { family: 'Noto Sans Mono', category: 'monospace' },
      { family: 'Noto Sans CJK SC', category: 'sans' },
      { family: 'Noto Serif CJK SC', category: 'serif' },
      { family: 'Ubuntu', category: 'sans' },
      { family: 'Cantarell', category: 'sans' }
    ]
  }
  if (platform === 'darwin') {
    return [
      { family: 'SF Mono', category: 'monospace' },
      { family: 'Menlo', category: 'monospace' },
      { family: 'Monaco', category: 'monospace' },
      { family: 'PingFang SC', category: 'sans' },
      { family: 'SF Pro Text', category: 'sans' },
      { family: 'STKaiti', category: 'serif' },
      { family: 'STSong', category: 'serif' }
    ]
  }
  return [
    { family: 'Consolas', category: 'monospace' },
    { family: 'Cascadia Mono', category: 'monospace' },
    { family: 'Cascadia Code', category: 'monospace' },
    { family: 'Courier New', category: 'monospace' },
    { family: 'Microsoft YaHei UI', category: 'sans' },
    { family: 'Segoe UI Variable', category: 'sans' },
    { family: 'Segoe UI', category: 'sans' },
    { family: 'DengXian', category: 'sans' },
    { family: 'STZhongsong', category: 'serif' },
    { family: 'KaiTi', category: 'serif' },
    { family: 'FangSong', category: 'serif' },
    { family: 'SimSun', category: 'monospace' }
  ]
}

export function mergeAvailableSystemFonts(
  discovered: SystemFontInfo[],
  platform?: OrbitPlatform
): SystemFontInfo[] {
  const byLower = new Map<string, SystemFontInfo>()
  for (const item of [...getCuratedSystemFontsForPlatform(platform), ...discovered]) {
    const key = item.family.toLowerCase()
    if (!byLower.has(key)) byLower.set(key, item)
  }
  return [...byLower.values()].sort((a, b) => a.family.localeCompare(b.family, 'en'))
}

export function resolveTerminalFontFamily(fontId: string, customFontStack = ''): string {
  if (fontId === 'custom') {
    const clean = sanitizeCssFontStack(customFontStack)
    return clean ? `${clean}, ${CJK_MONO_FALLBACK}` : PRESET_BY_ID.get(DEFAULT_TERMINAL_FONT_ID)!.cssStack
  }
  const preset = PRESET_BY_ID.get(fontId)
  if (preset) return preset.cssStack
  if (isDynamicSystemFontId(fontId)) {
    const family = extractDynamicSystemFamily(fontId)
    if (family) return `${quoteCssFontFamily(family)}, ${CJK_MONO_FALLBACK}`
  }
  return PRESET_BY_ID.get(DEFAULT_TERMINAL_FONT_ID)!.cssStack
}

export function resolvePanelFontFamily(fontId: string, customFontStack = ''): string {
  if (fontId === 'custom') {
    const clean = sanitizeCssFontStack(customFontStack)
    return clean ? `${clean}, ${CJK_UI_FALLBACK}` : PRESET_BY_ID.get(DEFAULT_PANEL_FONT_ID)!.cssStack
  }
  const preset = PRESET_BY_ID.get(fontId)
  if (preset) return preset.cssStack
  if (isDynamicSystemFontId(fontId)) {
    const family = extractDynamicSystemFamily(fontId)
    if (family) return `${quoteCssFontFamily(family)}, ${CJK_UI_FALLBACK}`
  }
  return PRESET_BY_ID.get(DEFAULT_PANEL_FONT_ID)!.cssStack
}

export function resolvePanelDisplayFontFamily(
  displayFontId: string,
  resolvedPanelFontFamily: string,
  customDisplayFontStack = ''
): string {
  if (displayFontId === 'follow-panel') return resolvedPanelFontFamily
  if (displayFontId === 'custom') {
    const clean = sanitizeCssFontStack(customDisplayFontStack)
    return clean ? `${clean}, ${CJK_DISPLAY_FALLBACK}` : resolvedPanelFontFamily
  }
  const preset = PRESET_BY_ID.get(displayFontId)
  if (preset) return preset.cssStack
  if (isDynamicSystemFontId(displayFontId)) {
    const family = extractDynamicSystemFamily(displayFontId)
    if (family) return `${quoteCssFontFamily(family)}, ${CJK_DISPLAY_FALLBACK}`
  }
  return PRESET_BY_ID.get(DEFAULT_PANEL_DISPLAY_FONT_ID)!.cssStack
}

export function getFontDisplayName(fontId: string, locale: 'zh-CN' | 'en-US', customFont = ''): string {
  if (fontId === 'follow-panel') {
    return locale === 'en-US' ? 'Follow Panel Body Font' : '跟随面板正文字体'
  }
  if (fontId === 'custom') {
    const clean = sanitizeCssFontStack(customFont)
    return clean || (locale === 'en-US' ? 'Custom Font Stack' : '自定义字体栈')
  }
  const preset = PRESET_BY_ID.get(fontId)
  if (preset) return locale === 'en-US' ? preset.labelEn : preset.labelZh
  if (isDynamicSystemFontId(fontId)) return extractDynamicSystemFamily(fontId)
  return fontId
}

export function hexToRgba(hex: string, alpha: number, fallbackHex = '#5ec4a6'): string {
  const safe = normalizeHexColor(hex, fallbackHex).replace('#', '')
  const r = Number.parseInt(safe.slice(0, 2), 16)
  const g = Number.parseInt(safe.slice(2, 4), 16)
  const b = Number.parseInt(safe.slice(4, 6), 16)
  const a = Math.max(0, Math.min(1, alpha))
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

export function resolveEffectiveTerminalTheme(
  themeId: TerminalThemeId,
  customEnabled: boolean,
  customColors: Partial<TerminalCustomColors>
): { theme: ITheme; background: string; borderGlow: string; headerBg: string } {
  const preset = getTerminalTheme(themeId)
  if (!customEnabled) {
    return {
      theme: preset.theme,
      background: preset.background,
      borderGlow: preset.borderGlow,
      headerBg: preset.headerBg
    }
  }
  const foreground = normalizeHexColor(customColors.foreground ?? '', preset.theme.foreground || '#ede7d9')
  const background = normalizeHexColor(customColors.background ?? '', preset.background)
  const cursor = normalizeHexColor(customColors.cursor ?? '', preset.theme.cursor || '#d4af63')
  const selectionHex = normalizeHexColor(customColors.selection ?? '', '#5ec4a6')
  return {
    theme: {
      ...preset.theme,
      foreground,
      background,
      cursor,
      cursorAccent: background,
      selectionBackground: hexToRgba(selectionHex, 0.3),
      selectionInactiveBackground: hexToRgba(selectionHex, 0.16)
    },
    background,
    borderGlow: hexToRgba(cursor, 0.34),
    headerBg: preset.headerBg
  }
}

export async function ensureFontFamilyLoaded(cssFontStack: string, fontSize = 14): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts?.load) return
  const primary = cssFontStack
    .split(',')[0]
    ?.trim()
    .replace(/^['"]+|['"]+$/g, '')
  if (!primary) return
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load(`400 ${fontSize}px "${primary}"`),
        document.fonts.load(`700 ${fontSize}px "${primary}"`)
      ]),
      new Promise<void>((resolve) => setTimeout(resolve, 1200))
    ])
  } catch {
    /* system fonts or offline load fallback */
  }
}

export interface PanelTypographySnapshot {
  fontId: string
  customFont: string
  displayFontId: string
  customDisplayFont: string
  fontSize: number
  fontWeight: string
  lineHeight: number
  letterSpacing: number
  customColorsEnabled: boolean
  textColors: PanelTextColors
}

export function applyPanelTypographyToDocument(config: PanelTypographySnapshot): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const uiFont = resolvePanelFontFamily(config.fontId, config.customFont)
  const displayFont = resolvePanelDisplayFontFamily(config.displayFontId, uiFont, config.customDisplayFont)
  const clampedSize = Math.min(20, Math.max(11, Number(config.fontSize) || 13))
  const scale = Number((clampedSize / 13).toFixed(4))
  const numericWeight = Number.parseInt(config.fontWeight, 10) || 400
  const headingWeight = Math.min(800, Math.max(500, numericWeight + 200))
  const lineHeight = Math.min(1.9, Math.max(1.15, Number(config.lineHeight) || 1.5))
  const letterSpacing = Math.min(3, Math.max(-0.5, Number(config.letterSpacing) || 0))

  root.style.setProperty('--font-ui', uiFont)
  root.style.setProperty('--font-display', displayFont)
  root.style.setProperty('--font-ui-size', `${clampedSize}px`)
  root.style.setProperty('--ui-font-scale', String(scale))
  root.style.setProperty('--font-ui-weight', String(numericWeight))
  root.style.setProperty('--font-ui-heading-weight', String(headingWeight))
  root.style.setProperty('--font-ui-line-height', String(lineHeight))
  root.style.setProperty('--font-ui-letter-spacing', `${letterSpacing}px`)

  if (config.customColorsEnabled) {
    const primary = normalizeHexColor(config.textColors.primary, DEFAULT_PANEL_TEXT_COLORS.primary)
    const secondary = normalizeHexColor(config.textColors.secondary, DEFAULT_PANEL_TEXT_COLORS.secondary)
    const muted = normalizeHexColor(config.textColors.muted, DEFAULT_PANEL_TEXT_COLORS.muted)
    const heading = normalizeHexColor(config.textColors.heading, primary)
    root.style.setProperty('--color-text-primary', primary)
    root.style.setProperty('--color-text-secondary', secondary)
    root.style.setProperty('--color-text-muted', muted)
    root.style.setProperty('--color-text-heading', heading)
  } else {
    root.style.removeProperty('--color-text-heading')
  }
}
