import type { ITheme } from '@xterm/xterm'
import {
  TERMINAL_HIGHLIGHT_HUES,
  type TerminalHighlightHue
} from '../../../../../shared/terminal/appearance/terminal-highlight-rules'

export type HighlightPalette = {
  hues: Record<TerminalHighlightHue, string>
  background: string
  dark: boolean
}

// xterm's default ANSI colors, for themes that leave a slot out.
const FALLBACK: Record<'dark' | 'light', Record<TerminalHighlightHue, string>> = {
  dark: {
    red: '#f14c4c',
    yellow: '#f5f543',
    green: '#23d18b',
    cyan: '#29b8db',
    blue: '#3b8eea',
    magenta: '#d670d6'
  },
  light: {
    red: '#cd3131',
    yellow: '#949800',
    green: '#00bc00',
    cyan: '#0598bc',
    blue: '#0451a5',
    magenta: '#bc05bc'
  }
}

/** Decorations only accept #RRGGBB. */
function toHex6(color: string | undefined): string | null {
  if (!color) {
    return null
  }
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(color)
  if (short) {
    return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
  }
  const long = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(color)
  return long ? `#${long[1]}` : null
}

function isDark(background: string | null): boolean {
  if (!background) {
    return true
  }
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(background.slice(i, i + 2), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5
}

/** Highlight colors from the pane's theme, so rules follow the active palette. */
export function resolveHighlightPalette(theme: ITheme | undefined): HighlightPalette {
  const background = toHex6(theme?.background)
  const dark = isDark(background)
  const hues = { ...FALLBACK[dark ? 'dark' : 'light'] }
  for (const hue of TERMINAL_HIGHLIGHT_HUES) {
    const slot = (dark ? `bright${hue[0].toUpperCase()}${hue.slice(1)}` : hue) as keyof ITheme
    const value = theme?.[slot]
    hues[hue] = toHex6(typeof value === 'string' ? value : undefined) ?? hues[hue]
  }
  return { hues, background: background ?? (dark ? '#000000' : '#ffffff'), dark }
}

/** `amount` of `color` laid over `background`; both #RRGGBB. */
export function mixHex(color: string, background: string, amount: number): string {
  return `#${[1, 3, 5]
    .map((i) => {
      const value = Number.parseInt(color.slice(i, i + 2), 16) * amount
      const base = Number.parseInt(background.slice(i, i + 2), 16) * (1 - amount)
      return Math.round(value + base)
        .toString(16)
        .padStart(2, '0')
    })
    .join('')}`
}
