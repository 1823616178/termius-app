import type {
  IBufferCell,
  IBufferLine,
  IBufferRange,
  ILink,
  ILinkHandler,
  ILinkProvider,
  Terminal
} from '@xterm/xterm'
import { locale } from './i18n'

export interface DetectedTerminalLink {
  start: number
  end: number
  rawText: string
  url: string
}

const MAX_WRAPPED_WINDOW_CHARS = 2048

const URL_DISALLOWED_TAIL = '.,;:!?\'"'
const BOUNDARY_BEFORE_BARE_LINK = /[A-Za-z0-9._/@:-]/
const LINK_CANDIDATE_PATTERN =
  /https?:\/\/[^\s\u0000-\u001f\u3000，。、；：？！（）【】《》「」『』“”’‘…—·<>"'`^\\|]+|www\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+(?::\d{1,5})?(?:[/?#][^\s\u0000-\u001f\u3000，。、；：？！（）【】《》「」『』“”’‘…—·<>"'`^\\|]*)?|(?:localhost|\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}(?:[/?#][^\s\u0000-\u001f\u3000，。、；：？！（）【】《》「」『』“”’‘…—·<>"'`^\\|]*)?/gi

function countChar(text: string, target: string): number {
  let count = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === target) count++
  }
  return count
}

function trimCandidate(raw: string): string {
  let value = raw
  while (value.length > 0) {
    const last = value[value.length - 1]!
    if (URL_DISALLOWED_TAIL.includes(last)) {
      value = value.slice(0, -1)
      continue
    }
    if (last === ')' && countChar(value, ')') > countChar(value, '(')) {
      value = value.slice(0, -1)
      continue
    }
    if (last === ']' && countChar(value, ']') > countChar(value, '[')) {
      value = value.slice(0, -1)
      continue
    }
    if (last === '}' && countChar(value, '}') > countChar(value, '{')) {
      value = value.slice(0, -1)
      continue
    }
    break
  }
  return value
}

function isValidIpv4(host: string): boolean {
  const parts = host.split('.')
  if (parts.length !== 4) return false
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false
    const num = Number(part)
    return num >= 0 && num <= 255
  })
}

export function normalizeTerminalLinkUrl(rawCandidate: string): string | null {
  const trimmed = rawCandidate.trim()
  if (!trimmed) return null

  const hasExplicitScheme = /^https?:\/\//i.test(trimmed)
  if (!hasExplicitScheme) {
    if (/^www\./i.test(trimmed)) {
      const bareHost = trimmed.split(/[/?#:]/)[0] ?? ''
      if (!bareHost || bareHost.split('.').length < 3) return null
    } else {
      const authority = trimmed.split(/[/?#]/)[0] ?? ''
      const colonIdx = authority.lastIndexOf(':')
      if (colonIdx <= 0) return null
      const host = authority.slice(0, colonIdx)
      const portNum = Number(authority.slice(colonIdx + 1))
      if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) return null
      if (host.toLowerCase() !== 'localhost' && !isValidIpv4(host)) return null
    }
  }

  const withScheme = hasExplicitScheme
    ? trimmed
    : /^www\./i.test(trimmed)
      ? `https://${trimmed}`
      : `http://${trimmed}`

  try {
    const parsed = new URL(withScheme)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    if (!parsed.hostname) return null
    return withScheme
  } catch {
    return null
  }
}

export function extractTerminalLinks(text: string): DetectedTerminalLink[] {
  if (!text) return []
  const matches: DetectedTerminalLink[] = []
  const pattern = new RegExp(LINK_CANDIDATE_PATTERN.source, LINK_CANDIDATE_PATTERN.flags)
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    const rawMatched = match[0]
    const matchIndex = match.index
    const isExplicit = /^https?:\/\//i.test(rawMatched)

    if (!isExplicit && matchIndex > 0 && BOUNDARY_BEFORE_BARE_LINK.test(text[matchIndex - 1]!)) {
      continue
    }

    const cleanRaw = trimCandidate(rawMatched)
    if (!cleanRaw) continue
    const normalized = normalizeTerminalLinkUrl(cleanRaw)
    if (!normalized) continue

    matches.push({
      start: matchIndex,
      end: matchIndex + cleanRaw.length,
      rawText: cleanRaw,
      url: normalized
    })
  }

  return matches
}

