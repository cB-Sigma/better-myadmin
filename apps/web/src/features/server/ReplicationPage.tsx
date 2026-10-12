import type {
  AdminMessage,
  ReplicationActionResponse,
  ReplicationPage as ReplicationModel,
  ReplicationView,
  StatusOverview,
} from '@bettermyadmin/contracts'
import {
  Button,
  FormRow,
  Hint,
  Input,
  Loading,
  MessageBox,
  NativeSelect,
  PageHeader,
  Panel,
  PanelBody,
  SafeHtml,
  Table,
  buttonVariants,
  useConfirm,
} from '@bettermyadmin/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Network } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'
import { suggestPassword } from '../shell/home/password'
import {
  type PredHostname,
  checkAddUser,
  hostnameForPreset,
  primaryConfigSnippet,
  randomServerId,
} from './replication'

export interface ReplicationSearch {
  view: ReplicationView
  primary_connection: string
}

/**
 * Server › Replication: primary and replica cards, the primary configuration wizard, the
 * add-replica-user and change-primary forms, the replica controls.
 * pma: templates/server/replication/*.twig, resources/js/replication.ts
 */
export function ReplicationPage({
  server,
  search,
  onSearch,
}: {
  server: number
  search: ReplicationSearch
  onSearch: (s: Partial<ReplicationSearch>) => void
}) {
  const qc = useQueryClient()
  const conn = search.primary_connection !== '' ? { primary_connection: search.primary_connection } : {}
  const query = { view: search.view, ...conn }
  const key = qk.replication(server, query)
  const q = useQuery({ queryKey: key, queryFn: () => api.replication(server, query) })
  const [message, setMessage] = useState<{ message: AdminMessage; html?: boolean; sql?: string } | null>(null)
  /** an action answers with the page as phpMyAdmin renders it after the action (main view) */
  const done = (r: ReplicationActionResponse) => {
    setMessage(r.message === null ? null : { message: r.message })
    qc.setQueryData(qk.replication(server, { view: '', ...conn }), r.page)
    if (search.view !== '') onSearch({ view: '' })
  }
  const go = (view: ReplicationView) => {
    setMessage(null)
    onSearch({ view })
  }
  const p = q.data
  return (
    <div>
      <PageHeader icon={Network}>{t('Replication')}</PageHeader>
      {q.error !== null && <MessageBox {...errorMessage(q.error)} />}
      {p === undefined ? (
        q.isPending && <Loading />
      ) : !p.isSuperUser ? (
        <MessageBox type="error">{t('No privileges')}</MessageBox>
      ) : (
        <div id="replication">
          {message !== null &&
            (message.html === true ? (
              <MessageBox
                type={message.message.type}
                {...(message.sql !== undefined ? { sql: message.sql } : {})}
              >
                <SafeHtml html={message.message.text} />
              </MessageBox>
            ) : (
              <MessageBox type={message.message.type} text={message.message.text} />
            ))}
          {p.isPrimary ? (
            <>
              {p.primary !== null && (
                <PrimaryReplication primary={p.primary} onAddUser={() => go('primary_add_user')} />
              )}
              {p.addUser !== null && (
                <AddReplicaUser
                  server={server}
                  form={p.addUser}
                  onDone={(r) => {
                    setMessage({ message: r.message, html: true, sql: r.sql })
                    if (r.success) go('')
                  }}
                />
              )}
            </>
          ) : (
            p.view !== 'primary_configure' &&
            p.view !== 'replica_configure' &&
            p.view !== 'primary_add_user' && (
              <Panel title={t('Primary replication')}>
                <PanelBody>
                  <LinkedSentence
                    text={t(
                      'This server is not configured as primary in a replication process. Would you like to %sconfigure%s it?',
                    )}
                    link={(label) => (
                      <Button variant="link" onClick={() => go('primary_configure')}>
                        {label}
                      </Button>
                    )}
                  />
                </PanelBody>
              </Panel>
            )
          )}
          {p.primaryConfiguration !== null && (
            <PrimaryConfiguration databases={p.primaryConfiguration.databases} onGo={() => go('')} />
          )}
          {p.replica !== null && (
            <ReplicaConfiguration
              server={server}
              replica={p.replica}
              onConnection={(c) => onSearch({ primary_connection: c })}
              onDone={done}
              onReconfigure={() => go('replica_configure')}
            />
          )}
          {p.changePrimary !== null && (
            <ChangePrimary
              server={server}
              form={p.changePrimary}
              primaryConnection={search.primary_connection}
              onDone={done}
            />
          )}
        </div>
      )}
    </div>
  )
}

