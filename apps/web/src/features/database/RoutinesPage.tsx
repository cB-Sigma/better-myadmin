import type {
  RoutineEditorData,
  RoutineEditorOptions,
  RoutineExecuteForm,
  RoutineExecuteResponse,
  SqlMessage,
} from '@bettermyadmin/contracts'
import {
  Button,
  Checkbox,
  DocLink,
  Input,
  MySqlDocLink,
  NativeSelect,
  Panel,
  PanelBody,
  Textarea,
} from '@bettermyadmin/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../../lib/api'
import { t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'
import { HighlightedSql } from '../sql/HighlightedSql'
import { DbModal, ListNavigator, Messages, errorMessage } from './common'
import { EditorFooter, EditorRow, ProgramListPage, RowAction } from './programs'

/**
 * Database → Routines.
 * pma: templates/database/routines/*.twig, resources/js/database/routines.ts
 */
type Param = RoutineEditorData['params'][number]

const NUMERIC = ['TINYINT', 'SMALLINT', 'MEDIUMINT', 'INT', 'BIGINT', 'DECIMAL', 'FLOAT', 'DOUBLE', 'REAL']
const TEXTUAL = ['TINYTEXT', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT', 'CHAR', 'VARCHAR', 'SET', 'ENUM']
const NO_LENGTH = [
  'DATE',
  'TINYBLOB',
  'TINYTEXT',
  'BLOB',
  'TEXT',
  'MEDIUMBLOB',
  'MEDIUMTEXT',
  'LONGBLOB',
  'LONGTEXT',
]
const needsLength = (type: string) => type === 'ENUM' || type === 'SET' || type.startsWith('VAR')

const emptyRoutine = (): RoutineEditorData => ({
  name: '',
  type: 'PROCEDURE',
  params: [],
  returnType: '',
  returnLength: '',
  returnOptsText: '',
  returnOptsNum: '',
  definition: '',
  isDeterministic: false,
  definer: '',
  securityType: '',
  sqlDataAccess: '',
  comment: '',
})

export function RoutinesPage({ server, db }: { server: number; db: string }) {
  const qc = useQueryClient()
  const [pos, setPos] = useState(0)
  const q = useQuery({
    queryKey: qk.dbPage({ server, db }, 'routines', { pos }),
    queryFn: () => api.dbRoutines({ server, db }, { pos }),
  })
  const [messages, setMessages] = useState<SqlMessage[]>([])
  const [editor, setEditor] = useState<{
    options: RoutineEditorOptions
    routine: RoutineEditorData
    original: { name: string; type: string } | null
  } | null>(null)
  const [execute, setExecute] = useState<RoutineExecuteForm | null>(null)
  const [result, setResult] = useState<RoutineExecuteResponse | null>(null)

  if (q.isError) return <Messages messages={[errorMessage(q.error)]} />
  const d = q.data
  if (d === undefined) return null

  const open = async (item?: { name: string; type: string }) => {
    try {
      const r = await api.dbRoutineEditor({ server, db }, item)
      setEditor({ options: r.options, routine: r.routine ?? emptyRoutine(), original: item ?? null })
    } catch (e) {
      setMessages([errorMessage(e)])
    }
  }
  const openExecute = async (name: string, type: string) => {
    try {
      setResult(null)
      setExecute(await api.dbRoutineExecuteForm({ server, db }, name, type))
    } catch (e) {
      setMessages([errorMessage(e)])
    }
  }

  return (
    <>
      <ProgramListPage
        filterable
        server={server}
        db={db}
        icon="b_routines"
        title={t('Routines')}
        docLink="STORED_ROUTINES"
        headers={[t('Name'), t('Type'), t('Returns')]}
        actionCols={4}
        tableId="routinesTable"
        canCreate={d.canCreate}
        createIcon="b_routine_add"
        createLabel={t('Create new routine')}
        onCreate={() => void open()}
        empty={t('There are no routines to display.')}
        messages={messages}
        setMessages={setMessages}
        before={<ListNavigator pager={d.pager} onPos={setPos} />}
        after={<ListNavigator pager={d.pager} onPos={setPos} />}
        onExport={async (name) => {
          const r = d.items.find((i) => i.name === name)
          if (r === undefined || !r.canExport) return null
          return api.dbRoutineExport({ server, db }, r.name, r.type)
        }}
        items={d.items.map((r) => ({
          name: r.name,
          dropSql: r.dropSql,
          exportable: r.canExport,
          cells: [
            r.type,
            <span key="returns" dir="ltr">
              {r.returns}
            </span>,
          ],
          actions: [
            <RowAction
              key="edit"
              icon="b_edit"
              text={t('Edit')}
              enabled={r.canEdit}
              className="edit_anchor"
              onClick={() => void open({ name: r.name, type: r.type })}
            />,
            <RowAction
              key="execute"
              icon="b_nextpage"
              text={t('Execute')}
              enabled={r.canExecute}
              className="exec_anchor"
              onClick={() => void openExecute(r.name, r.type)}
            />,
          ],
        }))}
      />
      {editor !== null && (
        <RoutineEditor
          server={server}
          options={editor.options}
          initial={editor.routine}
          editMode={editor.original !== null}
          onClose={() => setEditor(null)}
          onSave={async (body) => {
            try {
              const r = await api.dbRoutineSave(
                { server, db },
                {
                  ...body,
                  ...(editor.original !== null
                    ? { originalName: editor.original.name, originalType: editor.original.type }
                    : {}),
                },
              )
              if (r.messages[0]?.type === 'error') return r.messages
              setMessages(r.messages)
              setEditor(null)
              await qc.invalidateQueries({ queryKey: qk.db({ server, db }) })
              return null
            } catch (e) {
              return [errorMessage(e)]
            }
          }}
        />
      )}
      {execute !== null && (
        <ExecuteDialog
          form={execute}
          result={result}
          onClose={() => setExecute(null)}
          onExecute={async (params, funcs) => {
            try {
              setResult(
                await api.dbRoutineExecute(
                  { server, db },
                  {
                    name: execute.name,
                    type: execute.type,
                    params,
                    funcs,
                  },
                ),
              )
            } catch (e) {
              setMessages([errorMessage(e)])
              setExecute(null)
            }
          }}
        />
      )}
    </>
  )
}

function RoutineEditor({
  server,
  options,
  initial,
  editMode,
  onClose,
  onSave,
}: {
  server: number
  options: RoutineEditorOptions
  initial: RoutineEditorData
  editMode: boolean
  onClose: () => void
  onSave: (body: Record<string, unknown>) => Promise<SqlMessage[] | null>
}) {
  const [r, setR] = useState(initial)
  const [adjust, setAdjust] = useState(options.hasAdjustPrivileges)
  const [errors, setErrors] = useState<SqlMessage[]>([])
  const set = (p: Partial<RoutineEditorData>) => setR({ ...r, ...p })
  const setParam = (i: number, p: Partial<Param>) =>
    set({ params: r.params.map((x, j) => (j === i ? { ...x, ...p } : x)) })
  const isFunction = r.type === 'FUNCTION'
  const returnType = r.returnType !== '' ? r.returnType : (options.datatypes[0] ?? '')

  const typeSelect = (value: string, onChange: (v: string) => void, name: string) => (
    <NativeSelect name={name} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.datatypes.map((dt) => (
        <option key={dt} value={dt}>
          {dt}
        </option>
      ))}
    </NativeSelect>
  )
  const charsetSelect = (value: string, onChange: (v: string) => void, name: string) => (
    <NativeSelect lang="en" dir="ltr" name={name} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{t('Charset')}</option>
      <option value="" />
      {options.charsets.map((c) => (
        <option key={c.name} value={c.name} title={c.description}>
          {c.name}
        </option>
      ))}
    </NativeSelect>
  )
  const numSelect = (value: string, onChange: (v: string) => void, name: string) => (
    <NativeSelect name={name} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="" />
      {options.numericOptions.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </NativeSelect>
  )
  /** setOptionsForParameter */
  const opts = (type: string, text: () => React.ReactNode, num: () => React.ReactNode) =>
    NUMERIC.includes(type) ? num() : TEXTUAL.includes(type) ? text() : <span className="no_opts">---</span>

  const save = async () => {
    const missing = () => setErrors([{ type: 'error', text: t('Missing value in the form!') }])
    if (r.name === '' || r.definition === '') return missing()
    if (r.params.some((p) => (r.type === 'PROCEDURE' && p.dir === '') || p.name === '' || p.type === ''))
      return missing()
    if (r.params.some((p) => needsLength(p.type) && p.length === '')) return missing()
    if (isFunction && needsLength(returnType) && r.returnLength === '') return missing()
    if (isFunction && !r.definition.toUpperCase().includes('RETURN')) {
      setErrors([
        { type: 'error', text: t('The definition of a stored function must contain a RETURN statement!') },
      ])
      return
    }
    const res = await onSave({
      name: r.name,
      type: r.type,
      params: r.params.map((p) => ({
        dir: isFunction ? '' : p.dir,
        name: p.name,
        type: p.type,
        length: p.length,
        optsText: p.optsText,
        optsNum: p.optsNum,
      })),
      returnType,
      returnLength: r.returnLength,
      returnOptsText: r.returnOptsText,
      returnOptsNum: r.returnOptsNum,
      definition: r.definition,
      isDeterministic: r.isDeterministic,
      adjustPrivileges: editMode && adjust,
      definer: r.definer,
      securityType: r.securityType,
      sqlDataAccess: r.sqlDataAccess,
      comment: r.comment,
    })
    if (res !== null) setErrors(res)
  }

  return (
    <DbModal
      id="routinesEditorModal"
      title={t('Routine editor')}
      wide
      onClose={onClose}
      footer={<EditorFooter onClose={onClose} onSave={() => void save()} />}
    >
      <Messages messages={errors} />
      <div className="mb-2 font-semibold">
        {t('Details')} {!editMode && <MySqlDocLink link="CREATE_PROCEDURE" />}
      </div>
      <table className="rte_table w-full text-sm">
        <tbody>
          <EditorRow label={t('Routine name')}>
            <Input
              name="item_name"
              maxLength={64}
              value={r.name}
              onChange={(e) => set({ name: e.target.value })}
            />
          </EditorRow>
          <EditorRow label={t('Type')}>
            <NativeSelect
              name="item_type"
              value={r.type}
              onChange={(e) => set({ type: e.target.value === 'FUNCTION' ? 'FUNCTION' : 'PROCEDURE' })}
            >
              <option value="PROCEDURE">PROCEDURE</option>
              <option value="FUNCTION">FUNCTION</option>
            </NativeSelect>
          </EditorRow>
          <EditorRow label={t('Parameters')}>
            <table className="routine_params_table text-sm [&_td]:p-1 [&_th]:p-1">
              <thead>
                <tr className="text-left">
                  {!isFunction && <th className="routine_direction_cell">{t('Direction')}</th>}
                  <th>{t('Name')}</th>
                  <th>{t('Type')}</th>
                  <th>{t('Length/Values')}</th>
                  <th colSpan={2}>{t('Options')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {r.params.map((p, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: parameters are positional (item_param_*[i])
                  <tr key={i}>
                    {!isFunction && (
                      <td>
                        <NativeSelect
                          name={`item_param_dir[${i}]`}
                          value={p.dir}
                          onChange={(e) => setParam(i, { dir: e.target.value })}
                        >
                          {['IN', 'OUT', 'INOUT'].map((dir) => (
                            <option key={dir} value={dir}>
                              {dir}
                            </option>
                          ))}
                        </NativeSelect>
                      </td>
                    )}
                    <td>
                      <Input
                        name={`item_param_name[${i}]`}
                        value={p.name}
                        onChange={(e) => setParam(i, { name: e.target.value })}
                      />
                    </td>
                    <td>{typeSelect(p.type, (v) => setParam(i, { type: v }), `item_param_type[${i}]`)}</td>
                    <td>
                      {NO_LENGTH.includes(p.type) ? (
                        <span className="no_len">---</span>
                      ) : (
                        <Input
                          name={`item_param_length[${i}]`}
                          value={p.length}
                          onChange={(e) => setParam(i, { length: e.target.value })}
                        />
                      )}
                    </td>
                    <td colSpan={2}>
                      {opts(
                        p.type,
                        () =>
                          charsetSelect(
                            p.optsText,
                            (v) => setParam(i, { optsText: v }),
                            `item_param_opts_text[${i}]`,
                          ),
                        () =>
                          numSelect(
                            p.optsNum,
                            (v) => setParam(i, { optsNum: v }),
                            `item_param_opts_num[${i}]`,
                          ),
                      )}
                    </td>
                    <td>
                      <Button
                        variant="link"
                        className="routine_param_remove_anchor"
                        onClick={() => set({ params: r.params.filter((_, j) => j !== i) })}
                      >
                        {t('Drop')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </EditorRow>
          <EditorRow label="">
            <Button
              variant="primary"
              id="addRoutineParameterButton"
              onClick={() =>
                set({
                  params: [
                    ...r.params,
                    {
                      dir: 'IN',
                      name: '',
                      type: options.datatypes[0] ?? 'INT',
                      length: '',
                      lengthArray: [],
                      optsText: '',
                      optsNum: '',
                    },
                  ],
                })
              }
            >
              {t('Add parameter')}
            </Button>
          </EditorRow>
          <EditorRow label={t('Return type')} hidden={!isFunction}>
            {typeSelect(returnType, (v) => set({ returnType: v }), 'item_returntype')}
          </EditorRow>
          <EditorRow label={t('Return length/values')} hidden={!isFunction}>
            {NO_LENGTH.includes(returnType) ? (
              <span className="no_len">---</span>
            ) : (
              <Input
                name="item_returnlength"
                value={r.returnLength}
                onChange={(e) => set({ returnLength: e.target.value })}
              />
            )}
          </EditorRow>
          <EditorRow label={t('Return options')} hidden={!isFunction}>
            {opts(
              returnType,
              () =>
                charsetSelect(r.returnOptsText, (v) => set({ returnOptsText: v }), 'item_returnopts_text'),
              () => numSelect(r.returnOptsNum, (v) => set({ returnOptsNum: v }), 'item_returnopts_num'),
            )}
          </EditorRow>
          <EditorRow label={t('Definition')}>
            <Textarea
              name="item_definition"
              rows={15}
              className="font-mono"
              value={r.definition}
              onChange={(e) => set({ definition: e.target.value })}
            />
            <Button
              id="format"
              className="mt-1"
              onClick={() =>
                void api.sqlFormat(server, r.definition, false).then((f) => set({ definition: f.sql }))
              }
            >
              {t('Format')}
            </Button>
          </EditorRow>
          <EditorRow label={t('Is deterministic')}>
            <Checkbox
              name="item_isdeterministic"
              checked={r.isDeterministic}
              onCheckedChange={(v) => set({ isDeterministic: v === true })}
            />
          </EditorRow>
          {editMode && (
            <EditorRow
              label={
                <>
                  {t('Adjust privileges')} <DocLink page="faq" anchor="faq6-39" />
                </>
              }
            >
              <Checkbox
                name="item_adjust_privileges"
                checked={adjust}
                disabled={!options.hasAdjustPrivileges}
                title={
                  options.hasAdjustPrivileges
                    ? undefined
                    : t(
                        'You do not have sufficient privileges to perform this operation; Please refer to the documentation for more details.',
                      )
                }
                onCheckedChange={(v) => setAdjust(v === true)}
              />
            </EditorRow>
          )}
          <EditorRow label={t('Definer')}>
            <Input name="item_definer" value={r.definer} onChange={(e) => set({ definer: e.target.value })} />
          </EditorRow>
          <EditorRow label={t('Security type')}>
            <NativeSelect
              name="item_securitytype"
              value={r.securityType === '' ? 'DEFINER' : r.securityType}
              onChange={(e) => set({ securityType: e.target.value === 'INVOKER' ? 'INVOKER' : 'DEFINER' })}
            >
              <option value="DEFINER">DEFINER</option>
              <option value="INVOKER">INVOKER</option>
            </NativeSelect>
          </EditorRow>
          <EditorRow label={t('SQL data access')}>
            <NativeSelect
              name="item_sqldataaccess"
              value={r.sqlDataAccess}
              onChange={(e) => set({ sqlDataAccess: e.target.value })}
            >
              {['CONTAINS SQL', 'NO SQL', 'READS SQL DATA', 'MODIFIES SQL DATA'].map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </NativeSelect>
          </EditorRow>
          <EditorRow label={t('Comment')}>
            <Input
              name="item_comment"
              maxLength={64}
              value={r.comment}
              onChange={(e) => set({ comment: e.target.value })}
            />
          </EditorRow>
        </tbody>
      </table>
    </DbModal>
  )
}

function ExecuteDialog({
  form,
  result,
  onClose,
  onExecute,
}: {
  form: RoutineExecuteForm
  result: RoutineExecuteResponse | null
  onClose: () => void
  onExecute: (params: Record<string, string | string[]>, funcs: Record<string, string>) => Promise<void>
}) {
  const [values, setValues] = useState<Record<string, string | string[]>>({})
  const [funcs, setFuncs] = useState<Record<string, string>>(() =>
    Object.fromEntries(form.params.map((p) => [p.name, p.functions?.find((f) => f.selected)?.value ?? ''])),
  )
  const title = `${t('Execute routine')} \`${form.name}\``
  return (
    <DbModal
      id="routinesExecuteModal"
      title={title}
      wide
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Close')}</Button>
          {result === null && (
            <Button
              variant="primary"
              id="routinesExecuteModalExecuteButton"
              onClick={() =>
                void onExecute(
                  Object.fromEntries(form.params.map((p) => [p.name, values[p.name] ?? ''])),
                  funcs,
                )
              }
            >
              {t('Execute')}
            </Button>
          )}
        </>
      }
    >
      {result !== null ? (
        <>
          <Messages messages={result.messages} />
          {result.queries.length > 0 && <HighlightedSql sql={result.queries.join('\n')} className="mb-2" />}
          {result.title !== '' && (
            <Panel title={result.title} className="mb-2">
              <PanelBody>
                {result.resultSets.map((rs, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: result sets are positional
                  <table key={i} className="mb-2 w-auto text-sm [&_td]:px-2 [&_th]:px-2">
                    <thead>
                      <tr>
                        {rs.fields.map((f) => (
                          <th key={f}>{f}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rs.rows.map((row, j) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
                        <tr key={j} className="odd:bg-grid-odd even:bg-grid-even">
                          {row.map((v, k) => (
                            // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional
                            <td key={k}>{v === null ? <i>NULL</i> : v}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ))}
              </PanelBody>
            </Panel>
          )}
          {result.empty && (
            <Messages
              messages={[{ type: 'notice', text: t('MySQL returned an empty result set (i.e. zero rows).') }]}
            />
          )}
        </>
      ) : (
        <Panel title={t('Routine parameters')}>
          <PanelBody>
            {form.params.length === 0 ? (
              <p>{t('This routine does not require any parameters.')}</p>
            ) : (
              <table className="rte_table w-auto text-sm [&_td]:px-2 [&_td]:py-1 [&_th]:px-2">
                <thead>
                  <tr className="text-left">
                    <th>{t('Name')}</th>
                    <th>{t('Type')}</th>
                    {form.showFunctionFields && <th>{t('Function')}</th>}
                    <th>{t('Value')}</th>
                  </tr>
                </thead>
                <tbody>
                  {form.params.map((p) => (
                    <tr key={p.name}>
                      <td>{p.name}</td>
                      <td>{p.type}</td>
                      {form.showFunctionFields && (
                        <td>
                          {p.functions === null ? (
                            '--'
                          ) : (
                            <NativeSelect
                              name={`funcs[${p.name}]`}
                              value={funcs[p.name] ?? ''}
                              onChange={(e) => setFuncs({ ...funcs, [p.name]: e.target.value })}
                            >
                              {p.functions.map((f) => (
                                <option key={f.value} value={f.value}>
                                  {f.value}
                                </option>
                              ))}
                            </NativeSelect>
                          )}
                        </td>
                      )}
                      <td className="whitespace-nowrap">
                        {p.inputType === 'text' ? (
                          <Input
                            className={p.dateClass}
                            name={`params[${p.name}]`}
                            value={String(values[p.name] ?? '')}
                            onChange={(e) => setValues({ ...values, [p.name]: e.target.value })}
                          />
                        ) : (
                          p.values.map((v) => (
                            <label key={v} className="block">
                              <input
                                type={p.inputType}
                                name={`params[${p.name}][]`}
                                value={v}
                                checked={
                                  p.inputType === 'radio'
                                    ? values[p.name] === v
                                    : (values[p.name] as string[] | undefined)?.includes(v) === true
                                }
                                onChange={(e) => {
                                  if (p.inputType === 'radio') setValues({ ...values, [p.name]: v })
                                  else {
                                    const cur = (values[p.name] as string[] | undefined) ?? []
                                    setValues({
                                      ...values,
                                      [p.name]: e.target.checked ? [...cur, v] : cur.filter((x) => x !== v),
                                    })
                                  }
                                }}
                              />{' '}
                              {v}
                            </label>
                          ))
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </PanelBody>
        </Panel>
      )}
    </DbModal>
  )
}
