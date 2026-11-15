<script lang="ts">
export interface OrbitSelectOption {
  value: string
  label: string
  hint?: string
  swatch?: string
  disabled?: boolean
}

let selectCounter = 0
let activeCloseCallback: (() => void) | null = null
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Check, ChevronDown } from 'lucide-vue-next'
import { instanceClass } from '../../../shared/classes'
import { windowInstance } from '../stores/workbench'

const props = withDefaults(
  defineProps<{
    modelValue?: string
    options: OrbitSelectOption[]
    placeholder?: string
    ariaLabel?: string
    title?: string
    disabled?: boolean
    size?: 'sm' | 'md'
    block?: boolean
    width?: string
    instance?: string
  }>(),
  {
    modelValue: '',
    placeholder: '请选择…',
    size: 'md',
    block: false,
    disabled: false,
    instance: 'default'
  }
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: [value: string]
}>()

const uid = ++selectCounter
const safeInstance = computed(
  () =>
    props.instance
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'default'
)
const instanceToken = computed(() => windowInstance(`${safeInstance.value}-s${uid}`))
const c = (base: string, optIndex?: number) =>
  instanceClass(base, optIndex !== undefined ? `${instanceToken.value}-o${optIndex}` : instanceToken.value)

const listboxId = computed(() => `orbit-listbox-${instanceToken.value}`)
const rootRef = ref<HTMLElement>()
const triggerRef = ref<HTMLButtonElement>()
const menuRef = ref<HTMLElement>()
const open = ref(false)
const highlightedIndex = ref(-1)
const menuPlacement = ref<'bottom' | 'top'>('bottom')
const menuCoords = ref<{ left: number; top: number; bottom: number; width: number }>({
  left: 0,
  top: 0,
  bottom: 0,
  width: 180
})

const selectedOption = computed(() => props.options.find((item) => item.value === props.modelValue))
const displayLabel = computed(() => selectedOption.value?.label || props.placeholder)

const menuStyle = computed<Record<string, string>>(() => {
  const base: Record<string, string> = {
    left: `${menuCoords.value.left}px`,
    minWidth: `${menuCoords.value.width}px`
  }
  if (menuPlacement.value === 'top') {
    base.bottom = `${menuCoords.value.bottom}px`
  } else {
    base.top = `${menuCoords.value.top}px`
  }
  return base
})

function updateMenuGeometry() {
  const trigger = triggerRef.value
  if (!trigger) return
  const rect = trigger.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  const estimatedWidth = Math.min(vw - 16, Math.max(rect.width, props.size === 'sm' ? 176 : 196))
  const left = Math.min(Math.max(8, rect.left), Math.max(8, vw - estimatedWidth - 8))
  const estimatedHeight = Math.min(280, Math.max(64, props.options.length * 34 + 12))
  const spaceBelow = vh - rect.bottom - 10
  const spaceAbove = rect.top - 10
  const openUpward = spaceBelow < estimatedHeight && spaceAbove > spaceBelow
  menuPlacement.value = openUpward ? 'top' : 'bottom'
  menuCoords.value = {
    left: Math.round(left),
    top: Math.round(rect.bottom + 5),
    bottom: Math.round(vh - rect.top + 5),
    width: Math.round(estimatedWidth)
  }
}

function findNextEnabled(start: number, step: 1 | -1): number {
  const total = props.options.length
  if (!total) return -1
  let idx = start
  for (let i = 0; i < total; i++) {
    idx = (idx + step + total) % total
    if (!props.options[idx]?.disabled) return idx
  }
  return -1
}

function closeMenu(returnFocus = false) {
  if (!open.value) return
  try {
    menuRef.value?.hidePopover?.()
  } catch {
    /* popover already closed */
  }
  open.value = false
  if (activeCloseCallback === handleExternalClose) activeCloseCallback = null
  window.removeEventListener('pointerdown', onDocumentPointerDown, true)
  window.removeEventListener('resize', onViewportChange)
  window.removeEventListener('scroll', onViewportChange, true)
  if (returnFocus) triggerRef.value?.focus()
}

function handleExternalClose() {
  closeMenu(false)
}

async function openMenu() {
  if (props.disabled || !props.options.length) return
  if (activeCloseCallback && activeCloseCallback !== handleExternalClose) {
    activeCloseCallback()
  }
  activeCloseCallback = handleExternalClose
  updateMenuGeometry()
  const selectedIdx = props.options.findIndex((item) => item.value === props.modelValue && !item.disabled)
  highlightedIndex.value = selectedIdx >= 0 ? selectedIdx : findNextEnabled(-1, 1)
  open.value = true
  window.addEventListener('pointerdown', onDocumentPointerDown, true)
  window.addEventListener('resize', onViewportChange)
  window.addEventListener('scroll', onViewportChange, true)
  await nextTick()
  updateMenuGeometry()
  try {
    menuRef.value?.showPopover?.()
  } catch {
    /* fallback to fixed CSS positioning */
  }
}

