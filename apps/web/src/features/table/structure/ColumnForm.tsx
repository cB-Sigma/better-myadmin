import type {
  ColumnFormOptions,
  ColumnOrig,
  DdlResponse,
  FormIndex,
  Partitioning,
} from '@bettermyadmin/contracts'
import { Button, DocLink, Hint, MessageBox, Modal, MySqlDocLink, PreviewSqlDialog } from '@bettermyadmin/ui'
import { Link, useParams } from '@tanstack/react-router'
import { Fragment, type ReactNode, useState } from 'react'
import { errorMessage } from '../../../lib/api'
import { t } from '../../../lib/i18n'
import { PartitionEditor } from './PartitionEditor'

/**
 * The column definition form shared by Create table, Add column(s) and Change column(s).
 *
 * pma: resources/templates/columns_definitions/column_definitions_form.twig,
 *      table_fields_definitions.twig, column_attributes.twig;
 *      resources/js/modules/functions.ts::checkTableEditForm, checkReservedWordColumns,
 *      onloadEnumSetEditor; resources/js/table/structure.ts (append_fields_form submit)
 */

export interface ColumnRow {
  name: string
  type: string
  length: string
  defaultType: string
  defaultValue: string
  collation: string
  attribute: string
  null: boolean
  autoIncrement: boolean
  comments: string
  virtuality: string
  expression: string
  moveTo: string
  adjustPrivileges: boolean
  /** create/add: the Index select (none, primary, unique, index, fulltext, spatial) */
  key: string
  orig?: ColumnOrig
  moveOptions?: Array<{ value: string; after: string | null; disabled: boolean }>
  /** the MIME columns (only when the form shows them) */
  mime?: MimeValues
}

export interface MimeValues {
  mimetype: string
  transformation: string
  transformationOptions: string
  inputTransformation: string
  inputTransformationOptions: string
}

const EMPTY_MIME: MimeValues = {
  mimetype: '',
  transformation: '',
  transformationOptions: '',
  inputTransformation: '',
  inputTransformationOptions: '',
}

/** the transformation options hint of table_fields_definitions.twig (show_hint) */
function TransformationOptionsHint() {
  return (
    <Hint
      message={t(
        "Please enter the values for transformation options using this format: 'a', 100, b,'c'…<br>If you ever need to put a backslash (\"\\\") or a single quote (\"'\") amongst those values, precede it with a backslash (for example '\\\\xyz' or 'a\\'b').",
      ).replace('<br>', '\n')}
    />
  )
}

export const emptyRow = (): ColumnRow => ({
  name: '',
  // the type select shows its first option
  type: 'INT',
  length: '',
  defaultType: 'NONE',
  defaultValue: '',
  collation: '',
  attribute: '',
  null: false,
  autoIncrement: false,
  comments: '',
  virtuality: '',
  expression: '',
  moveTo: '',
  adjustPrivileges: false,
  key: 'none',
})

export interface TableOptions {
  table: string
  comment: string
  collation: string
  engine: string
  connection: string
  partitioning: Partitioning
}

export type FormMode = 'create' | 'add' | 'change'

/** The five index buckets of the create/add forms, from the per-column Index selects. */
export function indexesFromRows(rows: ColumnRow[]): FormIndex[] {
  const out: FormIndex[] = []
  const primary = rows.flatMap((r, i) =>
    r.key === 'primary' && r.name !== '' ? [{ colIndex: i, size: '' }] : [],
  )
  // PRIMARY always composes (Indexes.addColumnToIndex on the existing primary key)
  if (primary.length > 0) out.push({ choice: 'PRIMARY', keyName: 'PRIMARY', columns: primary })
  rows.forEach((r, i) => {
    if (r.name === '' || r.key === 'none' || r.key === 'primary') return
    const choice = r.key.toUpperCase() as FormIndex['choice']
    out.push({ choice, keyName: '', columns: [{ colIndex: i, size: '' }] })
  })
  return out
}

const LENGTH_REQUIRED = ['VARCHAR', 'CHAR', 'BIT', 'VARBINARY', 'BINARY']
const NUM_TYPES = ['TINYINT', 'SMALLINT', 'MEDIUMINT', 'INT', 'BIGINT', 'FLOAT', 'DOUBLE', 'DECIMAL']

