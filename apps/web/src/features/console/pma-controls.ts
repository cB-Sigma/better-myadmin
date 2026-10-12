/**
 * phpMyAdmin controls implemented in this folder (parity registry, read statically by tools/parity;
 * see docs/architecture/12-project-structure-and-conventions.md "Parity markers").
 */
export const pmaControls = {
  // pma: resources/templates/console/display.twig — the "Add bookmark" card
  'console/display.twig#label': { file: 'Console.tsx', match: 'name="label"' },
  'console/display.twig#targetdb': 'Console.tsx',
  'console/display.twig#shared': { file: 'Console.tsx', match: 'name="shared"' },
  'console/display.twig#submit': { file: 'Console.tsx', match: 'name="submit"' },
  // the Options card
  'console/display.twig#always_expand': { file: 'Console.tsx', match: "'Always expand query messages'" },
  'console/display.twig#start_history': { file: 'Console.tsx', match: "'Show query history at start'" },
  'console/display.twig#current_query': { file: 'Console.tsx', match: "'Show current browsing query'" },
  'console/display.twig#enter_executes': {
    file: 'Console.tsx',
    match:
      "'Execute queries on Enter and insert new line with Shift+Enter. To make this permanent, view settings.'",
  },
  'console/display.twig#dark_theme': { file: 'Console.tsx', match: "'Switch to dark theme'" },
  // pma: resources/js/modules/console.ts, resources/js/modules/console/config.ts
  'js:modules/console.ts#ajax:GET /console/bookmark/refresh': {
    file: '../bookmarks/provider.ts',
    match: 'api.consoleBookmarks',
  },
  'js:modules/console.ts#ajax:POST /console/bookmark/add': {
    file: 'Console.tsx',
    match: 'bookmarkApi.consoleAdd',
  },
  'js:modules/console.ts#ajax:POST /import': { file: 'Console.tsx', match: 'void runQuery(' },
  'js:modules/console.ts#submit:<Console.$requestForm>': { file: 'Console.tsx', match: 'fromQueryBox: true' },
  'js:modules/console.ts#ajaxComplete:document': { file: 'Console.tsx', match: 'onQueryEvent((e) =>' },
  'js:modules/console.ts#ajaxSuccess:document': { file: 'Console.tsx', match: 'DEBUG_SQL_EVENT' },
  'js:modules/console.ts#alert:strFormEmpty': { file: 'Console.tsx', match: 'window.alert(t(FORM_EMPTY))' },
  'js:modules/console.ts#change:<consoleOptionsAlwaysExpandCheckbox>': {
    file: 'Console.tsx',
    match: "sw('AlwaysExpand'",
  },
  'js:modules/console.ts#change:<consoleOptionsCurrentQueryCheckbox>': {
    file: 'Console.tsx',
    match: "sw('CurrentQuery'",
  },
  'js:modules/console.ts#change:<consoleOptionsDarkThemeCheckbox>': {
    file: 'Console.tsx',
    match: "sw('DarkTheme'",
  },
  'js:modules/console.ts#change:<consoleOptionsEnterExecutesCheckbox>': {
    file: 'Console.tsx',
    match: "sw(\n          'EnterExecutes'",
  },
  'js:modules/console.ts#change:<consoleOptionsStartHistoryCheckbox>': {
    file: 'Console.tsx',
    match: "sw('StartHistory'",
  },
  'js:modules/console.ts#click:#debug_console .button.group_queries': {
    file: 'Console.tsx',
    match: "set('GroupQueries', true)",
  },
  'js:modules/console.ts#click:#debug_console .button.ungroup_queries': {
    file: 'Console.tsx',
    match: "set('GroupQueries', false)",
  },
  'js:modules/console.ts#click:#debug_console .button.order': {
    file: 'Console.tsx',
    match: "set('Order', 'asc')",
  },
  'js:modules/console.ts#click:#debug_console .button.order_by': {
    file: 'Console.tsx',
    match: "set('OrderBy', 'exec')",
  },
  'js:modules/console.ts#click:#debug_console .switch_button': {
    file: 'Console.tsx',
    match: "{t('Debug SQL')}",
  },
  'js:modules/console.ts#click:#pma_bookmarks .button.add': {
    file: 'Console.tsx',
    match: 'className="add rounded',
  },
  'js:modules/console.ts#click:#pma_bookmarks .card.add [name=submit]': {
    file: 'Console.tsx',
    match: 'name="submit"',
  },
  'js:modules/console.ts#click:#pma_bookmarks .switch_button': {
    file: 'Console.tsx',
    match: "{t('Bookmarks')}",
  },
  'js:modules/console.ts#click:#pma_console .button.bookmarks': {
    file: 'Console.tsx',
    match: "setCard('bookmarks')",
  },
  'js:modules/console.ts#click:#pma_console .button.clear': {
    file: 'Console.tsx',
    match: 'onClick={clearMessages}',
  },
  'js:modules/console.ts#click:#pma_console .button.debug': {
    file: 'Console.tsx',
    match: "setCard('debug')",
  },
  'js:modules/console.ts#click:#pma_console .button.history': {
    file: 'Console.tsx',
    match: '`history ${tb}`',
  },
  'js:modules/console.ts#click:#pma_console .button.options': {
    file: 'Console.tsx',
    match: "setCard('options')",
  },
  'js:modules/console.ts#click:#pma_console .button.refresh': {
    file: 'Console.tsx',
    match: 'className="refresh',
  },
  'js:modules/console.ts#click:#pma_console .mid_layer': { file: 'Console.tsx', match: 'mid_layer' },
  'js:modules/console.ts#click:#pma_console_options .switch_button': {
    file: 'Console.tsx',
    match: "{t('Options')}\n        </button>",
  },
  'js:modules/console.ts#click:<$targetMessage> .action.bookmark': {
    file: 'Console.tsx',
    match: 'onBookmark={() =>',
  },
  'js:modules/console.ts#click:<$targetMessage> .action.collapse': {
    file: 'Console.tsx',
    match: 'onToggle={(expanded) =>',
  },
  'js:modules/console.ts#click:<$targetMessage> .action.expand': {
    file: 'Console.tsx',
    match: 'onToggle={(expanded) =>',
  },
  'js:modules/console.ts#click:<$targetMessage> .action.delete_bookmark': {
    file: 'Console.tsx',
    match: 'CONSOLE_DELETE_BOOKMARK_CONFIRM)}',
  },
  'js:modules/console.ts#click:<$targetMessage> .action.edit': {
    file: 'Console.tsx',
    match: 'onEdit={() =>',
  },
  'js:modules/console.ts#click:<$targetMessage> .action.edit_bookmark': {
    file: 'Console.tsx',
    match: 'setAdd({ label: b.label',
  },
  'js:modules/console.ts#click:<$targetMessage> .action.explain': {
    file: 'Console.tsx',
    match: 'onExplain={() =>',
  },
  'js:modules/console.ts#click:<$targetMessage> .action.profiling': {
    file: 'Console.tsx',
    match: 'onProfiling={() =>',
  },
  'js:modules/console.ts#click:<$targetMessage> .action.requery': {
    file: 'Console.tsx',
    match: 'onRequery={() =>',
  },
  'js:modules/console.ts#click:<Console.$consoleContent>': {
    file: 'Console.tsx',
    match: 'if (e.target === e.currentTarget) input.current?.focus()',
  },
  'js:modules/console.ts#click:<Console.$consoleToolbar> .console_switch': {
    file: 'Console.tsx',
    match: 'onClick={toggle}',
  },
  'js:modules/console.ts#click:<restoreConsoleOptionsButton>': {
    file: 'Console.tsx',
    match: "{t('Restore default values')}",
  },
  'js:modules/console.ts#confirm:strConsoleDeleteBookmarkConfirm': {
    file: 'Console.tsx',
    match: 't(CONSOLE_DELETE_BOOKMARK_CONFIRM)',
  },
  'js:modules/console.ts#confirm:strConsoleRequeryConfirm': {
    file: 'Console.tsx',
    match: 't(CONSOLE_REQUERY_CONFIRM)',
  },
  'js:modules/console.ts#inputRead:<ConsoleInput.inputs.bookmark>': {
    file: 'Console.tsx',
    match: 'onChange={editing.onInput}',
  },
  'js:modules/console.ts#inputRead:<ConsoleInput.inputs.console>': {
    file: 'Console.tsx',
    match: 'onChange={onInput}',
  },
  'js:modules/console.ts#key:Ctrl-Space': {
    file: '../sql/editor/CodeMirrorEditor.tsx',
    match: "key: 'Ctrl-Space'",
  },
  'js:modules/console.ts#keydown:#pma_console .console_query_input': {
    file: 'Console.tsx',
    match: "key: 'Ctrl-l'",
  },
  'js:modules/console.ts#keydown:<ConsoleInput.inputs.console>': {
    file: 'Console.tsx',
    match: "{ key: 'ArrowUp', run: () => historyNavigate(true) }",
  },
  'js:modules/console.ts#keydown:<textarea>': {
    file: '../sql/editor/SqlEditor.tsx',
    match: 'for (const k of props.keys ?? [])',
  },
  'js:modules/console.ts#mousedown:#pma_console .toolbar': {
    file: 'Console.tsx',
    match: 'onMouseDown={onToolbarMouseDown}',
  },
  'js:modules/console.ts#mousemove:document': {
    file: 'Console.tsx',
    match: "addEventListener('mousemove', move)",
  },
  'js:modules/console.ts#mouseup:document': { file: 'Console.tsx', match: "addEventListener('mouseup', up)" },
  'js:modules/console.ts#selectstart:document': {
    file: 'Console.tsx',
    match: "addEventListener('selectstart', noSelect)",
  },
  'js:modules/console/config.ts#ajax:POST /console/update-config': {
    file: 'config.ts',
    match: 'api.consoleConfigUpdate',
  },
}
