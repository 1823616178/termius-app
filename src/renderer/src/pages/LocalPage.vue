<script setup lang="ts">
import { SquareTerminal, ArrowUpRight, Monitor, RefreshCw } from 'lucide-vue-next'
import { instanceClass } from '../../../shared/classes'
import { applyCardTilt, resetCardTilt } from '../services/card-tilt'
import {
  bootstrap,
  openLocal,
  page,
  refreshShells,
  shellsRefreshing,
  windowInstance
} from '../stores/workbench'

const c = (base: string, token: string) => instanceClass(base, windowInstance(token))
</script>

<template>
  <section v-if="page === 'local'" class="container_local_page_body_base">
    <header class="container_local_page_header_base">
      <div class="container_local_page_header_copy">
        <span class="container_local_page_header_eyebrow">咫尺丹室 · 内景吐纳</span>
        <h2 class="container_local_page_header_title">本地终端</h2>
        <p class="container_local_page_header_description">
          {{
            bootstrap?.platform === 'linux'
              ? '自动发现 $SHELL、/etc/shells 与系统终端环境；点击即在独立 PTY 中运行，支持 256 色与 TrueColor。'
              : '自动发现 PowerShell、CMD 与已安装的 WSL 发行版；点击即在独立 ConPTY 进程中运行，保持熟悉的 Shell 体验。'
          }}
        </p>
      </div>
      <button
        class="container_local_page_header_refresh"
        type="button"
        :disabled="shellsRefreshing || !bootstrap"
        @click="refreshShells"
      >
        <RefreshCw :size="14" />
        {{ shellsRefreshing ? '扫描中…' : '重新扫描' }}
      </button>
    </header>
    <div class="container_local_profiles_body_list">
      <article
        v-for="profile in bootstrap?.shells"
        :key="profile.id"
        :class="c('container_local_profile_body_base', profile.id)"
        @pointermove="applyCardTilt($event)"
        @pointerleave="resetCardTilt($event)"
      >
        <span :class="c('container_local_profile_header_icon', profile.id)">
          <SquareTerminal :size="25" />
        </span>
        <h3 :class="c('container_local_profile_body_name', profile.id)">{{ profile.name }}</h3>
        <span :class="c('container_local_profile_body_detail', profile.id)">{{ profile.detail }}</span>
        <code :class="c('container_local_profile_body_path', profile.id)">
          {{ profile.executable }}
        </code>
        <button
          :class="c('container_local_profile_footer_open', profile.id)"
          type="button"
          @click="openLocal(profile)"
        >
          打开终端
          <ArrowUpRight :size="15" />
        </button>
      </article>
    </div>
    <p class="container_local_page_footer_hint">
      <Monitor :size="14" />
      {{
        bootstrap?.platform === 'linux'
          ? '自动发现 $SHELL、/etc/shells 与系统已安装终端。'
          : '自动发现已安装的 Shell 与 WSL 发行版。未安装的环境不会被自动安装。'
      }}
    </p>
  </section>
</template>

<style scoped lang="scss">
.container_local_page_body_base {
  padding: 36px;
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.container_local_page_header_base {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}
.container_local_page_header_eyebrow {
  font-size: 12px;
  letter-spacing: 1.5px;
  color: var(--color-accent-primary);
}
.container_local_page_header_title {
  font-size: 22px;
  font-weight: 500;
  margin: 10px 0;
}
.container_local_page_header_description {
  color: var(--color-text-muted);
  font-size: 13px;
  margin: 0;
}
.container_local_page_header_refresh {
  border: 1px solid var(--color-border-control);
  font-size: 12px;
}
.container_local_profiles_body_list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
  margin-top: 30px;
  perspective: 1200px;
}
.container_local_profile_body_base {
  display: flex;
  flex-direction: column;
  padding: 24px;
  border: 1px solid var(--color-border-control);
  background: var(--surface-card-gradient);
  border-radius: 6px;
  transform-style: preserve-3d;
  box-shadow: var(--shadow-3d-sm);
  transition:
    transform 180ms cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 180ms cubic-bezier(0.22, 1, 0.36, 1),
    border-color 140ms;
  &:hover {
    transform: perspective(900px) rotateX(var(--card-rx, 0deg)) rotateY(var(--card-ry, 0deg)) translateY(-3px)
      translateZ(6px);
    box-shadow: var(--shadow-3d-card);
    border-color: var(--color-accent-secondary-ring);
  }
}
.container_local_profile_header_icon {
  color: var(--color-accent-secondary);
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  background: linear-gradient(155deg, var(--color-accent-secondary-soft), transparent);
  border: 1px solid var(--color-accent-secondary-ring);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12);
  transform: translateZ(12px);
}
.container_local_profile_body_name {
  font-weight: 500;
  font-size: 15px;
}
.container_local_profile_body_detail {
  font-size: 12px;
  color: var(--color-text-muted);
}
.container_local_profile_body_path {
  font-size: 12px;
  color: var(--color-text-muted);
  overflow-wrap: anywhere;
  margin: 16px 0 24px;
  line-height: 1.7;
}
.container_local_profile_footer_open {
  align-self: flex-start;
  color: var(--color-accent-primary);
  padding: 6px 0;
  font-size: 12px;
}
.container_local_page_footer_hint {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  margin-top: 30px;
  color: var(--color-text-muted);
}
</style>
