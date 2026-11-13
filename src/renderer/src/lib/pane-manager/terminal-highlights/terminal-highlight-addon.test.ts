// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { Terminal } from '@xterm/xterm'
import { resolveTerminalHighlights } from '../../../../../shared/terminal/appearance/terminal-highlight-rules'
import { setTerminalHighlights } from './terminal-highlight-addon'

const terminals: Terminal[] = []

afterEach(() => {
  vi.useRealTimers()
  terminals.splice(0).forEach((terminal) => terminal.dispose())
})

function write(terminal: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => terminal.write(data, resolve))
}

function decorations(register: ReturnType<typeof vi.spyOn>): unknown[][] {
  return register.mock.calls.map(([options]) => [
    options.marker.line,
    options.x,
    options.width,
    options.foregroundColor,
    options.backgroundColor
  ])
}

it('decorates plain matches with the theme color and skips text the program colored', async () => {
  const terminal = new Terminal({
    cols: 20,
    rows: 5,
    allowProposedApi: true,
    theme: { background: '#101010', brightRed: '#ff5f5f' }
  })
  terminals.push(terminal)
  await write(terminal, 'build \x1b[31merror\x1b[0m\r\nTests: 1 failed\r\n')
  const register = vi.spyOn(terminal, 'registerDecoration')
  vi.useFakeTimers()

  setTerminalHighlights(terminal, resolveTerminalHighlights({ enabled: true }))
  await vi.advanceTimersByTimeAsync(100)

  expect(decorations(register)).toEqual([
    [1, 9, 6, '#ff5f5f', undefined],
    [1, 7, 1, '#fafaa1', undefined]
  ])

  setTerminalHighlights(terminal, { rules: [], claudeBlocks: null })
  expect(terminal.registerDecoration).toHaveBeenCalledTimes(2)
})

it('moves highlights with text a full-screen app rewrites in place, before any timer runs', async () => {
  const terminal = new Terminal({
    cols: 20,
    rows: 3,
    allowProposedApi: true,
    theme: { background: '#101010', brightRed: '#ff5f5f' }
  })
  terminals.push(terminal)
  await write(terminal, 'ok\r\nbuild error')
  const register = vi.spyOn(terminal, 'registerDecoration')
  setTerminalHighlights(terminal, resolveTerminalHighlights({ enabled: true }))
  await Promise.resolve()

  // Full-screen apps such as Claude Code scroll by redrawing rows, not by moving the buffer.
  await write(terminal, '\x1b[H\x1b[2Kan error\r\n\x1b[2Kfine')
  await new Promise((resolve) => setTimeout(resolve, 0))

  const live = register.mock.calls
    .filter((_, i) => {
      const decoration = register.mock.results[i]?.value
      return decoration && !decoration.isDisposed && !decoration.marker.isDisposed
    })
    .map(([options]) => [options.marker.line, options.x, options.width, options.foregroundColor])
  expect(live).toEqual([[0, 3, 5, '#ff5f5f']])
})

// SGR as Claude Code emits it in its ANSI themes.
const CLAUDE_TRANSCRIPT = [
  '\x1b[100m❯ \x1b[97mfix it\x1b[39m\x1b[49m',
  '',
  '\x1b[92m●\x1b[39m \x1b[1mBash\x1b[22m(npm test)',
  '\x1b[2m  ⎿  FAIL a.test.ts\x1b[22m',
  '     Tests: 1 failed',
  '',
  '\x1b[91m●\x1b[39m \x1b[1mUpdate\x1b[22m(a.ts)',
  '  ⎿  Error: modified',
  '',
  '\x1b[2C\x1b[2mRan \x1b[22;1m1\x1b[22;2m shell command\x1b[22m',
  '',
  '\x1b[97m●\x1b[39m done'
].join('\r\n')

async function claudeTerminal(): Promise<Terminal> {
  const terminal = new Terminal({
    cols: 40,
    rows: 12,
    allowProposedApi: true,
    theme: {
      background: '#101010',
      brightRed: '#ff0000',
      brightBlue: '#0000ff',
      brightMagenta: '#ff00ff'
    }
  })
  terminals.push(terminal)
  await write(terminal, CLAUDE_TRANSCRIPT)
  return terminal
}

