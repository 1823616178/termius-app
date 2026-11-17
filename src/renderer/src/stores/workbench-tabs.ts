import { computed } from 'vue'
import type { Host, ShellProfile } from '../../../shared/contracts'
import { markHostUsed } from '../services/host-recency'
import { disposeTerminalByToken } from '../services/terminal-registry'
import {
  activeTab,
  advancePromptQueue,
  bootstrap,
  dismissStalePanePrompts,
  getPaneContainer,
  homeVisible,
  hosts,
  instanceToken,
  markSplitAnimation,
  nextPromptAttempt,
  notify,
  page,
  paneContainers,
  passwordQueue,
  prompt,
  promptBusy,
  selected,
  selectedShellId,
  tabs,
  windowInstance,
  type Pane,
  type PromptState,
  type SplitDropZone,
  type Tab
} from './workbench-state'

export function isPaneTokenMounted(windowPaneToken: string): boolean {
  return tabs.value.some((tab) => tab.panes.some((pane) => windowInstance(pane.token) === windowPaneToken))
}

export function resolveSplitDropZone(relX: number, relY: number): SplitDropZone {
  const x = Math.min(1, Math.max(0, relX))
  const y = Math.min(1, Math.max(0, relY))
  const topDist = y
  const bottomDist = 1 - y
  const leftDist = x
  const rightDist = 1 - x
  if (y < 0.28 && topDist <= leftDist && topDist <= rightDist && topDist <= bottomDist) {
    return 'top'
  }
  if (y > 0.72 && bottomDist <= leftDist && bottomDist <= rightDist && bottomDist < topDist) {
    return 'bottom'
  }
  return x < 0.5 ? 'left' : 'right'
}

export const currentTab = computed(() => tabs.value.find((tab) => tab.token === activeTab.value))

export function goHome(): void {
  homeVisible.value = true
  page.value = 'workspace'
}

export function activateTab(token: string): void {
  const tab = tabs.value.find((item) => item.token === token)
  if (!tab) return
  activeTab.value = token
  homeVisible.value = false
  page.value = 'workspace'
  const pane = tab.panes.find((item) => item.token === tab.focusedPaneToken) ?? tab.panes[0]
  if (pane?.hostId) markHostUsed(pane.hostId)
}

export const focusedPane = computed(() => {
  const tab = currentTab.value
  if (!tab) return undefined
  return tab.panes.find((pane) => pane.token === tab.focusedPaneToken) ?? tab.panes[0]
})

export const defaultShellProfile = computed(
  () =>
    bootstrap.value?.shells.find((item) => item.id === selectedShellId.value) ?? bootstrap.value?.shells[0]
)

export const runningCount = computed(
  () => tabs.value.flatMap((tab) => tab.panes).filter((pane) => pane.state === 'running').length
)

export function requestPanePassword(tabToken: string, paneToken: string, errorMessage?: string): void {
  const tab = tabs.value.find((item) => item.token === tabToken)
  const pane = tab?.panes.find((item) => item.token === paneToken)
  if (!tab || !pane || pane.kind !== 'ssh' || !pane.hostId) return
  const host = hosts.value.find((item) => item.id === pane.hostId)
  if (!host) return
  if (
    (prompt.value?.kind === 'password' && prompt.value.paneToken === paneToken) ||
    passwordQueue.value.some((item) => item.paneToken === paneToken)
  ) {
    return
  }
  const nextPrompt: PromptState = {
    kind: 'password',
    host,
    tabToken,
    paneToken,
    reason: 'auth-failed',
    message: errorMessage || 'SSH 密码认证失败，请重新输入登录密码。',
    attempt: nextPromptAttempt()
  }
  if (prompt.value) {
    passwordQueue.value.push(nextPrompt)
  } else {
    prompt.value = nextPrompt
  }
}

