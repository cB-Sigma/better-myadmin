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
    match: '<PreviewSqlDialog highlight sql={preview}',
  },
  'js:modules/functions.ts#shown:#previewSqlConfirmModal': {
    file: 'ColumnForm.tsx',
    match: '<PreviewSqlDialog highlight sql={preview}',
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
    match: 'functions.ts input[value=AUTO_INCREMENT]: none_N becomes primary_N',
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
  'js:modules/functions.ts#click:#enum_editor td.drop': {
    file: 'ColumnForm.tsx',
    match: 'className="drop px-1"',
  },
  'js:modules/functions.ts#click:#enumEditorGoButton': {
    file: 'ColumnForm.tsx',
    match: 'onSave(formatEnumValues(values))',
  },
  'js:modules/functions.ts#click:input.add_value': {
    file: 'ColumnForm.tsx',
    match: 'add_value ${buttonVariants',
  },
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
    match: 'onClose={() => setPreview(null)}',
  },
  'js:modules/functions.ts#hidden.bs.modal:<indexDialogPreviewModal>': {
    file: '../indexes/IndexEditor.tsx',
    match: 'onClose={() => setPreview(null)}',
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
  // pma: resources/templates/table/structure/display_structure.twig
  'table/structure/display_structure.twig#selected_fld[]': {
    file: 'StructurePage.tsx',
    match: 'checkbox_row_',
  },
  'table/structure/display_structure.twig#link:Change': 'StructurePage.tsx',
  'table/structure/display_structure.twig#link:Drop': 'StructurePage.tsx',
  'table/structure/display_structure.twig#id:moreActionsButton': 'StructurePage.tsx',
  'table/structure/display_structure.twig#link:Primary': 'StructurePage.tsx',
  'table/structure/display_structure.twig#link:Unique': 'StructurePage.tsx',
  'table/structure/display_structure.twig#link:Index': 'StructurePage.tsx',
  'table/structure/display_structure.twig#link:Spatial': 'StructurePage.tsx',
  'table/structure/display_structure.twig#link:Fulltext': 'StructurePage.tsx',
  'table/structure/display_structure.twig#link:Distinct values': 'StructurePage.tsx',
  'table/structure/display_structure.twig#link:Remove from central columns': 'StructurePage.tsx',
  'table/structure/display_structure.twig#link:Add to central columns': 'StructurePage.tsx',
  'table/structure/display_structure.twig#button:Browse': 'StructurePage.tsx',
  'table/structure/display_structure.twig#button:Change': 'StructurePage.tsx',
  'table/structure/display_structure.twig#button:Drop': 'StructurePage.tsx',
  'table/structure/display_structure.twig#button:Primary': {
    file: 'StructurePage.tsx',
    match: "? 'Primary'",
  },
  'table/structure/display_structure.twig#button:Unique': { file: 'StructurePage.tsx', match: "? 'Unique'" },
  'table/structure/display_structure.twig#button:Index': { file: 'StructurePage.tsx', match: "? 'Index'" },
  'table/structure/display_structure.twig#button:Spatial': {
    file: 'StructurePage.tsx',
    match: "? 'Spatial'",
  },
  'table/structure/display_structure.twig#button:Fulltext': {
    file: 'StructurePage.tsx',
    match: ": 'Fulltext'",
  },
  'table/structure/display_structure.twig#button:Add to central columns': 'StructurePage.tsx',
  'table/structure/display_structure.twig#button:Remove from central columns': 'StructurePage.tsx',
  // #moveColumnsModal, #designerModalPreviewModal, #moveColumnsErrorModal
  'table/structure/display_structure.twig#button:Close': 'StructurePage.tsx',
  'table/structure/display_structure.twig#id:designerModalGoButton': 'StructurePage.tsx',
  'table/structure/display_structure.twig#id:designerModalPreviewButton': 'StructurePage.tsx',
  'table/structure/display_structure.twig#id:designerModalCloseButton': 'StructurePage.tsx',
  'table/structure/display_structure.twig#button:Go back': {
    file: 'StructurePage.tsx',
    match: 'onBack: () => setPreview(null)',
  },
  'table/structure/display_structure.twig#button:OK': {
    file: 'StructurePage.tsx',
    match: 'id="moveColumnsErrorModal"',
  },
  'table/structure/display_structure.twig#link:Edit view': 'StructurePage.tsx',
  'table/structure/display_structure.twig#button:Print': 'StructurePage.tsx',
  'table/structure/display_structure.twig#link:Propose table structure': 'StructurePage.tsx',
  'table/structure/display_structure.twig#link:Track table': 'StructurePage.tsx',
  'table/structure/display_structure.twig#link:Move columns': 'StructurePage.tsx',
  'table/structure/display_structure.twig#link:Normalize': 'StructurePage.tsx',
  'table/structure/display_structure.twig#link:Show create': 'StructurePage.tsx',
  'table/structure/display_structure.twig#link:Track view': 'StructurePage.tsx',
  'table/structure/display_structure.twig#num_fields': 'StructurePage.tsx',
  'table/structure/display_structure.twig#after_field': 'StructurePage.tsx',
  'table/structure/display_structure.twig#submit:Go': 'StructurePage.tsx',
  // the indexes list (table_index)
  'table/structure/display_structure.twig#link:Edit': {
    file: 'StructurePage.tsx',
    match: 'setIndexQuery({ index: index.name })',
  },
  'table/structure/display_structure.twig#link:Rename': {
    file: 'StructurePage.tsx',
    match: 'setRenaming(index.name)',
  },
  'table/structure/display_structure.twig#button:Partitions': 'StructurePage.tsx',
  'table/structure/display_table_stats.twig#link:Optimize table': 'StructurePage.tsx',
  // the bulk Drop / Primary confirmation (drop_confirm.twig, primary.twig)
  'table/structure/drop_confirm.twig#mult_btn': { file: 'StructurePage.tsx', match: 'id="buttonYes"' },
  'table/structure/primary.twig#mult_btn': { file: 'StructurePage.tsx', match: 'id="buttonNo"' },
  // pma: display_partitions.twig
  'table/structure/display_partitions.twig#link:Analyze': {
    file: 'StructurePage.tsx',
    match: "ANALYZE: t('Analyze')",
  },
  'table/structure/display_partitions.twig#link:Check': {
    file: 'StructurePage.tsx',
    match: "CHECK: t('Check')",
  },
  'table/structure/display_partitions.twig#link:Optimize': {
    file: 'StructurePage.tsx',
    match: "OPTIMIZE: t('Optimize')",
  },
  'table/structure/display_partitions.twig#link:Rebuild': {
    file: 'StructurePage.tsx',
    match: "REBUILD: t('Rebuild')",
  },
  'table/structure/display_partitions.twig#link:Repair': {
    file: 'StructurePage.tsx',
    match: "REPAIR: t('Repair')",
  },
  'table/structure/display_partitions.twig#link:Truncate': {
    file: 'StructurePage.tsx',
    match: "TRUNCATE: t('Truncate')",
  },
  'table/structure/display_partitions.twig#link:Drop': {
    file: 'StructurePage.tsx',
    match: "DROP: t('Drop')",
  },
  'table/structure/display_partitions.twig#submit:Partition table': 'StructurePage.tsx',
  'table/structure/display_partitions.twig#link:Remove partitioning': 'StructurePage.tsx',
  'table/structure/display_partitions.twig#submit:Edit partitioning': 'StructurePage.tsx',
  'table/structure/partition_definition_form.twig#save_partitioning': {
    file: 'ColumnPages.tsx',
    match: "t('Save')",
  },
  // pma: resources/templates/table/page_with_secondary_tabs.twig
  'table/page_with_secondary_tabs.twig#link:Table structure': {
    file: '../common/StructurePills.tsx',
    match: 'table_structure_id',
  },
  'table/page_with_secondary_tabs.twig#link:Relation view': {
    file: '../common/StructurePills.tsx',
    match: 'table_relation_id',
  },
  // pma: resources/templates/columns_definitions/
  'columns_definitions/column_name.twig#field_name[*]': { file: 'ColumnForm.tsx', match: 'field_name[${i}]' },
  'columns_definitions/column_name.twig#link:Pick from Central Columns': 'ColumnForm.tsx',
  'columns_definitions/column_attribute.twig#field_attribute[*]': {
    file: 'ColumnForm.tsx',
    match: 'field_attribute[${i}]',
  },
  'columns_definitions/column_attributes.twig#field_type[*]': {
    file: 'ColumnForm.tsx',
    match: 'field_type[${i}]',
  },
  'columns_definitions/column_attributes.twig#field_length[*]': {
    file: 'ColumnForm.tsx',
    match: 'field_length[${i}]',
  },
  'columns_definitions/column_attributes.twig#link:Edit ENUM/SET values': 'ColumnForm.tsx',
  'columns_definitions/column_attributes.twig#field_default_type[*]': {
    file: 'ColumnForm.tsx',
    match: 'field_default_type[${i}]',
  },
  'columns_definitions/column_attributes.twig#field_default_value[*]': {
    file: 'ColumnForm.tsx',
    match: 'default_value',
  },
  'columns_definitions/column_attributes.twig#field_collation[*]': {
    file: 'ColumnForm.tsx',
    match: 'field_collation[${i}]',
  },
  'columns_definitions/column_attributes.twig#field_null[*]': {
    file: 'ColumnForm.tsx',
    match: 'field_null[${i}]',
  },
  'columns_definitions/column_attributes.twig#field_adjust_privileges[*]': {
    file: 'ColumnForm.tsx',
    match: 'field_adjust_privileges[${i}]',
  },
  'columns_definitions/column_attributes.twig#field_key[*]': {
    file: 'ColumnForm.tsx',
    match: 'keyChanged(rows, i, e.target.value',
  },
  'columns_definitions/column_attributes.twig#field_extra[*]': {
    file: 'ColumnForm.tsx',
    match: 'field_extra[${i}]',
  },
  'columns_definitions/column_attributes.twig#field_comments[*]': {
    file: 'ColumnForm.tsx',
    match: 'field_comments[${i}]',
  },
  'columns_definitions/column_attributes.twig#field_virtuality[*]': {
    file: 'ColumnForm.tsx',
    match: 'field_virtuality[${i}]',
  },
  'columns_definitions/column_attributes.twig#field_expression[*]': {
    file: 'ColumnForm.tsx',
    match: 'update(i, { expression: e.target.value })',
  },
  'columns_definitions/column_attributes.twig#field_move_to[*]': {
    file: 'ColumnForm.tsx',
    match: 'field_move_to[${i}]',
  },
  'columns_definitions/column_attributes.twig#field_mimetype[*]': {
    file: 'ColumnForm.tsx',
    match: 'field_mimetype[${index}]',
  },
  'columns_definitions/column_attributes.twig#field_transformation[*]': {
    file: 'ColumnForm.tsx',
    match: 'field_transformation[${index}]',
  },
  'columns_definitions/column_attributes.twig#field_transformation_options[*]': {
    file: 'ColumnForm.tsx',
    match: 'field_transformation_options[${index}]',
  },
  'columns_definitions/column_attributes.twig#field_input_transformation[*]': {
    file: 'ColumnForm.tsx',
    match: 'field_input_transformation[${index}]',
  },
  'columns_definitions/column_attributes.twig#field_input_transformation_options[*]': {
    file: 'ColumnForm.tsx',
    match: 'field_input_transformation_options[${index}]',
  },
  'columns_definitions/table_fields_definitions.twig#link:Browser display transformation': 'ColumnForm.tsx',
  'columns_definitions/table_fields_definitions.twig#link:Input transformation': 'ColumnForm.tsx',
  'columns_definitions/column_definitions_form.twig#table': 'ColumnForm.tsx',
  'columns_definitions/column_definitions_form.twig#added_fields': {
    file: 'ColumnForm.tsx',
    match: 'setAddCount(',
  },
  'columns_definitions/column_definitions_form.twig#submit_num_fields': {
    file: 'ColumnForm.tsx',
    match: 'Math.max(1, addCount)',
  },
  'columns_definitions/column_definitions_form.twig#comment': 'ColumnForm.tsx',
  'columns_definitions/column_definitions_form.twig#tbl_collation': 'ColumnForm.tsx',
  'columns_definitions/column_definitions_form.twig#tbl_storage_engine': 'ColumnForm.tsx',
  'columns_definitions/column_definitions_form.twig#connection': 'ColumnForm.tsx',
  'columns_definitions/column_definitions_form.twig#online_transaction': 'ColumnForm.tsx',
  'columns_definitions/column_definitions_form.twig#button:Preview SQL': 'ColumnForm.tsx',
  'columns_definitions/column_definitions_form.twig#do_save_data': {
    file: 'ColumnForm.tsx',
    match: "t('Save')",
  },
  'columns_definitions/column_definitions_form.twig#button:Close': {
    file: 'ColumnForm.tsx',
    match: '<PreviewSqlDialog',
  },
  'columns_definitions/column_definitions_form.twig#id:previewSQLCloseButton': {
    file: 'ColumnForm.tsx',
    match: '<PreviewSqlDialog',
  },
  // pma: columns_definitions/partitions.twig
  'columns_definitions/partitions.twig#partition_by': 'PartitionEditor.tsx',
  'columns_definitions/partitions.twig#partition_expr': {
    file: 'PartitionEditor.tsx',
    match: "aria-label={t('Expression or column list')}",
  },
  'columns_definitions/partitions.twig#partition_count': 'PartitionEditor.tsx',
  'columns_definitions/partitions.twig#subpartition_by': 'PartitionEditor.tsx',
  'columns_definitions/partitions.twig#subpartition_expr': {
    file: 'PartitionEditor.tsx',
    match: 'set({ subpartitionExpr: e.target.value })',
  },
  'columns_definitions/partitions.twig#subpartition_count': 'PartitionEditor.tsx',
  'columns_definitions/partitions.twig#*[name]': {
    file: 'PartitionEditor.tsx',
    match: "aria-label={t('Partition')}",
  },
  'columns_definitions/partitions.twig#*[value_type]': {
    file: 'PartitionEditor.tsx',
    match: "aria-label={t('Values')}",
  },
  'columns_definitions/partitions.twig#*[value]': {
    file: 'PartitionEditor.tsx',
    match: "aria-label={t('Value')}",
  },
  'columns_definitions/partitions.twig#*[engine]': {
    file: 'PartitionEditor.tsx',
    match: "aria-label={t('Storage engine')}",
  },
  'columns_definitions/partitions.twig#*[comment]': {
    file: 'PartitionEditor.tsx',
    match: "aria-label={t('Comment')}",
  },
  'columns_definitions/partitions.twig#*[data_directory]': {
    file: 'PartitionEditor.tsx',
    match: "t('Data directory'),",
  },
  'columns_definitions/partitions.twig#*[index_directory]': {
    file: 'PartitionEditor.tsx',
    match: "t('Index directory'),",
  },
  'columns_definitions/partitions.twig#*[max_rows]': { file: 'PartitionEditor.tsx', match: "t('Max rows')," },
  'columns_definitions/partitions.twig#*[min_rows]': { file: 'PartitionEditor.tsx', match: "t('Min rows')," },
  'columns_definitions/partitions.twig#*[tablespace]': {
    file: 'PartitionEditor.tsx',
    match: "t('Table space'),",
  },
  'columns_definitions/partitions.twig#*[node_group]': {
    file: 'PartitionEditor.tsx',
    match: "t('Node group'),",
  },
  // pma: modals/enum_set_editor.twig, modals/preview_sql_modal.twig
  'modals/enum_set_editor.twig#button:Close': {
    file: 'ColumnForm.tsx',
    match: "title={t('ENUM/SET editor')}",
  },
  'modals/enum_set_editor.twig#id:enumEditorGoButton': 'ColumnForm.tsx',
  'modals/preview_sql_modal.twig#button:Close': { file: 'ColumnForm.tsx', match: '<PreviewSqlDialog' },
  // pma: resources/js — browser behaviours (js.json)
  'js:table/structure.ts#ajax:GET <data.structure_refresh_route>': {
    file: 'ColumnPages.tsx',
    match: 'useBackToStructure(scope)',
  },
  'js:table/structure.ts#ajax:POST <{ url: formUrl, data: formData, success…>': {
    file: 'StructurePage.tsx',
    match: 'dryRun: true })).preview',
  },
  "js:table/structure.ts#ajax:POST <$('#fieldsForm').attr('action')>": {
    file: 'StructurePage.tsx',
    match: 'await refresh()',
  },
  "js:table/structure.ts#ajax:POST <$form.attr('action')>": {
    file: 'ColumnPages.tsx',
    match: 'api.addColumns(scope, {',
  },
  "js:table/structure.ts#ajax:POST <$form.prop('action')>": {
    file: 'StructurePage.tsx',
    match: 'api.moveColumns(scope, { order })',
  },
  'js:table/structure.ts#ajax:POST <this.formAction>': {
    file: 'StructurePage.tsx',
    match: "api.dropColumns(scope, { columns: orderedSelection, source: 'bulk' })",
  },
  'js:table/structure.ts#ajax:POST <url>': {
    file: 'StructurePage.tsx',
    match: "api.dropColumns(scope, { columns: [c.name], source: 'row' })",
  },
  'js:table/structure.ts#change:select[name=after_field]': {
    file: 'StructurePage.tsx',
    match: "afterField === 'first' ? 'first' : 'after'",
  },
  'js:table/structure.ts#click:#designerModalGoButton': {
    file: 'StructurePage.tsx',
    match: 'id="designerModalGoButton"',
  },
  'js:table/structure.ts#click:#fieldsForm button.mult_submit': {
    file: 'StructurePage.tsx',
    match: 'const noneSelected = () =>',
  },
  'js:table/structure.ts#click:#move_columns_anchor': {
    file: 'StructurePage.tsx',
    match: 'move_columns_anchor',
  },
  'js:table/structure.ts#click:#remove_partitioning.ajax': {
    file: 'StructurePage.tsx',
    match: 'id="remove_partitioning"',
  },
  'js:table/structure.ts#click:a.add_key.ajax': {
    file: 'StructurePage.tsx',
    match: 'className={`add_key ${cls}`}',
  },
  'js:table/structure.ts#click:a.drop_column_anchor.ajax': {
    file: 'StructurePage.tsx',
    match: 'className="drop_column_anchor"',
  },
  'js:table/structure.ts#click:a[id^=partition_action].ajax': {
    file: 'StructurePage.tsx',
    match: 'id={`partition_action_${op}`}',
  },
  'js:table/structure.ts#confirm:strChangeColumnCollation': {
    file: 'ColumnForm.tsx',
    match: "t('Garbled Data')",
  },
  'js:table/structure.ts#confirm:strDoYouReally': {
    file: 'StructurePage.tsx',
    match: 'if (!confirmSql(c.dropSql)) return',
  },
  'js:table/structure.ts#confirm:strDropPartitionWarning': {
    file: 'StructurePage.tsx',
    match: 'Do you really want to DROP the selected partition(s)?',
  },
  'js:table/structure.ts#confirm:strRemovePartitioningWarning': {
    file: 'StructurePage.tsx',
    match: "t('Do you really want to remove partitioning?')",
  },
  'js:table/structure.ts#confirm:strTruncatePartitionWarning': {
    file: 'StructurePage.tsx',
    match: "t('Do you really want to TRUNCATE the selected partition(s)?')",
  },
  'js:table/structure.ts#hidden.bs.modal:<designerModalPreviewModal>': {
    file: 'StructurePage.tsx',
    match: 'onBack: () => setPreview(null)',
  },
  'js:table/structure.ts#shown.bs.modal:<designerModalPreviewModal>': {
    file: 'StructurePage.tsx',
    match: "return setPreview('')",
  },
  'js:table/structure.ts#submit:.append_fields_form.ajax': {
    file: 'ColumnForm.tsx',
    match: "'append_fields_form'",
  },
}
