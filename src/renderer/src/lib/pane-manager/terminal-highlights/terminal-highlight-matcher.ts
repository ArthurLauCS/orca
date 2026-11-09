import type {
  TerminalHighlightHue,
  TerminalHighlightRule
} from '../../../../../shared/terminal/appearance/terminal-highlight-rules'

export type HighlightCell = {
  chars: string
  /** 0 for the trailing half of a wide character. */
  width: number
  /** Text the program left in a neutral color; only this text is recolored. */
  plain: boolean
}

export type HighlightRow = { line: number; cells: HighlightCell[] }

export type HighlightRange = { line: number; x: number; width: number; hue: TerminalHighlightHue }

export type CompiledHighlightRule = { regex: RegExp; hue: TerminalHighlightHue }

// Bounds regex work on very long logical lines (minified output, base64).
const MAX_LOGICAL_LINE_CHARS = 4096

export function compileTerminalHighlightRules(
  rules: readonly TerminalHighlightRule[]
): CompiledHighlightRule[] {
  const compiled: CompiledHighlightRule[] = []
  for (const rule of rules) {
    try {
      compiled.push({
        regex: new RegExp(rule.pattern, rule.caseSensitive ? 'g' : 'gi'),
        hue: rule.hue
      })
    } catch {
      // An invalid custom pattern disables only that rule.
    }
  }
  return compiled
}

type CellRef = { row: number; x: number; width: number; plain: boolean }

/** Matches rules against one logical line (a row plus its wrapped continuation rows). */
export function findHighlightRanges(
  rows: readonly HighlightRow[],
  rules: readonly CompiledHighlightRule[]
): HighlightRange[] {
  let text = ''
  // One entry per UTF-16 unit of `text`, pointing at the cell that drew it.
  const unitCells: CellRef[] = []
  rows.forEach((row, rowIndex) => {
    row.cells.forEach((cell, x) => {
      if (cell.width === 0 || text.length >= MAX_LOGICAL_LINE_CHARS) {
        return
      }
      const chars = cell.chars || ' '
      const ref = { row: rowIndex, x, width: cell.width, plain: cell.plain }
      text += chars
      for (let i = 0; i < chars.length; i++) {
        unitCells.push(ref)
      }
    })
  })

  const taken = new Set<CellRef>()
  const ranges: HighlightRange[] = []
  for (const rule of rules) {
    rule.regex.lastIndex = 0
    for (let match = rule.regex.exec(text); match; match = rule.regex.exec(text)) {
      if (match[0].length === 0) {
        rule.regex.lastIndex++
        continue
      }
      const cells = [...new Set(unitCells.slice(match.index, match.index + match[0].length))]
      if (cells.length === 0 || cells.some((cell) => !cell.plain || taken.has(cell))) {
        continue
      }
      cells.forEach((cell) => taken.add(cell))
      for (const cell of cells) {
        const last = ranges.at(-1)
        const line = rows[cell.row].line
        if (last && last.line === line && last.hue === rule.hue && last.x + last.width === cell.x) {
          last.width += cell.width
        } else {
          ranges.push({ line, x: cell.x, width: cell.width, hue: rule.hue })
        }
      }
    }
  }
  return ranges
}
