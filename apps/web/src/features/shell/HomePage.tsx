import type { HomeResponse } from '@bettermyadmin/contracts'
import {
  Alert,
  Button,
  DocLink,
  IconText,
  MySqlDocLink,
  NativeSelect,
  Panel,
  PanelItem,
  PanelList,
  PmaIcon,
  removeMessage,
  showMessage,
} from '@bettermyadmin/ui'
import { THEMES, getTheme } from '@bettermyadmin/ui/themes'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '../../lib/api.ts'
import { PROJECT_URL } from '../../lib/config'
import { useConfig } from '../../lib/config.ts'
import { pgettext, t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys.ts'
import { BBCode } from './bbcode.tsx'
import { ChangePasswordDialog, type PasswordChanged } from './home/ChangePasswordDialog.tsx'
import { LanguageSlot, useLanguageChoice } from './home/LanguageSlot.tsx'
import { VersionInfo } from './home/VersionInfo.tsx'
import { colorModeText, setTheme, useThemeState } from './theme/theme.ts'
import { ThemesDialog } from './themes/ThemeCards.tsx'

const REPO = PROJECT_URL

/**
 * The home page: General settings, Appearance settings, Database server, Web server, the
 * BetterMyAdmin card and every warning HomeController can emit.
 * pma: src/Controllers/HomeController.php, resources/templates/home/index.twig
 */
export function HomePage() {
  const { server } = useParams({ from: '/s/$server' })
  const home = useQuery({ queryKey: qk.home(server), queryFn: () => api.home(server) })
  const [changed, setChanged] = useState<PasswordChanged | null>(null)
  if (home.isPending) return null
  if (home.isError) return <Alert variant="error">{home.error.message}</Alert>
  const h = home.data
  return (
    <div id="maincontainer">
      {changed !== null && (
        <Alert variant="success" className="mb-3">
          <PmaIcon name="s_success" /> {changed.message}
          <pre className="mt-2 rounded bg-bg-inset p-2 font-mono text-xs">
            <code className="sql">{changed.sql}</code>
          </pre>
        </Alert>
      )}
      {h.partialLogout && (
        <Alert variant="success" className="mb-3">
          {t(
            'You were logged out from one server, to logout completely from phpMyAdmin, you need to logout from all servers.',
          )}
        </Alert>
      )}
      <div className="grid grid-cols-1 gap-x-6 gap-y-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-7">
          <GeneralSettings server={server} home={h} onPasswordChanged={setChanged} />
          <AppearanceSettings server={server} />
        </div>
        <div className="space-y-6 lg:col-span-5">
          {h.databaseServer !== null && <DatabaseServer d={h.databaseServer} />}
          {(h.webServer !== null || h.showPhpInfo) && (
            <WebServer w={h.webServer} showPhpInfo={h.showPhpInfo} server={server} />
          )}
          <AppCard server={server} home={h} />
        </div>
      </div>
      <div className="mt-6 space-y-2">
        {h.warnings.map((w) => (
          <Alert key={w.message} variant={w.severity === 'warning' ? 'warning' : 'info'}>
            {w.severity === 'warning' ? (
              <PmaIcon name="s_attention" alt={t('Warning')} />
            ) : (
              <PmaIcon name="s_notice" alt={t('Notice')} />
            )}{' '}
            <BBCode text={w.message} />
          </Alert>
        ))}
        {h.configStorageMessage !== null && (
          <Alert variant={h.configStorageMessage.type === 'error' ? 'error' : 'notice'}>
            <ConfigStorageText server={server} />
            {h.configStorageMessage.zeroConf && (
              <>
                <br />
                {t("Or alternately go to 'Operations' tab of any database to set it up there.")}
              </>
            )}
          </Alert>
        )}
      </div>
    </div>
  )
}

/** `%sFind out why%s` with the check-relations link around the middle part. */
function ConfigStorageText({ server }: { server: number }) {
  const text = t(
    'The phpMyAdmin configuration storage is not completely configured, some extended features have been deactivated. %sFind out why%s. ',
  )
  const [before = '', middle = '', after = ''] = text.split('%s')
  return (
    <>
      {before}
      <Link to="/s/$server/check-relations" params={{ server }} search={{}}>
        {middle}
      </Link>
      {after}
    </>
  )
}

function GeneralSettings(props: {
  server: number
  home: HomeResponse
  onPasswordChanged: (r: PasswordChanged) => void
}) {
  const { server, home } = props
  const qc = useQueryClient()
  const navigate = useNavigate()
  const auth = useQuery({ queryKey: qk.auth, queryFn: api.authState })
  const [pwOpen, setPwOpen] = useState(false)

  const setCollation = async (collation: string) => {
    const box = showMessage()
    try {
      await api.setCollation(server, collation)
      // CollationConnectionController redirects to the home page: everything is reloaded
      await qc.invalidateQueries({ queryKey: qk.srv(server) })
    } finally {
      removeMessage(box)
    }
  }

  return (
    <Panel variant="home" title={t('General settings')}>
      <PanelList>
        {home.hasServerSelection && (
          <PanelItem id="li_select_server">
            <label htmlFor="select_server" className="me-2 inline-flex items-center gap-1">
              <PmaIcon name="s_host" /> {t('Current server:')}
            </label>
            <NativeSelect
              id="select_server"
              name="server"
              value={server}
              onChange={async (e) => {
                const s = Number(e.target.value)
                if (s === 0) return
                await api.switchServer(s).catch(() => null)
                await qc.invalidateQueries({ queryKey: qk.auth })
                await navigate({ to: '/s/$server', params: { server: s } })
              }}
            >
              <option value={0}>({t('Servers')}) ...</option>
              {auth.data?.servers.map((s) => (
                <option key={s.index} value={s.index}>
                  {s.label}
                </option>
              ))}
            </NativeSelect>
          </PanelItem>
        )}
        {home.hasChangePasswordLink && (
          <PanelItem id="li_change_password">
            <button
              type="button"
              id="change_password_anchor"
              className="ajax cursor-pointer text-accent hover:underline"
              onClick={() => setPwOpen(true)}
            >
              <IconText icon="s_passwd" text={t('Change password')} forceText />
            </button>
            <ChangePasswordDialog
              server={server}
              username={auth.data?.user ?? ''}
              open={pwOpen}
              onOpenChange={setPwOpen}
              onChanged={props.onPasswordChanged}
            />
          </PanelItem>
        )}
        <PanelItem id="li_select_mysql_collation" className="flex flex-wrap items-center gap-2">
          <label htmlFor="collationConnectionSelect" className="inline-flex items-center gap-1">
            <PmaIcon name="s_asci" /> {t('Server connection collation:')}{' '}
            <MySqlDocLink link="charset-connection" />
          </label>
          {home.collation.charsets.length > 0 && (
            <NativeSelect
              lang="en"
              dir="ltr"
              name="collation_connection"
              id="collationConnectionSelect"
              className="autosubmit"
              // home/index.twig marks getDefaultCollation() as selected, whatever is in effect (quirk Q42)
              value={home.collation.selected}
              onChange={(e) => void setCollation(e.target.value)}
              data-current={home.collation.current}
            >
              <option value="">{t('Collation')}</option>
              <option value="" />
              {home.collation.charsets.map((cs) => (
                <optgroup key={cs.name} label={cs.name} title={cs.description}>
                  {cs.collations.map((c) => (
                    <option key={c.name} value={c.name} title={c.description}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </NativeSelect>
          )}
        </PanelItem>
        <PanelItem id="li_user_preferences">
          <Link to="/s/$server/preferences/manage" params={{ server }}>
            <IconText icon="b_tblops" text={t('More settings')} forceText />
          </Link>
        </PanelItem>
      </PanelList>
    </Panel>
  )
}

function AppearanceSettings({ server }: { server: number }) {
  const cfg = useConfig()
  const opts = { themeDefault: cfg.ThemeDefault, perServer: cfg.ThemePerServer, server }
  const theme = useThemeState(opts)
  const [gallery, setGallery] = useState(false)
  const manifest = getTheme(theme.theme)
  const languageChoice = useLanguageChoice()
  // "Appearance settings" exists when a language choice or the theme manager is available
  if (!cfg.ThemeManager && !languageChoice) return null
  return (
    <Panel variant="home" title={t('Appearance settings')}>
      <PanelList>
        <LanguageSlot />
        {cfg.ThemeManager && (
          <PanelItem id="li_select_theme" className="flex flex-wrap items-center gap-2">
            <label htmlFor="themeSelect">
              <IconText icon="s_theme" text={t('Theme')} />
            </label>
            <span className="inline-flex">
              <NativeSelect
                name="set_theme"
                lang="en"
                dir="ltr"
                id="themeSelect"
                className="autosubmit rounded-e-none"
                value={theme.theme}
                onChange={(e) => setTheme(opts, e.target.value)}
              >
                {THEMES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </NativeSelect>
              <Button className="rounded-s-none border-s-0" onClick={() => setGallery(true)}>
                {pgettext('View all themes', 'View all')}
              </Button>
            </span>
            {manifest !== undefined && manifest.colorModes.length > 1 && (
              <NativeSelect
                className="autosubmit"
                name="themeColorMode"
                aria-label={t('Color mode for the theme')}
                value={theme.colorMode}
                onChange={(e) => setTheme(opts, theme.theme, e.target.value)}
              >
                {manifest.colorModes.map((m) => (
                  <option key={m} value={m}>
                    {colorModeText(m)}
                  </option>
                ))}
              </NativeSelect>
            )}
            <ThemesDialog
              open={gallery}
              onOpenChange={setGallery}
              active={theme.theme}
              onTake={(id) => setTheme(opts, id)}
            />
          </PanelItem>
        )}
      </PanelList>
    </Panel>
  )
}

function DatabaseServer({ d }: { d: NonNullable<HomeResponse['databaseServer']> }) {
  return (
    <Panel variant="home" title={t('Database server')}>
      <PanelList className="list-disc ps-8">
        <PanelItem className="ps-0">
          {t('Server:')} {d.host}
        </PanelItem>
        <PanelItem className="ps-0">
          {t('Hostname:')} {d.hostname}
        </PanelItem>
        <PanelItem className="ps-0">
          {t('Server type:')} {d.type}
        </PanelItem>
        <PanelItem className="ps-0">
          {t('Server connection:')}{' '}
          <span className={d.connection.danger ? 'text-error' : ''}>{d.connection.message}</span>{' '}
          <DocLink page="setup" anchor="ssl" />
        </PanelItem>
        <PanelItem className="ps-0">
          {t('Server version:')} {d.version}
        </PanelItem>
        <PanelItem className="ps-0">
          {t('User:')} {d.user}
        </PanelItem>
        <PanelItem className="ps-0">
          {t('Server charset:')}{' '}
          <span lang="en" dir="ltr">
            {d.charset}
          </span>
        </PanelItem>
      </PanelList>
    </Panel>
  )
}

function WebServer({
  w,
  showPhpInfo,
  server,
}: { w: HomeResponse['webServer']; showPhpInfo: boolean; server: number }) {
  return (
    <Panel variant="home" title={t('Web server')}>
      <PanelList className="list-disc ps-8">
        {w !== null && (
          <>
            {w.software !== null && <PanelItem className="ps-0">{w.software}</PanelItem>}
            <PanelItem className="ps-0" id="li_mysql_client_version">
              {t('Database client version:')} {w.database}
            </PanelItem>
            <PanelItem className="ps-0">
              {/* BetterMyAdmin's runtime (X30): phpMyAdmin lists PHP extensions; no msgid */}
              Node.js modules:{' '}
              {w.modules.map((m) => (
                <span key={m.name} className="me-1">
                  {m.name}{' '}
                  <a href={m.url} target="documentation" rel="noopener noreferrer" title={t('Documentation')}>
                    <PmaIcon name="b_help" alt={t('Documentation')} />
                  </a>
                </span>
              ))}
            </PanelItem>
            <PanelItem className="ps-0">Node.js version: {w.runtimeVersion}</PanelItem>
          </>
        )}
        {showPhpInfo && (
          <PanelItem className="ps-0">
            <Link
              to="/s/$server/$"
              params={{ server, _splat: 'runtime-info' }}
              target="_blank"
              rel="noopener noreferrer"
            >
              Show runtime information
            </Link>
          </PanelItem>
        )}
      </PanelList>
    </Panel>
  )
}

function AppCard({ server, home }: { server: number; home: HomeResponse }) {
  const git = home.app.git
  return (
    <Panel variant="home" title="BetterMyAdmin">
      <PanelList className="list-disc ps-8">
        <VersionInfo version={home.app.version} check={home.versionCheck} />
        {git !== null && (
          <PanelItem className="ps-0" id="li_pma_version_git">
            {t('Git revision:')} <strong title={git.message ?? ''}>{git.hash.slice(0, 7)}</strong>{' '}
            {git.branch === null ? `(${t('no branch')})` : t('from %s branch', git.branch)}
          </PanelItem>
        )}
        <PanelItem className="ps-0">
          <a href={`${REPO}/tree/main/docs`} target="_blank" rel="noopener noreferrer">
            {t('Documentation')}
          </a>
        </PanelItem>
        <PanelItem className="ps-0">
          <a href={REPO} target="_blank" rel="noopener noreferrer">
            {t('Official Homepage')}
          </a>
        </PanelItem>
        <PanelItem className="ps-0">
          <a href={`${REPO}/pulls`} target="_blank" rel="noopener noreferrer">
            {t('Contribute')}
          </a>
        </PanelItem>
        <PanelItem className="ps-0">
          <a href={`${REPO}/issues`} target="_blank" rel="noopener noreferrer">
            {t('Get support')}
          </a>
        </PanelItem>
        <PanelItem className="ps-0">
          <Link to="/s/$server/$" params={{ server, _splat: 'changelog' }} target="_blank">
            {t('List of changes')}
          </Link>
        </PanelItem>
        <PanelItem className="ps-0">
          <Link to="/s/$server/$" params={{ server, _splat: 'license' }} target="_blank">
            {t('License')}
          </Link>
        </PanelItem>
      </PanelList>
    </Panel>
  )
}
