import { describe, expect, it } from 'vitest'
import { resolveTerminalHighlights } from '../../../../../shared/terminal/appearance/terminal-highlight-rules'
import {
  compileTerminalHighlightRules,
  findHighlightRanges,
  type HighlightCell,
  type HighlightRow
} from './terminal-highlight-matcher'

const WIDE = /[一-鿿]/

function row(
  line: number,
  text: string,
  colored: readonly number[] = [],
  dimmed: readonly number[] = []
): HighlightRow {
  const cells: HighlightCell[] = []
  for (const chars of text) {
    const plain = !colored.includes(cells.length)
    const dim = dimmed.includes(cells.length)
    cells.push({ chars, width: WIDE.test(chars) ? 2 : 1, plain, dim })
    if (WIDE.test(chars)) {
      cells.push({ chars: '', width: 0, plain, dim })
    }
  }
  return { line, cells }
}

const presets = compileTerminalHighlightRules(resolveTerminalHighlights({ enabled: true }).rules)

describe('findHighlightRanges', () => {
  it('colors failure words but not a zero count', () => {
    expect(findHighlightRanges([row(3, 'Tests: 2 failed, 0 errors')], presets)).toEqual([
      { line: 3, x: 9, width: 6, hue: 'red' },
      { line: 3, x: 7, width: 1, hue: 'yellow', subtle: true },
      { line: 3, x: 17, width: 1, hue: 'yellow', subtle: true }
    ])
  })

  it('colors list markers and standalone numbers, not digits inside words', () => {
    expect(
      findHighlightRanges([row(0, '1) took 56.9 s, 3,590,582 rows, 86.1% v2 x64 11.8x')], presets)
    ).toEqual([
      { line: 0, x: 0, width: 2, hue: 'yellow', subtle: true },
      { line: 0, x: 8, width: 6, hue: 'yellow', subtle: true },
      { line: 0, x: 16, width: 9, hue: 'yellow', subtle: true },
      { line: 0, x: 32, width: 5, hue: 'yellow', subtle: true }
    ])
  })

  it('colors durations and counts whole, but not numbers in dimmed text', () => {
    expect(findHighlightRanges([row(0, '8m 6s 870k 3.2M', [], [11, 12, 13, 14])], presets)).toEqual(
      [
        { line: 0, x: 0, width: 2, hue: 'yellow', subtle: true },
        { line: 0, x: 3, width: 2, hue: 'yellow', subtle: true },
        { line: 0, x: 6, width: 4, hue: 'yellow', subtle: true }
      ]
    )
  })

  it('colors status symbols', () => {
    expect(findHighlightRanges([row(0, '✗ build ✓ lint ⚠ deps')], presets)).toEqual([
      { line: 0, x: 0, width: 1, hue: 'red' },
      { line: 0, x: 15, width: 1, hue: 'yellow' },
      { line: 0, x: 8, width: 1, hue: 'green' }
    ])
  })

  it('leaves text the program already colored', () => {
    const colored = [0, 1, 2, 3, 4]
    expect(findHighlightRanges([row(0, 'error: boom', colored)], presets)).toEqual([])
  })

  it('splits a match across wrapped rows', () => {
    expect(findHighlightRanges([row(10, 'see src/ma'), row(11, 'in.ts:42 ok')], presets)).toEqual([
      { line: 10, x: 4, width: 6, hue: 'cyan' },
      { line: 11, x: 0, width: 8, hue: 'cyan' }
    ])
  })

  it('maps matches after wide characters to cell columns', () => {
    expect(findHighlightRanges([row(0, '中文 error')], presets)).toEqual([
      { line: 0, x: 5, width: 5, hue: 'red' }
    ])
  })

  it('colors a URL as one range, without the punctuation after it', () => {
    expect(findHighlightRanges([row(0, '见 https://github.com/a/b.js?x=1。')], presets)).toEqual([
      { line: 0, x: 3, width: 29, hue: 'cyan' }
    ])
  })

  it('colors a path whole or not at all', () => {
    expect(findHighlightRanges([row(0, 'Ui/Log.rbxmx.stash_backup')], presets)).toEqual([])
  })

  it('gives custom rules priority and skips invalid patterns', () => {
    const rules = compileTerminalHighlightRules(
      resolveTerminalHighlights({
        enabled: true,
        disabledPresets: ['metrics'],
        customRules: [
          { id: 'bad', pattern: '(', hue: 'green' },
          { id: 'deploy', pattern: 'deploy failed', hue: 'yellow' }
        ]
      }).rules
    )
    expect(findHighlightRanges([row(0, 'deploy failed in 3s')], rules)).toEqual([
      { line: 0, x: 0, width: 13, hue: 'yellow' }
    ])
  })
})
