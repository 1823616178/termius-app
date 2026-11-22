<script setup lang="ts">
import { computed } from 'vue'
import { Copy, Palette, RotateCcw, Sparkles, Terminal, Type } from '@lucide/vue'
import {
  DEFAULT_PANEL_TEXT_COLORS,
  resolveEffectiveTerminalTheme,
  resolvePanelDisplayFontFamily,
  resolvePanelFontFamily,
  resolveTerminalFontFamily
} from '../services/fonts'
import { locale, t } from '../services/i18n'
import {
  copyOnSelect,
  fontSize,
  lineHeight,
  loadSystemFonts,
  panelCopyOnSelect,
  panelCustomColors,
  panelCustomColorsEnabled,
  panelCustomDisplayFont,
  panelCustomFont,
  panelDisplayFontId,
  panelFontId,
  panelFontSize,
  panelFontWeight,
  panelLetterSpacing,
  panelLineHeight,
  resetPanelTypography,
  resetTerminalTypography,
  syncTerminalCustomColorsWithPreset,
  systemFonts,
  systemFontsLoading,
  terminalCustomColors,
  terminalCustomColorsEnabled,
  terminalCustomFont,
  terminalFontId,
  terminalFontWeight,
  terminalFontWeightBold,
  terminalLetterSpacing,
  terminalLigatures,
  terminalMinimumContrast,
  terminalTheme
} from '../stores/workbench'
import FontSelector from './FontSelector.vue'
import OrbitCheckbox from './OrbitCheckbox.vue'
import OrbitSelect from './OrbitSelect.vue'

withDefaults(
  defineProps<{
    section?: 'panel' | 'terminal' | 'both'
  }>(),
  { section: 'both' }
)

const panelWeightOptions = computed(() => {
  void locale.value
  return [
    { value: '300', label: t('fontPicker.weightLight') },
    { value: '400', label: t('fontPicker.weightRegular') },
    { value: '500', label: t('fontPicker.weightMedium') },
    { value: '600', label: t('fontPicker.weightSemiBold') },
    { value: '700', label: t('fontPicker.weightBold') }
  ]
})

const terminalWeightOptions = computed(() => {
  void locale.value
  return [
    { value: '300', label: t('fontPicker.weightLight') },
    { value: '400', label: t('fontPicker.weightRegular') },
    { value: '500', label: t('fontPicker.weightMedium') },
    { value: '600', label: t('fontPicker.weightSemiBold') },
    { value: '700', label: t('fontPicker.weightBold') }
  ]
})

const terminalBoldWeightOptions = computed(() => {
  void locale.value
  return [
    { value: '500', label: t('fontPicker.weightMedium') },
    { value: '600', label: t('fontPicker.weightSemiBold') },
    { value: '700', label: t('fontPicker.weightBold') },
    { value: '800', label: t('fontPicker.weightExtraBold') }
  ]
})

const contrastOptions = computed(() => {
  void locale.value
  return [
    { value: '1', label: t('fontPicker.contrastRaw') },
    { value: '2.5', label: t('fontPicker.contrastLow') },
    { value: '4.5', label: t('fontPicker.contrastAA') },
    { value: '7', label: t('fontPicker.contrastAAA') }
  ]
})

const contrastModel = computed({
  get: () => String(terminalMinimumContrast.value),
  set: (value: string) => {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      terminalMinimumContrast.value = Math.min(21, Math.max(1, parsed))
    }
  }
})

const resolvedPanelBodyFamily = computed(() =>
  resolvePanelFontFamily(panelFontId.value, panelCustomFont.value)
)

const resolvedPanelHeadingFamily = computed(() =>
  resolvePanelDisplayFontFamily(
    panelDisplayFontId.value,
    resolvedPanelBodyFamily.value,
    panelCustomDisplayFont.value
  )
)

const panelPreviewStyles = computed(() => ({
  heading: {
    fontFamily: resolvedPanelHeadingFamily.value,
    color: panelCustomColorsEnabled.value ? panelCustomColors.value.heading : 'var(--color-text-heading)',
    fontSize: `${Math.round(panelFontSize.value * 1.24 * 10) / 10}px`,
    fontWeight: String(Math.min(800, Math.max(500, Number.parseInt(panelFontWeight.value, 10) + 200))),
    letterSpacing: `${panelLetterSpacing.value}px`
  },
  body: {
    fontFamily: resolvedPanelBodyFamily.value,
    color: panelCustomColorsEnabled.value ? panelCustomColors.value.primary : 'var(--color-text-primary)',
    fontSize: `${panelFontSize.value}px`,
    fontWeight: panelFontWeight.value,
    lineHeight: String(panelLineHeight.value),
    letterSpacing: `${panelLetterSpacing.value}px`
  },
  muted: {
    fontFamily: resolvedPanelBodyFamily.value,
    color: panelCustomColorsEnabled.value ? panelCustomColors.value.muted : 'var(--color-text-muted)',
    fontSize: `${Math.max(10, Math.round((panelFontSize.value - 1.5) * 10) / 10)}px`,
    letterSpacing: `${panelLetterSpacing.value}px`
  }
}))

