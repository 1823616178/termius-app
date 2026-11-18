import { computed, ref } from 'vue'
import type { AppLocale } from '../../../shared/contracts'
import { zhCN, type TranslationKey } from './locales/zh-CN'
import { enUS } from './locales/en-US'

export type { TranslationKey }

export const locale = ref<AppLocale>('zh-CN')
export const isZh = computed(() => locale.value === 'zh-CN')

const DICTIONARIES: Record<AppLocale, Record<TranslationKey, string>> = {
  'zh-CN': zhCN,
  'en-US': enUS
}

export function parseAppLocale(raw: string | null | undefined): AppLocale {
  return raw === 'en-US' ? 'en-US' : 'zh-CN'
}

export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  const dict = DICTIONARIES[locale.value] ?? zhCN
  let template = dict[key] ?? zhCN[key] ?? key
  if (params) {
    for (const [paramKey, paramValue] of Object.entries(params)) {
      template = template.replaceAll(`{${paramKey}}`, String(paramValue))
    }
  }
  return template
}

export function applyLocaleToDocument(next: AppLocale): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = next
    document.documentElement.dataset.locale = next
  }
}

export function setLocale(next: AppLocale): void {
  locale.value = next
  applyLocaleToDocument(next)
  try {
    localStorage.setItem('orbit:locale', next)
  } catch {
    /* storage unavailable */
  }
  try {
    if (typeof window !== 'undefined') {
      void window.orbit?.locale?.set?.(next).catch(() => {})
    }
  } catch {
    /* bridge unavailable in unit tests */
  }
}

export function toggleLocale(): void {
  setLocale(locale.value === 'zh-CN' ? 'en-US' : 'zh-CN')
}

const SWORD_PHASE_MAP_EN: Record<string, string> = {
  '开阵启封 · 万锋初现': 'Formations Awakening · First Blades',
  '开阵启封 · 天剑破空': 'Opening Strike · Skyward Blade',
  '开阵启封 · 裂地渊鸣': 'Opening Strike · Earth Resonance',
  '开阵启封 · 万剑分身': 'Opening Strike · Myriad Shadows',
  '开阵启封 · 凌虚归阵': 'Opening Strike · Blades Aligned'
}

export function translateSwordPhaseLabel(rawLabel: string): string {
  if (locale.value === 'zh-CN') return rawLabel
  if (SWORD_PHASE_MAP_EN[rawLabel]) return SWORD_PHASE_MAP_EN[rawLabel]
  return rawLabel
}

const MOTION_REASON_MAP_EN: Record<string, string> = {
  正在检测图形与设备性能: 'Probing GPU & device capabilities',
  '系统已开启减少动态效果，已自动关闭': 'OS reduced-motion preference is enabled; animations off',
  '未检测到可用的 WebGL2，已关闭 3D 动效': 'WebGL2 unavailable; 3D animations disabled',
  '检测到软件渲染器，已关闭 3D 动效以节省资源': 'Software renderer detected; 3D disabled to save CPU',
  '设备处理器或内存资源不足，已自动关闭动效': 'Low CPU/memory hints; animations disabled',
  '设备资源有限，已自动启用轻量动效': 'Moderate hardware resources; light motion enabled',
  '图形与设备性能初检通过，将按实际帧率调整': 'Hardware check passed; adapting dynamically by FPS',
  '已强制开启完整动效，不会自动降级': 'Full motion forced by user preference',
  '已手动选择轻量动效，不会自动降级': 'Light motion selected manually',
  已手动关闭动效: 'Motion disabled manually',
  动效已关闭: 'Motion disabled',
  '实测帧率持续偏低，已切换轻量动效': 'Sustained low FPS detected; switched to light motion',
  '实测帧率持续偏低，已关闭动效': 'Sustained low FPS detected; animations disabled'
}

export function translateMotionReason(rawReason: string): string {
  if (locale.value === 'zh-CN') return rawReason
  if (MOTION_REASON_MAP_EN[rawReason]) return MOTION_REASON_MAP_EN[rawReason]
  const normalMatch = /^实测\s+(\d+)\s+fps，运行正常$/.exec(rawReason)
  if (normalMatch) return `Measured ${normalMatch[1]} fps, running smoothly`
  const probeMatch = /^实测\s+(\d+)\s+fps，继续观察性能$/.exec(rawReason)
  if (probeMatch) return `Measured ${probeMatch[1]} fps, monitoring performance`
  return rawReason
}
