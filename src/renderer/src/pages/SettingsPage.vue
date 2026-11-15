<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  ShieldCheck,
  Minimize2,
  RefreshCw,
  Download,
  ExternalLink,
  FolderOpen,
  Rocket
} from 'lucide-vue-next'
import { instanceClass } from '../../../shared/classes'
import type { TrayVisibilityMode } from '../../../shared/contracts'
import orbitIcon from '../assets/orbit-icon.svg'
import OrbitSelect from '../components/OrbitSelect.vue'
import { TERMINAL_THEMES, type CursorShape } from '../services/terminal-themes'
import { DEFAULT_CUSTOM_COLORS, UI_THEME_PRESETS } from '../services/ui-themes'
import {
  bootstrap,
  cancelUpdateDownload,
  checkForUpdates,
  copyOnSelect,
  cursorBlink,
  cursorStyle,
  customUiColors,
  downloadAvailableUpdate,
  focusUpdateSectionToken,
  fontSize,
  hideWindowToTray,
  highContrast,
  installDownloadedUpdate,
  lineHeight,
  motionTier,
  openUpdateReleasePage,
  page,
  revealDownloadedUpdate,
  screenReaderDefault,
  setUiTheme,
  terminalTheme,
  trayState,
  uiTheme,
  updateCustomUiColors,
  updateState,
  updateTrayPreferences,
  updateUpdaterPreferences,
  windowInstance,
  type MotionTier
} from '../stores/workbench'

const updateSectionRef = ref<HTMLElement>()

watch(focusUpdateSectionToken, async () => {
  await nextTick()
  updateSectionRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
})

const updateStatusLabel = computed(() => {
  const phase = updateState.value.phase
  if (phase === 'checking') return '正在检测…'
  if (phase === 'up-to-date') return '已是最新'
  if (phase === 'available') return `发现新版 v${updateState.value.latest?.version ?? ''}`
  if (phase === 'downloading') return '下载更新中'
  if (phase === 'downloaded') return '校验完成 · 待安装'
  if (phase === 'error') return '检测异常'
  return '待检测'
})

function formatByteSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '未知大小'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatIsoTime(iso: string | null | undefined): string {
  if (!iso) return '尚未检测'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('zh-CN', { hour12: false })
}

const updateMetaItems = computed(() => [
  { key: 'current', label: '当前版本', value: `v${updateState.value.currentVersion}` },
  {
    key: 'repo',
    label: 'GitHub 发布源',
    value: `${updateState.value.repository.owner}/${updateState.value.repository.repo}`
  },
  {
    key: 'checked',
    label: '最近检查',
    value: formatIsoTime(updateState.value.checkedAt ?? updateState.value.preferences.lastCheckedAt)
  }
])

const c = (base: string, token: string) => instanceClass(base, windowInstance(token))

const cursorStyleOptions = [
  { value: 'block', label: '实心方块 (Block)' },
  { value: 'bar', label: '竖线 (Bar)' },
  { value: 'underline', label: '下划线 (Underline)' }
]

const motionTierOptions = [
  { value: 'full', label: '完整' },
  { value: 'light', label: '轻量' },
  { value: 'off', label: '关闭' }
]

const trayVisibilityOptions = [
  { value: 'when-minimized', label: '仅最小化或收到后台时显示（推荐）' },
  { value: 'always', label: '程序运行期间始终显示图标' }
]

function patchCustomColor(key: keyof typeof DEFAULT_CUSTOM_COLORS, value: string): void {
  updateCustomUiColors({
    ...customUiColors.value,
    [key]: value
  })
}

function resetCustomUiTheme(): void {
  updateCustomUiColors({ ...DEFAULT_CUSTOM_COLORS })
  setUiTheme('bagua-taiji')
}
</script>

