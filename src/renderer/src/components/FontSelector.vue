<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Check, ChevronDown, RefreshCw, Search, Sparkles } from '@lucide/vue'
import { instanceClass } from '../../../shared/classes'
import type { SystemFontInfo } from '../../../shared/contracts'
import {
  CURATED_SYSTEM_PRESETS,
  EMBEDDED_FONT_PRESETS,
  getFontDisplayName,
  quoteCssFontFamily,
  resolvePanelFontFamily,
  resolveTerminalFontFamily,
  toDynamicSystemFontId,
  type FontPresetOption
} from '../services/fonts'
import { locale, t } from '../services/i18n'
import { windowInstance } from '../stores/workbench'

type FilterTab = 'all' | 'embedded' | 'system-mono' | 'system'

interface PickerEntry {
  id: string
  label: string
  previewFamily: string
  badge: string
  description: string
  source: 'embedded' | 'system' | 'special'
  isMono: boolean
}

let pickerUid = 0
let activeCloseFn: (() => void) | null = null

const props = withDefaults(
  defineProps<{
    modelValue: string
    customValue?: string
    customPlaceholder?: string
    target: 'terminal' | 'panel' | 'display'
    systemFonts: SystemFontInfo[]
    systemFontsLoading?: boolean
    allowFollowPanel?: boolean
    instance: string
    ariaLabel?: string
  }>(),
  {
    customValue: '',
    customPlaceholder: '',
    systemFontsLoading: false,
    allowFollowPanel: false,
    ariaLabel: ''
  }
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:customValue': [value: string]
  refreshSystem: []
}>()

const uid = ++pickerUid
const tokenPrefix = computed(() => `${props.instance}-fp${uid}`)
const c = (base: string, suffix?: string) =>
  instanceClass(base, windowInstance(suffix ? `${tokenPrefix.value}-${suffix}` : tokenPrefix.value))

function entryToken(id: string): string {
  let hash = 2166136261
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  const slug = id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24)
  return `${slug || 'font'}-${(hash >>> 0).toString(36)}`
}

const rootRef = ref<HTMLElement>()
const triggerRef = ref<HTMLButtonElement>()
const popoverRef = ref<HTMLElement>()
const searchInputRef = ref<HTMLInputElement>()
const open = ref(false)
const filterTab = ref<FilterTab>('all')
const searchText = ref('')
const menuCoords = ref({ left: 0, top: 0, bottom: 0, width: 380, placement: 'bottom' as 'bottom' | 'top' })

const en = computed(() => locale.value === 'en-US')

const activeFontPreviewFamily = computed(() => {
  if (props.target === 'terminal') {
    return resolveTerminalFontFamily(props.modelValue, props.customValue)
  }
  return resolvePanelFontFamily(props.modelValue, props.customValue)
})

const activeDisplayLabel = computed(() =>
  getFontDisplayName(props.modelValue, locale.value, props.customValue)
)

function presetMatchesRole(preset: FontPresetOption): boolean {
  if (props.target === 'terminal') return preset.role === 'terminal' || preset.role === 'both'
  if (props.target === 'display')
    return preset.role === 'display' || preset.role === 'both' || preset.role === 'panel'
  return preset.role === 'panel' || preset.role === 'both'
}

