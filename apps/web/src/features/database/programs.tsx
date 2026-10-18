import type { DbExportResponse, SqlMessage } from '@bettermyadmin/contracts'
import {
  Button,
  Checkbox,
  IconText,
  Input,
  Label,
  MySqlDocLink,
  PmaIcon,
  type PmaIconName,
  Textarea,
  showMessage,
  useConfirm,
} from '@bettermyadmin/ui'
import { useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'
import { t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'
import { runQuery } from '../sql/runner'
import { DbModal, Messages, errorMessage } from './common'

/**
 * The list page shared by Routines, Events and Triggers (rte lists): heading, Check all / Export /
 * Drop, the search filter, "Create new …", the table, export modal and drop confirmations.
 * pma: templates/database/routines/index.twig, events/index.twig, triggers/list.twig,
 *      resources/js/database/routines.ts (dropDialog, exportDialog), modules/functions.ts
 */
export interface ProgramItem {
  name: string
  dropSql: string
  /** the Export action: active (true), greyed out (false) */
  exportable: boolean
  cells: ReactNode[]
  actions: ReactNode[]
}

export function ProgramListPage({
  server,
  db,
  table = '',
  icon,
  title,
  docLink,
  headers,
  actionCols,
  items,
  canCreate,
  createIcon,
  createLabel,
  onCreate,
  empty,
  messages,
  setMessages,
  onExport,
  before,
  after,
  disabledNotice,
  tableId,
  filterable = false,
  noExportable = false,
}: {
  /** routines.ts: a bulk export without an exportable selection says "No routine is exportable…" */
  noExportable?: boolean
  server: number
  db: string
  table?: string
  /** the name filter (only the Routines list has one) */
  filterable?: boolean
  icon: PmaIconName
  title: string
  docLink: string
  headers: string[]
  actionCols: number
  items: ProgramItem[]
  canCreate: boolean
  createIcon: PmaIconName
  createLabel: string
  onCreate: () => void
  empty: string
  messages: SqlMessage[]
  setMessages: (m: SqlMessage[]) => void
  /** the export text of one item (null when it cannot be exported) */
  onExport: (name: string) => Promise<DbExportResponse | null>
  before?: ReactNode
  after?: ReactNode
  /** replaces the toolbar, the list and `after` (the Events page with the scheduler DISABLED) */
  disabledNotice?: string | undefined
  tableId: string
}) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [selected, setSelected] = useState<string[]>([])
  const [filter, setFilter] = useState('')
  const [exported, setExported] = useState<DbExportResponse | null>(null)
  const any = items.length > 0
  const needle = filter.toUpperCase()
  const shown = items.filter((i) => i.name.toUpperCase().includes(needle))
  const refresh = async () => {
    setSelected([])
    await qc.invalidateQueries({ queryKey: qk.db({ server, db }) })
    await qc.invalidateQueries({ queryKey: qk.nav(server) })
  }
  const drop = async (sqls: string[]) => {
    const out: SqlMessage[] = []
    for (const sql of sqls) {
      try {
        const r = await runQuery(server, { sql, db, ...(table !== '' ? { table } : {}) }, 'page')
        const err = r.statements.find((s) => s.kind === 'error')
        out.push(
          err !== undefined
            ? { type: 'error', text: err.message?.text ?? '', sql }
            : { type: 'success', text: t('Your SQL query has been executed successfully.'), sql },
        )
      } catch (e) {
        out.push(errorMessage(e))
      }
    }
    setMessages(out)
    await refresh()
  }
  const dropOne = async (item: ProgramItem) => {
    if (
      !(await confirm({
        question: t('Do you really want to execute "%s"?', item.dropSql),
        destructive: true,
      }))
    )
      return
    await drop([item.dropSql])
  }
  const bulkDrop = async () => {
    if (selected.length === 0) return
    if (
      !(await confirm({ question: t('Do you really want to delete the selected items?'), destructive: true }))
    )
      return
    await drop(items.filter((i) => selected.includes(i.name)).map((i) => i.dropSql))
  }
  /**
   * Export dialog of one row, or of the selection (#bulkActionExportButton): the selection's
   * exports go one after the other into one "Export" text, each as `\n<sql>\n`; one failure shows
   * the errors instead (routines.ts / triggers.ts exportDialog, `combined`).
   */
  const exportItems = async (names: string[], bulk = false) => {
    if (bulk && names.length === 0) {
      if (noExportable) showMessage(t('No routine is exportable. Required privileges may be lacking.'))
      return
    }
    const parts: DbExportResponse[] = []
    const errors: string[] = []
    for (const n of names) {
      try {
        const r = await onExport(n)
        if (r !== null) parts.push(r)
      } catch (e) {
        errors.push(errorMessage(e).text)
      }
    }
    if (errors.length > 0) {
      if (bulk) showMessage(errors.map((e) => `\n${e}\n`).join(''), false, 'error')
      else setMessages(errors.map((text) => ({ type: 'error', text })))
      return
    }
    if (parts.length === 0) {
      setMessages([
        { type: 'error', text: t('No routine is exportable. Required privileges may be lacking.') },
      ])
      return
    }
    setExported(
      bulk
        ? { title: t('Export'), sql: parts.map((p) => `\n${p.sql}\n`).join('') }
        : (parts[0] as DbExportResponse),
    )
  }
  return (
    <div className="my-3">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
        <IconText icon={icon} text={title} /> <MySqlDocLink link={docLink} />
      </h2>
      <Messages messages={messages} />
      {before}
      {disabledNotice !== undefined ? (
        // events/index.twig: scheduler_state DISABLED shows the notice only
        <Messages messages={[{ type: 'notice', text: disabledNotice }]} />
      ) : (
        <>
          <div className="my-3 flex flex-wrap items-center gap-2">
            {any && (
              <>
                <Label className="flex items-center gap-2 rounded border border-border px-2 py-1">
                  <Checkbox
                    id="checkAllCheckbox"
                    checked={selected.length > 0 && selected.length === items.length}
                    onCheckedChange={(v) => setSelected(v === true ? items.map((i) => i.name) : [])}
                  />
                  {t('Check all')}
                </Label>
                <Button
                  id="bulkActionExportButton"
                  title={t('Export')}
                  onClick={() =>
                    void exportItems(
                      items.filter((i) => selected.includes(i.name) && i.exportable).map((i) => i.name),
                      true,
                    )
                  }
                >
                  <IconText icon="b_export" text={t('Export')} />
                </Button>
                <Button id="bulkActionDropButton" title={t('Drop')} onClick={() => void bulkDrop()}>
                  <IconText icon="b_drop" text={t('Drop')} />
                </Button>
                {filterable && (
                  <div className="ms-auto flex items-center gap-1">
                    <PmaIcon name="b_search" alt={t('Search')} />
                    <Input
                      id="filterText"
                      className="max-w-60"
                      placeholder={t('Search')}
                      aria-label={t('Search')}
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    />
                  </div>
                )}
              </>
            )}
            <Button variant="primary" className="add_anchor" disabled={!canCreate} onClick={onCreate}>
              <IconText icon={createIcon} text={createLabel} />
            </Button>
          </div>
          {!any ? (
            <div id="nothing2display">
              <Messages messages={[{ type: 'notice', text: empty }]} />
            </div>
          ) : (
            <table
              id={tableId}
              className="w-auto border-collapse text-sm [&_td]:px-2 [&_td]:py-1 [&_th]:px-2 [&_th]:py-1"
            >
              <thead>
                <tr className="bg-grid-header text-left">
                  <th />
                  {headers.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                  <th colSpan={actionCols} />
                </tr>
              </thead>
              <tbody>
                {shown.map((item) => (
                  <tr key={item.name} className="odd:bg-grid-odd even:bg-grid-even hover:bg-grid-hover">
                    <td>
                      <Checkbox
                        aria-label={item.name}
                        checked={selected.includes(item.name)}
                        onCheckedChange={(v) =>
                          setSelected(
                            v === true ? [...selected, item.name] : selected.filter((x) => x !== item.name),
                          )
                        }
                      />
                    </td>
                    <td>
                      <strong>{item.name}</strong>
                    </td>
                    {item.cells.map((c, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: positional cells
                      <td key={i}>{c}</td>
                    ))}
                    {item.actions.map((a, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: positional actions
                      <td key={i}>{a}</td>
                    ))}
                    <td>
                      <RowAction
                        icon="b_export"
                        text={t('Export')}
                        enabled={item.exportable}
                        className="export_anchor"
                        onClick={() => void exportItems([item.name])}
                      />
                    </td>
                    <td>
                      <Button variant="link" className="drop_anchor" onClick={() => void dropOne(item)}>
                        <IconText icon="b_drop" text={t('Drop')} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {after}
        </>
      )}
      {exported !== null && (
        <DbModal
          title={exported.title}
          onClose={() => setExported(null)}
          footer={<Button onClick={() => setExported(null)}>{t('Close')}</Button>}
        >
          <Textarea rows={15} readOnly value={exported.sql} className="font-mono text-xs" />
        </DbModal>
      )}
    </div>
  )
}

/** An action link of a row: active, or greyed out when the user lacks the privilege. */
export function RowAction({
  icon,
  text,
  enabled = true,
  onClick,
  className,
}: { icon: PmaIconName; text: string; enabled?: boolean; onClick: () => void; className?: string }) {
  if (!enabled) {
    return (
      <span className="opacity-50">
        <IconText icon={icon} text={text} />
      </span>
    )
  }
  return (
    <Button variant="link" className={className} onClick={onClick}>
      <IconText icon={icon} text={text} />
    </Button>
  )
}

/** A row of the editors' two-column table (rte_table) */
export function EditorRow({
  label,
  children,
  hidden = false,
}: { label: ReactNode; children: ReactNode; hidden?: boolean }) {
  if (hidden) return null
  return (
    <tr className="align-top">
      <td className="whitespace-nowrap py-1 pr-3">{label}</td>
      <td className="w-full py-1">{children}</td>
    </tr>
  )
}

/** The editor modal's footer: Close / Save changes */
export function EditorFooter({ onClose, onSave }: { onClose: () => void; onSave: () => void }) {
  return (
    <>
      <Button onClick={onClose}>{t('Close')}</Button>
      <Button variant="primary" onClick={onSave}>
        {t('Save changes')}
      </Button>
    </>
  )
}