const effectiveTerminalTheme = computed(() =>
  resolveEffectiveTerminalTheme(
    terminalTheme.value,
    terminalCustomColorsEnabled.value,
    terminalCustomColors.value
  )
)

const resolvedTerminalFamily = computed(() =>
  resolveTerminalFontFamily(terminalFontId.value, terminalCustomFont.value)
)

const terminalPreviewStyle = computed(() => ({
  fontFamily: resolvedTerminalFamily.value,
  fontSize: `${fontSize.value}px`,
  fontWeight: terminalFontWeight.value,
  lineHeight: String(lineHeight.value),
  letterSpacing: `${terminalLetterSpacing.value}px`,
  background: effectiveTerminalTheme.value.background,
  color: effectiveTerminalTheme.value.theme.foreground,
  fontVariantLigatures: terminalLigatures.value ? 'contextual common-ligatures' : 'none',
  fontFeatureSettings: terminalLigatures.value ? '"calt" 1, "liga" 1' : '"calt" 0, "liga" 0'
}))

const terminalPreviewBoldStyle = computed(() => ({
  fontWeight: terminalFontWeightBold.value,
  color: effectiveTerminalTheme.value.theme.brightCyan || effectiveTerminalTheme.value.theme.cyan || '#68e2f6'
}))

const terminalPreviewAccentStyle = computed(() => ({
  color: effectiveTerminalTheme.value.theme.yellow || '#f3cf7a'
}))

const terminalPreviewSelectionStyle = computed(() => ({
  background: effectiveTerminalTheme.value.theme.selectionBackground || 'rgba(94, 196, 166, 0.3)',
  color: effectiveTerminalTheme.value.theme.foreground
}))

const terminalPreviewCursorStyle = computed(() => ({
  background: effectiveTerminalTheme.value.theme.cursor || '#d4af63'
}))

function resetPanelTextColors(): void {
  panelCustomColors.value = { ...DEFAULT_PANEL_TEXT_COLORS }
  panelCustomColorsEnabled.value = false
}
</script>