function toggleMenu() {
  if (open.value) closeMenu(true)
  else void openMenu()
}

function selectOption(option: OrbitSelectOption) {
  if (option.disabled) return
  if (option.value !== props.modelValue) {
    emit('update:modelValue', option.value)
    emit('change', option.value)
  }
  closeMenu(true)
}

function onDocumentPointerDown(event: PointerEvent) {
  const target = event.target as Node | null
  if (!target) return
  if (rootRef.value?.contains(target) || menuRef.value?.contains(target)) return
  closeMenu(false)
}

function onViewportChange(event?: Event) {
  if (event?.type === 'scroll') {
    const target = event.target as Node | null
    if (target && menuRef.value?.contains(target)) return
  }
  updateMenuGeometry()
}

function onTriggerKeydown(event: KeyboardEvent) {
  if (props.disabled) return
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    if (!open.value) {
      void openMenu()
    } else {
      highlightedIndex.value = findNextEnabled(highlightedIndex.value, 1)
    }
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    if (!open.value) {
      void openMenu()
    } else {
      highlightedIndex.value = findNextEnabled(highlightedIndex.value < 0 ? 0 : highlightedIndex.value, -1)
    }
    return
  }
  if (event.key === 'Home' && open.value) {
    event.preventDefault()
    highlightedIndex.value = findNextEnabled(-1, 1)
    return
  }
  if (event.key === 'End' && open.value) {
    event.preventDefault()
    highlightedIndex.value = findNextEnabled(props.options.length, -1)
    return
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    if (!open.value) {
      void openMenu()
    } else if (highlightedIndex.value >= 0) {
      const target = props.options[highlightedIndex.value]
      if (target) selectOption(target)
    }
    return
  }
  if (event.key === 'Escape' && open.value) {
    event.preventDefault()
    event.stopPropagation()
    closeMenu(true)
    return
  }
  if (event.key === 'Tab' && open.value) {
    closeMenu(false)
  }
}

watch(
  () => props.disabled,
  (isDisabled) => {
    if (isDisabled && open.value) closeMenu(false)
  }
)

onBeforeUnmount(() => {
  closeMenu(false)
})
</script>

<template>
  <div
    ref="rootRef"
    :class="c('container_common_select_root_base')"
    :data-size="size"
    :data-block="block"
    :data-open="open"
    :data-disabled="disabled"
    :style="width ? { width } : undefined"
  >
    <button
      ref="triggerRef"
      :class="c('container_common_select_trigger_btn')"
      type="button"
      role="combobox"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-controls="listboxId"
      :aria-label="ariaLabel"
      :title="title"
      :disabled="disabled"
      :data-open="open"
      :data-size="size"
      @click.prevent="toggleMenu"
      @keydown="onTriggerKeydown"
    >
      <span
        v-if="selectedOption?.swatch"
        :class="c('container_common_select_trigger_swatch')"
        :style="{ background: selectedOption.swatch }"
        aria-hidden="true"
      />
      <span :class="c('container_common_select_trigger_label')" :data-placeholder="!selectedOption">
        {{ displayLabel }}
      </span>
      <ChevronDown :size="size === 'sm' ? 13 : 14" :class="c('container_common_select_trigger_chevron')" />
    </button>

    <div
      v-if="open"
      :id="listboxId"
      ref="menuRef"
      popover="manual"
      role="listbox"
      :aria-label="ariaLabel || placeholder"
      :class="c('container_common_select_menu_popover')"
      :data-placement="menuPlacement"
      :style="menuStyle"
      @click.stop
    >
      <button
        v-for="(option, optIndex) in options"
        :key="option.value"
        type="button"
        role="option"
        :class="c('container_common_select_option_btn', optIndex)"
        :aria-selected="option.value === modelValue"
        :disabled="option.disabled"
        :data-selected="option.value === modelValue"
        :data-highlighted="highlightedIndex === optIndex"
        @mouseenter="highlightedIndex = optIndex"
        @click.stop="selectOption(option)"
      >
        <span
          v-if="option.swatch"
          :class="c('container_common_select_option_swatch', optIndex)"
          :style="{ background: option.swatch }"
          aria-hidden="true"
        />
        <span :class="c('container_common_select_option_label', optIndex)">{{ option.label }}</span>
        <span v-if="option.hint" :class="c('container_common_select_option_hint', optIndex)">
          {{ option.hint }}
        </span>
        <Check
          v-if="option.value === modelValue"
          :size="13"
          :class="c('container_common_select_option_check', optIndex)"
        />
      </button>
    </div>
  </div>
