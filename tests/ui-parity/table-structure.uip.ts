import type { Page } from '@playwright/test'
import { FIX } from './lib/env.ts'
import { type PageSpec, pageParity } from './lib/parity.ts'

/**
 * UI parity of the Structure tab's own forms and dialogs (docs/features/04-table-level.md): the
 * index editor (page and dialogs), the index rename and drop confirmations, Move columns, the
 * ENUM/SET editor and Preview SQL of the column form, Add columns, Create table, Edit partitioning.
 */
const T = `/s/1/db/${FIX.db}/t/${FIX.table}`
const P = { db: FIX.db, table: FIX.table }

/** a dialog opened from a page: phpMyAdmin's Bootstrap modal and ours */
const dialog = (
  base: Pick<PageSpec, 'pma' | 'ours'>,
  scope: { pma: string; ours: string },
  open: { pma: (p: Page) => Promise<void>; ours: (p: Page) => Promise<void> },
  ready: string | { pma: string; ours: string },
): PageSpec => ({
  ...base,
  scope,
  ready: { pma: '#page_content', ours: '#page_content' },
  setup: async ({ pma, ours }) => {
    await open.pma(pma)
    await open.ours(ours)
    const r = typeof ready === 'string' ? { pma: ready, ours: ready } : ready
    await pma.locator(`${scope.pma} ${r.pma}`).first().waitFor()
    await ours.locator(`${scope.ours} ${r.ours}`).first().waitFor()
  },
})

const structure: Pick<PageSpec, 'pma' | 'ours'> = {
  pma: { route: '/table/structure', params: P },
  ours: { path: `${T}/structure` },
}
const change: Pick<PageSpec, 'pma' | 'ours'> = {
  pma: { route: '/table/structure/change', params: { ...P, field: 'kind', change_column: '1' } },
  ours: { path: `${T}/structure/change?fields=kind` },
}
/** the Edit / Rename / Drop link of the PRIMARY index */
const pmaIndex = (label: string) => (p: Page) =>
  p.locator('#table_index tbody').first().getByRole('link', { name: label }).first().click({ force: true })
const oursIndex = (label: string) => (p: Page) =>
  p.locator('[data-testid="index-PRIMARY"]').getByRole('button', { name: label }).first().click()

pageParity('table-indexes', {
  pma: { route: '/table/indexes', params: P },
  ours: { path: `${T}/indexes` },
  interactions: [{ name: 'advanced options', do: { click: 'Advanced options' } }],
})
pageParity(
  'table-index-dialog',
  dialog(
    structure,
    { pma: '#indexDialogModal.show .modal-content', ours: '#indexDialogModal' },
    { pma: pmaIndex('Edit'), ours: oursIndex('Edit') },
    '#input_index_name',
  ),
)
pageParity(
  'table-index-rename',
  dialog(
    structure,
    { pma: '#indexDialogModal.show .modal-content', ours: '#indexDialogModal' },
    { pma: pmaIndex('Rename'), ours: oursIndex('Rename') },
    '#input_index_name',
  ),
)
pageParity(
  'table-index-drop',
  dialog(
    structure,
    {
      pma: '#previewSqlConfirmModal.show .modal-content',
      ours: '[role=dialog]:has(#previewSQLConfirmOkButton)',
    },
    { pma: pmaIndex('Drop'), ours: oursIndex('Drop') },
    '#previewSQLConfirmOkButton',
  ),
)
pageParity(
  'table-move-columns',
  dialog(
    structure,
    { pma: '#moveColumnsModal.show .modal-content', ours: '#moveColumnsModal' },
    {
      pma: (p) => p.locator('#move_columns_anchor').click({ force: true }),
      ours: (p) => p.locator('#move_columns_anchor').click(),
    },
    '#designerModalGoButton',
  ),
)
pageParity(
  'table-enum-editor',
  dialog(
    change,
    { pma: '#enumEditorModal.show .modal-content', ours: '[role=dialog]:has(#enumEditorGoButton)' },
    {
      pma: (p) => p.locator('a.open_enum_editor').first().click({ force: true }),
      ours: (p) => p.getByRole('button', { name: 'Edit ENUM/SET values' }).first().click(),
    },
    '#enumEditorGoButton',
  ),
)
pageParity(
  'table-column-preview-sql',
  dialog(
    change,
    { pma: '#previewSqlModal.show .modal-content', ours: '[role=dialog]:has(#previewSQLCloseButton)' },
    {
      pma: (p) => p.locator('input.preview_sql').first().click({ force: true }),
      ours: (p) => p.locator('.preview_sql').first().click(),
    },
    // preview_sql_modal.twig's Close has no id
    { pma: '.modal-footer button', ours: '#previewSQLCloseButton' },
  ),
)
pageParity('table-add-columns', {
  pma: { route: '/table/add-field', params: { ...P, num_fields: '1', field_where: 'last', after_field: '' } },
  ours: { path: `${T}/structure/add?num=1` },
})
pageParity('table-create', {
  pma: { route: '/table/create', params: { db: FIX.db } },
  ours: { path: `/s/1/db/${FIX.db}/create-table` },
})
// /table/structure/partitioning only answers the POST of the Structure page's "Partition table" form
pageParity('table-partitioning', {
  ...structure,
  ours: { path: `${T}/structure/partitioning` },
  setup: async ({ pma, ours }) => {
    await pma.locator('input[type=submit][value="Partition table"]').click()
    await pma.locator('#partition_by').waitFor()
    await ours.locator('#partition_by').waitFor()
  },
})