/** pma: functions.ts::checkTableEditForm — the alert text, or null when the form is valid */
export function checkTableEditForm(rows: ColumnRow[], mode: FormMode, table: string): string | null {
  let atLeastOne = false
  for (const r of rows) {
    if (LENGTH_REQUIRED.includes(r.type) && Number.isNaN(Number.parseInt(r.length, 10)) && r.name !== '') {
      return t('Please enter a valid length!')
    }
    const attr = r.attribute.toUpperCase()
    if (
      (attr === 'UNSIGNED' || attr === 'UNSIGNED ZEROFILL') &&
      !NUM_TYPES.includes(r.type) &&
      r.name !== ''
    ) {
      return `${r.type} ${t('does not support the UNSIGNED attribute.')}`
    }
    if (r.name.trim() !== '') atLeastOne = true
  }
  if (!atLeastOne) return t('Missing value in the form!')
  if (mode === 'create' && table === '') return t('Missing value in the form!')
  return null
}

/** Parses an ENUM/SET value list ('a','b\'c','d''e') like onloadEnumSetEditor. */
export function parseEnumValues(s: string): string[] {
  const out: string[] = []
  let i = 0
  while (i < s.length) {
    while (i < s.length && (s[i] === ',' || s[i] === ' ')) i++
    if (s[i] !== "'") {
      const end = s.indexOf(',', i)
      const raw = (end < 0 ? s.slice(i) : s.slice(i, end)).trim()
      if (raw !== '') out.push(raw)
      if (end < 0) break
      i = end
      continue
    }
    i++
    let v = ''
    while (i < s.length) {
      const c = s[i] as string
      if (c === '\\' && i + 1 < s.length) {
        v += s[i + 1]
        i += 2
      } else if (c === "'" && s[i + 1] === "'") {
        v += "'"
        i += 2
      } else if (c === "'") {
        i++
        break
      } else {
        v += c
        i++
      }
    }
    out.push(v)
  }
  return out
}

/** Writes the values back: `\` → `\\`, `'` → `''`. */
export function formatEnumValues(values: string[]): string {
  return values
    .filter((v) => v !== '')
    .map((v) => `'${v.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`)
    .join(',')
}

