/**
 * phpMyAdmin controls implemented in this folder (parity registry, read statically by tools/parity;
 * see docs/architecture/12-project-structure-and-conventions.md "Parity markers").
 */
export const pmaControls = {
  // pma: resources/templates/display/results/checkbox_and_links.twig
  'display/results/checkbox_and_links.twig#rows_to_delete[*]': {
    file: 'GridTable.tsx',
    match: 'rows_to_delete[',
  },
  // pma: resources/templates/display/results/table.twig (navigation bar)
  'display/results/table.twig#navig': 'ResultsView.tsx',
  'display/results/table.twig#submit:Save edited data': 'ResultsView.tsx',
  'display/results/table.twig#submit:Restore column order': 'ResultsView.tsx',
  'display/results/table.twig#session_max_rows': 'ResultsView.tsx',
  'display/results/table.twig#id:filterRows': 'ResultsView.tsx',
  'display/results/table.twig#sql_query': 'ResultsView.tsx',
  'src/Display/Results.php#pos': 'ResultsView.tsx',
  // display options form
  'display/results/table.twig#id:extraOptionsButton': 'ResultsView.tsx',
  'display/results/table.twig#pftext': 'ResultsView.tsx',
  'display/results/table.twig#relational_display': 'ResultsView.tsx',
  'display/results/table.twig#display_binary': 'ResultsView.tsx',
  'display/results/table.twig#display_blob': 'ResultsView.tsx',
  'display/results/table.twig#hide_transformation': 'ResultsView.tsx',
  'display/results/table.twig#geoOption': 'ResultsView.tsx',
  'display/results/table.twig#submit:Go': 'ResultsView.tsx',
  // With selected
  'display/results/table.twig#id:resultsForm_*_checkall': {
    file: 'ResultsView.tsx',
    match: 'resultsForm_grid_checkall',
  },
  'display/results/table.twig#submit_mult': 'ResultsView.tsx',
  // Query results operations
  'display/results/table.twig#button:Print': 'ResultsView.tsx',
  'display/results/table.twig#link:Copy to clipboard': 'ResultsView.tsx',
  'display/results/table.twig#link:Export': 'ResultsView.tsx',
  'display/results/table.twig#link:Display chart': 'ResultsView.tsx',
  'display/results/table.twig#link:Visualize GIS data': 'ResultsView.tsx',
  'display/results/table.twig#link:Create view': 'ResultsView.tsx',
  // pma: resources/templates/sql/_bookmark.twig
  'sql/_bookmark.twig#bkm_fields[bkm_label]': 'ResultsView.tsx',
  'sql/_bookmark.twig#bkm_all_users': 'ResultsView.tsx',
  'sql/_bookmark.twig#submit:Create new bookmark': 'ResultsView.tsx',
  // pma: resources/templates/table/delete/confirm.twig
  'table/delete/confirm.twig#fk_checks': 'ResultsView.tsx',
  'table/delete/confirm.twig#mult_btn': 'ResultsView.tsx',
  // phpMyAdmin JS behaviours: resources/js/makegrid.ts
  'js:makegrid.ts#ajax:POST /sql': 'GridTable.tsx',
  'js:makegrid.ts#ajax:POST /sql/get-enum-values': 'GridTable.tsx',
  'js:makegrid.ts#ajax:POST /sql/get-relational-values': 'GridTable.tsx',
  'js:makegrid.ts#ajax:POST /sql/get-set-values': 'GridTable.tsx',
  'js:makegrid.ts#ajax:POST /sql/set-column-preferences': 'GridTable.tsx',
  'js:makegrid.ts#ajax:POST /table/replace': 'GridTable.tsx',
  'js:makegrid.ts#alert:<g.alertNonUnique>': 'GridTable.tsx',
  'js:makegrid.ts#beforeunload:window': 'GridTable.tsx',
  'js:makegrid.ts#change:<$editArea> select': 'GridTable.tsx',
  'js:makegrid.ts#click:<g.t> td.data.click1': 'GridTable.tsx',
  'js:makegrid.ts#dblclick:<g.t> td.data.click2': 'GridTable.tsx',
  'js:makegrid.ts#dblclick:<g.t> th.draggable': 'GridTable.tsx',
  'js:makegrid.ts#mousedown:<g.t> th.draggable': 'GridTable.tsx',
  'js:makegrid.ts#click:<showAll>': 'GridTable.tsx',
  'js:makegrid.ts#click:<listElmt>': 'GridTable.tsx',
  'js:makegrid.ts#keydown:<g.cEditStd> .edit_box, select': 'GridTable.tsx',
  'js:makegrid.ts#keydown:<g.cEditTextarea> .edit_box, select': 'GridTable.tsx',
  'js:makegrid.ts#mousedown:document': 'GridTable.tsx',
  'js:makegrid.ts#click:<g.o> div.restore_column': 'ResultsView.tsx',
  'js:makegrid.ts#click:<g.o> div.save_edited': 'ResultsView.tsx',
  // resources/js/multi_column_sort.ts
  'js:multi_column_sort.ts#click:th.draggable.column_heading.pointer.marker a': 'GridTable.tsx',
  'js:multi_column_sort.ts#ajax:POST /sql': 'GridTable.tsx',
  // resources/js/sql.ts
  'js:sql.ts#click:.sortlink': 'GridTable.tsx',
  'js:sql.ts#click:th.column_heading.marker': 'GridTable.tsx',
  'js:sql.ts#mouseenter:th.column_heading.pointer': 'GridTable.tsx',
  'js:sql.ts#mouseleave:th.column_heading.pointer': 'GridTable.tsx',
  'js:sql.ts#click:a.delete_row.ajax': 'GridTable.tsx',
  'js:sql.ts#confirm:strDoYouReally': 'ResultsView.tsx',
  'js:sql.ts#confirm:strShowAllRowsWarning': 'ResultsView.tsx',
  'js:sql.ts#click:.navigation .showAllRows': 'ResultsView.tsx',
  'js:sql.ts#change:select[name="sql_query"]': 'ResultsView.tsx',
  'js:sql.ts#click:#copyToClipBoard': 'ResultsView.tsx',
  'js:sql.ts#alert:Sorry! Unable to copy': 'ResultsView.tsx',
  'js:sql.ts#keyup:.filter_rows': 'ResultsView.tsx',
  'js:sql.ts#submit:.maxRowsForm': 'ResultsView.tsx',
  "js:sql.ts#submit:form[name='displayOptionsForm'].ajax": 'ResultsView.tsx',
  'js:sql.ts#submit:.bookmarkQueryForm': 'ResultsView.tsx',
  'js:sql.ts#click:form[name="resultsForm"].ajax button[name="submit_mult"], form[name="resultsForm"].ajax input[name="submit_mult"]':
    'ResultsView.tsx',
  // pma: resources/js/modules/functions.ts (sort links), functions/event-loader.ts (create view)
  'js:modules/functions.ts#mouseover:.sortlink': {
    file: 'GridTable.tsx',
    match: 'className="hidden group-hover:inline-flex"',
  },
  'js:modules/functions.ts#mouseout:.sortlink': {
    file: 'GridTable.tsx',
    match: 'className="inline-flex group-hover:hidden"',
  },
  'js:modules/functions/event-loader.ts#click:a.create_view.ajax': {
    file: 'ResultsView.tsx',
    match: 'className="create_view ajax"',
  },
}
