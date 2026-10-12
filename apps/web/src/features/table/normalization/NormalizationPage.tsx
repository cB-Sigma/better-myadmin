import type { NewTables3NFResponse, NormalizationTableResponse, SqlMessage } from '@bettermyadmin/contracts'
import {
  Button,
  Input,
  MessageBox,
  NativeCheckbox,
  NativeSelect,
  Panel,
  PanelBody,
  PmaIcon,
  Radio,
} from '@bettermyadmin/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useEffect, useState } from 'react'
import { type TableRef, api, errorMessage } from '../../../lib/api'
import { t } from '../../../lib/i18n'
import { qk } from '../../../lib/queryKeys'
import { ResultMessages } from '../common/ResultMessages'
import { IndexDialog } from '../indexes/IndexEditor'
import { CentralColumnPicker } from '../structure/CentralColumnPicker'
import { ColumnForm, type ColumnRow, emptyRow, toColumnDef } from '../structure/ColumnForm'

/**
 * The normalization wizard: 1NF (atomic columns, a primary key, repeating groups, redundant
 * columns), 2NF (partial dependencies), 3NF (transitive dependencies). One card (#mainContent)
 * whose header, question, hint and controls change step by step, as normalization.js does.
 *
 * pma: resources/templates/table/normalization/normalization.twig, src/Normalization.php (the
 *      step HTML), resources/js/normalization.ts
 */
type NormalForm = '1nf' | '2nf' | '3nf'
type Dependencies = Array<[string, string[]]>
type Stage =
  | { k: 'start' }
  | { k: '1.1' }
  | { k: '1.2'; extra?: 'goToStep3' | 'goToFinish1NF' }
  | { k: '1.3' }
  | { k: '1.4' }
  | { k: '1-end' }
  | { k: '2.1' }
  | { k: '2.2'; pd: Dependencies; pk: string }
  | { k: '2-end' }
  | { k: '3.1'; tables: string[] }
  | { k: '3.2'; pd: Record<string, string[]>; tables: Array<[string, string[]]> }
  | { k: '3-end' }

const phaseTitle = (f: NormalForm) =>
  f === '1nf'
    ? t('First step of normalization (1NF)')
    : f === '2nf'
      ? t('Second step of normalization (2NF)')
      : t('Third step of normalization (3NF)')

export function NormalizationPage({ scope }: { scope: TableRef }) {
  const qc = useQueryClient()
  const key = qk.tblPage(scope, 'normalization')
  const q = useQuery({ queryKey: key, queryFn: () => api.normalization(scope) })
  const [normalizeTo, setNormalizeTo] = useState<NormalForm>('1nf')
  const [stage, setStage] = useState<Stage>({ k: 'start' })
  const [messages, setMessages] = useState<SqlMessage[]>([])
  const refresh = () => qc.invalidateQueries({ queryKey: qk.tbl(scope) })
  if (q.isError) return <MessageBox {...errorMessage(q.error)} />
  if (q.data === undefined) return null

  if (stage.k === 'start') {
    return (
      <form
        id="normalizeTable"
        onSubmit={(e) => {
          e.preventDefault()
          setStage({ k: '1.1' })
        }}
      >
        <Panel
          title={t('Improve table structure (Normalization):')}
          footer={
            <Button type="submit" variant="primary" name="submit_normalize">
              {t('Go')}
            </Button>
          }
        >
          <PanelBody className="flex flex-col gap-2">
            <h3 className="text-lg">{t('Select up to what step you want to normalize')}</h3>
            <MessageBox
              type="notice"
              text={t('Hint: Please follow the procedure carefully in order to obtain correct normalization')}
            />
            {(
              [
                ['1nf', t('First step of normalization (1NF)')],
                ['2nf', t('Second step of normalization (1NF+2NF)')],
                ['3nf', t('Third step of normalization (1NF+2NF+3NF)')],
              ] as const
            ).map(([v, label], i) => (
              <label key={v} className="flex items-center gap-2" htmlFor={`normalizeToRadio${i + 1}`}>
                <Radio
                  name="normalizeTo"
                  id={`normalizeToRadio${i + 1}`}
                  value={v}
                  checked={normalizeTo === v}
                  onChange={() => setNormalizeTo(v)}
                />
                {label}
              </label>
            ))}
          </PanelBody>
        </Panel>
      </form>
    )
  }

  const phase: NormalForm = stage.k.startsWith('3') ? '3nf' : stage.k.startsWith('2') ? '2nf' : '1nf'
  const env: StepEnv = {
    scope,
    data: q.data,
    normalizeTo,
    go: (s) => {
      setMessages([])
      setStage(s)
    },
    show: setMessages,
    refresh,
  }
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-lg">{phaseTitle(phase)}</h3>
      <ResultMessages messages={messages} />
      <Step key={JSON.stringify(stage)} stage={stage} env={env} />
    </div>
  )
}

