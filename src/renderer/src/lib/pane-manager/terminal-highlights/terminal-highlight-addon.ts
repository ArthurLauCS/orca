import type {
  IBufferCell,
  IDecoration,
  IDisposable,
  IMarker,
  ITerminalAddon,
  Terminal
} from '@xterm/xterm'
import type { TerminalHighlightConfig } from '../../../../../shared/terminal/appearance/terminal-highlight-rules'
import {
  compileTerminalHighlightRules,
  findHighlightRanges,
  type CompiledHighlightRule
} from './terminal-highlight-matcher'
import {
  findClaudeBlocks,
  type ClaudeBlockCell,
  type ClaudeBlockPaint,
  type ClaudeBlockRow,
  type ClaudeBullet
} from './terminal-claude-blocks'
import {
  mixHex,
  resolveHighlightPalette,
  type HighlightPalette
} from './terminal-highlight-palette'

// Coalesces scans while output streams; a scan covers only the viewport.
const SCAN_DELAY_MS = 60
const MAX_WRAPPED_ROWS = 8
// A tool's output can start above the viewport; look this far up for its call line.
const MAX_BLOCK_LOOKBACK = 300
// Default, black, white, bright black, bright white: text a program did not color.
const NEUTRAL_PALETTE_INDEXES = new Set([0, 7, 8, 15])
const RED_PALETTE_INDEXES = new Set([1, 9])

type Paint = { line: number; x: number; width: number; fg?: string; bg?: string }
type Entry = Paint & { marker: IMarker; decoration: IDecoration }

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

function bulletOf(cell: IBufferCell): ClaudeBullet {
  // Claude Code dims the bullet of a running call and of collapsed summaries.
  if (cell.isDim()) {
    return 'tool'
  }
  if (isPlainCell(cell)) {
    return 'reply'
  }
  if (cell.isFgPalette()) {
    return RED_PALETTE_INDEXES.has(cell.getFgColor()) ? 'failed' : 'tool'
  }
  // Truecolor themes: Claude Code's error red is rgb(255,107,128).
  const rgb = cell.getFgColor()
  return ((rgb >> 16) & 0xff) > 1.5 * Math.max((rgb >> 8) & 0xff, rgb & 0xff) ? 'failed' : 'tool'
}

function blockColors(
  paint: ClaudeBlockPaint,
  hue: string,
  palette: HighlightPalette
): Pick<Paint, 'fg' | 'bg'> {
  switch (paint) {
    case 'header':
      return { bg: mixHex(hue, palette.background, palette.dark ? 0.22 : 0.16) }
    case 'body':
      return { bg: mixHex(hue, palette.background, palette.dark ? 0.08 : 0.06) }
    default:
      return { bg: hue, fg: palette.background }
  }
}

const paintKey = (paint: Paint): string =>
  `${paint.line}:${paint.x}:${paint.width}:${paint.fg ?? ''}:${paint.bg ?? ''}`

/** Recolors plain text that matches highlight rules and marks Claude Code tool blocks, using xterm decorations (the PTY data is untouched). */
export class TerminalHighlightAddon implements ITerminalAddon {
  private terminal: Terminal | null = null
  private rules: CompiledHighlightRule[] = []
  private claudeBlocks: TerminalHighlightConfig['claudeBlocks'] = null
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