<template>
  <div class="container_settings_typo_root_wrap">
    <div class="container_settings_typo_grid_layout" :data-single="section !== 'both'">
      <!-- PANEL & INTERFACE TYPOGRAPHY CARD (INDEPENDENT OF TERMINAL) -->
      <section
        v-if="section === 'both' || section === 'panel'"
        class="container_settings_typo_panel_card"
        data-testid="panel-typography-section"
      >
        <div class="container_settings_typo_panel_head">
          <div class="container_settings_typo_panel_titlewrap">
            <span class="container_settings_typo_panel_badge">
              <Type :size="14" />
            </span>
            <div class="container_settings_typo_panel_headingbox">
              <h3 class="container_settings_typo_panel_heading">{{ t('typography.panelSectionTitle') }}</h3>
              <p class="container_settings_typo_panel_desc">{{ t('typography.panelSectionDesc') }}</p>
            </div>
          </div>
          <button class="container_settings_typo_panel_reset" type="button" @click="resetPanelTypography()">
            <RotateCcw :size="13" />
            {{ t('typography.panelResetAll') }}
          </button>
        </div>

        <div class="container_settings_typo_panel_preview" data-testid="panel-typography-preview">
          <div class="container_settings_typo_ppreview_eyebrow">
            {{ t('typography.panelPreviewEyebrow') }}
          </div>
          <div class="container_settings_typo_ppreview_title" :style="panelPreviewStyles.heading">
            {{ t('typography.panelPreviewHeading') }}
          </div>
          <p class="container_settings_typo_ppreview_body" :style="panelPreviewStyles.body">
            {{ t('typography.panelPreviewBody') }}
          </p>
          <div class="container_settings_typo_ppreview_muted" :style="panelPreviewStyles.muted">
            {{ t('typography.panelPreviewMuted') }}
          </div>
        </div>

        <div class="container_settings_typo_panel_pickers">
          <div class="container_settings_typo_ppicker_item">
            <span class="container_settings_typo_ppicker_label">{{ t('typography.panelBodyFont') }}</span>
            <FontSelector
              v-model="panelFontId"
              v-model:custom-value="panelCustomFont"
              :custom-placeholder="t('typography.panelCustomFontPlaceholder')"
              target="panel"
              :system-fonts="systemFonts"
              :system-fonts-loading="systemFontsLoading"
              instance="panel-body-font"
              :aria-label="t('typography.panelBodyFont')"
              @refresh-system="loadSystemFonts(true)"
            />
          </div>

          <div class="container_settings_typo_dpicker_item">
            <span class="container_settings_typo_dpicker_label">{{ t('typography.panelDisplayFont') }}</span>
            <FontSelector
              v-model="panelDisplayFontId"
              v-model:custom-value="panelCustomDisplayFont"
              :custom-placeholder="t('typography.panelCustomFontPlaceholder')"
              target="display"
              :system-fonts="systemFonts"
              :system-fonts-loading="systemFontsLoading"
              allow-follow-panel
              instance="panel-display-font"
              :aria-label="t('typography.panelDisplayFont')"
              @refresh-system="loadSystemFonts(true)"
            />
          </div>
        </div>

        <div class="container_settings_typo_panel_metrics">
          <label class="container_settings_typo_psize_field">
            <span class="container_settings_typo_psize_head">
              <span class="container_settings_typo_psize_label">{{ t('typography.panelSize') }}</span>
              <span class="container_settings_typo_psize_value">{{ panelFontSize }} px</span>
            </span>
            <input
              v-model.number="panelFontSize"
              class="container_settings_typo_psize_range"
              type="range"
              min="11"
              max="20"
              step="0.5"
            />
            <span class="container_settings_typo_psize_hint">{{ t('typography.panelSizeDesc') }}</span>
          </label>

          <label class="container_settings_typo_pline_field">
            <span class="container_settings_typo_pline_head">
              <span class="container_settings_typo_pline_label">{{ t('typography.panelLineHeight') }}</span>
              <span class="container_settings_typo_pline_value">{{ panelLineHeight.toFixed(2) }}</span>
            </span>
            <input
              v-model.number="panelLineHeight"
              class="container_settings_typo_pline_range"
              type="range"
              min="1.15"
              max="1.9"
              step="0.05"
            />
          </label>

          <label class="container_settings_typo_pspace_field">
            <span class="container_settings_typo_pspace_head">
              <span class="container_settings_typo_pspace_label">
                {{ t('typography.panelLetterSpacing') }}
              </span>
              <span class="container_settings_typo_pspace_value">{{ panelLetterSpacing.toFixed(1) }} px</span>
            </span>
            <input
              v-model.number="panelLetterSpacing"
              class="container_settings_typo_pspace_range"
              type="range"
              min="-0.5"
              max="3"
              step="0.1"
            />
          </label>

          <div class="container_settings_typo_pweight_field">
            <span class="container_settings_typo_pweight_label">{{ t('typography.panelWeight') }}</span>
            <OrbitSelect
              v-model="panelFontWeight"
              :options="panelWeightOptions"
              instance="panel-font-weight"
              :aria-label="t('typography.panelWeight')"
            />
          </div>
        </div>

        <div class="container_settings_typo_pcolor_card">
          <div class="container_settings_typo_pcolor_top">
            <label class="container_settings_typo_pcolor_toggle">
              <OrbitCheckbox
                v-model="panelCustomColorsEnabled"
                class="container_settings_typo_pcolor_check"
                instance="typo-panel-color"
              />
              <Palette :size="14" />
              <span class="container_settings_typo_pcolor_toggletext">
                {{ t('typography.panelColorToggle') }}
              </span>
            </label>
            <button
              class="container_settings_typo_pcolor_reset"
              type="button"
              @click="resetPanelTextColors()"
            >
              {{ t('typography.panelColorReset') }}
            </button>
          </div>

          <div class="container_settings_typo_pcolor_grid">
            <label class="container_settings_typo_pcswatch_primary">
              <span class="container_settings_typo_pcswatch_plabel">
                {{ t('typography.panelColorPrimary') }}
              </span>
              <div class="container_settings_typo_pcswatch_pinputs">
                <input
                  v-model="panelCustomColors.primary"
                  class="container_settings_typo_pcswatch_ppicker"
                  type="color"
                  @input="panelCustomColorsEnabled = true"
                />
                <input
                  v-model="panelCustomColors.primary"
                  class="container_settings_typo_pcswatch_phex"
                  type="text"
                  maxlength="9"
                  @input="panelCustomColorsEnabled = true"
                />
              </div>
            </label>

            <label class="container_settings_typo_pcswatch_secondary">
              <span class="container_settings_typo_pcswatch_slabel">
                {{ t('typography.panelColorSecondary') }}
              </span>
              <div class="container_settings_typo_pcswatch_sinputs">
                <input
                  v-model="panelCustomColors.secondary"
                  class="container_settings_typo_pcswatch_spicker"
                  type="color"
                  @input="panelCustomColorsEnabled = true"
                />
                <input
                  v-model="panelCustomColors.secondary"
                  class="container_settings_typo_pcswatch_shex"
                  type="text"
                  maxlength="9"
                  @input="panelCustomColorsEnabled = true"
                />
              </div>
            </label>

            <label class="container_settings_typo_pcswatch_muted">
              <span class="container_settings_typo_pcswatch_mlabel">
                {{ t('typography.panelColorMuted') }}
              </span>
              <div class="container_settings_typo_pcswatch_minputs">
                <input
                  v-model="panelCustomColors.muted"
                  class="container_settings_typo_pcswatch_mpicker"
                  type="color"
                  @input="panelCustomColorsEnabled = true"
                />
                <input
                  v-model="panelCustomColors.muted"
                  class="container_settings_typo_pcswatch_mhex"
                  type="text"
                  maxlength="9"
                  @input="panelCustomColorsEnabled = true"
                />
              </div>
            </label>

            <label class="container_settings_typo_pcswatch_heading">
              <span class="container_settings_typo_pcswatch_hlabel">
                {{ t('typography.panelColorHeading') }}
              </span>
              <div class="container_settings_typo_pcswatch_hinputs">
                <input
                  v-model="panelCustomColors.heading"
                  class="container_settings_typo_pcswatch_hpicker"
                  type="color"
                  @input="panelCustomColorsEnabled = true"
                />
                <input
                  v-model="panelCustomColors.heading"
                  class="container_settings_typo_pcswatch_hhex"
                  type="text"
                  maxlength="9"
                  @input="panelCustomColorsEnabled = true"
                />
              </div>
            </label>
          </div>
        </div>

        <label class="container_settings_typo_pcopy_box">
          <OrbitCheckbox
            v-model="panelCopyOnSelect"
            class="container_settings_typo_pcopy_check"
            instance="typo-panel-copy"
          />
          <div class="container_settings_typo_pcopy_text">
            <span class="container_settings_typo_pcopy_title">
              <Copy :size="13" />
              {{ t('typography.panelCopyOnSelect') }}
            </span>
            <span class="container_settings_typo_pcopy_desc">
              {{ t('typography.panelCopyOnSelectDesc') }}
            </span>
          </div>
        </label>
      </section>

      <!-- TERMINAL TYPOGRAPHY & COLOR CARD (INDEPENDENT OF PANEL) -->
      <section
        v-if="section === 'both' || section === 'terminal'"
        class="container_settings_typo_term_card"
        data-testid="terminal-typography-section"
      >
        <div class="container_settings_typo_term_head">
          <div class="container_settings_typo_term_titlewrap">
            <span class="container_settings_typo_term_badge">
              <Terminal :size="14" />
            </span>
            <div class="container_settings_typo_term_headingbox">
              <h3 class="container_settings_typo_term_heading">{{ t('typography.termSectionTitle') }}</h3>
              <p class="container_settings_typo_term_desc">{{ t('typography.termSectionDesc') }}</p>
            </div>
          </div>
          <button class="container_settings_typo_term_reset" type="button" @click="resetTerminalTypography()">
            <RotateCcw :size="13" />
            {{ t('typography.termResetAll') }}
          </button>
        </div>

        <div class="container_settings_typo_term_previewwrap" data-testid="terminal-typography-preview">
          <div class="container_settings_typo_tpreview_bar">
            <span class="container_settings_typo_tpreview_title">{{ t('typography.termPreviewTitle') }}</span>
            <span class="container_settings_typo_tpreview_meta">
              {{ fontSize }}px · LH {{ lineHeight.toFixed(2) }} · LS {{ terminalLetterSpacing.toFixed(1) }}px
            </span>
          </div>
          <div class="container_settings_typo_tpreview_canvas" :style="terminalPreviewStyle">
            <div class="container_settings_typo_tpreview_line1">
              <span class="container_settings_typo_tpreview_prompt" :style="terminalPreviewBoldStyle">
                sword@orbit:~/cloud
              </span>
              <span class="container_settings_typo_tpreview_cmd">
                $ ssh -p 22022 prod-edge # 剑意灵韵 0123456789
              </span>
            </div>
            <div class="container_settings_typo_tpreview_line2">
              <span class="container_settings_typo_tpreview_code" :style="terminalPreviewAccentStyle">
                const sync = (a !== b) =&gt; a &gt;= 0 &amp;&amp; b !== null ? a -&gt; b :: ok
              </span>
              <span class="container_settings_typo_tpreview_sel" :style="terminalPreviewSelectionStyle">
                Selected Text
              </span>
              <span class="container_settings_typo_tpreview_cursor" :style="terminalPreviewCursorStyle">
                &nbsp;
              </span>
            </div>
          </div>
        </div>

        <div class="container_settings_typo_tpicker_item">
          <span class="container_settings_typo_tpicker_label">{{ t('typography.termFont') }}</span>
          <FontSelector
            v-model="terminalFontId"
            v-model:custom-value="terminalCustomFont"
            :custom-placeholder="t('typography.termCustomFontPlaceholder')"
            target="terminal"
            :system-fonts="systemFonts"
            :system-fonts-loading="systemFontsLoading"
            instance="terminal-mono-font"
            :aria-label="t('typography.termFont')"
            @refresh-system="loadSystemFonts(true)"
          />
        </div>

        <div class="container_settings_typo_term_metrics">
          <label class="container_settings_typo_tsize_field">
            <span class="container_settings_typo_tsize_head">
              <span class="container_settings_typo_tsize_label">{{ t('typography.termSize') }}</span>
              <span class="container_settings_typo_tsize_value">{{ fontSize }} px</span>
            </span>
            <input
              v-model.number="fontSize"
              class="container_settings_typo_tsize_range"
              type="range"
              min="10"
              max="28"
              step="1"
            />
            <span class="container_settings_typo_tsize_hint">{{ t('typography.termSizeDesc') }}</span>
          </label>

          <label class="container_settings_typo_tline_field">
            <span class="container_settings_typo_tline_head">
              <span class="container_settings_typo_tline_label">{{ t('typography.termLineHeight') }}</span>
              <span class="container_settings_typo_tline_value">{{ lineHeight.toFixed(2) }}</span>
            </span>
            <input
              v-model.number="lineHeight"
              class="container_settings_typo_tline_range"
              type="range"
              min="1.0"
              max="1.8"
              step="0.02"
            />
            <span class="container_settings_typo_tline_hint">{{ t('typography.termLineHeightDesc') }}</span>
          </label>

          <label class="container_settings_typo_tspace_field">
            <span class="container_settings_typo_tspace_head">
              <span class="container_settings_typo_tspace_label">
                {{ t('typography.termLetterSpacing') }}
              </span>
              <span class="container_settings_typo_tspace_value">
                {{ terminalLetterSpacing.toFixed(1) }} px
              </span>
            </span>
            <input
              v-model.number="terminalLetterSpacing"
              class="container_settings_typo_tspace_range"
              type="range"
              min="-1"
              max="4"
              step="0.5"
            />
            <span class="container_settings_typo_tspace_hint">
              {{ t('typography.termLetterSpacingDesc') }}
            </span>
          </label>
        </div>

        <div class="container_settings_typo_term_selects">
          <div class="container_settings_typo_tweight_field">
            <span class="container_settings_typo_tweight_label">{{ t('typography.termFontWeight') }}</span>
            <OrbitSelect
              v-model="terminalFontWeight"
              :options="terminalWeightOptions"
              instance="terminal-font-weight"
              :aria-label="t('typography.termFontWeight')"
            />
          </div>

          <div class="container_settings_typo_tbold_field">
            <span class="container_settings_typo_tbold_label">{{ t('typography.termFontWeightBold') }}</span>
            <OrbitSelect
              v-model="terminalFontWeightBold"
              :options="terminalBoldWeightOptions"
              instance="terminal-font-weight-bold"
              :aria-label="t('typography.termFontWeightBold')"
            />
          </div>

          <div class="container_settings_typo_tcontrast_field">
            <span class="container_settings_typo_tcontrast_label">{{ t('typography.termContrast') }}</span>
            <OrbitSelect
              v-model="contrastModel"
              :options="contrastOptions"
              instance="terminal-min-contrast"
              :aria-label="t('typography.termContrast')"
            />
          </div>
        </div>

        <label class="container_settings_typo_tlig_box">
          <OrbitCheckbox
            v-model="terminalLigatures"
            class="container_settings_typo_tlig_check"
            instance="typo-term-ligatures"
          />
          <div class="container_settings_typo_tlig_text">
            <span class="container_settings_typo_tlig_title">
              <Sparkles :size="13" />
              {{ t('typography.termLigatures') }}
            </span>
            <span class="container_settings_typo_tlig_hint">{{ t('typography.termLigaturesDesc') }}</span>
          </div>
        </label>

        <div class="container_settings_typo_tcolor_card">
          <div class="container_settings_typo_tcolor_top">
            <label class="container_settings_typo_tcolor_toggle">
              <OrbitCheckbox
                v-model="terminalCustomColorsEnabled"
                class="container_settings_typo_tcolor_check"
                instance="typo-term-color"
              />
              <Palette :size="14" />
              <span class="container_settings_typo_tcolor_toggletext">
                {{ t('typography.termColorToggle') }}
              </span>
            </label>
            <button
              class="container_settings_typo_tcolor_reset"
              type="button"
              @click="syncTerminalCustomColorsWithPreset()"
            >
              {{ t('typography.termColorReset') }}
            </button>
          </div>

          <div class="container_settings_typo_tcolor_grid">
            <label class="container_settings_typo_tcswatch_fg">
              <span class="container_settings_typo_tcswatch_fglabel">{{ t('typography.termColorFg') }}</span>
              <div class="container_settings_typo_tcswatch_fginputs">
                <input
                  v-model="terminalCustomColors.foreground"
                  class="container_settings_typo_tcswatch_fgpicker"
                  type="color"
                  @input="terminalCustomColorsEnabled = true"
                />
                <input
                  v-model="terminalCustomColors.foreground"
                  class="container_settings_typo_tcswatch_fghex"
                  type="text"
                  maxlength="9"
                  @input="terminalCustomColorsEnabled = true"
                />
              </div>
            </label>

            <label class="container_settings_typo_tcswatch_bg">
              <span class="container_settings_typo_tcswatch_bglabel">{{ t('typography.termColorBg') }}</span>
              <div class="container_settings_typo_tcswatch_bginputs">
                <input
                  v-model="terminalCustomColors.background"
                  class="container_settings_typo_tcswatch_bgpicker"
                  type="color"
                  @input="terminalCustomColorsEnabled = true"
                />
                <input
                  v-model="terminalCustomColors.background"
                  class="container_settings_typo_tcswatch_bghex"
                  type="text"
                  maxlength="9"
                  @input="terminalCustomColorsEnabled = true"
                />
              </div>
            </label>

            <label class="container_settings_typo_tcswatch_cursor">
              <span class="container_settings_typo_tcswatch_curlabel">
                {{ t('typography.termColorCursor') }}
              </span>
              <div class="container_settings_typo_tcswatch_curinputs">
                <input
                  v-model="terminalCustomColors.cursor"
                  class="container_settings_typo_tcswatch_curpicker"
                  type="color"
                  @input="terminalCustomColorsEnabled = true"
                />
                <input
                  v-model="terminalCustomColors.cursor"
                  class="container_settings_typo_tcswatch_curhex"
                  type="text"
                  maxlength="9"
                  @input="terminalCustomColorsEnabled = true"
                />
              </div>
            </label>

            <label class="container_settings_typo_tcswatch_sel">
              <span class="container_settings_typo_tcswatch_sellabel">
                {{ t('typography.termColorSelection') }}
              </span>
              <div class="container_settings_typo_tcswatch_selinputs">
                <input
                  v-model="terminalCustomColors.selection"
                  class="container_settings_typo_tcswatch_selpicker"
                  type="color"
                  @input="terminalCustomColorsEnabled = true"
                />
                <input
                  v-model="terminalCustomColors.selection"
                  class="container_settings_typo_tcswatch_selhex"
                  type="text"
                  maxlength="9"
                  @input="terminalCustomColorsEnabled = true"
                />
              </div>
            </label>
          </div>
        </div>

        <label class="container_settings_typo_tcopy_box">
          <OrbitCheckbox
            v-model="copyOnSelect"
            class="container_settings_typo_tcopy_check"
            instance="typo-term-copy"
          />
          <div class="container_settings_typo_tcopy_text">
            <span class="container_settings_typo_tcopy_title">
              <Copy :size="13" />
              {{ t('settings.copyOnSelect') }}
            </span>
            <span class="container_settings_typo_tcopy_desc">{{ t('settings.copyOnSelectDesc') }}</span>
          </div>
        </label>
      </section>
    </div>
  </div>
