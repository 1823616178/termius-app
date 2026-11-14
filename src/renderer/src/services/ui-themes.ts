export type UiThemeId =
  | 'bagua-taiji'
  | 'wuxing-mu'
  | 'wuxing-huo'
  | 'wuxing-tu'
  | 'wuxing-jin'
  | 'wuxing-shui'
  | 'custom'

export interface CustomUiColors {
  appBg: string
  surface1: string
  surface2: string
  accentPrimary: string
  accentSecondary: string
  textPrimary: string
}

export interface UiThemePreset {
  id: Exclude<UiThemeId, 'custom'>
  name: string
  element: string
  trigram: string
  tagline: string
  colors: CustomUiColors
  surfaceChrome: string
  surfaceRail: string
  surfaceInput: string
  surfaceTab: string
  terminalBg: string
  border: string
  borderControl: string
  borderSubtle: string
  textSecondary: string
  textMuted: string
  textOnAccent: string
}

export const DEFAULT_CUSTOM_COLORS: CustomUiColors = {
  appBg: '#0b0d12',
  surface1: '#12151d',
  surface2: '#191d28',
  accentPrimary: '#a78bfa',
  accentSecondary: '#5bdcf4',
  textPrimary: '#e8ecf4'
}

export const UI_THEME_PRESETS: UiThemePreset[] = [
  {
    id: 'bagua-taiji',
    name: '太极玄曜 · 紫微星轨',
    element: '太极八卦',
    trigram: '☰☷',
    tagline: '玄紫星轨交融幽蓝清辉，默认均衡深空护眼配色',
    colors: {
      appBg: '#0b0d12',
      surface1: '#12151d',
      surface2: '#191d28',
      accentPrimary: '#a78bfa',
      accentSecondary: '#5bdcf4',
      textPrimary: '#e8ecf4'
    },
    surfaceChrome: '#10131b',
    surfaceRail: '#0f121a',
    surfaceInput: '#0c1018',
    surfaceTab: '#10131a',
    terminalBg: '#0d1016',
    border: '#2a3040',
    borderControl: '#3a435a',
    borderSubtle: '#242b3b',
    textSecondary: '#a5afc2',
    textMuted: '#8b96ad',
    textOnAccent: '#151021'
  },
  {
    id: 'wuxing-mu',
    name: '东方青龙 · 苍木生机',
    element: '五行·木',
    trigram: '☳☴',
    tagline: '甲乙震巽生发之气，青翠松篁映月，久视不倦',
    colors: {
      appBg: '#07100c',
      surface1: '#0d1914',
      surface2: '#13241d',
      accentPrimary: '#34d399',
      accentSecondary: '#2dd4bf',
      textPrimary: '#e6f4ee'
    },
    surfaceChrome: '#0b1511',
    surfaceRail: '#09120e',
    surfaceInput: '#07110d',
    surfaceTab: '#0c1712',
    terminalBg: '#08120e',
    border: '#1f3b2e',
    borderControl: '#2d5443',
    borderSubtle: '#1a3228',
    textSecondary: '#9ec4b4',
    textMuted: '#789e8f',
    textOnAccent: '#062017'
  },
  {
    id: 'wuxing-huo',
    name: '南方朱雀 · 丹霞流火',
    element: '五行·火',
    trigram: '☲',
    tagline: '丙丁离明曜焕，绯红丹砂与琥珀流光交织',
    colors: {
      appBg: '#120a0d',
      surface1: '#1c1015',
      surface2: '#26171d',
      accentPrimary: '#fb7185',
      accentSecondary: '#fbbf24',
      textPrimary: '#f7ecee'
    },
    surfaceChrome: '#170d11',
    surfaceRail: '#140b0e',
    surfaceInput: '#11090c',
    surfaceTab: '#190e13',
    terminalBg: '#120a0e',
    border: '#3f222c',
    borderControl: '#59313f',
    borderSubtle: '#331b24',
    textSecondary: '#ceb0b8',
    textMuted: '#a68590',
    textOnAccent: '#240910'
  },
  {
    id: 'wuxing-tu',
    name: '中央麒麟 · 钧天鎏金',
    element: '五行·土',
    trigram: '☷☶',
    tagline: '戊己坤艮厚德载物，玄墨玄武岩点缀赤金星芒',
    colors: {
      appBg: '#110f0a',
      surface1: '#1a1710',
      surface2: '#241f15',
      accentPrimary: '#f5b841',
      accentSecondary: '#fb923c',
      textPrimary: '#f5efe2'
    },
    surfaceChrome: '#15120c',
    surfaceRail: '#12100a',
    surfaceInput: '#0e0c08',
    surfaceTab: '#18140e',
    terminalBg: '#100e09',
    border: '#3b3322',
    borderControl: '#544830',
    borderSubtle: '#2f281b',
    textSecondary: '#c7bda8',
    textMuted: '#9e927c',
    textOnAccent: '#211805'
  },
  {
    id: 'wuxing-jin',
    name: '西方白虎 · 太白霜刃',
    element: '五行·金',
    trigram: '☰☱',
    tagline: '庚辛乾兑肃杀清冽，寒银铁幕映衬太白冰蓝',
    colors: {
      appBg: '#0a0e16',
      surface1: '#111724',
      surface2: '#182132',
      accentPrimary: '#60a5fa',
      accentSecondary: '#cbd5e1',
      textPrimary: '#f1f5f9'
    },
    surfaceChrome: '#0e1420',
    surfaceRail: '#0c111c',
    surfaceInput: '#090d16',
    surfaceTab: '#101624',
    terminalBg: '#0b101a',
    border: '#27344d',
    borderControl: '#384b6e',
    borderSubtle: '#202b40',
    textSecondary: '#adc0d9',
    textMuted: '#8397b5',
    textOnAccent: '#07172b'
  },
  {
    id: 'wuxing-shui',
    name: '北方玄武 · 溟渊玄水',
    element: '五行·水',
    trigram: '☵',
    tagline: '壬癸坎水灵动通玄，深海墨蓝蕴涵天青流波',
    colors: {
      appBg: '#060c14',
      surface1: '#0c1522',
      surface2: '#121f31',
      accentPrimary: '#22d3ee',
      accentSecondary: '#818cf8',
      textPrimary: '#e6f3fa'
    },
    surfaceChrome: '#0a121d',
    surfaceRail: '#080f19',
    surfaceInput: '#060c15',
    surfaceTab: '#0c1523',
    terminalBg: '#070e18',
    border: '#1c334d',
    borderControl: '#28496e',
    borderSubtle: '#17293f',
    textSecondary: '#9ec0d9',
    textMuted: '#7599b5',
    textOnAccent: '#051f26'
  }
]

