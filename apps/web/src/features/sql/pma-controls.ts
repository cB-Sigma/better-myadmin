/**
 * phpMyAdmin controls implemented in this folder (parity registry, read statically by tools/parity;
 * see docs/architecture/12-project-structure-and-conventions.md "Parity markers").
 */
export const pmaControls = {
  // pma: resources/templates/sql/query.twig — the query box
  'sql/query.twig#sql_query': 'SqlPage.tsx',
  'sql/query.twig#id:selectall': 'SqlPage.tsx',
  'sql/query.twig#id:select': { file: 'SqlPage.tsx', match: 'id="select"' },
  'sql/query.twig#id:insert': { file: 'SqlPage.tsx', match: 'id="insert"' },
  'sql/query.twig#id:update': { file: 'SqlPage.tsx', match: 'id="update"' },
  'sql/query.twig#id:delete': { file: 'SqlPage.tsx', match: 'id="delete"' },
  'sql/query.twig#id:clear': 'SqlPage.tsx',
  'sql/query.twig#id:format': { file: 'SqlPage.tsx', match: 'id="format"' },
  'sql/query.twig#id:formatSingleLine': 'SqlPage.tsx',
  'sql/query.twig#id:saved': 'SqlPage.tsx',
  'sql/query.twig#parameterized': 'SqlPage.tsx',
  'sql/query.twig#dummy': 'SqlPage.tsx',
  'sql/query.twig#insert': { file: 'SqlPage.tsx', match: 'insertBtn' },
  // the "Bookmark this SQL query:" fields of the box
  'sql/query.twig#bkm_label': 'SqlPage.tsx',
  'sql/query.twig#bkm_all_users': { file: 'SqlPage.tsx', match: 'id_bkm_all_users' },
  'sql/query.twig#bkm_replace': { file: 'SqlPage.tsx', match: 'id_bkm_replace' },
  // the footer
  'sql/query.twig#sql_delimiter': 'SqlPage.tsx',
  'sql/query.twig#show_query': 'SqlPage.tsx',
  'sql/query.twig#retain_query_box': 'SqlPage.tsx',
  'sql/query.twig#rollback_query': 'SqlPage.tsx',
  'sql/query.twig#fk_checks': 'SqlPage.tsx',
  'sql/query.twig#SQL': { file: 'SqlPage.tsx', match: 'button_submit_query' },
  // "Bookmarked SQL query"
  'sql/query.twig#id_bookmark': 'BookmarkedQuery.tsx',
  'sql/query.twig#action_bookmark': 'BookmarkedQuery.tsx',
  // #simulateDmlModal
  'sql/query.twig#button:Close': { file: 'SimulateModal.tsx', match: 'onClose' },
  // pma: resources/js/sql.ts
  'js:sql.ts#ajax:POST /database/sql/format': { file: 'SqlPage.tsx', match: 'api.sqlFormat' },
  'js:sql.ts#ajax:POST /import/simulate-dml': { file: 'SqlPage.tsx', match: 'api.simulate' },
  "js:sql.ts#ajax:POST <$form.attr('action')>": {
    file: 'SqlPage.tsx',
    match: 'runQuery(server, { fromQueryBox: true, grid: true, ...req }',
  },
  'js:sql.ts#submit:#sqlqueryform.ajax': { file: 'SqlPage.tsx', match: 'onSubmit={submit}' },
  'js:sql.ts#alert:strFormEmpty': { file: 'SqlPage.tsx', match: 'window.alert(t(FORM_EMPTY))' },
  'js:sql.ts#change:#id_bookmark': { file: 'BookmarkedQuery.tsx', match: 'bookmarkVariables' },
  'js:sql.ts#keypress:input[name=bookmark_variable]': {
    file: 'BookmarkedQuery.tsx',
    match: "if (e.key === 'Enter')",
  },
  'js:sql.ts#change:<window.codeMirrorEditor>': { file: 'SqlPage.tsx', match: 'autoSave(db, table, v)' },
  'js:sql.ts#input:#sqlquery': { file: 'SqlPage.tsx', match: 'autoSave(db, table, v)' },
  'js:sql.ts#propertychange:#sqlquery': { file: 'SqlPage.tsx', match: 'autoSave(db, table, v)' },
  'js:sql.ts#click:#button_submit_query': {
    file: 'SqlPage.tsx',
    match: 'rememberShowThisQuery(showQuery, db, table, sql)',
  },
  'js:sql.ts#click:#insertBtn': { file: 'SqlPage.tsx', match: 'insertValueText(selectedColumns)' },
  'js:sql.ts#dblclick:#fieldsSelect': { file: 'SqlPage.tsx', match: 'onDoubleClick={' },
  'js:sql.ts#click:#simulate_dml': { file: 'SqlPage.tsx', match: 'onSimulate' },
  'js:sql.ts#keyup:#sqlqueryform': { file: 'SqlPage.tsx', match: 'canSimulate(text)' },
  'js:sql.ts#shown:<modal>': { file: 'SimulateModal.tsx', match: '<HighlightedSql sql={d.sqlQuery}' },
  'js:sql.ts#click:#sqlquery': { file: 'SqlPage.tsx', match: 'autoSelect={s.TextareaAutoSelect}' },
  'js:sql.ts#click:#view_as': { file: '../table/view/ViewForm.tsx', match: 'autoSelect' },
  'js:sql.ts#click:#togglequerybox': { file: 'SqlPage.tsx', match: 'togglequerybox' },
  'js:sql.ts#click:input.sqlbutton': { file: 'SqlPage.tsx', match: "snippet('selectall')" },
  'js:sql.ts#input:input#bkm_label': { file: 'SqlPage.tsx', match: 'bkmLabel.length > 0' },
  'js:sql.ts#makeGrid:.sqlqueryresults': { file: '../browse/ResultsView.tsx', match: 'GridTable' },
  "js:sql.ts#ajax:POST <$(this).attr('action')>": {
    file: '../browse/ResultsView.tsx',
    match: 'bookmarkApi.create',
  },
  'js:sql.ts#ajax:POST <url>': { file: '../browse/ResultsView.tsx', match: 'api.deleteRows' },
  "js:sql.ts#ajax:POST <$thisA.attr('href')>": {
    file: '../insert-edit/ForeignBrowser.tsx',
    match: 'api.browseForeigners',
  },
  'js:sql.ts#ajax:POST …&ajax_request=1': { file: '../insert-edit/ForeignBrowser.tsx', match: 'setApplied(' },
  'js:sql.ts#click:<formId>': { file: '../insert-edit/ForeignBrowser.tsx', match: 'showAll: true' },
}
