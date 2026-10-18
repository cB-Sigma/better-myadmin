/**
 * phpMyAdmin controls implemented in this folder (parity registry, read statically by tools/parity;
 * see docs/architecture/12-project-structure-and-conventions.md 'Parity markers').
 * pma: resources/templates/table/search/index.twig, resources/templates/table/search/column_comparison_operators.twig, resources/templates/table/search/input_box.twig, resources/templates/table/zoom_search/index.twig, resources/templates/table/zoom_search/result_form.twig, resources/templates/table/find_replace/index.twig, resources/templates/table/find_replace/replace_preview.twig
 */
export const pmaControls = {
  'table/find_replace/index.twig#link:Table search': 'SearchPills.tsx',
  'table/find_replace/index.twig#link:Zoom search': 'SearchPills.tsx',
  'table/find_replace/index.twig#link:Find and replace': 'FindReplacePage.tsx',
  'table/find_replace/index.twig#find': 'FindReplacePage.tsx',
  'table/find_replace/index.twig#replaceWith': 'FindReplacePage.tsx',
  'table/find_replace/index.twig#columnIndex': 'FindReplacePage.tsx',
  'table/find_replace/index.twig#useRegex': 'FindReplacePage.tsx',
  'table/find_replace/index.twig#submit': 'FindReplacePage.tsx',
  'table/find_replace/replace_preview.twig#replace': 'FindReplacePage.tsx',
  'table/search/column_comparison_operators.twig#criteriaColumnOperators[*]': {
    file: 'criteria.tsx',
    match: 'criteriaColumnOperators[',
  },
  'table/search/index.twig#link:Table search': 'SearchPills.tsx',
  'table/search/index.twig#link:Zoom search': 'SearchPills.tsx',
  'table/search/index.twig#link:Find and replace': 'FindReplacePage.tsx',
  'table/search/index.twig#geom_func[*]': { file: 'SearchPage.tsx', match: 'geom_func[' },
  'table/search/index.twig#button:Extra options': 'SearchPage.tsx',
  'table/search/index.twig#columnsToDisplay[]': 'SearchPage.tsx',
  'table/search/index.twig#distinct': 'SearchPage.tsx',
  'table/search/index.twig#customWhereClause': 'SearchPage.tsx',
  'table/search/index.twig#session_max_rows': 'SearchPage.tsx',
  'table/search/index.twig#orderByColumn': 'SearchPage.tsx',
  'table/search/index.twig#order': 'SearchPage.tsx',
  'table/search/index.twig#submit': 'FindReplacePage.tsx',
  'table/search/index.twig#button:Close': 'ZoomSearchPage.tsx',
  'table/search/index.twig#id:min_value': 'SearchPage.tsx',
  'table/search/index.twig#id:max_value': 'SearchPage.tsx',
  'table/search/index.twig#id:rangeSearchModalGo': 'FindReplacePage.tsx',
  'table/search/index.twig#button:Cancel': 'SearchPage.tsx',
  'table/search/input_box.twig#criteriaValues[*]': { file: 'criteria.tsx', match: 'criteriaValues[' },
  'table/zoom_search/index.twig#link:Table search': 'SearchPills.tsx',
  'table/zoom_search/index.twig#link:Zoom search': 'SearchPills.tsx',
  'table/zoom_search/index.twig#link:Find and replace': 'FindReplacePage.tsx',
  'table/zoom_search/index.twig#criteriaColumnNames[]': 'ZoomSearchPage.tsx',
  'table/zoom_search/index.twig#dataLabel': 'ZoomSearchPage.tsx',
  'table/zoom_search/index.twig#maxPlotLimit': 'ZoomSearchPage.tsx',
  'table/zoom_search/index.twig#zoom_submit': 'FindReplacePage.tsx',
  'table/zoom_search/result_form.twig#link:How to use': 'ZoomSearchPage.tsx',
  'table/zoom_search/result_form.twig#button:Reset zoom': 'ZoomSearchPage.tsx',
  'table/zoom_search/result_form.twig#button:Close': 'ZoomSearchPage.tsx',
  'table/zoom_search/result_form.twig#id:dataPointSaveButton': 'ZoomSearchPage.tsx',
  'js:table/select.ts#change:select.geom_func': 'SearchPage.tsx',
  'js:table/select.ts#change:select[name*="criteriaColumnOperators"]': 'SearchPage.tsx',
  'js:table/select.ts#submit:#tbl_search_form.ajax': 'SearchPage.tsx',
  'js:table/zoom_search.ts#change:#tableid_0': 'ZoomSearchPage.tsx',
  'js:table/zoom_search.ts#change:#tableid_1': 'ZoomSearchPage.tsx',
  'js:table/zoom_search.ts#change:#tableid_2': 'ZoomSearchPage.tsx',
  'js:table/zoom_search.ts#change:#tableid_3': 'ZoomSearchPage.tsx',
  'js:table/zoom_search.ts#click:#dataPointSaveButton': 'ZoomSearchPage.tsx',
  'js:table/zoom_search.ts#click:#help_dialog': 'ZoomSearchPage.tsx',
  'js:table/zoom_search.ts#click:#inputFormSubmitId': 'ZoomSearchPage.tsx',
  'js:table/zoom_search.ts#click:#togglesearchformlink': 'ZoomSearchPage.tsx',
  'js:table/find_replace.ts#click:#toggle_find': 'FindReplacePage.tsx',
  'js:table/find_replace.ts#submit:#find_replace_form': 'FindReplacePage.tsx',
  // pma: table/search/input_box.twig (foreignLink, GIS in the table search), zoom_search/result_form.twig
  'table/search/input_box.twig#link:Browse foreign values': 'criteria.tsx',
  'table/search/input_box.twig#button:Edit/Insert': 'criteria.tsx',
  'table/zoom_search/result_form.twig#criteriaColumnNullFlags[*]': {
    file: 'ZoomSearchPage.tsx',
    match: 'criteriaColumnNullFlags[${i}]',
  },
  // pma: resources/js — browser behaviours (js.json)
  'js:table/select.ts#ajax:POST /table/search': {
    file: 'SearchPage.tsx',
    match: 'api.tableSearchRange(scope, c.name)',
  },
  "js:table/select.ts#ajax:POST <$searchForm.attr('action')>": {
    file: 'SearchPage.tsx',
    match: 'api.tableSearch(scope, {',
  },
  'js:table/select.ts#change:<item>': {
    file: 'SearchPage.tsx',
    match: 'searchFieldError(c, r.operator, r.value)',
  },
  'js:table/select.ts#click:#rangeSearchModalGo': {
    file: 'SearchPage.tsx',
    match: 'id="rangeSearchModalGo"',
  },
  'js:table/select.ts#click:#togglesearchformlink': {
    file: 'SearchPage.tsx',
    match: 'setFormShown(!formShown)',
  },
  'js:table/select.ts#show.bs.modal:<gisEditorModal>': {
    file: 'criteria.tsx',
    match: "geomFunc === 'Envelope'",
  },
  'js:table/zoom_search.ts#ajax:POST /sql': {
    file: 'ZoomSearchPage.tsx',
    match: 'await runQuery(scope.server',
  },
  'js:table/zoom_search.ts#ajax:POST /table/zoom-search': {
    file: 'ZoomSearchPage.tsx',
    match: 'const setColumn = (i: number, name: string)',
  },
  'js:table/zoom_search.ts#change:<item>': {
    file: 'ZoomSearchPage.tsx',
    match: 'searchFieldError(col, r.c.operator, r.c.value)',
  },
  'js:table/zoom_search.ts#click:button.button-reset': {
    file: 'ZoomSearchPage.tsx',
    match: 'className="button-reset"',
  },
  'js:table/zoom_search.ts#keydown:#dataDisplay :input': {
    file: 'ZoomSearchPage.tsx',
    match: 'id="dataDisplay"',
  },
  "js:table/find_replace.ts#ajax:POST <findReplaceForm.attr('action')>": {
    file: 'FindReplacePage.tsx',
    match: 'api.tableFindReplacePreview(scope, req)',
  },
} as const
