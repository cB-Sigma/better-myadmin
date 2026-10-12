/**
 * phpMyAdmin controls implemented in this folder (parity registry, read statically by tools/parity;
 * see docs/architecture/12-project-structure-and-conventions.md "Parity markers").
 */
export const pmaControls = {
  // pma: resources/js/modules/functions.ts (create table / column form, ENUM/SET editor, index dialog)
  'js:modules/functions.ts#ajax:POST /table/structure/reserved-word-check': {
    file: '../create/CreateTablePage.tsx',
    match: 'api.reservedWordCheck(',
  },
  'js:modules/functions.ts#confirm:<data.message>': {
    file: 'ColumnForm.tsx',
    match: 'if (reserved.reserved && !window.confirm(reserved.message)) return',
  },
  "js:modules/functions.ts#ajax:POST <$form.attr('action')>": {
    file: '../create/CreateTablePage.tsx',
    match: 'api.createTable(',
  },
  'js:modules/functions.ts#submit:form.create_table_form.ajax': {
    file: 'ColumnForm.tsx',
    match: 'void run(false)',
  },
  'js:modules/functions.ts#ajax:GET <tableStructureUrl>': {
    file: '../create/CreateTablePage.tsx',
    match: '/t/${encodeURIComponent(created)}/structure',
  },
  'js:modules/functions.ts#ajax:POST <formUrl>': {
    file: 'ColumnForm.tsx',
    match: "if (dryRun) setPreview(r.preview ?? '')",
  },
  'js:modules/functions.ts#click:#previewSQLConfirmOkButton': {
    file: 'ColumnForm.tsx',
    match: '<PreviewSqlDialog sql={preview} onClose={() => setPreview(null)} />',
  },
  'js:modules/functions.ts#shown:#previewSqlConfirmModal': {
    file: 'ColumnForm.tsx',
    match: '<PreviewSqlDialog sql={preview} onClose={() => setPreview(null)} />',
  },
  'js:modules/functions.ts#alert:strEnterValidLength': {
    file: 'ColumnForm.tsx',
    match: "t('Please enter a valid length!')",
  },
  'js:modules/functions.ts#alert:strEnterValidNumber': {
    file: 'StructurePage.tsx',
    match: "window.alert(t('Please enter a valid number!'))",
  },
  'js:modules/functions.ts#alert:<sprintf(message, val)>': {
    file: 'StructurePage.tsx',
    match: "window.alert(t('Column count has to be larger than zero.'))",
  },
  'js:modules/functions.ts#change:.create_table_form select[name=tbl_storage_engine]': {
    file: 'ColumnForm.tsx',
    match: "tableOptions.engine === 'FEDERATED'",
  },
  'js:modules/functions.ts#change:input.allow_null': {
    file: 'ColumnForm.tsx',
    match: "r.defaultType === 'NULL' ? { defaultType: 'NONE' } : {}",
  },
  'js:modules/functions.ts#change:input[name=partition_count],input[name=subpartition_count],select[name=partition_by]':
    { file: 'PartitionEditor.tsx', match: 'onChange(regeneratePartitions({ ...p, ...patch }))' },
  'js:modules/functions.ts#change:input[value=AUTO_INCREMENT]': {
    file: 'ColumnForm.tsx',
    match: "next.key === 'none') next.key = 'primary'",
  },
  'js:modules/functions.ts#change:select.column_type': {
    file: 'ColumnForm.tsx',
    match: 'resetAttributeForNonNumericType',
  },
  'js:modules/functions.ts#change:select.default_type': {
    file: 'ColumnForm.tsx',
    match: "r.defaultType === 'USER_DEFINED' &&",
  },
  'js:modules/functions.ts#change:select.virtuality': {
    file: 'ColumnForm.tsx',
    match: "r.virtuality !== '' && (",
  },
  'js:modules/functions.ts#click:#enum_editor td.drop': { file: 'ColumnForm.tsx', match: 'className="drop"' },
  'js:modules/functions.ts#click:#enumEditorGoButton': {
    file: 'ColumnForm.tsx',
    match: 'onSave(formatEnumValues(values))',
  },
  'js:modules/functions.ts#click:input.add_value': { file: 'ColumnForm.tsx', match: 'className="add_value"' },
  'js:modules/functions.ts#click:a.open_enum_editor': {
    file: 'ColumnForm.tsx',
    match: 'onClick={() => setEnumFor(i)}',
  },
  'js:modules/functions.ts#click:form.create_table_form.ajax input[name=submit_num_fields]': {
    file: 'ColumnForm.tsx',
    match: 'name="submit_num_fields"',
  },
  'js:modules/functions.ts#keydown:form.create_table_form.ajax input[name=added_fields]': {
    file: 'ColumnForm.tsx',
    match: "if (e.key !== 'Enter') return",
  },
  'js:modules/functions.ts#click:a.central_columns_dialog': {
    file: 'ColumnForm.tsx',
    match: 'className="central_columns_dialog"',
  },
  'js:modules/functions.ts#click:#col_list .pick': {
    file: 'CentralColumnPicker.tsx',
    match: 'className="pick w-full"',
  },
  'js:modules/functions.ts#click:#seeMore': { file: 'CentralColumnPicker.tsx', match: 'id="seeMore"' },
  'js:modules/functions.ts#keyup:.filter_rows': {
    file: 'CentralColumnPicker.tsx',
    match: 'onChange={(e) => setFilter(e.target.value)}',
  },
  'js:modules/functions.ts#shown.bs.modal:<centralColumnsModal>': {
    file: 'CentralColumnPicker.tsx',
    match: 'id="centralColumnsModal"',
  },
  'js:modules/functions.ts#hidden.bs.modal:<centralColumnsModal>': {
    file: 'CentralColumnPicker.tsx',
    match: 'onClose={onClose}',
  },
  'js:modules/functions.ts#click:#indexDialogModalGoButton': {
    file: '../indexes/IndexEditor.tsx',
    match: 'api.saveIndex(scope, { oldIndex: form.oldIndex, index, dryRun })',
  },
  'js:modules/functions.ts#ajax:POST <routeUrl>': {
    file: '../indexes/IndexEditor.tsx',
    match: 'queryFn: () => api.indexForm(scope, query ?? {})',
  },
  'js:modules/functions.ts#ajax:POST <{ url: formUrl, data: formData, success…>': {
    file: '../indexes/IndexEditor.tsx',
    match: 'id="preview_index_frm"',
  },
  'js:modules/functions.ts#shown.bs.modal:<indexDialogPreviewModal>': {
    file: '../indexes/IndexEditor.tsx',
    match: '<PreviewSqlDialog sql={preview} onClose={() => setPreview(null)} />',
  },
  'js:modules/functions.ts#hidden.bs.modal:<indexDialogPreviewModal>': {
    file: '../indexes/IndexEditor.tsx',
    match: '<PreviewSqlDialog sql={preview} onClose={() => setPreview(null)} />',
  },
  'js:modules/functions.ts#change:<$outer> table#index_columns select': {
    file: '../indexes/IndexEditor.tsx',
    match: "e.currentTarget.closest('tr')?.querySelector('input')?.focus()",
  },
  'js:modules/functions.ts#change:<$newrow> select': {
    file: '../indexes/IndexEditor.tsx',
    match: 'focusSize(e)',
  },
  'js:modules/functions/event-loader.ts#click:#index_frm input[type=submit]': {
    file: '../indexes/IndexEditor.tsx',
    match: 'id="index_frm"',
  },
  'js:modules/keyhandler.ts#keydown:#table_columns': { file: 'ColumnForm.tsx', match: 'id="table_columns"' },
  'js:modules/keyhandler.ts#keyup:#table_columns': { file: 'ColumnForm.tsx', match: 'id="table_columns"' },
}
