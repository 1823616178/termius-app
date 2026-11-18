<script setup lang="ts">
import { computed } from 'vue'
import { Check } from '@lucide/vue'
import { getFontDisplayName } from '../services/fonts'
import { locale, t } from '../services/i18n'
import { cycleTerminalTheme, getTerminalTheme } from '../services/terminal-themes'
import {
  activeTerminalDimensions,
  bootstrap,
  copiedFeedback,
  focusedPane,
  fontSize,
  hasVisibleUpdate,
  openUpdateSettings,
  page,
  runningCount,
  syncStatus,
  terminalCustomFont,
  terminalFontId,
  terminalTheme,
  updateState
} from '../stores/workbench'

const activeTheme = computed(() => getTerminalTheme(terminalTheme.value))
const activeThemeLabel = computed(() =>
  locale.value === 'en-US' ? activeTheme.value.nameEn : activeTheme.value.name
)
const activeTerminalFontName = computed(() =>
  getFontDisplayName(terminalFontId.value, locale.value, terminalCustomFont.value)
)

const syncLabel = computed(() => {
  const s = syncStatus.value
  if (!s) return t('status.localWorkspace')
  if (s.phase === 'syncing') return t('status.syncing')
  if (s.phase === 'conflict') return t('status.conflict', { count: s.conflicts.length })
  if (s.phase === 'read-only-schema') return t('status.readOnly')
  if (s.phase === 'offline') return t('status.offline')
  if (s.phase === 'vault-locked') {
    return s.vaultConfigured ? t('status.vaultLocked') : t('status.vaultUnconfigured')
  }
  if (s.phase === 'signed-out') return t('status.signedOut')
  if (s.phase === 'error') return t('status.syncError')
  if (s.phase === 'synced') {
    const rev = s.lastRevision ? `rev-${s.lastRevision}` : t('status.connected')
    return s.pendingChanges ? t('status.syncedPending', { rev }) : t('status.synced', { rev })
  }
  return t('status.localOnly')
})
</script>

<template>
  <footer class="container_app_status_footer_base">
    <span class="container_app_status_footer_indicator" :data-phase="syncStatus?.phase ?? 'unconfigured'" />
    <button
      class="container_app_status_footer_sync"
      type="button"
      :title="t('status.syncTitle')"
      @click="page = 'sync'"
    >
      {{ syncLabel }}
    </button>
    <span class="container_app_status_footer_sessions">
      {{ t('status.runningTerminals', { count: runningCount }) }}
    </span>
    <span v-if="copiedFeedback" class="container_app_status_footer_copied" role="status">
      <Check :size="11" />
      {{ t('status.copiedFeedback', { count: copiedFeedback.count }) }}
    </span>
    <span class="container_app_status_footer_spacer" />
    <span v-if="focusedPane" class="container_app_status_footer_metrics">
      {{ activeTerminalDimensions.cols }}×{{ activeTerminalDimensions.rows }} · {{ activeTerminalFontName }} ·
      {{ fontSize }}px · UTF-8
    </span>
    <button
      class="container_app_status_footer_theme"
      type="button"
      :title="t('status.switchTerminalTheme')"
      @click="terminalTheme = cycleTerminalTheme(terminalTheme)"
    >
      {{ activeThemeLabel }}
    </button>
    <span class="container_app_status_footer_protocol">
      {{
        focusedPane?.kind === 'ssh'
          ? 'SSH · TrueColor'
          : focusedPane
            ? `${bootstrap?.platform === 'win32' ? 'ConPTY' : 'PTY'} · TrueColor`
            : t('status.ready')
      }}
    </span>
    <button
      class="container_app_status_footer_version"
      type="button"
      :data-update="hasVisibleUpdate"
      :title="t('status.versionTitle')"
      @click="openUpdateSettings"
    >
      v{{ bootstrap?.versions.app ?? '1.0.0'
      }}{{
        hasVisibleUpdate && updateState.latest
          ? ` · ${t('status.upgradeAvailable', { version: updateState.latest.version })}`
          : ''
      }}
    </button>
  </footer>
</template>

<style scoped lang="scss">
.container_app_status_footer_base {
  height: 24px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  flex-shrink: 0;
  border-top: 1px solid var(--color-border);
  background: var(--color-surface-chrome);
  color: var(--color-text-muted);
  font-size: 12px;
}
.container_app_status_footer_indicator {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-success);
  &[data-phase='syncing'] {
    background: var(--color-accent-primary);
  }
  &[data-phase='conflict'],
  &[data-phase='error'] {
    background: #ef4444;
  }
  &[data-phase='vault-locked'],
  &[data-phase='offline'],
  &[data-phase='read-only-schema'] {
    background: var(--color-warning);
  }
}
.container_app_status_footer_sync {
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font-size: inherit;
  cursor: pointer;
  &:hover {
    color: var(--color-text-primary);
  }
}
.container_app_status_footer_sessions {
  margin-left: 10px;
}
.container_app_status_footer_copied {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 7px;
  border-radius: 4px;
  border: 1px solid rgba(89, 214, 160, 0.4);
  background: rgba(89, 214, 160, 0.12);
  color: #86efac;
  font-size: 11px;
}
.container_app_status_footer_spacer {
  flex: 1;
}
.container_app_status_footer_metrics {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-text-muted);
}
.container_app_status_footer_theme {
  min-height: 18px;
  padding: 1px 8px;
  font-size: 11px;
  border-radius: 4px;
  color: var(--color-accent-primary-hover);
  background: var(--color-accent-primary-soft);
  border: 1px solid var(--color-accent-primary-ring);
}
.container_app_status_footer_version {
  min-height: 18px;
  border: none;
  border-left: 1px solid var(--color-border);
  border-radius: 0;
  padding: 0 0 0 10px;
  background: transparent;
  color: inherit;
  font-size: inherit;
  cursor: pointer;
  &:hover {
    color: var(--color-text-primary);
  }
  &[data-update='true'] {
    color: var(--color-accent-primary-hover);
    font-weight: 500;
  }
}
</style>
