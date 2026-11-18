<script setup lang="ts">
import { computed } from 'vue'
import { Minus, Square, Copy, X, Sparkles, Minimize2, ArrowUpCircle, House, Languages } from '@lucide/vue'
import orbitIcon from '../assets/orbit-icon.svg'
import { locale, t, toggleLocale } from '../services/i18n'
import {
  bootstrap,
  cycleUiTheme,
  goHome,
  hasVisibleUpdate,
  homeVisible,
  maximized,
  openUpdateSettings,
  page,
  tabs,
  trayState,
  uiTheme,
  updateState
} from '../stores/workbench'
import { UI_THEME_PRESETS } from '../services/ui-themes'

const windowControls = window.orbit.window

const currentThemeLabel = computed(() => {
  if (uiTheme.value === 'custom') return t('titlebar.customTheme')
  const preset = UI_THEME_PRESETS.find((item) => item.id === uiTheme.value)
  if (!preset) return t('titlebar.defaultTheme')
  return `${preset.trigram} ${locale.value === 'en-US' ? preset.elementEn : preset.element}`
})

const updateBadgeText = computed(() => {
  const s = updateState.value
  if (s.phase === 'downloading') {
    return s.progress?.percent !== null && s.progress?.percent !== undefined
      ? t('titlebar.updateDownloading', { percent: s.progress.percent })
      : t('titlebar.updateDownloadingNoPct')
  }
  if (s.phase === 'downloaded' && s.latest) {
    return t('titlebar.updateDownloaded', { version: s.latest.version })
  }
  if (s.phase === 'available' && s.latest) {
    return t('titlebar.updateAvailable', { version: s.latest.version })
  }
  return ''
})

const closeButtonTitle = computed(() => {
  if (trayState.value.closeAction === 'tray') return t('titlebar.closeToTray')
  if (trayState.value.closeAction === 'minimize') return t('titlebar.closeToTaskbar')
  return t('titlebar.closeQuit')
})
</script>

<template>
  <header class="container_app_titlebar_header_base">
    <span class="container_app_brand_header_mark">
      <img class="container_app_brand_header_icon" :src="orbitIcon" alt="" />
    </span>
    <strong class="container_app_brand_header_name">{{ t('titlebar.brand') }}</strong>
    <span class="container_app_brand_header_separator">/</span>
    <span class="container_app_brand_header_workspace">{{ t('titlebar.workspace') }}</span>
    <span class="container_app_brand_header_badge">
      {{ t('titlebar.badgePrefix') }} · {{ bootstrap?.versions.app ?? '1.2.0' }}
    </span>
    <div class="container_app_window_header_controls">
      <button
        class="container_app_window_header_home"
        type="button"
        :title="t('titlebar.home')"
        :aria-label="t('titlebar.home')"
        :aria-current="page === 'workspace' && (homeVisible || !tabs.length) ? 'page' : undefined"
        @click="goHome"
      >
        <House :size="16" />
      </button>
      <button
        v-if="hasVisibleUpdate"
        class="container_app_window_header_update"
        type="button"
        :data-phase="updateState.phase"
        :title="t('titlebar.updateTitle')"
        :aria-label="t('titlebar.updateAria')"
        @click="openUpdateSettings"
      >
        <ArrowUpCircle :size="12" />
        <span class="container_app_window_header_update-label">{{ updateBadgeText }}</span>
      </button>
      <button
        class="container_app_window_header_lang"
        type="button"
        data-testid="titlebar-lang-toggle"
        :title="t('titlebar.langTitle')"
        :aria-label="t('titlebar.langAria')"
        @click="toggleLocale"
      >
        <Languages :size="13" />
        <span class="container_app_window_header_lang-label">{{ t('titlebar.langLabel') }}</span>
      </button>
      <button
        class="container_app_brand_header_theme"
        type="button"
        :title="t('titlebar.themeTitle')"
        :aria-label="t('titlebar.themeAria')"
        @click="cycleUiTheme"
      >
        <Sparkles :size="13" />
        <span class="container_app_brand_header_theme-label">{{ currentThemeLabel }}</span>
      </button>
      <button
        class="container_app_window_header_tray"
        type="button"
        :data-active="trayState.trayCreated"
        :title="bootstrap?.platform === 'linux' ? t('titlebar.trayTitleLinux') : t('titlebar.trayTitleWin')"
        :aria-label="t('titlebar.trayAria')"
        @click="windowControls.hideToTray()"
      >
        <Minimize2 :size="12" />
        <span class="container_app_window_header_tray-label">{{ t('titlebar.trayLabel') }}</span>
      </button>
      <button
        class="container_app_window_header_minimize"
        type="button"
        :title="trayState.minimizeToTray ? t('titlebar.minimizeToTray') : t('titlebar.minimizeWindow')"
        :aria-label="t('titlebar.minimizeAria')"
        @click="windowControls.minimize()"
      >
        <Minus :size="15" />
      </button>
      <button
        class="container_app_window_header_maximize"
        type="button"
        :aria-label="maximized ? t('titlebar.restoreWindow') : t('titlebar.maximizeWindow')"
        @click="windowControls.maximize()"
      >
        <Copy v-if="maximized" :size="12" />
        <Square v-else :size="12" />
      </button>
      <button
        class="container_app_window_header_close"
        type="button"
        :title="closeButtonTitle"
        :aria-label="t('titlebar.closeAria')"
        @click="windowControls.close()"
      >
        <X :size="17" />
      </button>
    </div>
  </header>
