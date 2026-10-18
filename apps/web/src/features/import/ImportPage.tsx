import type { ImportPageResponse, ImportResult } from '@bettermyadmin/contracts'
import { formatBytes } from '@bettermyadmin/i18n/format'
import {
  Alert,
  Button,
  Input,
  MessageBox,
  NativeSelect,
  Panel,
  PanelBody,
  PmaIcon,
  SafeHtml,
  showMessage,
  useUiSettings,
} from '@bettermyadmin/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useMemo, useRef, useState } from 'react'
import { ImportProgressLost, api } from '../../lib/api'
import { t, translator } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'
import { PluginOptions } from '../export/PluginOptions'
import { usePagePrefs } from '../preferences/PageSettings.tsx'
import { StatementBlock } from '../sql/Results'
import { type CardEnv, ErrorCard } from '../sql/SqlMessage'
import { DO_YOU_REALLY, checkSqlQuery, confirmationText } from '../sql/logic'
import { sqlTabRoute } from '../sql/routes'

export type ImportPageScope = 'server' | 'database' | 'table'

const NONE: ReadonlySet<string> = new Set()

/**
 * The Import tab at server, database and table scope.
 * pma: resources/templates/import.twig, {server,database,table}/import/index.twig;
 *      resources/js/import.ts
 */
export function ImportPage({
  server,
  db = '',
  table = '',
  request = [],
}: {
  server: number
  scope: ImportPageScope
  db?: string
  table?: string
  /** repopulated values (format, timeout_passed, offset, local_import_file …) */
  request?: Array<[string, string]>
}) {
  // pma: Server|Database|Table ImportController: PageSettings::init('Import')
  usePagePrefs(server, 'Import')
  const pairs = useMemo<Array<[string, string]>>(
    () => [
      ...(db !== '' ? [['db', db] as [string, string]] : []),
      ...(table !== '' ? [['table', table] as [string, string]] : []),
      ...request,
    ],
    [db, table, request],
  )
  const key = new URLSearchParams(pairs).toString()
  const q = useQuery({
    queryKey: qk.importPage(server, db, table, key),
    queryFn: () => api.importPage(server, pairs),
  })
  if (q.error !== null) {
    return (
      <Alert variant="error" className="my-3">
        {q.error.message}
      </Alert>
    )
  }
  if (q.data === undefined) return <p className="my-3">{t('Loading…')}</p>
  return <ImportForm key={key} server={server} page={q.data} />
}

/** import.ts matchFile: the format of `name` (a trailing gz/bz2/zip ignored), if one can import it */
/**
 * import.ts performUpload: the speed and the estimated time, once more than 9 % or 2 MB are sent.
 */
export function uploadEstimate(
  done: number,
  total: number,
  elapsedMs: number,
): { bytesPerSecond: number; minutes: number; seconds: number } | null {
  if (total === 0 || done === 0 || elapsedMs <= 0) return null
  if (!((done / total) * 100 > 9 || done > 2000000)) return null
  const remaining = Math.trunc((((total - done) / done) * elapsedMs) / 1000)
  return {
    bytesPerSecond: (done / elapsedMs) * 1000,
    minutes: Math.trunc(remaining / 60),
    seconds: remaining % 60,
  }
}

export function matchFormat(name: string, formats: readonly string[]): string | null {
  const parts = name.toLowerCase().split('.')
  let len = parts.length
  const ext = parts[len - 1]
  if (ext === 'gz' || ext === 'bz2' || ext === 'zip') len--
  const f = parts[len - 1] ?? ''
  return formats.includes(f) ? f : null
}

/** keyup on #text_csv_enclosed / #text_csv_escaped: two characters only after an escape */
export function oneCharacter(v: string): string {
  return v.length === 2 && v.charAt(0) !== '\\' ? v.substring(0, 1) : v
}

