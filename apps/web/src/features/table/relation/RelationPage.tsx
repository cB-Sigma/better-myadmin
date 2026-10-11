import type { RelationPageResponse, RelationSaveRequest, SqlMessage } from '@bettermyadmin/contracts'
import {
  Button,
  Disclosure,
  DocLink,
  Hint,
  Label,
  NativeSelect,
  Panel,
  PanelBody,
  useConfirm,
} from '@bettermyadmin/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { type TableRef, api } from '../../../lib/api'
import { t } from '../../../lib/i18n'
import { qk } from '../../../lib/queryKeys'
import { PreviewSqlDialog } from '../common/PreviewSqlDialog'
import { ResultMessages, errorMessage } from '../common/ResultMessages'
import { StructurePills } from '../common/StructurePills'

/**
 * Relation view: foreign key constraints, internal relations and the display column.
 *
 * pma: resources/templates/table/relation/common_form.twig, foreign_key_row.twig,
 *      relational_dropdown.twig, dropdown_generate.twig, resources/js/table/relation.ts
 */
export function RelationPage({ scope }: { scope: TableRef }) {
  const q = useQuery({
    queryKey: qk.tblPage(scope.server, scope.db, scope.table, 'relation'),
    queryFn: () => api.tableRelation(scope),
  })
  const [messages, setMessages] = useState<SqlMessage[]>([])
  if (q.isError) return <ResultMessages messages={[errorMessage(q.error)]} />
  if (q.data === undefined) return null
  return (
    <div>
      <StructurePills scope={scope} active="relation" />
      <ResultMessages messages={messages} />
      <RelationForm key={q.dataUpdatedAt} scope={scope} page={q.data} setMessages={setMessages} />
    </div>
  )
}

interface FkRow {
  key: number
  existing: string | null
  constraintName: string
  onDelete: string
  onUpdate: string
  columns: string[]
  refDb: string
  refTable: string
  refColumns: string[]
  tables: string[]
  refColumnChoices: string[]
}

interface InternalRow {
  field: string
  db: string
  table: string
  column: string
  tables: string[]
  columns: string[]
}

let keySeq = 0

function blankRow(page: RelationPageResponse, db: string): FkRow {
  return {
    key: keySeq++,
    existing: null,
    constraintName: '',
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
    columns: [''],
    refDb: db,
    refTable: '',
    refColumns: [''],
    tables: page.newRowTables,
    refColumnChoices: [],
  }
}

/** relational_dropdown.twig: '' first; an unknown stored value is appended (selected) */
function Relational({
  name,
  title,
  values,
  value,
  onChange,
}: {
  name: string
  title: string
  values: string[]
  value: string
  onChange: (v: string) => void
}) {
  const options = value !== '' && !values.includes(value) ? [...values, value] : values
  return (
    <NativeSelect name={name} title={title} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="" />
      {options.map((v) => (
        <option key={v} value={v}>
          {v}
        </option>
      ))}
    </NativeSelect>
  )
}