function collectWrappedLineWindow(
  bufferLineNumber: number,
  terminal: Terminal
): { text: string; startLine0: number } | null {
  const buffer = terminal.buffer.active
  const targetIdx = bufferLineNumber - 1
  const currentLine = buffer.getLine(targetIdx)
  if (!currentLine) return null

  let startIdx = targetIdx
  let endIdx = targetIdx
  const chunks: string[] = []
  let totalChars = 0

  let line: IBufferLine | undefined = currentLine
  if (line.isWrapped) {
    while (startIdx > 0 && totalChars < MAX_WRAPPED_WINDOW_CHARS) {
      const prev = buffer.getLine(startIdx - 1)
      if (!prev) break
      const prevText = prev.translateToString(true)
      startIdx--
      chunks.push(prevText)
      totalChars += prevText.length
      if (!prev.isWrapped) break
    }
    chunks.reverse()
  }

  const currentText = currentLine.translateToString(true)
  chunks.push(currentText)

  totalChars = 0
  while (totalChars < MAX_WRAPPED_WINDOW_CHARS) {
    const next = buffer.getLine(endIdx + 1)
    if (!next || !next.isWrapped) break
    const nextText = next.translateToString(true)
    endIdx++
    chunks.push(nextText)
    totalChars += nextText.length
  }

  return {
    text: chunks.join(''),
    startLine0: startIdx
  }
}

export function mapRangeFromStringOffsets(
  terminal: Terminal,
  startLine0: number,
  startOffset: number,
  length: number
): IBufferRange | null {
  if (length <= 0) return null
  const endOffset = startOffset + length
  const buffer = terminal.buffer.active
  const cell: IBufferCell = buffer.getNullCell()
  let consumed = 0
  let startPos: { x: number; y: number } | null = null

  for (let lineIdx = startLine0; ; lineIdx++) {
    const line = buffer.getLine(lineIdx)
    if (!line) return null

    for (let col = 0; col < line.length; col++) {
      line.getCell(col, cell)
      if (!cell.getWidth()) continue

      const chars = cell.getChars()
      if (col === line.length - 1 && chars === '') {
        const nextLine = buffer.getLine(lineIdx + 1)
        if (nextLine?.isWrapped) {
          nextLine.getCell(0, cell)
          if (cell.getWidth() === 2) continue
        }
      }

      const len = chars.length || 1
      if (!startPos && consumed + len > startOffset) {
        startPos = { x: col + 1, y: lineIdx + 1 }
      }
      if (startPos && consumed + len >= endOffset) {
        return {
          start: startPos,
          end: { x: col + 1, y: lineIdx + 1 }
        }
      }
      consumed += len
    }
  }
}

export interface TerminalLinkHoverController {
  show: (url: string, range: IBufferRange) => void
  scheduleHide: () => void
  hide: () => void
  dispose: () => void
}

