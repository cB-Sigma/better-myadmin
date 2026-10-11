import type {
  MaintenanceResult,
  OperationsPageResponse,
  OperationsResponse,
  SqlActionRequest,
  SqlMessage,
} from '@bettermyadmin/contracts'
import {
  Alert,
  Button,
  DocLink,
  Input,
  Label,
  MySqlDocLink,
  NativeCheckbox,
  NativeSelect,
  Panel,
  PanelBody,
  PanelItem,
  PanelList,
  Radio,
  Textarea,
  showMessage,
  useConfirm,
} from '@bettermyadmin/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { type FormEvent, type ReactNode, useRef, useState } from 'react'
import { type TableRef, api } from '../../../lib/api'
import { t } from '../../../lib/i18n'
import { qk } from '../../../lib/queryKeys'
import { ResultMessages, errorMessage } from '../common/ResultMessages'

/**
 * The Operations tab of a table (and of a view).
 *
 * pma: resources/templates/table/operations/index.twig, view.twig, resources/js/table/operations.ts,
 *      templates/table/maintenance/*.twig
 */
export function OperationsPage({ scope }: { scope: TableRef }) {
  const q = useQuery({
    queryKey: qk.tblPage(scope.server, scope.db, scope.table, 'operations'),
    queryFn: () => api.tableOperations(scope),
  })
  const [messages, setMessages] = useState<SqlMessage[]>([])
  const [maint, setMaint] = useState<MaintenanceResult | null>(null)
  if (q.isError) return <ResultMessages messages={[errorMessage(q.error)]} />
  if (q.data === undefined) return null
  const page = q.data
  const common = { scope, page, setMessages, setMaint }
  return (
    <div className="mx-auto my-3 max-w-5xl space-y-2" data-testid="operations-page">
      <ResultMessages messages={messages} />
      {maint !== null && <MaintenanceResults result={maint} />}
      {page.isView ? <ViewOperations {...common} /> : <TableOperations {...common} />}
    </div>
  )
}

interface Common {
  scope: TableRef
  page: OperationsPageResponse
  setMessages: (m: SqlMessage[]) => void
  setMaint: (m: MaintenanceResult | null) => void
}

const enc = encodeURIComponent
const tablePath = (s: TableRef, db = s.db, table = s.table, rest = 'operations') =>
  `/s/${s.server}/db/${enc(db)}/t/${enc(table)}/${rest}`

/** The shared action runner: messages, refresh, navigation reload. */
function useRunner({ scope, setMessages, setMaint }: Common) {
  const qc = useQueryClient()
  return async (
    fn: () => Promise<OperationsResponse>,
    after?: (r: OperationsResponse) => Promise<void> | void,
  ): Promise<OperationsResponse | null> => {
    try {
      const r = await fn()
      setMessages(r.messages)
      setMaint(r.maintenance ?? null)
      await qc.invalidateQueries({ queryKey: qk.tbl(scope.server, scope.db, scope.table) })
      await qc.invalidateQueries({ queryKey: qk.nav(scope.server) })
      await after?.(r)
      return r
    } catch (e) {
      setMessages([errorMessage(e)])
      setMaint(null)
      return null
    }
  }
}

const Go = () => (
  <Button type="submit" variant="primary">
    {t('Go')}
  </Button>
)

const NO_PRIVS =
  "You don't have sufficient privileges to perform this operation; Please refer to the documentation for more details."

function AdjustPrivileges({
  id,
  page,
  checked,
  onChange,
}: { id: string; page: OperationsPageResponse; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div>
      <NativeCheckbox
        id={id}
        name="adjust_privileges"
        value="1"
        checked={page.hasPrivileges && checked}
        disabled={!page.hasPrivileges}
        {...(page.hasPrivileges ? {} : { title: t(NO_PRIVS) })}
        onChange={(e) => onChange(e.target.checked)}
      />{' '}
      <Label htmlFor={id}>
        {t('Adjust privileges')} <DocLink page="faq" anchor="faq6-39" />
      </Label>
    </div>
  )
}

