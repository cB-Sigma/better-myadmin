import type { CentralColumn } from '@bettermyadmin/contracts'
import { Button, MessageBox, Modal } from '@bettermyadmin/ui'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api, errorMessage } from '../../../lib/api'
import { t } from '../../../lib/i18n'
import { qk } from '../../../lib/queryKeys'
import type { ColumnRow } from './ColumnForm'

/**
 * "Pick from Central Columns": the column selector of the column definition form, listing the
 * central columns of the database the table does not have yet; Pick fills the row.
 *
 * pma: resources/templates/columns_definitions/column_name.twig (a.central_columns_dialog),
 *      resources/js/modules/functions.ts (central_columns_dialog click, autoPopulate),
 *      src/Controllers/Database/CentralColumnsController.php (getColumnList → getListRaw)
 */
export function CentralColumnPicker({
  server,
  db,
  table,
  maxRows,
  onPick,
  onClose,
}: {
  server: number
  db: string
  /** cur_table ('' on Create table: the whole list) */
  table: string
  maxRows: number
  onPick: (patch: Partial<ColumnRow>) => void
  onClose: () => void
}) {
  const q = useQuery({
    queryKey: qk.dbPage({ server, db }, 'central-columns-list', { table }),
    queryFn: () => api.dbCentralColumnsList({ server, db }, table),
  })
  const [shown, setShown] = useState(maxRows)
  const [filter, setFilter] = useState('')
  const list = q.data ?? []
  const label = (c: CentralColumn) =>
    `${c.type}${c.attribute !== '' ? `(${c.attribute}) ` : ''}${c.length !== '' ? `(${c.length}) ` : ''}${c.extra}`
  // $.uiTableFilter: rows whose text contains every word of the filter (case-insensitive)
  const words = filter
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w !== '')
  const visible = list
    .slice(0, shown)
    .filter((c) => words.every((w) => `${c.name} ${label(c)}`.toLowerCase().includes(w)))
  return (
    <Modal
      open
      onClose={onClose}
      id="centralColumnsModal"
      title={t('Column selector')}
      footer={
        <>
          {list.length > shown && (
            <Button variant="secondary" id="seeMore" onClick={() => setShown(shown + maxRows)}>
              {t('See more')}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            {t('Close')}
          </Button>
        </>
      }
    >
      {q.isError && <MessageBox {...errorMessage(q.error)} />}
      {q.data !== undefined && list.length === 0 ? (
        t(
          'No columns in the central list. Make sure the Central columns list for database %s has columns that are not present in the current table.',
          `'${db}'`,
        )
      ) : (
        <>
          <input
            type="text"
            className="input filter_rows mb-2"
            placeholder={t('Search this list')}
            aria-label={t('Search this list')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <table id="col_list" className="values w-full text-sm">
            <tbody>
              {visible.map((c) => (
                <tr key={c.name}>
                  <td className="py-1">
                    <div>
                      <span className="font-bold">{c.name}</span>
                      <br />
                      <span className="text-fg-muted">{label(c)}</span>
                    </div>
                  </td>
                  <td className="py-1">
                    <Button
                      variant="secondary"
                      className="pick w-full"
                      onClick={() => {
                        onPick(autoPopulate(c))
                        onClose()
                      }}
                    >
                      {t('Pick')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Modal>
  )
}

/**
 * functions.ts::autoPopulate. As upstream, every non-empty stored default ends up "As defined:"
 * with the stored text (the NULL / CURRENT_TIMESTAMP branch is overwritten by the next if/else).
 */
export function autoPopulate(c: CentralColumn): Partial<ColumnRow> {
  const stored = c.default ?? ''
  return {
    name: c.name,
    type: c.type.toUpperCase(),
    length: c.length,
    defaultType: stored === '' ? 'NONE' : 'USER_DEFINED',
    defaultValue: stored === '' ? '' : stored,
    collation: c.collation,
    attribute: c.extra === 'on update CURRENT_TIMESTAMP' ? c.extra : c.attribute,
    autoIncrement: c.extra.toUpperCase() === 'AUTO_INCREMENT',
    null: c.isNull,
  }
}
