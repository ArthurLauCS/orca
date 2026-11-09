import { Plus, Trash2 } from 'lucide-react'
import type { GlobalSettings } from '../../../../../../shared/global-settings-types'
import {
  TERMINAL_HIGHLIGHT_HUES,
  TERMINAL_HIGHLIGHT_PRESET_IDS,
  type TerminalClaudeBlockStyle,
  type TerminalHighlightCustomRule,
  type TerminalHighlightHue,
  type TerminalHighlightPresetId,
  type TerminalHighlightSettings
} from '../../../../../../shared/terminal/appearance/terminal-highlight-rules'
import { Button } from '../../../ui/button'
import { Input } from '../../../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../ui/select'
import {
  SettingsRow,
  SettingsSegmentedControl,
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from '../../form-controls/SettingsFormControls'
import { SearchableSetting } from '../../section-layout/SearchableSetting'
import { translate } from '@/i18n/i18n'
import { getTerminalHighlightSearchEntries } from './terminal-highlight-search'

type TerminalHighlightSectionProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

function presetCopy(id: TerminalHighlightPresetId): { label: string; description: string } {
  switch (id) {
    case 'errors':
      return {
        label: translate('components.settings.TerminalHighlights.presetErrors', 'Errors'),
        description: translate(
          'components.settings.TerminalHighlights.presetErrorsDescription',
          'error, failed, fatal, exception, ✗ in red. "0 errors" stays plain.'
        )
      }
    case 'warnings':
      return {
        label: translate('components.settings.TerminalHighlights.presetWarnings', 'Warnings'),
        description: translate(
          'components.settings.TerminalHighlights.presetWarningsDescription',
          'warning, deprecated, ⚠ in yellow.'
        )
      }
    case 'success':
      return {
        label: translate('components.settings.TerminalHighlights.presetSuccess', 'Success'),
        description: translate(
          'components.settings.TerminalHighlights.presetSuccessDescription',
          'passed, succeeded, ✓ in green.'
        )
      }
    case 'paths':
      return {
        label: translate('components.settings.TerminalHighlights.presetPaths', 'File Paths'),
        description: translate(
          'components.settings.TerminalHighlights.presetPathsDescription',
          'Paths and file:line locations in cyan.'
        )
      }
    case 'references':
      return {
        label: translate('components.settings.TerminalHighlights.presetReferences', 'References'),
        description: translate(
          'components.settings.TerminalHighlights.presetReferencesDescription',
          'Issue and PR numbers (#123) and commit hashes in magenta.'
        )
      }
    case 'metrics':
      return {
        label: translate('components.settings.TerminalHighlights.presetMetrics', 'Numbers'),
        description: translate(
          'components.settings.TerminalHighlights.presetMetricsDescription',
          'Durations, sizes and percentages in blue.'
        )
      }
  }
}

function hueLabel(hue: TerminalHighlightHue): string {
  switch (hue) {
    case 'red':
      return translate('components.settings.TerminalHighlights.hueRed', 'Red')
    case 'yellow':
      return translate('components.settings.TerminalHighlights.hueYellow', 'Yellow')
    case 'green':
      return translate('components.settings.TerminalHighlights.hueGreen', 'Green')
    case 'cyan':
      return translate('components.settings.TerminalHighlights.hueCyan', 'Cyan')
    case 'blue':
      return translate('components.settings.TerminalHighlights.hueBlue', 'Blue')
    case 'magenta':
      return translate('components.settings.TerminalHighlights.hueMagenta', 'Magenta')
  }
}

function isValidPattern(pattern: string): boolean {
  try {
    new RegExp(pattern)
    return true
  } catch {
    return false
  }
}

function isHue(value: string): value is TerminalHighlightHue {
  return (TERMINAL_HIGHLIGHT_HUES as readonly string[]).includes(value)
}

export function TerminalHighlightSection({
  settings,
  updateSettings
}: TerminalHighlightSectionProps): React.JSX.Element {
  const current: TerminalHighlightSettings = settings.terminalHighlights ?? { enabled: false }
  const disabledPresets = new Set(current.disabledPresets ?? [])
  const customRules = current.customRules ?? []
  const update = (patch: Partial<TerminalHighlightSettings>): void =>
    updateSettings({ terminalHighlights: { ...current, ...patch } })
  const updateRule = (id: string, patch: Partial<TerminalHighlightCustomRule>): void =>
    update({
      customRules: customRules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule))
    })
  const [entry] = getTerminalHighlightSearchEntries()

  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={translate('components.settings.TerminalHighlights.title', 'Text Highlighting')}
        description={translate(
          'components.settings.TerminalHighlights.description',
          'Colors come from the terminal theme: bright ANSI colors on dark themes, normal ones on light themes.'
        )}
      />
      <SearchableSetting {...entry}>
        <SettingsSwitchRow
          label={entry.title}
          description={entry.description}
          checked={current.enabled}
          onChange={() => update({ enabled: !current.enabled })}
        />
      </SearchableSetting>

      {current.enabled ? (
        <div className="divide-y divide-border/40">
          <SettingsRow
            label={translate(
              'components.settings.TerminalHighlights.claudeBlocks',
              'Claude Code Tool Calls'
            )}
            description={translate(
              'components.settings.TerminalHighlights.claudeBlocksDescription',
              'Colors each tool call and its output by tool: reads cyan, edits yellow, commands magenta, agents and skills blue, web green, failures red.'
            )}
            control={
              <SettingsSegmentedControl<TerminalClaudeBlockStyle>
                size="sm"
                value={current.claudeBlocks ?? 'tags'}
                onChange={(value) => update({ claudeBlocks: value })}
                ariaLabel={translate(
                  'components.settings.TerminalHighlights.claudeBlocks',
                  'Claude Code Tool Calls'
                )}
                options={[
                  {
                    value: 'tags',
                    label: translate(
                      'components.settings.TerminalHighlights.claudeBlocksTags',
                      'Name and Bar'
                    )
                  },
                  {
                    value: 'rows',
                    label: translate(
                      'components.settings.TerminalHighlights.claudeBlocksRows',
                      'Tinted Rows'
                    )
                  },
                  {
                    value: 'off',
                    label: translate(
                      'components.settings.TerminalHighlights.claudeBlocksOff',
                      'Off'
                    )
                  }
                ]}
              />
            }
          />
          {TERMINAL_HIGHLIGHT_PRESET_IDS.map((id) => {
            const copy = presetCopy(id)
            return (
              <SettingsSwitchRow
                key={id}
                label={copy.label}
                description={copy.description}
                checked={!disabledPresets.has(id)}
                onChange={() => {
                  const next = new Set(disabledPresets)
                  if (next.has(id)) {
                    next.delete(id)
                  } else {
                    next.add(id)
                  }
                  update({ disabledPresets: [...next] })
                }}
              />
            )
          })}

          <div className="space-y-2 py-3">
            <div className="space-y-0.5">
              <p className="text-sm">
                {translate('components.settings.TerminalHighlights.customTitle', 'Custom Rules')}
              </p>
              <p className="text-xs text-muted-foreground">
                {translate(
                  'components.settings.TerminalHighlights.customDescription',
                  'JavaScript regular expressions, matched case-insensitively. Custom rules win over the presets.'
                )}
              </p>
            </div>
            {customRules.map((rule) => {
              const valid = isValidPattern(rule.pattern)
              return (
                <div key={rule.id} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Input
                      value={rule.pattern}
                      aria-invalid={!valid}
                      aria-label={translate(
                        'components.settings.TerminalHighlights.pattern',
                        'Pattern'
                      )}
                      placeholder="TODO|FIXME"
                      className="h-8 flex-1 font-mono text-xs"
                      onChange={(event) => updateRule(rule.id, { pattern: event.target.value })}
                    />
                    <Select
                      value={rule.hue}
                      onValueChange={(value) => {
                        if (isHue(value)) {
                          updateRule(rule.id, { hue: value })
                        }
                      }}
                    >
                      <SelectTrigger
                        size="sm"
                        className="w-[110px]"
                        aria-label={translate(
                          'components.settings.TerminalHighlights.color',
                          'Color'
                        )}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TERMINAL_HIGHLIGHT_HUES.map((hue) => (
                          <SelectItem key={hue} value={hue}>
                            {hueLabel(hue)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={translate(
                        'components.settings.TerminalHighlights.removeRule',
                        'Remove rule'
                      )}
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() =>
                        update({ customRules: customRules.filter((r) => r.id !== rule.id) })
                      }
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  {valid ? null : (
                    <p className="text-xs text-destructive">
                      {translate(
                        'components.settings.TerminalHighlights.invalidPattern',
                        'Not a valid regular expression; this rule is skipped.'
                      )}
                    </p>
                  )}
                </div>
              )
            })}
            <Button
              variant="outline"
              size="xs"
              onClick={() =>
                update({
                  customRules: [
                    ...customRules,
                    { id: `custom-${Date.now().toString(36)}`, pattern: '', hue: 'yellow' }
                  ]
                })
              }
            >
              <Plus />
              {translate('components.settings.TerminalHighlights.addRule', 'Add Rule')}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