function TargetDb({
  page,
  value,
  onChange,
  id,
}: { page: OperationsPageResponse; value: string; onChange: (v: string) => void; id?: string }) {
  return page.databaseList !== null ? (
    <NativeSelect
      name="target_db"
      aria-label={t('Database')}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      {...(id !== undefined ? { id } : {})}
    >
      {page.databaseList.map((d) => (
        <option key={d} value={d}>
          {d}
        </option>
      ))}
    </NativeSelect>
  ) : (
    <Input
      className="w-48"
      name="target_db"
      maxLength={100}
      aria-label={t('Database')}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      {...(id !== undefined ? { id } : {})}
    />
  )
}

function TableOperations(props: Common) {
  const { scope, page } = props
  return (
    <>
      <h2 className="text-lg">{t('Table operations')}</h2>
      {!page.hideOrderTable && <OrderByCard {...props} />}
      <MoveCard {...props} />
      <OptionsCard key={`${page.table}-${page.storageEngine}-${page.collation}-${page.comment}`} {...props} />
      <CopyCard {...props} />
      <MaintenanceCard {...props} />
      {!page.isSystemSchema && <DeleteCard {...props} />}
      {page.partitions.length > 0 && <PartitionsCard {...props} />}
      {page.foreigners.length > 0 && (
        <Panel title={t('Check referential integrity')}>
          <PanelList>
            {page.foreigners.map((f) => (
              <PanelItem key={f.master}>
                <Link
                  to={tablePath(scope, scope.db, scope.table, 'sql')}
                  search={{ sql: f.sql, sig: f.sig } as never}
                >
                  {f.master}&nbsp;-&gt;&nbsp;{f.db}.{f.table}.{f.field}
                </Link>
              </PanelItem>
            ))}
          </PanelList>
        </Panel>
      )}
    </>
  )
}

/** pma: #alterTableOrderby */
function OrderByCard(props: Common) {
  const run = useRunner(props)
  const { page, scope } = props
  const [field, setField] = useState(page.columns[0] ?? '')
  const [order, setOrder] = useState<'asc' | 'desc'>('asc')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void run(() => api.tableOperation(scope, 'order-by', { field, order }))
  }
  return (
    <form id="alterTableOrderby" onSubmit={submit}>
      <Panel title={t('Alter table order by')} footer={<Go />}>
        <PanelBody className="flex flex-wrap items-start gap-4">
          <div>
            <NativeSelect
              id="tableOrderFieldSelect"
              name="order_field"
              aria-label={t('Column')}
              value={field}
              onChange={(e) => setField(e.target.value)}
            >
              {page.columns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
            <div className="text-xs text-fg-muted">{t('(singly)')}</div>
          </div>
          <div>
            {(['asc', 'desc'] as const).map((o) => (
              <div key={o}>
                <Radio
                  id={o === 'asc' ? 'tableOrderAscRadio' : 'tableOrderDescRadio'}
                  name="order_order"
                  value={o}
                  checked={order === o}
                  onChange={() => setOrder(o)}
                />{' '}
                <Label htmlFor={o === 'asc' ? 'tableOrderAscRadio' : 'tableOrderDescRadio'}>
                  {t(o === 'asc' ? 'Ascending' : 'Descending')}
                </Label>
              </div>
            ))}
          </div>
        </PanelBody>
      </Panel>
    </form>
  )
}

