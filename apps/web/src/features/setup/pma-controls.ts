/**
 * phpMyAdmin template controls implemented by the setup wizard (docs/architecture/12,
 * tools/parity/inventory/controls.json keys → component files).
 */
export const pmaControls = {
  'setup/base.twig#link:Overview': { file: 'SetupLayout.tsx', match: "t('Overview')" },
  'setup/home/index.twig#lang': { file: 'OverviewPage.tsx', match: '<LanguageSelect' },
  'setup/home/index.twig#link:Show hidden messages': 'OverviewPage.tsx',
  'setup/home/index.twig#link:Edit': 'OverviewPage.tsx',
  'setup/home/index.twig#link:Delete': { file: 'OverviewPage.tsx', match: 'delete-server' },
  'setup/home/index.twig#submit': { file: 'OverviewPage.tsx', match: "t('New server')" },
  'setup/home/index.twig#DefaultLang': 'OverviewPage.tsx',
  'setup/home/index.twig#ServerDefault': 'OverviewPage.tsx',
  'setup/home/index.twig#eol': 'OverviewPage.tsx',
  'setup/home/index.twig#link:Documentation': { file: 'OverviewPage.tsx', match: 'b_help' },
  'setup/home/index.twig#submit_display': 'OverviewPage.tsx',
  'setup/home/index.twig#submit_download': 'OverviewPage.tsx',
  'setup/home/index.twig#submit_clear': 'OverviewPage.tsx',
  'setup/home/index.twig#link:Check for latest version': 'OverviewPage.tsx',
  // X33: the project's homepage
  'setup/home/index.twig#link:phpMyAdmin homepage': {
    file: 'OverviewPage.tsx',
    match: 'BetterMyAdmin homepage',
  },
  'setup/error.twig#link:Try to revert erroneous fields to their default values': 'SetupForms.tsx',
  'setup/error.twig#link:Ignore errors': 'SetupForms.tsx',
  'setup/error.twig#link:Show form': 'SetupForms.tsx',
  'setup/config/index.twig#textconfig': 'ConfigPage.tsx',
  'setup/config/index.twig#submit_download': 'ConfigPage.tsx',
  'config/form_display/input.twig#*-userprefs-allow': {
    file: '../preferences/ConfigForm.tsx',
    match: 'userprefs-allow',
  },
} as const
