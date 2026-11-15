<script setup lang="ts">
import { computed } from 'vue'
import { cycleTerminalTheme, getTerminalTheme } from '../services/terminal-themes'
import {
  activeTerminalDimensions,
  bootstrap,
  focusedPane,
  fontSize,
  hasVisibleUpdate,
  openUpdateSettings,
  page,
  runningCount,
  syncStatus,
  terminalTheme,
  updateState
} from '../stores/workbench'

const activeTheme = computed(() => getTerminalTheme(terminalTheme.value))

const syncLabel = computed(() => {
  const s = syncStatus.value
  if (!s) return '本地工作区'
  if (s.phase === 'syncing') return '同步中…'
  if (s.phase === 'conflict') return `同步冲突 (${s.conflicts.length})`
  if (s.phase === 'read-only-schema') return '只读保护（版本过高）'
  if (s.phase === 'offline') return '离线模式'
  if (s.phase === 'vault-locked') return s.vaultConfigured ? '保管库已锁定' : '待创建保管库'
  if (s.phase === 'signed-out') return '同步未登录'
  if (s.phase === 'error') return '同步异常'
  if (s.phase === 'synced') {
    const rev = s.lastRevision ? `rev-${s.lastRevision}` : '已连接'
    return s.pendingChanges ? `云同步 · ${rev}（待推送）` : `已同步 · ${rev}`
  }
  return '本地工作区（未开启同步）'
})
</script>

<template>
  <footer class="container_app_status_footer_base">
    <span class="container_app_status_footer_indicator" :data-phase="syncStatus?.phase ?? 'unconfigured'" />
    <button
      class="container_app_status_footer_sync"
      type="button"
      title="打开端到端加密远程同步面板"
      @click="page = 'sync'"
    >
      {{ syncLabel }}
    </button>
    <span class="container_app_status_footer_sessions">{{ runningCount }} 个运行中终端</span>
    <span class="container_app_status_footer_spacer" />
    <span v-if="focusedPane" class="container_app_status_footer_metrics">
      {{ activeTerminalDimensions.cols }}×{{ activeTerminalDimensions.rows }} · {{ fontSize }}px · UTF-8
    </span>
    <button
      class="container_app_status_footer_theme"
      type="button"
      title="点击切换终端配色主题"
      @click="terminalTheme = cycleTerminalTheme(terminalTheme)"
    >
      {{ activeTheme.name }}
    </button>
    <span class="container_app_status_footer_protocol">
      {{ focusedPane?.kind === 'ssh' ? 'SSH · TrueColor' : focusedPane ? 'ConPTY · TrueColor' : '准备就绪' }}
    </span>
    <button
      class="container_app_status_footer_version"
      type="button"
      :data-update="hasVisibleUpdate"
      title="查看版本信息与 GitHub 更新检查"
      @click="openUpdateSettings"
    >
      v{{ bootstrap?.versions.app ?? '0.1.0'
      }}{{ hasVisibleUpdate && updateState.latest ? ` · 可升级 v${updateState.latest.version}` : '' }}
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
