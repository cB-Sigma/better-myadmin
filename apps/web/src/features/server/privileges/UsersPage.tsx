import type { PrivForm, UserOverviewRow } from '@bettermyadmin/contracts'
import {
  Button,
  Hint,
  IconText,
  Loading,
  MessageBox,
  Modal,
  MySqlDocLink,
  NativeSelect,
  PageHeader,
  Panel,
  PanelBody,
  PmaIcon,
  Table,
  buttonVariants,
  removeMessage,
  showMessage,
  useConfirm,
} from '@bettermyadmin/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Users } from 'lucide-react'
import { useRef, useState } from 'react'
import { api, errorMessage } from '../../../lib/api'
import { pgettext, t, tProduct } from '../../../lib/i18n'
import { path } from '../../../lib/paths'
import { qk } from '../../../lib/queryKeys'
import { type Flash, takeFlash } from './flash.ts'
import { checkAllState, editSearch, selectedUserValue } from './privileges.ts'
import { GateMessages, PrivList, PrivMessageBox, PrivilegesSubnav, useExportPrivileges } from './shared.tsx'

export interface UsersSearch {
  initial?: string | undefined
  showall?: string | undefined
}

/**
 * Server → User accounts overview: initials pagination, the accounts table with its actions,
 * Export / Remove of the selection, Add user account, the reload-privileges note.
 * pma: templates/server/privileges/user_overview.twig, users_overview.twig, initials_row.twig,
 *      resources/js/server/privileges.ts (RevokeUser, ExportPrivileges, ExportUser, AccountLocking,
 *      EditUserGroup)
 */
