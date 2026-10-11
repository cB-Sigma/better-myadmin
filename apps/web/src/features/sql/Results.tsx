import type { StatementResult } from '@bettermyadmin/contracts'
import { MessageBox } from '@bettermyadmin/ui'
import { ProfilingCard } from './ProfilingCard'
import { ResultGrid } from './ResultGrid'
import { type CardEnv, SqlMessage } from './SqlMessage'

/**
 * Everything one statement renders: the card, the profiling chart, the results table (one per result
 * set for CALL) and the warnings. Every statement of a multi-statement run gets its own block.
 * pma: src/Sql.php::executeQueryAndGetQueryResponse
 */
export function StatementBlock({ st, env }: { st: StatementResult; env: CardEnv }) {
  // import mode: the SQL tab shows only data.message (the transcript card is not displayed)
  if (st.kind === 'import') {
    return <MessageBox type={st.message.type} text={st.message.text} />
  }
  const showGrid = st.result !== undefined && st.result.fields.length > 0
  return (
    <section className="sqlqueryresults mb-4" data-kind={st.kind}>
      {st.kind === 'resultset' || st.kind === 'empty' ? (
        <>
          {/* procedures: the first result set's card, then each further set's own card */}
          <SqlMessage st={st} env={env} />
          {st.profiling !== undefined && (
            <ProfilingCard profiling={st.profiling} versionInt={env.versionInt} />
          )}
          {showGrid && st.result!.numRows > 0 && (
            <ResultGrid fields={st.result!.fields} rows={st.result!.rows} />
          )}
          {showGrid && st.result!.numRows === 0 && st.kind === 'empty' && (
            <ResultGrid fields={st.result!.fields} rows={[]} />
          )}
        </>
      ) : (
        <>
          <SqlMessage st={st} env={env} />
          {st.profiling !== undefined && (
            <ProfilingCard profiling={st.profiling} versionInt={env.versionInt} />
          )}
        </>
      )}
      {(st.moreResults ?? []).map((r, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: result sets are positional
        <div key={i} className="mt-3">
          <SqlMessage st={st} env={env} message={r.message} />
          <ResultGrid fields={r.fields} rows={r.rows} />
        </div>
      ))}
      {st.warnings.map((w, i) => (
        <MessageBox
          // biome-ignore lint/suspicious/noArrayIndexKey: warnings are positional
          key={i}
          type="notice"
          text={`${w.level}: #${w.code}${w.message !== '' ? ` ${w.message}` : ''}`}
          flush
          className="mt-2"
        />
      ))}
    </section>
  )
}