function EnumEditor({
  value,
  column,
  onClose,
  onSave,
}: { value: string; column: string; onClose: () => void; onSave: (v: string) => void }) {
  const initial = parseEnumValues(value)
  const [values, setValues] = useState<string[]>(initial.length > 0 ? initial : ['', '', '', ''])
  const [add, setAdd] = useState(1)
  return (
    <Modal
      title={t('ENUM/SET editor')}
      open
      onClose={onClose}
      footer={
        <>
          <Button variant="primary" onClick={() => onSave(formatEnumValues(values))}>
            {t('Go')}
          </Button>
          <Button onClick={onClose}>{t('Close')}</Button>
        </>
      }
    >
      <p className="mb-2 text-sm">
        {column === '' ? t('Values for a new column') : t('Values for column %s', `"${column}"`)}
      </p>
      <table className="w-full text-sm">
        <tbody>
          {values.map((v, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: editable value rows
            <tr key={i}>
              <td className="py-0.5">
                <input
                  className="input"
                  aria-label={t('Value')}
                  value={v}
                  onChange={(e) => setValues(values.map((x, j) => (j === i ? e.target.value : x)))}
                />
              </td>
              <td className="px-1">
                <Button variant="link" onClick={() => setValues(values.filter((_, j) => j !== i))}>
                  {t('Drop')}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex items-center gap-2 text-sm">
        <input type="range" min={1} max={20} value={add} onChange={(e) => setAdd(Number(e.target.value))} />
        <Button onClick={() => setValues([...values, ...Array.from({ length: add }, () => '')])}>
          {t('Add %d value(s)', add)}
        </Button>
      </div>
    </Modal>
  )
}

export function TypeSelect({
  options,
  value,
  onChange,
  name,
}: { options: ColumnFormOptions; value: string; onChange: (v: string) => void; name: string }) {
  const groups: Array<{ group: string | null; items: ColumnFormOptions['types'] }> = []
  for (const o of options.types) {
    const last = groups.at(-1)
    if (last !== undefined && last.group === o.group) last.items.push(o)
    else groups.push({ group: o.group, items: [o] })
  }
  const opt = (o: ColumnFormOptions['types'][number], i: number) =>
    'separator' in o ? (
      <option key={`sep${i}`} disabled>
        -
      </option>
    ) : (
      <option
        key={`${o.group}-${o.type}`}
        value={o.type}
        title={o.description}
        data-length-restricted={o.lengthRestricted ? '1' : '0'}
      >
        {o.type}
      </option>
    )
  return (
    <select
      className="input column_type"
      name={name}
      aria-label={t('Type')}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {groups.map((g, gi) =>
        g.group === null ? (
          <Fragment
            // biome-ignore lint/suspicious/noArrayIndexKey: the top-level group has no label
            key={`top${gi}`}
          >
            {g.items.map(opt)}
          </Fragment>
        ) : (
          <optgroup key={g.group} label={t(g.group)}>
            {g.items.map(opt)}
          </optgroup>
        ),
      )}
    </select>
  )
}

/** Collation dropdown (empty option + one optgroup per charset). */
export function CollationSelect({
  options,
  value,
  onChange,
  name,
  label,
}: {
  options: ColumnFormOptions
  value: string
  onChange: (v: string) => void
  name: string
  label: string
}) {
  return (
    <select
      className="input collation-select"
      name={name}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      lang="en"
      dir="ltr"
    >
      <option value="" />
      {options.charsets.map((cs) => (
        <optgroup key={cs.name} label={cs.name} title={cs.description}>
          {cs.collations.map((c) => (
            <option key={c.name} value={c.name} title={c.description}>
              {c.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

export function ColumnForm({
  mode,
  options,
  rows,
  setRows,
  tableOptions,
  setTableOptions,
  submit,
  reservedCheck,
  onDone,
  header,
  defaultNumFields = 1,
}: {
  mode: FormMode
  options: ColumnFormOptions
  rows: ColumnRow[]
  setRows: (rows: ColumnRow[]) => void
  tableOptions?: TableOptions
  setTableOptions?: (o: TableOptions) => void
  /** runs (or previews with dryRun) the form */
  submit: (dryRun: boolean, online: boolean) => Promise<DdlResponse>
  reservedCheck: (names: string[]) => Promise<{ reserved: boolean; message: string }>
  onDone: (r: DdlResponse) => void
  header?: ReactNode
  defaultNumFields?: number
}) {
  const [online, setOnline] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [enumFor, setEnumFor] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ReturnType<typeof errorMessage> | null>(null)
  const [addCount, setAddCount] = useState(defaultNumFields)

  const update = (i: number, patch: Partial<ColumnRow>) => {
    setRows(
      rows.map((r, j) => {
        if (j !== i) return r
        const next = { ...r, ...patch }
        // ticking A_I picks PRIMARY in the Index select (functions.ts input[value=AUTO_INCREMENT])
        if (patch.autoIncrement === true && mode !== 'change' && next.key === 'none') next.key = 'primary'
        return next
      }),
    )
  }

  const run = async (dryRun: boolean) => {
    setError(null)
    if (!dryRun) {
      const problem = checkTableEditForm(rows, mode, tableOptions?.table ?? '')
      if (problem !== null) {
        window.alert(problem)
        return
      }
      const reserved = await reservedCheck(rows.map((r) => r.name).filter((n) => n !== ''))
      if (reserved.reserved && !window.confirm(reserved.message)) return
      const collationChanged = rows.some(
        (r) =>
          r.orig !== undefined &&
          r.collation !== '' &&
          r.orig.collation !== '' &&
          r.collation !== r.orig.collation,
      )
      if (
        collationChanged &&
        !window.confirm(
          `${t(
            "This operation will attempt to convert your data to the new collation. In rare cases, especially where a character doesn't exist in the new collation, this process could cause the data to appear incorrectly under the new collation; in this case we suggest you revert to the original collation and refer to the tips at ",
          )}${t('Garbled Data')}.\n\n${t('Are you sure you wish to change the collation and convert the data?')}`,
        )
      ) {
        return
      }
    }
    setBusy(true)
    try {
      const r = await submit(dryRun, online)
      if (dryRun) setPreview(r.preview ?? '')
      else onDone(r)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const virtuality = options.virtuality
  const mimeTypes = options.mime ? options.mimeTypes : null
  // the transformations overview of this server (the column form sits below /s/$server)
  const server = Number((useParams({ strict: false }) as { server?: number | string }).server ?? 1)
  return (
    <form
      className={mode === 'create' ? 'create_table_form' : 'append_fields_form'}
      onSubmit={(e) => {
        e.preventDefault()
        void run(false)
      }}
    >
      {header}
      {mode === 'create' && tableOptions !== undefined && setTableOptions !== undefined && (
        <div id="table_name_col_no_outer" className="mb-3 flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-1">
            {t('Table name:')}
            <input
              className="input w-72"
              name="table"
              maxLength={64}
              required
              value={tableOptions.table}
              onChange={(e) => setTableOptions({ ...tableOptions, table: e.target.value })}
            />
          </label>
          <span className="flex items-center gap-1">
            {t('Add')}
            <input
              type="number"
              className="input w-16"
              min={1}
              aria-label={t('Add column(s)')}
              value={addCount}
              onChange={(e) => setAddCount(Number(e.target.value))}
            />
            {t('column(s)')}
            <Button
              onClick={() => setRows([...rows, ...Array.from({ length: Math.max(1, addCount) }, emptyRow)])}
            >
              {t('Go')}
            </Button>
          </span>
        </div>
      )}
      <div className="overflow-x-auto">
        <table id="table_columns" className="w-full border-collapse text-sm">
          <caption className="mb-1 text-left font-semibold">
            {t('Structure')} <MySqlDocLink link="create-table" />
          </caption>
          <thead>
            <tr className="bg-grid-header text-left">
              <th className="px-1">{t('Name')}</th>
              <th className="px-1">
                {t('Type')} <MySqlDocLink link="data-types" />
              </th>
              <th className="px-1">{t('Length/Values')}</th>
              <th className="px-1">{t('Default')}</th>
              <th className="px-1">{t('Collation')}</th>
              <th className="px-1">{t('Attributes')}</th>
              <th className="px-1">{t('Null')}</th>
              {mode === 'change' && (
                <th className="px-1">
                  {t('Adjust privileges')} <DocLink page="faq" anchor="faq6-39" />
                </th>
              )}
              {mode !== 'change' && <th className="px-1">{t('Index')}</th>}
              <th className="px-1">
                <abbr title="AUTO_INCREMENT">A_I</abbr>
              </th>
              <th className="px-1">{t('Comments')}</th>
              {virtuality !== null && <th className="px-1">{t('Virtuality')}</th>}
              {mode === 'change' && <th className="px-1">{t('Move column')}</th>}
              {mimeTypes !== null && (
                <>
                  <th className="px-1">{t('Media type')}</th>
                  <th className="px-1">
                    <Link
                      to="/s/$server/transformations"
                      params={{ server }}
                      hash="transformation"
                      target="_blank"
                      title={t('List of available transformations and their options')}
                    >
                      {t('Browser display transformation')}
                    </Link>
                  </th>
                  <th className="px-1">
                    {t('Browser display transformation options')} <TransformationOptionsHint />
                  </th>
                  <th className="px-1">
                    <Link
                      to="/s/$server/transformations"
                      params={{ server }}
                      hash="input_transformation"
                      target="_blank"
                      title={t('List of available transformations and their options')}
                    >
                      {t('Input transformation')}
                    </Link>
                  </th>
                  <th className="px-1">
                    {t('Input transformation options')} <TransformationOptionsHint />
                  </th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                // biome-ignore lint/suspicious/noArrayIndexKey: form rows are positional (field_name[i])
                key={i}
                className="align-top odd:bg-grid-odd even:bg-grid-even"
                data-testid={`column-row-${i}`}
              >
                <td className="p-1">
                  <input
                    className="input w-32"
                    name={`field_name[${i}]`}
                    aria-label={t('Column')}
                    maxLength={64}
                    title={t('Column')}
                    value={r.name}
                    onChange={(e) => update(i, { name: e.target.value })}
                  />
                </td>
                <td className="p-1">
                  <TypeSelect
                    options={options}
                    name={`field_type[${i}]`}
                    value={r.type}
                    onChange={(v) => update(i, { type: v })}
                  />
                </td>
                <td className="p-1">
                  <input
                    className="input w-24"
                    name={`field_length[${i}]`}
                    aria-label={t('Length/Values')}
                    value={r.length}
                    onChange={(e) => update(i, { length: e.target.value })}
                  />
                  {(r.type === 'ENUM' || r.type === 'SET') && (
                    <p className="enum_notice">
                      <Button variant="link" onClick={() => setEnumFor(i)}>
                        {t('Edit ENUM/SET values')}
                      </Button>
                    </p>
                  )}
                </td>
                <td className="p-1">
                  <select
                    className="input default_type"
                    name={`field_default_type[${i}]`}
                    aria-label={t('Default')}
                    value={r.defaultType}
                    onChange={(e) => update(i, { defaultType: e.target.value })}
                  >
                    {options.defaultTypes.map((d) => (
                      <option key={d} value={d}>
                        {d === 'NONE' ? t('None') : d === 'USER_DEFINED' ? t('As defined:') : d}
                      </option>
                    ))}
                  </select>
                  {r.defaultType === 'USER_DEFINED' &&
                    (options.charEditing === 'textarea' ? (
                      <textarea
                        className="input mt-1"
                        cols={15}
                        aria-label={t('As defined:')}
                        value={r.defaultValue}
                        onChange={(e) => update(i, { defaultValue: e.target.value })}
                      />
                    ) : (
                      <input
                        className="input mt-1 w-28 default_value"
                        aria-label={t('As defined:')}
                        value={r.defaultValue}
                        onChange={(e) => update(i, { defaultValue: e.target.value })}
                      />
                    ))}
                </td>
                <td className="p-1">
                  <CollationSelect
                    options={options}
                    name={`field_collation[${i}]`}
                    label={t('Collation')}
                    value={r.collation}
                    onChange={(v) => update(i, { collation: v })}
                  />
                </td>
                <td className="p-1">
                  <select
                    className="input"
                    name={`field_attribute[${i}]`}
                    aria-label={t('Attributes')}
                    value={r.attribute}
                    onChange={(e) => update(i, { attribute: e.target.value })}
                  >
                    {options.attributes.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="p-1 text-center">
                  <input
                    type="checkbox"
                    className="allow_null"
                    aria-label={t('Null')}
                    name={`field_null[${i}]`}
                    checked={r.null}
                    onChange={(e) => update(i, { null: e.target.checked })}
                  />
                </td>
                {mode === 'change' && (
                  <td className="p-1 text-center">
                    <input
                      type="checkbox"
                      aria-label={t('Adjust privileges')}
                      name={`field_adjust_privileges[${i}]`}
                      disabled={!options.privsAvailable}
                      title={
                        options.privsAvailable
                          ? undefined
                          : t(
                              "You don't have sufficient privileges to perform this operation; Please refer to the documentation for more details",
                            )
                      }
                      checked={r.adjustPrivileges}
                      onChange={(e) => update(i, { adjustPrivileges: e.target.checked })}
                    />
                  </td>
                )}
                {mode !== 'change' && (
                  <td className="p-1">
                    <select
                      className="input"
                      aria-label={t('Index')}
                      value={r.key}
                      onChange={(e) => update(i, { key: e.target.value })}
                    >
                      <option value="none">---</option>
                      <option value="primary" title={t('Primary')}>
                        PRIMARY
                      </option>
                      <option value="unique" title={t('Unique')}>
                        UNIQUE
                      </option>
                      <option value="index" title={t('Index')}>
                        INDEX
                      </option>
                      <option value="fulltext" title={t('Fulltext')}>
                        FULLTEXT
                      </option>
                      <option value="spatial" title={t('Spatial')}>
                        SPATIAL
                      </option>
                    </select>
                  </td>
                )}
                <td className="p-1 text-center">
                  <input
                    type="checkbox"
                    aria-label="AUTO_INCREMENT"
                    name={`field_extra[${i}]`}
                    checked={r.autoIncrement}
                    onChange={(e) => update(i, { autoIncrement: e.target.checked })}
                  />
                </td>
                <td className="p-1">
                  <textarea
                    className="input"
                    rows={1}
                    aria-label={t('Comments')}
                    name={`field_comments[${i}]`}
                    maxLength={options.commentMaxLength}
                    value={r.comments}
                    onChange={(e) => update(i, { comments: e.target.value })}
                  />
                </td>
                {virtuality !== null && (
                  <td className="p-1">
                    <select
                      className="input virtuality"
                      aria-label={t('Virtuality')}
                      name={`field_virtuality[${i}]`}
                      value={r.virtuality}
                      onChange={(e) => update(i, { virtuality: e.target.value })}
                    >
                      {virtuality.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                    {r.virtuality !== '' && (
                      <input
                        className="input mt-1 expression"
                        placeholder={t('Expression')}
                        aria-label={t('Expression')}
                        value={r.expression}
                        onChange={(e) => update(i, { expression: e.target.value })}
                      />
                    )}
                  </td>
                )}
                {mode === 'change' && (
                  <td className="p-1">
                    <select
                      className="input"
                      aria-label={t('Move column')}
                      name={`field_move_to[${i}]`}
                      value={r.moveTo}
                      onChange={(e) => update(i, { moveTo: e.target.value })}
                    >
                      {(r.moveOptions ?? []).map((o) => (
                        <option key={o.value} value={o.value} disabled={o.disabled}>
                          {o.value === ''
                            ? ' '
                            : o.value === '-first'
                              ? t('first')
                              : t('after %s', `\`${o.after}\``)}
                        </option>
                      ))}
                    </select>
                  </td>
                )}
                {mimeTypes !== null && (
                  <MimeCells
                    index={i}
                    mime={r.mime ?? EMPTY_MIME}
                    types={mimeTypes}
                    onChange={(mime) => update(i, { mime })}
                  />
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {mode === 'create' && tableOptions !== undefined && setTableOptions !== undefined && (
        <table className="mt-3 text-sm">
          <tbody>
            <tr>
              <th className="pr-2 text-left align-top">{t('Table comments:')}</th>
              <th className="pr-2 text-left">{t('Collation:')}</th>
              <th className="pr-2 text-left">
                {t('Storage Engine:')} <MySqlDocLink link="storage-engines" />
              </th>
              {tableOptions.engine === 'FEDERATED' && <th className="text-left">{t('Connection:')}</th>}
            </tr>
            <tr>
              <td className="pr-2">
                <textarea
                  className="input"
                  name="comment"
                  aria-label={t('Table comments:')}
                  maxLength={2048}
                  rows={1}
                  cols={30}
                  value={tableOptions.comment}
                  onChange={(e) => setTableOptions({ ...tableOptions, comment: e.target.value })}
                />
              </td>
              <td className="pr-2">
                <CollationSelect
                  options={options}
                  name="tbl_collation"
                  label={t('Collation:')}
                  value={tableOptions.collation}
                  onChange={(v) => setTableOptions({ ...tableOptions, collation: v })}
                />
              </td>
              <td className="pr-2">
                <select
                  className="input"
                  name="tbl_storage_engine"
                  aria-label={t('Storage Engine:')}
                  value={tableOptions.engine}
                  onChange={(e) => setTableOptions({ ...tableOptions, engine: e.target.value })}
                >
                  {options.engines.map((e) => (
                    <option key={e.name} value={e.name} title={e.comment}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </td>
              {tableOptions.engine === 'FEDERATED' && (
                <td>
                  <input
                    className="input"
                    name="connection"
                    required
                    size={40}
                    placeholder="scheme://user_name[:password]@host_name[:port_num]/db_name/tbl_name"
                    value={tableOptions.connection}
                    onChange={(e) => setTableOptions({ ...tableOptions, connection: e.target.value })}
                  />
                </td>
              )}
            </tr>
          </tbody>
        </table>
      )}
      {mode === 'create' &&
        options.havePartitioning &&
        tableOptions !== undefined &&
        setTableOptions !== undefined && (
          <div className="mt-3 text-sm">
            <div className="mb-1 font-semibold">
              {t('PARTITION definition:')} <MySqlDocLink link="partitioning" />
            </div>
            <PartitionEditor
              value={tableOptions.partitioning}
              engines={options.engines}
              onChange={(p) => setTableOptions({ ...tableOptions, partitioning: p })}
            />
          </div>
        )}

      <div className="mt-3 flex flex-wrap items-center gap-3 rounded border border-border bg-bg-subtle px-3 py-2 text-sm">
        {mode !== 'create' && (
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              name="online_transaction"
              checked={online}
              onChange={(e) => setOnline(e.target.checked)}
            />
            {t('Online transaction')} <MySqlDocLink link="innodb-online-ddl" />
          </label>
        )}
        <div className="ml-auto flex gap-2">
          <Button className="preview_sql" disabled={busy} onClick={() => void run(true)}>
            {t('Preview SQL')}
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {t('Save')}
          </Button>
        </div>
      </div>
      {options.integersLengthRestricted && (
        <MessageBox id="length_not_allowed" type="notice" flush className="mt-2">
          {t(
            'The column width of integer types is ignored in your MySQL version unless defining a TINYINT(1) column',
          )}
        </MessageBox>
      )}
      {error !== null && <MessageBox {...error} flush className="mt-2" />}
      <PreviewSqlDialog sql={preview} onClose={() => setPreview(null)} />
      {enumFor !== null && (
        <EnumEditor
          value={rows[enumFor]?.length ?? ''}
          column={rows[enumFor]?.name ?? ''}
          onClose={() => setEnumFor(null)}
          onSave={(v) => {
            update(enumFor, { length: v })
            setEnumFor(null)
          }}
        />
      )}
    </form>
  )
}

/** ColumnRow → the API's ColumnDef */
/**
 * column_attributes.twig, the MIME cells: Media type, Browser display transformation and its
 * options, Input transformation and its options (field_mimetype[i] …).
 */
function MimeCells({
  index,
  mime,
  types,
  onChange,
}: {
  index: number
  mime: MimeValues
  types: NonNullable<ColumnFormOptions['mimeTypes']>
  onChange: (m: MimeValues) => void
}) {
  const set = (k: keyof MimeValues, v: string) => onChange({ ...mime, [k]: v })
  return (
    <>
      <td className="p-1 text-center">
        <select
          className="input"
          name={`field_mimetype[${index}]`}
          aria-label={t('Media type')}
          value={mime.mimetype}
          onChange={(e) => set('mimetype', e.target.value)}
        >
          <option value="">{'\u00a0'}</option>
          {types.mimetypes.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </td>
      <td className="p-1 text-center">
        <select
          className="input"
          name={`field_transformation[${index}]`}
          aria-label={t('Browser display transformation')}
          value={mime.transformation}
          onChange={(e) => set('transformation', e.target.value)}
        >
          <option value="" title={t('None')} />
          {types.transformations.map((o) => (
            <option key={o.value} value={o.value} title={o.title}>
              {o.label}
            </option>
          ))}
        </select>
      </td>
      <td className="p-1 text-center">
        <input
          type="text"
          size={16}
          className="input"
          name={`field_transformation_options[${index}]`}
          aria-label={t('Browser display transformation options')}
          value={mime.transformationOptions}
          onChange={(e) => set('transformationOptions', e.target.value)}
        />
      </td>
      <td className="p-1 text-center">
        <select
          className="input"
          name={`field_input_transformation[${index}]`}
          aria-label={t('Input transformation')}
          value={mime.inputTransformation}
          onChange={(e) => set('inputTransformation', e.target.value)}
        >
          <option value="" title={t('None')} />
          {types.inputTransformations.map((o) => (
            <option key={o.value} value={o.value} title={o.title}>
              {o.label}
            </option>
          ))}
        </select>
      </td>
      <td className="p-1 text-center">
        <input
          type="text"
          size={16}
          className="input"
          name={`field_input_transformation_options[${index}]`}
          aria-label={t('Input transformation options')}
          value={mime.inputTransformationOptions}
          onChange={(e) => set('inputTransformationOptions', e.target.value)}
        />
      </td>
    </>
  )
}

/** The posted row; the MIME fields go along whenever the form shows them (every row, like phpMyAdmin). */
export const toColumnDef = (r: ColumnRow, options?: ColumnFormOptions) => ({
  ...(options?.mime === true ? { mime: r.mime ?? EMPTY_MIME } : {}),
  name: r.name,
  type: r.type,
  length: r.length,
  defaultType: r.defaultType,
  defaultValue: r.defaultValue,
  collation: r.collation,
  attribute: r.attribute,
  null: r.null,
  autoIncrement: r.autoIncrement,
  comments: r.comments,
  virtuality: r.virtuality,
  expression: r.expression,
})
