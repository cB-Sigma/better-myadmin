import type { DbPager, SqlMessage } from '@bettermyadmin/contracts'
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  MessageBox,
  NativeSelect,
  Panel,
  PanelBody,
} from '@bettermyadmin/ui'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../../lib/api'
import { pgettext, t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'
import { useLockPage } from '../shell/page-chrome'
import { HighlightedSql } from '../sql/HighlightedSql'
import { SqlEditor } from '../sql/editor/SqlEditor'
import type { SqlEditorHandle } from '../sql/editor/types'

/** Shared bits of the database pages (compositions of packages/ui and the SQL message card). */

/** A dynamic in-app path for <Link to> */
export const path = (p: string): string => p
export const enc = encodeURIComponent
export const dbBase = (server: number, db: string): string => `/s/${server}/db/${enc(db)}`
export const tableBase = (server: number, db: string, table: string): string =>
  `${dbBase(server, db)}/t/${enc(table)}`

/** Generator::getMessage: the message and the SQL under it. */
export function Messages({ messages }: { messages: SqlMessage[] }) {
  return (
    <>
      {messages.map((m, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: message list
          key={i}
          className={`mb-3 overflow-hidden rounded-(--radius) ${m.sql !== undefined && m.sql !== '' ? 'border border-border' : ''}`}
        >
          <MessageBox type={m.type} text={m.text} flush className="border-0" />
          {m.sql !== undefined && m.sql !== '' && (
            <HighlightedSql sql={m.sql} className="bg-bg-inset px-3 py-2" />
          )}
        </div>
      ))}
    </>
  )
}

/** An API error as a message card (MySQL errors keep their SQL). */
export function errorMessage(e: unknown): SqlMessage {
  if (e instanceof ApiError) {
    const sql = e.envelope.sql
    const text =
      e.envelope.errno !== undefined ? `#${e.envelope.errno} - ${e.envelope.message}` : e.envelope.message
    return sql === undefined ? { type: 'error', text } : { type: 'error', text, sql }
  }
  return { type: 'error', text: String(e) }
}

/** ForeignKey::isCheckEnabled for the "Enable foreign key checks" boxes */
export function useDefaultFkCheck(server: number): boolean {
  const q = useQuery({
    queryKey: qk.defaultFkCheck(server),
    queryFn: () => api.defaultFkCheck(server),
  })
  return q.data?.defaultFkCheckValue ?? true
}

/** Generator::getListNavigator (list_navigator.twig) */
export function ListNavigator({ pager, onPos }: { pager: DbPager | null; onPos: (pos: number) => void }) {
  if (pager === null) return null
  const link = (pos: number | null, label: string, title: string) =>
    pos === null ? null : (
      <Button variant="link" onClick={() => onPos(pos)} title={title}>
        {label}
      </Button>
    )
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 text-sm print:hidden" data-testid="list-navigator">
      {link(pager.begin, '<<', pgettext('First page', 'Begin'))}
      {link(pager.prev, '<', pgettext('Previous page', 'Previous'))}
      <Label className="flex items-center gap-1">
        {t('Page number:')}
        <NativeSelect
          className="w-auto"
          value={pager.pages.find((p) => p.selected)?.value ?? pager.pos}
          onChange={(e) => onPos(Number(e.target.value))}
        >
          {pager.pages.map((p) => (
            <option key={p.value} value={p.value}>
              {p.page}
            </option>
          ))}
        </NativeSelect>
      </Label>
      {link(pager.next, '>', pgettext('Next page', 'Next'))}
      {link(pager.end, '>>', pgettext('Last page', 'End'))}
    </div>
  )
}

/** database/create_table.twig — the "Create new table" box */
export function CreateTableBox({ server, db }: { server: number; db: string }) {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [cols, setCols] = useState(4)
  // `lock-page`: a changed form asks before leaving the page, its own submit does not
  const [submitted, setSubmitted] = useState(false)
  useLockPage(!submitted && (name !== '' || cols !== 4))
  useEffect(() => {
    if (!submitted) return
    void navigate({
      to: path(`${dbBase(server, db)}/create-table`),
      search: { table: name, num_fields: cols } as never,
    })
  }, [submitted, navigate, server, db, name, cols])
  return (
    <form
      id="createTableMinimalForm"
      className="lock-page mb-3 print:hidden"
      onSubmit={(e) => {
        e.preventDefault()
        setSubmitted(true)
      }}
    >
      <Panel title={t('Create new table')}>
        <PanelBody className="flex flex-wrap items-end gap-3 [&_input]:max-w-48">
          <Label className="flex flex-col gap-1">
            {t('Table name')}
            <Input
              type="text"
              name="table"
              id="createTableNameInput"
              maxLength={64}
              autoComplete="off"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Label>
          <Label className="flex flex-col gap-1">
            {t('Number of columns')}
            <Input
              type="number"
              name="num_fields"
              id="createTableNumFieldsInput"
              min={1}
              className="max-w-48"
              value={cols}
              onChange={(e) => setCols(Number(e.target.value))}
              required
            />
          </Label>
        </PanelBody>
        <div className="flex justify-end border-t border-border px-3 py-2">
          <Button type="submit" variant="primary">
            {t('Create')}
          </Button>
        </div>
      </Panel>
    </form>
  )
}

/** The modal of the bulk sub-forms (#bulkActionModal) on packages/ui's Dialog. */
export function DbModal({
  title,
  onClose,
  children,
  footer,
  wide = false,
  id,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
  id?: string
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        size={wide ? 'xl' : 'md'}
        {...(id !== undefined ? { id } : {})}
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogBody>{children}</DialogBody>
        {footer !== undefined && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  )
}

/**
 * The routine / event / trigger definition and the multi-table query box: the SQL editor
 * (CodeMirror with $cfg['CodemirrorEnable']) kept in step with a controlled value, so Format and
 * Update query can replace the text.
 * pma: resources/js/database/routines.ts (CodeMirror.fromTextArea on textarea[name=item_definition]),
 *      resources/js/database/multi_table_query.ts (CodeMirror on #MultiSqlquery)
 */
export function DefinitionEditor({
  id,
  label,
  value,
  onChange,
  codemirror,
  rows = 15,
}: {
  id?: string
  label: string
  value: string
  onChange: (v: string) => void
  codemirror: boolean
  rows?: number
}) {
  const h = useRef<SqlEditorHandle>(null)
  useEffect(() => {
    const cur = h.current
    if (cur !== null && cur.getValue() !== value) cur.setValue(value)
  }, [value])
  return (
    <SqlEditor
      handleRef={h}
      {...(id !== undefined ? { id } : {})}
      ariaLabel={label}
      initialValue={value}
      onChange={onChange}
      rows={rows}
      codemirror={codemirror}
      lint={null}
      autocomplete={null}
    />
  )
}