</template>

<style scoped lang="scss">
.container_settings_typo_root_wrap {
  margin-bottom: 18px;
}

.container_settings_typo_grid_layout {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(390px, 1fr));
  gap: 16px;
  &[data-single='true'] {
    grid-template-columns: minmax(390px, 900px);
  }
}

.container_settings_typo_panel_card,
.container_settings_typo_term_card {
  padding: 18px;
  border-radius: var(--radius-card);
  border: 1px solid var(--color-border-subtle);
  background: var(--color-surface-1);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.container_settings_typo_panel_head,
.container_settings_typo_term_head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.container_settings_typo_panel_titlewrap,
.container_settings_typo_term_titlewrap {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
  flex: 1 1 240px;
}

.container_settings_typo_panel_badge,
.container_settings_typo_term_badge {
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  border-radius: 7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border-strong);
  color: var(--color-accent-primary-hover);
}

.container_settings_typo_panel_headingbox,
.container_settings_typo_term_headingbox {
  min-width: 0;
}

.container_settings_typo_panel_heading,
.container_settings_typo_term_heading {
  margin: 0;
  font-size: var(--font-size-ui-lg);
  font-family: var(--font-display);
  font-weight: var(--font-ui-heading-weight);
  color: var(--color-text-heading);
}

.container_settings_typo_panel_desc,
.container_settings_typo_term_desc {
  margin: 4px 0 0;
  font-size: var(--font-size-ui-xs);
  line-height: 1.5;
  color: var(--color-text-muted);
}

