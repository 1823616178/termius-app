import type { IBufferCell, IBufferLine, Terminal } from '@xterm/xterm'
import { describe, expect, it } from 'vitest'
import {
  createTerminalLinkIntegration,
  extractTerminalLinks,
  mapRangeFromStringOffsets,
  normalizeTerminalLinkUrl,
  textMayContainTerminalLink
} from '../../src/renderer/src/services/terminal-links'

interface MockCell {
  chars: string
  width: number
}

function createFakeTerminal(
  rowsData: Array<{ cells: MockCell[]; isWrapped?: boolean }>,
  cols: number,
  options: { hasSelection?: boolean } = {}
): Terminal {
  const lines: IBufferLine[] = rowsData.map((row) => ({
    length: cols,
    isWrapped: Boolean(row.isWrapped),
    getCell(index: number, cell?: IBufferCell): IBufferCell | undefined {
      const target = cell ?? ({} as IBufferCell)
      const data = row.cells[index] ?? { chars: '', width: 1 }
      ;(target as { getChars: () => string }).getChars = () => data.chars
      ;(target as { getWidth: () => number }).getWidth = () => data.width
      return target
    },
    translateToString(trimRight?: boolean): string {
      const raw = row.cells.map((c) => (c.width === 0 ? '' : c.chars || ' ')).join('')
      return trimRight ? raw.replace(/\s+$/, '') : raw
    }
  })) as unknown as IBufferLine[]

  return {
    rows: rowsData.length,
    cols,
    buffer: {
      active: {
        viewportY: 0,
        getLine: (index: number) => lines[index],
        getNullCell: () =>
          ({
            getChars: () => '',
            getWidth: () => 1
          }) as unknown as IBufferCell
      }
    },
    hasSelection: () => Boolean(options.hasSelection)
  } as unknown as Terminal
}

function asciiCells(text: string, cols: number): MockCell[] {
  const cells: MockCell[] = []
  for (const ch of text) {
    cells.push({ chars: ch, width: 1 })
  }
  while (cells.length < cols) {
    cells.push({ chars: '', width: 1 })
  }
  return cells
}

