import type { SqlCard, StatementResult } from '@bettermyadmin/contracts'
import { MessageBox, MessageLine, MySqlDocLink, buttonVariants, mysqlDocUrl } from '@bettermyadmin/ui'
import { useQuery } from '@tanstack/react-query'
import { createContext, useContext, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { pgettext, t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'
import { HighlightedSql } from './HighlightedSql'
import { SqlEditor } from './editor/SqlEditor'
import type { SqlEditorHandle } from './editor/types'

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

/**
 * The executed-query card: message, SQL, and Edit inline / Edit / Explain / PHP / Refresh links.
 * pma: src/Html/Generator.php::getMessage, resources/js/modules/functions.ts::onloadSqlQueryEditEvents
 */
export function SqlMessage({ st, env, message }: { st: StatementResult; env: CardEnv; message?: string }) {
  const text = message ?? st.message.text
  if (st.kind === 'error' && st.error !== undefined) return <ErrorCard st={st} env={env} />
  const card = st.card
  if (card === null || card === undefined) {
    return <MessageBox type={st.message.type} text={text} />
  }
  return (
    <div className="result_query mb-3 overflow-hidden rounded border border-border">
      <MessageLine
        type={st.message.type}
        text={text}
        className="rounded-t border-x-0 border-t-0"
        role={st.message.type === 'error' ? 'alert' : 'status'}
        data-message-type={st.message.type}
      />
      <SqlCardBody card={card} sig={st.sig} env={env} />
    </div>
  )
}

/**
 * The same card for a message a page builds itself (Generator::getMessage outside /sql, e.g. the
 * binary log page): message line, SQL and the links, acting through `env`.
 */
export function QueryCard(props: {
  type: 'success' | 'notice' | 'error'
  text: string
  card: SqlCard
  sig: string
  env: CardEnv
}) {
  return (
    <div className="result_query mb-3 overflow-hidden rounded border border-border">
      <MessageLine
        type={props.type}
        text={props.text}
        className="rounded-t border-x-0 border-t-0"
        role={props.type === 'error' ? 'alert' : 'status'}
        data-message-type={props.type}
      />
      <SqlCardBody card={props.card} sig={props.sig} env={props.env} />
    </div>
  )
}

function SqlCardBody({ card, sig, env }: { card: SqlCard; sig: string; env: CardEnv }) {
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
                  sig,
                })
              }
            />
            {t('Profiling')}
          </label>
        )}
        {l.editInline && (
          <button
            type="button"
            className={`${link} inline_edit_sql`}
            onClick={() => open === null && setOpen(key)}
          >
            {pgettext('Inline edit query', 'Edit inline')}
          </button>
        )}
        {l.edit && (
          <button
            type="button"
            className={link}
            onClick={() => env.onAction({ type: 'edit', sql: card.sql, db: card.db, table: card.table })}
          >
            {t('Edit')}
          </button>
        )}
        {l.explain !== null && (
          <button
            type="button"
            className={link}
            onClick={() => env.onAction({ type: 'run', sql: l.explain!.sql, db: card.db, table: card.table })}
          >
            {/* msgid from the server: Explain SQL / Skip Explain SQL / Skip Analyze SQL */}
            {t(l.explain.text)}
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
            {t('Create PHP code')}
          </button>
        )}
        {l.php === 'without' && (
          <>
            <button
              type="button"
              className={link}
              onClick={() => env.onAction({ type: 'run', sql: card.sql, db: card.db, table: card.table })}
            >
              {t('Without PHP code')}
            </button>
            <button
              type="button"
              className={link}
              onClick={() => env.onAction({ type: 'run', sql: card.sql, db: card.db, table: card.table })}
            >
              {t('Submit query')}
            </button>
          </>
        )}
        {l.refresh && (
          <button
            type="button"
            className={link}
            onClick={() => env.onAction({ type: 'run', sql: card.sql, db: card.db, table: card.table, sig })}
          >
            {t('Refresh')}
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
    queryKey: qk.defaultFkCheck(env.server),
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
        autoFocus
        ariaLabel={t('SQL query')}
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
            {t('Enable foreign key checks')}
          </label>
        )}
      </div>
      <div className="flex gap-2">
        <button type="button" id="sql_query_edit_save" className={buttonVariants()} onClick={save}>
          {t('Go')}
        </button>
        <button type="button" id="sql_query_edit_discard" className={buttonVariants()} onClick={onClose}>
          {t('Cancel')}
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
      <h2 className="mb-1 text-lg font-semibold">{t('Error')}</h2>
      {e.sql !== null && (
        <>
          {e.staticAnalysis.length > 0 && (
            <>
              <p>
                <strong>{t('Static analysis:')}</strong>
              </p>
              <p>{t('%d errors were found during analysis.', e.staticAnalysis.length)}</p>
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
            <strong>{t('SQL query:')}</strong>
            <button
              type="button"
              className="copyQueryBtn text-accent hover:underline"
              onClick={() => {
                void navigator.clipboard?.writeText(st.executedSql.trim()).then(() => setCopied(true))
              }}
            >
              {t('Copy')}
            </button>
            {copied && <span className="sr-only">{t('Successfully copied!')}</span>}
            {e.selectDoc && <MySqlDocLink url={mysqlDocUrl('SELECT', '', env.versionInt)} />}
          </p>
          <HighlightedSql sql={e.sql} versionInt={env.versionInt} className="my-1 text-fg" />
        </>
      )}
      <p className="flex items-center gap-1">
        <strong>{t('MySQL said: ')}</strong>
        <MySqlDocLink url={mysqlDocUrl('server-error-reference', '', env.versionInt)} />
      </p>
      <code className="whitespace-pre-wrap text-xs">{e.serverMessage}</code>
    </div>
  )
}
