import type { ITheme } from '@xterm/xterm'

export type TerminalThemeId =
  | 'orbit-vivid'
  | 'tokyo-night'
  | 'catppuccin-mocha'
  | 'dracula'
  | 'one-dark'
  | 'nord'
  | 'gruvbox-dark'
  | 'solarized-dark'

export type CursorShape = 'block' | 'bar' | 'underline'

export interface TerminalThemePreset {
  id: TerminalThemeId
  name: string
  badge: string
  background: string
  headerBg: string
  borderGlow: string
  swatches: [string, string, string, string, string, string]
  theme: ITheme
}

interface PaletteSpec {
  id: TerminalThemeId
  name: string
  badge: string
  background: string
  headerBg: string
  borderGlow: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
  selectionInactiveBackground: string
  ansi: {
    black: string
    red: string
    green: string
    yellow: string
    blue: string
    magenta: string
    cyan: string
    white: string
    brightBlack: string
    brightRed: string
    brightGreen: string
    brightYellow: string
    brightBlue: string
    brightMagenta: string
    brightCyan: string
    brightWhite: string
  }
}

function createPreset(spec: PaletteSpec): TerminalThemePreset {
  const { ansi } = spec
  return {
    id: spec.id,
    name: spec.name,
    badge: spec.badge,
    background: spec.background,
    headerBg: spec.headerBg,
    borderGlow: spec.borderGlow,
    swatches: [ansi.red, ansi.yellow, ansi.green, ansi.cyan, ansi.blue, ansi.magenta],
    theme: {
      background: spec.background,
      foreground: spec.foreground,
      cursor: spec.cursor,
      cursorAccent: spec.cursorAccent,
      selectionBackground: spec.selectionBackground,
      selectionInactiveBackground: spec.selectionInactiveBackground,
      scrollbarSliderBackground: 'rgba(196, 182, 152, 0.2)',
      scrollbarSliderHoverBackground: 'rgba(212, 175, 99, 0.42)',
      scrollbarSliderActiveBackground: 'rgba(212, 175, 99, 0.65)',
      overviewRulerBorder: 'rgba(212, 175, 99, 0.1)',
      ...ansi
    }
  }
}

