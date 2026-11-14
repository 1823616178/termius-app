export type AppShortcutAction = 'new-local-tab' | 'close-tab' | 'next-tab' | 'prev-tab' | 'focus-host-search'
export type TerminalShortcutAction = 'copy' | 'paste' | 'search'

export function matchAppShortcut(event: KeyboardEvent): AppShortcutAction | undefined {
  if (event.type !== 'keydown' || event.isComposing || event.altKey || event.metaKey) return undefined
  if (event.ctrlKey && event.shiftKey && event.code === 'KeyT') return 'new-local-tab'
  if (event.ctrlKey && event.shiftKey && event.code === 'KeyW') return 'close-tab'
  if (event.ctrlKey && event.code === 'Tab') return event.shiftKey ? 'prev-tab' : 'next-tab'
  const insideTerminal =
    typeof Element !== 'undefined' &&
    event.target instanceof Element &&
    Boolean(event.target.closest('.xterm'))
  if (event.ctrlKey && !event.shiftKey && event.code === 'KeyK' && !insideTerminal) return 'focus-host-search'
  return undefined
}

export function matchTerminalShortcut(event: KeyboardEvent): TerminalShortcutAction | undefined {
  if (event.type !== 'keydown' || event.isComposing || event.altKey || event.metaKey) return undefined
  if (event.ctrlKey && event.shiftKey && event.code === 'KeyC') return 'copy'
  if (event.ctrlKey && !event.shiftKey && event.code === 'Insert') return 'copy'
  if (event.ctrlKey && event.shiftKey && event.code === 'KeyV') return 'paste'
  if (!event.ctrlKey && event.shiftKey && event.code === 'Insert') return 'paste'
  if (event.ctrlKey && event.shiftKey && event.code === 'KeyF') return 'search'
  return undefined
}

export function shouldInterceptInTerminal(event: KeyboardEvent): boolean {
  const appAction = matchAppShortcut(event)
  return (
    appAction === 'new-local-tab' ||
    appAction === 'close-tab' ||
    appAction === 'next-tab' ||
    appAction === 'prev-tab'
  )
}
