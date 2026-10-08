import type { SqlCard, StatementResult } from '@bettermyadmin/contracts'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, CircleHelp, XCircle } from 'lucide-react'
import { createContext, useContext, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { mysqlDocUrl } from '../../lib/docs'
import { HighlightedSql } from './HighlightedSql'
import { SqlEditor } from './editor/SqlEditor'
import type { SqlEditorHandle } from './editor/types'

const styles = {
  success: { box: 'border-success/40 bg-success-bg text-success', Icon: CheckCircle2 },
  notice: { box: 'border-notice/40 bg-notice-bg text-notice', Icon: AlertTriangle },
  error: { box: 'border-error/40 bg-error-bg text-error', Icon: XCircle },
} as const

/** What a link of the card asks the page to do. */
export type CardAction =
  | {
      type: 'run'
      sql: string
      db: string
      table: string
      showAsPhp?: boolean
      profiling?: boolean
      sig?: string
      fkChecks?: boolean
    }
  | { type: 'edit'; sql: string; db: string; table: string }

/** Only one inline editor is open at a time (onloadSqlQueryEditEvents). */
export const InlineEditContext = createContext<{ open: string | null; setOpen: (k: string | null) => void }>({
  open: null,
  setOpen: () => {},
})

export interface CardEnv {
  server: number
  versionInt: number
  /** The page's checkSqlQuery (empty / confirm), returns whether to go on. */
  confirmQuery: (sql: string) => boolean
  codemirror: boolean
  onAction: (a: CardAction) => void
}

export function DocIcon({ href, target = 'mysql_doc' }: { href: string; target?: string }) {
  return (
    <a
      href={href}
      target={target}
      rel="noopener noreferrer"
      title="Documentation"
      className="inline-flex align-middle"
    >
      <CircleHelp className="size-3.5" aria-hidden />
      <span className="sr-only">Documentation</span>
    </a>
  )
}

/** The message alert (Message::getMessageWithIcon). */
export function MessageBox({
  type,
  text,
  className = '',
}: { type: keyof typeof styles; text: string; className?: string }) {
  const { box, Icon } = styles[type]
  return (
    <div
      className={`flex items-start gap-2 border px-3 py-2 text-sm ${box} ${className}`}
      role={type === 'error' ? 'alert' : 'status'}
      data-message-type={type}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 whitespace-pre-line">{text}</div>
    </div>
  )
}

/**
 * The executed-query card: message, SQL, and Edit inline / Edit / Explain / PHP / Refresh links.
 * pma: src/Html/Generator.php::getMessage, resources/js/modules/functions.ts::onloadSqlQueryEditEvents
 */
export function SqlMessage({ st, env, message }: { st: StatementResult; env: CardEnv; message?: string }) {
  const text = message ?? st.message.text
  if (st.kind === 'error' && st.error !== undefined) return <ErrorCard st={st} env={env} />
  const card = st.card
  if (card === null || card === undefined) {
    return <MessageBox type={st.message.type} text={text} className="mb-3 rounded" />
  }
  return (
    <div className="result_query mb-3 overflow-hidden rounded border border-border">
      <MessageBox type={st.message.type} text={text} className="rounded-t border-x-0 border-t-0" />
      <SqlCardBody card={card} st={st} env={env} />
    </div>
  )
}

function SqlCardBody({ card, st, env }: { card: SqlCard; st: StatementResult; env: CardEnv }) {
  const { open, setOpen } = useContext(InlineEditContext)
  const key = useRef(`${Math.random()}`).current
  const editing = open === key
  const l = card.links
  const link = 'cursor-pointer text-accent hover:underline'
  return (
    <>
      <div className="sqlOuter bg-bg-inset px-3 py-2">
        {editing ? (
          <InlineEditor card={card} env={env} onClose={() => setOpen(null)} />
        ) : (
          <HighlightedSql sql={card.display} versionInt={env.versionInt} highlight={!card.php} />
        )}
      </div>
      <div className="tools flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-3 py-1.5 text-sm print:hidden">
        {l.profiling !== null && (
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              role="switch"
              aria-checked={l.profiling.checked}
              id={`profilingCheckbox-${key}`}
              checked={l.profiling.checked}
              onChange={(e) =>
                env.onAction({
                  type: 'run',
                  sql: card.sql,
                  db: card.db,
                  table: card.table,
                  profiling: e.target.checked,
                  sig: st.sig,
                })
              }
            />
            Profiling
          </label>
        )}
        {l.editInline && (
          <button
            type="button"
            className={`${link} inline_edit_sql`}
            onClick={() => open === null && setOpen(key)}
          >
            Edit inline
          </button>
        )}
        {l.edit && (
          <button
            type="button"
            className={link}
            onClick={() => env.onAction({ type: 'edit', sql: card.sql, db: card.db, table: card.table })}
          >
            Edit
          </button>
        )}
        {l.explain !== null && (
          <button
            type="button"
            className={link}
            onClick={() => env.onAction({ type: 'run', sql: l.explain!.sql, db: card.db, table: card.table })}
          >
            {l.explain.text}
          </button>
        )}
        {l.php === 'create' && (
          <button
            type="button"
            className={link}
            onClick={() =>
              env.onAction({ type: 'run', sql: card.sql, db: card.db, table: card.table, showAsPhp: true })
            }
          >
            Create PHP code
          </button>
        )}
        {l.php === 'without' && (
          <>
            <button
              type="button"
              className={link}
              onClick={() => env.onAction({ type: 'run', sql: card.sql, db: card.db, table: card.table })}
            >
              Without PHP code
            </button>
            <button
              type="button"
              className={link}
              onClick={() => env.onAction({ type: 'run', sql: card.sql, db: card.db, table: card.table })}
            >
              Submit query
            </button>
          </>
        )}
        {l.refresh && (
          <button
            type="button"
            className={link}
            onClick={() =>
              env.onAction({ type: 'run', sql: card.sql, db: card.db, table: card.table, sig: st.sig })
            }
          >
            Refresh
          </button>
        )}
      </div>
    </>
  )
}

/** The inline query editor with its foreign key checkbox, Go and Cancel. */
function InlineEditor({ card, env, onClose }: { card: SqlCard; env: CardEnv; onClose: () => void }) {
  const editor = useRef<SqlEditorHandle>(null)
  // pma: /sql/get-default-fk-check-value, loaded when the editor opens
  const fk = useQuery({
    queryKey: ['srv', env.server, 'defaultFkCheck'],
    queryFn: () => api.defaultFkCheck(env.server),
  })
  const [fkChecks, setFkChecks] = useState<boolean | null>(null)
  const checked = fkChecks ?? fk.data?.defaultFkCheckValue ?? false
  const save = () => {
    const sql = editor.current?.getValue() ?? ''
    if (!env.confirmQuery(sql)) return
    env.onAction({ type: 'run', sql, db: card.db, table: card.table, fkChecks: checked })
    onClose()
  }
  const saveKey = () => {
    save()
    return true
  }
  return (
    <div id="inline_editor_outer">
      <SqlEditor
        handleRef={editor}
        id="sql_query_edit"
        ariaLabel="SQL query"
        initialValue={card.sql.trim()}
        rows={5}
        codemirror={env.codemirror}
        lint={null}
        autocomplete={null}
        // catchKeypressesFromSqlInlineEdit: Ctrl/Cmd+Enter saves
        keys={[
          { key: 'Ctrl-Enter', run: saveKey },
          { key: 'Mod-Enter', run: saveKey },
        ]}
      />
      <div className="mt-1 mb-2 flex items-center gap-1 text-sm">
        {fk.isPending ? (
          <span className="text-fg-subtle">…</span>
        ) : (
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              name="fk_checks"
              checked={checked}
              onChange={(e) => setFkChecks(e.target.checked)}
            />
            Enable foreign key checks
          </label>
        )}
      </div>
      <div className="flex gap-2">
        <button type="button" id="sql_query_edit_save" className="btn" onClick={save}>
          Go
        </button>
        <button type="button" id="sql_query_edit_discard" className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}

/**
 * The error card.
 * pma: src/Html/Generator.php::mysqlDie
 */
export function ErrorCard({ st, env }: { st: StatementResult; env: Pick<CardEnv, 'versionInt'> }) {
  const e = st.error!
  const [copied, setCopied] = useState(false)
  return (
    <div
      role="alert"
      className="mb-3 rounded border border-error/40 bg-error-bg px-3 py-2 text-sm text-error"
    >
      <h2 className="mb-1 text-lg font-semibold">Error</h2>
      {e.sql !== null && (
        <>
          {e.staticAnalysis.length > 0 && (
            <>
              <p>
                <strong>Static analysis:</strong>
              </p>
              <p>{e.staticAnalysis.length} errors were found during analysis.</p>
              <ol className="ml-6 list-decimal">
                {e.staticAnalysis.map((a, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: positional list
                  <li key={i}>
                    {a.message} (near "{a.token}" at position {a.position})
                  </li>
                ))}
              </ol>
            </>
          )}
          <p className="mt-1 flex items-center gap-2">
            <strong>SQL query:</strong>
            <button
              type="button"
              className="copyQueryBtn text-accent hover:underline"
              onClick={() => {
                void navigator.clipboard?.writeText(st.executedSql.trim()).then(() => setCopied(true))
              }}
            >
              Copy
            </button>
            {copied && <span className="sr-only">copied</span>}
            {e.selectDoc && <DocIcon href={mysqlDocUrl('SELECT', '', env.versionInt)} />}
          </p>
          <HighlightedSql sql={e.sql} versionInt={env.versionInt} className="my-1 text-fg" />
        </>
      )}
      <p className="flex items-center gap-1">
        <strong>MySQL said: </strong>
        <DocIcon href={mysqlDocUrl('server-error-reference', '', env.versionInt)} />
      </p>
      <code className="whitespace-pre-wrap text-xs">{e.serverMessage}</code>
    </div>
  )
}
