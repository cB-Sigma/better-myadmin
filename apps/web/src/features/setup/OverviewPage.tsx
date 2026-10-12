import type { SetupOverview } from '@bettermyadmin/contracts'
import {
  Button,
  Loading,
  MessageBox,
  NativeSelect,
  Panel,
  PanelBody,
  PmaIcon,
  SafeHtml,
  Table,
  pmaDocUrl,
} from '@bettermyadmin/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { PROJECT_URL } from '../../lib/config'
import { t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'
import { LanguageLabel, LanguageSelect } from '../shell/LanguageSelect'
import { SetupLayout } from './SetupLayout'

/**
 * The overview: language, the messages of ServerConfigChecks, the servers and the configuration
 * file card.
 * pma: src/Controllers/Setup/HomeController.php, resources/templates/setup/home/index.twig
 */
export function OverviewPage({ versionCheck }: { versionCheck: boolean }) {
  const q = useQuery({
    queryKey: qk.setupOverview(versionCheck),
    queryFn: () => api.setupOverview(versionCheck),
  })
  if (q.isError) return <SetupError error={q.error} />
  if (q.data === undefined) return <Loading className="p-4" />
  return (
    <SetupLayout pages={q.data.pages} formset="">
      <Overview data={q.data} />
    </SetupLayout>
  )
}

/** "Configuration already exists, setup is disabled!" and other failures (error/generic.twig). */
export function SetupError({ error }: { error: unknown }) {
  return (
    <div className="p-4">
      <MessageBox {...errorMessage(error)} />
    </div>
  )
}

function Overview({ data }: { data: SetupOverview }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [showHidden, setShowHidden] = useState(false)
  const hidden = data.messages.filter((m) => m.hidden).length
  const https = window.location.protocol === 'https:'
  const messages = data.messages.filter((m) => (showHidden || !m.hidden) && !(https && m.id === 'no_https'))
  const firstServer = data.servers[0]?.id ?? 1
  const [lang, setLang] = useState(data.languages.find((l) => l.active)?.code ?? 'en')
  const [serverDefault, setServerDefault] = useState(String(firstServer))
  const [eol, setEol] = useState(data.eol)

  const remove = useMutation({
    mutationFn: (id: number) => api.deleteSetupServer(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.setup }),
  })
  const config = useMutation({
    mutationFn: (action: 'display' | 'download' | 'clear' | 'save') =>
      api
        .postSetupConfig({ DefaultLang: lang, ServerDefault: serverDefault, eol, action })
        .then(() => action),
    onSuccess: async (action) => {
      await qc.invalidateQueries({ queryKey: qk.setup })
      if (action === 'download') window.location.href = api.setupDownloadUrl(eol)
      else if (action === 'display' || action === 'save')
        await navigate({ to: '/setup/config', search: { eol } })
    },
  })

  return (
    <>
      <form id="select_lang" className="mb-3" onSubmit={(e) => e.preventDefault()}>
        <bdo lang="en" dir="ltr">
          <label htmlFor="languageSelect">
            <LanguageLabel />
          </label>
        </bdo>
        <LanguageSelect />
      </form>

      <h2 className="mb-3 text-lg font-semibold">{t('Overview')}</h2>
      {hidden > 0 && !showHidden && (
        <p className="mb-2">
          {/* biome-ignore lint/a11y/useValidAnchor: setup/home/index.twig links (#show_hidden_messages, .delete-server) */}
          <a
            href="#"
            id="show_hidden_messages"
            onClick={(e) => {
              e.preventDefault()
              setShowHidden(true)
            }}
          >
            {t('Show hidden messages')} ({hidden})
          </a>
        </p>
      )}
      {messages.map((m) => (
        <MessageBox
          key={`${m.type}:${m.id}`}
          type={m.type}
          id={m.id}
          className={m.hidden ? 'hiddenmessage' : ''}
        >
          <h4 className="font-semibold">{m.title}</h4>
          <SafeHtml
            html={m.message}
            as="div"
            {...(m.id === 'no_https'
              ? {
                  onClick: (e: React.MouseEvent) => {
                    if (!(e.target instanceof HTMLAnchorElement)) return
                    e.preventDefault()
                    window.location.href = `https:${window.location.href.slice(window.location.protocol.length)}`
                  },
                }
              : {})}
          />
        </MessageBox>
      ))}

      <Panel title={t('Servers')} className="mb-3">
        <PanelBody>
          {data.servers.length > 0 ? (
            <Table className="w-auto datatable">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t('Name')}</th>
                  <th>{t('Authentication type')}</th>
                  <th colSpan={2}>DSN</th>
                </tr>
              </thead>
              <tbody>
                {data.servers.map((s) => (
                  <tr key={s.id}>
                    <td>{s.id}</td>
                    <td>{s.name}</td>
                    <td>{s.authType}</td>
                    <td>{s.dsn}</td>
                    <td className="text-nowrap">
                      <small>
                        <Link to="/setup/servers/$id" params={{ id: String(s.id) }}>
                          {t('Edit')}
                        </Link>
                        {' | '}
                        {/* biome-ignore lint/a11y/useValidAnchor: setup/home/index.twig links (#show_hidden_messages, .delete-server) */}
                        <a
                          className="delete-server"
                          href="#"
                          onClick={(e) => {
                            e.preventDefault()
                            remove.mutate(s.id)
                          }}
                        >
                          {t('Delete')}
                        </a>
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <p className="mb-2">
              <em>{t('There are no configured servers')}</em>
            </p>
          )}
          <Button
            className="mt-2"
            onClick={() => navigate({ to: '/setup/servers/$id', params: { id: '0' } })}
          >
            {t('New server')}
          </Button>
        </PanelBody>
      </Panel>

      <Panel title={t('Configuration file')}>
        <PanelBody>
          {config.isError && <MessageBox {...errorMessage(config.error)} />}
          <table className="text-[13px]">
            <tbody>
              <ConfigRow label={t('Default language')} id="DefaultLang" doc="cfg_DefaultLang">
                <NativeSelect
                  id="DefaultLang"
                  name="DefaultLang"
                  value={lang}
                  onChange={(e) => setLang(e.target.value)}
                >
                  {data.languages.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.name}
                    </option>
                  ))}
                </NativeSelect>
              </ConfigRow>
              <ConfigRow label={t('Default server')} id="ServerDefault" doc="cfg_ServerDefault">
                <NativeSelect
                  id="ServerDefault"
                  name="ServerDefault"
                  value={serverDefault}
                  onChange={(e) => setServerDefault(e.target.value)}
                >
                  {data.servers.length === 0 && <option value="1">{t('- none -')}</option>}
                  {data.servers.length > 1 && (
                    <>
                      <option value="0">{t('let the user choose')}</option>
                      <option value="" disabled>
                        ------------------------------
                      </option>
                    </>
                  )}
                  {data.servers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} [{s.id}]
                    </option>
                  ))}
                </NativeSelect>
              </ConfigRow>
              <ConfigRow label={t('End of line')} id="eol">
                <NativeSelect
                  id="eol"
                  name="eol"
                  value={eol}
                  onChange={(e) => setEol(e.target.value === 'win' ? 'win' : 'unix')}
                >
                  <option value="unix">UNIX / Linux (\n)</option>
                  <option value="win">Windows (\r\n)</option>
                </NativeSelect>
              </ConfigRow>
            </tbody>
          </table>
          <div className="mt-3 flex gap-2">
            <Button name="submit_display" onClick={() => config.mutate('display')}>
              {t('Display')}
            </Button>
            <Button name="submit_download" onClick={() => config.mutate('download')}>
              {t('Download')}
            </Button>
            {data.canSave && (
              <Button name="submit_save" onClick={() => config.mutate('save')}>
                {t('Save')}
              </Button>
            )}
            <Button name="submit_clear" variant="destructive" onClick={() => config.mutate('clear')}>
              {t('Clear')}
            </Button>
          </div>
        </PanelBody>
      </Panel>

      <div id="footer" className="mt-4 flex gap-4 text-[13px]">
        <a href={PROJECT_URL} target="_blank" rel="noopener noreferrer">
          {t('BetterMyAdmin homepage')}
        </a>
        <Link to="/setup" search={{ version_check: 1 }}>
          {t('Check for latest version')}
        </Link>
      </div>
    </>
  )
}

function ConfigRow({
  label,
  id,
  doc,
  children,
}: { label: string; id: string; doc?: string; children: React.ReactNode }) {
  return (
    <tr>
      <th className="py-1 pe-4 text-left align-middle font-semibold">
        <label htmlFor={id}>{label}</label>
        {doc !== undefined && (
          <span className="doc ms-2">
            <a href={pmaDocUrl('config', doc)} target="_blank" rel="noreferrer noopener">
              <PmaIcon name="b_help" alt={t('Documentation')} />
            </a>
          </span>
        )}
      </th>
      <td className="py-1">{children}</td>
    </tr>
  )
}