.container_settings_typo_panel_reset,
.container_settings_typo_term_reset {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--font-size-ui-xs);
  white-space: nowrap;
}

.container_settings_typo_panel_preview {
  padding: 14px;
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border-subtle);
  background: var(--color-surface-2);
  display: flex;
  flex-direction: column;
  gap: 6px;
  user-select: text;
}

.container_settings_typo_ppreview_eyebrow {
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-accent-primary);
}

.container_settings_typo_ppreview_title {
  line-height: 1.3;
  transition: color 120ms ease;
}

.container_settings_typo_ppreview_body {
  margin: 0;
  transition: color 120ms ease;
}

.container_settings_typo_ppreview_muted {
  line-height: 1.45;
  transition: color 120ms ease;
}

.container_settings_typo_term_previewwrap {
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border-strong);
  overflow: hidden;
  background: #070a09;
}

.container_settings_typo_tpreview_bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.04);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.container_settings_typo_tpreview_title {
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.container_settings_typo_tpreview_meta {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-text-secondary);
}

.container_settings_typo_tpreview_canvas {
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-x: auto;
  user-select: text;
}

.container_settings_typo_tpreview_line1,
.container_settings_typo_tpreview_line2 {
  white-space: pre-wrap;
  word-break: break-all;
}

.container_settings_typo_tpreview_sel {
  padding: 1px 4px;
  border-radius: 3px;
}

