/**
 * phpMyAdmin controls of the view form (parity registry, read statically by tools/parity).
 * pma: resources/templates/view_create.twig, resources/templates/modals/create_view.twig
 */
export const pmaControls = {
  'view_create.twig#view[or_replace]': 'ViewForm.tsx',
  'view_create.twig#view[algorithm]': 'ViewForm.tsx',
  'view_create.twig#view[definer]': 'ViewForm.tsx',
  'view_create.twig#view[sql_security]': 'ViewForm.tsx',
  'view_create.twig#view[name]': 'ViewForm.tsx',
  'view_create.twig#view[column_names]': 'ViewForm.tsx',
  // the AS editor (CodeMirror or the textarea) of the shared SQL editor
  'view_create.twig#view[as]': { file: 'ViewForm.tsx', match: 'id="view_as"' },
  'view_create.twig#id:format': 'ViewForm.tsx',
  'view_create.twig#view[with]': 'ViewForm.tsx',
  'view_create.twig#submit:Go': { file: 'ViewForm.tsx', match: 'type="submit"' },
  'modals/create_view.twig#id:createViewModalGoButton': 'ViewForm.tsx',
  'modals/create_view.twig#button:Close': { file: 'ViewForm.tsx', match: "t('Close')" },
  // pma: resources/js/modules/functions/handleCreateViewModal.ts
  'js:modules/functions/handleCreateViewModal.ts#ajax:POST /view/create': {
    file: 'ViewForm.tsx',
    match: 'api.viewSave(scope, { operation: form.operation, view: { ...current, as } })',
  },
  "js:modules/functions/handleCreateViewModal.ts#ajax:POST <$this.attr('href')>": {
    file: 'ViewForm.tsx',
    match: 'queryFn: () => api.viewForm(scope, q)',
  },
  'js:modules/functions/handleCreateViewModal.ts#click:#createViewModalGoButton': {
    file: 'ViewForm.tsx',
    match: 'id="createViewModalGoButton"',
  },
  'js:modules/functions/handleCreateViewModal.ts#shown:#createViewModal': {
    file: 'ViewForm.tsx',
    match: 'id="createViewModal"',
  },
}