const allEntries = computed<PickerEntry[]>(() => {
  const list: PickerEntry[] = []

  if (props.allowFollowPanel) {
    list.push({
      id: 'follow-panel',
      label: t('fontPicker.followPanelOption'),
      previewFamily: 'var(--font-ui)',
      badge: en.value ? 'Linked' : '联动',
      description: en.value
        ? 'Uses the exact same family as Panel Body Font'
        : '标题与面板正文保持统一字体风格',
      source: 'special',
      isMono: false
    })
  }

  for (const preset of EMBEDDED_FONT_PRESETS) {
    if (!presetMatchesRole(preset)) continue
    list.push({
      id: preset.id,
      label: en.value ? preset.labelEn : preset.labelZh,
      previewFamily: preset.cssStack,
      badge: en.value ? preset.badgeEn : preset.badgeZh,
      description: en.value ? preset.descriptionEn : preset.descriptionZh,
      source: 'embedded',
      isMono: preset.category === 'monospace'
    })
  }

  const seenSystemFamilies = new Set<string>()
  for (const sysPreset of CURATED_SYSTEM_PRESETS) {
    if (!presetMatchesRole(sysPreset)) continue
    seenSystemFamilies.add(sysPreset.family.toLowerCase())
    list.push({
      id: sysPreset.id,
      label: en.value ? sysPreset.labelEn : sysPreset.labelZh,
      previewFamily: sysPreset.cssStack,
      badge: en.value ? sysPreset.badgeEn : sysPreset.badgeZh,
      description: en.value ? sysPreset.descriptionEn : sysPreset.descriptionZh,
      source: 'system',
      isMono: sysPreset.category === 'monospace'
    })
  }

  for (const osFont of props.systemFonts) {
    if (seenSystemFamilies.has(osFont.family.toLowerCase())) continue
    seenSystemFamilies.add(osFont.family.toLowerCase())
    const isMono = osFont.category === 'monospace'
    list.push({
      id: toDynamicSystemFontId(osFont.family),
      label: osFont.family,
      previewFamily: quoteCssFontFamily(osFont.family),
      badge: isMono ? t('fontPicker.badgeMono') : t('fontPicker.badgeSystem'),
      description: en.value ? `OS installed ${osFont.category} font` : `系统已安装字体 · ${osFont.family}`,
      source: 'system',
      isMono
    })
  }

  list.push({
    id: 'custom',
    label: t('fontPicker.customOption'),
    previewFamily: 'inherit',
    badge: 'CSS',
    description: en.value ? 'Type any CSS font-family stack manually' : '手动输入任意本地或 CSS 字体栈',
    source: 'special',
    isMono: false
  })

  return list
})

const filteredEntries = computed(() => {
  const needle = searchText.value.trim().toLowerCase()
  return allEntries.value.filter((item) => {
    if (filterTab.value === 'embedded' && item.source !== 'embedded') return false
    if (filterTab.value === 'system-mono' && !(item.source === 'system' && item.isMono)) return false
    if (filterTab.value === 'system' && item.source !== 'system') return false
    if (!needle) return true
    return (
      item.label.toLowerCase().includes(needle) ||
      item.description.toLowerCase().includes(needle) ||
      item.badge.toLowerCase().includes(needle)
    )
  })
})

const menuStyle = computed<Record<string, string>>(() => {
  const style: Record<string, string> = {
    left: `${menuCoords.value.left}px`,
    width: `${menuCoords.value.width}px`
  }
  if (menuCoords.value.placement === 'top') {
    style.bottom = `${menuCoords.value.bottom}px`
  } else {
    style.top = `${menuCoords.value.top}px`
  }
  return style
})

function updateGeometry(): void {
  const trigger = triggerRef.value
  if (!trigger) return
  const rect = trigger.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  const width = Math.min(vw - 20, Math.max(rect.width, 430))
  const left = Math.min(Math.max(10, rect.left), Math.max(10, vw - width - 10))
  const estimatedHeight = 360
  const spaceBelow = vh - rect.bottom - 12
  const spaceAbove = rect.top - 12
  const placement = spaceBelow < estimatedHeight && spaceAbove > spaceBelow ? 'top' : 'bottom'
  menuCoords.value = {
    left: Math.round(left),
    top: Math.round(rect.bottom + 6),
    bottom: Math.round(vh - rect.top + 6),
    width: Math.round(width),
    placement
  }
}

function closeMenu(restoreFocus = false): void {
  if (!open.value) return
  try {
    popoverRef.value?.hidePopover?.()
  } catch {
    /* already closed */
  }
  open.value = false
  if (activeCloseFn === handleOutsideClose) activeCloseFn = null
  window.removeEventListener('pointerdown', onOutsidePointerDown, true)
  window.removeEventListener('resize', onViewportChange)
  window.removeEventListener('scroll', onViewportChange, true)
  if (restoreFocus) triggerRef.value?.focus()
}

