import type { DbSearchResponse, QueryResponse, SqlMessage } from '@bettermyadmin/contracts'
import {
  Button,
  Checkbox,
  Hint,
  Input,
  Label,
  MySqlDocLink,
  NativeSelect,
  Panel,
  PanelBody,
  PmaIcon,
  useConfirm,
} from '@bettermyadmin/ui'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '../../lib/api'
import { ngettext, t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'
import { InlineHtml } from '../shell/inline-html'
import { StatementBlock } from '../sql/Results'
import type { CardEnv } from '../sql/SqlMessage'
import { runQuery } from '../sql/runner'
import { path, Messages, errorMessage, tableBase } from './common'

/**
 * Database → Search.
 * pma: templates/database/search/{main,results}.twig, resources/js/database/search.ts
 */
export function SearchPage({ server, db }: { server: number; db: string }) {
  const confirm = useConfirm()
  const form = useQuery({
    queryKey: qk.dbPage({ server, db }, 'search-form'),
    queryFn: () => api.dbSearchForm({ server, db }),
  })
  const [searchString, setSearchString] = useState('')
  const [searchType, setSearchType] = useState('1')
  const [includeHex, setIncludeHex] = useState(false)
  const [selected, setSelected] = useState<string[] | null>(null)
  const [columnName, setColumnName] = useState('')
  const [results, setResults] = useState<DbSearchResponse | null>(null)
  const [showForm, setShowForm] = useState(true)
  const [showResults, setShowResults] = useState(true)
  const [messages, setMessages] = useState<SqlMessage[]>([])
  const [browse, setBrowse] = useState<{ table: string; response: QueryResponse } | null>(null)

  if (form.isError) return <Messages messages={[errorMessage(form.error)]} />
  if (form.data === undefined) return null
  const tables = selected ?? form.data.tables

  const submit = async () => {
    setBrowse(null)
    if (tables.length === 0) {
      setMessages([{ type: 'error', text: t('No table selected.') }])
      return
    }
    try {
      const r = await api.dbSearch(
        { server, db },
        { searchString, searchType, tables, columnName, includeHex },
      )
      setMessages([])
      setResults(r)
      setShowResults(true)
      setShowForm(false)
    } catch (e) {
      setMessages([errorMessage(e)])
    }
  }

  const env: CardEnv = {
    server,
    versionInt: 0,
    confirmQuery: () => true,
    codemirror: false,
    onAction: () => {},
  }

  const browseResults = async (table: string, sql: string) => {
    try {
      const response = await runQuery(server, { sql, db, table }, 'page')
      setBrowse({ table, response })
    } catch (e) {
      setMessages([errorMessage(e)])
    }
  }

  const deleteResults = async (table: string, sql: string) => {
    if (!(await confirm({ question: t('Delete the matches for the %s table?', table), destructive: true })))
      return
    try {
      const response = await runQuery(server, { sql, db, table }, 'page')
      setBrowse({ table, response })
      // search.ts: the search runs again so the counts refresh
      const r = await api.dbSearch(
        { server, db },
        { searchString, searchType, tables, columnName, includeHex },
      )
      setResults(r)
    } catch (e) {
      setMessages([errorMessage(e)])
    }
  }

  const types: Array<[string, string, boolean]> = [
    ['1', t('at least one of the words'), true],
    ['2', t('all of the words'), true],
    ['3', t('the exact phrase as substring'), false],
    ['4', t('the exact phrase as whole field'), false],
    ['5', t('as regular expression'), false],
  ]

  return (
    <div className="container max-w-4xl">
      <h2 className="mb-3 text-lg font-semibold">{t('Search in database')}</h2>
      <Messages messages={messages} />
      {showForm && (
        <form
          id="db_search_form"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <Panel className="mb-3">
            <PanelBody className="flex flex-col gap-3">
              <Label className="flex flex-col gap-1">
                {t('Words or values to search for (wildcard: "%"):')}
                <Input
                  id="criteriaSearchString"
                  name="criteriaSearchString"
                  value={searchString}
                  onChange={(e) => setSearchString(e.target.value)}
                />
              </Label>
              <fieldset className="flex flex-col gap-1">
                <legend className="font-semibold">{t('Find:')}</legend>
                {types.map(([v, label, hint]) => (
                  <div key={v} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="criteriaSearchType"
                      id={`criteriaSearchTypeRadio${v}`}
                      value={v}
                      checked={searchType === v}
                      onChange={() => setSearchType(v)}
                    />
                    <Label htmlFor={`criteriaSearchTypeRadio${v}`}>{label}</Label>
                    {/* the hint follows the label (phpMyAdmin's hint text is hidden, ours is sr-only) */}
                    {hint && <Hint message={t('Words are separated by a space character (" ").')} />}
                    {v === '5' && <MySqlDocLink link="Regexp" />}
                  </div>
                ))}
                <legend className="mt-2 font-semibold">{t('Options:')}</legend>
                <Label className="flex items-center gap-2">
                  <Checkbox
                    id="criteriaSearchOptionCheckbox1"
                    checked={includeHex}
                    onCheckedChange={(v) => setIncludeHex(v === true)}
                  />
                  {t('include hex matches')} <MySqlDocLink link="string-functions" anchor="function_hex" />
                </Label>
              </fieldset>
              <fieldset className="flex flex-col gap-1">
                <legend className="font-semibold">{t('Inside tables:')}</legend>
                <div>
                  <Button variant="link" id="select_all" onClick={() => setSelected(form.data.tables)}>
                    {t('Select all')}
                  </Button>{' '}
                  <Button variant="link" id="unselect_all" onClick={() => setSelected([])}>
                    {t('Unselect all')}
                  </Button>
                </div>
                <NativeSelect
                  id="criteriaTables"
                  name="criteriaTables[]"
                  multiple
                  aria-label={t('Inside tables:')}
                  className="h-auto min-h-32"
                  value={tables}
                  onChange={(e) => setSelected([...e.target.selectedOptions].map((o) => o.value))}
                >
                  {form.data.tables.map((tb) => (
                    <option key={tb} value={tb}>
                      {tb}
                    </option>
                  ))}
                </NativeSelect>
              </fieldset>
              <Label className="flex flex-col gap-1">
                {t('Inside column:')}
                <Input
                  id="criteriaColumnName"
                  name="criteriaColumnName"
                  value={columnName}
                  onChange={(e) => setColumnName(e.target.value)}
                />
              </Label>
            </PanelBody>
            <div className="border-t border-border px-3 py-2">
              <Button type="submit" variant="primary" id="buttonGo" name="submit_search">
                {t('Search')}
              </Button>
            </div>
          </Panel>
        </form>
      )}
      {results !== null && (
        <>
          <div id="togglesearchformdiv" className="my-1">
            <Button variant="primary" id="togglesearchformlink" onClick={() => setShowForm(!showForm)}>
              {showForm ? t('Hide search criteria') : t('Show search criteria')}
            </Button>
          </div>
          {showResults && (
            <div id="searchresults">
              <table className="mb-2 w-auto text-sm [&_td]:px-2 [&_td]:py-1">
                <caption className="mb-1 text-left">
                  Search results for "<em>{results.searchString}</em>" {results.description}:
                </caption>
                <tbody>
                  {results.rows.map((row) => (
                    <tr key={row.table} className="odd:bg-grid-odd even:bg-grid-even">
                      <td>
                        <InlineHtml
                          text={ngettext(
                            '%1$s match in <strong>%2$s</strong>',
                            '%1$s matches in <strong>%2$s</strong>',
                            row.count,
                          )
                            .replace('%1$s', String(row.count))
                            .replace('%2$s', row.table)}
                        />
                      </td>
                      <td>
                        {row.count > 0 && (
                          <Button
                            variant="link"
                            className="browse_results"
                            onClick={() => void browseResults(row.table, row.selectSql)}
                          >
                            {t('Browse')}
                          </Button>
                        )}
                      </td>
                      <td>
                        {row.count > 0 && (
                          <Button
                            variant="link"
                            className="delete_results"
                            onClick={() => void deleteResults(row.table, row.deleteSql)}
                          >
                            {t('Delete')}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {results.tablesSearched > 1 && (
                <p className="mb-2 text-sm">
                  <InlineHtml
                    text={ngettext(
                      '<strong>Total:</strong> <em>%s</em> match',
                      '<strong>Total:</strong> <em>%s</em> matches',
                      results.total,
                    ).replace('%s', String(results.total))}
                  />
                </p>
              )}
            </div>
          )}
          <div id="togglesearchresultsdiv" className="mb-2">
            <Button
              variant="primary"
              id="togglesearchresultlink"
              onClick={() => setShowResults(!showResults)}
            >
              {showResults ? t('Hide search results') : t('Show search results')}
            </Button>
          </div>
        </>
      )}
      {browse !== null && (
        <div id="browse-results">
          <div id="table-info" className="mb-2 flex items-center gap-1">
            <PmaIcon name="s_tbl" />
            <Link id="table-link" to={path(`${tableBase(server, db, browse.table)}/browse`)}>
              {browse.table}
            </Link>
          </div>
          {browse.response.statements.map((st, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: statements are positional
            <StatementBlock key={i} st={st} env={env} />
          ))}
        </div>
      )}
    </div>
  )
}