/** A message whose `%s…%s` part is a link. */
function LinkedSentence({ text, link }: { text: string; link: (label: string) => ReactNode }) {
  const [before = '', label = '', after = ''] = text.split('%s')
  return (
    <>
      {before}
      {link(label)}
      {after}
    </>
  )
}

/** pma: templates/server/replication/status_table.twig (Variable / Value, *_Running coloured) */
export function ReplicationStatusTable({
  table,
  title = false,
}: {
  table: StatusOverview['replication'][number]
  title?: boolean
}) {
  return (
    <div id={`replication_${table.type}_section`}>
      {title && (
        <h4 className="mb-1 text-sm font-semibold" id={`replication_${table.type}`}>
          {table.type === 'primary' ? t('Primary status') : t('Replica status')}
        </h4>
      )}
      <Table zebra className="mb-3" id={`server${table.type}replicationsummary`}>
        <thead>
          <tr>
            <th>{t('Variable')}</th>
            <th>{t('Value')}</th>
          </tr>
        </thead>
        <tbody>
          {table.variables.map((v) => (
            <tr key={v.name}>
              <td>{v.name}</td>
              <td className="text-end font-mono">
                <span
                  className={
                    v.status === 'text-danger'
                      ? 'text-error'
                      : v.status === 'text-success'
                        ? 'text-success'
                        : ''
                  }
                >
                  {v.value}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  )
}

/** pma: templates/server/replication/primary_replication.twig */
function PrimaryReplication({
  primary,
  onAddUser,
}: {
  primary: NonNullable<ReplicationModel['primary']>
  onAddUser: () => void
}) {
  const [status, setStatus] = useState(false)
  const [replicas, setReplicas] = useState(false)
  return (
    <Panel title={t('Primary replication')}>
      <PanelBody>
        {t('This server is configured as primary in a replication process.')}
        <ul className="ms-5 mt-1 list-disc space-y-1">
          <li>
            <Button variant="link" id="primary_status_href" onClick={() => setStatus(!status)}>
              {t('Show primary status')}
            </Button>
            {status && <ReplicationStatusTable table={primary.statusTable} />}
          </li>
          <li>
            <Button variant="link" id="primary_replicas_href" onClick={() => setReplicas(!replicas)}>
              {t('Show connected replicas')}
            </Button>
            {replicas && (
              <div id="replication_replicas_section">
                <Table zebra className="mb-2">
                  <thead>
                    <tr>
                      <th>{t('Server ID')}</th>
                      <th>{t('Host')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {primary.replicas.map((r) => (
                      <tr key={`${r.serverId}/${r.host}`}>
                        <td className="text-end font-mono">{r.serverId}</td>
                        <td className="text-end font-mono">{r.host}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                <MessageBox
                  type="notice"
                  text={t(
                    'Only replicas started with the --report-host=host_name option are visible in this list.',
                  )}
                />
              </div>
            )}
          </li>
          <li>
            <Button variant="link" id="primary_addreplicauser_href" onClick={onAddUser}>
              {t('Add replica replication user')}
            </Button>
          </li>
        </ul>
      </PanelBody>
    </Panel>
  )
}

/** pma: templates/server/replication/primary_add_replica_user.twig (+ server/privileges.ts checks) */
function AddReplicaUser({
  server,
  form,
  onDone,
}: {
  server: number
  form: NonNullable<ReplicationModel['addUser']>
  onDone: (r: { success: boolean; message: AdminMessage; sql: string }) => void
}) {
  const [predUsername, setPredUsername] = useState(form.predefinedUsername)
  const [username, setUsername] = useState(form.username)
  const [predHostname, setPredHostname] = useState<PredHostname>(form.predefinedHostname)
  const [hostname, setHostname] = useState(form.hostname)
  const [predPassword, setPredPassword] = useState<'none' | 'userdefined'>(
    form.hasUsername ? 'none' : 'userdefined',
  )
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [generated, setGenerated] = useState('')
  // onloadChangePasswordEvents: `required` only once a preset or field changed
  const [reqUser, setReqUser] = useState(false)
  const [reqHost, setReqHost] = useState(false)
  const [reqPw, setReqPw] = useState(false)
  const add = useMutation({
    mutationFn: () =>
      api.addReplicaUser(server, {
        pred_username: predUsername,
        username,
        pred_hostname: predHostname,
        hostname,
        pred_password: predPassword,
        pma_pw: pw,
      }),
    onSuccess: onDone,
  })
  return (
    <div id="primary_addreplicauser_gui">
      <form
        id="addUsersForm"
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault()
          const problem = checkAddUser({
            hostname,
            predUsername,
            username,
            predPassword,
            password: pw,
            password2: pw2,
          })
          if (problem !== null) {
            // pma: server/privileges.ts CheckAddUser uses alert()
            window.alert(t(problem))
            if (problem !== 'The host name is empty!' && problem !== 'The user name is empty!') {
              setPw('')
              setPw2('')
            }
            return
          }
          add.mutate()
        }}
      >
        <Panel
          title={t('Add replica replication user')}
          footer={
            <input
              type="submit"
              id="adduser_submit"
              value={t('Go')}
              className={buttonVariants({ variant: 'primary' })}
            />
          }
        >
          <PanelBody id="fieldset_add_user_login">
            {add.error !== null && <MessageBox {...errorMessage(add.error)} />}
            <FormRow label={t('User name:')} htmlFor="select_pred_username">
              <div className="flex flex-wrap gap-2">
                <NativeSelect
                  name="pred_username"
                  id="select_pred_username"
                  title={t('User name')}
                  className="w-auto"
                  value={predUsername}
                  onChange={(e) => {
                    const v = e.target.value as 'any' | 'userdefined'
                    setPredUsername(v)
                    setReqUser(v === 'userdefined')
                    if (v === 'any') setUsername('')
                  }}
                >
                  <option value="any">{t('Any user')}</option>
                  <option value="userdefined">{t('Use text field:')}</option>
                </NativeSelect>
                <Input
                  type="text"
                  name="username"
                  id="pma_username"
                  className="w-56"
                  maxLength={form.usernameLength}
                  title={t('User name')}
                  value={username}
                  spellCheck={false}
                  required={reqUser}
                  onChange={(e) => {
                    setUsername(e.target.value)
                    setPredUsername('userdefined')
                    setReqUser(true)
                  }}
                />
              </div>
            </FormRow>
            <FormRow label={t('Host:')} htmlFor="select_pred_hostname">
              <div className="flex flex-wrap items-center gap-2">
                <NativeSelect
                  name="pred_hostname"
                  id="select_pred_hostname"
                  title={t('Host')}
                  className="w-auto"
                  value={predHostname}
                  onChange={(e) => {
                    const v = e.target.value as PredHostname
                    setPredHostname(v)
                    if (v === 'hosttable') setReqHost(false)
                    else if (v === 'userdefined') setReqHost(true)
                    const h = hostnameForPreset(v, form.thisHost)
                    if (h !== null) setHostname(h)
                  }}
                >
                  <option value="any">{t('Any host')}</option>
                  <option value="localhost">{t('Local')}</option>
                  {form.thisHost !== null && <option value="thishost">{t('This host')}</option>}
                  <option value="hosttable">{t('Use host table')}</option>
                  <option value="userdefined">{t('Use text field:')}</option>
                </NativeSelect>
                <Input
                  type="text"
                  name="hostname"
                  id="pma_hostname"
                  className="w-56"
                  maxLength={form.hostnameLength}
                  title={t('Host')}
                  value={hostname}
                  required={reqHost}
                  onChange={(e) => {
                    setHostname(e.target.value)
                    setPredHostname('userdefined')
                    setReqHost(true)
                  }}
                />
                <Hint
                  message={t(
                    'When Host table is used, this field is ignored and values stored in Host table are used instead.',
                  )}
                />
              </div>
            </FormRow>
            <FormRow label={t('Password:')} htmlFor="select_pred_password">
              <div className="flex flex-wrap gap-2">
                <NativeSelect
                  name="pred_password"
                  id="select_pred_password"
                  title={t('Password')}
                  className="w-auto"
                  value={predPassword}
                  onChange={(e) => {
                    const v = e.target.value as 'none' | 'userdefined'
                    setPredPassword(v)
                    setReqPw(v === 'userdefined')
                    if (v === 'none') {
                      setPw('')
                      setPw2('')
                    }
                  }}
                >
                  <option value="none">{t('No password')}</option>
                  <option value="userdefined">{t('Use text field:')}</option>
                </NativeSelect>
                <Input
                  type="password"
                  id="text_pma_pw"
                  name="pma_pw"
                  className="w-56"
                  title={t('Password')}
                  spellCheck={false}
                  value={pw}
                  required={reqPw}
                  onChange={(e) => {
                    setPw(e.target.value)
                    setPredPassword('userdefined')
                    setReqPw(true)
                  }}
                />
              </div>
            </FormRow>
            <FormRow label={t('Re-type:')} htmlFor="text_pma_pw2">
              <Input
                type="password"
                id="text_pma_pw2"
                name="pma_pw2"
                className="w-56"
                title={t('Re-type')}
                spellCheck={false}
                value={pw2}
                required={reqPw}
                onChange={(e) => {
                  setPw2(e.target.value)
                  setPredPassword('userdefined')
                  setReqPw(true)
                }}
              />
            </FormRow>
            <FormRow label={t('Generate password:')} htmlFor="button_generate_password">
              <div className="flex flex-wrap gap-2">
                <input
                  type="button"
                  id="button_generate_password"
                  className={buttonVariants()}
                  value={t('Generate')}
                  onClick={() => {
                    // pma: functions.ts::suggestPassword fills both password fields and generated_pw
                    const g = suggestPassword()
                    setGenerated(g)
                    setPw(g)
                    setPw2(g)
                    setPredPassword('userdefined')
                  }}
                />
                <Input
                  type="text"
                  name="generated_pw"
                  id="generated_pw"
                  className="w-56"
                  value={generated}
                  onChange={(e) => setGenerated(e.target.value)}
                />
              </div>
            </FormRow>
          </PanelBody>
        </Panel>
      </form>
    </div>
  )
}

/** pma: templates/server/replication/primary_configuration.twig, database_multibox.twig */
function PrimaryConfiguration({ databases, onGo }: { databases: string[]; onGo: () => void }) {
  const serverId = useMemo(() => randomServerId(), [])
  const [mode, setMode] = useState<'all' | 'ign'>('all')
  const [selected, setSelected] = useState<string[]>([])
  return (
    <Panel
      title={t('Primary configuration')}
      footer={
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onGo()
          }}
        >
          <input
            id="goButton"
            type="submit"
            value={t('Go')}
            className={buttonVariants({ variant: 'primary' })}
          />
        </form>
      }
    >
      <PanelBody className="space-y-2">
        <p>
          {t(
            'This server is not configured as a primary server in a replication process. You can choose from either replicating all databases and ignoring some of them (useful if you want to replicate a majority of the databases) or you can choose to ignore all databases by default and allow only certain databases to be replicated. Please select the mode:',
          )}
        </p>
        <NativeSelect
          name="db_type"
          id="db_type"
          aria-label={t('Please select the mode:')}
          className="w-auto"
          value={mode}
          onChange={(e) => setMode(e.target.value as 'all' | 'ign')}
        >
          <option value="all">{t('Replicate all databases; Ignore:')}</option>
          <option value="ign">{t('Ignore all databases; Replicate:')}</option>
        </NativeSelect>
        <p>{t('Please select databases:')}</p>
        <NativeSelect
          id="db_select"
          name="db_select[]"
          aria-label={t('Please select databases:')}
          multiple
          size={6}
          className="h-auto w-full max-w-xl"
          value={selected}
          onChange={(e) => setSelected([...e.target.selectedOptions].map((o) => o.value))}
        >
          {databases.map((db) => (
            <option key={db} value={db}>
              {db}
            </option>
          ))}
        </NativeSelect>
        <p>
          <Button variant="link" id="db_select_href" onClick={() => setSelected(databases)}>
            {t('Select all')}
          </Button>{' '}
          /{' '}
          <Button variant="link" id="db_reset_href" onClick={() => setSelected([])}>
            {t('Unselect all')}
          </Button>
        </p>
        <p>
          {t(
            'Now, add the following lines at the end of [mysqld] section in your my.cnf and please restart the MySQL server afterwards.',
          )}
        </p>
        <pre id="rep" className="rounded border border-border bg-bg-subtle p-2 font-mono text-xs">
          {primaryConfigSnippet(serverId, mode, selected)}
        </pre>
        <p>
          <SafeHtml
            html={t(
              'Once you restarted MySQL server, please click on Go button. Afterwards, you should see a message informing you, that this server <strong>is</strong> configured as primary.',
            )}
          />
        </p>
      </PanelBody>
    </Panel>
  )
}

/** pma: templates/server/replication/replica_configuration.twig */
function ReplicaConfiguration({
  server,
  replica,
  onConnection,
  onDone,
  onReconfigure,
}: {
  server: number
  replica: NonNullable<ReplicationModel['replica']>
  onConnection: (c: string) => void
  onDone: (r: ReplicationActionResponse) => void
  onReconfigure: () => void
}) {
  const confirm = useConfirm()
  const [status, setStatus] = useState(false)
  const [control, setControl] = useState(false)
  const [errors, setErrors] = useState(false)
  const [skip, setSkip] = useState('1')
  const [connection, setConnection] = useState(replica.primaryConnection)
  const conn = replica.primaryConnection !== '' ? { primary_connection: replica.primaryConnection } : {}
  const act = useMutation({
    mutationFn: (a: { action: string; control: string | null }) =>
      api.replicaControl(server, { ...a, ...conn }),
    onSuccess: onDone,
  })
  const skipErrors = useMutation({
    mutationFn: (count: string) => api.replicaSkipErrors(server, count, conn.primary_connection),
    onSuccess: onDone,
  })
  const error = act.error ?? skipErrors.error
  const [before = '', after = ''] = t('Skip next %s errors.').split('%s')
  return (
    <Panel title={t('Replica replication')}>
      <PanelBody>
        {error !== null && <MessageBox {...errorMessage(error)} />}
        {replica.connections.length > 0 && (
          <>
            {t('Primary connection:')}
            <form
              className="mt-1 mb-4 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                onConnection(connection)
              }}
            >
              <NativeSelect
                name="primary_connection"
                aria-label={t('Primary connection:')}
                className="w-auto"
                value={connection}
                onChange={(e) => setConnection(e.target.value)}
              >
                <option value="">{t('Default')}</option>
                {replica.connections.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </NativeSelect>
              <input
                id="goButton"
                type="submit"
                value={t('Go')}
                className={buttonVariants({ variant: 'primary' })}
              />
            </form>
          </>
        )}
        {replica.isReplica ? (
          <div id="replica_configuration_gui">
            {!replica.sqlRunning && <MessageBox type="error" text={t('Replica SQL Thread not running!')} />}
            {!replica.ioRunning && <MessageBox type="error" text={t('Replica IO Thread not running!')} />}
            <p>{t('Server is configured as replica in a replication process. Would you like to:')}</p>
            <ul className="ms-5 mt-1 list-disc space-y-1">
              <li>
                <Button variant="link" id="replica_status_href" onClick={() => setStatus(!status)}>
                  {t('See replica status table')}
                </Button>
                {status && replica.statusTable !== null && (
                  <ReplicationStatusTable table={replica.statusTable} />
                )}
              </li>
              <li>
                <Button variant="link" id="replica_control_href" onClick={() => setControl(!control)}>
                  {t('Control replica:')}
                </Button>
                {control && (
                  <ul id="replica_control_gui" className="ms-5 list-[circle]">
                    <li>
                      {/* untranslated in phpMyAdmin's template */}
                      <Button
                        variant="link"
                        onClick={() => act.mutate({ action: replica.fullAction, control: null })}
                      >
                        {replica.fullAction === 'start' ? 'Full start' : 'Full stop'}
                      </Button>
                    </li>
                    <li>
                      <Button
                        variant="link"
                        id="reset_replica"
                        onClick={async () => {
                          if (
                            await confirm({
                              question: t('Do you really want to reset the replica (RESET REPLICA)?'),
                            })
                          )
                            act.mutate({ action: 'reset', control: null })
                        }}
                      >
                        {t('Reset replica')}
                      </Button>
                    </li>
                    <li>
                      <Button
                        variant="link"
                        onClick={() => act.mutate({ action: replica.sqlAction, control: 'SQL_THREAD' })}
                      >
                        {!replica.sqlRunning ? t('Start SQL Thread only') : t('Stop SQL Thread only')}
                      </Button>
                    </li>
                    <li>
                      <Button
                        variant="link"
                        onClick={() => act.mutate({ action: replica.ioAction, control: 'IO_THREAD' })}
                      >
                        {!replica.ioRunning ? t('Start IO Thread only') : t('Stop IO Thread only')}
                      </Button>
                    </li>
                  </ul>
                )}
              </li>
              <li>
                <Button variant="link" id="replica_errormanagement_href" onClick={() => setErrors(!errors)}>
                  {t('Error management:')}
                </Button>
                {errors && (
                  <div id="replica_errormanagement_gui">
                    <MessageBox
                      type="error"
                      text={t('Skipping errors might lead into unsynchronized primary and replica!')}
                    />
                    <ul className="ms-5 list-[circle] space-y-1">
                      <li>
                        <Button variant="link" onClick={() => skipErrors.mutate('1')}>
                          {t('Skip current error')}
                        </Button>
                      </li>
                      <li>
                        <form
                          className="flex flex-wrap items-center gap-1"
                          onSubmit={(e) => {
                            e.preventDefault()
                            skipErrors.mutate(skip)
                          }}
                        >
                          {before}
                          <Input
                            type="text"
                            name="sr_skip_errors_count"
                            aria-label={t('Skip next %s errors.')}
                            className="repl_gui_skip_err_cnt w-12"
                            value={skip}
                            onChange={(e) => setSkip(e.target.value)}
                          />
                          {after}
                          <input
                            type="submit"
                            name="sr_replica_skip_error"
                            value={t('Go')}
                            className={buttonVariants({ variant: 'primary' })}
                          />
                        </form>
                      </li>
                    </ul>
                  </div>
                )}
              </li>
              <li>
                <Button variant="link" onClick={onReconfigure}>
                  {t('Change or reconfigure primary server')}
                </Button>
              </li>
            </ul>
          </div>
        ) : (
          <LinkedSentence
            text={t(
              'This server is not configured as replica in a replication process. Would you like to %sconfigure%s it?',
            )}
            link={(label) => (
              <Button variant="link" onClick={onReconfigure}>
                {label}
              </Button>
            )}
          />
        )}
      </PanelBody>
    </Panel>
  )
}

/** pma: templates/server/replication/change_primary.twig */
function ChangePrimary({
  server,
  form,
  primaryConnection,
  onDone,
}: {
  server: number
  form: NonNullable<ReplicationModel['changePrimary']>
  primaryConnection: string
  onDone: (r: ReplicationActionResponse) => void
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [hostname, setHostname] = useState('')
  const [port, setPort] = useState('3306')
  const change = useMutation({
    mutationFn: () =>
      api.changePrimary(server, {
        username,
        password,
        hostname,
        port,
        ...(primaryConnection !== '' ? { primary_connection: primaryConnection } : {}),
      }),
    onSuccess: onDone,
  })
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        change.mutate()
      }}
    >
      <Panel
        title={t('Replica configuration - Change or reconfigure primary server')}
        footer={
          <input
            type="submit"
            id="confreplica_submit"
            value={t('Go')}
            className={buttonVariants({ variant: 'primary' })}
          />
        }
      >
        <PanelBody id="fieldset_add_user_login">
          {change.error !== null && <MessageBox {...errorMessage(change.error)} />}
          <p>
            {t(
              'Make sure you have a unique server-id in your configuration file (my.cnf). If not, please add the following line into [mysqld] section:',
            )}
          </p>
          <pre className="my-2 rounded border border-border bg-bg-subtle p-2 font-mono text-xs">
            server-id={form.serverId}
          </pre>
          <FormRow label={t('User name:')} htmlFor="text_username">
            <Input
              id="text_username"
              name="username"
              type="text"
              className="w-56"
              maxLength={form.usernameLength}
              title={t('User name')}
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </FormRow>
          <FormRow label={t('Password:')} htmlFor="text_pma_pw">
            <Input
              id="text_pma_pw"
              name="pma_pw"
              type="password"
              className="w-56"
              spellCheck={false}
              title={t('Password')}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </FormRow>
          <FormRow label={t('Host:')} htmlFor="text_hostname">
            <Input
              id="text_hostname"
              name="hostname"
              type="text"
              className="w-56"
              maxLength={form.hostnameLength}
              required
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
            />
          </FormRow>
          <FormRow label={t('Port:')} htmlFor="text_port">
            <Input
              id="text_port"
              name="text_port"
              type="number"
              className="w-28"
              maxLength={6}
              required
              value={port}
              onChange={(e) => setPort(e.target.value)}
            />
          </FormRow>
        </PanelBody>
      </Panel>
    </form>
  )
}