export function UsersPage({ server, search }: { server: number; search: UsersSearch }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const query: PrivForm = {
    ...(search.initial !== undefined ? { initial: search.initial } : {}),
    ...(search.showall !== undefined ? { showall: search.showall } : {}),
  }
  const data = useQuery({
    queryKey: qk.usersOverview(server, query),
    queryFn: () => api.usersOverview(server, query),
  })
  const [flash, setFlash] = useState<Flash | null>(() => takeFlash())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dropDb, setDropDb] = useState(false)
  const [groupFor, setGroupFor] = useState<string | null>(null)
  const [locks, setLocks] = useState<Record<string, boolean>>({})
  const exporter = useExportPrivileges(server)
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.privileges(server) })
  }
  const d = data.data
  if (data.error !== null) return <MessageBox {...errorMessage(data.error)} />
  if (d === undefined) return <Loading />
  if (d.gate.noPrivileges)
    return (
      <div>
        <PageHeader icon={Users}>{t('Privileges')}</PageHeader>
        <GateMessages gate={d.gate} />
      </div>
    )
  const users = d.users ?? []
  const values = users.map((u) => selectedUserValue(u.user, u.host))
  const all = checkAllState(values.map((v) => selected.has(v)))
  const toggle = (v: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s)
      if (on) n.add(v)
      else n.delete(v)
      return n
    })
  const actionCols = 2 + (d.userGroupCount > 0 ? 1 : 0) + (d.hasAccountLocking ? 1 : 0)

  const remove = async () => {
    if (!(await confirm({ question: t('Do you really want to revoke the selected user(s) ?') }))) return
    let drop = dropDb
    if (drop) {
      // pma: RevokeUser — a native second confirmation for DROP DATABASE
      const sure = window.confirm(
        `${t('You are about to DESTROY a complete database!')}\n${t('Do you really want to execute "%s"?', 'DROP DATABASE')}`,
      )
      if (!sure) {
        drop = false
        setDropDb(false)
      }
    }
    const box = showMessage(t('Removing Selected Users'))
    try {
      const r = await api.submitPrivileges(server, {
        selected_usr: values.filter((v) => selected.has(v)),
        ...(drop ? { drop_users_db: 'on' } : {}),
        mode: '2',
        delete: t('Go'),
      })
      removeMessage(box)
      if (r.success) {
        showMessage(r.message.text)
        setSelected(new Set())
        if (r.reload) void qc.invalidateQueries({ queryKey: qk.nav(server) })
        refresh()
      } else showMessage(r.message.text, false, 'error')
    } catch (e) {
      removeMessage(box)
      showMessage(errorMessage(e).text, false, 'error')
    }
  }

  const lockToggle = async (u: UserOverviewRow) => {
    const key = selectedUserValue(u.user, u.host)
    const locked = locks[key] ?? u.isAccountLocked
    try {
      const r = await api.lockAccount(server, { username: u.user, hostname: u.host }, !locked)
      setLocks((s) => ({ ...s, [key]: !locked }))
      showMessage(r.message.text)
    } catch (e) {
      showMessage(errorMessage(e).text, false, 'error')
    }
  }

  const flush = async () => {
    try {
      const r = await api.submitPrivileges(server, {}, { flush_privileges: '1' })
      setFlash({ message: r.message, sql: '' })
      refresh()
    } catch (e) {
      setFlash({ message: errorMessage(e), sql: '' })
    }
  }

  return (
    <div className="container-fluid">
      {d.gate.menusWork && <PrivilegesSubnav server={server} isSuperUser={d.gate.isSuperUser} />}
      <GateMessages gate={d.gate} />
      {flash !== null && <PrivMessageBox message={flash.message} sql={flash.sql} />}
      <PageHeader icon={Users}>{t('User accounts overview')}</PageHeader>
      {d.error !== null && <PrivMessageBox message={d.error} />}
      {d.emptyUserNotice && (
        <MessageBox type="notice">
          {t(
            'A user account allowing any user from localhost to connect is present. This will prevent other users from connecting if the host part of their account allows a connection from any (%) host.',
          )}{' '}
          <MySqlDocLink url={d.docs.problemsConnecting} />
        </MessageBox>
      )}
      {d.initials !== null && (
        <nav aria-label={t('Pagination of user accounts')}>
          <ul id="userAccountsPagination" className="pagination mb-3 flex flex-wrap text-[13px]">
            {d.initials.map(({ initial, available }) => (
              <li
                key={initial}
                className={`page-item ${available ? '' : 'disabled'} ${d.selectedInitial === initial ? 'active' : ''}`}
                {...(d.selectedInitial === initial ? { 'aria-current': 'page' as const } : {})}
              >
                {available ? (
                  <Link
                    className={`page-link block border border-border px-2 py-1 ${d.selectedInitial === initial ? 'bg-accent text-accent-fg' : 'text-accent'}`}
                    to={path(`/s/${server}/privileges`)}
                    search={{ initial } as never}
                  >
                    {initial === '' ? <span className="text-error text-nowrap">{t('Any')}</span> : initial}
                  </Link>
                ) : (
                  // biome-ignore lint/a11y/useValidAnchor: initials_row.twig's disabled page link
                  <a
                    className="page-link block border border-border px-2 py-1 text-fg-subtle"
                    href="#"
                    tabIndex={-1}
                    aria-disabled="true"
                    onClick={(e) => e.preventDefault()}
                  >
                    {initial}
                  </a>
                )}
              </li>
            ))}
            <li className="page-item">
              <Link
                className="page-link block border border-border px-2 py-1 text-nowrap text-accent"
                to={path(`/s/${server}/privileges`)}
                search={{ showall: '1' } as never}
              >
                {t('Show all')}
              </Link>
            </li>
          </ul>
        </nav>
      )}
      {d.users !== null ? (
        <form name="usersForm" id="usersForm" onSubmit={(e) => e.preventDefault()}>
          <Table zebra id="userRightsTable" className="w-auto">
            <thead>
              <tr>
                <th />
                <th scope="col">{t('User name')}</th>
                <th scope="col">{t('Host name')}</th>
                <th scope="col">{t('Password')}</th>
                <th scope="col">
                  <span className="inline-flex items-center gap-1">
                    {t('Global privileges')}{' '}
                    <Hint message={t('Note: MySQL privilege names are expressed in English.')} />
                  </span>
                </th>
                {d.gate.menusWork && <th scope="col">{t('User group')}</th>}
                <th scope="col">{t('Grant')}</th>
                <th scope="col" colSpan={actionCols}>
                  {t('Action')}
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((u, i) => {
                const v = selectedUserValue(u.user, u.host)
                const locked = locks[v] ?? u.isAccountLocked
                const edit = {
                  to: path(`/s/${server}/privileges/user`),
                  search: editSearch(u.user, u.host) as never,
                }
                return (
                  <tr key={v}>
                    <td>
                      <input
                        type="checkbox"
                        className="checkall"
                        id={`checkbox_sel_users_${i + 1}`}
                        value={v}
                        name="selected_usr[]"
                        checked={selected.has(v)}
                        onChange={(e) => toggle(v, e.target.checked)}
                      />
                    </td>
                    <td>
                      <label htmlFor={`checkbox_sel_users_${i + 1}`}>
                        {u.user === '' ? (
                          <span className="text-error">{t('Any')}</span>
                        ) : (
                          <Link className="edit_user_anchor text-accent" {...edit}>
                            {u.user}
                          </Link>
                        )}
                      </label>
                    </td>
                    <td>{u.host}</td>
                    <td>
                      {u.hasPassword ? t('Yes') : <span className="text-error">{t('No')}</span>}
                      {!u.hasSelectPriv && (
                        <Hint message={t('The selected user was not found in the privilege table.')} />
                      )}
                    </td>
                    <td>
                      <PrivList items={u.privileges} />
                    </td>
                    {d.gate.menusWork && <td className="usrGroup">{u.group}</td>}
                    <td>{u.hasGrant ? t('Yes') : t('No')}</td>
                    {d.gate.isGrantUser && (
                      <td className="text-center">
                        <Link className="edit_user_anchor text-accent" {...edit}>
                          <IconText icon="b_usredit" text={t('Edit privileges')} />
                        </Link>
                      </td>
                    )}
                    {d.gate.menusWork && d.userGroupCount > 0 && (
                      <td className="text-center">
                        {u.user !== '' && (
                          <Button variant="link" data-username={u.user} onClick={() => setGroupFor(u.user)}>
                            <IconText icon="b_usrlist" text={t('Edit user group')} />
                          </Button>
                        )}
                      </td>
                    )}
                    <td className="text-center">
                      <a
                        className="export_user_anchor ajax text-accent"
                        href={`#export-${v}`}
                        onClick={(e) => {
                          e.preventDefault()
                          void exporter.run({ username: u.user, hostname: u.host })
                        }}
                      >
                        <IconText icon="b_tblexport" text={t('Export')} />
                      </a>
                    </td>
                    {d.hasAccountLocking && (
                      <td>
                        <Button
                          variant="link"
                          className="jsAccountLocking"
                          title={locked ? t('Unlock this account.') : t('Lock this account.')}
                          data-is-locked={locked ? 'true' : 'false'}
                          data-user-name={u.user}
                          data-host-name={u.host}
                          onClick={() => void lockToggle(u)}
                        >
                          {locked ? (
                            <IconText icon="s_unlock" text={pgettext('Unlock the account.', 'Unlock')} />
                          ) : (
                            <IconText icon="s_lock" text={pgettext('Lock the account.', 'Lock')} />
                          )}
                        </Button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </Table>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
            <PmaIcon name="select_all_arrow" alt={t('With selected:')} />
            <input
              type="checkbox"
              id="usersForm_checkall"
              className="checkall_box"
              title={t('Check all')}
              checked={all.checked}
              ref={(el) => {
                if (el !== null) el.indeterminate = all.indeterminate
              }}
              onChange={(e) => setSelected(e.target.checked ? new Set(values) : new Set())}
            />
            <label htmlFor="usersForm_checkall">{t('Check all')}</label>
            <em className="with-selected">{t('With selected:')}</em>
            <Button
              variant="link"
              className="mult_submit"
              name="submit_mult"
              value="export"
              title={t('Export')}
              onClick={() => {
                const sel = values.filter((v) => selected.has(v))
                if (sel.length === 0) {
                  showMessage(t('No accounts selected.'), 2000, 'success')
                  return
                }
                void exporter.run({ selected_usr: sel })
              }}
            >
              <IconText icon="b_tblexport" text={t('Export')} />
            </Button>
          </div>
          {d.gate.isCreateUser && <AddUserCard server={server} />}
          <Panel
            id="deleteUserCard"
            title={<IconText icon="b_usrdrop" text={t('Remove selected user accounts')} />}
            footer={
              <div className="text-end">
                <input
                  id="buttonGo"
                  className={`${buttonVariants({ variant: 'primary' })} ajax`}
                  type="submit"
                  name="delete"
                  value={t('Go')}
                  onClick={() => void remove()}
                />
              </div>
            }
          >
            <PanelBody>
              <p className="mb-2">
                {t('Revoke all active privileges from the users and delete them afterwards.')}
              </p>
              <div className="form-check">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="dropUsersDbCheckbox"
                  name="drop_users_db"
                  checked={dropDb}
                  onChange={(e) => setDropDb(e.target.checked)}
                />{' '}
                <label className="form-check-label" htmlFor="dropUsersDbCheckbox">
                  {t('Drop the databases that have the same names as the users.')}
                </label>
              </div>
            </PanelBody>
          </Panel>
        </form>
      ) : (
        d.gate.isCreateUser && <AddUserCard server={server} />
      )}
      {d.flushNote !== null && (
        <MessageBox type="notice">
          {d.flushNote === 'reload' ? (
            <FlushNote onFlush={() => void flush()} />
          ) : (
            <>
              {tProduct(
                "Note: phpMyAdmin gets the users’ privileges directly from MySQL’s privilege tables. The content of these tables may differ from the privileges the server uses, if they have been changed manually. In this case, the privileges have to be reloaded but currently, you don't have the RELOAD privilege.",
              )}{' '}
              <MySqlDocLink url={d.docs.privReload} />
            </>
          )}
        </MessageBox>
      )}
      {exporter.modal}
      {groupFor !== null && (
        <EditUserGroupModal
          server={server}
          username={groupFor}
          onClose={() => setGroupFor(null)}
          onSaved={() => {
            setGroupFor(null)
            refresh()
          }}
        />
      )}
    </div>
  )
}

/** The "%sreload the privileges%s" link of the flush note. */
function FlushNote({ onFlush }: { onFlush: () => void }) {
  const text = tProduct(
    'Note: phpMyAdmin gets the users’ privileges directly from MySQL’s privilege tables. The content of these tables may differ from the privileges the server uses, if they have been changed manually. In this case, you should %sreload the privileges%s before you continue.',
  )
  const [before = '', link = '', after = ''] = text.split('%s')
  return (
    <>
      {before}
      <Button
        variant="link"
        id="reload_privileges_anchor"
        className="text-accent"
        onClick={(e) => {
          e.preventDefault()
          onFlush()
        }}
      >
        {link}
      </Button>
      {after}
    </>
  )
}

/** add_user_fieldset.twig (`#fieldset_add_user`) */
export function AddUserCard({ server, search = {} }: { server: number; search?: Record<string, string> }) {
  return (
    <Panel title={pgettext('Create new user', 'New')}>
      <PanelBody id="fieldset_add_user">
        <Link
          id="add_user_anchor"
          className="text-accent"
          to={path(`/s/${server}/privileges/add-user`)}
          search={search as never}
        >
          <IconText icon="b_usradd" text={t('Add user account')} />
        </Link>
      </PanelBody>
    </Panel>
  )
}

/**
 * `#editUserGroupModal`: the user-group select loaded from /server/user-groups/edit-form, saved
 * with `changeUserGroup=1`.
 * pma: templates/server/privileges/choose_user_group.twig, resources/js/server/privileges.ts::EditUserGroup
 */
function EditUserGroupModal(props: {
  server: number
  username: string
  onClose: () => void
  onSaved: () => void
}) {
  const form = useQuery({
    queryKey: qk.chooseUserGroup(props.server, props.username),
    queryFn: () => api.chooseUserGroup(props.server, props.username),
    staleTime: 0,
  })
  const ref = useRef<HTMLSelectElement>(null)
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    try {
      const r = await api.submitPrivileges(props.server, {
        username: props.username,
        changeUserGroup: '1',
        userGroup: ref.current?.value ?? '',
      })
      if (!r.success) setError(r.message.text)
      else props.onSaved()
    } catch (e) {
      setError(errorMessage(e).text)
    }
  }
  const f = form.data
  return (
    <Modal
      id="editUserGroupModal"
      open
      onClose={props.onClose}
      title={t('Edit user group')}
      footer={
        <>
          <Button onClick={props.onClose}>{t('Close')}</Button>
          <Button variant="primary" id="editUserGroupModalSaveButton" onClick={() => void save()}>
            {t('Save changes')}
          </Button>
        </>
      }
    >
      {error !== null && <MessageBox type="error" text={error} />}
      {form.error !== null && <MessageBox {...errorMessage(form.error)} />}
      {f === undefined ? (
        <Loading />
      ) : (
        <form id="changeUserGroupForm" onSubmit={(e) => e.preventDefault()}>
          <label className="form-label mb-1 block" htmlFor="userGroupSelect">
            {t('User group:')}
          </label>
          <NativeSelect name="userGroup" id="userGroupSelect" ref={ref} defaultValue={f.userGroup ?? ''}>
            <option value="" />
            {f.userGroups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </NativeSelect>
        </form>
      )}
    </Modal>
  )
}
