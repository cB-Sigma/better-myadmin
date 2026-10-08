import { useMutation, useQuery } from '@tanstack/react-query'
import { useParams, useSearch } from '@tanstack/react-router'
import { CircleHelp } from 'lucide-react'
import { type FormEvent, type KeyboardEvent, useRef, useState } from 'react'
import { ApiError, api } from '../../lib/api'
import { qk } from '../../lib/queryKeys'
import { ResultGrid } from './ResultGrid'
import { SqlMessage } from './SqlMessage'

/**
 * Server-scope SQL tab (bare query box for M0; CodeMirror, bookmarks, snippets etc. are M1).
 * pma: resources/templates/sql/query.twig, src/SqlQueryForm.php
 */
export function SqlPage() {
  const { server } = useParams({ from: '/s/$server' })
  const search = useSearch({ from: '/s/$server/sql' })
  const auth = useQuery({ queryKey: qk.auth, queryFn: api.authState })
  const label = auth.data?.servers.find((s) => s.index === server)?.label ?? ''
  const [sql, setSql] = useState(search.sql ?? '')
  const [delimiter, setDelimiter] = useState(';')
  const formRef = useRef<HTMLFormElement>(null)

  const run = useMutation({
    mutationFn: () => api.query(server, { sql, delimiter, fromQueryBox: true }),
  })

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (sql.trim() === '') {
      window.alert('Missing value in the form!')
      return
    }
    run.mutate()
  }

  // Ctrl+Enter / Alt+Enter submits the enclosing form (functions.ts getKeyboardFormSubmitEventHandler)
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.altKey || e.metaKey)) {
      e.preventDefault()
      formRef.current?.requestSubmit()
    }
  }

  return (
    <div>
      <form ref={formRef} id="sqlqueryform" onSubmit={onSubmit} className="mb-4 max-w-5xl rounded border border-border">
        <div className="flex items-center gap-1 border-b border-border bg-bg-subtle px-3 py-2 text-sm font-semibold">
          <span>Run SQL query/queries on server “{label}”:</span>
          <a href="https://dev.mysql.com/doc/refman/8.4/en/select.html" target="_blank" rel="noopener noreferrer" title="Documentation">
            <CircleHelp className="size-4" aria-hidden />
            <span className="sr-only">Documentation</span>
          </a>
        </div>
        <div className="p-3">
          <textarea
            id="sqlquery"
            name="sql_query"
            aria-label="SQL query"
            className="input min-h-60 font-mono"
            rows={15}
            cols={40}
            spellCheck={false}
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border bg-bg-subtle px-3 py-2 text-sm">
          <label htmlFor="id_sql_delimiter" className="flex items-center gap-1">
            Delimiter
            <input
              id="id_sql_delimiter"
              name="sql_delimiter"
              className="input w-12"
              size={3}
              value={delimiter}
              onChange={(e) => setDelimiter(e.target.value)}
            />
          </label>
          <input
            id="button_submit_query"
            type="submit"
            value="Go"
            disabled={run.isPending}
            className="cursor-pointer rounded bg-accent px-4 py-1 font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60"
          />
        </div>
      </form>

      <div id="sqlqueryresultsouter">
        {run.error instanceof ApiError && (
          <div role="alert" className="mb-3 rounded border border-error/40 bg-error-bg px-3 py-2 text-sm text-error">
            <div className="font-semibold">Error</div>
            {run.error.envelope.sql !== undefined && (
              <>
                <div className="mt-1 text-xs">SQL query:</div>
                <pre className="my-1 overflow-x-auto font-mono text-xs">{run.error.envelope.sql}</pre>
              </>
            )}
            <div className="text-xs">MySQL said:</div>
            <code className="text-xs">
              {run.error.envelope.errno !== undefined ? `#${run.error.envelope.errno} - ` : ''}
              {run.error.message}
            </code>
          </div>
        )}
        {run.data?.statements.map((st, i) => (
          <section key={`${i}-${st.sig}`} className="mb-4">
            <SqlMessage st={st} />
            {st.result !== undefined && st.result.fields.length > 0 && (
              <ResultGrid fields={st.result.fields} rows={st.result.rows} />
            )}
          </section>
        ))}
      </div>
    </div>
  )
}