interface StepEnv {
  scope: TableRef
  data: NormalizationTableResponse
  normalizeTo: NormalForm
  go: (s: Stage) => void
  show: (m: SqlMessage[]) => void
  refresh: () => Promise<void>
}

/** #mainContent: .card-header legend, h4 question, p.cm-em hint, #extra, #newCols, .card-footer */
function StepCard({
  legend,
  head,
  sub,
  extra,
  newCols,
  footer,
}: {
  legend: string
  head: ReactNode
  sub?: ReactNode
  extra?: ReactNode
  newCols?: ReactNode
  footer?: ReactNode
}) {
  return (
    <Panel id="mainContent" title={legend} footer={footer}>
      <PanelBody className="flex flex-col gap-2">
        <h4 className="font-semibold">{head}</h4>
        {sub !== undefined && <p className="cm-em italic">{sub}</p>}
        <div id="extra">{extra}</div>
        <div id="newCols">{newCols}</div>
      </PanelBody>
    </Panel>
  )
}

/** a msgid with `<br>` / `<b>` markup (Normalization.php builds HTML): line breaks, tags dropped */
const plain = (s: string) => s.replaceAll('<br>', '\n').replace(/<\/?b>/g, '')

function Step({ stage, env }: { stage: Stage; env: StepEnv }) {
  switch (stage.k) {
    case '1.1':
      return <Step11 env={env} />
    case '1.2':
      return <Step12 env={env} extra={stage.extra} />
    case '1.3':
      return <Step13 env={env} />
    case '1.4':
      return <Step14 env={env} />
    case '1-end':
      return (
        <StepCard
          legend={t('End of step')}
          head={
            <span className="text-lg">
              {t("The first step of normalization is complete for table '%s'.", env.scope.table)}
            </span>
          }
        />
      )
    case '2.1':
      return <Step21 env={env} />
    case '2.2':
      return <Step22 env={env} pd={stage.pd} pk={stage.pk} />
    case '2-end':
      return (
        <StepCard
          legend={t('End of step')}
          head={
            <span className="text-lg">
              {t("The second step of normalization is complete for table '%1$s'.", env.scope.table)}
            </span>
          }
        />
      )
    case '3.1':
      return <Step31 env={env} tables={stage.tables} />
    case '3.2':
      return <Step32 env={env} pd={stage.pd} tables={stage.tables} />
    case '3-end':
      return (
        <StepCard
          legend={t('End of step')}
          head={<span className="text-lg">{t('The third step of normalization is complete.')}</span>}
        />
      )
    default:
      return null
  }
}

const legend1 = (n: number, text: string) => `${t('Step 1.')}${n} ${text}`

/** the add-column grid of #newCols (/normalization/create-new-column, /normalization/add-new-primary) */
function NewColumns({
  env,
  initial,
  onSaved,
  onCancel,
  afterSave,
}: {
  env: StepEnv
  initial: ColumnRow[]
  onSaved: () => void
  onCancel: () => void
  /** runs after the columns were added (the split drops the original column) */
  afterSave?: () => Promise<SqlMessage[] | null>
}) {
  const form = useQuery({
    queryKey: qk.addColumnsForm(env.scope),
    queryFn: () => api.addColumnsForm(env.scope),
  })
  const [rows, setRows] = useState<ColumnRow[]>(initial)
  if (form.data === undefined) return null
  const options = form.data.options
  return (
    <div>
      <ColumnForm
        mode="add"
        options={options}
        rows={rows}
        setRows={setRows}
        reservedCheck={(names) => api.reservedWordCheck(env.scope, names)}
        submit={(dryRun, _online, indexes) =>
          api.addColumns(env.scope, {
            columns: rows.map((r) => toColumnDef(r, options)),
            indexes,
            where: 'last',
            dryRun,
          })
        }
        onDone={async (r) => {
          const extra = afterSave === undefined ? null : await afterSave()
          if (extra?.some((m) => m.type === 'error')) {
            env.show(extra)
            return
          }
          env.show(r.messages)
          await env.refresh()
          onSaved()
        }}
      />
      <Button className="mt-2" onClick={onCancel}>
        {t('Cancel')}
      </Button>
    </div>
  )
}