/** pma: #moveTableForm */
function MoveCard(props: Common) {
  const run = useRunner(props)
  const navigate = useNavigate()
  const { page, scope } = props
  const [targetDb, setTargetDb] = useState(page.db)
  const [name, setName] = useState(page.table)
  const [ai, setAi] = useState(false)
  const [privs, setPrivs] = useState(true)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (name === '') return
    void run(
      () =>
        api.tableOperation(scope, 'move-copy', {
          op: 'move',
          targetDb,
          newName: name,
          autoIncrement: ai,
          adjustPrivileges: page.hasPrivileges && privs,
        }),
      async (r) => {
        if (r.messages[0]?.type !== 'success') return
        showMessage(r.messages[0].text, null, 'success')
        await navigate({ to: tablePath(scope, r.db ?? targetDb, r.table ?? name, 'sql') })
      },
    )
  }
  return (
    <form id="moveTableForm" onSubmit={submit}>
      <Panel title={t('Move table to (database.table)')} footer={<Go />}>
        <PanelBody className="space-y-2">
          <div className="flex items-center gap-1">
            <TargetDb page={page} value={targetDb} onChange={setTargetDb} id="moveTableDatabaseInput" />
            <span>.</span>
            <Input
              className="w-48"
              name="new_name"
              required
              maxLength={64}
              aria-label={t('Table')}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <NativeCheckbox
              id="checkbox_auto_increment_mv"
              name="sql_auto_increment"
              value="1"
              checked={ai}
              onChange={(e) => setAi(e.target.checked)}
            />{' '}
            <Label htmlFor="checkbox_auto_increment_mv">{t('Add AUTO_INCREMENT value')}</Label>
          </div>
          <AdjustPrivileges
            id="checkbox_privileges_tables_move"
            page={page}
            checked={privs}
            onChange={setPrivs}
          />
        </PanelBody>
      </Panel>
    </form>
  )
}

