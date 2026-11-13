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
  /** For frequent tokens such as numbers: drawn half-way to the foreground and left alone in dimmed text. */
  subtle?: boolean
}

export type TerminalHighlightCustomRule = TerminalHighlightRule & { enabled?: boolean }

export const TERMINAL_HIGHLIGHT_PRESET_IDS = [
  'errors',
  'warnings',
  'success',
  'paths',
  'references',
  'lists',
  'metrics'
] as const
export type TerminalHighlightPresetId = (typeof TERMINAL_HIGHLIGHT_PRESET_IDS)[number]

/** How Claude Code tool calls are marked: a tinted tool name plus a colored ⎿ before its output, or tinted rows. */
export type TerminalClaudeBlockStyle = 'tags' | 'rows' | 'off'

export type TerminalHighlightSettings = {
  enabled: boolean
  disabledPresets?: TerminalHighlightPresetId[]
  customRules?: TerminalHighlightCustomRule[]
  /** Undefined = 'tags'. */
  claudeBlocks?: TerminalClaudeBlockStyle
}

export type TerminalHighlightConfig = {
  rules: TerminalHighlightRule[]
  claudeBlocks: Exclude<TerminalClaudeBlockStyle, 'off'> | null
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
    pattern: String.raw`${NOT_ZERO}\b(?:error|errors|failed|failing|failure|fatal|exception|panic|denied|refused)\b|[\u2717\u2718]`
  },
  warnings: {
    hue: 'yellow',
    pattern: String.raw`${NOT_ZERO}\b(?:warn|warning|warnings|deprecated)\b|\u26a0`
  },
  success: {
    hue: 'green',
    pattern: String.raw`\b(?:passed|passing|success|successful|succeeded)\b|[\u2713\u2714]`
  },
  paths: {
    hue: 'cyan',
    caseSensitive: true,
    // URLs first, whole and without trailing punctuation, so their path part is not colored alone; paths whole or not at all.
    pattern: String.raw`\bhttps?:\/\/[\w\-.~:/?#@!$&*+,;=%]*[\w\-~/#=&%]|(?:[A-Za-z]:[\\/]|~[\\/]|\/)?(?:[\w.@-]+[\\/])+[\w.@-]+\.[A-Za-z0-9]{1,8}(?::\d+(?::\d+)?)?(?!\w|\.\w)|\b[\w.-]+\.[A-Za-z][A-Za-z0-9]{0,7}:\d+(?::\d+)?`
  },
  references: {
    hue: 'magenta',
    caseSensitive: true,
    // Issue/PR numbers and commit hashes (hex with at least one digit and one letter).
    pattern: String.raw`(?<![\w#&])#\d+\b|\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b`
  },
  lists: {
    // Blue is the structure color, shared with Claude Code's quote bars.
    hue: 'blue',
    // A line's leading - * • 1. or 1), ahead of numbers so "1." stays whole.
    pattern: String.raw`(?<=^\s*)(?:[-*\u2022]|\d+[.)])(?=\s)`
  },
  metrics: {
    hue: 'yellow',
    // Numbers are everywhere (line numbers, status lines, token counts); keep pure yellow for warnings.
    subtle: true,
    // Standalone numbers (3,590,582, 1.4.248, 56.9 s, 1m, 11.8k, 86.1%), not digits inside words like v2 or x64.
    pattern: String.raw`(?<![\w.])\d+(?:,\d{3})*(?:\.\d+)*(?:\s?(?:ms|s|sec|min|m|h|KB|MB|GB|KiB|MiB|GiB)\b|[kKM]\b|%)?(?!\w|\.\d)`
  }
}

function isHue(value: unknown): value is TerminalHighlightHue {
  return (TERMINAL_HIGHLIGHT_HUES as readonly unknown[]).includes(value)
}

/** Rules in priority order (custom rules first) and the Claude Code block style; nothing when highlighting is off. */
export function resolveTerminalHighlights(
  settings: TerminalHighlightSettings | undefined
): TerminalHighlightConfig {
  if (!settings?.enabled) {
    return { rules: [], claudeBlocks: null }
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
  return {
    rules: [...custom, ...presets],
    claudeBlocks:
      settings.claudeBlocks === 'off' ? null : settings.claudeBlocks === 'rows' ? 'rows' : 'tags'
  }
}
