/**
 * phpMyAdmin template controls and JS behaviours implemented by the user preferences feature
 * (docs/architecture/12, tools/parity/inventory/controls.json / js.json keys → component files).
 */
export const pmaControls = {
  // Settings forms (FormDisplay)
  'config/form_display/display.twig#submit_save': 'ConfigForm.tsx',
  'config/form_display/display.twig#submit_reset': 'ConfigForm.tsx',
  'config/form_display/input.twig#link:Documentation': 'ConfigForm.tsx',
  'config/form_display/input.twig#text:L27': { file: 'ConfigForm.tsx', match: "case 'text':" },
  'config/form_display/input.twig#password:L29': { file: 'ConfigForm.tsx', match: "case 'password':" },
  'config/form_display/input.twig#text:L32': { file: 'ConfigForm.tsx', match: "case 'short_text':" },
  'config/form_display/input.twig#number:L34': { file: 'ConfigForm.tsx', match: 'type="number"' },
  'config/form_display/input.twig#checkbox:L37': { file: 'ConfigForm.tsx', match: "case 'checkbox':" },
  'config/form_display/input.twig#select:L40': { file: 'ConfigForm.tsx', match: "case 'select':" },
  'config/form_display/input.twig#textarea:L47': { file: 'ConfigForm.tsx', match: "case 'list':" },
  'config/form_display/input.twig#link:Set value: %s': 'ConfigForm.tsx',
  'config/form_display/input.twig#link:Restore default value': 'ConfigForm.tsx',
  // header, Manage, autoload
  'preferences/header.twig#link:Manage your settings': 'PrefsHeader.tsx',
  'preferences/header.twig#link:Two-factor authentication': 'PrefsHeader.tsx',
  'preferences/header.twig#link:Features': 'PrefsHeader.tsx',
  'preferences/header.twig#link:SQL queries': 'PrefsHeader.tsx',
  'preferences/header.twig#link:Navigation panel': 'PrefsHeader.tsx',
  'preferences/header.twig#link:Main panel': 'PrefsHeader.tsx',
  'preferences/header.twig#link:Export': 'PrefsHeader.tsx',
  'preferences/header.twig#link:Import': 'PrefsHeader.tsx',
  'preferences/manage/main.twig#import_type': 'ManagePage.tsx',
  'preferences/manage/main.twig#import_file': 'ManagePage.tsx',
  'preferences/manage/main.twig#import_merge': 'ManagePage.tsx',
  'preferences/manage/main.twig#submit_import': 'ManagePage.tsx',
  'preferences/manage/main.twig#export_type': 'ManagePage.tsx',
  'preferences/manage/main.twig#submit_export': 'ManagePage.tsx',
  'preferences/manage/main.twig#submit_clear': 'ManagePage.tsx',
  'preferences/manage/error.twig#submit_import': 'ManagePage.tsx',
  'preferences/manage/error.twig#submit_ignore': 'ManagePage.tsx',
  'preferences/autoload.twig#link:Yes': 'AutoloadBanner.tsx',
  'preferences/autoload.twig#link:No': 'AutoloadBanner.tsx',
  'preferences/autoload.twig#link:Delete settings': 'AutoloadBanner.tsx',
  // Two-factor authentication
  'preferences/two_factor/main.twig#2fa_remove': 'TwoFactorPage.tsx',
  'preferences/two_factor/main.twig#2fa_configure': 'TwoFactorPage.tsx',
  'preferences/two_factor/main.twig#submit:Configure two-factor authentication': 'TwoFactorPage.tsx',
  'preferences/two_factor/configure.twig#submit:Enable two-factor authentication': 'TwoFactorPage.tsx',
  'preferences/two_factor/confirm.twig#submit:Disable two-factor authentication': 'TwoFactorPage.tsx',
  'login/twofactor.twig#submit:Verify': 'TwoFactorLogin.tsx',
  'login/twofactor/application.twig#2fa_code': 'TwoFactorForm.tsx',
  'login/twofactor/application_configure.twig#2fa_code': 'TwoFactorForm.tsx',
  // JS behaviours (resources/js/modules/config.ts, page_settings.ts)
  'js:modules/config.ts#change:<$el>': { file: 'ConfigForm.tsx', match: 'state.change(' },
  'js:modules/config.ts#keyup:<$el>': { file: 'configForm.ts', match: 'isKeyUp' },
  'js:modules/config.ts#click:.optbox input[type=button][name=submit_reset]': {
    file: 'ConfigForm.tsx',
    match: 'onClick={state.revalidate}',
  },
  'js:modules/config.ts#click:div.tab-content .restore-default, .set-value': {
    file: 'ConfigForm.tsx',
    match: 'restoredValue(field)',
  },
  'js:modules/config.ts#mouseenter:div.tab-content .restore-default, .set-value': {
    file: 'ConfigForm.tsx',
    match: 'hover:opacity-100',
  },
  'js:modules/config.ts#mouseleave:div.tab-content .restore-default, .set-value': {
    file: 'ConfigForm.tsx',
    match: 'opacity-25',
  },
  'js:modules/config.ts#ajax:POST /preferences/manage': {
    file: 'ManagePage.tsx',
    match: 'api.preferencesJson',
  },
  'js:modules/config.ts#ajax:POST index.php': {
    file: 'AutoloadBanner.tsx',
    match: 'api.hidePreferencesAutoload',
  },
  'js:modules/config.ts#change:form.prefs-form': { file: 'ManagePage.tsx', match: 'submitDisabled' },
  'js:modules/config.ts#click:<$cnt> a': { file: 'AutoloadBanner.tsx', match: 'load.mutate' },
  'js:modules/config.ts#click:<$radios>': { file: 'ManagePage.tsx', match: "setType('local_storage')" },
  'js:modules/config.ts#click:div.click-hide-message': {
    file: 'ManagePage.tsx',
    match: 'click-hide-message',
  },
  'js:modules/config.ts#submit:form.prefs-form': { file: 'ManagePage.tsx', match: 'toStorage.mutate' },
  'js:modules/page_settings.ts#click:#page_settings_icon': {
    file: '../shell/page-chrome.tsx',
    match: 'page_settings_icon',
  },
  'js:modules/page_settings.ts#click:#pageSettingsModalApplyButton': {
    file: '../shell/page-chrome.tsx',
    match: 'pageSettingsModalApplyButton',
  },
  'js:modules/page_settings.ts#click:#pageSettingsModalCloseButton,#pageSettingsModalCancelButton': {
    file: '../shell/page-chrome.tsx',
    match: 'pageSettingsModalCancelButton',
  },
  'js:modules/page_settings.ts#click:#pma_navigation_settings_icon': {
    file: '../navigation/NavigationPanel.tsx',
    match: 'pma_navigation_settings_icon',
  },
} as const