function parseHexRgb(hex: string, fallback: [number, number, number]): [number, number, number] {
  const clean = hex.trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{6}$/.test(clean)) {
    return [parseInt(clean.slice(0, 2), 16), parseInt(clean.slice(2, 4), 16), parseInt(clean.slice(4, 6), 16)]
  }
  return fallback
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
  return `#${[clamp(r), clamp(g), clamp(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

function mixHex(hexA: string, hexB: string, t: number): string {
  const a = parseHexRgb(hexA, [18, 21, 29])
  const b = parseHexRgb(hexB, [255, 255, 255])
  return rgbToHex(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)
}

function contrastTextOn(accentHex: string): string {
  const [r, g, b] = parseHexRgb(accentHex, [167, 139, 250])
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luma > 0.54 ? '#101218' : '#f7f9fc'
}

export function resolveUiThemeVariables(
  themeId: UiThemeId,
  customColors: CustomUiColors = DEFAULT_CUSTOM_COLORS
): Record<string, string> {
  const preset = UI_THEME_PRESETS.find((item) => item.id === themeId)
  if (preset) {
    const hover = mixHex(preset.colors.accentPrimary, '#ffffff', 0.18)
    const [ar, ag, ab] = parseHexRgb(preset.colors.accentPrimary, [167, 139, 250])
    return {
      '--color-app-bg': preset.colors.appBg,
      '--color-surface-1': preset.colors.surface1,
      '--color-surface-2': preset.colors.surface2,
      '--color-surface-chrome': preset.surfaceChrome,
      '--color-surface-rail': preset.surfaceRail,
      '--color-surface-input': preset.surfaceInput,
      '--color-surface-tab': preset.surfaceTab,
      '--color-terminal-bg': preset.terminalBg,
      '--color-border': preset.border,
      '--color-border-control': preset.borderControl,
      '--color-border-subtle': preset.borderSubtle,
      '--color-text-primary': preset.colors.textPrimary,
      '--color-text-secondary': preset.textSecondary,
      '--color-text-muted': preset.textMuted,
      '--color-text-on-accent': preset.textOnAccent,
      '--color-accent-primary': preset.colors.accentPrimary,
      '--color-accent-primary-hover': hover,
      '--color-accent-primary-soft': `rgba(${ar}, ${ag}, ${ab}, 0.11)`,
      '--color-accent-primary-ring': `rgba(${ar}, ${ag}, ${ab}, 0.34)`,
      '--color-accent-secondary': preset.colors.accentSecondary,
      '--surface-card-gradient': `linear-gradient(160deg, ${mixHex(preset.colors.surface2, '#ffffff', 0.04)}, ${preset.colors.surface1} 58%, ${preset.colors.appBg})`
    }
  }

  const c = customColors
  const [ar, ag, ab] = parseHexRgb(c.accentPrimary, [167, 139, 250])
  return {
    '--color-app-bg': c.appBg,
    '--color-surface-1': c.surface1,
    '--color-surface-2': c.surface2,
    '--color-surface-chrome': mixHex(c.appBg, c.surface1, 0.72),
    '--color-surface-rail': mixHex(c.appBg, c.surface1, 0.55),
    '--color-surface-input': mixHex(c.appBg, '#000000', 0.14),
    '--color-surface-tab': mixHex(c.appBg, c.surface1, 0.7),
    '--color-terminal-bg': mixHex(c.appBg, '#000000', 0.08),
    '--color-border': mixHex(c.surface2, c.textPrimary, 0.14),
    '--color-border-control': mixHex(c.surface2, c.textPrimary, 0.22),
    '--color-border-subtle': mixHex(c.surface1, c.textPrimary, 0.1),
    '--color-text-primary': c.textPrimary,
    '--color-text-secondary': mixHex(c.textPrimary, c.appBg, 0.32),
    '--color-text-muted': mixHex(c.textPrimary, c.appBg, 0.48),
    '--color-text-on-accent': contrastTextOn(c.accentPrimary),
    '--color-accent-primary': c.accentPrimary,
    '--color-accent-primary-hover': mixHex(c.accentPrimary, '#ffffff', 0.18),
    '--color-accent-primary-soft': `rgba(${ar}, ${ag}, ${ab}, 0.12)`,
    '--color-accent-primary-ring': `rgba(${ar}, ${ag}, ${ab}, 0.36)`,
    '--color-accent-secondary': c.accentSecondary,
    '--surface-card-gradient': `linear-gradient(160deg, ${mixHex(c.surface2, '#ffffff', 0.05)}, ${c.surface1} 58%, ${c.appBg})`
  }
}

export function applyUiThemeToDocument(
  themeId: UiThemeId,
  customColors: CustomUiColors = DEFAULT_CUSTOM_COLORS
): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.dataset.uiTheme = themeId
  const vars = resolveUiThemeVariables(themeId, customColors)
  for (const [prop, val] of Object.entries(vars)) {
    root.style.setProperty(prop, val)
  }
}
