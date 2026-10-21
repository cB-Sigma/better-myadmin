import {
  Button,
  IconText,
  Loading,
  MessageBox,
  PageHeader,
  Panel,
  PanelBody,
  PmaIcon,
  Table,
  buttonVariants,
  showMessage,
} from '@bettermyadmin/ui'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { UserCheck } from 'lucide-react'
import { Fragment, useState } from 'react'
import { api, errorMessage } from '../../../lib/api'
import { Trans, t } from '../../../lib/i18n'
import { path } from '../../../lib/paths'
import { qk } from '../../../lib/queryKeys'
import { checkAllState, selectedUserValue } from './privileges.ts'
import { GateMessages, PrivList, useExportPrivileges } from './shared.tsx'

/**
 * Database → Privileges and Table → Privileges (with `table`), the users of a database or a table:
 * every account with access to it (global, database, wildcard, table and routine privileges),
 * Edit / Export per account, Export of a selection, Add user account.
 * pma: templates/database/privileges/index.twig, templates/table/privileges/index.twig,
 *      src/Controllers/Database/PrivilegesController.php, src/Controllers/Table/PrivilegesController.php
 */
export function DbPrivilegesPage({ server, db, table }: { server: number; db: string; table?: string }) {
  const q = useQuery({
    queryKey:
      table === undefined ? qk.dbPrivileges({ server, db }) : qk.tablePrivileges({ server, db, table }),
    queryFn: () =>
      table === undefined ? api.dbPrivileges({ server, db }) : api.tablePrivileges({ server, db, table }),
  })
  const exporter = useExportPrivileges(server)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const d = q.data
  if (q.error !== null) return <MessageBox {...errorMessage(q.error)} />
  if (d === undefined) return <Loading />
  if (d.gate.noPrivileges) return <GateMessages gate={d.gate} />
  const values = d.accounts.map((a) => selectedUserValue(a.user, a.host))
  const all = checkAllState(values.map((v) => selected.has(v)))
  const escapedDb = d.db.replace(/[_%]/g, (c) => `\\${c}`)
  const dbLink = `/s/${server}/db/${encodeURIComponent(d.db)}`
  const objectLink = path(d.table === undefined ? dbLink : `${dbLink}/t/${encodeURIComponent(d.table)}`)
  return (
    <div className="container">
      <GateMessages gate={d.gate} />
      {d.gate.isSuperUser ? (
        <>
          <PageHeader icon={UserCheck}>
            <span>
              <Trans
                id={'Users having access to "%s"'}
                args={[
                  <Link key="t" className="text-accent" to={objectLink}>
                    {d.table === undefined ? d.db : `${d.db}.${d.table}`}
                  </Link>,
                ]}
              />
            </span>
          </PageHeader>
          <form id="usersForm" onSubmit={(e) => e.preventDefault()}>
            <Panel>
              <PanelBody>
                <Table zebra className="w-auto">
                  <thead>
                    <tr>
                      <th />
                      <th>{t('User name')}</th>
                      <th>{t('Host name')}</th>
                      <th>{t('Type')}</th>
                      <th>{t('Privileges')}</th>
                      <th>{t('Grant')}</th>
                      <th colSpan={2}>{t('Action')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.accounts.length === 0 && (
                      <tr>
                        <td colSpan={7}>{t('No user found.')}</td>
                      </tr>
                    )}
                    {d.accounts.map((a, i) => {
                      const v = selectedUserValue(a.user, a.host)
                      const span =
                        a.privileges.length > 1
                          ? { rowSpan: a.privileges.length, className: 'align-middle' }
                          : {}
                      return (
                        <Fragment key={v}>
                          {a.privileges.map((p, j) => (
                            <tr
                              key={`${v}-${p.type}-${p.database}-${p.table}-${p.routine}`}
                              className={j > 0 ? 'noclick' : undefined}
                            >
                              {j === 0 && (
                                <>
                                  <td {...span}>
                                    <input
                                      type="checkbox"
                                      className="checkall"
                                      name="selected_usr[]"
                                      id={`checkbox_sel_users_${i}`}
                                      aria-label={a.user}
                                      value={v}
                                      checked={selected.has(v)}
                                      onChange={(e) =>
                                        setSelected((s) => {
                                          const n = new Set(s)
                                          if (e.target.checked) n.add(v)
                                          else n.delete(v)
                                          return n
                                        })
                                      }
                                    />
                                  </td>
                                  <td {...span}>
                                    {a.user === '' ? <span className="text-error">{t('Any')}</span> : a.user}
                                  </td>
                                  <td {...span}>{a.host}</td>
                                </>
                              )}
                              <td>
                                {p.type === 'g' ? (
                                  t('global')
                                ) : p.type === 'd' ? (
                                  p.database === escapedDb ? (
                                    t('database-specific')
                                  ) : (
                                    <>
                                      {t('wildcard')}: <code>{p.database}</code>
                                    </>
                                  )
                                ) : p.type === 't' ? (
                                  t('table-specific')
                                ) : (
                                  t('routine')
                                )}
                              </td>
                              <td>
                                {p.type === 'r' ? (
                                  <code>
                                    {p.routine} ({p.privileges.map((x) => x.name.toUpperCase()).join(', ')})
                                  </code>
                                ) : (
                                  <PrivList items={p.privileges} />
                                )}
                              </td>
                              <td>{p.hasGrant ? t('Yes') : t('No')}</td>
                              <td>
                                {d.gate.isGrantUser && (
                                  <Link
                                    className="edit_user_anchor text-accent"
                                    to={path(`/s/${server}/privileges/user`)}
                                    // pma: url('/server/privileges', {username, hostname, dbname, tablename,
                                    // routinename}): every key, empty ones included
                                    search={
                                      {
                                        username: a.user,
                                        hostname: a.host,
                                        dbname: p.database !== '*' ? p.database : d.db,
                                        tablename:
                                          p.table !== null && p.table !== '*' ? p.table : (d.table ?? ''),
                                        routinename: p.routine ?? '',
                                      } as never
                                    }
                                  >
                                    <IconText icon="b_usredit" text={t('Edit privileges')} />
                                  </Link>
                                )}
                              </td>
                              <td className="text-center">
                                <a
                                  className="export_user_anchor ajax text-accent"
                                  href={`#export-${v}`}
                                  onClick={(e) => {
                                    e.preventDefault()
                                    void exporter.run({ username: a.user, hostname: a.host })
                                  }}
                                >
                                  <IconText icon="b_tblexport" text={t('Export')} />
                                </a>
                              </td>
                            </tr>
                          ))}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </Table>
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <PmaIcon name="select_all_arrow" alt={t('With selected:')} />
                  <input
                    type="checkbox"
                    id="usersForm_checkall"
                    className="checkall_box"
                    title={t('Check all')}
                    checked={all.checked}
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
                      if (sel.length === 0) showMessage(t('No accounts selected.'), 2000, 'success')
                      else void exporter.run({ selected_usr: sel })
                    }}
                  >
                    <IconText icon="b_tblexport" text={t('Export')} />
                  </Button>
                </div>
              </PanelBody>
            </Panel>
          </form>
        </>
      ) : (
        <MessageBox type="error" text={t('Not enough privilege to view users.')} />
      )}
      {d.gate.isCreateUser && (
        <div>
          <Link
            className={buttonVariants({ variant: 'primary' })}
            id="add_user_anchor"
            to={path(`/s/${server}/privileges/add-user`)}
            search={
              (d.table === undefined ? { dbname: d.db } : { dbname: d.db, tablename: d.table }) as never
            }
          >
            <IconText icon="b_usradd" text={t('Add user account')} forceText />
          </Link>
        </div>
      )}
      {exporter.modal}
    </div>
  )
}
