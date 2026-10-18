/**
 * phpMyAdmin controls implemented in this folder (parity registry, read statically by tools/parity;
 * see docs/architecture/12-project-structure-and-conventions.md "Parity markers").
 */
export const pmaControls = {
  // pma: resources/templates/indexes.twig (the Structure page's index list)
  'indexes.twig#link:Edit': {
    file: '../structure/StructurePage.tsx',
    match: 'setIndexQuery({ index: index.name })',
  },
  'indexes.twig#link:Rename': { file: '../structure/StructurePage.tsx', match: 'setRenaming(index.name)' },
  'indexes.twig#link:Drop': {
    file: '../structure/StructurePage.tsx',
    match: 'drop_primary_key_index_anchor',
  },
  // pma: modals/preview_sql_confirmation.twig (confirmPreviewSql before dropping an index)
  'modals/preview_sql_confirmation.twig#id:previewSQLConfirmOkButton': {
    file: '../structure/StructurePage.tsx',
    match: 'onConfirm={async () => {',
  },
  'modals/preview_sql_confirmation.twig#button:Close': {
    file: '../structure/StructurePage.tsx',
    match: 'onClose={() => setDropIndex(null)}',
  },
  // pma: resources/templates/table/index_form.twig
  'table/index_form.twig#index[Key_name]': { file: 'IndexEditor.tsx', match: 'input_index_name' },
  'table/index_form.twig#index[Index_choice]': { file: 'IndexEditor.tsx', match: 'select_index_choice' },
  'table/index_form.twig#button:Advanced options': 'IndexEditor.tsx',
  'table/index_form.twig#index[Key_block_size]': { file: 'IndexEditor.tsx', match: 'input_key_block_size' },
  'table/index_form.twig#index[Index_type]': { file: 'IndexEditor.tsx', match: 'select_index_type' },
  'table/index_form.twig#index[Parser]': { file: 'IndexEditor.tsx', match: 'input_parse' },
  'table/index_form.twig#index[Index_comment]': { file: 'IndexEditor.tsx', match: 'input_index_comment' },
  'table/index_form.twig#index[columns][names][]': {
    file: 'IndexEditor.tsx',
    match: "aria-label={t('Column')}",
  },
  'table/index_form.twig#index[columns][sub_parts][]': {
    file: 'IndexEditor.tsx',
    match: "aria-label={t('Size')}",
  },
  'table/index_form.twig#index[columns][collations][]': {
    file: 'IndexEditor.tsx',
    match: "aria-label={t('Collation')}",
  },
  'table/index_form.twig#id:add_fields': 'IndexEditor.tsx',
  'table/index_form.twig#button:Go': 'IndexEditor.tsx',
  'table/index_form.twig#id:preview_index_frm': 'IndexEditor.tsx',
  // pma: table/index_rename_form.twig
  'table/index_rename_form.twig#index': { file: 'IndexEditor.tsx', match: 'name="index"' },
  'table/index_rename_form.twig#id:preview_index_frm': {
    file: 'IndexEditor.tsx',
    match: "title={t('Rename index')}",
  },
  // pma: modals/index_dialog_modal.twig (#indexDialogModal, #indexDialogPreviewModal)
  'modals/index_dialog_modal.twig#button:Close': { file: 'IndexEditor.tsx', match: 'id="indexDialogModal"' },
  'modals/index_dialog_modal.twig#id:indexDialogModalGoButton': 'IndexEditor.tsx',
  'modals/index_dialog_modal.twig#button:Preview SQL': {
    file: 'IndexEditor.tsx',
    match: 'onClick={() => actions.current?.preview()}',
  },
  'modals/index_dialog_modal.twig#button:Go back': { file: 'IndexEditor.tsx', match: 'onBack:' },
  // pma: resources/js — browser behaviours (js.json)
  'js:modules/indexes.ts#ajax:POST /table/indexes': {
    file: '../structure/AddIndexDialog.tsx',
    match: 'targets={targets}',
  },
  "js:modules/indexes.ts#ajax:POST <$form.attr('action')>": {
    file: 'IndexEditor.tsx',
    match: 'api.saveIndex(scope, { oldIndex: form.oldIndex, index, dryRun })',
  },
  'js:modules/indexes.ts#ajax:POST <url>': {
    file: '../structure/StructurePage.tsx',
    match: 'api.dropIndex(scope, d.name)',
  },
  'js:modules/indexes.ts#change:#composite_index': {
    file: '../structure/AddIndexDialog.tsx',
    match: 'onChange={() => setComposite(true)}',
  },
  'js:modules/indexes.ts#change:#select_index_choice': {
    file: 'IndexEditor.tsx',
    match: 'onChange={(e) => setChoice(e.target.value as EditorIndex',
  },
  'js:modules/indexes.ts#change:#single_column': {
    file: '../structure/AddIndexDialog.tsx',
    match: 'onChange={() => setComposite(false)}',
  },
  'js:modules/indexes.ts#change:select[name*="field_key"]': {
    file: '../structure/ColumnForm.tsx',
    match: 'keyChanged(rows, i, e.target.value',
  },
  'js:modules/indexes.ts#click:.show_index_dialog': {
    file: '../structure/ColumnForm.tsx',
    match: 'show_index_dialog',
  },
  'js:modules/indexes.ts#click:#addIndexModalCancelButton': {
    file: '../structure/AddIndexDialog.tsx',
    match: 'id="addIndexModalCancelButton"',
  },
  'js:modules/indexes.ts#click:#addIndexModalCloseButton': {
    file: '../structure/AddIndexDialog.tsx',
    match: 'onClose={onClose}',
  },
  'js:modules/indexes.ts#click:#addIndexModalGoButton': {
    file: '../structure/AddIndexDialog.tsx',
    match: 'id="addIndexModalGoButton"',
  },
  'js:modules/indexes.ts#click:#preview_index_frm': {
    file: 'IndexEditor.tsx',
    match: 'id="preview_index_frm"',
  },
  'js:modules/indexes.ts#click:#save_index_frm': {
    file: 'IndexEditor.tsx',
    match: 'onClick={() => actions.current?.go()}',
  },
  'js:modules/indexes.ts#click:#table_index tbody tr td.edit_index.ajax, #index_div .add_index.ajax': {
    file: '../structure/StructurePage.tsx',
    match: 'setIndexQuery({ index: index.name })',
  },
  'js:modules/indexes.ts#click:#table_index tbody tr td.rename_index.ajax': {
    file: '../structure/StructurePage.tsx',
    match: 'setRenaming(index.name)',
  },
  'js:modules/indexes.ts#click:a.drop_primary_key_index_anchor.ajax': {
    file: '../structure/StructurePage.tsx',
    match: 'drop_primary_key_index_anchor',
  },
  'js:modules/indexes.ts#keypress:#addIndexModal': {
    file: '../structure/AddIndexDialog.tsx',
    match: "if (e.key !== 'Enter') return",
  },
  "js:modules/indexes.ts#submit:<$('#index_frm') as JQuery<HTMLFormEleme…>": {
    file: 'IndexEditor.tsx',
    match: 'id="index_frm"',
  },
}