  setConfig(config: TerminalHighlightConfig): void {
    this.rules = compileTerminalHighlightRules(config.rules)
    this.claudeBlocks = config.claudeBlocks
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

  private get idle(): boolean {
    return this.rules.length === 0 && !this.claudeBlocks
  }

  private schedule(): void {
    if (this.timer || !this.terminal || this.idle) {
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

  private readRow(y: number, cell: IBufferCell): ClaudeBlockRow | null {
    const terminal = this.terminal
    const line = terminal?.buffer.active.getLine(y)
    if (!terminal || !line) {
      return null
    }
    const cells: ClaudeBlockCell[] = []
    for (let x = 0; x < terminal.cols; x++) {
      if (!line.getCell(x, cell)) {
        break
      }
      cells.push({
        chars: cell.getChars(),
        width: cell.getWidth(),
        plain: isPlainCell(cell),
        bold: cell.isBold() !== 0,
        dim: cell.isDim() !== 0,
        ownBg: !cell.isBgDefault()
      })
    }
    const row: ClaudeBlockRow = { line: y, cells, wrapped: line.isWrapped }
    if (cells[0]?.chars === '●' && line.getCell(0, cell)) {
      row.bullet = bulletOf(cell)
    }
    return row
  }

  /** The call line of the Claude Code block whose output reaches `from`; `from` when outside one. */
  private blockStart(from: number): number {
    const buffer = this.terminal?.buffer.active
    for (let y = from - 1; buffer && y >= 0 && y >= from - MAX_BLOCK_LOOKBACK; y--) {
      const line = buffer.getLine(y)
      const text = line?.translateToString(true) ?? ''
      if (text.startsWith('●')) {
        return y
      }
      if (!line || text.trim() === '' || !(line.isWrapped || text.startsWith(' '))) {
        return from
      }
    }
    return from
  }

  private scan(): void {
    const terminal = this.terminal
    if (!terminal || this.idle) {
      return
    }
    const buffer = terminal.buffer.active
    const palette = resolveHighlightPalette(terminal.options.theme)
    const cell = buffer.getNullCell()
    const top = buffer.viewportY
    const bottom = Math.min(buffer.length - 1, top + terminal.rows - 1)
    let y = top
    // Start at the logical line the top row belongs to, so a wrapped match keeps its head.
    for (let back = 0; back < MAX_WRAPPED_ROWS && y > 0 && buffer.getLine(y)?.isWrapped; back++) {
      y--
    }
    const matchFrom = y
    if (this.claudeBlocks) {
      y = this.blockStart(y)
    }

    const desired = new Map<string, Paint>()
    const add = (paint: Paint): void => {
      desired.set(paintKey(paint), paint)
    }
    const blockRows: ClaudeBlockRow[] = []
    while (y <= bottom) {
      const rows: ClaudeBlockRow[] = []
      do {
        const row = this.readRow(y, cell)
        if (row) {
          rows.push(row)
        }
        y++
      } while (y < buffer.length && rows.length < MAX_WRAPPED_ROWS && buffer.getLine(y)?.isWrapped)
      if (this.rules.length > 0 && rows.length > 0 && rows[0].line >= matchFrom) {
        for (const range of findHighlightRanges(rows, this.rules)) {
          add({ line: range.line, x: range.x, width: range.width, fg: palette.hues[range.hue] })
        }
      }
      if (this.claudeBlocks) {
        blockRows.push(...rows)
      }
    }
    if (this.claudeBlocks) {
      for (const range of findClaudeBlocks(blockRows, this.claudeBlocks, top)) {
        add({
          line: range.line,
          x: range.x,
          width: range.width,
          ...blockColors(range.paint, palette.hues[range.hue], palette)
        })
      }
    }

    // Keep decorations that still match where their marker is now; drop the rest (incl. off-screen).
    const kept = new Set<string>()
    this.entries = this.entries.filter((entry) => {
      const key = entry.marker.isDisposed ? null : paintKey({ ...entry, line: entry.marker.line })
      if (key && desired.has(key) && !kept.has(key)) {
        kept.add(key)
        return true
      }
      entry.marker.dispose()
      return false
    })
    const cursorLine = buffer.baseY + buffer.cursorY
    for (const [key, paint] of desired) {
      if (kept.has(key)) {
        continue
      }
      const marker = terminal.registerMarker(paint.line - cursorLine)
      if (!marker) {
        continue
      }
      const decoration = terminal.registerDecoration({
        marker,
        x: paint.x,
        width: paint.width,
        foregroundColor: paint.fg,
        backgroundColor: paint.bg,
        layer: 'bottom'
      })
      if (!decoration) {
        marker.dispose()
        continue
      }
      this.entries.push({ ...paint, marker, decoration })
    }
  }
}

const addons = new WeakMap<Terminal, { addon: TerminalHighlightAddon; signature: string }>()

/** Applies highlight rules and Claude Code block marks to a terminal; nothing to apply removes the addon. */
export function setTerminalHighlights(terminal: Terminal, config: TerminalHighlightConfig): void {
  const current = addons.get(terminal)
  if (config.rules.length === 0 && !config.claudeBlocks) {
    current?.addon.dispose()
    addons.delete(terminal)
    return
  }
  const signature = JSON.stringify(config)
  if (current?.signature === signature) {
    return
  }
  let addon = current?.addon
  if (!addon) {
    addon = new TerminalHighlightAddon()
    terminal.loadAddon(addon)
  }
  addons.set(terminal, { addon, signature })
  addon.setConfig(config)
}
