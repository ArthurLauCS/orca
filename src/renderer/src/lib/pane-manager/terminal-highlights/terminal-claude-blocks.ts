import type { TerminalHighlightHue } from '../../../../../shared/terminal/appearance/terminal-highlight-rules'
import type { HighlightCell } from './terminal-highlight-matcher'

/** What Claude Code's bullet in column 0 marks: its prose, a tool call, or a failed tool call. */
export type ClaudeBullet = 'reply' | 'tool' | 'failed'

export type ClaudeBlockCell = HighlightCell & {
  bold: boolean
  dim: boolean
  /** The program painted this background (diff lines, the prompt echo); row tints leave it. */
  ownBg: boolean
  /** Drawn in Claude Code's inline-code color; replies give these runs a soft background. */
  code: boolean
}

export type ClaudeBlockRow = {
  line: number
  cells: ClaudeBlockCell[]
  bullet?: ClaudeBullet
  wrapped?: boolean
}

export type ClaudeBlockPaint = 'header' | 'body' | 'tag' | 'bar' | 'prompt' | 'code'

export type ClaudeBlockRange = {
  line: number
  x: number
  width: number
  hue: TerminalHighlightHue
  paint: ClaudeBlockPaint
}

// Tool names, plus the verbs of collapsed summaries ("Reading 3 files", "Ran 2 shell commands"). Red marks failures.
const TOOLS_BY_HUE: Record<Exclude<TerminalHighlightHue, 'red'>, string[]> = {
  cyan: ['Read', 'Reading', 'Search', 'Searched', 'Searching', 'Grep', 'Glob', 'LS', 'Listed'],
  yellow: ['Update', 'Updated', 'Write', 'Wrote', 'Edit', 'Edited', 'MultiEdit', 'NotebookEdit'],
  magenta: ['Bash', 'PowerShell', 'BashOutput', 'Monitor', 'Ran', 'Running'],
  blue: ['Agent', 'Task', 'Skill'],
  green: ['Web Search', 'WebSearch', 'Fetch', 'Fetched', 'WebFetch']
}
const TOOL_HUES = new Map(
  Object.entries(TOOLS_BY_HUE).flatMap(([hue, names]) =>
    names.map((name) => [name, hue as TerminalHighlightHue] as const)
  )
)
// Unknown bold names are MCP and plugin tools (delegated work); unknown plain words describe a running shell command.
const OTHER_TOOL_HUE: TerminalHighlightHue = 'blue'
const DESCRIBED_COMMAND_HUE: TerminalHighlightHue = 'magenta'
// "● " precedes the tool name; "  ⎿" puts the result connector in the same column.
const NAME_COLUMN = 2
const MAX_NAME_CELLS = 40

const isSpace = (cell: ClaudeBlockCell | undefined): boolean => (cell?.chars || ' ') === ' '

/** The bold tool name ("Web Search"), else the first word of a summary line. */
function toolName(row: ClaudeBlockRow): { text: string; width: number } {
  const cells = row.cells.slice(NAME_COLUMN, NAME_COLUMN + MAX_NAME_CELLS)
  let width = cells.findIndex((cell) => !cell.bold || cell.chars === '(')
  if (width <= 0) {
    width = cells.findIndex(isSpace)
  }
  if (width < 0) {
    width = cells.length
  }
  const text = cells
    .slice(0, width)
    .map((cell) => cell.chars)
    .join('')
    .trim()
  return { text, width }
}

/** A finished collapsed group ("  Ran 1 shell command"): Claude Code drops its bullet and leaves it dim. */
function isSummary(row: ClaudeBlockRow): boolean {
  return (
    !row.bullet &&
    isSpace(row.cells[0]) &&
    isSpace(row.cells[1]) &&
    row.cells[NAME_COLUMN]?.dim === true &&
    TOOL_HUES.has(toolName(row).text)
  )
}

/**
 * Marks Claude Code transcript blocks: a tool call line plus its indented output, up to the next
 * blank or unindented line, and inline code in a reply, which runs from its bullet through blank
 * and indented lines. `rows` start at or above the block holding `fromLine`; ranges above
 * `fromLine` are dropped.
 */
export function findClaudeBlocks(
  rows: readonly ClaudeBlockRow[],
  style: 'tags' | 'rows',
  fromLine: number
): ClaudeBlockRange[] {
  const ranges: ClaudeBlockRange[] = []
  const push = (
    row: ClaudeBlockRow,
    x: number,
    width: number,
    hue: TerminalHighlightHue,
    paint: ClaudeBlockPaint
  ): void => {
    if (row.line >= fromLine && width > 0) {
      ranges.push({ line: row.line, x, width, hue, paint })
    }
  }
  /** Paints each run of cells that pass `test`. */
  const paintRuns = (
    row: ClaudeBlockRow,
    hue: TerminalHighlightHue,
    paint: ClaudeBlockPaint,
    test: (cell: ClaudeBlockCell) => boolean
  ): void => {
    let start = -1
    row.cells.forEach((cell, x) => {
      if (test(cell) && start < 0) {
        start = x
      } else if (!test(cell) && start >= 0) {
        push(row, start, x - start, hue, paint)
        start = -1
      }
    })
    if (start >= 0) {
      push(row, start, row.cells.length - start, hue, paint)
    }
  }
  const tint = (row: ClaudeBlockRow, hue: TerminalHighlightHue, paint: ClaudeBlockPaint): void =>
    paintRuns(row, hue, paint, (cell) => !cell.ownBg)

  let hue: TerminalHighlightHue | null = null
  let reply = false
  let afterBlank = true
  for (const row of rows) {
    const blank = row.cells.every(isSpace)
    if (row.bullet === 'tool' || row.bullet === 'failed' || (afterBlank && isSummary(row))) {
      reply = false
      const name = toolName(row)
      hue =
        row.bullet === 'failed'
          ? 'red'
          : (TOOL_HUES.get(name.text) ??
            (row.cells[NAME_COLUMN]?.bold ? OTHER_TOOL_HUE : DESCRIBED_COMMAND_HUE))
      if (style === 'rows') {
        tint(row, hue, 'header')
      } else {
        push(row, NAME_COLUMN, name.width, hue, 'tag')
      }
    } else if (hue && !row.bullet && !blank && (row.wrapped || isSpace(row.cells[0]))) {
      if (style === 'rows') {
        tint(row, hue, 'body')
      } else {
        push(row, NAME_COLUMN, Math.max(1, row.cells[NAME_COLUMN]?.width ?? 1), hue, 'bar')
      }
    } else {
      hue = null
      reply =
        row.bullet === 'reply' ||
        (reply && (blank || row.wrapped === true || isSpace(row.cells[0])))
      if (reply) {
        paintRuns(row, 'blue', 'code', (cell) => cell.code)
      } else if (row.cells[0]?.chars === '❯' && row.cells[0].ownBg) {
        push(row, 0, 1, 'blue', 'prompt')
      }
    }
    afterBlank = blank
  }
  return ranges
}