it('tints tool names, colors collapsed summaries and the ⎿ before output, red for a failed call', async () => {
  const terminal = await claudeTerminal()
  const register = vi.spyOn(terminal, 'registerDecoration')
  vi.useFakeTimers()

  setTerminalHighlights(terminal, { rules: [], claudeBlocks: 'tags' })
  await vi.advanceTimersByTimeAsync(100)

  expect(decorations(register)).toEqual([
    [0, 0, 8, undefined, '#232323'],
    [0, 0, 1, '#0000ff', undefined],
    [2, 2, 4, '#ff00ff', '#360d36'],
    [3, 2, 1, '#ff00ff', undefined],
    [6, 2, 6, '#ff0000', '#360d0d'],
    [7, 2, 1, '#ff0000', undefined],
    [9, 2, 3, '#ff00ff', undefined]
  ])
})

it('lays a neutral band under every prompt echo row, around Claude Code’s own selection', async () => {
  const terminal = new Terminal({
    cols: 20,
    rows: 4,
    allowProposedApi: true,
    theme: { background: '#101010', foreground: '#f0f0f0', brightBlue: '#0000ff' }
  })
  terminals.push(terminal)
  await write(
    terminal,
    [
      '\x1b[100m❯ fix the config  \x1b[49m',
      '\x1b[100m  loader \x1b[44mplease\x1b[100m   \x1b[49m',
      '',
      'next'
    ].join('\r\n')
  )
  const register = vi.spyOn(terminal, 'registerDecoration')
  vi.useFakeTimers()

  setTerminalHighlights(terminal, { rules: [], claudeBlocks: 'tags' })
  await vi.advanceTimersByTimeAsync(100)

  expect(decorations(register)).toEqual([
    [0, 0, 18, undefined, '#222222'],
    [0, 0, 1, '#0000ff', undefined],
    [1, 0, 9, undefined, '#222222'],
    [1, 15, 3, undefined, '#222222']
  ])
})

it('leaves text under Claude Code’s own mouse selection in the program’s colors', async () => {
  const terminal = new Terminal({
    cols: 30,
    rows: 3,
    allowProposedApi: true,
    theme: { background: '#101010', brightRed: '#ff5f5f', brightBlue: '#0000ff' }
  })
  terminals.push(terminal)
  // Claude Code's ANSI themes paint a mouse selection with SGR 44.
  await write(
    terminal,
    [
      '\x1b[92m●\x1b[39m \x1b[1mSk\x1b[44mill\x1b[22m(x) \x1b[49m',
      '  build \x1b[44merror\x1b[49m error'
    ].join('\r\n')
  )
  const register = vi.spyOn(terminal, 'registerDecoration')
  vi.useFakeTimers()

  setTerminalHighlights(
    terminal,
    resolveTerminalHighlights({ enabled: true, claudeBlocks: 'tags' })
  )
  await vi.advanceTimersByTimeAsync(100)

  expect(decorations(register)).toEqual([
    [1, 14, 5, '#ff5f5f', undefined],
    [0, 2, 2, '#0000ff', '#0d0d36']
  ])
})

it('gives inline code in a reply a neutral background, across blank lines but not in tool calls', async () => {
  const terminal = new Terminal({
    cols: 30,
    rows: 5,
    allowProposedApi: true,
    theme: { background: '#000000', brightBlue: '#6464ff' }
  })
  terminals.push(terminal)
  await write(
    terminal,
    [
      '\x1b[97m●\x1b[39m run \x1b[94mnpm test\x1b[39m',
      '',
      '  then \x1b[94mlint\x1b[39m',
      '\x1b[92m●\x1b[39m \x1b[1mRead\x1b[22m(\x1b[94ma.ts\x1b[39m)'
    ].join('\r\n')
  )
  const register = vi.spyOn(terminal, 'registerDecoration')
  vi.useFakeTimers()

  setTerminalHighlights(terminal, { rules: [], claudeBlocks: 'tags' })
  await vi.advanceTimersByTimeAsync(100)

  expect(decorations(register)).toEqual([
    [0, 6, 8, undefined, '#141414'],
    [2, 7, 4, undefined, '#141414'],
    [3, 2, 4, '#29b8db', '#071d23']
  ])
})

it('tints whole rows of a tool block, stronger on the call line', async () => {
  const terminal = await claudeTerminal()
  const register = vi.spyOn(terminal, 'registerDecoration')
  vi.useFakeTimers()

  setTerminalHighlights(terminal, { rules: [], claudeBlocks: 'rows' })
  await vi.advanceTimersByTimeAsync(100)

  expect(decorations(register)).toEqual([
    [0, 0, 8, undefined, '#232323'],
    [0, 0, 1, '#0000ff', undefined],
    [2, 0, 40, undefined, '#450c45'],
    [3, 0, 40, undefined, '#230f23'],
    [4, 0, 40, undefined, '#230f23'],
    [6, 0, 40, undefined, '#450c0c'],
    [7, 0, 40, undefined, '#230f0f'],
    [9, 0, 40, undefined, '#450c45']
  ])
})