export function createTerminalLinkHoverController(
  terminal: Terminal,
  onOpen: (url: string) => void
): TerminalLinkHoverController {
  let hoverEl: HTMLButtonElement | null = null
  let urlSpan: HTMLSpanElement | null = null
  let activeUrl = ''
  let pointerInsideTip = false
  let hideTimer: ReturnType<typeof setTimeout> | undefined

  const clearHideTimer = (): void => {
    if (hideTimer !== undefined) {
      clearTimeout(hideTimer)
      hideTimer = undefined
    }
  }

  const hide = (): void => {
    clearHideTimer()
    pointerInsideTip = false
    activeUrl = ''
    if (hoverEl) hoverEl.hidden = true
  }

  const scheduleHide = (): void => {
    clearHideTimer()
    hideTimer = setTimeout(() => {
      hideTimer = undefined
      if (!pointerInsideTip) {
        hide()
      }
    }, 90)
  }

  const ensureElement = (): HTMLButtonElement | null => {
    if (typeof document === 'undefined') return null
    const root = terminal.element
    if (!root) return null
    if (hoverEl) return hoverEl

    const btn = document.createElement('button')
    btn.type = 'button'
    // xterm-hover instructs xterm Linkifier2 to keep hover underline and pointer cursor active
    // while the pointer moves over this clickable tooltip.
    btn.className = 'xterm-hover xterm-link-preview'
    btn.hidden = true

    const urlNode = document.createElement('span')
    urlNode.className = 'xterm-link-preview-url'
    const hintNode = document.createElement('span')
    hintNode.className = 'xterm-link-preview-hint'
    hintNode.textContent = locale.value === 'en-US' ? 'Click to open ↗' : '可点击打开 ↗'

    btn.append(urlNode, hintNode)
    btn.addEventListener('mouseenter', () => {
      pointerInsideTip = true
      clearHideTimer()
    })
    btn.addEventListener('mouseleave', () => {
      pointerInsideTip = false
      scheduleHide()
    })
    btn.addEventListener('pointerdown', (event) => event.stopPropagation())
    btn.addEventListener('mousedown', (event) => event.stopPropagation())
    btn.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (activeUrl) onOpen(activeUrl)
    })

    root.appendChild(btn)
    hoverEl = btn
    urlSpan = urlNode
    return btn
  }

  const show = (url: string, range: IBufferRange): void => {
    clearHideTimer()
    const root = terminal.element
    const btn = ensureElement()
    if (!root || !btn || !urlSpan) return

    activeUrl = url
    urlSpan.textContent = url
    const hintEl = btn.querySelector('.xterm-link-preview-hint')
    if (hintEl) hintEl.textContent = locale.value === 'en-US' ? 'Click to open ↗' : '可点击打开 ↗'
    btn.title = url
    btn.setAttribute('aria-label', locale.value === 'en-US' ? `Open link: ${url}` : `打开链接：${url}`)
    btn.hidden = false

    const rootRect = root.getBoundingClientRect()
    const rowsEl = root.querySelector('.xterm-screen')
    const rowsRect = rowsEl?.getBoundingClientRect()
    const rowCount = Math.max(1, terminal.rows)
    const colCount = Math.max(1, terminal.cols)

    const cellHeight = rowsRect && rowsRect.height > 0 ? rowsRect.height / rowCount : 18
    const cellWidth = rowsRect && rowsRect.width > 0 ? rowsRect.width / colCount : 8
    const originLeft = rowsRect ? rowsRect.left - rootRect.left : 12
    const originTop = rowsRect ? rowsRect.top - rootRect.top : 8

    const visualRow = range.start.y - 1 - terminal.buffer.active.viewportY
    const rowTop = originTop + visualRow * cellHeight
    const anchorLeft = originLeft + (range.start.x - 1) * cellWidth

    const tipWidth = btn.offsetWidth
    const tipHeight = btn.offsetHeight || 28
    const maxLeft = Math.max(8, root.clientWidth - tipWidth - 8)
    const clampedLeft = Math.min(Math.max(8, anchorLeft), maxLeft)
    const top =
      rowTop - tipHeight >= 4
        ? rowTop - tipHeight
        : Math.min(Math.max(4, rowTop + cellHeight), Math.max(4, root.clientHeight - tipHeight - 8))

    btn.style.left = `${Math.round(clampedLeft)}px`
    btn.style.top = `${Math.round(top)}px`
  }

  const dispose = (): void => {
    hide()
    hoverEl?.remove()
    hoverEl = null
    urlSpan = null
  }

  return { show, scheduleHide, hide, dispose }
}

export function createTerminalLinkIntegration(
  terminal: Terminal,
  onOpen: (url: string) => void
): {
  provider: ILinkProvider
  linkHandler: ILinkHandler
  hideHover: () => void
  dispose: () => void
} {
  const hoverUi = createTerminalLinkHoverController(terminal, onOpen)

  const activateSafely = (event: MouseEvent, targetUrl: string): void => {
    if (event.button !== 0 || terminal.hasSelection()) return
    onOpen(targetUrl)
  }

  const provider: ILinkProvider = {
    provideLinks(bufferLineNumber, callback) {
      const win = collectWrappedLineWindow(bufferLineNumber, terminal)
      if (!win) {
        callback(undefined)
        return
      }
      const detected = extractTerminalLinks(win.text)
      if (detected.length === 0) {
        callback(undefined)
        return
      }

      const links: ILink[] = []
      for (const item of detected) {
        const range = mapRangeFromStringOffsets(terminal, win.startLine0, item.start, item.rawText.length)
        if (!range) {
          continue
        }
        links.push({
          range,
          text: item.rawText,
          decorations: {
            pointerCursor: true,
            underline: true
          },
          activate: (event) => activateSafely(event, item.url),
          hover: () => hoverUi.show(item.url, range),
          leave: () => hoverUi.scheduleHide()
        })
      }

      callback(links.length > 0 ? links : undefined)
    }
  }

  const linkHandler: ILinkHandler = {
    allowNonHttpProtocols: false,
    activate: (event, text) => activateSafely(event, text),
    hover: (_event, text, range) => hoverUi.show(text, range),
    leave: () => hoverUi.scheduleHide()
  }

  return {
    provider,
    linkHandler,
    hideHover: hoverUi.hide,
    dispose: hoverUi.dispose
  }
}
