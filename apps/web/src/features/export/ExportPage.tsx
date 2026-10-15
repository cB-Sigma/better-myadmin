import type { ExportPageResponse, PluginInfo, PluginOptionItem } from '@bettermyadmin/contracts'
import {
  Alert,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Hint,
  Input,
  NativeSelect,
  Panel,
  PanelBody,
  PmaIcon,
  showMessage,
} from '@bettermyadmin/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, api } from '../../lib/api'
import { pgettext, t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'
import { usePagePrefs } from '../preferences/PageSettings.tsx'
import { HighlightedSql } from '../sql/HighlightedSql'
import { AliasDialog } from './AliasDialog'
import { ExportOutput } from './ExportOutput'
import { OptionText, PluginOptions } from './PluginOptions'
import { type TemplateData, applyTemplateData, getTemplateData } from './template-data'

export type ExportPageScope = 'server' | 'database' | 'table'

/** The radio of a plugin's "Dump table" choice (`<name>_structure_or_data`), if it declares one. */
function structureRadio(p: PluginInfo): PluginOptionItem | null {
  const walk = (items: readonly PluginOptionItem[]): PluginOptionItem | null => {
    for (const i of items) {
      if (i.kind === 'radio' && i.name === `${p.name}_structure_or_data`) return i
      if (i.kind === 'subgroup') {
        const h = i.header !== null && i.header !== undefined ? walk([i.header]) : null
        const r = h ?? walk(i.items ?? [])
        if (r !== null) return r
      }
    }
    return null
  }
  for (const g of p.options ?? []) {
    const r = walk(g.items)
    if (r !== null) return r
  }
  return null
}

/**
 * The Export tab at server, database and table scope (and raw query exports).
 * pma: resources/templates/export.twig, server/export/index.twig, database/export/index.twig,
 *      table/export/index.twig; resources/js/export.ts
 */
export function ExportPage({
  server,
  scope,
  db = '',
  table = '',
  request = [],
}: {
  server: number
  scope: ExportPageScope
  db?: string
  table?: string
  /** the request fields (single_table, sql_query, where clauses, repopulated values …) */
  request?: Array<[string, string]>
}) {
  // pma: Server|Database|Table ExportController: PageSettings::init('Export')
  usePagePrefs(server, 'Export')
  const pairs = useMemo<Array<[string, string]>>(
    () => [
      ['scope', scope],
      ...(db !== '' ? [['db', db] as [string, string]] : []),
      ...(table !== '' ? [['table', table] as [string, string]] : []),
      ...request,
    ],
    [scope, db, table, request],
  )
  const key = new URLSearchParams(pairs).toString()
  const q = useQuery({
    queryKey: qk.exportPage(server, db, table, key),
    queryFn: () => api.exportPage(server, pairs),
  })
  if (q.error !== null) {
    return (
      <Alert variant="error" className="my-3">
        {q.error.message}
      </Alert>
    )
  }
  if (q.data === undefined) return <p className="my-3">{t('Loading…')}</p>
  return <ExportForm key={key} server={server} page={q.data} />
}

function ExportForm({ server, page }: { server: number; page: ExportPageResponse }) {
  const qc = useQueryClient()
  const formRef = useRef<HTMLFormElement>(null)
  const charsetRef = useRef<HTMLSelectElement>(null)
  const compressionRef = useRef<HTMLSelectElement>(null)
  const separateRef = useRef<HTMLInputElement>(null)
  const isDb = page.exportType === 'database'
  const [custom, setCustom] = useState(
    page.exportMethod === 'custom-no-form' || page.quickOrCustom === 'custom',
  )
  const [plugin, setPlugin] = useState(page.selectedPlugin)
  const current = page.plugins.find((p) => p.name === plugin) ?? page.plugins[0]
  const [radios, setRadios] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      page.plugins.flatMap((p) => {
        const r = structureRadio(p)
        return r === null ? [] : [[p.name, r.value ?? '']]
      }),
    ),
  )
  const [asFile, setAsFile] = useState(page.asFile || (current?.forceFile ?? false))
  const [someRows, setSomeRows] = useState(page.rows?.allrows === '0')
  const [tables, setTables] = useState(page.tables ?? [])
  const [aliasesOpen, setAliasesOpen] = useState(false)
  const [aliasRows, setAliasRows] = useState<
    Array<{ type: string; label: string; name: string; value: string }>
  >([])
  const [hasAliases, setHasAliases] = useState(page.hasAliases)
  const [sqlOpen, setSqlOpen] = useState(false)
  const [flash, setFlash] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [output, setOutput] = useState<{ text: string; pairs: Array<[string, string]> } | null>(null)
  const [busy, setBusy] = useState(false)
  const [templates, setTemplates] = useState(page.templates.list)
  const [templateId, setTemplateId] = useState(
    page.templates.selected === null ? '' : String(page.templates.selected),
  )
  const templateNameRef = useRef<HTMLInputElement>(null)
  const [, rerender] = useState(0)
  /** #checkbox_sql_include_comments changed to unchecked: the comment options are disabled */
  const [commentsOff, setCommentsOff] = useState(false)

  // database scope: plugins without a structure/data radio force both (setupTableStructureOrData)
  const forced = isDb && current !== undefined && structureRadio(current) === null
  const showOrData = current === undefined ? '' : (radios[current.name] ?? '')

  const disabled = useMemo(() => {
    const d = new Set<string>()
    const sod = isDb ? 'structure_and_data' : (radios.sql ?? '')
    if (plugin === 'sql') {
      if (sod === 'data') {
        d.add('sql_dates')
        d.add('sql_relation')
        d.add('sql_mime')
      }
      if (sod === 'structure') d.add('sql_auto_increment')
      if (isDb && tables.every((x) => !x.data)) d.add('sql_auto_increment')
      // export.ts: unchecking "Display comments" fades and disables the #ul_include_comments items
      if (commentsOff)
        for (const n of ['sql_header_comment', 'sql_dates', 'sql_relation', 'sql_mime']) d.add(n)
    }
    return d
  }, [plugin, radios, isDb, tables, commentsOff])

  const pairsOf = (): Array<[string, string]> => {
    const form = formRef.current
    if (form === null) return []
    return [...new FormData(form).entries()].map(([k, v]) => [k, String(v)] as [string, string])
  }

  // export.ts checkTimeOut: ExecTimeLimit (+ 1 s margin) after the click, ask whether the run timed out
  const timeOut = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timeOut.current !== null) clearTimeout(timeOut.current)
    },
    [],
  )
  const checkTimeOut = (limit: number) => {
    if (limit === 0) return
    if (timeOut.current !== null) clearTimeout(timeOut.current)
    timeOut.current = setTimeout(
      () =>
        void api
          .exportCheckTimeOut(server)
          .then((d) => {
            if (d.message === 'timeout')
              showMessage(
                t('Your export is incomplete, due to a low execution time limit at the PHP level!'),
                false,
                'error',
              )
          })
          .catch(() => {}),
      (limit + 1) * 1000,
    )
  }

  const submit = async (pairs: Array<[string, string]>) => {
    checkTimeOut(page.execTimeLimit)
    setBusy(true)
    try {
      const r = await api.exportRun(server, pairs)
      if (r.message !== undefined) {
        setFlash(r.message)
        return
      }
      if (r.id === undefined) return
      if (r.asFile) {
        window.location.assign(api.exportDownloadUrl(server, r.id))
        void qc.invalidateQueries({ queryKey: qk.srv(server) })
        return
      }
      setOutput({ text: await api.exportText(server, r.id), pairs })
    } catch (e) {
      setFlash({ type: 'error', text: e instanceof ApiError ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  const changePlugin = (name: string) => {
    setPlugin(name)
    const p = page.plugins.find((x) => x.name === name)
    // When MS Excel is selected as the Format automatically Switch to Character Set as windows-1252
    if (charsetRef.current !== null) charsetRef.current.value = name === 'excel' ? 'windows-1252' : 'utf-8'
    // Disables the view output as text option if the output must be saved as a file
    if (p?.forceFile === true) setAsFile(true)
    if (isDb && p !== undefined) {
      const r = structureRadio(p)
      if (r !== null) {
        // setupTableStructureOrData: a "structure" default clears the data column and a "data" one
        // the structure column. Its "re-tick the selected rows when a column is empty" branch never
        // takes effect in the reference (observed in Chromium: once cleared, a column stays clear
        // across format changes), so it is not reproduced.
        setTables((ts) => {
          const next = ts.map((x) => ({
            ...x,
            data: r.value === 'structure' ? false : x.data,
            structure: r.value === 'data' ? false : x.structure,
          }))
          return next.map((x) => ({ ...x, select: x.structure || x.data }))
        })
      }
    }
  }

  const onOption = (name: string, value: string, checked: boolean) => {
    if (name === 'sql_include_comments') setCommentsOff(!checked)
    if (name.endsWith('_structure_or_data') && checked) {
      setRadios((r) => ({ ...r, [name.slice(0, -'_structure_or_data'.length)]: value }))
    }
  }

  const strAll = tables.length > 0 && tables.every((x) => x.structure)
  const dataAll = tables.length > 0 && tables.every((x) => x.data)
  const strSome = tables.some((x) => x.structure)
  const dataSome = tables.some((x) => x.data)
  // handleAddProcCheckbox: CREATE PROCEDURE/FUNCTION/EVENT follows "all structure and all data"
  const syncProcCheckbox = (next: typeof tables) => {
    const box = document.getElementById('checkbox_sql_procedure_function') as HTMLInputElement | null
    // without the table list (server/table scope) #table_structure_all is absent: unchecked
    if (box !== null) box.checked = isDb && next.every((x) => x.structure) && next.every((x) => x.data)
  }
  // pma: export.ts registerOnload calls handleAddProcCheckbox once on load
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, after the options mounted
  useEffect(() => syncProcCheckbox(tables), [])
  const updateTables = (fn: (ts: typeof tables) => typeof tables) => {
    setTables((ts) => {
      const next = fn(ts)
      syncProcCheckbox(next)
      return next
    })
  }

  const filenameHint =
    page.exportType === 'server'
      ? t('@SERVER@ will become the server name.')
      : page.exportType === 'database'
        ? t('@SERVER@ will become the server name and @DATABASE@ will become the database name.')
        : t(
            '@SERVER@ will become the server name, @DATABASE@ will become the database name and @TABLE@ will become the table name.',
          )

  const loadTemplate = async (id: string) => {
    setTemplateId(id)
    if (id === '') return
    const r = await api.exportTemplateLoad(server, Number(id))
    if (!r.success || r.data === undefined || formRef.current === null) {
      if (r.message !== undefined) showMessage(r.message, false)
      return
    }
    const data = JSON.parse(r.data) as TemplateData
    applyTemplateData(formRef.current, data)
    // the state-bearing controls follow the form
    const form = formRef.current
    const val = (n: string) =>
      (form.elements.namedItem(n) as HTMLInputElement | RadioNodeList | null)?.value ?? ''
    if (data.what !== undefined) changePlugin(String(data.what))
    if (data.quick_or_custom !== undefined) setCustom(val('quick_or_custom') === 'custom')
    if (data.output_format !== undefined) setAsFile(val('output_format') !== 'astext')
    if (data.allrows !== undefined) setSomeRows(val('allrows') === '0')
    for (const p of page.plugins) {
      const k = `${p.name}_structure_or_data`
      if (data[k] !== undefined && structureRadio(p) !== null) {
        setRadios((r) => ({ ...r, [p.name]: val(k) }))
      }
    }
    const list = (n: string) => {
      const v = data[n]
      return v === undefined ? null : Array.isArray(v) ? v : v === null ? [] : [v]
    }
    const sel = list('table_select[]')
    const str = list('table_structure[]')
    const dat = list('table_data[]')
    if (sel !== null || str !== null || dat !== null) {
      setTables((ts) =>
        ts.map((x) => ({
          ...x,
          select: sel === null ? x.select : sel.includes(x.name),
          structure: str === null ? x.structure : str.includes(x.name),
          data: dat === null ? x.data : dat.includes(x.name),
        })),
      )
    }
    rerender((n) => n + 1)
    showMessage(t('Template was loaded.'))
  }

  const hiddenTemplateExclude = page.exportType
  return (
    <>
      {output !== null && (
        <ExportOutput
          text={output.text}
          // the Back link re-posts the form with repopulate=1: the form stays as it was posted
          onBack={() => setOutput(null)}
          onRefresh={() => void submit(output.pairs)}
        />
      )}
      <div className="container my-3" hidden={output !== null}>
        <h2 className="my-3 flex items-center gap-2 text-lg">
          <PmaIcon name="b_export" alt={t('Export')} />
          {page.title}
        </h2>

        {flash !== null && (
          <Alert variant={flash.type === 'success' ? 'success' : 'error'} className="mb-3">
            {flash.text}
          </Alert>
        )}

        {page.templates.enabled && (
          <Panel title={t('Export templates:')} className="mb-3">
            <PanelBody className="grid gap-3 md:grid-cols-2">
              <form
                className="disableAjax"
                onSubmit={(e) => {
                  e.preventDefault()
                  const name = templateNameRef.current?.value ?? ''
                  if (name === '' || formRef.current === null) return
                  void api
                    .exportTemplateCreate(server, {
                      exportType: hiddenTemplateExclude,
                      templateName: name,
                      templateData: JSON.stringify(getTemplateData(formRef.current)),
                    })
                    .then((r) => {
                      if (!r.success) {
                        showMessage(r.message ?? '', false)
                        return
                      }
                      if (templateNameRef.current !== null) templateNameRef.current.value = ''
                      const list = r.templates ?? []
                      setTemplates(list)
                      const created = list.find((x) => x.name === name)
                      if (created !== undefined) setTemplateId(String(created.id))
                      showMessage(t('Template was created.'))
                    })
                }}
              >
                <fieldset>
                  <legend>{t('New template:')}</legend>
                  <div className="flex flex-wrap items-center gap-3">
                    <label htmlFor="templateName">{t('Template name')}</label>
                    <Input
                      ref={templateNameRef}
                      type="text"
                      name="templateName"
                      id="templateName"
                      maxLength={64}
                      placeholder={t('Template name')}
                      required
                      className="w-48"
                    />
                    <Button type="submit" variant="secondary" name="createTemplate" id="createTemplate">
                      {t('Create')}
                    </Button>
                  </div>
                </fieldset>
              </form>
              <form id="existingTemplatesForm" className="disableAjax" onSubmit={(e) => e.preventDefault()}>
                <fieldset>
                  <legend>{t('Existing templates:')}</legend>
                  <div className="flex flex-wrap items-center gap-3">
                    <label htmlFor="template">{t('Template:')}</label>
                    <NativeSelect
                      name="template"
                      id="template"
                      required
                      value={templateId}
                      onChange={(e) => void loadTemplate(e.currentTarget.value)}
                    >
                      <option value="">-- {t('Select a template')} --</option>
                      {templates.map((x) => (
                        <option key={x.id} value={String(x.id)}>
                          {x.name}
                        </option>
                      ))}
                    </NativeSelect>
                    <Button
                      type="button"
                      variant="secondary"
                      name="updateTemplate"
                      id="updateTemplate"
                      onClick={() => {
                        if (templateId === '' || formRef.current === null) return
                        void api
                          .exportTemplateUpdate(
                            server,
                            Number(templateId),
                            JSON.stringify(getTemplateData(formRef.current)),
                          )
                          .then((r) =>
                            r.success
                              ? showMessage(t('Template was updated.'))
                              : showMessage(r.message ?? '', false),
                          )
                      }}
                    >
                      {t('Update')}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      name="deleteTemplate"
                      id="deleteTemplate"
                      onClick={() => {
                        if (templateId === '') return
                        void api.exportTemplateDelete(server, Number(templateId)).then((r) => {
                          if (!r.success) {
                            showMessage(r.message ?? '', false)
                            return
                          }
                          setTemplates((ts) => ts.filter((x) => String(x.id) !== templateId))
                          setTemplateId('')
                          showMessage(t('Template was deleted.'))
                        })
                      }}
                    >
                      {t('Delete')}
                    </Button>
                  </div>
                </fieldset>
              </form>
            </PanelBody>
          </Panel>
        )}

        {page.sqlQuery !== '' && (
          <Panel title={pgettext('Title of the option on the Export page', 'SQL query:')} className="mb-3">
            <PanelBody>
              <div id="sqlqueryform">
                <Button type="button" variant="secondary" id="showsqlquery" onClick={() => setSqlOpen(true)}>
                  {pgettext('Button to show the SQL query on the export page', 'Show SQL query')}
                </Button>
              </div>
            </PanelBody>
            <Dialog open={sqlOpen} onOpenChange={setSqlOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>
                    {pgettext('Title of the option on the Export page', 'SQL query:')}
                  </DialogTitle>
                </DialogHeader>
                <DialogBody>
                  <HighlightedSql sql={page.sqlQuery} />
                </DialogBody>
                <DialogFooter>
                  <Button type="button" variant="secondary" onClick={() => setSqlOpen(false)}>
                    {t('Close')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </Panel>
        )}

        <form
          ref={formRef}
          method="post"
          name="dump"
          className="disableAjax"
          onSubmit={(e) => {
            e.preventDefault()
            void submit(pairsOf())
          }}
        >
          <input type="hidden" name="db" value={page.db} />
          <input type="hidden" name="table" value={page.table} />
          <input type="hidden" name="export_type" value={page.exportType} />
          <input type="hidden" name="export_method" value={page.exportMethod} />
          <input type="hidden" name="template_id" value={templateId} />
          {page.singleTable && <input type="hidden" name="single_table" value="1" />}
          {page.sqlQuery !== '' && <input type="hidden" name="sql_query" value={page.sqlQuery} />}

          {page.exportMethod !== 'custom-no-form' && (
            <Panel title={t('Export method:')} className="mb-3" id="quick_or_custom">
              <PanelBody>
                <div className="form-check flex items-center gap-2">
                  <input
                    className="form-check-input"
                    type="radio"
                    name="quick_or_custom"
                    value="quick"
                    id="radio_quick_export"
                    defaultChecked={page.quickOrCustom === 'quick'}
                    onChange={(e) => e.currentTarget.checked && setCustom(false)}
                  />
                  <label className="form-check-label" htmlFor="radio_quick_export">
                    {t('Quick - display only the minimal options')}
                  </label>
                </div>
                <div className="form-check flex items-center gap-2">
                  <input
                    className="form-check-input"
                    type="radio"
                    name="quick_or_custom"
                    value="custom"
                    id="radio_custom_export"
                    defaultChecked={page.quickOrCustom === 'custom'}
                    onChange={(e) => e.currentTarget.checked && setCustom(true)}
                  />
                  <label className="form-check-label" htmlFor="radio_custom_export">
                    {t('Custom - display all possible options')}
                  </label>
                </div>
              </PanelBody>
            </Panel>
          )}

          <Panel title={t('Format:')} className="mb-3" id="format">
            <PanelBody>
              <NativeSelect
                id="plugins"
                name="what"
                aria-label={t('File format to export')}
                value={plugin}
                onChange={(e) => changePlugin(e.currentTarget.value)}
              >
                {page.plugins.map((p) => (
                  <option key={p.name} value={p.name} data-is-binary={p.forceFile ? 'true' : 'false'}>
                    {p.text}
                  </option>
                ))}
              </NativeSelect>
            </PanelBody>
          </Panel>

          {page.exportType === 'server' && page.databases !== undefined && (
            <Panel title={t('Databases')} className="mb-3" id="databases_and_tables" hidden={!custom}>
              <PanelBody>
                <div className="mb-3 flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    id="db_select_all"
                    onClick={() => {
                      for (const o of (document.getElementById('db_select') as HTMLSelectElement).options)
                        o.selected = true
                    }}
                  >
                    {t('Select all')}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    id="db_unselect_all"
                    onClick={() => {
                      for (const o of (document.getElementById('db_select') as HTMLSelectElement).options)
                        o.selected = false
                    }}
                  >
                    {t('Unselect all')}
                  </Button>
                </div>
                <NativeSelect
                  name="db_select[]"
                  id="db_select"
                  size={10}
                  multiple
                  aria-label={t('Databases')}
                  defaultValue={page.databases.filter((d) => d.selected).map((d) => d.name)}
                  className="h-auto w-full"
                >
                  {page.databases.map((d) => (
                    <option key={d.name} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </NativeSelect>
              </PanelBody>
            </Panel>
          )}

          {page.exportType === 'database' && (
            <Panel title={t('Tables:')} className="mb-3" id="databases_and_tables" hidden={!custom}>
              <PanelBody style={{ overflowY: 'scroll', maxHeight: '20em' }}>
                <input type="hidden" name="structure_or_data_forced" value={forced ? '1' : '0'} />
                <table className="export_table_select w-full text-[13px]">
                  <thead>
                    <tr>
                      <th />
                      <th className="text-start">{t('Tables')}</th>
                      <th
                        className="export_structure text-center"
                        style={forced ? { opacity: 0.4 } : undefined}
                      >
                        {t('Structure')}
                      </th>
                      <th className="export_data text-center" style={forced ? { opacity: 0.4 } : undefined}>
                        {t('Data')}
                      </th>
                    </tr>
                    <tr>
                      <td />
                      <td className="align-middle">{t('Select all')}</td>
                      <td className="export_structure text-center">
                        <input
                          type="checkbox"
                          id="table_structure_all"
                          aria-label={t('Export the structure of all tables.')}
                          checked={strAll}
                          ref={(el) => {
                            if (el !== null) el.indeterminate = strSome && !strAll
                          }}
                          disabled={forced}
                          onChange={(e) => {
                            const on = e.currentTarget.checked
                            updateTables((ts) =>
                              ts.map((x) => ({ ...x, structure: on, select: on || x.data })),
                            )
                          }}
                        />
                      </td>
                      <td className="export_data text-center">
                        <input
                          type="checkbox"
                          id="table_data_all"
                          aria-label={t('Export the data of all tables.')}
                          checked={dataAll}
                          ref={(el) => {
                            if (el !== null) el.indeterminate = dataSome && !dataAll
                          }}
                          disabled={forced}
                          onChange={(e) => {
                            const on = e.currentTarget.checked
                            updateTables((ts) =>
                              ts.map((x) => ({ ...x, data: on, select: on || x.structure })),
                            )
                          }}
                        />
                      </td>
                    </tr>
                  </thead>
                  <tbody>
                    {tables.map((x, i) => (
                      <tr key={x.name} className={x.structure && x.data ? 'marked' : undefined}>
                        <td>
                          <input
                            className="checkall"
                            type="checkbox"
                            name="table_select[]"
                            value={x.name}
                            checked={x.select}
                            ref={(el) => {
                              if (el !== null)
                                el.indeterminate = x.select && x.structure !== x.data && !forced
                            }}
                            onChange={(e) => {
                              const on = e.currentTarget.checked
                              updateTables((ts) =>
                                ts.map((y, j) =>
                                  j === i
                                    ? {
                                        ...y,
                                        select: on,
                                        structure: forced ? y.structure : on,
                                        data: forced ? y.data : on,
                                      }
                                    : y,
                                ),
                              )
                            }}
                          />
                        </td>
                        <td className="align-middle text-nowrap">{x.name}</td>
                        <td className="export_structure text-center">
                          <input
                            type="checkbox"
                            name="table_structure[]"
                            value={x.name}
                            checked={x.structure}
                            disabled={forced}
                            onChange={(e) => {
                              const on = e.currentTarget.checked
                              updateTables((ts) =>
                                ts.map((y, j) =>
                                  j === i ? { ...y, structure: on, select: on || y.data } : y,
                                ),
                              )
                            }}
                          />
                        </td>
                        <td className="export_data text-center">
                          <input
                            type="checkbox"
                            name="table_data[]"
                            value={x.name}
                            checked={x.data}
                            disabled={forced}
                            onChange={(e) => {
                              const on = e.currentTarget.checked
                              updateTables((ts) =>
                                ts.map((y, j) =>
                                  j === i ? { ...y, data: on, select: on || y.structure } : y,
                                ),
                              )
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </PanelBody>
            </Panel>
          )}

          {page.rows !== null && page.rows !== undefined && (
            <Panel
              title={t('Rows:')}
              className="mb-3"
              id="rows"
              hidden={!custom || (showOrData === 'structure' && !isDb)}
            >
              <PanelBody>
                <div className="form-check flex items-center gap-2">
                  <input
                    className="form-check-input"
                    type="radio"
                    name="allrows"
                    value="1"
                    id="radio_allrows_1"
                    defaultChecked={!someRows}
                    onChange={(e) => e.currentTarget.checked && setSomeRows(false)}
                  />
                  <label className="form-check-label" htmlFor="radio_allrows_1">
                    {t('Dump all rows')}
                  </label>
                </div>
                <div className="form-check mb-2 flex items-center gap-2">
                  <input
                    className="form-check-input"
                    type="radio"
                    name="allrows"
                    value="0"
                    id="radio_allrows_0"
                    defaultChecked={someRows}
                    onChange={(e) => e.currentTarget.checked && setSomeRows(true)}
                  />
                  <label className="form-check-label" htmlFor="radio_allrows_0">
                    {t('Dump some row(s)')}
                  </label>
                </div>
                <ul className="list-group">
                  <li className="list-group-item py-1" style={someRows ? undefined : { opacity: 0.4 }}>
                    <label className="form-label block" htmlFor="limit_to">
                      {t('Number of rows:')}
                    </label>
                    <Input
                      type="text"
                      id="limit_to"
                      name="limit_to"
                      size={5}
                      defaultValue={page.rows.limitTo}
                      disabled={!someRows}
                      className="w-24"
                      onFocus={(e) => e.currentTarget.select()}
                    />
                  </li>
                  <li className="list-group-item py-1" style={someRows ? undefined : { opacity: 0.4 }}>
                    <label className="form-label block" htmlFor="limit_from">
                      {t('Row to begin at:')}
                    </label>
                    <Input
                      type="text"
                      id="limit_from"
                      name="limit_from"
                      size={5}
                      defaultValue={page.rows.limitFrom}
                      disabled={!someRows}
                      className="w-24"
                      onFocus={(e) => e.currentTarget.select()}
                    />
                  </li>
                </ul>
              </PanelBody>
            </Panel>
          )}

          {page.saveDir !== '' && (
            <Panel title={t('Output:')} className="mb-3" id="output_quick_export" hidden={custom}>
              <PanelBody>
                <Switch
                  name="quick_export_onserver"
                  value="saveit"
                  id="checkbox_quick_dump_onserver"
                  defaultChecked={page.quickExportOnServer}
                >
                  <OptionText text={t('Save on server in the directory <strong>%s</strong>', page.saveDir)} />
                </Switch>
                <Switch
                  name="quick_export_onserver_overwrite"
                  value="saveitover"
                  id="checkbox_quick_dump_onserver_overwrite"
                  defaultChecked={page.quickExportOnServerOverwrite}
                >
                  {t('Overwrite existing file(s)')}
                </Switch>
              </PanelBody>
            </Panel>
          )}

          <AliasDialog
            server={server}
            db={page.db}
            table={page.table}
            open={aliasesOpen}
            rows={aliasRows}
            onRows={setAliasRows}
            onOpenChange={(open) => {
              setAliasesOpen(open)
              if (!open) {
                const kept = aliasRows.filter((r) => r.value !== '')
                setAliasRows(kept)
                setHasAliases(kept.length > 0)
              }
            }}
          />
          {aliasRows
            .filter((r) => r.value !== '')
            .map((r) => (
              <input key={r.name} type="hidden" name={r.name} value={r.value} />
            ))}

          <Panel title={t('Output:')} className="mb-3" id="output" hidden={!custom}>
            <ul className="divide-y divide-(--card-divider) text-[13px]">
              <li className="list-group-item px-3 py-1.5">
                <div className="form-check form-switch flex items-center gap-2">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id="btn_alias_config"
                    checked={hasAliases}
                    onChange={() => setAliasesOpen(true)}
                  />
                  <label className="form-check-label" htmlFor="btn_alias_config">
                    {t('Rename exported databases/tables/columns')}
                  </label>
                </div>
              </li>
              {page.exportType !== 'server' && (
                <li className="list-group-item px-3 py-1.5">
                  <Switch
                    name="lock_tables"
                    value="y"
                    id="checkbox_lock_tables"
                    defaultChecked={page.lockTables}
                  >
                    <OptionText text={t('Use %s statement', '<code>LOCK TABLES</code>')} />
                  </Switch>
                </li>
              )}
              <li className="list-group-item px-3 py-1.5">
                <div
                  className="form-check flex items-center gap-2"
                  style={current?.forceFile ? { opacity: 0.4 } : undefined}
                >
                  <input
                    className="form-check-input"
                    type="radio"
                    id="radio_view_as_text"
                    name="output_format"
                    value="astext"
                    checked={!asFile}
                    disabled={current?.forceFile === true}
                    onChange={(e) => e.currentTarget.checked && setAsFile(false)}
                  />
                  <label className="form-check-label" htmlFor="radio_view_as_text">
                    {t('View output as text')}
                  </label>
                </div>
                <div className="form-check mb-2 flex items-center gap-2">
                  <input
                    className="form-check-input"
                    type="radio"
                    name="output_format"
                    value="sendit"
                    id="radio_dump_asfile"
                    checked={asFile}
                    onChange={(e) => e.currentTarget.checked && setAsFile(true)}
                  />
                  <label className="form-check-label" htmlFor="radio_dump_asfile">
                    {t('Save output to a file')}
                  </label>
                </div>
                <div className="flex gap-3">
                  <div className="w-px bg-(--card-divider)" />
                  <ul
                    className="list-group grow"
                    id="ul_save_asfile"
                    style={asFile ? undefined : { opacity: 0.4 }}
                  >
                    {page.saveDir !== '' && (
                      <li className="list-group-item py-1">
                        <Switch
                          name="onserver"
                          value="saveit"
                          id="checkbox_dump_onserver"
                          defaultChecked={page.onServer}
                        >
                          <OptionText
                            text={t('Save on server in the directory <strong>%s</strong>', page.saveDir)}
                          />
                        </Switch>
                        <Switch
                          name="onserver_overwrite"
                          value="saveitover"
                          id="checkbox_dump_onserver_overwrite"
                          defaultChecked={page.onServerOverwrite}
                        >
                          {t('Overwrite existing file(s)')}
                        </Switch>
                      </li>
                    )}
                    <li className="list-group-item py-1">
                      <div className="flex flex-wrap items-center gap-3">
                        <label htmlFor="filename_template" className="inline-flex items-center gap-1">
                          {t('File name template:')}
                          <Hint
                            message={t(
                              "This value is interpreted using the 'strftime' function, so you can use time formatting strings. Additionally the following transformations will happen: %s Other text will be kept as is. See the FAQ 6.27 for details.",
                              filenameHint,
                            )}
                          />
                        </label>
                        <Input
                          type="text"
                          name="filename_template"
                          id="filename_template"
                          defaultValue={page.filenameTemplate}
                          className="w-56"
                        />
                        <Switch
                          name="remember_template"
                          id="checkbox_remember_template"
                          defaultChecked={page.rememberTemplate}
                        >
                          {t('Use this for future exports')}
                        </Switch>
                      </div>
                    </li>
                    {page.charsets !== null && (
                      <li className="list-group-item py-1">
                        <div className="flex items-center gap-3">
                          <label htmlFor="select_charset">{t('Character set of the file:')}</label>
                          <NativeSelect
                            id="select_charset"
                            name="charset"
                            ref={charsetRef}
                            defaultValue={page.charset === '' ? 'utf-8' : page.charset}
                          >
                            {page.charsets.map((cs) => (
                              <option key={cs} value={cs}>
                                {cs}
                              </option>
                            ))}
                          </NativeSelect>
                        </div>
                      </li>
                    )}
                    {page.compressions.length > 0 ? (
                      <li className="list-group-item py-1">
                        <div className="flex items-center gap-3">
                          <label htmlFor="compression">{t('Compression:')}</label>
                          <NativeSelect
                            id="compression"
                            name="compression"
                            ref={compressionRef}
                            defaultValue={page.compression}
                            onChange={(e) => {
                              // For separate-file exports only ZIP compression is allowed
                              if (e.currentTarget.value !== 'zip' && separateRef.current !== null) {
                                separateRef.current.checked = false
                              }
                            }}
                          >
                            <option value="none">{t('None')}</option>
                            {page.compressions.includes('zip') && <option value="zip">{t('zipped')}</option>}
                            {page.compressions.includes('gzip') && (
                              <option value="gzip">{t('gzipped')}</option>
                            )}
                          </NativeSelect>
                        </div>
                      </li>
                    ) : (
                      <input type="hidden" name="compression" value={page.compression} />
                    )}
                    {(page.exportType === 'server' || page.exportType === 'database') && (
                      <li className="list-group-item py-1">
                        <Switch
                          id="checkbox_as_separate_files"
                          name="as_separate_files"
                          value={page.exportType}
                          defaultChecked={page.asSeparateFiles}
                          inputRef={separateRef}
                          onChange={(on) => {
                            if (on && compressionRef.current !== null) compressionRef.current.value = 'zip'
                          }}
                        >
                          {page.exportType === 'server'
                            ? t('Export databases as separate files')
                            : t('Export tables as separate files')}
                        </Switch>
                      </li>
                    )}
                  </ul>
                </div>
              </li>
              <li className="list-group-item px-3 py-1.5">
                <label htmlFor="maxsize" className="form-label block">
                  {t('Skip tables larger than:')}
                </label>
                <Input
                  type="number"
                  id="maxsize"
                  name="maxsize"
                  aria-describedby="maxsizeHelp"
                  className="max-w-xs"
                />
                <div id="maxsizeHelp" className="form-text text-fg-muted">
                  {t('The size is measured in MiB.')}
                </div>
              </li>
            </ul>
          </Panel>

          <Panel
            title={t('Format-specific options:')}
            className="mb-3"
            id="format_specific_opts"
            hidden={!custom}
          >
            <PanelBody>
              {page.plugins.map((p) => (
                <PluginOptions
                  key={p.name}
                  plugin={isDb ? withDbScopeRadios(p) : p}
                  hidden={p.name !== plugin}
                  disabled={p.name === plugin ? disabled : new Set()}
                  onChange={onOption}
                  sectionsHidden={sectionVisibility(
                    p.name,
                    isDb ? 'structure_and_data' : (radios[p.name] ?? ''),
                  )}
                  forcedOn={isDb && p.name === 'sql' ? FORCED_DB : NONE}
                />
              ))}
            </PanelBody>
          </Panel>

          <div id="submit">
            <Button
              id="buttonGo"
              type="submit"
              variant="primary"
              disabled={busy}
              data-exec-time-limit={String(page.execTimeLimit)}
            >
              {t('Export')}
            </Button>
          </div>
        </form>
      </div>
    </>
  )
}

const NONE: ReadonlySet<string> = new Set()
/** Database scope: CREATE TABLE is forced on (a disabled switch shadowed by a hidden clone). */
const FORCED_DB: ReadonlySet<string> = new Set(['sql_create_table'])

/** toggleStructureDataOpts: `#<plugin>_data` / `#<plugin>_structure` groups follow the radio. */
function sectionVisibility(plugin: string, show: string): ReadonlySet<string> {
  const hide = new Set<string>()
  if (show === 'data') hide.add(`${plugin}_structure`)
  if (show === 'structure') hide.add(`${plugin}_data`)
  return hide
}

/**
 * Database scope: each `<name>_structure_or_data` radio becomes a hidden `structure_and_data`
 * field plus a disabled hidden `<name>_structure_or_data_default` holding the configured value.
 */
function withDbScopeRadios(p: PluginInfo): PluginInfo {
  const map = (items: PluginOptionItem[]): PluginOptionItem[] =>
    items.map((i) => {
      if (i.kind === 'radio' && i.name.endsWith('_structure_or_data')) {
        return {
          ...i,
          kind: 'hidden',
          value: 'structure_and_data',
          dbDefault: i.value ?? '',
        } as PluginOptionItem
      }
      if (i.kind === 'subgroup') {
        const header =
          i.header !== null && i.header !== undefined
            ? (map([i.header])[0] as PluginOptionItem)
            : (i.header ?? null)
        return { ...i, header, items: map(i.items ?? []) }
      }
      return i
    })
  return { ...p, options: p.options === null ? null : p.options.map((g) => ({ ...g, items: map(g.items) })) }
}

/** A Bootstrap `form-switch` checkbox. */
function Switch({
  name,
  value,
  id,
  defaultChecked,
  children,
  inputRef,
  onChange,
}: {
  name: string
  value?: string
  id: string
  defaultChecked: boolean
  children: React.ReactNode
  inputRef?: React.Ref<HTMLInputElement>
  onChange?: (on: boolean) => void
}) {
  return (
    <div className="form-check form-switch flex items-center gap-2">
      <input
        className="form-check-input"
        type="checkbox"
        name={name}
        {...(value !== undefined ? { value } : {})}
        id={id}
        defaultChecked={defaultChecked}
        {...(inputRef !== undefined ? { ref: inputRef } : {})}
        onChange={(e) => onChange?.(e.currentTarget.checked)}
      />
      <label className="form-check-label" htmlFor={id}>
        {children}
      </label>
    </div>
  )
}
