import type {
  IBufferCell,
  IDecoration,
  IDisposable,
  IMarker,
  ITerminalAddon,
  Terminal
} from '@xterm/xterm'
import type { TerminalHighlightRule } from '../../../../../shared/terminal/appearance/terminal-highlight-rules'
import {
  compileTerminalHighlightRules,
  findHighlightRanges,
  type CompiledHighlightRule,
  type HighlightCell,
  type HighlightRange,
  type HighlightRow
} from './terminal-highlight-matcher'
import { resolveHighlightPalette } from './terminal-highlight-palette'

// Coalesces scans while output streams; a scan covers only the viewport.
const SCAN_DELAY_MS = 60
const MAX_WRAPPED_ROWS = 8
// Default, black, white, bright black, bright white: text a program did not color.
const NEUTRAL_PALETTE_INDEXES = new Set([0, 7, 8, 15])

type Entry = HighlightRange & { marker: IMarker; decoration: IDecoration }

function isPlainCell(cell: IBufferCell): boolean {
  if (cell.isInverse()) {
    return false
  }
  if (cell.isFgDefault()) {
    return true
  }
  if (cell.isFgPalette()) {
    return NEUTRAL_PALETTE_INDEXES.has(cell.getFgColor())
  }
  // Truecolor themes draw body text in gray RGB; colored RGB is the program's own emphasis.
  const rgb = cell.getFgColor()
  const channels = [(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff]
  return Math.max(...channels) - Math.min(...channels) <= 24
}

const rangeKey = (range: HighlightRange, color: string): string =>
  `${range.line}:${range.x}:${range.width}:${color}`

/** Recolors plain text that matches highlight rules, using xterm decorations (the PTY data is untouched). */
export class TerminalHighlightAddon implements ITerminalAddon {
  private terminal: Terminal | null = null
  private rules: CompiledHighlightRule[] = []
  private entries: Entry[] = []
  private listeners: IDisposable[] = []
  private timer: ReturnType<typeof setTimeout> | null = null

  activate(terminal: Terminal): void {
    this.terminal = terminal
    this.listeners = [
      terminal.onRender(() => this.schedule()),
      terminal.onScroll(() => this.schedule()),
      terminal.buffer.onBufferChange(() => {
        this.clear()
        this.schedule()
      })
    ]
  }

  setRules(rules: readonly TerminalHighlightRule[]): void {
    this.rules = compileTerminalHighlightRules(rules)
    this.clear()
    this.schedule()
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.clear()
    this.listeners.forEach((listener) => listener.dispose())
    this.listeners = []
    this.terminal = null
  }

  private schedule(): void {
    if (this.timer || !this.terminal || this.rules.length === 0) {
      return
    }
    this.timer = setTimeout(() => {
      this.timer = null
      this.scan()
    }, SCAN_DELAY_MS)
  }

  private clear(): void {
    this.entries.forEach((entry) => entry.marker.dispose())
    this.entries = []
  }

  private readRow(y: number, cell: IBufferCell): HighlightRow | null {
    const terminal = this.terminal
    const line = terminal?.buffer.active.getLine(y)
    if (!terminal || !line) {
      return null
    }
    const cells: HighlightCell[] = []
    for (let x = 0; x < terminal.cols; x++) {
      if (!line.getCell(x, cell)) {
        break
      }
      cells.push({ chars: cell.getChars(), width: cell.getWidth(), plain: isPlainCell(cell) })
    }
    return { line: y, cells }
  }

  private scan(): void {
    const terminal = this.terminal
    if (!terminal || this.rules.length === 0) {
      return
    }
    const buffer = terminal.buffer.active
    const palette = resolveHighlightPalette(terminal.options.theme)
    const cell = buffer.getNullCell()
    const bottom = Math.min(buffer.length - 1, buffer.viewportY + terminal.rows - 1)
    let y = buffer.viewportY
    // Start at the logical line the top row belongs to, so a wrapped match keeps its head.
    for (let back = 0; back < MAX_WRAPPED_ROWS && y > 0 && buffer.getLine(y)?.isWrapped; back++) {
      y--
    }

    const desired = new Map<string, HighlightRange>()
    while (y <= bottom) {
      const rows: HighlightRow[] = []
      do {
        const row = this.readRow(y, cell)
        if (row) {
          rows.push(row)
        }
        y++
      } while (y < buffer.length && rows.length < MAX_WRAPPED_ROWS && buffer.getLine(y)?.isWrapped)
      for (const range of findHighlightRanges(rows, this.rules)) {
        desired.set(rangeKey(range, palette[range.hue]), range)
      }
    }

    // Keep decorations that still match where their marker is now; drop the rest (incl. off-screen).
    const kept = new Set<string>()
    this.entries = this.entries.filter((entry) => {
      const key = entry.marker.isDisposed
        ? null
        : rangeKey({ ...entry, line: entry.marker.line }, palette[entry.hue])
      if (key && desired.has(key) && !kept.has(key)) {
        kept.add(key)
        return true
      }
      entry.marker.dispose()
      return false
    })
    const cursorLine = buffer.baseY + buffer.cursorY
    for (const [key, range] of desired) {
      if (kept.has(key)) {
        continue
      }
      const marker = terminal.registerMarker(range.line - cursorLine)
      if (!marker) {
        continue
      }
      const decoration = terminal.registerDecoration({
        marker,
        x: range.x,
        width: range.width,
        foregroundColor: palette[range.hue],
        layer: 'bottom'
      })
      if (!decoration) {
        marker.dispose()
        continue
      }
      this.entries.push({ ...range, marker, decoration })
    }
  }
}

const addons = new WeakMap<Terminal, { addon: TerminalHighlightAddon; signature: string }>()

/** Applies highlight rules to a terminal; an empty list removes highlighting. */
export function setTerminalHighlights(
  terminal: Terminal,
  rules: readonly TerminalHighlightRule[]
): void {
  const current = addons.get(terminal)
  if (rules.length === 0) {
    current?.addon.dispose()
    addons.delete(terminal)
    return
  }
  const signature = JSON.stringify(rules)
  if (current?.signature === signature) {
    return
  }
  let addon = current?.addon
  if (!addon) {
    addon = new TerminalHighlightAddon()
    terminal.loadAddon(addon)
  }
  addons.set(terminal, { addon, signature })
  addon.setRules(rules)
}