</template>

<style scoped lang="scss">
.container_common_select_root_base {
  position: relative;
  display: inline-flex;
  align-items: center;
  min-width: 0;
  max-width: 100%;
  &[data-block='true'] {
    display: flex;
    width: 100%;
  }
}
.container_common_select_trigger_btn {
  width: 100%;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  gap: 7px;
  min-height: 34px;
  padding: 6px 10px;
  border-radius: 7px;
  border: 1px solid var(--color-border-control);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(0, 0, 0, 0.14)), var(--color-surface-input);
  color: var(--color-text-primary);
  font-size: 13px;
  font-weight: 400;
  text-align: left;
  cursor: pointer;
  outline: 0 none;
  transition:
    border-color 140ms ease,
    background 140ms ease,
    box-shadow 140ms ease;
  &:hover:not(:disabled) {
    border-color: var(--color-accent-primary-ring);
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.055), rgba(0, 0, 0, 0.12)), var(--color-surface-2);
  }
  &[data-open='true'] {
    border-color: var(--color-accent-primary);
    box-shadow: 0 0 0 2px var(--color-accent-primary-ring);
  }
  &:focus,
  &:focus-visible {
    outline: 0 none;
  }
  &:focus-visible {
    border-color: var(--color-accent-primary);
    box-shadow: 0 0 0 2px var(--color-accent-primary-ring);
  }
  &[data-size='sm'] {
    min-height: 26px;
    height: 26px;
    padding: 2px 8px;
    font-size: 11px;
    border-radius: 6px;
    gap: 6px;
  }
}
.container_common_select_trigger_swatch {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  border: 1px solid rgba(255, 255, 255, 0.28);
}
.container_common_select_trigger_label {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--color-text-primary);
  &[data-placeholder='true'] {
    color: var(--color-text-muted);
  }
}
.container_common_select_trigger_chevron {
  flex-shrink: 0;
  margin-left: auto;
  color: var(--color-text-muted);
  transition: transform 160ms cubic-bezier(0.22, 1, 0.36, 1);
  .container_common_select_trigger_btn[data-open='true'] & {
    transform: rotate(180deg);
    color: var(--color-accent-primary-hover);
  }
}
.container_common_select_menu_popover {
  position: fixed;
  inset: auto;
  margin: 0;
  z-index: 3000;
  max-width: calc(100vw - 16px);
  max-height: 280px;
  overflow-y: auto;
  padding: 5px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-radius: 10px;
  border: 1px solid var(--color-border-control);
  background-color: var(--color-surface-2);
  background-image: var(--surface-card-gradient);
  box-shadow: var(--shadow-3d-dialog);
  animation: orbit-select-enter 110ms cubic-bezier(0.22, 1, 0.36, 1);
  &[data-placement='top'] {
    transform-origin: bottom center;
  }
  &[data-placement='bottom'] {
    transform-origin: top center;
  }
}
.container_common_select_option_btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  min-height: 30px;
  padding: 6px 9px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition:
    background 110ms ease,
    color 110ms ease,
    border-color 110ms ease;
  &:focus,
  &:focus-visible {
    outline: 0 none;
  }
  &[data-highlighted='true']:not(:disabled),
  &:hover:not(:disabled) {
    background: var(--color-accent-primary-soft);
    color: var(--color-text-primary);
  }
  &[data-selected='true'] {
    background: var(--color-accent-primary-soft);
    border-color: var(--color-accent-primary-ring);
    color: var(--color-text-primary);
    font-weight: 500;
  }
}
.container_common_select_option_swatch {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
  border: 1px solid rgba(255, 255, 255, 0.28);
}
.container_common_select_option_label {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.container_common_select_option_hint {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  color: var(--color-accent-secondary);
  background: var(--color-accent-secondary-soft);
  border: 1px solid var(--color-accent-secondary-ring);
  flex-shrink: 0;
}
.container_common_select_option_check {
  flex-shrink: 0;
  color: var(--color-accent-primary-hover);
}
@keyframes orbit-select-enter {
  from {
    opacity: 0.98;
    transform: translateY(-4px) scale(0.985);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
</style>
