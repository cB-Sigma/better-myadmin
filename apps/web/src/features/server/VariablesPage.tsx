import type { ServerVariable, ServerVariableValue } from '@bettermyadmin/contracts'
import { Loading, MessageBox, MySqlDocLink, PageHeader, Panel, PanelBody, Table } from '@bettermyadmin/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Pencil, Variable, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ApiError, api, errorMessage } from '../../lib/api'
import { t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'

/** The value cell: `,` gets a zero-width space for wrapping; byte values carry their full number. */
function ValueText({ v }: { v: ServerVariableValue }) {
  const text = v.text.replaceAll(',', ',​')
  return v.title !== undefined ? <abbr title={v.title}>{text}</abbr> : <>{text}</>
}

/**
 * Server variables and settings with the client-side filter (getFilterTextEventHandler: upper-case
 * substring of data-filter-row, spaces as `_`) and the inline editor (variables.ts).
 * pma: templates/server/variables/index.twig, resources/js/server/variables.ts
 */
export function VariablesPage({ server, filter: initial }: { server: number; filter: string }) {
  const q = useQuery({ queryKey: qk.serverVariables(server), queryFn: () => api.serverVariables(server) })
  const [filter, setFilter] = useState(initial)
  const [message, setMessage] = useState<{ type: 'error' | 'notice'; text: string } | null>(null)
  const needle = filter.toUpperCase().replace(/ /g, '_')
  const rows = useMemo(
    () => (q.data?.variables ?? []).filter((v) => v.name.toUpperCase().includes(needle)),
    [q.data, needle],
  )
  return (
    <div>
      <PageHeader icon={Variable} docUrl={q.data?.docUrl}>
        {t('Server variables and settings')}
      </PageHeader>
      {q.error !== null && <MessageBox {...errorMessage(q.error)} />}
      {q.isPending && <Loading />}
      {message !== null && <MessageBox type={message.type}>{message.text}</MessageBox>}
      {q.data !== undefined && q.data.variables.length === 0 && (
        <MessageBox type="error">
          {t('Not enough privilege to view server variables and settings. %s', '')}
          <MySqlDocLink url={q.data.noPrivilegeDocUrl} />
        </MessageBox>
      )}
      {q.data !== undefined && q.data.variables.length > 0 && (
        <>
          <Panel title={t('Filters')} id="tableFilter">
            <PanelBody>
              <label htmlFor="filterText" className="flex items-center gap-2">
                {t('Containing the word:')}
                <input
                  id="filterText"
                  name="filterText"
                  type="text"
                  className="input w-64"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </label>
            </PanelBody>
          </Panel>
          <Table id="serverVariables" zebra className="w-full">
            <thead>
              <tr>
                <th scope="col">{t('Action')}</th>
                <th scope="col">{t('Variable')}</th>
                <th scope="col" className="!text-end">
                  {t('Value')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <VariableRows
                  key={v.name}
                  server={server}
                  v={v}
                  editable={q.data.isSuperUser}
                  onMessage={setMessage}
                />
              ))}
            </tbody>
          </Table>
        </>
      )}
    </div>
  )
}

function VariableRows({
  server,
  v,
  editable,
  onMessage,
}: {
  server: number
  v: ServerVariable
  editable: boolean
  onMessage: (m: { type: 'error' | 'notice'; text: string } | null) => void
}) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState<string | null>(null)
  const [value, setValue] = useState<ServerVariableValue>(v.value)
  const [busy, setBusy] = useState(false)
  const label = v.name.replaceAll('_', ' ')

  const startEdit = async () => {
    onMessage(null)
    try {
      const r = await api.serverVariable(server, v.name)
      setEditing(r.message)
    } catch (e) {
      onMessage({ type: 'error', text: e instanceof Error ? e.message : String(e) })
    }
  }
  const save = async () => {
    if (editing === null) return
    setBusy(true)
    try {
      const r = await api.setVariable(server, v.name, editing)
      if (r.variable !== undefined) setValue(r.variable)
      setEditing(null)
      void qc.invalidateQueries({ queryKey: qk.serverVariables(server) })
    } catch (e) {
      const env = e instanceof ApiError ? e.envelope : null
      const text =
        env !== null
          ? `${env.errno !== undefined ? `#${env.errno} - ` : ''}${env.message}`
          : e instanceof Error
            ? e.message
            : String(e)
      // pma: an empty error shows strRequestFailed
      onMessage({ type: 'error', text: text === '' ? t('Request failed!!') : text })
      setEditing(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <tr className="var-row" data-filter-row={v.name.toUpperCase()}>
        <td className="whitespace-nowrap">
          {editing !== null ? (
            <span className="flex gap-3">
              <button
                type="button"
                className="cancelLink flex items-center gap-1 text-accent"
                onClick={() => setEditing(null)}
              >
                <X className="size-4" aria-hidden />
                {t('Cancel')}
              </button>
              <button
                type="button"
                className="saveLink flex items-center gap-1 text-accent"
                disabled={busy}
                onClick={save}
              >
                <Check className="size-4" aria-hidden />
                {t('Save')}
              </button>
            </span>
          ) : v.isEditable ? (
            <button
              type="button"
              className="editLink flex items-center gap-1 text-accent"
              data-variable={v.name}
              onClick={startEdit}
            >
              <Pencil className="size-4" aria-hidden />
              {t('Edit')}
            </button>
          ) : (
            <span
              title={t('This is a read-only variable and can not be edited')}
              className="read_only_var flex items-center gap-1 text-fg-subtle"
            >
              <Pencil className="size-4" aria-hidden />
              {t('Edit')}
            </span>
          )}
        </td>
        <td className="var-name font-semibold">
          {v.docUrl !== null ? (
            <span title={label}>
              <a href={v.docUrl} target="mysql_doc" rel="noopener noreferrer">
                {label.replaceAll(' ', ' ')}
              </a>
            </span>
          ) : (
            label
          )}
        </td>
        <td className={`var-value text-end font-mono ${editable ? 'editable' : ''}`}>
          {editing !== null ? (
            <div className="serverVariableEditor">
              <input
                type="text"
                className="input"
                // biome-ignore lint/a11y/noAutofocus: phpMyAdmin focuses the editor
                autoFocus
                aria-label={label}
                value={editing}
                onChange={(e) => setEditing(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void save()
                  else if (e.key === 'Escape') setEditing(null)
                }}
              />
            </div>
          ) : (
            <ValueText v={value} />
          )}
        </td>
      </tr>
      {v.sessionValue !== null && (
        <tr className="var-row" data-filter-row={v.name.toUpperCase()}>
          <td />
          <td className="var-name italic">
            {label} ({t('Session value')})
          </td>
          <td className="var-value text-end font-mono">
            <ValueText v={v.sessionValue} />
          </td>
        </tr>
      )}
    </>
  )
}