/** pma: #tableOptionsForm */
function OptionsCard(props: Common) {
  const run = useRunner(props)
  const confirm = useConfirm()
  const navigate = useNavigate()
  const { page, scope } = props
  const engineName =
    page.storageEngines.find((e) => e.name.toLowerCase() === page.storageEngine.toLowerCase())?.name ??
    (page.storageEngine === '' ? page.storageEngines.find((e) => e.isDefault)?.name : undefined) ??
    page.storageEngines[0]?.name ??
    ''
  const [f, setF] = useState({
    newName: page.table,
    adjustPrivileges: true,
    comment: page.comment,
    engine: engineName,
    collation: page.collation,
    changeAllCollations: false,
    packKeys: page.packKeys,
    checksum: page.checksum === '1',
    delayKeyWrite: page.delayKeyWrite === '1',
    transactional: page.transactional === '1',
    pageChecksum: page.pageChecksum === '1',
    autoIncrement: page.autoIncrement,
    rowFormat:
      page.rowFormats.find((r) => r === page.rowFormatCurrent.toUpperCase()) ?? page.rowFormats[0] ?? '',
  })
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF({ ...f, [k]: v })
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (f.collation !== page.collation && f.changeAllCollations) {
      const ok = await confirm({
        question: (
          <span>
            {t(
              'Through this operation, MySQL attempts to map the data values between collations. If the character sets are incompatible, there may be data loss and this lost data may <b>NOT</b> be recoverable simply by changing back the column collation(s). <b>To convert existing data, it is suggested to use the column(s) editing feature (the "Change" Link) on the table structure page. </b>',
            ).replace(/<\/?b>/g, '')}
          </span>
        ),
      })
      if (!ok) return
    }
    await run(
      () =>
        api.tableOperation(scope, 'options', {
          newName: f.newName,
          adjustPrivileges: page.hasPrivileges && f.adjustPrivileges,
          comment: f.comment,
          prevComment: page.comment,
          engine: f.engine,
          collation: f.collation,
          changeAllCollations: f.changeAllCollations,
          ...(page.hasPackKeys ? { packKeys: f.packKeys } : {}),
          ...(page.hasChecksumAndDelayKeyWrite
            ? { checksum: f.checksum, delayKeyWrite: f.delayKeyWrite }
            : {}),
          ...(page.hasTransactionalAndPageChecksum
            ? { transactional: f.transactional, pageChecksum: f.pageChecksum }
            : {}),
          ...(page.hasAutoIncrement
            ? { autoIncrement: f.autoIncrement, hiddenAutoIncrement: page.autoIncrement }
            : {}),
          ...(page.rowFormats.length > 0 ? { rowFormat: f.rowFormat } : {}),
        }),
      async (r) => {
        if (r.table !== undefined && r.table !== scope.table)
          await navigate({ to: tablePath(scope, scope.db, r.table) })
      },
    )
  }
  const row = (label: ReactNode, control: ReactNode) => (
    <div className="grid grid-cols-[12rem_1fr] items-center gap-2">
      {label}
      <div>{control}</div>
    </div>
  )
  const check = (
    id: string,
    label: string,
    key: 'checksum' | 'delayKeyWrite' | 'transactional' | 'pageChecksum',
  ) => (
    <div>
      <NativeCheckbox
        id={id}
        name={id}
        value="1"
        checked={f[key]}
        onChange={(e) => set(key, e.target.checked)}
      />{' '}
      <Label htmlFor={id}>{label}</Label>
    </div>
  )
  return (
    <form id="tableOptionsForm" onSubmit={(e) => void submit(e)}>
      <Panel title={t('Table options')} footer={<Go />}>
        <PanelBody className="space-y-3">
          {row(
            <Label htmlFor="renameTableInput">{t('Rename table to')}</Label>,
            <Input
              id="renameTableInput"
              className="w-64"
              name="new_name"
              maxLength={64}
              required
              value={f.newName}
              onChange={(e) => set('newName', e.target.value)}
            />,
          )}
          <AdjustPrivileges
            id="checkbox_privileges_table_options"
            page={page}
            checked={f.adjustPrivileges}
            onChange={(v) => set('adjustPrivileges', v)}
          />
          {row(
            <Label htmlFor="tableCommentsInput">{t('Table comments')}</Label>,
            <Textarea
              id="tableCommentsInput"
              className="w-64"
              name="comment"
              maxLength={2048}
              rows={1}
              cols={30}
              value={f.comment}
              onChange={(e) => set('comment', e.target.value)}
            />,
          )}
          {row(
            <Label htmlFor="newTableStorageEngineSelect">
              {t('Storage engine')} <MySqlDocLink link="Storage_engines" />
            </Label>,
            <NativeSelect
              id="newTableStorageEngineSelect"
              name="new_tbl_storage_engine"
              value={f.engine}
              onChange={(e) => set('engine', e.target.value)}
            >
              {page.storageEngines.map((e) => (
                <option key={e.name} value={e.name} title={e.comment}>
                  {e.name}
                </option>
              ))}
            </NativeSelect>,
          )}
          {row(
            <Label htmlFor="collationSelect">{t('Collation')}</Label>,
            <NativeSelect
              id="collationSelect"
              name="tbl_collation"
              lang="en"
              dir="ltr"
              value={f.collation}
              onChange={(e) => set('collation', e.target.value)}
            >
              <option value="" />
              {page.charsets.map((cs) => (
                <optgroup key={cs.name} label={cs.name} title={cs.description}>
                  {cs.collations.map((c) => (
                    <option key={c.name} value={c.name} title={c.description}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </NativeSelect>,
          )}
          <div className="ms-3">
            <NativeCheckbox
              id="checkbox_change_all_collations"
              name="change_all_collations"
              value="1"
              checked={f.changeAllCollations}
              onChange={(e) => set('changeAllCollations', e.target.checked)}
            />{' '}
            <Label htmlFor="checkbox_change_all_collations">{t('Change all column collations')}</Label>
          </div>
          {page.hasPackKeys &&
            row(
              <Label htmlFor="new_pack_keys">PACK_KEYS</Label>,
              <NativeSelect
                id="new_pack_keys"
                name="new_pack_keys"
                value={f.packKeys}
                onChange={(e) => set('packKeys', e.target.value)}
              >
                {['DEFAULT', '0', '1'].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </NativeSelect>,
            )}
          {page.hasChecksumAndDelayKeyWrite && (
            <>
              {check('new_checksum', 'CHECKSUM', 'checksum')}
              {check('new_delay_key_write', 'DELAY_KEY_WRITE', 'delayKeyWrite')}
            </>
          )}
          {page.hasTransactionalAndPageChecksum && (
            <>
              {check('new_transactional', 'TRANSACTIONAL', 'transactional')}
              {check('new_page_checksum', 'PAGE_CHECKSUM', 'pageChecksum')}
            </>
          )}
          {page.hasAutoIncrement &&
            row(
              <Label htmlFor="auto_increment_opt">AUTO_INCREMENT</Label>,
              <Input
                id="auto_increment_opt"
                className="w-40"
                type="number"
                name="new_auto_increment"
                value={f.autoIncrement}
                onChange={(e) => set('autoIncrement', e.target.value)}
              />,
            )}
          {page.rowFormats.length > 0 &&
            row(
              <Label htmlFor="new_row_format">ROW_FORMAT</Label>,
              <NativeSelect
                id="new_row_format"
                name="new_row_format"
                value={f.rowFormat}
                onChange={(e) => set('rowFormat', e.target.value)}
              >
                {page.rowFormats.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </NativeSelect>,
            )}
        </PanelBody>
      </Panel>
    </form>
  )
}

/** pma: #copyTable */
function CopyCard(props: Common) {
  const run = useRunner(props)
  const navigate = useNavigate()
  const { page, scope } = props
  const [targetDb, setTargetDb] = useState(page.db)
  const [name, setName] = useState(page.table)
  const [what, setWhat] = useState<'structure' | 'data' | 'dataonly'>('data')
  const [o, setO] = useState({
    drop: false,
    ai: false,
    constraints: true,
    privs: true,
    switchTo: page.switchToNew,
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (name === '') return
    void run(
      () =>
        api.tableOperation(scope, 'move-copy', {
          op: 'copy',
          targetDb,
          newName: name,
          what,
          dropIfExists: o.drop,
          autoIncrement: o.ai,
          addConstraints: page.hasForeignKeys && o.constraints,
          adjustPrivileges: page.hasPrivileges && o.privs,
          switchToNew: o.switchTo,
        }),
      async (r) => {
        if (r.messages[0]?.type !== 'success') return
        showMessage(r.messages[0].text, null, 'success')
        if (o.switchTo) await navigate({ to: tablePath(scope, targetDb, name, 'structure') })
      },
    )
  }
  const box = (id: string, nameAttr: string, value: string, label: string, k: keyof typeof o) => (
    <div>
      <NativeCheckbox
        id={id}
        name={nameAttr}
        value={value}
        checked={o[k]}
        onChange={(e) => setO({ ...o, [k]: e.target.checked })}
      />{' '}
      <Label htmlFor={id}>{label}</Label>
    </div>
  )
  return (
    <form id="copyTable" onSubmit={submit}>
      <Panel title={t('Copy table to (database.table)')} footer={<Go />}>
        <PanelBody className="space-y-3">
          <div className="flex items-center gap-1">
            <TargetDb page={page} value={targetDb} onChange={setTargetDb} />
            <span>.</span>
            <Input
              className="w-48"
              name="new_name"
              required
              maxLength={64}
              aria-label={t('Table')}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            {(
              [
                ['whatRadio1', 'structure', 'Structure only'],
                ['whatRadio2', 'data', 'Structure and data'],
                ['whatRadio3', 'dataonly', 'Data only'],
              ] as const
            ).map(([id, v, label]) => (
              <div key={v}>
                <Radio id={id} name="what" value={v} checked={what === v} onChange={() => setWhat(v)} />{' '}
                <Label htmlFor={id}>{t(label)}</Label>
              </div>
            ))}
          </div>
          <div>
            {box('checkbox_drop', 'drop_if_exists', 'true', t('Add %s', 'DROP TABLE'), 'drop')}
            {box(
              'checkbox_auto_increment_cp',
              'sql_auto_increment',
              '1',
              t('Add AUTO_INCREMENT value'),
              'ai',
            )}
            {page.hasForeignKeys &&
              box('checkbox_constraints', 'add_constraints', '1', t('Add constraints'), 'constraints')}
            <AdjustPrivileges
              id="checkbox_adjust_privileges"
              page={page}
              checked={o.privs}
              onChange={(v) => setO({ ...o, privs: v })}
            />
            {box('checkbox_switch', 'switch_to_new', 'true', t('Switch to copied table'), 'switchTo')}
          </div>
        </PanelBody>
      </Panel>
    </form>
  )
}

/** pma: #tbl_maintenance */
function MaintenanceCard(props: Common) {
  const run = useRunner(props)
  const { page, scope } = props
  const e = page.storageEngine
  const four = ['MYISAM', 'ARIA', 'INNODB', 'TOKUDB'].includes(e)
  const item = (label: string, doc: string, action: () => void) => (
    <PanelItem key={label}>
      <Button variant="link" onClick={action}>
        {t(label)}
      </Button>{' '}
      <MySqlDocLink link={doc} />
    </PanelItem>
  )
  const maint = (op: 'analyze' | 'check' | 'checksum' | 'optimize' | 'repair') => () =>
    void run(() => api.tableOperation(scope, 'maintenance', { op }))
  const sql = (action: SqlActionRequest['action']) => () =>
    void run(() => api.tableOperation(scope, 'sql', { action }))
  return (
    <Panel title={t('Table maintenance')}>
      <PanelList id="tbl_maintenance">
        {four && item('Analyze table', 'ANALYZE_TABLE', maint('analyze'))}
        {four && item('Check table', 'CHECK_TABLE', maint('check'))}
        {item('Checksum table', 'CHECKSUM_TABLE', maint('checksum'))}
        {e === 'INNODB' && item('Defragment table', 'InnoDB_File_Defragmenting', sql('defragment'))}
        {item('Flush the table (FLUSH)', 'FLUSH', sql('flush'))}
        {four && item('Optimize table', 'OPTIMIZE_TABLE', maint('optimize'))}
        {['MYISAM', 'ARIA'].includes(e) && item('Repair table', 'REPAIR_TABLE', maint('repair'))}
      </PanelList>
    </Panel>
  )
}

/** The question of the TRUNCATE / DELETE / DROP confirmations with the foreign key checks box. */
function useDangerConfirm(server: number) {
  const confirm = useConfirm()
  const fk = useQuery({
    queryKey: qk.defaultFkCheck(server),
    queryFn: () => api.defaultFkCheck(server),
  })
  const box = useRef(true)
  return async (warning: string, sql: string, withFk: boolean): Promise<boolean | null> => {
    box.current = fk.data?.defaultFkCheckValue ?? true
    const ok = await confirm({
      destructive: true,
      question: (
        <div>
          {t(warning)} {t('Do you really want to execute "%s"?', sql)}
          {withFk && (
            <div className="mt-2">
              <input type="hidden" name="fk_checks" value="0" />
              <NativeCheckbox
                id="fk_checks"
                name="fk_checks"
                value="1"
                defaultChecked={box.current}
                onChange={(e) => {
                  box.current = e.target.checked
                }}
              />{' '}
              <Label htmlFor="fk_checks">{t('Enable foreign key checks')}</Label>
            </div>
          )}
        </div>
      ),
    })
    return ok ? box.current : null
  }
}

const bq = (s: string) => `\`${s.replaceAll('`', '``')}\``

/** pma: "Delete data or table" card */
function DeleteCard(props: Common) {
  const run = useRunner(props)
  const navigate = useNavigate()
  const { page, scope } = props
  const ask = useDangerConfirm(scope.server)
  const full = `${bq(scope.db)}.${bq(scope.table)}`
  const act = async (action: 'truncate' | 'delete' | 'drop', warning: string, sql: string) => {
    const fk = await ask(warning, sql, true)
    if (fk === null) return
    await run(
      () => api.tableOperation(scope, 'sql', { action, fkChecks: fk }),
      async (r) => {
        if (r.dropped === true && r.messages[0]?.type === 'success') {
          showMessage(r.messages[0].text, null, 'success')
          await navigate({ to: `/s/${scope.server}/db/${enc(scope.db)}` })
        }
      },
    )
  }
  const link = (id: string, label: string, onClick: () => void, doc: string) => (
    <PanelItem>
      <Button variant="link" id={id} className="text-error" onClick={onClick}>
        {t(label)}
      </Button>{' '}
      <MySqlDocLink link={doc} />
    </PanelItem>
  )
  return (
    <Panel title={t('Delete data or table')}>
      <PanelList>
        {!page.isView &&
          link(
            'truncate_tbl_anchor',
            'Empty the table (TRUNCATE)',
            () =>
              void act('truncate', 'You are about to TRUNCATE a complete table!', `TRUNCATE TABLE ${full}`),
            'TRUNCATE_TABLE',
          )}
        {!page.isView &&
          link(
            'delete_tbl_anchor',
            'Empty the table (DELETE FROM)',
            () =>
              void act('delete', 'You are about to DELETE all the rows of the table!', `DELETE FROM ${full}`),
            'DELETE',
          )}
        {link(
          'drop_tbl_anchor',
          'Delete the table (DROP)',
          () => void act('drop', 'You are about to DESTROY a complete table!', `DROP TABLE ${full}`),
          'DROP_TABLE',
        )}
      </PanelList>
    </Panel>
  )
}

/** pma: #partitionsForm */
function PartitionsCard(props: Common) {
  const run = useRunner(props)
  const confirm = useConfirm()
  const { page, scope } = props
  const [selected, setSelected] = useState<string[]>(page.partitions.slice(0, 1))
  const [op, setOp] = useState('ANALYZE')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (
      op === 'DROP' &&
      !(await confirm({
        question: t(
          'Do you really want to DROP the selected partition(s)? This will also DELETE the data related to the selected partition(s)!',
        ),
      }))
    )
      return
    if (
      op === 'TRUNCATE' &&
      !(await confirm({ question: t('Do you really want to TRUNCATE the selected partition(s)?') }))
    )
      return
    await run(() =>
      api.tableOperation(scope, 'partitions', { operation: op as 'ANALYZE', partitions: selected }),
    )
  }
  const remove = `ALTER TABLE ${bq(scope.table)} REMOVE PARTITIONING;`
  return (
    <form id="partitionsForm" onSubmit={(e) => void submit(e)}>
      <Panel
        title={
          <>
            {t('Partition maintenance')} <MySqlDocLink link="partitioning_maintenance" />
          </>
        }
        footer={<Go />}
      >
        <PanelBody className="space-y-3">
          <div>
            <Label htmlFor="partition_name">{t('Partition')}</Label>
            <NativeSelect
              id="partition_name"
              name="partition_name[]"
              multiple
              required
              className="h-auto w-full"
              value={selected}
              onChange={(e) => setSelected([...e.target.selectedOptions].map((o) => o.value))}
            >
              {page.partitions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-wrap gap-3">
            {page.partitionChoices.map((c) => {
              const id = `partitionOperationRadio${c.value.charAt(0)}${c.value.slice(1).toLowerCase()}`
              return (
                <div key={c.value}>
                  <Radio
                    id={id}
                    name="partition_operation"
                    value={c.value}
                    checked={op === c.value}
                    onChange={() => setOp(c.value)}
                  />{' '}
                  <Label htmlFor={id}>{c.label}</Label>
                </div>
              )
            })}
          </div>
          <div className="text-xs">
            <Link to={tablePath(scope, scope.db, scope.table, 'sql')} search={{ sql: remove } as never}>
              {t('Remove partitioning')}
            </Link>
          </div>
        </PanelBody>
      </Panel>
    </form>
  )
}

/** pma: table/operations/view.twig */
function ViewOperations(props: Common) {
  const run = useRunner(props)
  const navigate = useNavigate()
  const { page, scope } = props
  const ask = useDangerConfirm(scope.server)
  const [name, setName] = useState(page.table)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void run(
      () => api.tableOperation(scope, 'rename-view', { newName: name }),
      async (r) => {
        if (r.table !== undefined && r.table !== scope.table)
          await navigate({ to: tablePath(scope, scope.db, r.table) })
      },
    )
  }
  const drop = async () => {
    // the view confirmation has no foreign key checkbox: fk_checks=0
    if (
      (await ask('You are about to DESTROY a complete table!', `DROP VIEW ${bq(scope.table)}`, false)) ===
      null
    )
      return
    await run(
      () => api.tableOperation(scope, 'sql', { action: 'dropView', fkChecks: false }),
      async (r) => {
        if (r.messages[0]?.type !== 'success') return
        showMessage(r.messages[0].text, null, 'success')
        await navigate({ to: `/s/${scope.server}/db/${enc(scope.db)}` })
      },
    )
  }
  return (
    <>
      <form onSubmit={submit}>
        <Panel title={t('Operations')} footer={<Go />}>
          <PanelBody className="flex items-center gap-2">
            <Label htmlFor="newNameInput">{t('Rename view to')}</Label>
            <Input
              id="newNameInput"
              className="w-64"
              name="new_name"
              required
              value={name}
              onFocus={(e) => e.target.select()}
              onChange={(e) => setName(e.target.value)}
            />
          </PanelBody>
        </Panel>
      </form>
      <Panel title={t('Delete data or table')}>
        <PanelBody>
          <Button variant="link" id="drop_view_anchor" className="text-error" onClick={() => void drop()}>
            {t('Delete the view (DROP)')}
          </Button>{' '}
          <MySqlDocLink link="DROP VIEW" />
        </PanelBody>
      </Panel>
    </>
  )
}

const badge = (type: string) =>
  type === 'error'
    ? 'bg-error text-white'
    : type === 'warning'
      ? 'bg-warning text-black'
      : type === 'info' || type === 'note'
        ? 'bg-info text-white'
        : 'bg-bg-inset'

/** pma: templates/table/maintenance/{analyze,check,checksum,optimize,repair}.twig */
function MaintenanceResults({ result }: { result: MaintenanceResult }) {
  const tables = [...new Set(result.rows.map((r) => r.table))]
  return (
    <div className="space-y-2" data-testid="maintenance-result">
      <h2 className="text-lg">{result.title}</h2>
      {result.checksums !== undefined ? (
        <table className="text-sm">
          <thead>
            <tr>
              <th className="px-2 text-left">{t('Table')}</th>
              <th className="px-2 text-left">{t('Checksum')}</th>
            </tr>
          </thead>
          <tbody>
            {result.checksums.map((c) => (
              <tr key={c.table}>
                <td className="px-2">{c.table}</td>
                <td className="px-2">{c.checksum ?? <em>NULL</em>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        tables.map((name) => (
          <Panel key={name} title={name}>
            <PanelList>
              {result.rows
                .filter((r) => r.table === name)
                .map((r, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: result rows
                  <PanelItem key={i}>
                    {r.op.toLowerCase() !== result.op && (
                      <span className="me-1 rounded bg-bg-inset px-1 text-xs">{r.op}</span>
                    )}
                    <span className={`me-1 rounded px-1 text-xs ${badge(r.msgType.toLowerCase())}`}>
                      {r.msgType}
                    </span>
                    {r.msgText}
                  </PanelItem>
                ))}
            </PanelList>
          </Panel>
        ))
      )}
      {(result.notices ?? []).map((n) => (
        <Alert key={n} variant="notice">
          {n}
        </Alert>
      ))}
    </div>
  )
}
