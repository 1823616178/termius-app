export type UiThemeId =
  | 'bagua-taiji'
  | 'wuxing-mu'
  | 'wuxing-huo'
  | 'wuxing-tu'
  | 'wuxing-jin'
  | 'wuxing-shui'
  | 'custom'

export interface UiThemeColors {
  appBg: string
  surface1: string
  surface2: string
  accentPrimary: string
  accentSecondary: string
  textPrimary: string
}

export type CustomUiColors = UiThemeColors

export interface UiThemePreset {
  id: Exclude<UiThemeId, 'custom'>
  name: string
  element: string
  trigram: string
  tagline: string
  colors: UiThemeColors
}

export const DEFAULT_CUSTOM_COLORS: UiThemeColors = {
  appBg: '#080b0a',
  surface1: '#101514',
  surface2: '#171e1c',
  accentPrimary: '#d4af63',
  accentSecondary: '#5ec4a6',
  textPrimary: '#efe9da'
}

export const UI_THEME_PRESETS: UiThemePreset[] = [
  {
    id: 'bagua-taiji',
    name: '玄墨古剑 · 太极剑阁',
    element: '太极两仪',
    trigram: '☰',
    tagline: '松烟玄墨配剑格鎏金，兼融青霜碧玉剑芒（默认）',
    colors: {
      appBg: '#080b0a',
      surface1: '#101514',
      surface2: '#171e1c',
      accentPrimary: '#d4af63',
      accentSecondary: '#5ec4a6',
      textPrimary: '#efe9da'
    }
  },
  {
    id: 'wuxing-mu',
    name: '东方青龙 · 苍篁竹剑',
    element: '木 · 青龙',
    trigram: '☳',
    tagline: '幽篁青竹映青锋，温润竹金蕴生机',
    colors: {
      appBg: '#07100c',
      surface1: '#0e1914',
      surface2: '#15251e',
      accentPrimary: '#34d399',
      accentSecondary: '#d1af68',
      textPrimary: '#e6f5ed'
    }
  },
  {
    id: 'wuxing-huo',
    name: '南方朱雀 · 赤霄丹剑',
    element: '火 · 朱雀',
    trigram: '☲',
    tagline: '朱砂丹炉淬赤霄，炉火玄炭映鎏金',
    colors: {
      appBg: '#120a09',
      surface1: '#1b100e',
      surface2: '#251614',
      accentPrimary: '#e66e4e',
      accentSecondary: '#e3b564',
      textPrimary: '#f7ece4'
    }
  },
  {
    id: 'wuxing-tu',
    name: '中央黄麟 · 昆仑古玉',
    element: '土 · 麒麟',
    trigram: '☷',
    tagline: '沉香古檀衬昆仑玉印，厚德载物剑心沉稳',
    colors: {
      appBg: '#0f0d09',
      surface1: '#18150f',
      surface2: '#231e15',
      accentPrimary: '#dfb45c',
      accentSecondary: '#66bfa0',
      textPrimary: '#f5eedc'
    }
  },
  {
    id: 'wuxing-jin',
    name: '西方白虎 · 太白霜锋',
    element: '金 · 白虎',
    trigram: '☱',
    tagline: '寒铁精钢配古铜剑格，清冽杀伐决断万里',
    colors: {
      appBg: '#090c10',
      surface1: '#11161c',
      surface2: '#19212a',
      accentPrimary: '#dce3ec',
      accentSecondary: '#d4af63',
      textPrimary: '#f0f3f8'
    }
  },
  {
    id: 'wuxing-shui',
    name: '北方玄武 · 沧溟寒渊',
    element: '水 · 玄武',
    trigram: '☵',
    tagline: '寒潭深渊映秋水古剑，静水流深收放自如',
    colors: {
      appBg: '#070b10',
      surface1: '#0f161f',
      surface2: '#16202c',
      accentPrimary: '#58b8d6',
      accentSecondary: '#cbb37c',
      textPrimary: '#e6eff6'
    }
  }
]

export function normalizeHexColor(value: string, fallback: string): string {
  const trimmed = value.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase()
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [, r, g, b] = trimmed.toLowerCase()
    return `#${r}${r}${g}${g}${b}${b}`
  }
  return fallback
}

function parseHexRgb(hex: string, fallback: [number, number, number]): [number, number, number] {
  const clean = hex.replace('#', '')
  if (clean.length !== 6) return fallback
  const r = Number.parseInt(clean.slice(0, 2), 16)
  const g = Number.parseInt(clean.slice(2, 4), 16)
  const b = Number.parseInt(clean.slice(4, 6), 16)
  if ([r, g, b].some(Number.isNaN)) return fallback
  return [r, g, b]
}