describe('terminal-links', () => {
  it('skips the link scan for ordinary terminal lines', () => {
    expect(textMayContainTerminalLink('user@host:~$ ls -la')).toBe(false)
    expect(textMayContainTerminalLink('total 12')).toBe(false)
    expect(textMayContainTerminalLink('see https://example.com')).toBe(true)
    expect(textMayContainTerminalLink('open localhost:3000')).toBe(true)
    expect(textMayContainTerminalLink('ping 10.0.0.8 ok')).toBe(true)
  })

  it('recognizes http/https, www, localhost:port and IPv4:port links cleanly', () => {
    const sample =
      'Open https://github.com/1823616178/termius-app, www.example.com/docs?q=1, localhost:5173/ui and 127.0.0.1:8080/health'
    expect(extractTerminalLinks(sample)).toEqual([
      {
        start: 5,
        end: 46,
        rawText: 'https://github.com/1823616178/termius-app',
        url: 'https://github.com/1823616178/termius-app'
      },
      {
        start: 48,
        end: 72,
        rawText: 'www.example.com/docs?q=1',
        url: 'https://www.example.com/docs?q=1'
      },
      {
        start: 74,
        end: 91,
        rawText: 'localhost:5173/ui',
        url: 'http://localhost:5173/ui'
      },
      {
        start: 96,
        end: 117,
        rawText: '127.0.0.1:8080/health',
        url: 'http://127.0.0.1:8080/health'
      }
    ])
  })

  it('trims Chinese/ASCII punctuation while preserving balanced parentheses and IPv6 brackets', () => {
    const sample = '请看（https://en.wikipedia.org/wiki/Electron_(software)），或 http://[::1]:5173/app。'
    expect(extractTerminalLinks(sample)).toEqual([
      {
        start: 3,
        end: 52,
        rawText: 'https://en.wikipedia.org/wiki/Electron_(software)',
        url: 'https://en.wikipedia.org/wiki/Electron_(software)'
      },
      {
        start: 56,
        end: 77,
        rawText: 'http://[::1]:5173/app',
        url: 'http://[::1]:5173/app'
      }
    ])
  })

  it('rejects filenames, versions, invalid ports/IPs, and partial prefix matches', () => {
    expect(
      extractTerminalLinks(
        'Check src/index.ts v0.1.0 foo.www.bar user@localhost:22 999.999.999.999:80 localhost:0'
      )
    ).toEqual([])
    expect(normalizeTerminalLinkUrl('javascript:alert(1)')).toBeNull()
  })

  it('maps wide CJK cells, emoji pairs, right-edge columns, and wrapped rows accurately', () => {
    const cols = 16
    // Row 0: "访"(2) "问"(2) "🚀"(2,len=2) "https://a."(10) => exactly 16 cols!
    const row0: MockCell[] = [
      { chars: '访', width: 2 },
      { chars: '', width: 0 },
      { chars: '问', width: 2 },
      { chars: '', width: 0 },
      { chars: '🚀', width: 2 },
      { chars: '', width: 0 },
      ...asciiCells('https://a.', 10)
    ]
    // Row 1 (wrapped): "cn/1"(4)
    const row1 = asciiCells('cn/1', cols)
    const fakeTerm = createFakeTerminal(
      [
        { cells: row0, isWrapped: false },
        { cells: row1, isWrapped: true }
      ],
      cols
    )

    const links = extractTerminalLinks('访问🚀https://a.cn/1')
    expect(links).toHaveLength(1)
    const link = links[0]!
    // String offset: "访问🚀" => length 4 (two CJK=2 + surrogate pair=2)
    expect(link.start).toBe(4)
    const range = mapRangeFromStringOffsets(fakeTerm, 0, link.start, link.rawText.length)
    expect(range).toEqual({
      start: { x: 7, y: 1 },
      end: { x: 4, y: 2 }
    })

    // Exact last-column test without spilling onto next row
    const edgeTerm = createFakeTerminal([{ cells: asciiCells('hi https://a.cn', 15), isWrapped: false }], 15)
    expect(mapRangeFromStringOffsets(edgeTerm, 0, 3, 12)).toEqual({
      start: { x: 4, y: 1 },
      end: { x: 15, y: 1 }
    })
  })

  it('provides pointerCursor/underline decorations, enforces OSC 8 safety, and ignores activation during text selection', () => {
    let selected = false
    const opened: string[] = []
    const fakeTerm = {
      ...createFakeTerminal([{ cells: asciiCells('visit https://orbit.dev now', 32), isWrapped: false }], 32),
      hasSelection: () => selected
    } as unknown as Terminal

    const { provider, linkHandler } = createTerminalLinkIntegration(fakeTerm, (url) => opened.push(url))
    expect(linkHandler.allowNonHttpProtocols).toBe(false)

    let capturedLinks: import('@xterm/xterm').ILink[] | undefined
    provider.provideLinks(1, (res) => {
      capturedLinks = res
    })
    expect(capturedLinks).toHaveLength(1)
    const link = capturedLinks![0]!
    expect(link.decorations).toEqual({ pointerCursor: true, underline: true })
    expect(link.range).toEqual({ start: { x: 7, y: 1 }, end: { x: 23, y: 1 } })

    const primaryClick = { button: 0 } as MouseEvent
    selected = true
    link.activate(primaryClick, link.text)
    expect(opened).toEqual([])

    selected = false
    link.activate({ button: 2 } as MouseEvent, link.text)
    expect(opened).toEqual([])

    link.activate(primaryClick, link.text)
    expect(opened).toEqual(['https://orbit.dev'])

    linkHandler.activate(primaryClick, 'https://docs.orbit.dev', link.range)
    expect(opened).toEqual(['https://orbit.dev', 'https://docs.orbit.dev'])
  })
})
