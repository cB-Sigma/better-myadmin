import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconText,
  NativeSelect,
  PmaIcon,
  pmaDocUrl,
  serverDocUrl,
} from '@bettermyadmin/ui'
import { getTheme } from '@bettermyadmin/ui/themes'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { api } from '../../lib/api'
import { useConfig } from '../../lib/config.ts'
import { t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys.ts'
import { useServerScope } from './scope.ts'
import { colorModeText, setTheme, useThemeState } from './theme/theme.ts'

/** Log out through the API, then go where phpMyAdmin's LogoutController redirects. */
export function useLogout() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: api.logout,
    onSuccess: async (r) => {
      // functions.ts: every .logout click clears sessionStorage (navigation tree state)
      sessionStorage.clear()
      if (r.server !== null && r.server !== undefined) {
        await qc.invalidateQueries({ queryKey: qk.auth })
        await navigate({ to: '/s/$server', params: { server: r.server } })
        return
      }
      if (r.logoutUrl !== null) {
        window.location.href = r.logoutUrl
        return
      }
      qc.removeQueries({ queryKey: qk.allServers })
      await qc.invalidateQueries({ queryKey: qk.auth })
    },
  })
}

/**
 * `#userAccountDropdown`: user@host, documentation links, the Appearance colour-mode select (themes
 * with several modes), Settings, Log out.
 * pma: resources/templates/base.twig (#page_nav_icons)
 */
export function UserMenu({ server }: { server: number }) {
  const cfg = useConfig()
  const scope = useServerScope(server)
  const themeOpts = { themeDefault: cfg.ThemeDefault, perServer: cfg.ThemePerServer, server }
  const theme = useThemeState(themeOpts)
  const manifest = getTheme(theme.theme)
  const logout = useLogout()
  const [user = '', host = ''] = scope.data?.capabilities.currentUser ?? []
  const isMariaDb = scope.data?.isMariaDb === true
  return (
    <div id="userAccountDropdown">
      <DropdownMenu>
        <DropdownMenuTrigger
          className="inline-flex items-center gap-1 rounded border border-border-strong bg-bg px-1.5 py-0.5 text-fg"
          title={t('Open user account menu')}
        >
          <PmaIcon name="user" alt={t('Open user account menu')} />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-56">
          <DropdownMenuItem asChild>
            <Link
              to="/s/$server/$"
              params={{ server, _splat: 'privileges' }}
              search={{ username: user, hostname: host } as never}
            >
              <PmaIcon name="user" />
              <span dir="ltr">{`${user}@${host}`}</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <a href={pmaDocUrl('index')} target="_blank" rel="noopener noreferrer">
              <IconText icon="b_docs" text={t('phpMyAdmin documentation')} />
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a
              href={serverDocUrl(isMariaDb, scope.data?.versionInt ?? 0)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <IconText
                icon="b_sqlhelp"
                text={isMariaDb ? t('MariaDB documentation') : t('MySQL documentation')}
              />
            </a>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {manifest !== undefined && manifest.colorModes.length > 1 && (
            <div className="flex items-center gap-2 px-2 py-1">
              <label htmlFor="themeColorModeToggle" className="inline-flex items-center gap-1">
                <PmaIcon name="s_theme" /> {t('Appearance:')}
              </label>
              <NativeSelect
                id="themeColorModeToggle"
                name="themeColorMode"
                aria-label={t('Color mode for the theme')}
                value={theme.colorMode}
                onChange={(e) => setTheme(themeOpts, theme.theme, e.target.value)}
              >
                {manifest.colorModes.map((m) => (
                  <option key={m} value={m}>
                    {colorModeText(m)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
          <DropdownMenuItem asChild>
            <Link to="/s/$server/$" params={{ server, _splat: 'settings' }}>
              <IconText icon="s_cog" text={t('Settings')} />
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="logout" onSelect={() => logout.mutate()}>
            <IconText icon="s_loggoff" text={t('Log out')} />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
