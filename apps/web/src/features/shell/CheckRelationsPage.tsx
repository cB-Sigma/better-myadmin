import type { RelationParametersArray, StorageAction, UiMessage } from '@bettermyadmin/contracts'
import { Button, DocLink, Loading, MessageBox, SafeHtml, Table } from '@bettermyadmin/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { pgettext, t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'

type Rp = RelationParametersArray

/**
 * The rows of check_relations.twig: each `$cfg['Servers'][$i][<directive>]` (with the
 * relationParameters key holding its table) followed by the feature lines it enables.
 */
const GROUPS: Array<{
  rows: Array<{ directive: string; key: keyof Rp }>
  features: Array<{ flag: keyof Rp; label: string }>
  /** commwork without mimework: the column_info upgrade hint */
  columnInfoHint?: true
}> = [
  {
    rows: [{ directive: 'relation', key: 'relation' }],
    features: [{ flag: 'relwork', label: 'General relation features:' }],
  },
  {
    rows: [{ directive: 'table_info', key: 'table_info' }],
    features: [{ flag: 'displaywork', label: 'Display features:' }],
  },
  {
    rows: [
      { directive: 'table_coords', key: 'table_coords' },
      { directive: 'pdf_pages', key: 'pdf_pages' },
    ],
    features: [{ flag: 'pdfwork', label: 'Designer and creation of PDFs:' }],
  },
  {
    rows: [{ directive: 'column_info', key: 'column_info' }],
    features: [
      { flag: 'commwork', label: 'Displaying column comments:' },
      { flag: 'mimework', label: 'Browser transformation:' },
    ],
    columnInfoHint: true,
  },
  {
    rows: [{ directive: 'bookmarktable', key: 'bookmark' }],
    features: [{ flag: 'bookmarkwork', label: 'Bookmarked SQL query:' }],
  },
  {
    rows: [{ directive: 'history', key: 'history' }],
    features: [{ flag: 'historywork', label: 'SQL history:' }],
  },
  {
    rows: [{ directive: 'recent', key: 'recent' }],
    features: [{ flag: 'recentwork', label: 'Persistent recently used tables:' }],
  },
  {
    rows: [{ directive: 'favorite', key: 'favorite' }],
    features: [{ flag: 'favoritework', label: 'Persistent favorite tables:' }],
  },
  {
    rows: [{ directive: 'table_uiprefs', key: 'table_uiprefs' }],
    features: [{ flag: 'uiprefswork', label: "Persistent tables' UI preferences:" }],
  },
  {
    rows: [{ directive: 'tracking', key: 'tracking' }],
    features: [{ flag: 'trackingwork', label: 'Tracking:' }],
  },
  {
    rows: [{ directive: 'userconfig', key: 'userconfig' }],
    features: [{ flag: 'userconfigwork', label: 'User preferences:' }],
  },
  {
    rows: [
      { directive: 'users', key: 'users' },
      { directive: 'usergroups', key: 'usergroups' },
    ],
    features: [{ flag: 'menuswork', label: 'Configurable menus:' }],
  },
  {
    rows: [{ directive: 'navigationhiding', key: 'navigationhiding' }],
    features: [{ flag: 'navwork', label: 'Hide/show navigation items:' }],
  },
  {
    rows: [{ directive: 'savedsearches', key: 'savedsearches' }],
    features: [{ flag: 'savedsearcheswork', label: 'Saving Query-By-Example searches:' }],
  },
  {
    rows: [{ directive: 'central_columns', key: 'central_columns' }],
    features: [{ flag: 'centralcolumnswork', label: 'Managing central list of columns:' }],
  },
  {
    rows: [{ directive: 'designer_settings', key: 'designer_settings' }],
    features: [{ flag: 'designersettingswork', label: 'Remembering designer settings:' }],
  },
  {
    rows: [{ directive: 'export_templates', key: 'export_templates' }],
    features: [{ flag: 'exporttemplateswork', label: 'Saving export templates:' }],
  },
]

const ok = () => <strong className="text-success">{pgettext('Correctly working', 'OK')}</strong>
const notOk = () => <strong className="text-error">{t('not OK')}</strong>
const enabled = (on: boolean) =>
  on ? (
    <span className="text-success">{t('Enabled')}</span>
  ) : (
    <span className="text-error">{t('Disabled')}</span>
  )
const spacer = (key: string) => (
  <tr key={key}>
    <td colSpan={2}>&nbsp;</td>
  </tr>
)

/** `%sCreate%s …`: the first `%s…%s` becomes the link, later `%s` take `rest`. */
function linked(text: string, link: (s: string) => ReactNode, rest: string[] = []): ReactNode {
  const [before = '', middle = '', ...after] = text.split('%s')
  const tail = after.reduce((acc, part, i) => acc + (i > 0 ? (rest[i - 1] ?? '') : '') + part, '')
  return (
    <>
      {before}
      {link(middle)}
      {tail}
    </>
  )
}

/**
 * The phpMyAdmin configuration storage check (`/check-relations`): the storage database, each table
 * directive and the features they enable, the Create links of the zero configuration, and the
 * quick setup steps while a feature is missing.
 * pma: src/Controllers/CheckRelationsController.php, resources/templates/relation/check_relations.twig
 */
