import { Button, IconText } from '@bettermyadmin/ui'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'
import { Messages, errorMessage } from './common'

const tableClass =
  'mb-3 w-full border-collapse text-sm [&_td]:border-b [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left'

/**
 * Database → Data dictionary (print view of every table).
 * pma: templates/database/data_dictionary/index.twig (jsPrintButton: window.print)
 */
export function DataDictionaryPage({ server, db }: { server: number; db: string }) {
  const q = useQuery({
    queryKey: qk.dbPage(server, db, 'data-dictionary'),
    queryFn: () => api.dbDataDictionary(server, db),
  })
  if (q.isError) return <Messages messages={[errorMessage(q.error)]} />
  const d = q.data
  if (d === undefined) return null
  const print = (
    <p className="d-print-none my-3 print:hidden">
      <Button className="jsPrintButton" onClick={() => window.print()}>
        <IconText icon="b_print" text={t('Print')} forceText />
      </Button>
    </p>
  )
  return (
    <div className="container-fluid">
      <h1 className="text-2xl font-semibold">{d.db}</h1>
      {d.comment !== '' && (
        <p>
          {t('Database comment:')} <em>{d.comment}</em>
        </p>
      )}
      {print}
      <div>
        {d.tables.map((table) => (
          <div key={table.name}>
            <h2 className="mt-4 mb-2 text-xl font-semibold">{table.name}</h2>
            {table.comment !== '' && (
              <>
                {t('Table comments:')}
                <em>
                  <pre>{table.comment}</pre>
                </em>
              </>
            )}
            <table className={tableClass}>
              <thead>
                <tr className="bg-grid-header">
                  <th>{t('Column')}</th>
                  <th>{t('Type')}</th>
                  <th>{t('Null')}</th>
                  <th>{t('Default')}</th>
                  {table.hasRelation && <th>{t('Links to')}</th>}
                  <th>{t('Comments')}</th>
                  {table.hasMime && <th>{t('Media type')}</th>}
                </tr>
              </thead>
              <tbody>
                {table.columns.map((c) => (
                  <tr key={c.name} className="odd:bg-grid-odd even:bg-grid-even">
                    <td className="text-nowrap">
                      {c.name}
                      {c.isPrimary && (
                        <>
                          {' '}
                          <em>({t('Primary')})</em>
                        </>
                      )}
                    </td>
                    <td
                      lang="en"
                      dir="ltr"
                      className={c.type !== 'set' && c.type !== 'enum' ? 'text-nowrap' : ''}
                    >
                      {c.printType}
                    </td>
                    <td>{c.isNullable ? t('Yes') : t('No')}</td>
                    <td className="text-nowrap">
                      {c.default === null && c.isNullable ? <em>NULL</em> : c.default}
                    </td>
                    {table.hasRelation && <td>{c.relation}</td>}
                    <td>{c.comment}</td>
                    {table.hasMime && <td>{c.mime}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
            {table.indexes.length > 0 ? (
              <>
                <h3 className="mb-2 text-lg font-semibold">{t('Indexes')}</h3>
                <table className={tableClass}>
                  <thead>
                    <tr className="bg-grid-header">
                      <th>{t('Keyname')}</th>
                      <th>{t('Type')}</th>
                      <th>{t('Unique')}</th>
                      <th>{t('Packed')}</th>
                      <th>{t('Column')}</th>
                      <th>{t('Cardinality')}</th>
                      <th>{t('Collation')}</th>
                      <th>{t('Null')}</th>
                      <th>{t('Comment')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {table.indexes.flatMap((index) => {
                      const n = index.columns.length
                      return index.columns.map((c, i) => (
                        <tr key={`${index.name}-${c.name}`}>
                          {i === 0 && (
                            <>
                              <td rowSpan={n}>{index.name}</td>
                              <td rowSpan={n}>{index.type}</td>
                              <td rowSpan={n}>{index.unique ? t('Yes') : t('No')}</td>
                              <td rowSpan={n}>{index.packed}</td>
                            </>
                          )}
                          <td>
                            {c.name}
                            {c.subPart !== null && c.subPart !== 0 && ` (${c.subPart})`}
                          </td>
                          <td>{c.cardinality}</td>
                          <td>{c.collation}</td>
                          <td>{c.null}</td>
                          {i === 0 && <td rowSpan={n}>{index.comments}</td>}
                        </tr>
                      ))
                    })}
                  </tbody>
                </table>
              </>
            ) : (
              <p>{t('No index defined!')}</p>
            )}
          </div>
        ))}
      </div>
      {print}
    </div>
  )
}