.container_settings_typo_tpreview_cursor {
  display: inline-block;
  width: 8px;
  border-radius: 1px;
  margin-left: 2px;
}

.container_settings_typo_panel_pickers {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.container_settings_typo_ppicker_item,
.container_settings_typo_dpicker_item,
.container_settings_typo_tpicker_item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.container_settings_typo_ppicker_label,
.container_settings_typo_dpicker_label,
.container_settings_typo_tpicker_label,
.container_settings_typo_pweight_label,
.container_settings_typo_tweight_label,
.container_settings_typo_tbold_label,
.container_settings_typo_tcontrast_label {
  font-size: var(--font-size-ui-xs);
  color: var(--color-text-secondary);
  font-weight: 500;
}

.container_settings_typo_panel_metrics,
.container_settings_typo_term_metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 12px;
}

.container_settings_typo_term_selects {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(155px, 1fr));
  gap: 12px;
}

.container_settings_typo_psize_field,
.container_settings_typo_pline_field,
.container_settings_typo_pspace_field,
.container_settings_typo_pweight_field,
.container_settings_typo_tsize_field,
.container_settings_typo_tline_field,
.container_settings_typo_tspace_field,
.container_settings_typo_tweight_field,
.container_settings_typo_tbold_field,
.container_settings_typo_tcontrast_field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.container_settings_typo_psize_head,
.container_settings_typo_pline_head,
.container_settings_typo_pspace_head,
.container_settings_typo_tsize_head,
.container_settings_typo_tline_head,
.container_settings_typo_tspace_head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.container_settings_typo_psize_label,
.container_settings_typo_pline_label,
.container_settings_typo_pspace_label,
.container_settings_typo_tsize_label,
.container_settings_typo_tline_label,
.container_settings_typo_tspace_label {
  font-size: var(--font-size-ui-xs);
  color: var(--color-text-secondary);
}