function canTabAccommodatePanes(
  tab: Tab | undefined,
  additionalPanes = 1,
  direction?: Tab['direction']
): { ok: boolean; reason?: string } {
  if (!tab) return { ok: false }
  const totalPanes = tab.panes.length + additionalPanes
  if (totalPanes > 4) {
    return { ok: false, reason: '当前开发版每个标签最多 4 个窗格。' }
  }
  const container = getPaneContainer(tab.token)
  const effectiveDirection = direction ?? tab.direction
  const vertical = effectiveDirection === 'vertical'
  if (
    container &&
    container.clientWidth > 0 &&
    container.clientHeight > 0 &&
    ((vertical && container.clientHeight / totalPanes < 180) ||
      (!vertical && container.clientWidth / totalPanes < 320))
  ) {
    return { ok: false, reason: '窗格空间不足，请放大窗口或新建标签。' }
  }
  return { ok: true }
}

export function canSplitCurrentTab(direction?: Tab['direction']): { ok: boolean; reason?: string } {
  return canTabAccommodatePanes(currentTab.value, 1, direction)
}

export function addPane(pane: Pane, split = false, placement: 'before' | 'after' = 'after'): boolean {
  if (split && currentTab.value) {
    const check = canSplitCurrentTab()
    if (!check.ok) {
      if (check.reason) notify(check.reason)
      return false
    }
    if (placement === 'before') currentTab.value.panes.unshift(pane)
    else currentTab.value.panes.push(pane)
    currentTab.value.focusedPaneToken = pane.token
    markSplitAnimation(pane.token)
  } else {
    const tab: Tab = {
      token: instanceToken(),
      title: pane.title,
      panes: [pane],
      focusedPaneToken: pane.token,
      direction: 'horizontal',
      ratio: 50
    }
    tabs.value.push(tab)
    activeTab.value = tab.token
  }
  homeVisible.value = false
  page.value = 'workspace'
  return true
}

export function openLocal(
  profile: ShellProfile,
  split = false,
  placement: 'before' | 'after' = 'after'
): boolean {
  return addPane(
    {
      token: instanceToken(),
      title: profile.name,
      kind: 'local',
      profileId: profile.id,
      state: 'connecting'
    },
    split,
    placement
  )
}

export function connectHost(
  host: Host,
  split = false,
  password?: string,
  placement: 'before' | 'after' = 'after'
): boolean {
  if (split) {
    const check = canSplitCurrentTab()
    if (!check.ok) {
      if (check.reason) notify(check.reason)
      return false
    }
  }
  if (host.auth === 'password' && !host.hasPassword && password === undefined) {
    prompt.value = { kind: 'password', host, split, attempt: nextPromptAttempt() }
    return false
  }
  return addPane(
    { token: instanceToken(), title: host.name, kind: 'ssh', hostId: host.id, password, state: 'connecting' },
    split,
    placement
  )
}

export function splitActivePane(
  direction: Tab['direction'],
  placement: 'before' | 'after' = 'after'
): boolean {
  const tab = currentTab.value
  const source = focusedPane.value
  if (!tab || !source) return false
  const check = canSplitCurrentTab(direction)
  if (!check.ok) {
    if (check.reason) notify(check.reason)
    return false
  }
  tab.direction = direction
  tab.ratio = 50
  if (source.kind === 'local') {
    const profile = bootstrap.value?.shells.find((item) => item.id === source.profileId)
    if (profile) return openLocal(profile, true, placement)
    notify('原本地终端配置已不可用，请刷新后重试。')
    return false
  }
  const host = hosts.value.find((item) => item.id === source.hostId)
  if (host) return connectHost(host, true, undefined, placement)
  notify('原主机配置已删除，请新建连接。')
  return false
}

function insertPanesRelative(
  targetTab: Tab,
  panesToInsert: Pane[],
  placement: 'before' | 'after',
  targetPaneToken?: string
): void {
  const anchorIdx = targetPaneToken ? targetTab.panes.findIndex((pane) => pane.token === targetPaneToken) : -1
  if (anchorIdx >= 0) {
    const insertAt = placement === 'before' ? anchorIdx : anchorIdx + 1
    targetTab.panes.splice(insertAt, 0, ...panesToInsert)
  } else if (placement === 'before') {
    targetTab.panes.unshift(...panesToInsert)
  } else {
    targetTab.panes.push(...panesToInsert)
  }
}

