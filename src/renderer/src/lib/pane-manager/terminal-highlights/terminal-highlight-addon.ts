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

const MAX_WRAPPED_ROWS = 8
// A tool's output can start above the viewport; look this far up for its call line.
const MAX_BLOCK_LOOKBACK = 300
// Default, black, white, bright black, bright white: text a program did not color.
const NEUTRAL_PALETTE_INDEXES = new Set([0, 7, 8, 15])
const RED_PALETTE_INDEXES = new Set([1, 9])
// Claude Code's ANSI themes draw inline code in bright blue and the prompt echo on bright black.
const CODE_PALETTE_INDEX = 12
const ECHO_BG_PALETTE_INDEX = 8
// Diff lines in code blocks and `git diff` output are drawn in red or green.
const DIFF_HUES = new Map<number, ClaudeBlockCell['diffHue']>([
  [1, 'red'],
  [9, 'red'],
  [2, 'green'],
  [10, 'green']
])

type Paint = { line: number; x: number; width: number; fg?: string; bg?: string }
type Entry = Paint & { marker: IMarker; decoration: IDecoration }

/** `foreground`: the theme's foreground as 0xRRGGBB. */
function isPlainCell(cell: IBufferCell, foreground: number): boolean {
  if (cell.isInverse()) {
    return false
  }
  if (cell.isFgDefault()) {
    return true
  }
  if (cell.isFgPalette()) {
    return NEUTRAL_PALETTE_INDEXES.has(cell.getFgColor())
  }
  // Truecolor themes draw body text in the theme's foreground (Claude Code's synced themes, whose
  // foreground can be tinted) or a gray RGB; other RGB is the program's own emphasis.
  const rgb = cell.getFgColor()
  const channels = [(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff]
  return rgb === foreground || Math.max(...channels) - Math.min(...channels) <= 24
}

function bulletOf(cell: IBufferCell, foreground: number): ClaudeBullet {
  // Claude Code dims the bullet of a running call and of collapsed summaries.
  if (cell.isDim()) {
    return 'tool'
  }
  if (isPlainCell(cell, foreground)) {
    return 'reply'
  }
  if (cell.isFgPalette()) {
    return RED_PALETTE_INDEXES.has(cell.getFgColor()) ? 'failed' : 'tool'
  }
  // Truecolor themes: Claude Code's error red is rgb(255,107,128).
  const rgb = cell.getFgColor()
  return ((rgb >> 16) & 0xff) > 1.5 * Math.max((rgb >> 8) & 0xff, rgb & 0xff) ? 'failed' : 'tool'
}

/**
 * Backgrounds stay a step below the selection: a hue tint behind text of the same hue, or a
 * neutral surface, so marked text never reads as selected.
 */
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
    case 'tag':
      return { bg: mixHex(hue, palette.background, palette.dark ? 0.16 : 0.12), fg: hue }
    case 'band':
    case 'code':
      return { bg: mixHex(palette.foreground, palette.background, palette.dark ? 0.08 : 0.06) }
    case 'quoteBar':
      return { bg: mixHex(hue, palette.background, palette.dark ? 0.4 : 0.3), fg: hue }
    case 'diff':
      return { bg: mixHex(hue, palette.background, palette.dark ? 0.16 : 0.14) }
    default:
      return { fg: hue }
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
  private pending = false

  activate(terminal: Terminal): void {
    this.terminal = terminal
    this.listeners = [
      terminal.onWriteParsed(() => this.refresh()),
      terminal.onScroll(() => this.refresh()),
      terminal.onResize(() => this.refresh()),
      terminal.buffer.onBufferChange(() => {
        this.clear()
        this.refresh()
      })
    ]
  }

  setConfig(config: TerminalHighlightConfig): void {
    this.rules = compileTerminalHighlightRules(config.rules)
    this.claudeBlocks = config.claudeBlocks
    this.clear()
    this.refresh()
  }

  /**
   * Rescans once the current task ends, before the next frame paints: full-screen apps (Claude
   * Code, Codex) scroll by rewriting rows in place, so highlights left for a later frame would sit
   * on the wrong text. Also used after a theme change.
   */
  refresh(): void {
    if (this.pending || !this.terminal || this.idle) {
      return
    }
    this.pending = true
    queueMicrotask(() => {
      this.pending = false
      this.scan()
    })
  }

  dispose(): void {
    this.clear()
    this.listeners.forEach((listener) => listener.dispose())
    this.listeners = []
    this.terminal = null
  }

  private get idle(): boolean {
    return this.rules.length === 0 && !this.claudeBlocks
  }

  private clear(): void {
    this.entries.forEach((entry) => entry.marker.dispose())
    this.entries = []
  }

  private readRow(y: number, cell: IBufferCell, foreground: number): ClaudeBlockRow | null {
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
      const ownBg = !cell.isBgDefault()
      const echoBg = cell.isBgPalette() && cell.getBgColor() === ECHO_BG_PALETTE_INDEX
      cells.push({
        chars: cell.getChars(),
        width: cell.getWidth(),
        // Text on a background the program painted (Claude Code's mouse selection, diff lines) keeps its colors.
        plain: isPlainCell(cell, foreground) && (!ownBg || echoBg),
        bold: cell.isBold() !== 0,
        dim: cell.isDim() !== 0,
        ownBg,
        echoBg,
        code: cell.isFgPalette() && cell.getFgColor() === CODE_PALETTE_INDEX && !cell.isDim(),
        diffHue: cell.isFgPalette() && !ownBg ? DIFF_HUES.get(cell.getFgColor()) : undefined
      })
    }
    const row: ClaudeBlockRow = { line: y, cells, wrapped: line.isWrapped }
    if (cells[0]?.chars === '●' && line.getCell(0, cell)) {
      row.bullet = bulletOf(cell, foreground)
    }
    return row
  }

  /** The bullet line of the Claude Code block (tool call or reply) that reaches `from`; `from` when outside one. */
  private blockStart(from: number): number {
    const buffer = this.terminal?.buffer.active
    for (let y = from - 1; buffer && y >= 0 && y >= from - MAX_BLOCK_LOOKBACK; y--) {
      const line = buffer.getLine(y)
      const text = line?.translateToString(true) ?? ''
      if (text.startsWith('●')) {
        return y
      }
      // Replies span blank lines; any other unindented line ends a block.
      if (!line || !(line.isWrapped || text.startsWith(' ') || text === '')) {
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
    const foreground = Number.parseInt(palette.foreground.slice(1), 16)
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
        const row = this.readRow(y, cell, foreground)
        if (row) {
          rows.push(row)
        }
        y++
      } while (y < buffer.length && rows.length < MAX_WRAPPED_ROWS && buffer.getLine(y)?.isWrapped)
      if (this.rules.length > 0 && rows.length > 0 && rows[0].line >= matchFrom) {
        for (const range of findHighlightRanges(rows, this.rules)) {
          const hue = palette.hues[range.hue]
          const fg = range.subtle ? mixHex(hue, palette.foreground, 0.5) : hue
          add({ line: range.line, x: range.x, width: range.width, fg })
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

/**
 * Applies highlight rules and Claude Code block marks to a terminal; nothing to apply removes the
 * addon. Re-applying the same config (appearance updates) rescans so colors follow a new theme.
 */
export function setTerminalHighlights(terminal: Terminal, config: TerminalHighlightConfig): void {
  const current = addons.get(terminal)
  if (config.rules.length === 0 && !config.claudeBlocks) {
    current?.addon.dispose()
    addons.delete(terminal)
    return
  }
  const signature = JSON.stringify(config)
  if (current?.signature === signature) {
    current.addon.refresh()
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
