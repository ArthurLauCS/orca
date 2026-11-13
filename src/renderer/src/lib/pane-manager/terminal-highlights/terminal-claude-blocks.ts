import type { TerminalHighlightHue } from '../../../../../shared/terminal/appearance/terminal-highlight-rules'
import type { HighlightCell } from './terminal-highlight-matcher'

/** What Claude Code's bullet in column 0 marks: its prose, a tool call, or a failed tool call. */
export type ClaudeBullet = 'reply' | 'tool' | 'failed'

export type ClaudeBlockCell = HighlightCell & {
  bold: boolean
  /**
   * The program painted this background (Claude Code's own mouse selection, diff lines, the prompt
   * echo); its colors win over every mark but the echo band.
   */
  ownBg: boolean
  /** Bright black: the prompt echo of Claude Code's ANSI themes, which the band replaces. */
  echoBg: boolean
  /** Drawn in Claude Code's inline-code color; replies give these runs a soft background. */
  code: boolean
}

export type ClaudeBlockRow = {
  line: number
  cells: ClaudeBlockCell[]
  bullet?: ClaudeBullet
  wrapped?: boolean
}

/**
 * `tag`: tinted tool name; `name`: colored tool name; `connector`: colored ⎿; `prompt`: colored ❯;
 * `band` and `code`: neutral surface under the prompt echo and inline code; `header`/`body`: row tints.
 */
export type ClaudeBlockPaint =
  | 'header'
  | 'body'
  | 'tag'
  | 'name'
  | 'connector'
  | 'prompt'
  | 'band'
  | 'code'

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
 * blank or unindented line; inline code in a reply, which runs from its bullet through blank and
 * indented lines; and the prompt echo, the rows after ❯ that keep its background. `rows` start at or above the block holding `fromLine`; ranges above
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
  /** Paints each run of cells in [from, to) that pass `test`; by default those the program left unpainted. */
  const paintRuns = (
    row: ClaudeBlockRow,
    hue: TerminalHighlightHue,
    paint: ClaudeBlockPaint,
    test: (cell: ClaudeBlockCell) => boolean = (cell) => !cell.ownBg,
    from = 0,
    to = row.cells.length
  ): void => {
    let start = -1
    const end = Math.min(to, row.cells.length)
    for (let x = from; x <= end; x++) {
      const on = x < end && test(row.cells[x])
      if (on && start < 0) {
        start = x
      } else if (!on && start >= 0) {
        push(row, start, x - start, hue, paint)
        start = -1
      }
    }
  }

  let hue: TerminalHighlightHue | null = null
  let reply = false
  let echo = false
  let afterBlank = true
  for (const row of rows) {
    const blank = row.cells.every(isSpace)
    // The prompt echo: Claude Code's ANSI themes give it the bright-black background, which many
    // palettes also use for the selection, so a selection inside it would not show. Claude Code's
    // own mouse selection repaints cells in another color; the band leaves those.
    echo = row.cells[0]?.ownBg === true && (echo || row.cells[0].chars === '❯')
    if (row.bullet === 'tool' || row.bullet === 'failed' || (afterBlank && isSummary(row))) {
      reply = false
      const name = toolName(row)
      hue =
        row.bullet === 'failed'
          ? 'red'
          : (TOOL_HUES.get(name.text) ??
            (row.cells[NAME_COLUMN]?.bold ? OTHER_TOOL_HUE : DESCRIBED_COMMAND_HUE))
      if (style === 'rows') {
        paintRuns(row, hue, 'header')
      } else {
        // Collapsed summaries are dimmed by Claude Code; dim text over a tint is hard to read.
        const paint = row.bullet ? 'tag' : 'name'
        paintRuns(row, hue, paint, undefined, NAME_COLUMN, NAME_COLUMN + name.width)
      }
    } else if (hue && !row.bullet && !blank && (row.wrapped || isSpace(row.cells[0]))) {
      if (style === 'rows') {
        paintRuns(row, hue, 'body')
      } else if (row.cells[NAME_COLUMN]?.chars === '⎿') {
        paintRuns(row, hue, 'connector', undefined, NAME_COLUMN, NAME_COLUMN + 1)
      }
    } else {
      hue = null
      reply =
        !echo &&
        (row.bullet === 'reply' ||
          (reply && (blank || row.wrapped === true || isSpace(row.cells[0]))))
      if (reply) {
        paintRuns(row, 'blue', 'code', (cell) => cell.code && !cell.ownBg)
      } else if (echo) {
        paintRuns(row, 'blue', 'band', (cell) => cell.echoBg)
        paintRuns(row, 'blue', 'prompt', (cell) => cell.echoBg && cell.chars === '❯', 0, 1)
      }
    }
    afterBlank = blank
  }
  return ranges
}
