/**
 * phpMyAdmin controls implemented in this folder (parity registry, read statically by tools/parity;
 * see docs/architecture/12-project-structure-and-conventions.md "Parity markers").
 * Keys come from tools/parity/inventory/controls.json; values name the component that renders the
 * control, optionally with a string that must occur in it.
 */
export const pmaControls = {
  // pma: resources/templates/login/form.twig
  'login/form.twig#lang': 'LanguageSelect.tsx',
  'login/form.twig#pma_servername': 'LoginPage.tsx',
  'login/form.twig#pma_username': 'LoginPage.tsx',
  'login/form.twig#pma_password': 'LoginPage.tsx',
  'login/form.twig#server': 'LoginPage.tsx',
  'login/form.twig#id:input_go': 'LoginPage.tsx',
  // pma: resources/templates/home/index.twig ("Appearance settings")
  'home/index.twig#lang': { file: 'home/LanguageSlot.tsx', match: '<LanguageSelect' },
  // pma: resources/templates/menu/main.twig (breadcrumb + tabs)
  'menu/main.twig#link:Server:': 'Breadcrumb.tsx',
  'menu/main.twig#link:(current)': '../../../../../packages/ui/src/components/tab-bar.tsx',
  // pma: resources/js (error_report, home, main, modules/ajax, git-info, themes-manager, shortcuts_handler, functions)
  'js:error_report.ts#ajax:POST /error-report': {
    file: 'errors/ErrorReporting.tsx',
    match: 'send_error_report: true',
  },
  'js:error_report.ts#click:#errorReportModalConfirm': {
    file: 'errors/ErrorReporting.tsx',
    match: 'id="errorReportModalConfirm"',
  },
  'js:error_report.ts#click:#ignore_error_…': {
    file: 'errors/ErrorReporting.tsx',
    match: 'id={`ignore_error_${n.key}`}',
  },
  'js:error_report.ts#click:#show_error_report_…': {
    file: 'errors/ErrorReporting.tsx',
    match: 'id={`show_error_report_${n.key}`}',
  },
  'js:error_report.ts#show:<$errorReportModal>': {
    file: 'errors/ErrorReporting.tsx',
    match: 'id="errorReportModal"',
  },
  'js:home.ts#show.bs.modal:<themesModal>': { file: 'themes/ThemeCards.tsx', match: 'id="themesModal"' },
  'js:main.ts#ajaxError:document': { file: 'session/RequestErrors.tsx', match: 'REQUEST_FAILED_EVENT' },
  'js:main.ts#change:<themeColorModeToggle>': { file: 'UserMenu.tsx', match: 'id="themeColorModeToggle"' },
  'js:main.ts#click:a': { file: '../../main.tsx', match: '<RouterProvider router={router} />' },
  'js:main.ts#submit:form': { file: '../../lib/api.ts', match: 'export async function call<T>(' },
  'js:modules/ajax.ts#ajax:GET <url>': { file: '../../lib/api.ts', match: 'export async function call<T>(' },
  'js:modules/ajax.ts#ajax:POST <url>': { file: '../../lib/api.ts', match: 'export async function call<T>(' },
  'js:modules/ajax.ts#change:<$pageContent> form.lock-page input[type="checkbox"], form.lock-page input[type="radio"]':
    { file: 'page-chrome.tsx', match: "form.addEventListener('change', onChange)" },
  'js:modules/ajax.ts#change:<$pageContent> form.lock-page textarea, form.lock-page input[type="text"], form.lock-page input[type="number"], form.lock-page select':
    { file: 'page-chrome.tsx', match: "form.addEventListener('change', onChange)" },
  'js:modules/ajax.ts#keyup:<$pageContent> form.lock-page textarea, form.lock-page input[type="text"], form.lock-page input[type="number"], form.lock-page select':
    { file: 'page-chrome.tsx', match: "form.addEventListener('focusin', remember)" },
  'js:modules/ajax.ts#reset:form.lock-page': {
    file: 'page-chrome.tsx',
    match: "form.addEventListener('reset', release)",
  },
  'js:modules/ajax.ts#confirm:strConfirmNavigation': {
    file: 'page-chrome.tsx',
    match: "window.confirm(t('You have unsaved changes; are you sure you want to leave this page?'))",
  },
  'js:modules/ajax.ts#click:a': { file: '../../main.tsx', match: 'createRouter({' },
  'js:modules/ajax.ts#submit:form': {
    file: 'page-chrome.tsx',
    match: "form.addEventListener('submit', release)",
  },
  'js:modules/ajax.ts#popstate:window': { file: '../../main.tsx', match: 'createRouter({' },
  'js:modules/git-info.ts#ajax:GET /git-revision': { file: 'HomePage.tsx', match: 'id="li_pma_version_git"' },
  'js:modules/git-info.ts#ajax:POST /version-check': {
    file: 'home/VersionInfo.tsx',
    match: 'queryFn: api.versionCheck',
  },
  'js:modules/themes-manager.ts#ajax:GET /themes': {
    file: 'themes/ThemeCards.tsx',
    match: 'THEMES.map((theme) =>',
  },
  'js:modules/themes-manager.ts#ajax:POST <toggleForm.action>': {
    file: 'theme/theme.ts',
    match: 'void api.themeSet(o.server, theme)',
  },
  'js:shortcuts_handler.ts#keydown:document': {
    file: 'hotkeys/useShortcuts.tsx',
    match: "document.addEventListener('keydown', onDown)",
  },
  'js:shortcuts_handler.ts#keyup:document': {
    file: 'hotkeys/useShortcuts.tsx',
    match: "document.addEventListener('keyup', onUp)",
  },
  'js:modules/functions.ts#ajax:POST <href>': {
    file: 'session/IdleCheck.tsx',
    match: 'api.checkTimeout({ guid, access_time: idle.current })',
  },
  'js:modules/functions.ts#mousemove:document': {
    file: 'session/IdleCheck.tsx',
    match: "document.addEventListener('mousemove', reset)",
  },
  'js:modules/functions.ts#click:.logout': { file: 'UserMenu.tsx', match: 'sessionStorage.clear()' },
  'js:modules/functions.ts#click:#change_password_anchor.ajax': {
    file: 'HomePage.tsx',
    match: 'id="change_password_anchor"',
  },
  'js:modules/functions.ts#click:#changePasswordGoButton': {
    file: 'home/ChangePasswordDialog.tsx',
    match: 'id="changePasswordGoButton"',
  },
  "js:modules/functions.ts#ajax:GET <$(this).attr('href')>": {
    file: 'home/ChangePasswordDialog.tsx',
    match: 'queryFn: () => api.passwordForm(props.server)',
  },
  "js:modules/functions.ts#ajax:POST <$theForm.attr('action')>": {
    file: 'home/ChangePasswordDialog.tsx',
    match: 'await api.changePassword(props.server, {',
  },
  'js:modules/functions.ts#alert:strPasswordEmpty+strPasswordNotSame': {
    file: 'home/ChangePasswordDialog.tsx',
    match: 'window.alert(t(invalid))',
  },
  'js:modules/functions.ts#confirm:strPasswordEmptyWhenAllowNoPasswordIsEnabled': {
    file: 'home/ChangePasswordDialog.tsx',
    match: 't(EMPTY_WITH_ALLOW_NO_PASSWORD_OFF)',
  },
  'js:modules/functions.ts#click:#server-breadcrumb, #goto_pagetop': {
    file: 'page-chrome.tsx',
    match: 'id="goto_pagetop"',
  },
  'js:modules/functions.ts#mousedown:span.ajax_notification.dismissable': {
    file: '../../../../../packages/ui/src/components/toaster-impl.tsx',
    match: 'down.current = Date.now()',
  },
  'js:modules/functions.ts#mouseup:span.ajax_notification.dismissable': {
    file: '../../../../../packages/ui/src/components/toaster-impl.tsx',
    match: 'Date.now() - down.current < DISMISS_CLICK_MS',
  },
  'js:modules/functions.ts#mouseover:span.ajax_notification.dismissable a': {
    file: '../../../../../packages/ui/src/components/toaster-impl.tsx',
    match: 'gettext(EDIT_QUERY)',
  },
  'js:modules/functions.ts#mouseleave:span.ajax_notification.dismissable a': {
    file: '../../../../../packages/ui/src/components/toaster-impl.tsx',
    match: 'onMouseLeave={() => setLinkTitle(null)}',
  },
  'js:modules/functions.ts#mouseup:.ajax_notification a': {
    file: '../../../../../packages/ui/src/components/toaster-impl.tsx',
    match: "e.target.closest('a') !== null",
  },
  'js:modules/functions.ts#resize:window': {
    file: '../../../../../packages/ui/src/components/tab-bar.tsx',
    match: 'new ResizeObserver(() => recompute())',
  },
  'js:modules/functions.ts#click:div.toggle-container': {
    file: '../../../../../packages/ui/src/components/toggle-button.tsx',
    match: "'toggle-container absolute top-0 flex",
  },
  'js:modules/functions.ts#ajax:POST <parts[0]>': {
    file: '../database/TrackingPage.tsx',
    match: "action: 'toggle',",
  },
  'js:modules/functions.ts#load:this': {
    file: '../../../../../packages/ui/src/components/toggle-button.tsx',
    match: 'setPart((partRef.current?.offsetWidth ?? 0) + 2)',
  },
  'js:modules/functions/event-loader.ts#change:select#select_authentication_plugin_cp': {
    file: 'home/ChangePasswordDialog.tsx',
    match: "plugin === 'sha256_password'",
  },
  'js:modules/functions/event-loader.ts#keydown:form input, form textarea, form select': {
    file: 'hotkeys/useShortcuts.tsx',
    match: 'form.requestSubmit()',
  },
  'js:modules/functions/event-loader.ts#change:.autosubmit': {
    file: 'HomePage.tsx',
    match: 'className="autosubmit"',
  },
  'js:modules/functions/event-loader.ts#click:<item>': {
    file: 'HomePage.tsx',
    match: 'className="autosubmit"',
  },
  // pma: resources/js/modules/functions.ts (confirm dialog, shift-click ranges)
  'js:modules/functions.ts#click:<functionConfirmOkButton>': {
    file: '../../../../../packages/ui/src/components/confirm-dialog.tsx',
    match: 'id="functionConfirmOkButton"',
  },
  'js:modules/functions/event-loader.ts#click:input:checkbox.checkall': {
    file: 'session/CheckAllRanges.tsx',
    match: 'lastShiftClickedRow = curr',
  },
  // pma: resources/templates/base.twig, home/index.twig, home/themes.twig, error/report_*.twig, menu/main.twig
  'base.twig#button:Open user account menu': {
    file: 'UserMenu.tsx',
    match: "title={t('Open user account menu')}",
  },
  'base.twig#link:Click on the bar to scroll to top of page': {
    file: 'page-chrome.tsx',
    match: 'id="goto_pagetop"',
  },
  'base.twig#link:Log out': { file: 'UserMenu.tsx', match: "text={t('Log out')}" },
  'base.twig#link:MariaDB documentation': { file: 'UserMenu.tsx', match: "t('MariaDB documentation')" },
  'base.twig#link:Open new phpMyAdmin window': { file: 'layout/ShellLayout.tsx', match: 'id="selflink"' },
  'base.twig#link:phpMyAdmin Demo Server': {
    file: 'session/DemoNotice.tsx',
    match: "tProduct('phpMyAdmin Demo Server')",
  },
  'base.twig#link:phpMyAdmin documentation': { file: 'UserMenu.tsx', match: "t('phpMyAdmin documentation')" },
  'base.twig#link:Settings': { file: 'UserMenu.tsx', match: "text={t('Settings')}" },
  'base.twig#themeColorMode': { file: 'UserMenu.tsx', match: 'name="themeColorMode"' },
  'error/report_form.twig#always_send': {
    file: 'errors/ErrorReporting.tsx',
    match: 'id="errorReportAlwaysSendCheckbox"',
  },
  'error/report_form.twig#description': {
    file: 'errors/ErrorReporting.tsx',
    match: 'id="errorReportDescription"',
  },
  'error/report_modal.twig#button:Cancel': {
    file: 'errors/ErrorReporting.tsx',
    match: "<Button onClick={props.onClose}>{t('Cancel')}</Button>",
  },
  'error/report_modal.twig#button:Close': { file: 'errors/ErrorReporting.tsx', match: "{t('Close')}" },
  'error/report_modal.twig#id:errorReportModalConfirm': {
    file: 'errors/ErrorReporting.tsx',
    match: 'id="errorReportModalConfirm"',
  },
  'home/index.twig#button:Close': { file: 'themes/ThemeCards.tsx', match: "{t('Close')}" },
  'home/index.twig#button:View all': {
    file: 'HomePage.tsx',
    match: "pgettext('View all themes', 'View all')",
  },
  'home/index.twig#collation_connection': { file: 'HomePage.tsx', match: 'name="collation_connection"' },
  'home/index.twig#link:Change password': { file: 'HomePage.tsx', match: 'id="change_password_anchor"' },
  'home/index.twig#link:Contribute': { file: 'HomePage.tsx', match: "{t('Contribute')}" },
  'home/index.twig#link:Documentation': { file: 'HomePage.tsx', match: "{t('Documentation')}" },
  'home/index.twig#link:Get support': { file: 'HomePage.tsx', match: "{t('Get support')}" },
  'home/index.twig#link:License': { file: 'HomePage.tsx', match: "{t('License')}" },
  'home/index.twig#link:List of changes': { file: 'HomePage.tsx', match: "{t('List of changes')}" },
  'home/index.twig#link:More settings': { file: 'HomePage.tsx', match: "text={t('More settings')}" },
  'home/index.twig#link:Official Homepage': { file: 'HomePage.tsx', match: "{t('Official Homepage')}" },
  'home/index.twig#set_theme': { file: 'HomePage.tsx', match: 'name="set_theme"' },
  'home/index.twig#themeColorMode': { file: 'HomePage.tsx', match: 'name="themeColorMode"' },
  'home/themes.twig#set_theme': { file: 'themes/ThemeCards.tsx', match: 'name="set_theme"' },
  'menu/main.twig#button:Toggle navigation': {
    file: '../../../../../packages/ui/src/components/tab-bar.tsx',
    match: "aria-label={gettext('Toggle navigation')}",
  },
  'menu/main.twig#link:Database:': { file: 'Breadcrumb.tsx', match: "t('Database:')" },
  'menu/main.twig#link:View:': { file: 'Breadcrumb.tsx', match: "t('View:')" },
  // pma: resources/templates/modals/change_password.twig (the form: server/privileges/change_password.twig)
  'modals/change_password.twig#id:changePasswordGoButton': 'home/ChangePasswordDialog.tsx',
  'modals/change_password.twig#button:Cancel': 'home/ChangePasswordDialog.tsx',
  // the corner button of DialogContent (closeLabel 'Close')
  'modals/change_password.twig#button:Close': {
    file: 'home/ChangePasswordDialog.tsx',
    match: 'id="changePasswordModal"',
  },
}