function ImportForm({ server, page }: { server: number; page: ImportPageResponse }) {
  const ui = useUiSettings()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const formRef = useRef<HTMLFormElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [plugin, setPlugin] = useState(page.selectedPlugin)
  const useLocal = page.timeoutPassed && page.localImportFile !== ''
  const tabs = page.isUpload && page.uploadDir !== ''
  const [localTab, setLocalTab] = useState(useLocal)
  const [phase, setPhase] = useState<null | {
    label: string
    done: number
    total: number
    /** the upload's start (Date.now()): speed and estimated time */
    start?: number
  }>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const formats = page.plugins.map((p) => p.name)

  const env: CardEnv = {
    server,
    versionInt: ui.serverVersion,
    confirmQuery: (sql) => {
      const check = checkSqlQuery(sql, ui.Confirm)
      if (check === 'empty') return false
      return check !== 'confirm' || window.confirm(confirmationText(sql, t(DO_YOU_REALLY)))
    },
    codemirror: true,
    onAction: (a) => {
      void navigate({ ...sqlTabRoute(server, a.db, a.table), search: { sql: a.sql } } as never)
    },
  }

  const fileError = () => {
    showMessage(t('Please select the file you want to import:'), false)
  }

  const submit = async () => {
    const form = formRef.current
    if (form === null) return
    const file = fileRef.current?.files?.[0]
    const local = form.elements.namedItem('local_import_file') as HTMLSelectElement | null
    // import.ts: submit #import_file_form validation
    if (tabs) {
      if (!localTab && file === undefined) {
        fileRef.current?.focus()
        return fileError()
      }
      if (localTab) {
        if (local === null) return showMessage(t('No files available on server for import!'), false)
        if (local.value === '') {
          local.focus()
          return fileError()
        }
      }
    } else {
      if (file === undefined) {
        fileRef.current?.focus()
        return fileError()
      }
      const tbl = form.elements.namedItem('csv_new_tbl_name') as HTMLInputElement | null
      if (tbl !== null && tbl.value.length > 0 && tbl.value.trim().length === 0) {
        return showMessage(t('Please enter a valid table name.'), false)
      }
      const dbName = form.elements.namedItem('csv_new_db_name') as HTMLInputElement | null
      if (dbName !== null && dbName.value.length > 0 && dbName.value.trim().length === 0) {
        return showMessage(t('Please enter a valid database name.'), false)
      }
    }
    const pairs: Array<[string, string]> = []
    for (const [k, v] of new FormData(form).entries()) {
      if (typeof v !== 'string') continue
      if (localTab ? k === 'import_file' : k === 'local_import_file') continue
      // only the selected format's options are part of its request (others are hidden, same names)
      pairs.push([k, v])
    }
    setResult(null)
    setFailure(null)
    try {
      let upload: { id: string; name: string } | undefined
      if (!localTab && file !== undefined) {
        const start = Date.now()
        setPhase({ label: t('Uploading your import file…'), done: 0, total: file.size, start })
        const id = await api.importUpload(server, file, (sent) =>
          setPhase({ label: t('Uploading your import file…'), done: sent, total: file.size, start }),
        )
        upload = { id, name: file.name }
      }
      setPhase({ label: t('The file is being processed, please be patient.'), done: 0, total: 0 })
      const job = await api.importJob(server, pairs, upload)
      const r = await api.importEvents(server, job.id, (p) =>
        setPhase({
          label: t('The file is being processed, please be patient.'),
          done: p.offset,
          total: p.total,
        }),
      )
      setResult(r)
      // Navigation.reload()
      void qc.invalidateQueries({ queryKey: qk.nav(server) })
      void qc.invalidateQueries({ queryKey: qk.srv(server) })
    } catch (e) {
      setFailure(
        e instanceof ImportProgressLost
          ? t('Could not load the progress of the import.')
          : e instanceof Error
            ? e.message
            : String(e),
      )
    } finally {
      setPhase(null)
    }
  }

  if (result !== null) {
    return (
      <div className="container my-3" id="import_form_status">
        {result.echoed?.map((h, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static list
          <MessageBox key={i} type="error">
            <SafeHtml html={h} />
          </MessageBox>
        ))}
        {result.message !== undefined && (
          <MessageBox type={result.message.type}>
            <SafeHtml html={result.message.html} />
          </MessageBox>
        )}
        {result.error !== undefined && <ErrorCard st={result.error} env={env} />}
        {result.statements?.map((st, i) => (
          <StatementBlock key={`${i}-${st.sig}`} st={st} env={env} />
        ))}
        <p className="mt-3">
          <Button type="button" onClick={() => setResult(null)}>
            {t('Back')}
          </Button>
        </p>
      </div>
    )
  }

  const selectedFile = page.localFiles !== false ? page.localFiles.find((f) => f.selected)?.name : undefined
  const uploadPane = (
    <>
      <div className="mb-3">
        <label className="form-label" htmlFor="input_import_file">
          {t('Browse your computer:')} <small>{page.maxUploadSize}</small>
        </label>
        <input
          ref={fileRef}
          className="form-control block"
          type="file"
          name="import_file"
          id="input_import_file"
          onChange={(e) => {
            const f = matchFormat(e.currentTarget.value, formats)
            if (f !== null) setPlugin(f)
          }}
        />
      </div>
      <p className="card-text">{t('You may also drag and drop a file on any page.')}</p>
    </>
  )
  const localPane =
    page.localFiles === false ? (
      <MessageBox
        type="error"
        text={t('The directory you set for upload work cannot be reached.')}
        className="mb-3"
      />
    ) : page.localFiles.length > 0 ? (
      <div className="mb-3">
        <label className="form-label" htmlFor="select_local_import_file">
          <SafeHtml
            html={t(
              'Select from the web server upload directory [strong]%s[/strong]:',
              page.userUploadDir.replace(/&/g, '&amp;').replace(/</g, '&lt;'),
            )
              .replace('[strong]', '<strong>')
              .replace('[/strong]', '</strong>')}
          />
        </label>
        <NativeSelect
          name="local_import_file"
          id="select_local_import_file"
          defaultValue={selectedFile ?? ''}
          onChange={(e) => {
            const f = matchFormat(e.currentTarget.value, formats)
            if (f !== null) setPlugin(f)
          }}
        >
          <option value="" />
          {page.localFiles.map((f) => (
            <option key={f.name} value={f.name}>
              {f.name}
            </option>
          ))}
        </NativeSelect>
      </div>
    ) : (
      <Alert variant="info" className="mb-3">
        {t('There are no files to import!')}
      </Alert>
    )

  return (
    <div className="container my-3">
      <h2 className="my-3 flex items-center gap-2 text-lg">
        <PmaIcon name="b_import" alt={t('Import')} />
        {page.title}
      </h2>
      {failure !== null && <MessageBox type="error" text={failure} className="mb-3" />}
      {phase !== null && (
        <div id="import_form_status" className="upload_progress mb-3">
          <progress
            className="w-full"
            max={phase.total > 0 ? phase.total : undefined}
            value={phase.total > 0 ? phase.done : undefined}
            aria-label={phase.label}
          />
          <div>{phase.label}</div>
          {phase.total > 0 && (
            <div id="statustext">
              {t(
                '%s of %s',
                formatBytes(translator(), phase.done, 3, 1),
                formatBytes(translator(), phase.total, 3, 1),
              )}
              {phase.start !== undefined &&
                (() => {
                  const e = uploadEstimate(phase.done, phase.total, Date.now() - phase.start)
                  if (e === null) return null
                  return (
                    <>
                      <br />
                      {t('%s/sec.', formatBytes(translator(), e.bytesPerSecond, 3, 1))}
                      <br />
                      <br />
                      {e.minutes > 0
                        ? t('About %MIN min. %SEC sec. remaining.')
                            .replace('%MIN', String(e.minutes))
                            .replace('%SEC', String(e.seconds))
                        : t('About %SEC sec. remaining.').replace('%SEC', String(e.seconds))}
                    </>
                  )
                })()}
            </div>
          )}
        </div>
      )}
      <div id="importmain" hidden={phase !== null}>
        <form
          ref={formRef}
          id="import_file_form"
          name="import"
          className="disableAjax"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <input type="hidden" name="import_type" value={page.importType} />
          {page.db !== '' && <input type="hidden" name="db" value={page.db} />}
          {page.table !== '' && <input type="hidden" name="table" value={page.table} />}

          <Panel title={t('File to import:')} className="mb-3">
            <PanelBody>
              {page.compressions.length > 0 && (
                <p className="card-text">
                  {t('File may be compressed (%s) or uncompressed.', page.compressions.join(', '))}
                  <br />
                  <SafeHtml
                    html={t(
                      "A compressed file's name must end in <strong>.[format].[compression]</strong>. Example: <strong>.sql.zip</strong>",
                    )}
                  />
                </p>
              )}
              {tabs ? (
                <>
                  <div className="mb-3 flex gap-2" id="importFileTab" role="tablist">
                    <button
                      type="button"
                      className={`nav-link${!localTab ? ' active' : ''}`}
                      id="uploadFileTab"
                      role="tab"
                      aria-controls="uploadFile"
                      aria-selected={!localTab}
                      onClick={() => setLocalTab(false)}
                    >
                      {t('Upload a file')}
                    </button>
                    <button
                      type="button"
                      className={`nav-link${localTab ? ' active' : ''}`}
                      id="localFileTab"
                      role="tab"
                      aria-controls="localFile"
                      aria-selected={localTab}
                      onClick={() => setLocalTab(true)}
                    >
                      {t('Select file to import')}
                    </button>
                  </div>
                  <div className="mb-3" id="importFileTabContent">
                    <div id="uploadFile" role="tabpanel" aria-labelledby="uploadFileTab" hidden={localTab}>
                      {uploadPane}
                    </div>
                    <div id="localFile" role="tabpanel" aria-labelledby="localFileTab" hidden={!localTab}>
                      {localPane}
                    </div>
                  </div>
                </>
              ) : page.isUpload ? (
                uploadPane
              ) : page.uploadDir !== '' ? (
                localPane
              ) : (
                <MessageBox type="notice" text={t('File uploads are not allowed on this server.')} />
              )}

              <label className="form-label" htmlFor="charset_of_file">
                {t('Character set of the file:')}
              </label>
              {page.encodings !== null ? (
                <NativeSelect
                  id="charset_of_file"
                  name="charset_of_file"
                  defaultValue={page.encodings.includes(page.importCharset) ? page.importCharset : 'utf-8'}
                >
                  {page.encodings.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </NativeSelect>
              ) : (
                <NativeSelect
                  lang="en"
                  dir="ltr"
                  name="charset_of_file"
                  id="charset_of_file"
                  defaultValue="utf8"
                >
                  <option value="" />
                  {page.charsets.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </PanelBody>
          </Panel>

          <Panel title={t('Partial import:')} className="mb-3">
            <PanelBody>
              {page.timeoutPassed && (
                <>
                  <input type="hidden" name="skip" value={String(page.offset ?? 0)} />
                  <Alert variant="info" className="mb-3">
                    {t(
                      'Previous import timed out, after resubmitting will continue from position %d.',
                      page.offset ?? 0,
                    )}
                  </Alert>
                </>
              )}
              <div className="form-check form-switch mb-3">
                <input
                  className="form-check-input"
                  type="checkbox"
                  name="allow_interrupt"
                  value="yes"
                  id="checkbox_allow_interrupt"
                  defaultChecked={page.allowInterrupt}
                  aria-describedby="allowInterruptHelp"
                />{' '}
                <label className="form-check-label" htmlFor="checkbox_allow_interrupt">
                  {t(
                    'Allow the interruption of an import in case the script detects it is close to the PHP timeout limit.',
                  )}
                </label>
                <div id="allowInterruptHelp" className="form-text text-fg-muted">
                  {t('This might be a good way to import large files, however it can break transactions.')}
                </div>
              </div>
              {!page.timeoutPassed ? (
                <>
                  <label className="form-label" htmlFor="text_skip_queries">
                    {t('Skip this number of queries (for SQL) starting from the first one:')}
                  </label>
                  <Input
                    type="number"
                    name="skip_queries"
                    defaultValue={String(page.skipQueries)}
                    id="text_skip_queries"
                    min={0}
                  />
                </>
              ) : (
                <input
                  type="hidden"
                  name="skip_queries"
                  value={String(page.skipQueries)}
                  id="text_skip_queries"
                />
              )}
            </PanelBody>
          </Panel>

          <Panel title={t('Other options')} className="mb-3">
            <PanelBody>
              <input type="hidden" name="fk_checks" value="0" />
              <div className="form-check form-switch">
                <input
                  className="form-check-input"
                  type="checkbox"
                  name="fk_checks"
                  id="fk_checks"
                  value="1"
                  defaultChecked={page.fkChecks}
                />{' '}
                <label className="form-check-label" htmlFor="fk_checks">
                  {t('Enable foreign key checks')}
                </label>
              </div>
            </PanelBody>
          </Panel>

          <Panel title={t('Format')} className="mb-3">
            <PanelBody>
              <NativeSelect
                id="plugins"
                name="format"
                aria-label={t('Format')}
                value={plugin}
                onChange={(e) => setPlugin(e.currentTarget.value)}
              >
                {page.plugins.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.text}
                  </option>
                ))}
              </NativeSelect>
              <div id="import_notification">
                {plugin === 'csv' && (
                  <Alert variant="info" className="mt-3 mb-0">
                    {t('Note: If the file contains multiple tables, they will be combined into one.')}
                  </Alert>
                )}
              </div>
            </PanelBody>
          </Panel>

          <Panel title={t('Format-specific options:')} className="mb-3" id="format_specific_opts">
            <PanelBody
              onKeyUp={(e) => {
                const el = e.target as HTMLInputElement
                if (el.id === 'text_csv_enclosed' || el.id === 'text_csv_escaped') {
                  const v = oneCharacter(el.value)
                  if (v !== el.value) el.value = v
                }
              }}
            >
              {page.plugins.map((p) => (
                <fieldset key={p.name} disabled={p.name !== plugin} className="contents">
                  <PluginOptions
                    plugin={p}
                    hidden={p.name !== plugin}
                    disabled={NONE}
                    onChange={() => {}}
                    sectionsHidden={NONE}
                    forcedOn={NONE}
                  />
                </fieldset>
              ))}
            </PanelBody>
          </Panel>

          {page.kanji && (
            <Panel title={t('Encoding Conversion:')} className="mb-3" id="kanji_encoding">
              <PanelBody>
                <input type="hidden" name="knjenc" value="" />
              </PanelBody>
            </Panel>
          )}

          <div id="submit">
            <Button id="buttonGo" type="submit" variant="primary">
              {t('Import')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