export const TERMINAL_THEMES: TerminalThemePreset[] = [
  createPreset({
    id: 'orbit-vivid',
    name: '青冥古剑 · 玄墨',
    badge: '默认',
    background: '#080B0A',
    headerBg: 'linear-gradient(180deg, #131A18, #0B0F0E)',
    borderGlow: 'rgba(212, 175, 99, 0.34)',
    foreground: '#EDE7D9',
    cursor: '#D4AF63',
    cursorAccent: '#080B0A',
    selectionBackground: 'rgba(94, 196, 166, 0.28)',
    selectionInactiveBackground: 'rgba(212, 175, 99, 0.16)',
    ansi: {
      black: '#1D2421',
      red: '#E86B5D',
      green: '#5EC4A6',
      yellow: '#D9B25F',
      blue: '#6AA6D8',
      magenta: '#C58AC9',
      cyan: '#6AD1C2',
      white: '#DFD7C4',
      brightBlack: '#767164',
      brightRed: '#F48C80',
      brightGreen: '#7FD8BD',
      brightYellow: '#EAC87E',
      brightBlue: '#8DBEE6',
      brightMagenta: '#D8A7DC',
      brightCyan: '#8FE3D6',
      brightWhite: '#FBF7ED'
    }
  }),
  createPreset({
    id: 'tokyo-night',
    name: 'Tokyo Night · 东京夜色',
    badge: '高对比',
    background: '#1A1B26',
    headerBg: 'linear-gradient(180deg, #222436, #1A1B26)',
    borderGlow: 'rgba(122, 162, 247, 0.34)',
    foreground: '#C0CAF5',
    cursor: '#7AA2F7',
    cursorAccent: '#1A1B26',
    selectionBackground: 'rgba(122, 162, 247, 0.3)',
    selectionInactiveBackground: 'rgba(122, 162, 247, 0.15)',
    ansi: {
      black: '#15161E',
      red: '#F7768E',
      green: '#9ECE6A',
      yellow: '#E0AF68',
      blue: '#7AA2F7',
      magenta: '#BB9AF7',
      cyan: '#7DCFFF',
      white: '#A9B1D6',
      brightBlack: '#565F89',
      brightRed: '#FF9E64',
      brightGreen: '#B9F27C',
      brightYellow: '#FFD484',
      brightBlue: '#89DDFF',
      brightMagenta: '#D2A6FF',
      brightCyan: '#B4F9F8',
      brightWhite: '#ECEFF4'
    }
  }),
  createPreset({
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha · 摩卡星云',
    badge: '柔和炫彩',
    background: '#1E1E2E',
    headerBg: 'linear-gradient(180deg, #27273C, #1E1E2E)',
    borderGlow: 'rgba(203, 166, 247, 0.34)',
    foreground: '#CDD6F4',
    cursor: '#CBA6F7',
    cursorAccent: '#1E1E2E',
    selectionBackground: 'rgba(203, 166, 247, 0.28)',
    selectionInactiveBackground: 'rgba(203, 166, 247, 0.14)',
    ansi: {
      black: '#45475A',
      red: '#F38BA8',
      green: '#A6E3A1',
      yellow: '#F9E2AF',
      blue: '#89B4FA',
      magenta: '#F5C2E7',
      cyan: '#94E2D5',
      white: '#BAC2DE',
      brightBlack: '#6C7086',
      brightRed: '#F7A8BE',
      brightGreen: '#B8F0B4',
      brightYellow: '#FCEBCB',
      brightBlue: '#A9CAFC',
      brightMagenta: '#F8D4EF',
      brightCyan: '#B0EEE3',
      brightWhite: '#F5E0DC'
    }
  }),
  createPreset({
    id: 'dracula',
    name: 'Dracula · 暗夜伯爵',
    badge: '紫粉霓虹',
    background: '#1E1F29',
    headerBg: 'linear-gradient(180deg, #282A36, #1E1F29)',
    borderGlow: 'rgba(255, 121, 198, 0.34)',
    foreground: '#F8F8F2',
    cursor: '#FF79C6',
    cursorAccent: '#1E1F29',
    selectionBackground: 'rgba(189, 147, 249, 0.32)',
    selectionInactiveBackground: 'rgba(189, 147, 249, 0.16)',
    ansi: {
      black: '#21222C',
      red: '#FF5555',
      green: '#50FA7B',
      yellow: '#F1FA8C',
      blue: '#BD93F9',
      magenta: '#FF79C6',
      cyan: '#8BE9FD',
      white: '#F8F8F2',
      brightBlack: '#6272A4',
      brightRed: '#FF6E6E',
      brightGreen: '#69FF94',
      brightYellow: '#FFFFA5',
      brightBlue: '#D6ACFF',
      brightMagenta: '#FF92DF',
      brightCyan: '#A4FFFF',
      brightWhite: '#FFFFFF'
    }
  }),
  createPreset({
    id: 'one-dark',
    name: 'One Dark Pro · 极客经典',
    badge: '开发常用',
    background: '#1E222A',
    headerBg: 'linear-gradient(180deg, #252A34, #1E222A)',
    borderGlow: 'rgba(97, 175, 239, 0.32)',
    foreground: '#ABB2BF',
    cursor: '#61AFEF',
    cursorAccent: '#1E222A',
    selectionBackground: 'rgba(97, 175, 239, 0.28)',
    selectionInactiveBackground: 'rgba(97, 175, 239, 0.14)',
    ansi: {
      black: '#282C34',
      red: '#E06C75',
      green: '#98C379',
      yellow: '#E5C07B',
      blue: '#61AFEF',
      magenta: '#C678DD',
      cyan: '#56B6C2',
      white: '#D7DAE0',
      brightBlack: '#5C6370',
      brightRed: '#F28B94',
      brightGreen: '#B0DB91',
      brightYellow: '#F5D395',
      brightBlue: '#84C5FA',
      brightMagenta: '#DE9BF2',
      brightCyan: '#77D6E0',
      brightWhite: '#FFFFFF'
    }
  }),
  createPreset({
    id: 'nord',
    name: 'Nord · 极地冰川',
    badge: '冷色调',
    background: '#242933',
    headerBg: 'linear-gradient(180deg, #2E3440, #242933)',
    borderGlow: 'rgba(136, 192, 208, 0.34)',
    foreground: '#ECEFF4',
    cursor: '#88C0D0',
    cursorAccent: '#242933',
    selectionBackground: 'rgba(136, 192, 208, 0.28)',
    selectionInactiveBackground: 'rgba(136, 192, 208, 0.14)',
    ansi: {
      black: '#3B4252',
      red: '#BF616A',
      green: '#A3BE8C',
      yellow: '#EBCB8B',
      blue: '#81A1C1',
      magenta: '#B48EAD',
      cyan: '#88C0D0',
      white: '#E5E9F0',
      brightBlack: '#616E88',
      brightRed: '#D07E86',
      brightGreen: '#B9D3A3',
      brightYellow: '#F3D9A4',
      brightBlue: '#97B7D6',
      brightMagenta: '#CAA7C4',
      brightCyan: '#8FBCBB',
      brightWhite: '#FFFFFF'
    }
  }),
  createPreset({
    id: 'gruvbox-dark',
    name: 'Gruvbox · 复古暖金',
    badge: '暖色调',
    background: '#1D2021',
    headerBg: 'linear-gradient(180deg, #282828, #1D2021)',
    borderGlow: 'rgba(250, 189, 47, 0.3)',
    foreground: '#EBDBB2',
    cursor: '#FABD2F',
    cursorAccent: '#1D2021',
    selectionBackground: 'rgba(250, 189, 47, 0.26)',
    selectionInactiveBackground: 'rgba(250, 189, 47, 0.13)',
    ansi: {
      black: '#282828',
      red: '#FB4934',
      green: '#B8BB26',
      yellow: '#FABD2F',
      blue: '#83A598',
      magenta: '#D3869B',
      cyan: '#8EC07C',
      white: '#D5C4A1',
      brightBlack: '#928374',
      brightRed: '#FF6E5C',
      brightGreen: '#CFD446',
      brightYellow: '#FFD25A',
      brightBlue: '#9FC2B4',
      brightMagenta: '#E6A0B3',
      brightCyan: '#A9DA98',
      brightWhite: '#FBF1C7'
    }
  }),
  createPreset({
    id: 'solarized-dark',
    name: 'Solarized · 深海护眼',
    badge: '低疲劳',
    background: '#002B36',
    headerBg: 'linear-gradient(180deg, #073642, #002B36)',
    borderGlow: 'rgba(42, 161, 152, 0.36)',
    foreground: '#93A1A1',
    cursor: '#2AA198',
    cursorAccent: '#002B36',
    selectionBackground: 'rgba(42, 161, 152, 0.3)',
    selectionInactiveBackground: 'rgba(42, 161, 152, 0.15)',
    ansi: {
      black: '#073642',
      red: '#DC322F',
      green: '#859900',
      yellow: '#B58900',
      blue: '#268BD2',
      magenta: '#D33682',
      cyan: '#2AA198',
      white: '#EEE8D5',
      brightBlack: '#586E75',
      brightRed: '#CB4B16',
      brightGreen: '#9BB014',
      brightYellow: '#D4A519',
      brightBlue: '#4DA6E8',
      brightMagenta: '#EA5AA1',
      brightCyan: '#48C4BA',
      brightWhite: '#FDF6E3'
    }
  })
]

