import { MessageBox } from '@bettermyadmin/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { api, errorMessage } from '../../../lib/api'
import { qk } from '../../../lib/queryKeys'
import { ColumnForm, type ColumnRow, type TableOptions, emptyRow, toColumnDef } from '../structure/ColumnForm'
import { setFlash } from '../structure/flash'

/**
 * Create table (pma: /table/create, CreateController + column_definitions_form.twig with the
 * table name, comment, collation, engine, connection and partition fields).
 */
export function CreateTablePage({
  server,
  db,
  initialName,
  numFields,
}: { server: number; db: string; initialName?: string; numFields?: number }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: qk.createTableForm({ server, db }),
    queryFn: () => api.createTableForm({ server, db }),
  })
  const [rows, setRows] = useState<ColumnRow[] | null>(null)
  const [opts, setOpts] = useState<TableOptions | null>(null)
  if (q.isError) return <MessageBox {...errorMessage(q.error)} />
  if (q.data === undefined) return null
  const options = q.data.options
  const current = rows ?? Array.from({ length: numFields ?? q.data.defaultColumns }, emptyRow)
  const table =
    opts ??
    ({
      table: initialName ?? '',
      comment: '',
      collation: '',
      engine: options.engines.find((e) => e.isDefault)?.name ?? '',
      connection: '',
      partitioning: {},
    } satisfies TableOptions)
  return (
    <ColumnForm
      mode="create"
      options={options}
      rows={current}
      setRows={setRows}
      tableOptions={table}
      setTableOptions={setOpts}
      defaultNumFields={1}
      reservedCheck={async (names) => {
        // the reserved-word check needs a table scope; the new table's name is checked too
        try {
          return await api.reservedWordCheck({ server, db, table: table.table || '_' }, names, table.table)
        } catch {
          return { reserved: false, message: '' }
        }
      }}
      submit={(dryRun, _online, indexes) =>
        api.createTable(
          { server, db },
          {
            table: table.table,
            columns: current.map((r) => toColumnDef(r, q.data.options)),
            indexes,
            comment: table.comment,
            collation: table.collation,
            engine: table.engine,
            connection: table.connection,
            partitioning: table.partitioning,
            dryRun,
          },
        )
      }
      onDone={async (r) => {
        setFlash(r.messages)
        await qc.invalidateQueries({ queryKey: qk.nav(server) })
        const created = (r as { table?: string }).table ?? table.table
        // the JS redirects to the new table's Structure page
        await navigate({
          to: `/s/${server}/db/${encodeURIComponent(db)}/t/${encodeURIComponent(created)}/structure`,
        })
      }}
    />
  )
}
