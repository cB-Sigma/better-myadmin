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
  // pma: resources/js — browser behaviours (js.json)
  'js:makegrid.ts#change:<$editArea> span.curr_value': { file: 'GridTable.tsx', match: 'onPick={(key) => {' },
  'js:makegrid.ts#change:<g.cEdit> .edit_box': {
    file: 'GridTable.tsx',
    match: "if (e.target.value !== '') setNullChecked(false)",
  },
  'js:makegrid.ts#click:<$checkbox>': { file: 'GridTable.tsx', match: 'className="null_div"' },
  'js:makegrid.ts#click:<$editArea> .browse_foreign': {
    file: 'GridTable.tsx',
    match: 'className="browse_foreign h-auto p-0"',
  },
  'js:makegrid.ts#click:<$editArea> > *': {
    file: 'GridTable.tsx',
    match: 'onClick={(e) => e.stopPropagation()}',
  },
  'js:makegrid.ts#click:<cd>': { file: 'GridTable.tsx', match: 'className="coldrop ms-1"' },
  'js:makegrid.ts#click:<clone>': { file: 'GridTable.tsx', match: '{n > 10 && (' },
  'js:makegrid.ts#click:<g.t> td.data.click2': {
    file: 'GridTable.tsx',
    match: 'fkTimer.current = setTimeout(',
  },
  'js:makegrid.ts#click:html': {
    file: 'GridTable.tsx',
    match: "document.getElementById('browseForeignModal') !== null",
  },
  'js:makegrid.ts#click:this': { file: 'GridTable.tsx', match: 'actions.deleteRow(row)' },
  'js:makegrid.ts#copy:document': { file: 'GridTable.tsx', match: "document.addEventListener('copy', copy)" },
  'js:makegrid.ts#dblclick:<g.t> th.draggable a': {
    file: 'GridTable.tsx',
    match: 'onDoubleClick={(e) => e.stopPropagation()}',
  },
  'js:makegrid.ts#dragstart:<g.t> th a': {
    file: 'GridTable.tsx',
    match: 'onDragStart={() => setDragFrom(j)}',
  },
  'js:makegrid.ts#focus:<g.cEditStd> .edit_box': { file: 'GridTable.tsx', match: 'b.focus()' },
  'js:makegrid.ts#focus:<g.cEditTextarea> .edit_box': { file: 'GridTable.tsx', match: 'b.focus()' },
  'js:makegrid.ts#input:<g.cEdit> .edit_box': {
    file: 'GridTable.tsx',
    match: 'else if (!notNull) setNullChecked(true)',
  },
  'js:makegrid.ts#keydown:<$editArea> textarea': {
    file: 'GridTable.tsx',
    match: "props.edited && (hasClass(cell.cls, 'truncated')",
  },
  'js:makegrid.ts#keydown:<g.cEdit> .edit_box': {
    file: 'GridTable.tsx',
    match: "e.key.toLowerCase() === 'v'",
  },
  'js:makegrid.ts#keydown:<g.cEditStd> input.edit_box, select': {
    file: 'GridTable.tsx',
    match: 'props.onMove(dir, ...r)',
  },
  'js:makegrid.ts#keydown:<g.cEditStd>': { file: 'GridTable.tsx', match: '!textEditable' },
  'js:makegrid.ts#keydown:<g.cEditTextarea>': { file: 'GridTable.tsx', match: '!textEditable' },
  'js:makegrid.ts#keydown:<g.cEditTextarea> textarea.edit_box, select': {
    file: 'GridTable.tsx',
    match: 'props.onMove(dir, ...r)',
  },
  'js:makegrid.ts#keydown:document': { file: 'GridTable.tsx', match: "e.code === 'KeyA'" },
  'js:makegrid.ts#keydown:html': {
    file: 'GridTable.tsx',
    match: "document.getElementById('browseForeignModal') === null",
  },
  'js:makegrid.ts#keypress:<g.cEdit> .edit_box': {
    file: 'GridTable.tsx',
    match: "if (e.target.value !== '') setNullChecked(false)",
  },
  'js:makegrid.ts#keyup:<$editArea> textarea': {
    file: 'GridTable.tsx',
    match: "props.edited && (hasClass(cell.cls, 'truncated')",
  },
  'js:makegrid.ts#keyup:<$inputField>': { file: 'GridTable.tsx', match: '<DateTimePicker' },
  'js:makegrid.ts#keyup:<g.cEdit> .edit_box': {
    file: 'GridTable.tsx',
    match: "props.edited && (hasClass(cell.cls, 'truncated')",
  },
  'js:makegrid.ts#mousedown:<cb>': { file: 'GridTable.tsx', match: 'className={`colborder' },
  'js:makegrid.ts#mousedown:<g.t> td.data': {
    file: 'GridTable.tsx',
    match: 'startSelection(cur, r, j, multi)',
  },
  'js:makegrid.ts#mouseenter:<g.t> td, th.draggable': { file: 'GridTable.tsx', match: 'setColList(false)' },
  'js:makegrid.ts#mouseenter:<g.t> th.draggable': { file: 'GridTable.tsx', match: "' cursor-move'" },
  'js:makegrid.ts#mouseenter:<t> th.draggable a': {
    file: 'GridTable.tsx',
    match: 'className="sortlink group h-auto"',
  },
  'js:makegrid.ts#mouseleave:<g.t> td.data': {
    file: 'GridTable.tsx',
    match: 'window.getSelection()?.removeAllRanges()',
  },
  'js:makegrid.ts#mouseleave:<g.t> th.draggable': {
    file: 'GridTable.tsx',
    match: 'onMouseLeave={() => setHoverCol(null)}',
  },
  'js:makegrid.ts#mouseleave:<t> th.draggable a': {
    file: 'GridTable.tsx',
    match: 'className="sortlink group h-auto"',
  },
  'js:makegrid.ts#mousemove:document': {
    file: 'GridTable.tsx',
    match: "document.addEventListener('mousemove', move)",
  },
  'js:makegrid.ts#mouseover:<g.t> td.data, thead th:not(.column_action)': {
    file: 'GridTable.tsx',
    match: 'dragSelection(cur, r, j',
  },
  'js:makegrid.ts#mouseup:document': {
    file: 'GridTable.tsx',
    match: "document.addEventListener('mouseup', up)",
  },
  'js:makegrid.ts#paste:<g.cEdit> .edit_box': {
    file: 'GridTable.tsx',
    match: "if (e.target.value !== '') setNullChecked(false)",
  },
  'js:makegrid.ts#resize:<g>': { file: 'GridTable.tsx', match: 'setWidths((w) => new Map(w).set(d.p, nw))' },
  'js:jquery.sortable-table.ts#mousedown:<table> td': {
    file: '../server/MonitorPage.tsx',
    match: 'draggable={editMode}',
  },
  'js:jquery.sortable-table.ts#mouseleave:document': {
    file: '../server/MonitorPage.tsx',
    match: 'onDragOver={(e) => editMode && e.preventDefault()}',
  },
  'js:jquery.sortable-table.ts#mousemove:document': {
    file: '../server/MonitorPage.tsx',
    match: 'onDragOver={(e) => editMode && e.preventDefault()}',
  },
  'js:jquery.sortable-table.ts#mouseup:<drag>': {
    file: '../server/MonitorPage.tsx',
    match: 'onDrop={() => {',
  },
  'js:jquery.sortable-table.ts#mouseup:<dropTo>': {
    file: '../server/MonitorPage.tsx',
    match: 'g.splice(i, 0, moved!)',
  },
  'js:jquery.sortable-table.ts#mouseup:<table> td': {
    file: '../server/MonitorPage.tsx',
    match: 'dragFrom.current = i',
  },
  // grid edit's inline editors and the no-results operations card
  'select_all.twig#id:*_checkall': { file: '../database/TrackingPage.tsx', match: '_checkall' },
  'sql/enum_column_dropdown.twig#select:L1': { file: 'GridTable.tsx', match: 'multiple={isSet}' },
  'sql/set_column.twig#select:L2': { file: 'GridTable.tsx', match: "isSet ? 'resize-vertical'" },
  'sql/relational_column_dropdown.twig#link:Browse foreign values': 'GridTable.tsx',
  'sql/no_results_returned.twig#link:Create view': 'ResultsView.tsx',
}