function handleOutsideClose(): void {
  closeMenu(false)
}

function onOutsidePointerDown(event: PointerEvent): void {
  const target = event.target as Node | null
  if (!target) return
  if (rootRef.value?.contains(target) || popoverRef.value?.contains(target)) return
  closeMenu(false)
}

function onViewportChange(event?: Event): void {
  if (event?.type === 'scroll') {
    const target = event.target as Node | null
    if (target && popoverRef.value?.contains(target)) return
  }
  updateGeometry()
}

async function openMenu(): Promise<void> {
  if (activeCloseFn && activeCloseFn !== handleOutsideClose) activeCloseFn()
  activeCloseFn = handleOutsideClose
  updateGeometry()
  open.value = true
  window.addEventListener('pointerdown', onOutsidePointerDown, true)
  window.addEventListener('resize', onViewportChange)
  window.addEventListener('scroll', onViewportChange, true)
  await nextTick()
  updateGeometry()
  try {
    popoverRef.value?.showPopover?.()
  } catch {
    /* fixed fallback */
  }
  searchInputRef.value?.focus()
}

function toggleMenu(): void {
  if (open.value) closeMenu(true)
  else void openMenu()
}

function selectFont(entry: PickerEntry): void {
  emit('update:modelValue', entry.id)
  closeMenu(true)
}

watch(
  () => props.target,
  () => {
    filterTab.value = 'all'
    searchText.value = ''
  }
)

onBeforeUnmount(() => {
  closeMenu(false)
})
</script>