</template>

<style scoped lang="scss">
.container_app_titlebar_header_base {
  height: 40px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 9px;
  border-bottom: 1px solid var(--color-border);
  background: linear-gradient(180deg, var(--color-surface-2), var(--color-surface-chrome));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
  -webkit-app-region: drag;
  user-select: none;
}
.container_app_brand_header_mark {
  margin-left: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  perspective: 300px;
}
.container_app_brand_header_icon {
  width: 22px;
  height: 22px;
  display: block;
  border-radius: 6px;
  filter: drop-shadow(0 2px 6px var(--color-accent-primary-glow));
  transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
  .container_app_brand_header_mark:hover & {
    transform: rotateY(-14deg) rotateX(10deg) scale(1.06);
  }
}
.container_app_brand_header_name {
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.6px;
}
.container_app_brand_header_separator {
  color: var(--color-text-muted);
  margin: 0 3px;
}
.container_app_brand_header_workspace {
  font-size: 12px;
  color: var(--color-text-muted);
}
.container_app_brand_header_badge {
  font-family: var(--font-display);
  font-size: 11px;
  color: #f4d9cf;
  background: var(--color-seal-soft);
  border: 1px solid var(--color-seal-ring);
  border-radius: 3px;
  padding: 2px 7px;
  margin-left: 6px;
}
.container_app_window_header_controls {
  display: flex;
  align-items: center;
  height: 100%;
  margin-left: auto;
  -webkit-app-region: no-drag;
  button:not(
    .container_app_brand_header_theme,
    .container_app_window_header_lang,
    .container_app_window_header_tray,
    .container_app_window_header_update
  ) {
    width: 46px;
    height: 100%;
    border: none;
    border-radius: 0;
  }
}
.container_app_brand_header_theme,
.container_app_window_header_lang,
.container_app_window_header_tray,
.container_app_window_header_update {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 9px;
  margin-right: 8px;
  border-radius: 4px;
  border: 1px solid var(--color-border-control);
  background: var(--color-surface-1);
  color: var(--color-text-secondary);
  font-size: 11px;
  white-space: nowrap;
}
.container_app_window_header_lang {
  border-color: var(--color-border-strong);
  color: var(--color-text-primary);
}
.container_app_window_header_update {
  border-color: var(--color-seal-ring);
  background: var(--color-seal-soft);
  color: #f4d9cf;
  &[data-phase='downloaded'] {
    border-color: rgba(89, 214, 160, 0.45);
    background: rgba(89, 214, 160, 0.12);
    color: #86efac;
  }
}
.container_app_window_header_update-label {
  font-weight: 500;
}
.container_app_brand_header_theme {
  border-color: var(--color-accent-primary-ring);
  background: var(--color-accent-primary-soft);
  color: var(--color-accent-primary-hover);
}
.container_app_window_header_tray[data-active='true'] {
  border-color: var(--color-accent-secondary-ring);
  background: var(--color-accent-secondary-soft);
  color: var(--color-accent-secondary);
}
.container_app_brand_header_theme-label,
.container_app_window_header_lang-label,
.container_app_window_header_tray-label {
  font-weight: 500;
}
.container_app_window_header_close:hover {
  background: var(--color-close-hover) !important;
  color: #ffffff;
}
.container_app_window_header_home[aria-current='page'] {
  color: var(--color-accent-primary-hover);
  background: var(--color-accent-primary-soft);
}
</style>