function mixHex(a: string, b: string, weightB: number): string {
  const [ar, ag, ab] = parseHexRgb(a, [16, 21, 20])
  const [br, bg, bb] = parseHexRgb(b, [239, 233, 218])
  const clamped = Math.max(0, Math.min(1, weightB))
  const r = Math.round(ar + (br - ar) * clamped)
  const g = Math.round(ag + (bg - ag) * clamped)
  const bl = Math.round(ab + (bb - ab) * clamped)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`
}

function darkenHex(hex: string, ratio: number): string {
  const [r, g, b] = parseHexRgb(hex, [8, 11, 10])
  const factor = Math.max(0, 1 - ratio)
  return `#${Math.round(r * factor)
    .toString(16)
    .padStart(2, '0')}${Math.round(g * factor)
    .toString(16)
    .padStart(2, '0')}${Math.round(b * factor)
    .toString(16)
    .padStart(2, '0')}`
}

function contrastTextForAccent(accentHex: string): string {
  const [r, g, b] = parseHexRgb(accentHex, [212, 175, 99])
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  return luminance > 0.52 ? '#101218' : '#f7f9fc'
}

function buildUiThemeVariables(c: UiThemeColors): Record<string, string> {
  const [ar, ag, ab] = parseHexRgb(c.accentPrimary, [212, 175, 99])
  const [sr, sg, sb] = parseHexRgb(c.accentSecondary, [94, 196, 166])

  return {
    '--color-app-bg': c.appBg,
    '--color-surface-1': c.surface1,
    '--color-surface-2': c.surface2,
    '--color-surface-chrome': mixHex(c.appBg, c.surface1, 0.65),
    '--color-surface-tab': mixHex(c.surface1, c.appBg, 0.35),
    '--color-surface-canvas': c.appBg,
    '--color-surface-terminal': c.appBg,
    '--color-terminal-bg': c.appBg,
    '--color-border': mixHex(c.surface2, c.accentPrimary, 0.16),
    '--color-border-subtle': mixHex(c.surface1, c.surface2, 0.55),
    '--color-border-control': mixHex(c.surface2, c.accentPrimary, 0.25),
    '--color-text-primary': c.textPrimary,
    '--color-text-secondary': mixHex(c.textPrimary, c.surface1, 0.26),
    '--color-text-muted': mixHex(c.textPrimary, c.surface1, 0.52),
    '--color-text-disabled': mixHex(c.textPrimary, c.surface1, 0.7),
    '--color-text-on-accent': contrastTextForAccent(c.accentPrimary),
    '--color-accent-primary': c.accentPrimary,
    '--color-accent-primary-hover': mixHex(c.accentPrimary, '#f8ecd0', 0.24),
    '--color-accent-primary-bright': mixHex(c.accentPrimary, '#fff6df', 0.42),
    '--color-accent-primary-soft': `rgba(${ar}, ${ag}, ${ab}, 0.12)`,
    '--color-accent-primary-ring': `rgba(${ar}, ${ag}, ${ab}, 0.36)`,
    '--color-accent-primary-glow': `rgba(${ar}, ${ag}, ${ab}, 0.28)`,
    '--color-accent-secondary': c.accentSecondary,
    '--color-accent-secondary-soft': `rgba(${sr}, ${sg}, ${sb}, 0.12)`,
    '--color-accent-secondary-ring': `rgba(${sr}, ${sg}, ${sb}, 0.36)`,
    '--color-accent-secondary-glow': `rgba(${sr}, ${sg}, ${sb}, 0.24)`,
    '--color-seal': '#c94c38',
    '--color-seal-soft': 'rgba(201, 76, 56, 0.16)',
    '--color-seal-ring': 'rgba(201, 76, 56, 0.44)',
    '--surface-card-gradient': `linear-gradient(162deg, ${mixHex(c.surface2, c.accentPrimary, 0.06)}, ${c.surface1} 58%, ${darkenHex(c.appBg, 0.1)})`,
    '--shadow-3d-card': `0 12px 26px -6px rgba(0, 0, 0, 0.62), 0 0 0 1px rgba(${ar}, ${ag}, ${ab}, 0.14), inset 0 1px 0 rgba(255, 244, 218, 0.08)`,
    '--shadow-3d-dialog': `0 26px 64px rgba(0, 0, 0, 0.78), 0 0 0 1px rgba(${ar}, ${ag}, ${ab}, 0.24), inset 0 1px 0 rgba(255, 244, 218, 0.11)`
  }
}

export function resolveUiThemeVariables(
  themeId: UiThemeId,
  custom?: Partial<UiThemeColors>
): Record<string, string> {
  if (themeId !== 'custom') {
    const preset = UI_THEME_PRESETS.find((item) => item.id === themeId) ?? UI_THEME_PRESETS[0]!
    return buildUiThemeVariables(preset.colors)
  }

  return buildUiThemeVariables({
    appBg: normalizeHexColor(custom?.appBg ?? '', DEFAULT_CUSTOM_COLORS.appBg),
    surface1: normalizeHexColor(custom?.surface1 ?? '', DEFAULT_CUSTOM_COLORS.surface1),
    surface2: normalizeHexColor(custom?.surface2 ?? '', DEFAULT_CUSTOM_COLORS.surface2),
    accentPrimary: normalizeHexColor(custom?.accentPrimary ?? '', DEFAULT_CUSTOM_COLORS.accentPrimary),
    accentSecondary: normalizeHexColor(custom?.accentSecondary ?? '', DEFAULT_CUSTOM_COLORS.accentSecondary),
    textPrimary: normalizeHexColor(custom?.textPrimary ?? '', DEFAULT_CUSTOM_COLORS.textPrimary)
  })
}

export function applyUiThemeToDocument(themeId: UiThemeId, custom?: Partial<UiThemeColors>): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const vars = resolveUiThemeVariables(themeId, custom)
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value)
  }
  root.dataset.uiTheme = themeId
}