<template>
  <div ref="rootRef" :class="c('container_settings_fontpicker_root_base')">
    <button
      ref="triggerRef"
      :class="c('container_settings_fontpicker_trigger_btn')"
      type="button"
      role="combobox"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-label="ariaLabel || activeDisplayLabel"
      @click="toggleMenu"
    >
      <span
        :class="c('container_settings_fontpicker_trigger_name')"
        :style="{ fontFamily: modelValue === 'follow-panel' ? 'var(--font-ui)' : activeFontPreviewFamily }"
      >
        {{ activeDisplayLabel }}
      </span>
      <span
        :class="c('container_settings_fontpicker_trigger_sample')"
        :style="{ fontFamily: activeFontPreviewFamily }"
      >
        Aa中
      </span>
      <ChevronDown :size="14" :class="c('container_settings_fontpicker_trigger_chevron')" />
    </button>

    <input
      v-if="modelValue === 'custom'"
      :value="customValue"
      :class="c('container_settings_fontpicker_custom_input')"
      type="text"
      :placeholder="customPlaceholder"
      :aria-label="customPlaceholder"
      @input="emit('update:customValue', ($event.target as HTMLInputElement).value)"
    />

    <div
      v-if="open"
      ref="popoverRef"
      popover="manual"
      role="dialog"
      :aria-label="ariaLabel"
      :class="c('container_settings_fontpicker_popover_panel')"
      :style="menuStyle"
      @keydown.esc.stop.prevent="closeMenu(true)"
    >
      <div :class="c('container_settings_fontpicker_search_row')">
        <Search :size="13" />
        <input
          ref="searchInputRef"
          v-model="searchText"
          :class="c('container_settings_fontpicker_search_input')"
          type="search"
          :placeholder="t('fontPicker.searchPlaceholder')"
          :aria-label="t('fontPicker.searchPlaceholder')"
        />
        <button
          :class="c('container_settings_fontpicker_refresh_btn')"
          type="button"
          :disabled="systemFontsLoading"
          :title="t('fontPicker.refreshSystem')"
          @click="emit('refreshSystem')"
        >
          <RefreshCw :size="12" />
          {{ systemFontsLoading ? t('fontPicker.refreshing') : t('fontPicker.refreshSystem') }}
        </button>
      </div>

      <div :class="c('container_settings_fontpicker_tabs_row')" role="tablist">
        <button
          :class="c('container_settings_fontpicker_tab_all')"
          type="button"
          role="tab"
          :aria-selected="filterTab === 'all'"
          :data-active="filterTab === 'all'"
          @click="filterTab = 'all'"
        >
          {{ t('fontPicker.filterAll') }}
        </button>
        <button
          :class="c('container_settings_fontpicker_tab_embedded')"
          type="button"
          role="tab"
          :aria-selected="filterTab === 'embedded'"
          :data-active="filterTab === 'embedded'"
          @click="filterTab = 'embedded'"
        >
          <Sparkles :size="11" />
          {{ t('fontPicker.filterEmbedded') }}
        </button>
        <button
          v-if="target === 'terminal'"
          :class="c('container_settings_fontpicker_tab_sysmono')"
          type="button"
          role="tab"
          :aria-selected="filterTab === 'system-mono'"
          :data-active="filterTab === 'system-mono'"
          @click="filterTab = 'system-mono'"
        >
          {{ t('fontPicker.filterSystemMono') }}
        </button>
        <button
          :class="c('container_settings_fontpicker_tab_system')"
          type="button"
          role="tab"
          :aria-selected="filterTab === 'system'"
          :data-active="filterTab === 'system'"
          @click="filterTab = 'system'"
        >
          {{ t('fontPicker.filterSystem') }}
        </button>
      </div>

      <div :class="c('container_settings_fontpicker_list_scroll')" role="listbox">
        <button
          v-for="entry in filteredEntries"
          :key="entry.id"
          :class="c('container_settings_fontpicker_option_btn', entryToken(entry.id))"
          type="button"
          role="option"
          :aria-selected="modelValue === entry.id"
          :data-selected="modelValue === entry.id"
          @click="selectFont(entry)"
        >
          <div :class="c('container_settings_fontpicker_option_main', entryToken(entry.id))">
            <div :class="c('container_settings_fontpicker_option_head', entryToken(entry.id))">
              <strong
                :class="c('container_settings_fontpicker_option_name', entryToken(entry.id))"
                :style="{ fontFamily: entry.previewFamily }"
              >
                {{ entry.label }}
              </strong>
              <span
                :class="c('container_settings_fontpicker_option_badge', entryToken(entry.id))"
                :data-source="entry.source"
              >
                {{ entry.badge }}
              </span>
            </div>
            <span :class="c('container_settings_fontpicker_option_desc', entryToken(entry.id))">
              {{ entry.description }}
            </span>
          </div>
          <span
            v-if="entry.source !== 'special'"
            :class="c('container_settings_fontpicker_option_sample', entryToken(entry.id))"
            :style="{ fontFamily: entry.previewFamily }"
          >
            Aa 字 =&gt; 01
          </span>
          <Check
            v-if="modelValue === entry.id"
            :size="14"
            :class="c('container_settings_fontpicker_option_check', entryToken(entry.id))"
          />
        </button>
        <p v-if="!filteredEntries.length" :class="c('container_settings_fontpicker_empty_hint')">
          {{ t('fontPicker.noMatches') }}
        </p>
      </div>

      <footer :class="c('container_settings_fontpicker_footer_meta')">
        {{ t('fontPicker.systemCount', { count: systemFonts.length }) }}
      </footer>
    </div>
  </div>
</template>