function Step11({ env }: { env: StepEnv }) {
  // the placeholder option has no value attribute: its value is its text
  const placeholder = t('Select one…')
  const [selected, setSelected] = useState(placeholder)
  const [num, setNum] = useState(2)
  const [splitting, setSplitting] = useState<number | null>(null)
  const [centralList, setCentralList] = useState(false)
  return (
    <StepCard
      legend={legend1(1, t('Make all columns atomic'))}
      head={
        <>
          {t(
            'Do you have any column which can be split into more than one column? For example: address can be split into street, city, country and zip.',
          )}
          <br />(
          <Button variant="link" className="central_columns_dialog" onClick={() => setCentralList(true)}>
            {t('Show me the central list of columns that are not already in this table')}
          </Button>
          )
          {centralList && (
            // data-maxrows='25' data-pick=false
            <CentralColumnPicker
              server={env.scope.server}
              db={env.scope.db}
              table={env.scope.table}
              maxRows={25}
              onPick={null}
              onClose={() => setCentralList(false)}
            />
          )}
        </>
      }
      sub={t(
        "Select a column which can be split into more than one (on select of 'no such column', it'll move to next step).",
      )}
      extra={
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect
            id="selectNonAtomicCol"
            name="makeAtomic"
            className="w-auto"
            value={selected}
            onChange={(e) => {
              if (e.target.value === 'no_such_col') env.go({ k: '1.2' })
              else setSelected(e.target.value)
            }}
          >
            <option value={placeholder} disabled>
              {placeholder}
            </option>
            <option value="no_such_col">{t('No such column')}</option>
            {env.data.stringColumns.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name} [ {c.type} ]
              </option>
            ))}
          </NativeSelect>
          <span>{t('split into ')}</span>
          <Input
            id="numField"
            type="number"
            className="max-w-20"
            value={num}
            onChange={(e) => setNum(Number(e.target.value))}
          />
          <Button
            variant="primary"
            id="splitGo"
            onClick={() => {
              if (selected !== placeholder) setSplitting(Math.min(4096, Math.max(1, Math.trunc(num) || 1)))
            }}
          >
            {t('Go')}
          </Button>
        </div>
      }
      newCols={
        splitting !== null && (
          <NewColumns
            env={env}
            initial={Array.from({ length: splitting }, emptyRow)}
            onCancel={() => setSplitting(null)}
            onSaved={() => {
              setSplitting(null)
              setSelected(placeholder)
            }}
            afterSave={async () => {
              // then `ALTER TABLE t DROP col` through /sql (dropped_column, purge=1)
              try {
                return (await api.dropColumns(env.scope, { columns: [selected], source: 'row' })).messages
              } catch (e) {
                return [errorMessage(e)]
              }
            }}
          />
        )
      }
    />
  )
}

