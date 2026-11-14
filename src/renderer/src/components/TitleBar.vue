<script setup lang="ts">
import { computed } from 'vue'
import { Minus, Square, Copy, X, Sparkles, Minimize2 } from 'lucide-vue-next'
import orbitIcon from '../assets/orbit-icon.svg'
import { cycleUiTheme, maximized, trayState, uiTheme } from '../stores/workbench'
import { UI_THEME_PRESETS } from '../services/ui-themes'

const windowControls = window.orbit.window

const currentThemeLabel = computed(() => {
  if (uiTheme.value === 'custom') return '太虚·自定'
  const preset = UI_THEME_PRESETS.find((item) => item.id === uiTheme.value)
  return preset ? `${preset.trigram} ${preset.element}` : '☰ 主题'
})
</script>

<template>
  <header class="container_app_titlebar_header_base">
    <span class="container_app_brand_header_mark">
      <img class="container_app_brand_header_icon" :src="orbitIcon" alt="" />
    </span>
    <strong class="container_app_brand_header_name">Graphite Orbit</strong>
    <span class="container_app_brand_header_separator">/</span>
    <span class="container_app_brand_header_workspace">个人工作区</span>
    <span class="container_app_brand_header_badge">太极星轨 · 0.1</span>
    <div class="container_app_window_header_controls">
      <button
        class="container_app_brand_header_theme"
        type="button"
        title="点击循环切换道教五行八卦主题配色"
        aria-label="切换界面主题配色"
        @click="cycleUiTheme"
      >
        <Sparkles :size="13" />
        <span class="container_app_brand_header_theme-label">{{ currentThemeLabel }}</span>
      </button>
      <button
        class="container_app_window_header_tray"
        type="button"
        :data-active="trayState.trayCreated"
        title="收起到 Windows 右侧系统托盘后台运行"
        aria-label="后台托盘"
        @click="windowControls.hideToTray()"
      >
        <Minimize2 :size="12" />
        <span class="container_app_window_header_tray-label">后台运行</span>
      </button>
      <button
        class="container_app_window_header_minimize"
        type="button"
        :title="trayState.minimizeToTray ? '最小化到右侧系统托盘（后台运行）' : '最小化窗口'"
        aria-label="最小化"
        @click="windowControls.minimize()"
      >
        <Minus :size="15" />
      </button>
      <button
        class="container_app_window_header_maximize"
        type="button"
        :aria-label="maximized ? '还原窗口' : '最大化窗口'"
        @click="windowControls.maximize()"
      >
        <Copy v-if="maximized" :size="12" />
        <Square v-else :size="12" />
      </button>
      <button
        class="container_app_window_header_close"
        type="button"
        aria-label="关闭窗口"
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
  filter: drop-shadow(0 2px 6px rgba(167, 139, 250, 0.25));
  transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
  .container_app_brand_header_mark:hover & {
    transform: rotateY(-14deg) rotateX(10deg) scale(1.06);
  }
}
.container_app_brand_header_name {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.3px;
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
  font-size: 12px;
  color: var(--color-accent-primary-hover);
  border: 1px solid var(--color-accent-primary-ring);
  border-radius: 4px;
  padding: 2px 6px;
  margin-left: 6px;
}
.container_app_window_header_controls {
  display: flex;
  align-items: center;
  height: 100%;
  margin-left: auto;
  -webkit-app-region: no-drag;
  button:not(.container_app_brand_header_theme, .container_app_window_header_tray) {
    width: 46px;
    height: 100%;
    border: none;
    border-radius: 0;
  }
}
.container_app_brand_header_theme,
.container_app_window_header_tray {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 9px;
  margin-right: 8px;
  border-radius: 999px;
  border: 1px solid var(--color-border-control);
  background: var(--color-surface-1);
  color: var(--color-text-secondary);
  font-size: 11px;
  white-space: nowrap;
}
.container_app_brand_header_theme {
  border-color: var(--color-accent-primary-ring);
  background: var(--color-accent-primary-soft);
  color: var(--color-accent-primary-hover);
}
.container_app_window_header_tray[data-active='true'] {
  border-color: rgba(89, 214, 160, 0.45);
  background: rgba(89, 214, 160, 0.12);
  color: #6ee7b7;
}
.container_app_brand_header_theme-label,
.container_app_window_header_tray-label {
  font-weight: 500;
}
.container_app_window_header_close:hover {
  background: var(--color-close-hover) !important;
  color: #ffffff;
}
</style>
