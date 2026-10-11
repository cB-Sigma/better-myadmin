import { Alert, Checkbox, IconText, Label, buttonVariants } from '@bettermyadmin/ui'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Fragment, useState } from 'react'
import { api } from '../../lib/api'
import { t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'
import { path, Messages, dbBase, enc, errorMessage, tableBase } from './common'

/**
 * Database → Privileges and Table → Privileges (with `table`): the accounts with access to the
 * database or the table (read-only; editing goes to the server privileges pages).
 * pma: templates/database/privileges/index.twig, templates/table/privileges/index.twig
 */
export function DbPrivilegesPage({ server, db, table }: { server: number; db: string; table?: string }) {
  const q = useQuery({
    queryKey:
      table === undefined
        ? qk.dbPage({ server, db }, 'privileges')
        : qk.tblPage({ server, db, table }, 'privileges'),
    queryFn: () =>
      table === undefined ? api.dbPrivileges({ server, db }) : api.tablePrivileges({ server, db, table }),
  })
  const [selected, setSelected] = useState<string[]>([])
  if (q.isError) return <Messages messages={[errorMessage(q.error)]} />
  const d = q.data
  if (d === undefined) return null
  if (d.error !== null) return <Messages messages={[{ type: 'error', text: d.error }]} />
  const usersBase = `/s/${server}/privileges`
  const editUrl = (user: string, host: string, dbname: string, tablename: string, routine: string | null) =>
    `${usersBase}?username=${enc(user)}&hostname=${enc(host)}&dbname=${enc(dbname)}&tablename=${enc(tablename)}&routinename=${enc(routine ?? '')}`
  const escapedDb = db.replaceAll('_', '\\_').replaceAll('%', '\\%')
  const keys = d.accounts.map((a) => `${a.user}\u001b${a.host}`)
  return (
    <div className="container my-3">
      {d.notice !== null && <Messages messages={[{ type: 'notice', text: d.notice }]} />}
      {d.isSuperUser ? (
        <>
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
            <IconText icon="b_usrcheck" text="" />
            <span>
              {t('Users having access to "%s"').split('%s')[0]}
              {table === undefined ? (
                <Link to={path(dbBase(server, db))}>{db}</Link>
              ) : (
                <Link to={path(tableBase(server, db, table))}>{`${db}.${table}`}</Link>
              )}
              {t('Users having access to "%s"').split('%s')[1]}
            </span>
          </h2>
          <form id="usersForm" className="mb-3 rounded-(--radius) border border-border p-3">
            <table className="w-auto border-collapse text-sm [&_td]:px-2 [&_td]:py-1 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left">
              <thead>
                <tr className="bg-grid-header">
                  <th />
                  <th scope="col">{t('User name')}</th>
                  <th scope="col">{t('Host name')}</th>
                  <th scope="col">{t('Type')}</th>
                  <th scope="col">{t('Privileges')}</th>
                  <th scope="col">{t('Grant')}</th>
                  <th scope="col" colSpan={2}>
                    {t('Action')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.accounts.length === 0 && (
                  <tr>
                    <td colSpan={7}>{t('No user found.')}</td>
                  </tr>
                )}
                {d.accounts.map((a, ai) => {
                  const n = a.privileges.length
                  const key = keys[ai] ?? ''
                  return a.privileges.map((p, i) => (
                    <tr
                      key={`${key}-${p.type}-${p.database}-${p.table ?? ''}-${p.routine ?? ''}`}
                      className={i > 0 ? 'noclick' : 'odd:bg-grid-odd even:bg-grid-even'}
                    >
                      {i === 0 && (
                        <>
                          <td rowSpan={n} className={n > 1 ? 'align-middle' : ''}>
                            <Checkbox
                              className="checkall"
                              id={`checkbox_sel_users_${ai}`}
                              checked={selected.includes(key)}
                              onCheckedChange={(v) =>
                                setSelected(
                                  v === true ? [...selected, key] : selected.filter((x) => x !== key),
                                )
                              }
                            />
                          </td>
                          <td rowSpan={n} className={n > 1 ? 'align-middle' : ''}>
                            {a.user === '' ? <span className="text-error">{t('Any')}</span> : a.user}
                          </td>
                          <td rowSpan={n} className={n > 1 ? 'align-middle' : ''}>
                            {a.host}
                          </td>
                        </>
                      )}
                      <td>
                        {p.type === 'g' && t('global')}
                        {p.type === 'd' &&
                          (p.database === escapedDb ? (
                            t('database-specific')
                          ) : (
                            <>
                              {t('wildcard')}: <code>{p.database}</code>
                            </>
                          ))}
                        {p.type === 't' && t('table-specific')}
                        {p.type === 'r' && t('routine')}
                      </td>
                      <td>
                        <code>
                          {p.type === 'r'
                            ? `${p.routine ?? ''} (${p.privileges.map((x) => x.name).join(', ')})`
                            : p.privileges.map((x, xi) => (
                                <Fragment key={x.name}>
                                  {xi > 0 && ', '}
                                  <dfn title={x.title}>{x.name}</dfn>
                                </Fragment>
                              ))}
                        </code>
                      </td>
                      <td>{p.hasGrant ? t('Yes') : t('No')}</td>
                      <td>
                        {d.isGrantUser && (
                          <Link
                            className="edit_user_anchor"
                            to={path(
                              editUrl(
                                a.user,
                                a.host,
                                p.database !== '*' ? p.database : db,
                                p.table !== undefined && p.table !== '*' ? p.table : (table ?? ''),
                                p.routine,
                              ),
                            )}
                          >
                            <IconText icon="b_usredit" text={t('Edit privileges')} />
                          </Link>
                        )}
                      </td>
                      <td className="text-center">
                        <Link
                          className="export_user_anchor"
                          to={path(`${usersBase}?username=${enc(a.user)}&hostname=${enc(a.host)}&export=1`)}
                        >
                          <IconText icon="b_tblexport" text={t('Export')} />
                        </Link>
                      </td>
                    </tr>
                  ))
                })}
              </tbody>
            </table>
            <div className="mt-2 flex items-center gap-2 text-sm">
              <Label className="flex items-center gap-2">
                <Checkbox
                  id="usersForm_checkall"
                  className="checkall_box"
                  title={t('Check all')}
                  checked={keys.length > 0 && selected.length === keys.length}
                  onCheckedChange={(v) => setSelected(v === true ? keys : [])}
                />
                {t('Check all')}
              </Label>
              <em className="with-selected">{t('With selected:')}</em>
              <Link
                className="mult_submit"
                title={t('Export')}
                to={path(
                  `${usersBase}?export=1&${selected.map((s) => `selected_usr[]=${enc(s.replace('\u001b', '&#27;'))}`).join('&')}`,
                )}
              >
                <IconText icon="b_tblexport" text={t('Export')} />
              </Link>
            </div>
          </form>
        </>
      ) : (
        <Alert variant="error">{t('Not enough privilege to view users.')}</Alert>
      )}
      {d.isCreateUser && (
        <div>
          <Link
            className={buttonVariants({ variant: 'primary' })}
            id="add_user_anchor"
            to={path(
              `${usersBase}?adduser=1&dbname=${enc(db)}${table === undefined ? '' : `&tablename=${enc(table)}`}`,
            )}
          >
            <IconText icon="b_usradd" text={t('Add user account')} />
          </Link>
        </div>
      )}
    </div>
  )
}