function Step12({ env, extra }: { env: StepEnv; extra?: 'goToStep3' | 'goToFinish1NF' | undefined }) {
  const has = env.data.primaryKey.length > 0
  const [adding, setAdding] = useState(false)
  const [indexOpen, setIndexOpen] = useState(false)
  const [added, setAdded] = useState(false)
  useEffect(() => {
    if (!has) return
    if (extra === 'goToFinish1NF') {
      finish1NF(env)
      return
    }
    const id = setTimeout(() => env.go({ k: '1.3' }), 3000)
    return () => clearTimeout(id)
  }, [has, extra, env])
  if (has || added) {
    return (
      <StepCard
        legend={legend1(2, t('Have a primary key'))}
        head={extra === 'goToStep3' || added ? t('Primary key added.') : t('Primary key already exists.')}
        sub={t('Taking you to next step…')}
      />
    )
  }
  return (
    <>
      <StepCard
        legend={legend1(2, t('Have a primary key'))}
        head={plain(
          t(
            'There is no primary key; please add one.<br>Hint: A primary key is a column (or combination of columns) that uniquely identify all rows.',
          ),
        )}
        sub={
          <Button variant="link" id="createPrimaryKey" onClick={() => setIndexOpen(true)}>
            <PmaIcon name="b_index_add" /> {t('Add a primary key on existing column(s)')}
          </Button>
        }
        extra={
          <>
            {t("If it's not possible to make existing column combinations as primary key")}
            <br />
            <Button variant="link" id="addNewPrimary" onClick={() => setAdding(true)}>
              {t('+ Add a new primary key column')}
            </Button>
          </>
        }
        newCols={
          adding && (
            <NewColumns
              env={env}
              initial={[
                { ...emptyRow(), name: `${env.scope.table}_id`, autoIncrement: true, key: 'primary' },
              ]}
              onCancel={() => setAdding(false)}
              onSaved={() => {
                setAdding(false)
                setAdded(true)
                setTimeout(() => env.go({ k: '1.3' }), 2000)
              }}
            />
          )
        }
      />
      <IndexDialog
        scope={env.scope}
        title={t('Add primary key')}
        query={indexOpen ? { primary: true } : null}
        onClose={() => setIndexOpen(false)}
        onDone={async () => {
          setIndexOpen(false)
          await env.refresh()
          env.go({ k: '1.2', extra: 'goToStep3' })
        }}
      />
    </>
  )
}

/** goToFinish1NF: 2NF next, or the end of 1NF */
function finish1NF(env: StepEnv) {
  if (env.normalizeTo !== '1nf') env.go({ k: '2.1' })
  else env.go({ k: '1-end' })
}

/** the column checkboxes of steps 1.3 / 1.4 (`name [ type ]`, the primary key disabled) */
function ColumnChecks({
  env,
  checked,
  setChecked,
}: { env: StepEnv; checked: string[]; setChecked: (c: string[]) => void }) {
  return (
    <div className="flex flex-col">
      {env.data.columns.map((c) => (
        // the template's checkboxes have no <label> (getHtmlForColumnsList)
        <span key={c.name} className="flex items-center gap-1">
          <NativeCheckbox
            value={c.name}
            disabled={env.data.primaryKey.includes(c.name)}
            checked={checked.includes(c.name)}
            onChange={(e) =>
              setChecked(e.target.checked ? [...checked, c.name] : checked.filter((x) => x !== c.name))
            }
          />
          {c.name} [ {c.type} ]
        </span>
      ))}
    </div>
  )
}

