import type { PrivMessage } from '@bettermyadmin/contracts'
import { Loading, MessageBox, PageHeader, Panel, PanelBody, buttonVariants } from '@bettermyadmin/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { UserPlus } from 'lucide-react'
import { useState } from 'react'
import { api, errorMessage } from '../../../lib/api'
import { t } from '../../../lib/i18n'
import { path } from '../../../lib/paths'
import { qk } from '../../../lib/queryKeys'
import { LoginInformationFields } from './LoginInformationFields.tsx'
import { PrivilegesTableFields } from './PrivilegesTableFields.tsx'
import { setFlash } from './flash.ts'
import { checkAddUser, editSearch, formToPhp } from './privileges.ts'
import { GateMessages, PrivMessageBox, PrivilegesSubnav } from './shared.tsx'

export interface AddUserSearch {
  dbname?: string | undefined
  tablename?: string | undefined
}

const str = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : undefined)

/**
 * Add user account: login information, "Database for user account", the global privileges table;
 * "Create user" posts `adduser_submit=1`, then the new account's editor opens with the message.
 * pma: templates/server/privileges/add_user.twig, Privileges::getHtmlForAddUser,
 *      resources/js/server/privileges.ts::CheckAddUser
 */
export function AddUserPage({ server, search }: { server: number; search: AddUserSearch }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const query = {
    ...(search.dbname !== undefined ? { dbname: search.dbname } : {}),
    ...(search.tablename !== undefined ? { tablename: search.tablename } : {}),
  }
  const form = useQuery({
    queryKey: qk.addUserForm(server, query),
    queryFn: () => api.addUserForm(server, query),
  })
  const [result, setResult] = useState<{ message: PrivMessage; sql: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const f = form.data
  if (form.error !== null) return <MessageBox {...errorMessage(form.error)} />
  if (f === undefined) return <Loading />
  if (f.gate.noPrivileges) return <GateMessages gate={f.gate} />

  const submit = async (el: HTMLFormElement) => {
    const fd = new FormData(el)
    const invalid = checkAddUser({
      hostname: str(fd.get('hostname')) ?? '',
      predUsername: str(fd.get('pred_username')) ?? '',
      username: str(fd.get('username')) ?? '',
      predPassword: str(fd.get('pred_password')) ?? '',
      password: str(fd.get('pma_pw')) ?? '',
      password2: str(fd.get('pma_pw2')) ?? '',
    })
    if (invalid !== null) {
      window.alert(t(invalid))
      return
    }
    setBusy(true)
    try {
      const r = await api.submitPrivileges(server, formToPhp(fd.entries()))
      void qc.invalidateQueries({ queryKey: qk.privileges(server) })
      if (r.reload) void qc.invalidateQueries({ queryKey: qk.nav(server) })
      if (r.addUserError || r.account === null) {
        setResult({ message: r.message, sql: r.sql })
        return
      }
      setFlash({ message: r.message, sql: r.sql })
      void navigate({
        to: path(`/s/${server}/privileges/user`),
        search: editSearch(r.account.username, r.account.hostname) as never,
      })
    } catch (e) {
      setResult({ message: errorMessage(e), sql: '' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container">
      {f.gate.menusWork && <PrivilegesSubnav server={server} isSuperUser={f.gate.isSuperUser} />}
      <GateMessages gate={f.gate} />
      {result !== null && <PrivMessageBox message={result.message} sql={result.sql} />}
      <PageHeader icon={UserPlus}>{t('Add user account')}</PageHeader>
      <form
        name="usersForm"
        id="addUsersForm"
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault()
          void submit(e.currentTarget)
        }}
      >
        <LoginInformationFields server={server} login={f.login} />
        <Panel title={t('Database for user account')}>
          <PanelBody>
            <div>
              <input type="checkbox" name="createdb-1" id="createdb-1" />{' '}
              <label htmlFor="createdb-1">
                {t('Create database with same name and grant all privileges.')}
              </label>
            </div>
            <div>
              <input type="checkbox" name="createdb-2" id="createdb-2" />{' '}
              <label htmlFor="createdb-2">{t('Grant all privileges on wildcard name (username\\_%).')}</label>
            </div>
            {f.database !== '' && (
              <div>
                <input type="checkbox" name="createdb-3" id="createdb-3" defaultChecked />{' '}
                <label htmlFor="createdb-3">{t('Grant all privileges on database %s.', f.database)}</label>
                <input type="hidden" name="dbname" value={f.database} />
              </div>
            )}
          </PanelBody>
        </Panel>
        {f.isGrantUser && f.privilegesTable !== null && <PrivilegesTableFields table={f.privilegesTable} />}
        <div className="mb-3">
          <input type="hidden" name="adduser_submit" value="1" />
          <input
            className={buttonVariants({ variant: 'primary' })}
            type="submit"
            id="adduser_submit"
            value={t('Create user')}
            disabled={busy}
          />
        </div>
      </form>
    </div>
  )
}
