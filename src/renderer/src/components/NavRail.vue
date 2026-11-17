<script setup lang="ts">
import { Terminal, Server, SquareTerminal, Network, KeyRound, Cloud, CircleHelp, Settings } from '@lucide/vue'
import { computed } from 'vue'
import { activateTab, activeTab, page, showHelp, syncStatus, tunnelStatuses } from '../stores/workbench'

const activeTunnelCount = computed(
  () => Object.values(tunnelStatuses.value).filter((item) => item.active).length
)

const avatarLetter = computed(() => {
  const email = syncStatus.value?.email?.trim()
  if (syncStatus.value?.signedIn && email) return email[0]!.toUpperCase()
  return 'L'
})

const avatarTitle = computed(() => {
  if (syncStatus.value?.signedIn) {
    return `${syncStatus.value.email} · 点击管理端到端加密同步`
  }
  return '本地工作区 · 点击登录或配置云同步'
})
</script>

<template>
  <nav class="container_app_navigation_sidebar_base" aria-label="主导航">
    <button
      class="container_app_navigation_sidebar_workspace"
      type="button"
      :aria-current="page === 'workspace' ? 'page' : undefined"
      aria-label="工作台"
      title="工作台"
      @click="activeTab ? activateTab(activeTab) : (page = 'workspace')"
    >
      <Terminal :size="21" />
    </button>
    <button
      class="container_app_navigation_sidebar_hosts"
      type="button"
      :aria-current="page === 'hosts' ? 'page' : undefined"
      aria-label="主机"
      title="主机"
      @click="page = 'hosts'"
    >
      <Server :size="20" />
    </button>
    <button
      class="container_app_navigation_sidebar_local"
      type="button"
      :aria-current="page === 'local' ? 'page' : undefined"
      aria-label="本地终端"
      title="本地终端"
      @click="page = 'local'"
    >
      <SquareTerminal :size="21" />
    </button>
    <span class="container_app_navigation_sidebar_divider" />
    <button
      class="container_app_navigation_sidebar_tunnels"
      type="button"
      :aria-current="page === 'tunnels' ? 'page' : undefined"
      aria-label="端口转发"
      title="端口转发与网络探测中心"
      @click="page = 'tunnels'"
    >
      <Network :size="20" />
      <span v-if="activeTunnelCount > 0" class="container_app_navigation_sidebar_tunnel-badge">
        {{ activeTunnelCount }}
      </span>
    </button>
    <button
      class="container_app_navigation_sidebar_identities"
      type="button"
      :aria-current="page === 'identities' ? 'page' : undefined"
      aria-label="凭据与分组"
      title="凭据管理、服务器分组与主机指纹库"
      @click="page = 'identities'"
    >
      <KeyRound :size="20" />
    </button>
    <div class="container_app_navigation_sidebar_spacer" />
    <button
      class="container_app_navigation_sidebar_sync"
      type="button"
      :data-phase="syncStatus?.phase ?? 'unconfigured'"
      :aria-current="page === 'sync' ? 'page' : undefined"
      aria-label="远程同步"
      title="远程同步（端到端加密）"
      @click="page = 'sync'"
    >
      <Cloud :size="20" />
      <span
        class="container_app_navigation_sidebar_sync-dot"
        :data-phase="syncStatus?.phase ?? 'unconfigured'"
      />
    </button>
    <button
      class="container_app_navigation_sidebar_help"
      type="button"
      aria-label="快捷键说明"
      :aria-expanded="showHelp"
      title="快捷键说明"
      @click="showHelp = !showHelp"
    >
      <CircleHelp :size="20" />
    </button>
    <button
      class="container_app_navigation_sidebar_settings"
      type="button"
      :aria-current="page === 'settings' ? 'page' : undefined"
      aria-label="设置"
      title="设置"
      @click="page = 'settings'"
    >
      <Settings :size="20" />
    </button>
    <button
      class="container_app_navigation_sidebar_avatar"
      type="button"
      :data-signed-in="syncStatus?.signedIn ? 'true' : 'false'"
      :title="avatarTitle"
      :aria-label="avatarTitle"
      @click="page = 'sync'"
    >
      {{ avatarLetter }}
    </button>
  </nav>
</template>

<style scoped lang="scss">
.container_app_navigation_sidebar_base {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 56px;
  flex-shrink: 0;
  padding: 14px 0 12px;
  gap: 9px;
  border-right: 1px solid var(--color-border);
  background:
    linear-gradient(180deg, var(--color-accent-primary-soft), transparent 22%), var(--color-surface-rail);
  box-shadow: inset -1px 0 0 rgba(255, 244, 218, 0.025);
  button {
    position: relative;
    width: 38px;
    height: 38px;
    padding: 0;
    overflow: hidden;
    color: var(--color-text-muted);
    transition:
      background 140ms,
      color 140ms,
      transform 140ms,
      box-shadow 140ms;
    &::after {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(
        115deg,
        transparent 28%,
        var(--color-scene-metal-soft) 48%,
        transparent 68%
      );
      transform: translateX(-110%);
      transition: transform 240ms ease-out;
      pointer-events: none;
    }
    &:hover:not(:disabled) {
      transform: translateY(-1px);
      color: var(--color-accent-primary-bright);
      box-shadow: var(--shadow-3d-sm);
      &::after {
        transform: translateX(110%);
      }
    }
    &[aria-current='page'] {
      color: var(--color-accent-primary);
      background: linear-gradient(155deg, var(--color-accent-primary-soft), transparent);
      box-shadow:
        inset 2px 0 var(--color-accent-primary),
        inset 0 1px 0 rgba(255, 244, 218, 0.12),
        0 8px 20px -6px var(--color-accent-primary-glow);
    }
  }
}
.container_app_navigation_sidebar_divider {
  width: 22px;
  height: 1px;
  margin: 8px 0;
  background: var(--color-border);
}
.container_app_navigation_sidebar_spacer {
  flex: 1;
}
.container_app_navigation_sidebar_sync,
.container_app_navigation_sidebar_tunnels {
  position: relative;
}
.container_app_navigation_sidebar_tunnel-badge {
  position: absolute;
  top: 4px;
  right: 4px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 999px;
  background: var(--color-success);
  color: #071912;
  font-size: 9px;
  font-weight: 700;
  line-height: 14px;
  text-align: center;
}
.container_app_navigation_sidebar_sync-dot {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  border: 1px solid var(--color-surface-rail);
  background: var(--color-text-muted);
  &[data-phase='synced'] {
    background: var(--color-success);
  }
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
.container_app_navigation_sidebar_avatar {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--color-accent-primary-ring);
  background: var(--color-accent-primary-soft);
  color: var(--color-accent-primary-hover);
  border-radius: 50%;
  font-size: 12px;
  margin-top: 9px;
  &[data-signed-in='true'] {
    border-color: var(--color-success);
    color: var(--color-success);
    background: rgba(52, 211, 153, 0.14);
  }
}
</style>