function Step13({ env }: { env: StepEnv }) {
  const [checked, setChecked] = useState<string[]>([])
  const [confirm, setConfirm] = useState<string[] | null>(null)
  const [newTable, setNewTable] = useState('')
  const [newColumn, setNewColumn] = useState('')
  const ordered = env.data.columns.map((c) => c.name).filter((n) => checked.includes(n))
  const go = async () => {
    if (newTable === '' || newColumn === '' || confirm === null) return
    try {
      const r = await api.normalizationMoveRepeatingGroup(env.scope, {
        repeatingColumns: confirm.join(', '),
        newTable,
        newColumn,
        primaryColumns: env.data.primaryKey.join(','),
      })
      await env.refresh()
      if (!r.queryError) env.go({ k: '1.3' })
      env.show(r.messages)
    } catch (e) {
      env.show([errorMessage(e)])
    }
  }
  return (
    <StepCard
      legend={legend1(3, t('Move repeating groups'))}
      head={t(
        'Do you have a group of two or more columns that are closely related and are all repeating the same attribute? For example, a table that holds data on books might have columns such as book_id, author1, author2, author3 and so on which form a repeating group. In this case a new table (book_id, author) should be created.',
      )}
      sub={t(
        "Check the columns which form a repeating group. If no such group, click on 'No repeating group'",
      )}
      extra={
        <>
          <ColumnChecks env={env} checked={checked} setChecked={setChecked} />
          <div className="mt-2 flex gap-2">
            <Button
              id="moveRepeatingGroup"
              onClick={() => {
                if (ordered.length === 0) return
                setConfirm(ordered)
                setNewColumn(ordered[0] ?? '')
              }}
            >
              {t('Done')}
            </Button>
            <Button id="noRepeatingGroup" onClick={() => env.go({ k: '1.4' })}>
              {t('No repeating group')}
            </Button>
          </div>
        </>
      }
      newCols={
        confirm !== null && (
          <ol className="list-decimal pl-6">
            <b>{t('The following actions will be performed:')}</b>
            <li>{t('DROP columns %s from the table %s', confirm.join(', '), env.scope.table)}</li>
            <li>
              {t('Create the following table')}
              <div className="flex flex-wrap items-center gap-1">
                <Input
                  name="repeatGroupTable"
                  className="max-w-48"
                  placeholder="Enter new table name"
                  value={newTable}
                  onChange={(e) => setNewTable(e.target.value)}
                />
                ( {env.data.primaryKey.join(',')},
                <Input
                  name="repeatGroupColumn"
                  className="max-w-48"
                  placeholder="Enter column name"
                  value={newColumn}
                  onChange={(e) => setNewColumn(e.target.value)}
                />
                )
              </div>
            </li>
          </ol>
        )
      }
      footer={
        confirm !== null && (
          <div className="flex gap-2">
            <Button
              onClick={() => {
                setConfirm(null)
                setChecked([])
              }}
            >
              {t('Cancel')}
            </Button>
            <Button variant="primary" onClick={() => void go()}>
              {t('Go')}
            </Button>
          </div>
        )
      }
    />
  )
}

function Step14({ env }: { env: StepEnv }) {
  const [checked, setChecked] = useState<string[]>([])
  const remove = async () => {
    const cols = env.data.columns.map((c) => c.name).filter((n) => checked.includes(n))
    if (cols.length === 0) return
    try {
      const r = await api.dropColumns(env.scope, { columns: cols, source: 'bulk' })
      if (r.messages.some((m) => m.type === 'error')) return env.show(r.messages)
      await env.refresh()
      env.go({ k: '1.2', extra: 'goToFinish1NF' })
    } catch (e) {
      env.show([errorMessage(e)])
    }
  }
  return (
    <StepCard
      legend={legend1(4, t('Remove redundant columns'))}
      head={t(
        'Do you have a group of columns which on combining gives an existing column? For example, if you have first_name, last_name and full_name then combining first_name and last_name gives full_name which is redundant.',
      )}
      sub={t(
        "Check the columns which are redundant and click on remove. If no redundant column, click on 'No redundant column'",
      )}
      extra={
        <>
          <ColumnChecks env={env} checked={checked} setChecked={setChecked} />
          <div className="mt-2 flex gap-2">
            <Button id="removeRedundant" onClick={() => void remove()}>
              {t('Remove selected')}
            </Button>
            <Button id="noRedundantColumn" onClick={() => finish1NF(env)}>
              {t('No redundant column')}
            </Button>
          </div>
        </>
      }
    />
  )
}

/** the dependency checkboxes of one column (`'%s' depends on:`) */
function DependsOn({
  column,
  choices,
  value,
  onChange,
}: {
  column: string
  choices: string[]
  value: string[]
  onChange: (v: string[]) => void
}) {
  return (
    <div className="mb-2">
      <b>{t("'%1$s' depends on:", column)}</b>
      <div className="smallIndent ml-4 flex flex-wrap gap-3">
        {choices.map((c) => (
          <span key={c} className="flex items-center gap-1">
            <NativeCheckbox
              name="pd"
              value={c}
              checked={value.includes(c)}
              onChange={(e) => onChange(e.target.checked ? [...value, c] : value.filter((x) => x !== c))}
            />
            {c}
          </span>
        ))}
      </div>
    </div>
  )
}

