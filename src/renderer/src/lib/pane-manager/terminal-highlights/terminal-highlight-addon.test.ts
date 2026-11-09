// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { Terminal } from '@xterm/xterm'
import { resolveTerminalHighlightRules } from '../../../../../shared/terminal/appearance/terminal-highlight-rules'
import { setTerminalHighlights } from './terminal-highlight-addon'

const terminals: Terminal[] = []

afterEach(() => {
  vi.useRealTimers()
  terminals.splice(0).forEach((terminal) => terminal.dispose())
})

function write(terminal: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => terminal.write(data, resolve))
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

  setTerminalHighlights(terminal, resolveTerminalHighlightRules({ enabled: true }))
  await vi.advanceTimersByTimeAsync(100)

  expect(
    register.mock.calls.map(([options]) => [
      options.marker.line,
      options.x,
      options.width,
      options.foregroundColor
    ])
  ).toEqual([[1, 9, 6, '#ff5f5f']])

  setTerminalHighlights(terminal, [])
  expect(terminal.registerDecoration).toHaveBeenCalledTimes(1)
})