export function CheckRelationsPage({ server, db }: { server: number; db: string }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: qk.storageStatus(server, db), queryFn: () => api.storageStatus(server, db) })
  const [message, setMessage] = useState<UiMessage | null>(null)
  const [busy, setBusy] = useState(false)
  if (q.isPending) return <Loading />
  if (q.isError) return <MessageBox {...errorMessage(q.error)} />
  const s = q.data
  const rp = s.relationParameters

  const create = async (action: StorageAction) => {
    setBusy(true)
    try {
      const r = await api.storageCreate(server, { action, db })
      setMessage(r.message)
      qc.setQueryData(qk.storageStatus(server, db), r.status)
      // the storage tables changed: every page's storage-dependent data is stale
      await qc.invalidateQueries({ queryKey: qk.srv(server) })
    } catch (e) {
      setMessage(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const createLink = (action: StorageAction) => (label: string) => (
    <Button variant="link" disabled={busy} onClick={() => void create(action)}>
      {label}
    </Button>
  )

  return (
    <div className="container my-3 max-w-3xl">
      <h1 className="my-3 text-xl">
        {t('phpMyAdmin configuration storage')}{' '}
        <DocLink page="setup" anchor="phpmyadmin-configuration-storage" />
      </h1>
      {message !== null && <MessageBox type={message.type} text={message.text} />}
      {rp.db === null ? (
        <>
          <p className="mb-3">
            {t('Configuration of pmadb…')} {notOk()}{' '}
            <DocLink page="setup" anchor="phpmyadmin-configuration-storage" />
          </p>
          <p className="mb-3">
            {t('General relation features')} <span className="text-error">{t('Disabled')}</span>
          </p>
          {s.zeroConf && (
            <MessageBox type="notice">
              {db === ''
                ? linked(
                    t(
                      "%sCreate%s a database named '%s' and setup the phpMyAdmin configuration storage there.",
                    ),
                    createLink('create_pmadb'),
                    [s.configurationStorageDbName],
                  )
                : linked(
                    t('%sCreate%s the phpMyAdmin configuration storage in the current database.'),
                    createLink('fixall_pmadb'),
                  )}
            </MessageBox>
          )}
        </>
      ) : (
        <>
          {!rp.allworks && s.zeroConf && s.arePmadbTablesDefined && (
            <MessageBox type="notice">
              {linked(
                t('%sCreate%s missing phpMyAdmin configuration storage tables.'),
                createLink('fix_pmadb'),
              )}
            </MessageBox>
          )}
          <Table zebra className="w-full">
            <tbody>
              <tr>
                <th scope="row">
                  <code>$cfg['Servers'][$i]['pmadb']</code>{' '}
                  <DocLink page="config" anchor="cfg_Servers_pmadb" />
                </th>
                <td className="text-end">{ok()}</td>
              </tr>
              {spacer('pmadb')}
              {GROUPS.flatMap((g, gi) => [
                ...g.rows.map((r) => (
                  <tr key={r.directive}>
                    <th scope="row">
                      <code>$cfg['Servers'][$i]['{r.directive}']</code>{' '}
                      <DocLink page="config" anchor={`cfg_Servers_${r.directive}`} />
                    </th>
                    <td className="text-end">{rp[r.key] !== null ? ok() : notOk()}</td>
                  </tr>
                )),
                ...g.features.map((f) => (
                  <tr key={f.flag}>
                    <td colSpan={2} className="text-end">
                      {t(f.label)} {enabled(rp[f.flag] === true)}
                    </td>
                  </tr>
                )),
                ...(g.columnInfoHint === true && rp.commwork === true && rp.mimework !== true
                  ? [
                      <tr key="column_info_hint">
                        <td colSpan={2} className="text-end">
                          <span className="text-error">
                            {t('Please see the documentation on how to update your column_info table.')}{' '}
                            <DocLink page="config" anchor="cfg_Servers_column_info" />
                          </span>
                        </td>
                      </tr>,
                    ]
                  : []),
                ...(gi < GROUPS.length - 1 ? [spacer(`s${gi}`)] : []),
              ])}
            </tbody>
          </Table>
          {!rp.allworks && (
            <>
              <p className="my-3">{t('Quick steps to set up advanced features:')}</p>
              <ul className="list-disc ps-6">
                <li>
                  <SafeHtml
                    html={t(
                      'Create the needed tables with the <code>%screate_tables.sql</code>.',
                      escapeHtml(s.sqlDir),
                    )}
                  />{' '}
                  <DocLink page="setup" anchor="linked-tables" />
                </li>
                <li>
                  {t('Create a pma user and give access to these tables.')}{' '}
                  <DocLink page="config" anchor="cfg_Servers_controluser" />
                </li>
                <li>
                  <SafeHtml
                    html={
                      // i18n-new: phpMyAdmin's text names config.inc.php and its sample (parity exceptions X6, X57)
                      t(
                        'Enable advanced features in the configuration file (<code>bettermyadmin.config.json</code>), for example by using the setup script.',
                      )
                    }
                  />{' '}
                  <DocLink page="setup" anchor="quick-install" />
                </li>
                <li>{t('Re-login to phpMyAdmin to load the updated configuration file.')}</li>
              </ul>
            </>
          )}
        </>
      )}
    </div>
  )
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