<template>
  <section v-if="page === 'settings'" class="container_settings_page_body_base">
    <span class="container_settings_page_header_eyebrow">丹青剑意 · 五行八卦美学工坊</span>
    <h2 class="container_settings_page_header_title">设置</h2>

    <section class="container_settings_uitheme_body_section">
      <h3 class="container_settings_uitheme_header_title">界面整体风格与道教五行八卦主题</h3>
      <p class="container_settings_uitheme_header_desc">
        实时切换全局工作区、导航栏、列表卡片与 3D 浑天八卦罗盘的主体视觉配色，并支持深度自定义色板。
      </p>
      <div class="container_settings_uitheme_grid_base">
        <button
          v-for="preset in UI_THEME_PRESETS"
          :key="preset.id"
          :class="c('container_settings_uitheme_card_base', preset.id)"
          type="button"
          :aria-pressed="uiTheme === preset.id"
          @click="setUiTheme(preset.id)"
        >
          <div :class="c('container_settings_uitheme_card_head', preset.id)">
            <span :class="c('container_settings_uitheme_card_trigram', preset.id)">
              {{ preset.trigram }}
            </span>
            <strong :class="c('container_settings_uitheme_card_name', preset.id)">
              {{ preset.name }}
            </strong>
            <span :class="c('container_settings_uitheme_card_elem', preset.id)">
              {{ preset.element }}
            </span>
          </div>
          <p :class="c('container_settings_uitheme_card_desc', preset.id)">
            {{ preset.tagline }}
          </p>
          <div :class="c('container_settings_uitheme_card_swatches', preset.id)">
            <span
              :class="c('container_settings_uitheme_swatch_bg', preset.id)"
              :style="{ backgroundColor: preset.colors.appBg }"
            />
            <span
              :class="c('container_settings_uitheme_swatch_panel', preset.id)"
              :style="{ backgroundColor: preset.colors.surface2 }"
            />
            <span
              :class="c('container_settings_uitheme_swatch_primary', preset.id)"
              :style="{ backgroundColor: preset.colors.accentPrimary }"
            />
            <span
              :class="c('container_settings_uitheme_swatch_secondary', preset.id)"
              :style="{ backgroundColor: preset.colors.accentSecondary }"
            />
          </div>
        </button>
      </div>

      <div class="container_settings_customui_panel_base" :data-active="uiTheme === 'custom'">
        <div class="container_settings_customui_header_row">
          <strong class="container_settings_customui_header_title">太虚自定 · 自定义全局配色</strong>
          <button
            class="container_settings_customui_apply_btn"
            type="button"
            @click="updateCustomUiColors(customUiColors)"
          >
            启用自定义配色
          </button>
          <button class="container_settings_customui_reset_btn" type="button" @click="resetCustomUiTheme">
            恢复默认玄墨古剑
          </button>
        </div>
        <div class="container_settings_customui_pickers_grid">
          <label class="container_settings_customui_picker_appbg">
            主背景
            <input
              type="color"
              class="container_settings_customui_input_appbg"
              :value="customUiColors.appBg"
              @input="patchCustomColor('appBg', ($event.target as HTMLInputElement).value)"
            />
          </label>
          <label class="container_settings_customui_picker_surface1">
            一级面板
            <input
              type="color"
              class="container_settings_customui_input_surface1"
              :value="customUiColors.surface1"
              @input="patchCustomColor('surface1', ($event.target as HTMLInputElement).value)"
            />
          </label>
          <label class="container_settings_customui_picker_surface2">
            二级卡片
            <input
              type="color"
              class="container_settings_customui_input_surface2"
              :value="customUiColors.surface2"
              @input="patchCustomColor('surface2', ($event.target as HTMLInputElement).value)"
            />
          </label>
          <label class="container_settings_customui_picker_accent">
            主强调色
            <input
              type="color"
              class="container_settings_customui_input_accent"
              :value="customUiColors.accentPrimary"
              @input="patchCustomColor('accentPrimary', ($event.target as HTMLInputElement).value)"
            />
          </label>
          <label class="container_settings_customui_picker_accent2">
            辅星辉色
            <input
              type="color"
              class="container_settings_customui_input_accent2"
              :value="customUiColors.accentSecondary"
              @input="patchCustomColor('accentSecondary', ($event.target as HTMLInputElement).value)"
            />
          </label>
          <label class="container_settings_customui_picker_text">
            主文字色
            <input
              type="color"
              class="container_settings_customui_input_text"
              :value="customUiColors.textPrimary"
              @input="patchCustomColor('textPrimary', ($event.target as HTMLInputElement).value)"
            />
          </label>
        </div>
      </div>
    </section>
    <section class="container_settings_terminal_body_base">
      <h3 class="container_settings_terminal_header_title">终端与视觉</h3>
      <label class="container_settings_terminal_body_font-label">
        字号
        <span class="container_settings_terminal_body_font-description">
          对所有终端立即生效，仅保存在本机。
        </span>
        <input
          v-model.number="fontSize"
          class="container_settings_terminal_body_font-input"
          type="range"
          min="10"
          max="24"
        />
        <output class="container_settings_terminal_body_font-value">{{ fontSize }} px</output>
      </label>
      <label class="container_settings_terminal_body_lh-label">
        行高
        <span class="container_settings_terminal_body_lh-description">
          适当增大行高可显著改善中英文混排与 TUI 框线视觉舒适度。
        </span>
        <input
          v-model.number="lineHeight"
          class="container_settings_terminal_body_lh-input"
          type="range"
          min="1.1"
          max="1.6"
          step="0.02"
        />
        <output class="container_settings_terminal_body_lh-value">{{ lineHeight.toFixed(2) }}</output>
      </label>
      <label class="container_settings_terminal_body_cursor-label">
        光标形态
        <OrbitSelect
          :model-value="cursorStyle"
          :options="cursorStyleOptions"
          aria-label="光标形态"
          width="190px"
          instance="settings-cursor"
          @update:model-value="cursorStyle = $event as CursorShape"
        />
      </label>
      <label class="container_settings_terminal_body_blink-label">
        <input v-model="cursorBlink" class="container_settings_terminal_body_blink-check" type="checkbox" />
        启用终端光标闪烁
      </label>
      <label class="container_settings_terminal_body_copy-label">
        <input v-model="copyOnSelect" class="container_settings_terminal_body_copy-check" type="checkbox" />
        鼠标划选终端文本时自动复制到剪贴板
      </label>
      <label class="container_settings_terminal_body_motion-label">
        动效与性能档
        <OrbitSelect
          :model-value="motionTier"
          :options="motionTierOptions"
          aria-label="动效与性能档"
          width="190px"
          instance="settings-motion"
          @update:model-value="motionTier = $event as MotionTier"
        />
      </label>
      <label class="container_settings_terminal_body_contrast-label">
        <input
          v-model="highContrast"
          class="container_settings_terminal_body_contrast-check"
          type="checkbox"
        />
        启用高对比度边框与文字
      </label>
      <label class="container_settings_terminal_body_reader-label">
        <input
          v-model="screenReaderDefault"
          class="container_settings_terminal_body_reader-check"
          type="checkbox"
        />
        默认开启终端屏幕阅读器无障碍模式
      </label>
      <div class="container_settings_theme_body_section">
        <span class="container_settings_theme_body_heading">终端配色主题（256色 / TrueColor 实时生效）</span>
        <div class="container_settings_theme_body_grid">
          <button
            v-for="preset in TERMINAL_THEMES"
            :key="preset.id"
            :class="c('container_settings_theme_card_base', preset.id)"
            type="button"
            :aria-pressed="terminalTheme === preset.id"
            @click="terminalTheme = preset.id"
          >
            <span
              :class="c('container_settings_theme_card_preview', preset.id)"
              :style="{ background: preset.background, color: preset.theme.foreground }"
            >
              <span
                :class="c('container_settings_theme_card_prompt', preset.id)"
                :style="{ color: preset.theme.magenta }"
              >
                ●
              </span>
              <span
                :class="c('container_settings_theme_card_path', preset.id)"
                :style="{ color: preset.theme.cyan }"
              >
                ~/app
              </span>
              <span
                :class="c('container_settings_theme_card_cursor', preset.id)"
                :style="{ background: preset.theme.cursor }"
              />
            </span>
            <span :class="c('container_settings_theme_card_meta', preset.id)">
              <strong :class="c('container_settings_theme_card_name', preset.id)">{{ preset.name }}</strong>
              <span :class="c('container_settings_theme_card_badge', preset.id)">{{ preset.badge }}</span>
            </span>
            <span :class="c('container_settings_theme_card_swatches', preset.id)">
              <span
                v-for="(swatch, idx) in preset.swatches"
                :key="idx"
                :class="c('container_settings_theme_card_swatch', `${preset.id}-s${idx}`)"
                :style="{ backgroundColor: swatch }"
              />
            </span>
          </button>
        </div>
      </div>
    </section>
    <section class="container_settings_tray_body_section">
      <div class="container_settings_tray_header_row">
        <h3 class="container_settings_tray_header_title">后台运行与系统托盘</h3>
        <span class="container_settings_tray_header_badge" :data-active="trayState.trayCreated">
          {{ trayState.trayCreated ? '托盘图标已在右侧工具栏显示' : '最小化时将在右侧系统托盘显示图标' }}
        </span>
      </div>
      <label class="container_settings_tray_minimize_label">
        <input
          class="container_settings_tray_minimize_check"
          type="checkbox"
          :checked="trayState.minimizeToTray"
          @change="updateTrayPreferences({ minimizeToTray: ($event.target as HTMLInputElement).checked })"
        />
        最小化时隐藏窗口并出现在右侧系统托盘（保持 SSH 会话、端口转发与同步后台运行）
      </label>
      <label class="container_settings_tray_close_label">
        <input
          class="container_settings_tray_close_check"
          type="checkbox"
          :checked="trayState.closeToTray"
          @change="updateTrayPreferences({ closeToTray: ($event.target as HTMLInputElement).checked })"
        />
        点击窗口关闭按钮（×）时最小化到后台系统托盘而不退出程序
      </label>
      <label class="container_settings_tray_visibility_label">
        系统托盘图标显示时机
        <OrbitSelect
          :model-value="trayState.trayVisibility"
          :options="trayVisibilityOptions"
          aria-label="系统托盘图标显示时机"
          width="276px"
          instance="settings-tray-visibility"
          @update:model-value="updateTrayPreferences({ trayVisibility: $event as TrayVisibilityMode })"
        />
      </label>
      <div class="container_settings_tray_actions_row">
        <button class="container_settings_tray_actions_hide" type="button" @click="hideWindowToTray">
          <Minimize2 :size="13" />
          立即隐藏到后台托盘
        </button>
        <span class="container_settings_tray_actions_hint">
          隐藏后点击 Windows 右下角系统托盘图标即可随时恢复主窗口，右键可快捷新建终端或退出。
        </span>
      </div>
    </section>
    <section class="container_settings_security_body_base">
      <h3 class="container_settings_security_header_title">数据与安全</h3>
      <p class="container_settings_security_body_status">
        <ShieldCheck :size="15" />
        {{
          bootstrap?.encryptionAvailable ? 'Windows 系统凭据保护可用' : '系统凭据保护不可用，密码保存已禁用'
        }}
      </p>
      <p class="container_settings_security_body_description">
        主机配置保存在本地 SQLite 数据库；选择保存的密码由 Windows 系统保护。终端输出和输入历史默认不落盘。
      </p>
    </section>
    <section ref="updateSectionRef" class="container_settings_update_body_section">
      <div class="container_settings_update_header_row">
        <h3 class="container_settings_update_header_title">版本演进与 GitHub 自动更新</h3>
        <span class="container_settings_update_header_badge" :data-phase="updateState.phase">
          {{ updateStatusLabel }}
        </span>
      </div>
      <div class="container_settings_update_meta_grid">
        <div
          v-for="item in updateMetaItems"
          :key="item.key"
          :class="c('container_settings_update_meta_item', item.key)"
        >
          <span :class="c('container_settings_update_meta_label', item.key)">{{ item.label }}</span>
          <strong :class="c('container_settings_update_meta_value', item.key)">{{ item.value }}</strong>
        </div>
      </div>

      <p class="container_settings_update_status_text" :data-phase="updateState.phase">
        {{ updateState.message }}
      </p>

      <div
        v-if="updateState.phase === 'downloading' && updateState.progress"
        class="container_settings_update_progress_box"
      >
        <div class="container_settings_update_progress_track">
          <div
            class="container_settings_update_progress_fill"
            :style="{ width: `${updateState.progress.percent ?? 15}%` }"
          />
        </div>
        <span class="container_settings_update_progress_text">
          {{ updateState.progress.percent ?? 0 }}% ·
          {{ formatByteSize(updateState.progress.transferredBytes) }} /
          {{ formatByteSize(updateState.progress.totalBytes) }}
        </span>
      </div>

      <div v-if="updateState.latest" class="container_settings_update_release_card">
        <div class="container_settings_update_release_head">
          <strong class="container_settings_update_release_version">
            {{ updateState.latest.title || updateState.latest.tagName }}
          </strong>
          <span v-if="updateState.latest.prerelease" class="container_settings_update_release_pretag">
            预发布版
          </span>
          <span class="container_settings_update_release_date">
            {{ formatIsoTime(updateState.latest.publishedAt) }}
          </span>
        </div>
        <div class="container_settings_update_release_assetrow">
          <span class="container_settings_update_release_assetname">
            安装包：{{ updateState.latest.assetName }}（{{ formatByteSize(updateState.latest.sizeBytes) }}）
          </span>
          <span v-if="updateState.verifiedHash" class="container_settings_update_release_verified">
            已校验 {{ updateState.verifiedHash.slice(0, 22) }}…
          </span>
        </div>
        <pre class="container_settings_update_release_notes">{{
          updateState.latest.notes || '此版本未附带额外说明，可在 GitHub Release 页面查看完整提交记录。'
        }}</pre>
      </div>

      <div class="container_settings_update_actions_row">
        <button
          class="container_settings_update_actions_check"
          type="button"
          :disabled="updateState.phase === 'checking' || updateState.phase === 'downloading'"
          @click="checkForUpdates"
        >
          <RefreshCw :size="13" />
          {{ updateState.phase === 'checking' ? '正在检查…' : '检查更新' }}
        </button>

        <button
          v-if="updateState.phase === 'available' && updateState.latest?.downloadUrl"
          class="container_settings_update_actions_download"
          type="button"
          data-primary="true"
          @click="downloadAvailableUpdate"
        >
          <Download :size="13" />
          下载更新（{{ formatByteSize(updateState.latest.sizeBytes) }}）
        </button>

        <button
          v-if="updateState.phase === 'downloading'"
          class="container_settings_update_actions_cancel"
          type="button"
          @click="cancelUpdateDownload"
        >
          取消下载
        </button>

        <button
          v-if="updateState.phase === 'downloaded'"
          class="container_settings_update_actions_install"
          type="button"
          data-primary="true"
          @click="installDownloadedUpdate"
        >
          <Rocket :size="13" />
          立即安装更新
        </button>

        <button
          v-if="updateState.phase === 'downloaded'"
          class="container_settings_update_actions_reveal"
          type="button"
          @click="revealDownloadedUpdate"
        >
          <FolderOpen :size="13" />
          在文件夹中显示
        </button>

        <button class="container_settings_update_actions_github" type="button" @click="openUpdateReleasePage">
          <ExternalLink :size="13" />
          查看 GitHub 发布页
        </button>

        <button
          v-if="
            updateState.phase === 'available' &&
            updateState.latest &&
            updateState.preferences.ignoredVersion !== updateState.latest.version
          "
          class="container_settings_update_actions_ignore"
          type="button"
          @click="updateUpdaterPreferences({ ignoredVersion: updateState.latest.version })"
        >
          忽略此版本
        </button>
      </div>

      <label class="container_settings_update_autocheck_label">
        <input
          class="container_settings_update_autocheck_check"
          type="checkbox"
          :checked="updateState.preferences.autoCheckOnStartup"
          @change="
            updateUpdaterPreferences({ autoCheckOnStartup: ($event.target as HTMLInputElement).checked })
          "
        />
        启动应用时在后台自动检查 GitHub 最新稳定版本
      </label>

      <label class="container_settings_update_prerelease_label">
        <input
          class="container_settings_update_prerelease_check"
          type="checkbox"
          :checked="updateState.preferences.allowPrerelease"
          @change="updateUpdaterPreferences({ allowPrerelease: ($event.target as HTMLInputElement).checked })"
        />
        接收预发布测试版（Alpha / Beta / RC）更新提示
      </label>
    </section>

    <section class="container_settings_about_body_base">
      <h3 class="container_settings_about_header_title">关于此开发版</h3>
      <div class="container_settings_about_body_brand">
        <img class="container_settings_about_body_icon" :src="orbitIcon" alt="" />
        <div class="container_settings_about_body_meta">
          <p class="container_settings_about_body_version">
            玄剑天枢 · Graphite Orbit {{ bootstrap?.versions.app }} · Electron
            {{ bootstrap?.versions.electron }} · Node {{ bootstrap?.versions.node }}
          </p>
          <p class="container_settings_about_body_scope">
            已开放：本地主机管理、本地终端、基础 SSH 密码与 Agent 连接、主机指纹确认、标签分屏、实时 3D
            轨道视效与 M4 端到端加密远程同步（Argon2id + AES-256-GCM + 三方合并 + Vault
            轮换）。SFTP、监控与隧道运行时转发将在后续阶段完善。
          </p>
        </div>
      </div>
    </section>
  </section>
