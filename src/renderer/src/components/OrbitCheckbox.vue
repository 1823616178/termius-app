<script lang="ts">
let checkboxCounter = 0
</script>

<script setup lang="ts">
import { computed } from 'vue'
import { Check, Minus } from '@lucide/vue'
import { instanceClass, safeInstanceToken } from '../../../shared/classes'
import { windowInstance } from '../stores/workbench'

const props = withDefaults(
  defineProps<{
    modelValue?: boolean
    indeterminate?: boolean
    disabled?: boolean
    size?: 'sm' | 'md'
    ariaLabel?: string
    ariaDescribedby?: string
    title?: string
    instance?: string
  }>(),
  {
    modelValue: false,
    indeterminate: false,
    disabled: false,
    size: 'md',
    instance: 'default'
  }
)

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  change: [value: boolean]
}>()

const uid = ++checkboxCounter
const safeInstance = computed(() => safeInstanceToken(props.instance || 'default'))
const instanceToken = computed(() => windowInstance(`${safeInstance.value}-c${uid}`))
const c = (base: string) => instanceClass(base, instanceToken.value)

const checked = computed(() => Boolean(props.modelValue))
const ariaChecked = computed<'true' | 'false' | 'mixed'>(() =>
  props.indeterminate ? 'mixed' : checked.value ? 'true' : 'false'
)
const iconSize = computed(() => (props.size === 'sm' ? 10 : 11))

function toggle(): void {
  if (props.disabled) return
  const next = props.indeterminate ? true : !checked.value
  emit('update:modelValue', next)
  emit('change', next)
}
</script>

<template>
  <button
    type="button"
    role="checkbox"
    :class="c('container_common_checkbox_btn_base')"
    :aria-checked="ariaChecked"
    :aria-label="ariaLabel"
    :aria-describedby="ariaDescribedby"
    :title="title"
    :disabled="disabled"
    :data-checked="checked"
    :data-indeterminate="Boolean(indeterminate)"
    :data-size="size"
    @click="toggle"
  >
    <span :class="c('container_common_checkbox_mark_wrap')" aria-hidden="true">
      <Minus
        v-if="indeterminate"
        :size="iconSize"
        :stroke-width="3"
        :class="c('container_common_checkbox_icon_mixed')"
      />
      <Check
        v-else-if="checked"
        :size="iconSize"
        :stroke-width="3"
        :class="c('container_common_checkbox_icon_check')"
      />
    </span>
  </button>
</template>

<style scoped lang="scss">
.container_common_checkbox_btn_base {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  min-width: 16px;
  min-height: 16px;
  padding: 0;
  gap: 0;
  margin: 0;
  border-radius: 4.5px;
  border: 1px solid var(--color-border-control);
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.24), rgba(255, 255, 255, 0.03)), var(--color-app-bg);
  color: var(--color-text-on-accent);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.45);
  vertical-align: middle;
  cursor: pointer;
  outline: 0 none;
  transition:
    border-color 140ms ease,
    background 140ms ease,
    box-shadow 140ms ease,
    transform 110ms ease;

  &[data-size='sm'] {
    width: 14px;
    height: 14px;
    min-width: 14px;
    min-height: 14px;
    border-radius: 4px;
  }

  &:hover:not(:disabled) {
    border-color: var(--color-accent-primary-ring);
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(0, 0, 0, 0.14)), var(--color-surface-2);
    box-shadow: 0 0 0 2px var(--color-accent-primary-soft);
  }

  &[data-checked='true'],
  &[data-indeterminate='true'] {
    border-color: var(--color-accent-primary);
    background: linear-gradient(180deg, var(--color-accent-primary-hover), var(--color-accent-primary));
    color: var(--color-text-on-accent);
    box-shadow:
      0 2px 8px -2px var(--color-accent-primary-glow),
      inset 0 1px 0 rgba(255, 248, 224, 0.46);

    &:hover:not(:disabled) {
      border-color: var(--color-accent-primary-bright);
      background: linear-gradient(
        180deg,
        var(--color-accent-primary-bright),
        var(--color-accent-primary-hover)
      );
      box-shadow:
        0 3px 10px -2px var(--color-accent-primary-glow),
        inset 0 1px 0 rgba(255, 248, 224, 0.56);
    }
  }

  &:active:not(:disabled) {
    transform: scale(0.92);
  }

  &:focus,
  &:focus-visible {
    outline: 0 none;
  }

  &:focus-visible {
    border-color: var(--color-accent-primary);
    box-shadow: 0 0 0 2px var(--color-accent-primary-ring);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.42;
    box-shadow: none;
  }
}

.container_common_checkbox_mark_wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.container_common_checkbox_icon_check,
.container_common_checkbox_icon_mixed {
  display: block;
  flex-shrink: 0;
  animation: orbit-checkbox-pop 130ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes orbit-checkbox-pop {
  from {
    opacity: 0;
    transform: scale(0.55);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
</style>
