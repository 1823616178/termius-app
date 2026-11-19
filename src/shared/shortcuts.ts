export type AppShortcutAction = 'new-local-tab' | 'close-tab' | 'next-tab' | 'prev-tab' | 'focus-host-search'
export type TerminalShortcutAction = 'copy' | 'paste' | 'search'

export function isInsideRdpCapture(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false
  return Boolean(target.closest('iron-remote-desktop, [data-rdp-capture="true"]'))
}

export function matchAppShortcut(event: KeyboardEvent): AppShortcutAction | undefined {
  if (event.type !== 'keydown' || !event.ctrlKey || event.isComposing || event.altKey || event.metaKey)
    return undefined
  if (isInsideRdpCapture(event.target)) return undefined
  if (event.shiftKey && event.code === 'KeyT') return 'new-local-tab'
  if (event.shiftKey && event.code === 'KeyW') return 'close-tab'
  if (event.code === 'Tab') return event.shiftKey ? 'prev-tab' : 'next-tab'
  if (!event.shiftKey && event.code === 'KeyK') {
    const insideTerminal =
      typeof Element !== 'undefined' && event.target instanceof Element && event.target.closest('.xterm')
    if (!insideTerminal) return 'focus-host-search'
  }
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