export function dockTabToSplit(
  sourceTabToken: string,
  targetTabToken: string,
  zone: SplitDropZone,
  targetPaneToken?: string
): boolean {
  if (!sourceTabToken || !targetTabToken) return false
  const direction: Tab['direction'] = zone === 'top' || zone === 'bottom' ? 'vertical' : 'horizontal'
  const placement: 'before' | 'after' = zone === 'left' || zone === 'top' ? 'before' : 'after'

  if (sourceTabToken === targetTabToken) return false

  const sourceTab = tabs.value.find((tab) => tab.token === sourceTabToken)
  const targetTab = tabs.value.find((tab) => tab.token === targetTabToken)
  if (!sourceTab || !targetTab) return false

  const check = canTabAccommodatePanes(targetTab, sourceTab.panes.length, direction)
  if (!check.ok) {
    if (check.reason) notify(check.reason)
    return false
  }

  const movedFocus = sourceTab.focusedPaneToken || sourceTab.panes[0]?.token || ''
  targetTab.direction = direction
  targetTab.ratio = 50
  insertPanesRelative(targetTab, sourceTab.panes, placement, targetPaneToken)

  tabs.value = tabs.value.filter((tab) => tab.token !== sourceTabToken)
  paneContainers.delete(sourceTabToken)
  if (movedFocus) targetTab.focusedPaneToken = movedFocus
  activeTab.value = targetTab.token
  page.value = 'workspace'
  if (movedFocus) markSplitAnimation(movedFocus)

  const zoneLabel = zone === 'left' ? '左侧' : zone === 'right' ? '右侧' : zone === 'top' ? '上方' : '下方'
  notify(`已将「${sourceTab.title}」并入${zoneLabel}分屏`)
  return true
}

export function movePaneToSplit(
  sourceTabToken: string,
  sourcePaneToken: string,
  targetTabToken: string,
  zone: SplitDropZone,
  targetPaneToken?: string
): boolean {
  if (!sourceTabToken || !sourcePaneToken || !targetTabToken) return false
  const sourceTab = tabs.value.find((tab) => tab.token === sourceTabToken)
  const targetTab = tabs.value.find((tab) => tab.token === targetTabToken)
  if (!sourceTab || !targetTab) return false
  const sourceIndex = sourceTab.panes.findIndex((pane) => pane.token === sourcePaneToken)
  if (sourceIndex < 0) return false

  const direction: Tab['direction'] = zone === 'top' || zone === 'bottom' ? 'vertical' : 'horizontal'
  const placement: 'before' | 'after' = zone === 'left' || zone === 'top' ? 'before' : 'after'
  const zoneLabel = zone === 'left' ? '左侧' : zone === 'right' ? '右侧' : zone === 'top' ? '上方' : '下方'

  if (sourceTabToken === targetTabToken) {
    if (sourceTab.panes.length <= 1) return false
    const prevDirection = sourceTab.direction
    const samePane = !targetPaneToken || targetPaneToken === sourcePaneToken
    if (samePane && prevDirection === direction) return false

    const [movedPane] = sourceTab.panes.splice(sourceIndex, 1)
    if (!movedPane) return false

    const anchorIdx =
      !samePane && targetPaneToken ? sourceTab.panes.findIndex((pane) => pane.token === targetPaneToken) : -1
    const insertAt =
      anchorIdx >= 0
        ? placement === 'before'
          ? anchorIdx
          : anchorIdx + 1
        : placement === 'before'
          ? 0
          : sourceTab.panes.length
    sourceTab.panes.splice(insertAt, 0, movedPane)
    sourceTab.direction = direction
    if (prevDirection !== direction) {
      sourceTab.ratio = 50
    } else if (sourceTab.panes.length === 2 && sourceIndex !== insertAt) {
      sourceTab.ratio = 100 - sourceTab.ratio
    }
    sourceTab.focusedPaneToken = movedPane.token
    activeTab.value = sourceTab.token
    page.value = 'workspace'
    markSplitAnimation(movedPane.token)
    notify(`已将「${movedPane.title}」移动至${zoneLabel}分屏`)
    return true
  }

  const check = canTabAccommodatePanes(targetTab, 1, direction)
  if (!check.ok) {
    if (check.reason) notify(check.reason)
    return false
  }

  const [movedPane] = sourceTab.panes.splice(sourceIndex, 1)
  if (!movedPane) return false
  if (sourceTab.panes.length === 0) {
    tabs.value = tabs.value.filter((tab) => tab.token !== sourceTabToken)
    paneContainers.delete(sourceTabToken)
  } else {
    sourceTab.ratio = 50
    if (sourceTab.focusedPaneToken === sourcePaneToken) {
      sourceTab.focusedPaneToken =
        sourceTab.panes[Math.min(sourceIndex, sourceTab.panes.length - 1)]?.token ?? ''
    }
    if (sourceTab.panes.length === 1) {
      sourceTab.title = sourceTab.panes[0]!.title
    }
  }

  insertPanesRelative(targetTab, [movedPane], placement, targetPaneToken)
  targetTab.direction = direction
  targetTab.ratio = 50
  targetTab.focusedPaneToken = movedPane.token
  activeTab.value = targetTab.token
  page.value = 'workspace'
  markSplitAnimation(movedPane.token)
  notify(`已将「${movedPane.title}」移入目标${zoneLabel}分屏`)
  return true
}

