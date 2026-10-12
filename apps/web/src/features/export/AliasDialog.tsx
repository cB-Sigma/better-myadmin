import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  NativeSelect,
} from '@bettermyadmin/ui'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../../lib/api'
import { pgettext, t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'

export interface AliasRow {
  /** "Database" / "Table" / "Column" */
  type: string
  label: string
  /** the posted field name (`aliases[db][alias]` …) */
  name: string
  value: string
}

/**
 * "Rename exported databases/tables/columns": defined aliases and pickers for new ones. The
 * column field is `aliases[db][tables][t][colums][c]` as in phpMyAdmin (which never reads it).
 * pma: resources/templates/export.twig (#renameExportModal), resources/js/export.ts (addAlias, createAliasModal)
 */
export function AliasDialog({
  server,
  db: currentDb,
  table: currentTable,
  open,
  rows,
  onRows,
  onOpenChange,
}: {
  server: number
  db: string
  table: string
  open: boolean
  rows: AliasRow[]
  onRows: (rows: AliasRow[]) => void
  onOpenChange: (open: boolean) => void
}) {
  const [db, setDb] = useState('')
  const [table, setTable] = useState('')
  const [column, setColumn] = useState('')
  const [dbAlias, setDbAlias] = useState('')
  const [tableAlias, setTableAlias] = useState('')
  const [columnAlias, setColumnAlias] = useState('')
  const dbs = useQuery({
    queryKey: qk.exportAliasNames(server, ''),
    queryFn: () => api.exportAliasNames(server, ''),
    enabled: open && currentDb === '',
  })
  // pma: export.ts #db_alias_select change → POST /tables, #table_alias_select change → POST /columns
  const tables = useQuery({
    queryKey: qk.tableNames(server, db),
    queryFn: () => api.tableNames(server, db),
    enabled: open && db !== '' && currentTable === '',
  })
  const columns = useQuery({
    queryKey: qk.columnNames(server, db, table),
    queryFn: () => api.columnNames(server, db, table),
    enabled: open && db !== '' && table !== '',
  })
  const dbOptions = currentDb !== '' ? [currentDb] : (dbs.data?.names ?? [])
  const tableOptions = db === '' ? [] : currentTable !== '' ? [currentTable] : (tables.data?.tables ?? [])
  const add = (type: string, label: string, name: string, value: string) =>
    onRows([...rows.filter((r) => r.name !== name), { type, label, name, value }])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl" id="renameExportModal">
        <DialogHeader>
          <DialogTitle>{t('Rename exported databases/tables/columns')}</DialogTitle>
        </DialogHeader>
        <DialogBody className="overflow-auto">
          <table className="mb-3 w-full text-[13px]" id="alias_data">
            <thead>
              <tr>
                <th colSpan={4} className="text-start">
                  {t('Defined aliases')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <th className="text-start">{r.type}</th>
                  <td>{r.label}</td>
                  <td>
                    <Input
                      name={r.name}
                      value={r.value}
                      type="text"
                      onChange={(e) =>
                        onRows(
                          rows.map((x) => (x.name === r.name ? { ...x, value: e.currentTarget.value } : x)),
                        )
                      }
                    />
                  </td>
                  <td>
                    <Button
                      type="button"
                      variant="secondary"
                      className="alias_remove"
                      onClick={() => onRows(rows.filter((x) => x.name !== r.name))}
                    >
                      {t('Remove')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="w-full text-[13px]">
            <thead>
              <tr>
                <th colSpan={4} className="text-start">
                  {t('Define new aliases')}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <label htmlFor="db_alias_select">{t('Select database:')}</label>
                </td>
                <td>
                  <NativeSelect
                    id="db_alias_select"
                    value={db}
                    onChange={(e) => {
                      setDb(e.currentTarget.value)
                      setTable(currentTable !== '' && e.currentTarget.value !== '' ? currentTable : '')
                      setColumn('')
                    }}
                  >
                    <option value="" />
                    {dbOptions.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </NativeSelect>
                </td>
                <td>
                  <Input
                    id="db_alias_name"
                    placeholder={t('New database name')}
                    disabled={db === ''}
                    value={dbAlias}
                    onChange={(e) => setDbAlias(e.currentTarget.value)}
                  />
                </td>
                <td>
                  <Button
                    id="db_alias_button"
                    type="button"
                    variant="secondary"
                    disabled={db === ''}
                    onClick={() => {
                      add(pgettext('Alias', 'Database'), db, `aliases[${db}][alias]`, dbAlias)
                      setDbAlias('')
                    }}
                  >
                    {t('Add')}
                  </Button>
                </td>
              </tr>
              <tr>
                <td>
                  <label htmlFor="table_alias_select">{t('Select table:')}</label>
                </td>
                <td>
                  <NativeSelect
                    id="table_alias_select"
                    value={table}
                    onChange={(e) => {
                      setTable(e.currentTarget.value)
                      setColumn('')
                    }}
                  >
                    <option value="" />
                    {tableOptions.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </NativeSelect>
                </td>
                <td>
                  <Input
                    id="table_alias_name"
                    placeholder={t('New table name')}
                    disabled={table === ''}
                    value={tableAlias}
                    onChange={(e) => setTableAlias(e.currentTarget.value)}
                  />
                </td>
                <td>
                  <Button
                    id="table_alias_button"
                    type="button"
                    variant="secondary"
                    disabled={table === ''}
                    onClick={() => {
                      add(
                        pgettext('Alias', 'Table'),
                        `${db}.${table}`,
                        `aliases[${db}][tables][${table}][alias]`,
                        tableAlias,
                      )
                      setTableAlias('')
                    }}
                  >
                    {t('Add')}
                  </Button>
                </td>
              </tr>
              <tr>
                <td>
                  <label htmlFor="column_alias_select">{t('Select column:')}</label>
                </td>
                <td>
                  <NativeSelect
                    id="column_alias_select"
                    value={column}
                    onChange={(e) => setColumn(e.currentTarget.value)}
                  >
                    <option value="" />
                    {(table === '' ? [] : (columns.data?.columns ?? [])).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </NativeSelect>
                </td>
                <td>
                  <Input
                    id="column_alias_name"
                    placeholder={t('New column name')}
                    disabled={column === ''}
                    value={columnAlias}
                    onChange={(e) => setColumnAlias(e.currentTarget.value)}
                  />
                </td>
                <td>
                  <Button
                    id="column_alias_button"
                    type="button"
                    variant="secondary"
                    disabled={column === ''}
                    onClick={() => {
                      add(
                        pgettext('Alias', 'Column'),
                        `${db}.${table}.${column}`,
                        `aliases[${db}][tables][${table}][colums][${column}]`,
                        columnAlias,
                      )
                      setColumnAlias('')
                    }}
                  >
                    {t('Add')}
                  </Button>
                </td>
              </tr>
            </tbody>
          </table>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" id="saveAndCloseBtn" onClick={() => onOpenChange(false)}>
            {t('Save & close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
