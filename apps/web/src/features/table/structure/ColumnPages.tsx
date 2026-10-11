import type { ChangeFormResponse, ColumnFormOptions, Partitioning } from '@bettermyadmin/contracts'
import { Button, MessageBox, MySqlDocLink, Panel, PanelBody, PreviewSqlDialog } from '@bettermyadmin/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { type TableRef, api, errorMessage } from '../../../lib/api'
import { t } from '../../../lib/i18n'
import { qk } from '../../../lib/queryKeys'
import { ColumnForm, type ColumnRow, emptyRow, indexesFromRows, toColumnDef } from './ColumnForm'
import { PartitionEditor } from './PartitionEditor'
import { setFlash } from './flash'

/**
 * Change column(s) (pma: /table/structure/change → /table/structure/save), Add column(s)
 * (pma: /table/add-field) and Edit partitioning (pma: /table/structure/partitioning).
 */
const structureHref = (s: TableRef) =>
  `/s/${s.server}/db/${encodeURIComponent(s.db)}/t/${encodeURIComponent(s.table)}/structure`

function useBackToStructure(scope: TableRef) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  return async (messages: Parameters<typeof setFlash>[0]) => {
    setFlash(messages)
    await qc.invalidateQueries({ queryKey: qk.tbl(scope) })
    await qc.invalidateQueries({ queryKey: qk.nav(scope.server) })
    await navigate({ to: structureHref(scope) })
  }
}

const rowFromForm = (c: ChangeFormResponse['columns'][number], options: ColumnFormOptions): ColumnRow => ({
  name: c.values.name,
  type: c.values.type,
  length: c.values.length,
  defaultType: c.values.defaultType,
  defaultValue: c.values.defaultValue,
  collation: c.values.collation ?? '',
  attribute: c.values.attribute,
  null: c.values.null,
  autoIncrement: c.values.autoIncrement,
  comments: c.values.comments,
  virtuality: c.values.virtuality ?? '',
  expression: c.values.expression ?? '',
  moveTo: '',
  // the box is ticked when the user may adjust column privileges
  adjustPrivileges: options.privsAvailable,
  key: 'none',
  orig: c.orig,
  moveOptions: c.moveOptions,
})

export function ChangeColumnsPage({ scope, fields }: { scope: TableRef; fields: string[] }) {
  const back = useBackToStructure(scope)
  const q = useQuery({
    queryKey: qk.changeColumnsForm(scope, fields),
    queryFn: () => api.changeColumnsForm(scope, fields),
    gcTime: 0,
  })
  const [rows, setRows] = useState<ColumnRow[] | null>(null)
  useEffect(() => {
    if (q.data !== undefined) setRows(q.data.columns.map((c) => rowFromForm(c, q.data.options)))
  }, [q.data])
  if (q.isError) return <MessageBox {...errorMessage(q.error)} />
  if (q.data === undefined || rows === null) return null
  return (
    <ColumnForm
      mode="change"
      options={q.data.options}
      rows={rows}
      setRows={setRows}
      reservedCheck={(names) => api.reservedWordCheck(scope, names)}
      submit={(dryRun, online) =>
        api.changeColumns(scope, {
          columns: rows.map((r) => ({
            ...toColumnDef(r),
            orig: r.orig as NonNullable<ColumnRow['orig']>,
            moveTo: r.moveTo,
            adjustPrivileges: r.adjustPrivileges,
          })),
          onlineTransaction: online,
          dryRun,
        })
      }
      onDone={(r) => void back(r.messages)}
    />
  )
}

export function AddColumnsPage({
  scope,
  num,
  where,
  after,
}: { scope: TableRef; num: number; where: 'first' | 'after' | 'last'; after: string }) {
  const back = useBackToStructure(scope)
  const q = useQuery({
    queryKey: qk.addColumnsForm(scope),
    queryFn: () => api.addColumnsForm(scope),
  })
  // AddFieldController: num_fields capped at 4096, default 1
  const count = Math.min(4096, Math.max(1, Math.trunc(num) || 1))
  const [rows, setRows] = useState<ColumnRow[]>(() => Array.from({ length: count }, emptyRow))
  if (q.isError) return <MessageBox {...errorMessage(q.error)} />
  if (q.data === undefined) return null
  return (
    <ColumnForm
      mode="add"
      options={q.data.options}
      rows={rows}
      setRows={setRows}
      reservedCheck={(names) => api.reservedWordCheck(scope, names)}
      submit={(dryRun, online) =>
        api.addColumns(scope, {
          columns: rows.map(toColumnDef),
          indexes: indexesFromRows(rows),
          where,
          afterField: after,
          onlineTransaction: online,
          dryRun,
        })
      }
      onDone={(r) => void back(r.messages)}
    />
  )
}

/** "Edit partitioning" / "Partition table" (partition_definition_form.twig) */
export function PartitioningPage({ scope }: { scope: TableRef }) {
  const back = useBackToStructure(scope)
  const q = useQuery({
    queryKey: qk.partitionForm(scope),
    queryFn: () => api.partitionForm(scope),
    gcTime: 0,
  })
  const [value, setValue] = useState<Partitioning | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<ReturnType<typeof errorMessage> | null>(null)
  useEffect(() => {
    if (q.data !== undefined) setValue(q.data.partitioning)
  }, [q.data])
  if (q.isError) return <MessageBox {...errorMessage(q.error)} />
  if (q.data === undefined || value === null) return null
  const save = async (dryRun: boolean) => {
    try {
      const r = await api.savePartitioning(scope, { partitioning: value, dryRun })
      if (dryRun) setPreview(r.preview ?? '')
      else void back(r.messages)
    } catch (e) {
      setError(errorMessage(e))
    }
  }
  return (
    <Panel
      title={
        <>
          {t('Edit partitioning')} <MySqlDocLink link="partitioning" />
        </>
      }
      footer={
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => void save(false)}>
            {t('Save')}
          </Button>
          <Button onClick={() => void save(true)}>{t('Preview SQL')}</Button>
        </div>
      }
    >
      <PanelBody>
        {error !== null && <MessageBox {...error} />}
        <PartitionEditor value={value} engines={q.data.engines} onChange={setValue} />
        <PreviewSqlDialog sql={preview} onClose={() => setPreview(null)} />
      </PanelBody>
    </Panel>
  )
}