export function detachPaneToTab(tabToken: string, paneToken: string): boolean {
  const tabIndex = tabs.value.findIndex((tab) => tab.token === tabToken)
  if (tabIndex < 0) return false
  const tab = tabs.value[tabIndex]!
  if (tab.panes.length <= 1) return false
  const paneIndex = tab.panes.findIndex((pane) => pane.token === paneToken)
  if (paneIndex < 0) return false

  const [pane] = tab.panes.splice(paneIndex, 1)
  tab.ratio = 50
  if (tab.focusedPaneToken === paneToken) {
    tab.focusedPaneToken = tab.panes[Math.min(paneIndex, tab.panes.length - 1)]?.token ?? ''
  }
  if (tab.panes.length === 1) {
    tab.title = tab.panes[0]!.title
  }

  const detachedTab: Tab = {
    token: instanceToken(),
    title: pane!.title,
    panes: [pane!],
    focusedPaneToken: pane!.token,
    direction: 'horizontal',
    ratio: 50
  }
  tabs.value.splice(tabIndex + 1, 0, detachedTab)
  activeTab.value = detachedTab.token
  page.value = 'workspace'
  markSplitAnimation(pane!.token)
  notify(`已将「${pane!.title}」拆分为独立标签页`)
  return true
}

export function closePane(tabToken: string, paneToken: string): void {
  const tab = tabs.value.find((item) => item.token === tabToken)
  if (!tab) return
  if (tab.panes.length <= 1) {
    closeTab(tabToken)
    return
  }
  const paneIndex = tab.panes.findIndex((pane) => pane.token === paneToken)
  if (paneIndex < 0) return
  tab.panes.splice(paneIndex, 1)
  tab.ratio = 50
  if (tab.focusedPaneToken === paneToken) {
    tab.focusedPaneToken = tab.panes[Math.min(paneIndex, tab.panes.length - 1)]?.token ?? ''
  }
  if (tab.panes.length === 1) {
    tab.title = tab.panes[0]!.title
  }
  dismissStalePanePrompts(paneToken)
  disposeTerminalByToken(windowInstance(paneToken))
}

