import type { UserGroupForm } from '@bettermyadmin/contracts'
import {
  Button,
  IconText,
  Input,
  Loading,
  MessageBox,
  Modal,
  PageHeader,
  Panel,
  PanelBody,
  Table,
  buttonVariants,
} from '@bettermyadmin/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { api, errorMessage } from '../../../lib/api'
import { t } from '../../../lib/i18n'
import { path } from '../../../lib/paths'
import { qk } from '../../../lib/queryKeys'
import { checkAllState, formToPhp } from './privileges.ts'
import { PrivilegesSubnav } from './shared.tsx'

export interface UserGroupsSearch {
  /** `?addUserGroup=1` */
  addUserGroup?: string | undefined
  /** editUserGroup=1&userGroup= */
  editUserGroup?: string | undefined
  /** viewUsers=1&userGroup= */
  viewUsers?: string | undefined
}

/**
 * Server → User accounts → User groups: the groups with their allowed tabs, View users, Edit,
 * Delete (modal), Add user group; the add/edit form of the menu assignments.
 * pma: templates/server/user_groups/*.twig, src/ConfigStorage/UserGroups.php,
 *      resources/js/server/user_groups.ts
 */
export function UserGroupsPage({ server, search }: { server: number; search: UserGroupsSearch }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const list = useQuery({ queryKey: qk.userGroups(server), queryFn: () => api.userGroups(server) })
  const [remove, setRemove] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = () => void qc.invalidateQueries({ queryKey: qk.privileges(server) })
  const d = list.data
  if (list.error !== null) return <MessageBox {...errorMessage(list.error)} />
  if (d === undefined) return <Loading />
  if (!d.gate.enabled) return null
  if (!d.gate.isSuperUser) return <MessageBox type="error" text={t('No Privileges')} />
  const editing = search.addUserGroup !== undefined ? null : (search.editUserGroup ?? undefined)
  const base = path(`/s/${server}/user-groups`)
  return (
    <div className="container-fluid">
      <PrivilegesSubnav server={server} isSuperUser />
      {error !== null && <MessageBox type="error" text={error} />}
      {search.viewUsers !== undefined && <GroupUsers server={server} userGroup={search.viewUsers} />}
      {editing !== undefined ? (
        <GroupEditor
          server={server}
          userGroup={editing}
          onSaved={() => {
            refresh()
            void navigate({ to: base })
          }}
        />
      ) : (
        <>
          <div className="row">
            <h2 className="mb-2 text-base font-semibold">{t('User groups')}</h2>
          </div>
          {d.groups.length > 0 && (
            <form name="userGroupsForm" id="userGroupsForm" onSubmit={(e) => e.preventDefault()}>
              <Table zebra>
                <thead>
                  <tr className="text-nowrap">
                    <th scope="col">{t('User groups')}</th>
                    <th scope="col">{t('Server level tabs')}</th>
                    <th scope="col">{t('Database level tabs')}</th>
                    <th scope="col">{t('Table level tabs')}</th>
                    <th scope="col">{t('Action')}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.groups.map((g) => (
                    <tr key={g.name}>
                      <td>{g.name}</td>
                      <td>{g.serverTabs}</td>
                      <td>{g.dbTabs}</td>
                      <td>{g.tableTabs}</td>
                      <td className="text-nowrap">
                        <Link className="text-accent" to={base} search={{ viewUsers: g.name } as never}>
                          <IconText icon="b_usrlist" text={t('View users')} />
                        </Link>
                        &nbsp;&nbsp;
                        <Link className="text-accent" to={base} search={{ editUserGroup: g.name } as never}>
                          <IconText icon="b_edit" text={t('Edit')} />
                        </Link>
                        <Button
                          variant="link"
                          className="ms-2"
                          data-user-group={g.name}
                          onClick={() => setRemove(g.name)}
                        >
                          <IconText icon="b_drop" text={t('Delete')} />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </form>
          )}
          <div>
            <Link
              className={buttonVariants({ variant: 'primary' })}
              to={base}
              search={{ addUserGroup: '1' } as never}
            >
              <IconText icon="b_usradd" text={t('Add user group')} forceText />
            </Link>
          </div>
        </>
      )}
      <Modal
        id="deleteUserGroupModal"
        open={remove !== null}
        onClose={() => setRemove(null)}
        title={t('Delete user group')}
        size="sm"
        footer={
          <>
            <Button onClick={() => setRemove(null)}>{t('Close')}</Button>
            <Button
              variant="destructive"
              id="deleteUserGroupConfirm"
              onClick={async () => {
                const g = remove
                setRemove(null)
                if (g === null) return
                try {
                  await api.submitUserGroups(server, { deleteUserGroup: 'true', userGroup: g })
                  refresh()
                } catch (e) {
                  setError(errorMessage(e).text)
                }
              }}
            >
              {t('Delete')}
            </Button>
          </>
        }
      >
        {t('Do you really want to delete user group "%s"?', remove ?? '')}
      </Modal>
    </div>
  )
}

/** user_listings.twig */
function GroupUsers({ server, userGroup }: { server: number; userGroup: string }) {
  const q = useQuery({
    queryKey: qk.userGroupUsers(server, userGroup),
    queryFn: () => api.userGroupUsers(server, userGroup),
  })
  if (q.error !== null) return <MessageBox {...errorMessage(q.error)} />
  if (q.data === undefined) return <Loading />
  return (
    <div className="mb-3">
      <h2 className="mb-2 text-base font-semibold">{t("Users of '%s' user group", userGroup)}</h2>
      {q.data.users.length === 0 ? (
        <p>{t('No users were found belonging to this user group.')}</p>
      ) : (
        <Table zebra className="w-auto">
          <thead>
            <tr>
              <th>#</th>
              <th>{t('User')}</th>
            </tr>
          </thead>
          <tbody>
            {q.data.users.map((u, i) => (
              <tr key={u}>
                <td>{i + 1}</td>
                <td>{u}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  )
}

/** edit_user_groups.twig + tab_list.twig */
function GroupEditor(props: { server: number; userGroup: string | null; onSaved: () => void }) {
  const form = useQuery({
    queryKey: qk.userGroupForm(props.server, props.userGroup),
    queryFn: () => api.userGroupForm(props.server, props.userGroup),
    staleTime: 0,
  })
  const f = form.data
  if (form.error !== null) return <MessageBox {...errorMessage(form.error)} />
  if (f === undefined) return <Loading />
  return (
    <GroupEditorForm key={props.userGroup ?? ''} server={props.server} form={f} onSaved={props.onSaved} />
  )
}

function GroupEditorForm(props: { server: number; form: UserGroupForm; onSaved: () => void }) {
  const f = props.form
  const [state, setState] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(f.levels.flatMap((l) => l.tabs.map((tab) => [`${l.level}_${tab.tab}`, tab.allowed]))),
  )
  const [error, setError] = useState<string | null>(null)
  const all = checkAllState(Object.values(state))
  return (
    <div className="container">
      <PageHeader>
        {f.userGroup === null ? t('Add user group') : t("Edit user group: '%s'", f.userGroup)}
      </PageHeader>
      {error !== null && <MessageBox type="error" text={error} />}
      <form
        className="disableAjax"
        onSubmit={async (e) => {
          e.preventDefault()
          const body = formToPhp(new FormData(e.currentTarget).entries())
          try {
            await api.submitUserGroups(props.server, {
              ...body,
              ...(f.userGroup === null
                ? { addUserGroupSubmit: '1' }
                : { userGroup: f.userGroup, editUserGroupSubmit: '1' }),
            })
            props.onSaved()
          } catch (err) {
            setError(errorMessage(err).text)
          }
        }}
      >
        <Panel
          title={t('User group menu assignments')}
          footer={
            <input
              className={buttonVariants({ variant: 'primary' })}
              type="submit"
              value={f.userGroup === null ? t('Add user group') : t('Edit user group')}
            />
          }
        >
          <PanelBody>
            {f.userGroup === null && (
              <div className="mb-3">
                <label className="form-label mb-1 block" htmlFor="userGroup">
                  {t('Group name:')}
                </label>
                <Input
                  type="text"
                  name="userGroup"
                  id="userGroup"
                  maxLength={64}
                  autoComplete="off"
                  required
                  className="max-w-80"
                />
              </div>
            )}
            <div className="form-check mb-3">
              <input
                className="form-check-input checkall_box"
                type="checkbox"
                id="addUsersForm_checkall"
                title={t('Check all')}
                checked={all.checked}
                ref={(el) => {
                  if (el !== null) el.indeterminate = all.indeterminate
                }}
                onChange={(e) =>
                  setState((s) => Object.fromEntries(Object.keys(s).map((k) => [k, e.target.checked])))
                }
              />{' '}
              <label className="form-check-label" htmlFor="addUsersForm_checkall">
                {t('Check all')}
              </label>
            </div>
            <div className="flex flex-wrap gap-6">
              {f.levels.map((l) => (
                <fieldset className="mb-3" key={l.level}>
                  <legend className="mb-1 font-semibold">{l.title}</legend>
                  {l.tabs.map((tab) => {
                    const name = `${l.level}_${tab.tab}`
                    return (
                      <div className="form-check" key={name}>
                        <input
                          className="form-check-input checkall"
                          type="checkbox"
                          name={name}
                          id={name}
                          value="Y"
                          checked={state[name] === true}
                          onChange={(e) => setState((s) => ({ ...s, [name]: e.target.checked }))}
                        />{' '}
                        <label className="form-check-label" htmlFor={name}>
                          {tab.name}
                        </label>
                      </div>
                    )
                  })}
                </fieldset>
              ))}
            </div>
          </PanelBody>
        </Panel>
      </form>
    </div>
  )
}
