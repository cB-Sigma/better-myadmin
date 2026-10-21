import type { ChangePasswordFields, PrivForm, SpecificRights, UserProperties } from '@bettermyadmin/contracts'
import { N_ } from '@bettermyadmin/i18n'
import {
  Alert,
  Button,
  Hint,
  IconText,
  Input,
  Loading,
  MessageBox,
  MySqlDocLink,
  NativeSelect,
  PageHeader,
  Panel,
  PanelBody,
  Table,
  buttonVariants,
  useConfirm,
} from '@bettermyadmin/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { UserPen } from 'lucide-react'
import { type ReactNode, useRef, useState } from 'react'
import { api, errorMessage } from '../../../lib/api'
import { pgettext, t } from '../../../lib/i18n'
import { path } from '../../../lib/paths'
import { qk } from '../../../lib/queryKeys'
import {
  EMPTY_WITH_ALLOW_NO_PASSWORD_OFF,
  SHA256_NOTICE,
  checkPassword,
  passwordScore,
  strengthLabel,
  suggestPassword,
} from '../../shell/home/password.ts'
import { InlineHtml } from '../../shell/inline-html.tsx'
import { usePageCardEnv } from '../../sql/page-card'
import { LoginInformationFields } from './LoginInformationFields.tsx'
import { GroupCard, PrivilegesTableFields, useGroupState } from './PrivilegesTableFields.tsx'
import { type Flash, setFlash, takeFlash } from './flash.ts'
import {
  checkAddUser,
  editSearch,
  formToPhp,
  routinePrivilegesModel,
  unescapeWildcards,
} from './privileges.ts'
import { GateMessages, PrivList, PrivMessageBox } from './shared.tsx'

export interface EditUserSearch {
  username: string
  hostname: string
  dbname?: string | string[] | undefined
  tablename?: string | undefined
  routinename?: string | undefined
}

/** Link / navigate props of the user editor at a level (getUserLink 'edit'). */
const editor = (server: number, search: EditUserSearch) => ({
  to: path(`/s/${server}/privileges/user`),
  search: search as never,
})

/**
 * Server → User accounts → Edit privileges: the privileges table of the level, the database /
 * table / routine summaries, Change password and Change login information / Copy user, shown one
 * at a time behind the sub-menu pills built from the sections' labels (addOrUpdateSubmenu).
 * pma: templates/server/privileges/user_properties.twig, privileges_summary.twig,
 *      edit_routine_privileges.twig, change_password.twig, Privileges::getHtmlForUserProperties
 */