.container_settings_typo_psize_value,
.container_settings_typo_pline_value,
.container_settings_typo_pspace_value,
.container_settings_typo_tsize_value,
.container_settings_typo_tline_value,
.container_settings_typo_tspace_value {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-accent-primary-hover);
}

.container_settings_typo_psize_range,
.container_settings_typo_pline_range,
.container_settings_typo_pspace_range,
.container_settings_typo_tsize_range,
.container_settings_typo_tline_range,
.container_settings_typo_tspace_range {
  width: 100%;
  accent-color: var(--color-accent-primary);
  cursor: pointer;
}

.container_settings_typo_psize_hint,
.container_settings_typo_tsize_hint,
.container_settings_typo_tline_hint,
.container_settings_typo_tspace_hint {
  font-size: 11px;
  line-height: 1.4;
  color: var(--color-text-muted);
}

.container_settings_typo_pcolor_card,
.container_settings_typo_tcolor_card {
  padding: 12px;
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border-subtle);
  background: var(--color-surface-2);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.container_settings_typo_pcolor_top,
.container_settings_typo_tcolor_top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.container_settings_typo_pcolor_toggle,
.container_settings_typo_tcolor_toggle {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: var(--font-size-ui-sm);
  color: var(--color-text-primary);
  cursor: pointer;
}