export function closeTab(id: string): void {
  const index = tabs.value.findIndex((tab) => tab.token === id)
  const closing = index >= 0 ? tabs.value[index] : undefined
  tabs.value = tabs.value.filter((tab) => tab.token !== id)
  paneContainers.delete(id)
  if (closing) {
    for (const pane of closing.panes) {
      dismissStalePanePrompts(pane.token)
      disposeTerminalByToken(windowInstance(pane.token))
    }
  }
  if (activeTab.value === id) activeTab.value = tabs.value[Math.max(0, index - 1)]?.token ?? ''
}

export function reorderTab(sourceToken: string, targetToken: string, placement?: 'before' | 'after'): void {
  if (!sourceToken || sourceToken === targetToken) return
  const sourceIndex = tabs.value.findIndex((tab) => tab.token === sourceToken)
  const targetIndex = tabs.value.findIndex((tab) => tab.token === targetToken)
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return
  const [tab] = tabs.value.splice(sourceIndex, 1)
  const anchor = tabs.value.findIndex((item) => item.token === targetToken)
  const insertAt = placement ? anchor + (placement === 'after' ? 1 : 0) : targetIndex
  tabs.value.splice(insertAt, 0, tab!)
}

export function cycleTab(step: 1 | -1): void {
  if (!tabs.value.length) return
  const index = tabs.value.findIndex((tab) => tab.token === activeTab.value)
  const nextIndex = (index + step + tabs.value.length) % tabs.value.length
  activateTab(tabs.value[nextIndex]!.token)
}

export async function confirmAction(password: string, savePassword = false): Promise<void> {
  const action = prompt.value
  if (!action || promptBusy.value) return
  promptBusy.value = true
  try {
    if (action.kind === 'password' && action.host) {
      if (savePassword && password && action.host.auth === 'password') {
        try {
          hosts.value = await window.orbit.hosts.save({
            id: action.host.id,
            name: action.host.name,
            address: action.host.address,
            port: action.host.port,
            username: action.host.username,
            auth: 'password',
            keepalive: action.host.keepalive ?? 30,
            group: action.host.group,
            notes: action.host.notes,
            favorite: action.host.favorite,
            password,
            savePassword: true
          })
          notify(`已更新「${action.host.name}」的保存密码`)
        } catch (error) {
          notify(error instanceof Error ? error.message : '密码保存失败，将仅用于本次连接')
        }
      }
      if (action.paneToken) {
        const targetPane = tabs.value
          .flatMap((tab) => tab.panes)
          .find((pane) => pane.token === action.paneToken)
        if (targetPane) {
          targetPane.password = password
          targetPane.state = 'connecting'
          targetPane.retrySeq = (targetPane.retrySeq ?? 0) + 1
        }
      } else {
        connectHost(action.host, action.split, password)
      }
    }
    if (action.kind === 'delete' && action.host) {
      hosts.value = await window.orbit.hosts.remove(action.host.id)
      if (selected.value === action.host.id) selected.value = undefined
      notify('主机配置已删除')
    }
    if (action.kind === 'trust' && action.trust) {
      await window.orbit.sessions.trust(action.trust.sessionId, true)
    }
    prompt.value = undefined
    advancePromptQueue()
  } catch (error) {
    notify(error instanceof Error ? error.message : '操作失败，请重试')
  } finally {
    promptBusy.value = false
    password = ''
  }
}

export function cancelAction(): void {
  if (prompt.value?.trust) {
    void window.orbit.sessions.trust(prompt.value.trust.sessionId, false).catch(() => {})
  }
  if (prompt.value?.kind === 'password' && prompt.value.paneToken) {
    const targetPane = tabs.value
      .flatMap((tab) => tab.panes)
      .find((pane) => pane.token === prompt.value?.paneToken)
    if (targetPane) {
      targetPane.password = undefined
      targetPane.state = 'error'
      targetPane.authCancelledSeq = (targetPane.authCancelledSeq ?? 0) + 1
    }
  }
  prompt.value = undefined
  advancePromptQueue()
}
