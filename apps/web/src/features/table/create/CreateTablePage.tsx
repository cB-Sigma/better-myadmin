import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import {
  ColumnForm,
  type ColumnRow,
  type TableOptions,
  emptyRow,
  indexesFromRows,
  toColumnDef,
} from '../structure/ColumnForm'
import { structureApi } from '../structure/api'
import { setFlash } from '../structure/flash'
import { MessageBox, errorMessage } from '../structure/ui'

/**
 * Create table (pma: /table/create, CreateController + column_definitions_form.twig with the
 * table name, comment, collation, engine, connection and partition fields).
 */
export function CreateTablePage({
  server,
  db,
  initialName,
}: { server: number; db: string; initialName?: string }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['srv', server, 'db', db, 'create-form'],
    queryFn: () => structureApi.createForm({ server, db }),
  })
  const [rows, setRows] = useState<ColumnRow[] | null>(null)
  const [opts, setOpts] = useState<TableOptions | null>(null)
  if (q.isError) return <MessageBox message={errorMessage(q.error)} />
  if (q.data === undefined) return null
  const options = q.data.options
  const current = rows ?? Array.from({ length: q.data.defaultColumns }, emptyRow)
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
          return await structureApi.reservedWordCheck(
            { server, db, table: table.table || '_' },
            names,
            table.table,
          )
        } catch {
          return { reserved: false, message: '' }
        }
      }}
      submit={(dryRun) =>
        structureApi.createTable(
          { server, db },
          {
            table: table.table,
            columns: current.map(toColumnDef),
            indexes: indexesFromRows(current),
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
        await qc.invalidateQueries({ queryKey: ['srv', server, 'nav'] })
        const created = (r as { table?: string }).table ?? table.table
        // the JS redirects to the new table's Structure page
        await navigate({
          to: `/s/${server}/db/${encodeURIComponent(db)}/t/${encodeURIComponent(created)}/structure`,
        })
      }}
    />
  )
}