</template>

<style scoped lang="scss">
.container_settings_page_body_base {
  padding: 36px;
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.container_settings_page_header_eyebrow {
  font-size: 12px;
  letter-spacing: 1.5px;
  color: var(--color-accent-primary);
}
.container_settings_page_header_title {
  font-size: 22px;
  font-weight: 500;
  margin: 10px 0;
}
.container_settings_terminal_body_base,
.container_settings_tray_body_section,
.container_settings_security_body_base,
.container_settings_update_body_section,
.container_settings_about_body_base {
  padding: 22px 0;
  border-bottom: 1px solid var(--color-border);
  max-width: 750px;
  h3 {
    font-size: 14px;
    font-weight: 500;
    margin: 0 0 18px;
  }
  p {
    font-size: 13px;
    line-height: 1.8;
    color: var(--color-text-secondary);
  }
}
.container_settings_tray_header_row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
  h3 {
    margin: 0;
  }
}
.container_settings_tray_header_badge {
  font-size: 11px;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid var(--color-border);
  background: var(--color-surface-1);
  color: var(--color-text-muted);
  &[data-active='true'] {
    border-color: rgba(89, 214, 160, 0.4);
    background: rgba(89, 214, 160, 0.1);
    color: #6ee7b7;
  }
}
.container_settings_tray_minimize_label,
.container_settings_tray_close_label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  font-size: 13px;
  color: var(--color-text-secondary);
}
.container_settings_tray_visibility_label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 16px;
  font-size: 13px;
}
.container_settings_tray_actions_row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 16px;
}
.container_settings_tray_actions_hide {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.container_settings_tray_actions_hint {
  font-size: 12px;
  color: var(--color-text-muted);
}
.container_settings_terminal_body_font-label {
  display: grid;
  grid-template-columns: 1fr 220px 56px;
  align-items: center;
  gap: 14px;
  font-size: 13px;
}
.container_settings_terminal_body_font-description {
  grid-column: 1;
  grid-row: 2;
  font-size: 12px;
  color: var(--color-text-muted);
}
.container_settings_terminal_body_font-input {
  grid-column: 2;
  grid-row: 1 / 3;
  width: 100%;
}
.container_settings_terminal_body_font-value,
.container_settings_terminal_body_lh-value {
  grid-column: 3;
  grid-row: 1 / 3;
  color: var(--color-accent-primary);
}
.container_settings_terminal_body_lh-label {
  display: grid;
  grid-template-columns: 1fr 220px 56px;
  align-items: center;
  gap: 14px;
  font-size: 13px;
  margin-top: 16px;
}
.container_settings_terminal_body_lh-description {
  grid-column: 1;
  grid-row: 2;
  font-size: 12px;
  color: var(--color-text-muted);
}
.container_settings_terminal_body_lh-input {
  grid-column: 2;
  grid-row: 1 / 3;
  width: 100%;
}
.container_settings_terminal_body_cursor-label,
.container_settings_terminal_body_motion-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 18px;
  font-size: 13px;
}
.container_settings_terminal_body_blink-label,
.container_settings_terminal_body_copy-label,
.container_settings_terminal_body_contrast-label,
.container_settings_terminal_body_reader-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
  font-size: 13px;
  color: var(--color-text-secondary);
}
.container_settings_theme_body_section {
  margin-top: 24px;
}
.container_settings_theme_body_heading {
  display: block;
  font-size: 13px;
  color: var(--color-text-primary);
  margin-bottom: 12px;
}
.container_settings_theme_body_grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 10px;
}
.container_settings_theme_card_base {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  padding: 10px;
  text-align: left;
  border-radius: 10px;
  border: 1px solid var(--color-border);
  background: var(--color-surface-1);
  &[aria-pressed='true'] {
    border-color: var(--color-accent-primary);
    box-shadow: 0 0 0 1px var(--color-accent-primary-ring);
    background: var(--color-surface-2);
  }
}
.container_settings_theme_card_preview {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 6px;
  font-family: var(--font-mono);
  font-size: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.container_settings_theme_card_cursor {
  display: inline-block;
  width: 7px;
  height: 13px;
  border-radius: 1px;
}
.container_settings_theme_card_meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.container_settings_theme_card_name {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-primary);
}
.container_settings_theme_card_badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--color-accent-primary-soft);
  border: 1px solid var(--color-accent-primary-ring);
  color: var(--color-accent-primary-hover);
}
.container_settings_theme_card_swatches {
  display: flex;
  gap: 5px;
}
.container_settings_theme_card_swatch {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.14);
}
.container_settings_security_body_status {
  display: flex;
  align-items: center;
  gap: 7px;
}
.container_settings_uitheme_body_section {
  padding: 20px 0 24px;
  border-bottom: 1px solid var(--color-border);
  max-width: 820px;
}
.container_settings_uitheme_header_title {
  font-size: 14px;
  font-weight: 500;
  margin: 0 0 8px;
}
.container_settings_uitheme_header_desc {
  margin: 0 0 14px;
  font-size: 12px;
  color: var(--color-text-muted);
}
.container_settings_uitheme_grid_base {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(235px, 1fr));
  gap: 10px;
}
[class*='container_settings_uitheme_card_base'] {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 7px;
  padding: 11px 12px;
  text-align: left;
  border-radius: 6px;
  border: 1px solid var(--color-border);
  background: var(--color-surface-1);
  &[aria-pressed='true'] {
    border-color: var(--color-accent-primary);
    box-shadow: 0 0 0 1px var(--color-accent-primary-ring);
    background: var(--color-surface-2);
  }
}
[class*='container_settings_uitheme_card_head'] {
  display: flex;
  align-items: center;
  gap: 6px;
}
[class*='container_settings_uitheme_card_trigram'] {
  color: var(--color-accent-secondary);
  font-size: 14px;
}
[class*='container_settings_uitheme_card_name'] {
  font-size: 12px;
  color: var(--color-text-primary);
}
[class*='container_settings_uitheme_card_elem'] {
  margin-left: auto;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  border: 1px solid var(--color-seal-ring);
  background: var(--color-seal-soft);
  color: #f3c6be;
}
[class*='container_settings_uitheme_card_desc'] {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-text-muted);
}
[class*='container_settings_uitheme_card_swatches'] {
  display: flex;
  gap: 6px;
  margin-top: 2px;
  > span {
    width: 16px;
    height: 16px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.16);
  }
}
.container_settings_customui_panel_base {
  margin-top: 14px;
  padding: 14px;
  border-radius: 10px;
  border: 1px solid var(--color-border);
  background: var(--color-surface-1);
  display: flex;
  flex-direction: column;
  gap: 12px;
  &[data-active='true'] {
    border-color: var(--color-accent-primary);
  }
}
.container_settings_customui_header_row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.container_settings_customui_apply_btn {
  margin-left: auto;
}
.container_settings_customui_pickers_grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: 10px;
  label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    font-size: 12px;
    color: var(--color-text-secondary);
    padding: 6px 8px;
    border-radius: 8px;
    border: 1px solid var(--color-border-subtle);
    background: var(--color-surface-2);
    input {
      width: 30px;
      height: 24px;
      padding: 0;
      border: none;
      background: transparent;
    }
  }
}
.container_settings_about_body_brand {
  display: flex;
  align-items: flex-start;
  gap: 18px;
}
.container_settings_about_body_icon {
  width: 64px;
  height: 64px;
  flex-shrink: 0;
  border-radius: 10px;
  filter: drop-shadow(0 8px 18px var(--color-accent-primary-glow));
  transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
  &:hover {
    transform: perspective(400px) rotateY(-12deg) rotateX(8deg) scale(1.04);
  }
}
.container_settings_about_body_meta {
  min-width: 0;
  p:first-child {
    margin-top: 0;
  }
}
.container_settings_update_header_row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
  h3 {
    margin: 0;
  }
}
.container_settings_update_header_badge {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--color-border);
  background: var(--color-surface-1);
  color: var(--color-text-muted);
  &[data-phase='up-to-date'],
  &[data-phase='downloaded'] {
    border-color: rgba(89, 214, 160, 0.42);
    background: rgba(89, 214, 160, 0.1);
    color: #86efac;
  }
  &[data-phase='available'],
  &[data-phase='downloading'] {
    border-color: var(--color-accent-primary-ring);
    background: var(--color-accent-primary-soft);
    color: var(--color-accent-primary-hover);
  }
  &[data-phase='error'] {
    border-color: var(--color-seal-ring);
    background: var(--color-seal-soft);
    color: #f4d9cf;
  }
}
.container_settings_update_meta_grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}
.container_settings_update_meta_item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border);
  background: var(--color-surface-1);
}
.container_settings_update_meta_label {
  font-size: 11px;
  color: var(--color-text-muted);
}
.container_settings_update_meta_value {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-primary);
  font-family: var(--font-mono);
}
.container_settings_update_status_text {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--color-text-secondary);
  &[data-phase='error'] {
    color: #fca5a5;
  }
}
.container_settings_update_progress_box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 14px;
}
.container_settings_update_progress_track {
  width: 100%;
  height: 7px;
  border-radius: 999px;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  overflow: hidden;
}
.container_settings_update_progress_fill {
  height: 100%;
  background: linear-gradient(90deg, var(--color-accent-primary), var(--color-accent-secondary));
  transition: width 140ms ease;
}
.container_settings_update_progress_text {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-text-muted);
}
.container_settings_update_release_card {
  padding: 12px 14px;
  border-radius: var(--radius-card);
  border: 1px solid var(--color-border);
  background: var(--color-surface-1);
  margin-bottom: 14px;
}
.container_settings_update_release_head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.container_settings_update_release_version {
  font-size: 13px;
  color: var(--color-accent-primary-hover);
}
.container_settings_update_release_pretag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  border: 1px solid var(--color-seal-ring);
  background: var(--color-seal-soft);
  color: #f4d9cf;
}
.container_settings_update_release_date {
  margin-left: auto;
  font-size: 11px;
  color: var(--color-text-muted);
}
.container_settings_update_release_assetrow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 11px;
  color: var(--color-text-muted);
  margin-bottom: 8px;
}
.container_settings_update_release_verified {
  font-family: var(--font-mono);
  color: #86efac;
}
.container_settings_update_release_notes {
  margin: 0;
  padding: 10px;
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border-subtle);
  background: var(--color-surface-2);
  color: var(--color-text-secondary);
  font-family: var(--font-sans);
  font-size: 12px;
  line-height: 1.65;
  white-space: pre-wrap;
  max-height: 160px;
  overflow: auto;
}
.container_settings_update_actions_row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 14px;
  button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
}
.container_settings_update_autocheck_label,
.container_settings_update_prerelease_label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  font-size: 13px;
  color: var(--color-text-secondary);
}
</style>