const THEME_MAP = new Map<string, TerminalThemePreset>(TERMINAL_THEMES.map((preset) => [preset.id, preset]))

export function getTerminalTheme(id?: string): TerminalThemePreset {
  if (id && THEME_MAP.has(id)) return THEME_MAP.get(id)!
  return TERMINAL_THEMES[0]!
}

export function cycleTerminalTheme(currentId: TerminalThemeId): TerminalThemeId {
  const index = TERMINAL_THEMES.findIndex((preset) => preset.id === currentId)
  const next = TERMINAL_THEMES[(index + 1) % TERMINAL_THEMES.length]!
  return next.id
}

export function buildShellColorizeCommand(kind: 'local' | 'ssh', profileId?: string): string {
  const isPosixShell =
    kind === 'ssh' ||
    profileId?.startsWith('wsl-') ||
    profileId === 'bash' ||
    profileId?.startsWith('bash-') ||
    profileId === 'zsh' ||
    profileId?.startsWith('zsh-') ||
    profileId === 'sh' ||
    profileId?.startsWith('sh-')
  if (isPosixShell) {
    return "export TERM=xterm-256color COLORTERM=truecolor CLICOLOR=1; alias ls='ls --color=auto' ll='ls -lah --color=auto' grep='grep --color=auto' ip='ip -c'; export PS1='\\[\\e[1;35m\\]●\\[\\e[0m\\] \\[\\e[1;32m\\]\\u@\\h\\[\\e[0m\\]:\\[\\e[1;36m\\]\\w\\[\\e[1;35m\\]\\$\\[\\e[0m\\] '\r"
  }
  if (profileId === 'fish' || profileId?.startsWith('fish-')) {
    return "set -gx TERM xterm-256color; set -gx COLORTERM truecolor; alias ls 'ls --color=auto'; alias grep 'grep --color=auto'\r"
  }
  if (profileId === 'cmd') {
    return 'prompt $E[95m●$E[0m $E[96m$P$E[90m›$E[0m \r'
  }
  return 'function global:prompt { "$([char]27)[95m●$([char]27)[0m $([char]27)[96m$($executionContext.SessionState.Path.CurrentLocation)$([char]27)[90m›$([char]27)[0m " }; if (Get-Module PSReadLine) { Set-PSReadLineOption -Colors @{ Command = "$([char]27)[93m"; Parameter = "$([char]27)[90m"; String = "$([char]27)[36m"; Variable = "$([char]27)[92m"; Number = "$([char]27)[95m"; Operator = "$([char]27)[37m" } }\r'
}