function RelationForm({
  scope,
  page,
  setMessages,
}: {
  scope: TableRef
  page: RelationPageResponse
  setMessages: (m: SqlMessage[]) => void
}) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [rows, setRows] = useState<FkRow[]>(() => [
    ...page.foreignKeys.map((k) => ({
      key: keySeq++,
      existing: k.constraint,
      constraintName: k.constraint ?? '',
      onDelete: k.onDelete,
      onUpdate: k.onUpdate,
      columns: k.indexList,
      refDb: k.refDb,
      refTable: k.refTable,
      refColumns: k.refTable !== '' ? k.refIndexList : [''],
      tables: k.tables,
      refColumnChoices: k.uniqueColumns,
    })),
    blankRow(page, scope.db),
  ])
  const [internal, setInternal] = useState<InternalRow[]>(() =>
    page.internal.map((r) => ({
      field: r.field,
      db: r.foreignDb,
      table: r.foreignTable,
      column: r.foreignColumn,
      tables: r.tables,
      columns: r.uniqueColumns,
    })),
  )
  const [displayField, setDisplayField] = useState(page.displayField)
  const [preview, setPreview] = useState<string | null>(null)

  const patch = (i: number, p: Partial<FkRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)))
  const patchInternal = (i: number, p: Partial<InternalRow>) =>
    setInternal((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)))

  // TableRelation.getDropdownValues
  const fkDb = async (i: number, db: string) => {
    patch(i, { refDb: db, refTable: '', tables: [], refColumns: [''], refColumnChoices: [] })
    if (db === '') return
    const r = await api.tableRelationDropdown(scope, { foreignDb: db, foreign: true })
    patch(i, { tables: r.tables ?? [] })
  }
  const fkTable = async (i: number, db: string, table: string) => {
    patch(i, { refTable: table, refColumnChoices: [] })
    if (table === '') return
    const r = await api.tableRelationDropdown(scope, { foreignDb: db, foreignTable: table, foreign: true })
    const primary = r.primary?.length === 1 ? (r.primary[0] ?? '') : ''
    setRows((rs) =>
      rs.map((row, j) =>
        j === i
          ? {
              ...row,
              refColumnChoices: r.columns ?? [],
              refColumns: row.refColumns.map((c, k) => (k === 0 && primary !== '' ? primary : c)),
            }
          : row,
      ),
    )
  }
  const inDb = async (i: number, db: string) => {
    patchInternal(i, { db, table: '', column: '', tables: [], columns: [] })
    if (db === '') return
    const r = await api.tableRelationDropdown(scope, { foreignDb: db, foreign: false })
    patchInternal(i, { tables: r.tables ?? [] })
  }
  const inTable = async (i: number, db: string, table: string) => {
    patchInternal(i, { table, column: '', columns: [] })
    if (table === '') return
    const r = await api.tableRelationDropdown(scope, { foreignDb: db, foreignTable: table, foreign: false })
    const primary = r.primary?.length === 1 ? (r.primary[0] ?? '') : ''
    patchInternal(i, { columns: r.columns ?? [], column: primary })
  }

  const request = (previewOnly: boolean): RelationSaveRequest => ({
    ...(page.isForeignKeySupported
      ? {
          foreignKeys: rows.map((r) => ({
            constraintName: r.constraintName,
            onDelete: r.onDelete,
            onUpdate: r.onUpdate,
            columns: r.columns,
            refDb: r.refDb,
            refTable: r.refTable,
            refColumns: r.refColumns,
          })),
        }
      : {}),
    ...(page.relationFeature
      ? { internal: internal.map((r) => ({ field: r.field, db: r.db, table: r.table, column: r.column })) }
      : {}),
    ...(page.displayFeature && !previewOnly ? { displayField } : {}),
    preview: previewOnly,
  })

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: qk.tbl(scope.server, scope.db, scope.table) })
  }
  const save = async (e: FormEvent) => {
    e.preventDefault()
    try {
      const r = await api.tableRelationSave(scope, request(false))
      setMessages(r.messages)
      await refresh()
    } catch (err) {
      setMessages([errorMessage(err)])
    }
  }
  const showPreview = async () => {
    try {
      const r = await api.tableRelationSave(scope, request(true))
      setPreview(r.preview ?? '')
    } catch (err) {
      setMessages([errorMessage(err)])
    }
  }
  const dropFk = async (constraint: string) => {
    const sql = `ALTER TABLE ${scope.db}.${scope.table} DROP FOREIGN KEY ${constraint};`
    if (!(await confirm({ question: t('Do you really want to execute "%s"?', sql) }))) return
    try {
      const r = await api.tableRelationDropFk(scope, constraint)
      setMessages(r.messages)
      await refresh()
    } catch (err) {
      setMessages([errorMessage(err)])
    }
  }

  const internalCard = (
    <Panel
      title={
        <>
          {t('Internal relationships')} <DocLink page="config" anchor="cfg_Servers_relation" />
        </>
      }
    >
      <PanelBody>
        <table className="relationalTable w-auto text-sm">
          <thead>
            <tr>
              <th className="px-2 text-left">{t('Column')}</th>
              <th className="px-2 text-left">
                {t('Internal relation')}{' '}
                {page.isForeignKeySupported && (
                  <Hint
                    message={t(
                      'An internal relation is not necessary when a corresponding FOREIGN KEY relation exists.',
                    )}
                  />
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {internal.map((r, i) => (
              <tr key={r.field} className="odd:bg-grid-odd even:bg-grid-even">
                <td className="px-2 align-middle">
                  <strong>{r.field}</strong>
                </td>
                <td className="flex gap-1 px-2 py-1">
                  <Relational
                    name={`destination_db[${r.field}]`}
                    title={t('Database')}
                    values={page.databases}
                    value={r.db}
                    onChange={(v) => void inDb(i, v)}
                  />
                  <Relational
                    name={`destination_table[${r.field}]`}
                    title={t('Table')}
                    values={r.tables}
                    value={r.table}
                    onChange={(v) => void inTable(i, r.db, v)}
                  />
                  <Relational
                    name={`destination_column[${r.field}]`}
                    title={t('Column')}
                    values={r.columns}
                    value={r.column}
                    onChange={(v) => patchInternal(i, { column: v })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </PanelBody>
    </Panel>
  )

  return (
    <form onSubmit={(e) => void save(e)} className="space-y-3" data-testid="relation-form">
      {page.isForeignKeySupported && (
        <Panel title={t('Foreign key constraints')}>
          <PanelBody className="overflow-x-auto">
            <table className="relationalTable w-auto text-sm">
              <thead>
                <tr>
                  <th className="px-2 text-left">{t('Actions')}</th>
                  <th className="px-2 text-left">{t('Constraint properties')}</th>
                  <th className="px-2 text-left">
                    {t('Column')}{' '}
                    <Hint
                      message={
                        page.engine.toUpperCase() === 'INNODB'
                          ? t(
                              'Creating a foreign key over a non-indexed column would automatically create an index on it. Alternatively, you can define an index below, before creating the foreign key.',
                            )
                          : t('Only columns with index will be displayed. You can define an index below.')
                      }
                    />
                  </th>
                  <th className="px-2 text-left" colSpan={3}>
                    {t('Foreign key constraint')} ({page.engine})
                  </th>
                </tr>
                <tr>
                  <th />
                  <th />
                  <th />
                  <th className="px-2 text-left">{t('Database')}</th>
                  <th className="px-2 text-left">{t('Table')}</th>
                  <th className="px-2 text-left">{t('Column')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={r.key}
                    className="odd:bg-grid-odd even:bg-grid-even align-top"
                    data-testid={`fk-row-${i}`}
                  >
                    <td className="px-2 py-1">
                      {r.existing !== null && (
                        <Button
                          variant="link"
                          className="drop_foreign_key_anchor"
                          onClick={() => void dropFk(r.existing ?? '')}
                        >
                          {t('Drop')}
                        </Button>
                      )}
                    </td>
                    <td className="space-y-1 px-2 py-1">
                      <input
                        type="text"
                        className="h-7 rounded-(--radius) border border-border-strong bg-bg px-2 text-[13px]"
                        name={`constraint_name[${i}]`}
                        value={r.constraintName}
                        placeholder={t('Constraint name')}
                        maxLength={64}
                        onChange={(e) => patch(i, { constraintName: e.target.value })}
                      />
                      {(['onDelete', 'onUpdate'] as const).map((k) => (
                        <div key={k} className="flex items-center gap-1">
                          {k === 'onDelete' ? 'ON DELETE' : 'ON UPDATE'}
                          <NativeSelect
                            name={`${k === 'onDelete' ? 'on_delete' : 'on_update'}[${i}]`}
                            value={r[k]}
                            onChange={(e) => patch(i, { [k]: e.target.value })}
                          >
                            {page.actions.map((a) => (
                              <option key={a.value} value={a.value}>
                                {a.label}
                              </option>
                            ))}
                          </NativeSelect>
                        </div>
                      ))}
                    </td>
                    <td className="space-y-1 px-2 py-1">
                      {r.columns.map((c, k) => (
                        <div key={`${r.key}-${k}`}>
                          <NativeSelect
                            name={`foreign_key_fields_name[${i}][]`}
                            value={c}
                            onChange={(e) =>
                              patch(i, { columns: r.columns.map((x, j) => (j === k ? e.target.value : x)) })
                            }
                          >
                            {page.columns.map((col) => (
                              <option key={col} value={col}>
                                {col}
                              </option>
                            ))}
                          </NativeSelect>
                        </div>
                      ))}
                      <Button
                        variant="link"
                        className="add_foreign_key_field"
                        onClick={() =>
                          patch(i, { columns: [...r.columns, ''], refColumns: [...r.refColumns, ''] })
                        }
                      >
                        {t('+ Add column')}
                      </Button>
                    </td>
                    <td className="px-2 py-1">
                      <Relational
                        name={`destination_foreign_db[${i}]`}
                        title={t('Database')}
                        values={page.databases}
                        value={r.refDb}
                        onChange={(v) => void fkDb(i, v)}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Relational
                        name={`destination_foreign_table[${i}]`}
                        title={t('Table')}
                        values={r.tables}
                        value={r.refTable}
                        onChange={(v) => void fkTable(i, r.refDb, v)}
                      />
                    </td>
                    <td className="space-y-1 px-2 py-1">
                      {r.refColumns.map((c, k) => (
                        <div key={`${r.key}-${k}`}>
                          <Relational
                            name={`destination_foreign_column[${i}][]`}
                            title={t('Column')}
                            values={r.refColumnChoices}
                            value={c}
                            onChange={(v) =>
                              patch(i, { refColumns: r.refColumns.map((x, j) => (j === k ? v : x)) })
                            }
                          />
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
                <tr>
                  <th colSpan={6} className="px-2 py-1 text-left">
                    <Button
                      variant="link"
                      className="add_foreign_key"
                      onClick={() => setRows((rs) => [...rs, blankRow(page, scope.db)])}
                    >
                      {t('+ Add constraint')}
                    </Button>
                  </th>
                </tr>
              </tbody>
            </table>
          </PanelBody>
        </Panel>
      )}

      {page.relationFeature &&
        (page.isForeignKeySupported ? (
          <Disclosure
            label={t('Internal relationships')}
            id="internalRelationships"
            initialState={page.slidersState}
          >
            {internalCard}
          </Disclosure>
        ) : (
          internalCard
        ))}

      {page.displayFeature && (
        <div>
          <Label htmlFor="displayFieldSelect" className="block">
            {t('Choose column to display:')}
          </Label>
          <NativeSelect
            id="displayFieldSelect"
            name="display_field"
            value={displayField}
            onChange={(e) => setDisplayField(e.target.value)}
          >
            <option value="">---</option>
            {page.allColumns.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}

      <div className="flex gap-2">
        <Button className="preview_sql" onClick={() => void showPreview()}>
          {t('Preview SQL')}
        </Button>
        <Button type="submit" variant="primary">
          {t('Save')}
        </Button>
      </div>
      <PreviewSqlDialog sql={preview} onClose={() => setPreview(null)} />
    </form>
  )
}