function Step21({ env }: { env: StepEnv }) {
  const pk = env.data.primaryKey
  const key = pk.join(', ')
  const nonPk = env.data.columns.map((c) => c.name).filter((c) => !pk.includes(c))
  const [deps, setDeps] = useState<Record<string, string[]>>({})
  const [possible, setPossible] = useState<Array<{ determinants: string; dependents: string[] }> | null>(null)
  const [showPossible, setShowPossible] = useState(false)
  const legend = `${t('Step 2.')}1 ${t('Find partial dependencies')}`
  const done = pk.length <= 1 || pk.length === env.data.columns.length
  useEffect(() => {
    if (!done || env.normalizeTo !== '3nf') return
    const id = setTimeout(() => env.go({ k: '3.1', tables: [env.scope.table] }), 3000)
    return () => clearTimeout(id)
  }, [done, env])
  if (done) {
    return (
      <StepCard
        legend={legend}
        head={
          pk.length <= 1
            ? t('No partial dependencies possible as the primary key ( %1$s ) has just one column.', key)
            : t(
                'No partial dependencies possible as no non-primary column exists since primary key ( %1$s ) is composed of all the columns in the table.',
                key,
              )
        }
        extra={<h3 className="text-lg">{t('Table is already in second normal form.')}</h3>}
        newCols={env.normalizeTo === '3nf' ? t('Taking you to next step…') : undefined}
      />
    )
  }
  // processDependencies(primaryKey): pd[pk] first, then each column's checked set (or the pk)
  const processDependencies = () => {
    const pd = new Map<string, string[]>([[key, []]])
    for (const column of nonPk) {
      const chosen = pk.filter((c) => (deps[column] ?? []).includes(c))
      const dependsOn = chosen.length === 0 ? key : chosen.join(', ')
      pd.set(dependsOn, [...(pd.get(dependsOn) ?? []), column])
    }
    env.go({ k: '2.2', pd: [...pd], pk: key })
  }
  const togglePossible = async () => {
    if (possible === null) {
      try {
        setPossible((await api.normalizationPartialDependencies(env.scope)).dependencies)
      } catch (e) {
        env.show([errorMessage(e)])
        return
      }
    }
    setShowPossible(!showPossible)
  }
  return (
    <StepCard
      legend={legend}
      head={
        <>
          {t(
            'The primary key ( %1$s ) consists of more than one column so we need to find the partial dependencies.',
            key,
          )}
          <br />
          {t('Please answer the following question(s) carefully to obtain a correct normalization.')}
          <br />
          <Button variant="link" id="showPossiblePd" onClick={() => void togglePossible()}>
            {showPossible
              ? `- ${t('Hide partial dependencies list')}`
              : t('+ Show me the possible partial dependencies based on data in the table')}
          </Button>
          {showPossible && possible !== null && (
            <div className="font-normal">
              {t("This list is based on a subset of the table's data and is not necessarily accurate. ")}
              <div className="dependencies_box">
                {possible.map((p) => (
                  <span key={p.determinants} className="flex items-center gap-1">
                    <Button
                      className="pickPd"
                      onClick={() => {
                        const left = p.determinants.split(',').map((s) => s.trim())
                        const next = { ...deps }
                        for (const c of p.dependents) next[c] = left
                        setDeps(next)
                      }}
                    >
                      {t('Pick')}
                    </Button>
                    <span className="determinants">{p.determinants}</span> -&gt;{' '}
                    <span className="dependents">{p.dependents.join(', ')}</span>
                  </span>
                ))}
                {possible.length === 0 && <p className="m-1">{t('No partial dependencies found!')}</p>}
              </div>
            </div>
          )}
        </>
      }
      sub={plain(
        t(
          'For each column below, please select the <b>minimal set</b> of columns among given set whose values combined together are sufficient to determine the value of the column.',
        ),
      )}
      extra={nonPk.map((c) => (
        <DependsOn
          key={c}
          column={c}
          choices={pk}
          value={deps[c] ?? []}
          onChange={(v) => setDeps({ ...deps, [c]: v })}
        />
      ))}
      footer={
        <Button variant="primary" onClick={processDependencies}>
          {t('Done')}
        </Button>
      }
    />
  )
}