.container_settings_typo_pcolor_reset,
.container_settings_typo_tcolor_reset {
  font-size: 11px;
  padding: 4px 9px;
}

.container_settings_typo_pcolor_grid,
.container_settings_typo_tcolor_grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
}

.container_settings_typo_pcswatch_primary,
.container_settings_typo_pcswatch_secondary,
.container_settings_typo_pcswatch_muted,
.container_settings_typo_pcswatch_heading,
.container_settings_typo_tcswatch_fg,
.container_settings_typo_tcswatch_bg,
.container_settings_typo_tcswatch_cursor,
.container_settings_typo_tcswatch_sel {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.container_settings_typo_pcswatch_plabel,
.container_settings_typo_pcswatch_slabel,
.container_settings_typo_pcswatch_mlabel,
.container_settings_typo_pcswatch_hlabel,
.container_settings_typo_tcswatch_fglabel,
.container_settings_typo_tcswatch_bglabel,
.container_settings_typo_tcswatch_curlabel,
.container_settings_typo_tcswatch_sellabel {
  font-size: 11px;
  color: var(--color-text-muted);
}

.container_settings_typo_pcswatch_pinputs,
.container_settings_typo_pcswatch_sinputs,
.container_settings_typo_pcswatch_minputs,
.container_settings_typo_pcswatch_hinputs,
.container_settings_typo_tcswatch_fginputs,
.container_settings_typo_tcswatch_bginputs,
.container_settings_typo_tcswatch_curinputs,
.container_settings_typo_tcswatch_selinputs {
  display: flex;
  align-items: center;
  gap: 6px;
}

.container_settings_typo_pcswatch_ppicker,
.container_settings_typo_pcswatch_spicker,
.container_settings_typo_pcswatch_mpicker,
.container_settings_typo_pcswatch_hpicker,
.container_settings_typo_tcswatch_fgpicker,
.container_settings_typo_tcswatch_bgpicker,
.container_settings_typo_tcswatch_curpicker,
.container_settings_typo_tcswatch_selpicker {
  width: 30px;
  height: 26px;
  padding: 0;
  border-radius: 5px;
  border: 1px solid var(--color-border-strong);
  background: transparent;
  cursor: pointer;
}

.container_settings_typo_pcswatch_phex,
.container_settings_typo_pcswatch_shex,
.container_settings_typo_pcswatch_mhex,
.container_settings_typo_pcswatch_hhex,
.container_settings_typo_tcswatch_fghex,
.container_settings_typo_tcswatch_bghex,
.container_settings_typo_tcswatch_curhex,
.container_settings_typo_tcswatch_selhex {
  min-width: 0;
  flex: 1;
  padding: 4px 7px;
  font-family: var(--font-mono);
  font-size: 11px;
  border-radius: 5px;
  border: 1px solid var(--color-border-subtle);
  background: var(--color-surface-1);
  color: var(--color-text-primary);
}

.container_settings_typo_tlig_box,
.container_settings_typo_pcopy_box,
.container_settings_typo_tcopy_box {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 10px 12px;
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border-subtle);
  background: var(--color-surface-2);
  cursor: pointer;
}

.container_settings_typo_tlig_check,
.container_settings_typo_pcopy_check,
.container_settings_typo_tcopy_check {
  margin-top: 2px;
}

.container_settings_typo_tlig_text,
.container_settings_typo_pcopy_text,
.container_settings_typo_tcopy_text {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.container_settings_typo_tlig_title,
.container_settings_typo_pcopy_title,
.container_settings_typo_tcopy_title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-ui-sm);
  font-weight: 500;
  color: var(--color-text-primary);
}

.container_settings_typo_tlig_hint,
.container_settings_typo_pcopy_desc,
.container_settings_typo_tcopy_desc {
  font-size: 11.5px;
  line-height: 1.45;
  color: var(--color-text-muted);
}
</style>
