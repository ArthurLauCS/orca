import { translate } from '@/i18n/i18n'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'

export const getTerminalHighlightSearchEntries = createLocalizedCatalog(() => [
  {
    title: translate('components.settings.TerminalHighlights.enable', 'Highlight Matching Text'),
    description: translate(
      'components.settings.TerminalHighlights.enableDescription',
      'Recolor plain terminal text that matches rules, such as errors, file paths and issue numbers. Text a program already colored is left alone.'
    ),
    keywords: [
      'terminal',
      'highlight',
      'highlighting',
      'color',
      'colour',
      'rules',
      'regex',
      'pattern',
      'error',
      'path',
      'claude'
    ]
  }
])