<style scoped lang="scss">
[class*='container_settings_fontpicker_root_base'] {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  flex: 1;
}
[class*='container_settings_fontpicker_trigger_btn'] {
  width: 100%;
  min-height: 36px;
  padding: 6px 11px;
  justify-content: flex-start;
  gap: 8px;
  border-radius: 7px;
  border: 1px solid var(--color-border-control);
  background: var(--color-app-bg);
  color: var(--color-text-primary);
  text-align: left;
  &:hover {
    border-color: var(--color-accent-primary-ring);
    background: var(--color-surface-2);
  }
  &[aria-expanded='true'] {
    border-color: var(--color-accent-primary);
    box-shadow: 0 0 0 2px var(--color-accent-primary-ring);
  }
}
[class*='container_settings_fontpicker_trigger_name'] {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-ui-md);
}
[class*='container_settings_fontpicker_trigger_sample'] {
  flex-shrink: 0;
  font-size: 12px;
  padding: 2px 7px;
  border-radius: 4px;
  background: var(--color-surface-1);
  border: 1px solid var(--color-border);
  color: var(--color-accent-secondary);
}
[class*='container_settings_fontpicker_trigger_chevron'] {
  flex-shrink: 0;
  color: var(--color-text-muted);
}
[class*='container_settings_fontpicker_custom_input'] {
  width: 100%;
  font-family: var(--font-mono);
  font-size: var(--font-size-ui-sm);
}
[class*='container_settings_fontpicker_popover_panel'] {
  position: fixed;
  inset: auto;
  margin: 0;
  z-index: 3200;
  max-height: 390px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border-radius: 10px;
  border: 1px solid var(--color-border-control);
  background: var(--color-surface-2);
  background-image: var(--surface-card-gradient);
  box-shadow: var(--shadow-3d-dialog);
  color: var(--color-text-primary);
}
[class*='container_settings_fontpicker_search_row'] {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid var(--color-border-control);
  background: var(--color-app-bg);
  color: var(--color-text-muted);
}
[class*='container_settings_fontpicker_search_input'] {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  padding: 6px 2px;
  font-size: 12px;
  &:focus-visible {
    box-shadow: none;
  }
}
[class*='container_settings_fontpicker_refresh_btn'] {
  min-height: 24px;
  padding: 2px 7px;
  font-size: 11px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  color: var(--color-text-secondary);
  flex-shrink: 0;
}
[class*='container_settings_fontpicker_tabs_row'] {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
  > button {
    min-height: 24px;
    padding: 3px 8px;
    font-size: 11px;
    border-radius: 5px;
    border: 1px solid var(--color-border);
    background: var(--color-surface-1);
    color: var(--color-text-muted);
    &[data-active='true'] {
      border-color: var(--color-accent-primary);
      background: var(--color-accent-primary-soft);
      color: var(--color-accent-primary-hover);
      font-weight: 600;
    }
  }
}
[class*='container_settings_fontpicker_list_scroll'] {
  flex: 1;
  min-height: 120px;
  max-height: 240px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-right: 2px;
}
[class*='container_settings_fontpicker_option_btn'] {
  width: 100%;
  min-height: 46px;
  padding: 7px 10px;
  justify-content: flex-start;
  align-items: center;
  gap: 10px;
  border-radius: 7px;
  border: 1px solid transparent;
  background: transparent;
  text-align: left;
  &:hover {
    background: var(--color-accent-primary-soft);
  }
  &[data-selected='true'] {
    border-color: var(--color-accent-primary-ring);
    background: var(--color-accent-primary-soft);
  }
}
[class*='container_settings_fontpicker_option_main'] {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
[class*='container_settings_fontpicker_option_head'] {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
[class*='container_settings_fontpicker_option_name'] {
  font-size: 13px;
  color: var(--color-text-primary);
}
[class*='container_settings_fontpicker_option_badge'] {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  border: 1px solid var(--color-border);
  color: var(--color-text-muted);
  background: var(--color-surface-1);
  &[data-source='embedded'] {
    border-color: var(--color-accent-secondary-ring);
    background: var(--color-accent-secondary-soft);
    color: var(--color-accent-secondary);
  }
}
[class*='container_settings_fontpicker_option_desc'] {
  font-size: 11px;
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[class*='container_settings_fontpicker_option_sample'] {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--color-accent-primary-hover);
  padding: 3px 7px;
  border-radius: 4px;
  background: var(--color-app-bg);
  border: 1px solid var(--color-border-subtle);
}
[class*='container_settings_fontpicker_option_check'] {
  flex-shrink: 0;
  color: var(--color-accent-primary);
}
[class*='container_settings_fontpicker_empty_hint'] {
  margin: 16px auto;
  font-size: 12px;
  color: var(--color-text-muted);
}
[class*='container_settings_fontpicker_footer_meta'] {
  font-size: 11px;
  color: var(--color-text-muted);
  padding-top: 4px;
  border-top: 1px solid var(--color-border-subtle);
}
</style>