function Step22({ env, pd, pk }: { env: StepEnv; pd: Dependencies; pk: string }) {
  const found = pd.filter(([k]) => k !== pk)
  const proposals = useQuery({
    queryKey: qk.normalizationStep(env.scope, '2nf', pd),
    queryFn: () => api.normalizationNewTables2NF(env.scope, pd),
    enabled: found.length > 0,
  })
  const [names, setNames] = useState<Record<string, string>>({})
  const nameOf = (k: string, d: string) => names[k] ?? d
  const go = async () => {
    const tables = Object.fromEntries(
      (proposals.data?.tables ?? []).map((x) => [x.key, nameOf(x.key, x.name)]),
    )
    try {
      const r = await api.normalizationCreateTables2NF(env.scope, { pd, newTablesName: tables })
      await env.refresh()
      if (r.queryError) return env.show(r.messages)
      // goTo3NFStep1(tables): one table → the current table
      if (env.normalizeTo === '3nf') {
        const list = Object.values(tables)
        return env.go({ k: '3.1', tables: list.length === 1 ? [env.scope.table] : list })
      }
      env.go({ k: '2-end' })
    } catch (e) {
      env.show([errorMessage(e)])
    }
  }
  return (
    <StepCard
      legend={`${t('Step')} 2.2 ${t('Confirm partial dependencies')}`}
      head={t('Selected partial dependencies are as follows:')}
      sub={t(
        'Note: a, b -> d,f implies values of columns a and b combined together can determine values of column d and column f.',
      )}
      extra={
        <>
          <div className="dependencies_box">
            {found.map(([k, cols]) => (
              <p key={k} className="m-1">
                {k} -&gt; {cols.join(',')}
              </p>
            ))}
            {found.length === 0 && <p className="m-1">{t('No partial dependencies selected!')}</p>}
          </div>
          {found.length > 0 && proposals.data !== undefined && (
            <>
              <p>
                <b>
                  {t(
                    "In order to put the original table '%1$s' into Second normal form we need to create the following tables:",
                    env.scope.table,
                  )}
                </b>
              </p>
              {proposals.data.tables.map((x) => (
                <p key={x.key} className="flex flex-wrap items-center gap-1">
                  <Input
                    name={x.key}
                    className="max-w-48"
                    value={nameOf(x.key, x.name)}
                    onChange={(e) => setNames({ ...names, [x.key]: e.target.value })}
                  />
                  ( <u>{x.key}</u>
                  {x.dependents.length > 0 ? ', ' : ''}
                  {x.dependents.join(', ')} )
                </p>
              ))}
            </>
          )}
        </>
      }
      footer={
        <div className="flex gap-2">
          <Button variant="primary" id="backEditPd" onClick={() => env.go({ k: '2.1' })}>
            {t('Back')}
          </Button>
          <Button variant="primary" id="goTo2NFFinish" onClick={() => void go()}>
            {t('Go')}
          </Button>
        </div>
      }
    />
  )
}

function Step31({ env, tables }: { env: StepEnv; tables: string[] }) {
  const q = useQuery({
    queryKey: qk.normalizationStep(env.scope, '3nf', tables),
    queryFn: () => api.normalization3NFStep(env.scope, tables),
  })
  const [deps, setDeps] = useState<Record<string, string[]>>({})
  if (q.data === undefined) return null
  const legend = `${t('Step 3.')}1 ${t('Find transitive dependencies')}`
  if (q.data.tables.length === 0) {
    return (
      <StepCard
        legend={legend}
        head={t("No Transitive dependencies possible as the table doesn't have any non primary key columns")}
        extra={<h3 className="text-lg">{t('Table is already in Third normal form!')}</h3>}
      />
    )
  }
  const formKey = (table: string, column: string) => `${table}\u0000${column}`
  // processDependencies('', true): pd[''] first; per form the table, then its determinant
  const processDependencies = () => {
    const pd: Record<string, string[]> = { '': [] }
    const tablesTds: Array<[string, string[]]> = []
    const tdsOf = (tb: string) => {
      let entry = tablesTds.find(([n]) => n === tb)
      if (entry === undefined) {
        entry = [tb, []]
        tablesTds.push(entry)
      }
      return entry[1]
    }
    for (const tb of q.data.tables) {
      for (const column of tb.nonPk) {
        tdsOf(tb.table).push(tb.table)
        const chosen = tb.nonPk.filter(
          (c) => c !== column && (deps[formKey(tb.table, column)] ?? []).includes(c),
        )
        const dependsOn = chosen.length === 0 ? tb.table : chosen.join(', ')
        pd[dependsOn] = [...(pd[dependsOn] ?? []), column]
        const list = tdsOf(tb.table)
        if (!list.includes(dependsOn)) list.push(dependsOn)
      }
    }
    env.go({ k: '3.2', pd, tables: tablesTds })
  }
  return (
    <StepCard
      legend={legend}
      head={t('Please answer the following question(s) carefully to obtain a correct normalization.')}
      sub={plain(
        t(
          "For each column below, please select the <b>minimal set</b> of columns among given set whose values combined together are sufficient to determine the value of the column.<br>Note: A column may have no transitive dependency, in that case you don't have to select any.",
        ),
      )}
      extra={q.data.tables.flatMap((tb) =>
        tb.nonPk.map((c) => (
          <DependsOn
            key={formKey(tb.table, c)}
            column={c}
            choices={tb.nonPk.filter((x) => x !== c)}
            value={deps[formKey(tb.table, c)] ?? []}
            onChange={(v) => setDeps({ ...deps, [formKey(tb.table, c)]: v })}
          />
        )),
      )}
      footer={
        <Button variant="primary" onClick={processDependencies}>
          {t('Done')}
        </Button>
      }
    />
  )
}

