/**
 * phpMyAdmin controls implemented in this folder (parity registry, read statically by tools/parity;
 * see docs/architecture/12-project-structure-and-conventions.md "Parity markers").
 */
export const pmaControls = {
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