export function EditUserPage({ server, search }: { server: number; search: EditUserSearch }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const query: PrivForm = {
    username: search.username,
    hostname: search.hostname,
    ...(search.dbname !== undefined ? { dbname: search.dbname } : {}),
    ...(search.tablename !== undefined ? { tablename: search.tablename } : {}),
    ...(search.routinename !== undefined ? { routinename: search.routinename } : {}),
  }
  const data = useQuery({
    queryKey: qk.userProperties(server, query),
    queryFn: () => api.userProperties(server, query),
  })
  const [flash, setLocalFlash] = useState<Flash | null>(() => takeFlash())
  const [active, setActive] = useState(0)
  const { env, replacement } = usePageCardEnv(server)

  const run = async (
    form: PrivForm,
    then?: (r: Awaited<ReturnType<typeof api.submitPrivileges>>) => void,
  ) => {
    try {
      const r = await api.submitPrivileges(server, form)
      void qc.invalidateQueries({ queryKey: qk.privileges(server) })
      if (r.reload) void qc.invalidateQueries({ queryKey: qk.nav(server) })
      setLocalFlash({ message: r.message, sql: r.sql, card: r.card })
      then?.(r)
    } catch (e) {
      setLocalFlash({ message: errorMessage(e), sql: '' })
    }
    window.scrollTo?.({ top: 0 })
  }

  const d = data.data
  // a link of the message's query card ran its query: the result replaces the page
  if (replacement !== null) return replacement
  if (data.error !== null) return <MessageBox {...errorMessage(data.error)} />
  if (d === undefined) return <Loading />
  if (d.gate.noPrivileges) return <GateMessages gate={d.gate} />

  const sections: Array<{ label: string; node: ReactNode }> = []
  if (d.routine !== null)
    sections.push({ label: t('Routine'), node: <RoutineForm d={d} onSubmit={(f) => void run(f)} /> })
  else if (d.privilegesTable !== null) {
    const hidden = (
      <>
        <input type="hidden" name="username" value={d.username} />
        <input type="hidden" name="hostname" value={d.hostname} />
        {Array.isArray(d.database) ? (
          d.database.map((db) => <input key={db} type="hidden" name="dbname[]" value={db} />)
        ) : (
          <input type="hidden" name="dbname" value={d.database} />
        )}
        {!Array.isArray(d.database) && d.database !== '' && d.table !== '' && (
          <input type="hidden" name="tablename" value={d.table} />
        )}
      </>
    )
    const label =
      d.privilegesTable.columns !== null
        ? t('Table')
        : d.privilegesTable.isGlobal
          ? t('Global')
          : d.privilegesTable.isDatabase
            ? t('Database')
            : t('Table')
    sections.push({
      label,
      node: (
        <form
          className="submenu-item"
          name="usersForm"
          id="addUsersForm"
          onSubmit={(e) => {
            e.preventDefault()
            void run(formToPhp(new FormData(e.currentTarget).entries()))
          }}
        >
          {hidden}
          <PrivilegesTableFields table={d.privilegesTable} />
        </form>
      ),
    })
  }
  for (const rights of d.rights) {
    sections.push({
      label: t({ database: 'Database', table: 'Table', routine: 'Routine' }[rights.type]),
      node: (
        <RightsSummary
          server={server}
          d={d}
          rights={rights}
          onRevoke={(link) =>
            void run({ username: d.username, hostname: d.hostname, ...link, revokeall: '1' })
          }
          onGo={(s) => void navigate(editor(server, s))}
        />
      ),
    })
  }
  if (d.changePassword !== null) {
    sections.push({
      label: t('Change password'),
      node: <ChangePasswordSection fields={d.changePassword} onSubmit={(f) => void run(f)} />,
    })
  }
  // the copy form is rendered at every level (its login fields only at global level)
  if (d.routine === null) {
    sections.push({
      label: t('Login Information'),
      node: (
        <CopyUserForm
          server={server}
          d={d}
          onSubmit={(f) =>
            void run(f, (r) => {
              if (r.success && r.account !== null) {
                setFlash({ message: r.message, sql: r.sql, card: r.card })
                void navigate(editor(server, editSearch(r.account.username, r.account.hostname)))
              }
            })
          }
        />
      ),
    })
  }
  const current = Math.min(active, sections.length - 1)
  const db = Array.isArray(d.database) ? d.database : d.database
  return (
    <div className="container" id="edit_user_dialog">
      {/* the response page of the form: Generator::getMessage before the user's page (and its pills) */}
      {flash !== null && (
        <PrivMessageBox message={flash.message} sql={flash.sql} card={flash.card} env={env} />
      )}
      {/* addOrUpdateSubmenu replaces the sub-navigation (.nav-pills) by the sections' pills */}
      {sections.length > 0 && (
        <ul
          className="bma-subnav nav nav-pills mb-2 flex flex-wrap gap-1 text-sm"
          aria-label={t('Edit privileges:')}
        >
          {sections.map((s, i) => (
            <li className="nav-item" key={s.label}>
              <a
                href={`#${i}`}
                className={`nav-link block rounded px-3 py-1.5 hover:no-underline ${i === current ? 'active bg-accent text-accent-fg' : 'text-accent hover:bg-bg-subtle'}`}
                onClick={(e) => {
                  e.preventDefault()
                  setActive(i)
                }}
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      )}
      <GateMessages gate={d.gate} />
      <PageHeader icon={UserPen}>
        <EditHeader server={server} d={d} />
      </PageHeader>
      {d.isCurrentUser && (
        <MessageBox
          type="notice"
          text={t(
            'Note: You are attempting to edit privileges of the user with which you are currently logged in.',
          )}
        />
      )}
      {d.userDoesNotExist && (
        <MessageBox type="error" text={t('The selected user was not found in the privilege table.')} />
      )}
      {sections[current]?.node}
      {/* user_properties.twig: the header turns `database` into a list unless a table is given, so the
          links only show at table level */}
      {d.routine === null && typeof db === 'string' && db !== '' && !d.isWildcard && d.table !== '' && (
        <p className="mb-3 text-[13px]">
          [ {t('Database')}{' '}
          <Link
            className="text-accent"
            to={path(`/s/${server}/db/${encodeURIComponent(unescapeWildcards(db))}/${d.databaseTab.path}`)}
          >
            {unescapeWildcards(db)}: {d.databaseTab.title}
          </Link>{' '}
          ]
          {d.table !== '' && (
            <>
              {' '}
              [ {t('Table')}{' '}
              <Link
                className="text-accent"
                to={path(
                  `/s/${server}/db/${encodeURIComponent(unescapeWildcards(db))}/t/${encodeURIComponent(d.table)}/${d.tableTab.path}`,
                )}
              >
                {d.table}: {d.tableTab.title}
              </Link>{' '}
              ]
            </>
          )}
        </p>
      )}
    </div>
  )
}

/** The `<h2>` of user_properties.twig / edit_routine_privileges.twig */
function EditHeader({ server, d }: { server: number; d: UserProperties }) {
  const account = `'${d.username}'@'${d.hostname}'`
  const user = (
    <em>
      <Link className="edit_user_anchor text-accent" {...editor(server, editSearch(d.username, d.hostname))}>
        {account}
      </Link>
    </em>
  )
  if (d.routine !== null) {
    return (
      <>
        {t('Edit privileges:')} {t('User account')} {user} - {t('Database')}{' '}
        <em>
          <Link
            className="text-accent"
            {...editor(server, { username: d.username, hostname: d.hostname, dbname: d.dbname })}
          >
            {String(d.database)}
          </Link>
        </em>{' '}
        - {t('Routine')} <em>{d.routine.name}</em>
      </>
    )
  }
  const hasDb = Array.isArray(d.database) ? d.database.length > 0 : d.database !== ''
  if (!hasDb)
    return (
      <>
        {t('Edit privileges:')} {t('User account')} <em>{account}</em>
      </>
    )
  return (
    <>
      {t('Edit privileges:')} {t('User account')} {user} - {d.isDatabases ? t('Databases') : t('Database')}{' '}
      {d.table !== '' ? (
        <>
          <em>
            <Link
              className="text-accent"
              {...editor(server, { username: d.username, hostname: d.hostname, dbname: d.dbname })}
            >
              {String(d.database)}
            </Link>
          </em>{' '}
          - {t('Table')} <em>{d.table}</em>
        </>
      ) : (
        <em>{(Array.isArray(d.database) ? d.database : [d.database]).join(', ')}</em>
      )}
    </>
  )
}

/** edit_routine_privileges.twig */
function RoutineForm({ d, onSubmit }: { d: UserProperties; onSubmit: (f: PrivForm) => void }) {
  const group = routinePrivilegesModel(d.routine?.privileges ?? {})
  const st = useGroupState([group])
  return (
    <form
      className="submenu-item"
      name="usersForm"
      id="addUsersForm"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(formToPhp(new FormData(e.currentTarget).entries()))
      }}
    >
      <input type="hidden" name="username" value={d.username} />
      <input type="hidden" name="hostname" value={d.hostname} />
      <input type="hidden" name="dbname" value={String(d.database)} />
      <input type="hidden" name="routinename" value={d.routine?.name ?? ''} />
      <input type="hidden" name="grant_count" value={group.boxes.length} />
      <Panel id="fieldset_user_global_rights" title={t('Routine-specific privileges')}>
        <PanelBody>
          <p className="mb-2">
            <small>
              <em>{t('Note: MySQL privilege names are expressed in English.')}</em>
            </small>
          </p>
          <div className="flex">
            <GroupCard group={group} st={st} />
          </div>
        </PanelBody>
      </Panel>
      <div id="fieldset_user_privtable_footer" className="mb-3">
        <input type="hidden" name="update_privs" value="1" />
        <input className={buttonVariants({ variant: 'primary' })} type="submit" value={t('Go')} />
      </div>
    </form>
  )
}

/** privileges_summary.twig: the rights of one level with Edit / Revoke and the add-a-level row. */
function RightsSummary(props: {
  server: number
  d: UserProperties
  rights: SpecificRights
  onRevoke: (link: { dbname: string; tablename: string; routinename: string }) => void
  onGo: (search: EditUserSearch) => void
}) {
  const { d, rights: r } = props
  const text = useRef<HTMLInputElement>(null)
  const multi = useRef<HTMLSelectElement>(null)
  const ui = {
    database: {
      id: 'database_specific_priv',
      legend: 'Database-specific privileges',
      type: 'Database',
      sub: 'Table-specific privileges',
    },
    table: {
      id: 'table_specific_priv',
      legend: 'Table-specific privileges',
      type: 'Table',
      sub: 'Column-specific privileges',
    },
    routine: {
      id: 'routine_specific_priv',
      legend: 'Routine-specific privileges',
      type: 'Routine',
      sub: null,
    },
  }[r.type]
  const colspan = r.type === 'database' ? 7 : r.type === 'table' ? 6 : 5
  const go = (pred?: string) => {
    const account = { username: d.username, hostname: d.hostname }
    if (r.type === 'database') {
      const picked = Array.from(multi.current?.selectedOptions ?? []).map((o) => o.value)
      const typed = text.current?.value ?? ''
      // getDbname: pred_dbname[] (one → a string), else the text field
      if (picked.length > 1) props.onGo({ ...account, dbname: picked })
      else if (picked.length === 1) props.onGo({ ...account, dbname: picked[0] as string })
      else if (typed !== '') props.onGo({ ...account, dbname: typed })
      else props.onGo(account)
      return
    }
    const name = pred ?? text.current?.value ?? ''
    props.onGo({
      ...account,
      dbname: r.escapedDatabase,
      ...(name === '' ? {} : r.type === 'table' ? { tablename: name } : { routinename: name }),
    })
  }
  return (
    <form
      className="submenu-item"
      id={ui.id}
      onSubmit={(e) => {
        e.preventDefault()
        go()
      }}
    >
      <Panel title={t(ui.legend)}>
        <PanelBody>
          <Table zebra className="w-auto">
            <thead>
              <tr>
                <th scope="col">{t(ui.type)}</th>
                <th scope="col">{t('Privileges')}</th>
                <th scope="col">{t('Grant')}</th>
                {ui.sub !== null && <th scope="col">{t(ui.sub)}</th>}
                <th scope="col" colSpan={2}>
                  {t('Action')}
                </th>
              </tr>
            </thead>
            <tbody>
              {r.rows.length === 0 ? (
                <tr>
                  <td className="text-center" colSpan={colspan}>
                    <em>{t('None')}</em>
                  </td>
                </tr>
              ) : (
                r.rows.map((row) => (
                  <tr key={row.name}>
                    <td>{row.name}</td>
                    <td>
                      <PrivList items={row.privileges} sep="," />
                    </td>
                    <td>{row.grant ? t('Yes') : t('No')}</td>
                    {ui.sub !== null && <td>{row.sub ? t('Yes') : t('No')}</td>}
                    <td>
                      {row.edit !== null && (
                        <Link
                          className="edit_user_anchor text-accent"
                          {...editor(props.server, editSearch(d.username, d.hostname, row.edit))}
                        >
                          <IconText icon="b_usredit" text={t('Edit privileges')} />
                        </Link>
                      )}
                    </td>
                    <td>
                      {row.revoke !== null && (
                        <Button
                          variant="link"
                          onClick={(e) => {
                            // getUserLink 'revoke': a data-post link (no confirmation)
                            e.preventDefault()
                            if (row.revoke !== null) props.onRevoke(row.revoke)
                          }}
                        >
                          <IconText icon="b_usrdrop" text={t('Revoke')} />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {r.type === 'database' ? (
              <>
                <label htmlFor="text_dbname">{t('Add privileges on the following database(s):')}</label>
                {r.databases.length > 0 && (
                  <NativeSelect
                    ref={multi}
                    className="resize-vertical h-auto"
                    name="pred_dbname[]"
                    multiple
                    aria-label={t('Database')}
                  >
                    {r.databases.map((db) => (
                      <option key={db.value} value={db.value}>
                        {db.name}
                      </option>
                    ))}
                  </NativeSelect>
                )}
                <Input ref={text} type="text" id="text_dbname" name="dbname" className="w-48" />
                <Hint message={t('Wildcards % and _ should be escaped with a \\ to use them literally.')} />
              </>
            ) : (
              <>
                <input type="hidden" name="dbname" value={r.escapedDatabase} />
                <label htmlFor={r.type === 'table' ? 'text_tablename' : 'text_routinename'}>
                  {r.type === 'table'
                    ? t('Add privileges on the following table:')
                    : t('Add privileges on the following routine:')}
                </label>
                {(r.type === 'table' ? r.tables : r.routines).length > 0 && (
                  <NativeSelect
                    name={r.type === 'table' ? 'pred_tablename' : 'pred_routinename'}
                    className="autosubmit"
                    aria-label={r.type === 'table' ? t('Table') : t('Routine')}
                    defaultValue=""
                    onChange={(e) => go(e.target.value)}
                  >
                    <option value="">{t('Use text field')}:</option>
                    {(r.type === 'table' ? r.tables : r.routines).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </NativeSelect>
                )}
                <Input
                  ref={text}
                  type="text"
                  id={r.type === 'table' ? 'text_tablename' : 'text_routinename'}
                  name={r.type === 'table' ? 'tablename' : 'routinename'}
                  className="w-48"
                />
              </>
            )}
          </div>
        </PanelBody>
      </Panel>
      <div className="mb-3">
        <input className={buttonVariants({ variant: 'primary' })} type="submit" value={t('Go')} />
      </div>
    </form>
  )
}

/**
 * change_password.twig inside the editor (`change_pw=1` with the account's username/hostname).
 * pma: resources/js/server/privileges.ts (ChangePasswordStrength, selectPasswordRadioWhenChangingPassword,
 *      CheckEmptyPasswordWhenAllowNoPasswordIsEnabled)
 */
function ChangePasswordSection({
  fields: f,
  onSubmit,
}: { fields: ChangePasswordFields; onSubmit: (form: PrivForm) => void }) {
  const confirm = useConfirm()
  const [nopass, setNopass] = useState(false)
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [generated, setGenerated] = useState('')
  const [score, setScore] = useState<number | null>(null)
  const [plugin, setPlugin] = useState(
    f.authPlugins.some((p) => p.name === f.origAuthPlugin)
      ? f.origAuthPlugin
      : (f.authPlugins[0]?.name ?? ''),
  )
  const strength = async (v: string) => setScore(v === '' ? 0 : await passwordScore(v, f.username))
  const showHashing = !f.isNew || (f.isNew && f.hasMoreAuthPlugins)
  return (
    <form
      method="post"
      id="change_password_form"
      name="chgPassword"
      className="submenu-item"
      autoComplete="off"
      data-allow-no-password={f.allowNoPassword ? 1 : 0}
      onSubmit={async (e) => {
        e.preventDefault()
        const el = e.currentTarget
        const invalid = checkPassword(nopass, pw, pw2)
        if (invalid !== null) {
          window.alert(t(invalid))
          setPw('')
          setPw2('')
          return
        }
        if (nopass && !f.allowNoPassword) {
          const question = <InlineHtml text={t(EMPTY_WITH_ALLOW_NO_PASSWORD_OFF)} />
          if (!(await confirm({ question }))) return
        }
        onSubmit(formToPhp(new FormData(el).entries()))
      }}
    >
      <input type="hidden" name="username" value={f.username} />
      <input type="hidden" name="hostname" value={f.hostname} />
      <Panel id="fieldset_change_password" title={t('Change password')}>
        <PanelBody>
          <table className="table-borderless text-[13px]">
            <tbody>
              <tr>
                <td colSpan={3} className="pb-2">
                  <input
                    type="radio"
                    name="nopass"
                    value="1"
                    id="nopass_1"
                    checked={nopass}
                    onChange={() => setNopass(true)}
                  />{' '}
                  <label htmlFor="nopass_1">{t('No Password')}</label>
                </td>
              </tr>
              <tr className="align-middle">
                <td className="pe-3">
                  <input
                    type="radio"
                    name="nopass"
                    value="0"
                    id="nopass_0"
                    checked={!nopass}
                    onChange={() => setNopass(false)}
                  />{' '}
                  <label htmlFor="nopass_0">{t('Password:')}&nbsp;</label>
                </td>
                <td>
                  <div className="grid grid-cols-[6rem_1fr] items-center gap-2">
                    <span>{t('Enter:')}</span>
                    <Input
                      type="password"
                      name="pma_pw"
                      id="text_pma_change_pw"
                      size={10}
                      spellCheck={false}
                      autoComplete="new-password"
                      value={pw}
                      onChange={(e) => {
                        setPw(e.target.value)
                        setNopass(false)
                        void strength(e.target.value)
                      }}
                    />
                    <span>{t('Re-type:')}</span>
                    <Input
                      type="password"
                      name="pma_pw2"
                      id="text_pma_change_pw2"
                      size={10}
                      spellCheck={false}
                      autoComplete="new-password"
                      value={pw2}
                      onChange={(e) => {
                        setPw2(e.target.value)
                        setNopass(false)
                      }}
                    />
                  </div>
                </td>
                <td className="ps-3">
                  <div className="flex items-center gap-1">
                    <span>{pgettext('Password strength', 'Strength:')}</span>
                    <meter max={4} id="change_password_strength_meter" value={score ?? 0} />
                  </div>
                  <span id="change_password_strength">{strengthLabel(score)}</span>
                </td>
              </tr>
              {showHashing && (
                <tr className="align-middle">
                  <td className="pt-2">
                    <label htmlFor="select_authentication_plugin_cp">{t('Password Hashing:')}</label>
                  </td>
                  <td colSpan={2} className="pt-2">
                    <NativeSelect
                      name="authentication_plugin"
                      id="select_authentication_plugin_cp"
                      value={plugin}
                      onChange={(e) => setPlugin(e.target.value)}
                    >
                      {f.authPlugins.map((p) => (
                        <option key={p.name} value={p.name}>
                          {p.description}
                        </option>
                      ))}
                    </NativeSelect>
                  </td>
                </tr>
              )}
              <tr className="align-middle" id="tr_element_before_generate_password">
                <td className="pt-2">{t('Generate password')}</td>
                <td colSpan={2} className="pt-2">
                  <div className="flex items-center gap-2">
                    <Button
                      id="button_generate_password"
                      onClick={() => {
                        const g = suggestPassword()
                        setGenerated(g)
                        setPw(g)
                        setPw2(g)
                        setNopass(false)
                        void strength(g)
                      }}
                    >
                      {t('Generate')}
                    </Button>
                    <Input
                      name="generated_pw"
                      id="generated_pw"
                      className="max-w-60"
                      value={generated}
                      onChange={(e) => setGenerated(e.target.value)}
                    />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          {f.isNew && f.hasMoreAuthPlugins && plugin === 'sha256_password' && (
            <Alert variant="notice" id="ssl_reqd_warning_cp">
              <InlineHtml text={t(SHA256_NOTICE)} /> <MySqlDocLink link="sha256-authentication-plugin" />
            </Alert>
          )}
        </PanelBody>
      </Panel>
      <div id="fieldset_change_password_footer" className="mb-3">
        <input type="hidden" name="change_pw" value="1" />
        <input className={buttonVariants({ variant: 'primary' })} type="submit" value={t('Go')} />
      </div>
    </form>
  )
}

/** `#copyUserForm`: Change login information / Copy user account with the four modes. */
function CopyUserForm(props: { server: number; d: UserProperties; onSubmit: (f: PrivForm) => void }) {
  const { d } = props
  const modes: Array<[string, string]> = [
    ['4', N_('… keep the old one.')],
    ['1', N_('… delete the old one from the user tables.')],
    ['2', N_('… revoke all active privileges from the old one and delete it afterwards.')],
    ['3', N_('… delete the old one from the user tables and reload the privileges afterwards.')],
  ]
  return (
    <form
      id="copyUserForm"
      method="post"
      className="copyUserForm submenu-item"
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault()
        const fd = new FormData(e.currentTarget)
        const s = (k: string) => {
          const v = fd.get(k)
          return typeof v === 'string' ? v : ''
        }
        const invalid = checkAddUser({
          hostname: s('hostname'),
          predUsername: s('pred_username'),
          username: s('username'),
          predPassword: s('pred_password'),
          password: s('pma_pw'),
          password2: s('pma_pw2'),
        })
        if (invalid !== null) {
          window.alert(t(invalid))
          return
        }
        props.onSubmit(formToPhp(fd.entries()))
      }}
    >
      <input type="hidden" name="old_username" value={d.username} />
      <input type="hidden" name="old_hostname" value={d.hostname} />
      {d.userGroup !== null && d.userGroup !== '' && (
        <input type="hidden" name="old_usergroup" value={d.userGroup} />
      )}
      <Panel title={t('Change login information / Copy user account')}>
        <PanelBody>
          {d.changeLogin !== null && <LoginInformationFields server={props.server} login={d.changeLogin} />}
          <Panel title={t('Create a new user account with the same privileges and …')}>
            <PanelBody>
              {modes.map(([v, label]) => (
                <div className="form-check mb-2" key={v}>
                  <input
                    className="form-check-input"
                    type="radio"
                    name="mode"
                    id={`mode_${v}`}
                    value={v}
                    defaultChecked={v === '4'}
                  />{' '}
                  <label className="form-check-label" htmlFor={`mode_${v}`}>
                    {t(label)}
                  </label>
                </div>
              ))}
            </PanelBody>
          </Panel>
        </PanelBody>
      </Panel>
      <div className="mb-3">
        <input type="hidden" name="change_copy" value="1" />
        <input className={buttonVariants({ variant: 'primary' })} type="submit" value={t('Go')} />
      </div>
    </form>
  )
}
