/** ANSI hues a highlight can use; dark themes draw the bright slot, light themes the normal one. */
export const TERMINAL_HIGHLIGHT_HUES = [
  'red',
  'yellow',
  'green',
  'cyan',
  'blue',
  'magenta'
] as const
export type TerminalHighlightHue = (typeof TERMINAL_HIGHLIGHT_HUES)[number]

export type TerminalHighlightRule = {
  id: string
  /** JavaScript regular expression source, matched against each logical (unwrapped) line. */
  pattern: string
  hue: TerminalHighlightHue
  caseSensitive?: boolean
}

export type TerminalHighlightCustomRule = TerminalHighlightRule & { enabled?: boolean }

export const TERMINAL_HIGHLIGHT_PRESET_IDS = [
  'errors',
  'warnings',
  'success',
  'paths',
  'references',
  'metrics'
] as const
export type TerminalHighlightPresetId = (typeof TERMINAL_HIGHLIGHT_PRESET_IDS)[number]

export type TerminalHighlightSettings = {
  enabled: boolean
  disabledPresets?: TerminalHighlightPresetId[]
  customRules?: TerminalHighlightCustomRule[]
}

export type TerminalHighlightGlobalSettings = {
  /** Recolor plain terminal text matching rules (errors, paths, references). Undefined = off. */
  terminalHighlights?: TerminalHighlightSettings
}

// "0 errors" and "no warnings" are good news; don't paint them as failures.
const NOT_ZERO = String.raw`(?<!\b(?:0|no) )`

export const TERMINAL_HIGHLIGHT_PRESETS: Record<
  TerminalHighlightPresetId,
  Omit<TerminalHighlightRule, 'id'>
> = {
  errors: {
    hue: 'red',
    pattern: String.raw`${NOT_ZERO}\b(?:error|errors|failed|failing|failure|fatal|exception|panic|denied|refused)\b|[✗✘]`
  },
  warnings: {
    hue: 'yellow',
    pattern: String.raw`${NOT_ZERO}\b(?:warn|warning|warnings|deprecated)\b|⚠`
  },
  success: {
    hue: 'green',
    pattern: String.raw`\b(?:passed|passing|success|successful|succeeded)\b|[✓✔]`
  },
  paths: {
    hue: 'cyan',
    caseSensitive: true,
    pattern: String.raw`(?:[A-Za-z]:[\\/]|~[\\/]|\/)?(?:[\w.@-]+[\\/])+[\w.@-]+\.[A-Za-z0-9]{1,8}(?::\d+(?::\d+)?)?|\b[\w.-]+\.[A-Za-z][A-Za-z0-9]{0,7}:\d+(?::\d+)?`
  },
  references: {
    hue: 'magenta',
    caseSensitive: true,
    // Issue/PR numbers and commit hashes (hex with at least one digit and one letter).
    pattern: String.raw`(?<![\w#&])#\d+\b|\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b`
  },
  metrics: {
    hue: 'blue',
    pattern: String.raw`\b\d+(?:\.\d+)?\s?(?:ms|s|sec|min|h|KB|MB|GB|KiB|MiB|GiB)\b|\b\d+(?:\.\d+)?%`
  }
}

function isHue(value: unknown): value is TerminalHighlightHue {
  return (TERMINAL_HIGHLIGHT_HUES as readonly unknown[]).includes(value)
}

/** Rules to apply, in priority order (custom rules first); empty when highlighting is off. */
export function resolveTerminalHighlightRules(
  settings: TerminalHighlightSettings | undefined
): TerminalHighlightRule[] {
  if (!settings?.enabled) {
    return []
  }
  const disabled = new Set(settings.disabledPresets ?? [])
  const custom = (settings.customRules ?? []).filter(
    (rule) =>
      rule.enabled !== false &&
      typeof rule.pattern === 'string' &&
      rule.pattern.length > 0 &&
      isHue(rule.hue)
  )
  const presets = TERMINAL_HIGHLIGHT_PRESET_IDS.filter((id) => !disabled.has(id)).map((id) => ({
    id,
    ...TERMINAL_HIGHLIGHT_PRESETS[id]
  }))
  return [...custom, ...presets]
}