function Step32({
  env,
  pd,
  tables,
}: {
  env: StepEnv
  pd: Record<string, string[]>
  tables: Array<[string, string[]]>
}) {
  const found = tables.flatMap(([table, list]) => list.filter((d) => d !== '' && d !== table))
  const proposals = useQuery({
    queryKey: qk.normalizationStep(env.scope, '3nf-new', { pd, tables }),
    queryFn: () => api.normalizationNewTables3NF(env.scope, pd, tables),
    enabled: found.length > 0,
  })
  const [names, setNames] = useState<Record<string, string>>({})
  const go = async () => {
    // goTo3NFFinish: each proposed table under the name typed for it
    const newTables: NewTables3NFResponse['newTables'] =
      found.length === 0
        ? []
        : (proposals.data?.newTables ?? []).map(([orig, list]) => [
            orig,
            list.map(
              ([name, cols]) => [names[`${orig}\u0000${name}`] ?? name, cols] as [string, typeof cols],
            ),
          ])
    try {
      const r = await api.normalizationCreateTables3NF(env.scope, { newTables })
      await env.refresh()
      if (r.queryError) return env.show(r.messages)
      env.go({ k: '3-end' })
    } catch (e) {
      env.show([errorMessage(e)])
    }
  }
  return (
    <StepCard
      legend={`${t('Step')} 3.2 ${t('Confirm transitive dependencies')}`}
      head={t('Selected dependencies are as follows:')}
      sub={t(
        'Note: a, b -> d,f implies values of columns a and b combined together can determine values of column d and column f.',
      )}
      extra={
        <>
          <div className="dependencies_box">
            {found.map((d) => (
              <p key={d} className="m-1">
                {d} -&gt; {(pd[d] ?? []).join(',')}
              </p>
            ))}
            {found.length === 0 && <p className="m-1">{t('No dependencies selected!')}</p>}
          </div>
          {found.length > 0 &&
            proposals.data?.newTables.map(([orig, list]) => (
              <div key={orig}>
                <p>
                  <b>
                    {t(
                      "In order to put the original table '%1$s' into Third normal form we need to create the following tables:",
                      orig,
                    )}
                  </b>
                </p>
                {list.map(([name, cols]) => (
                  <p key={name} className="flex flex-wrap items-center gap-1">
                    <Input
                      name={name}
                      className="max-w-48"
                      value={names[`${orig}\u0000${name}`] ?? name}
                      onChange={(e) => setNames({ ...names, [`${orig}\u0000${name}`]: e.target.value })}
                    />
                    ( <u>{cols.pk}</u>
                    {cols.nonpk !== '' ? ', ' : ''}
                    {cols.nonpk} )
                  </p>
                ))}
              </div>
            ))}
        </>
      }
      footer={
        <div className="flex gap-2">
          <Button
            variant="primary"
            id="backEditPd"
            onClick={() => env.go({ k: '3.1', tables: tables.map(([n]) => n) })}
          >
            {t('Back')}
          </Button>
          <Button variant="primary" id="goTo3NFFinish" onClick={() => void go()}>
            {t('Go')}
          </Button>
        </div>
      }
    />
  )
}
