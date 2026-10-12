import type { PrefsHeader as PrefsHeaderData } from '@bettermyadmin/contracts'
import {
  IconText,
  MessageBox,
  NavPills,
  type PmaIconName,
  SafeHtml,
  type TabLinkComponent,
  pmaDocUrl,
} from '@bettermyadmin/ui'
import { Link } from '@tanstack/react-router'
import { t } from '../../lib/i18n'

/** The eight preference pages in phpMyAdmin's order (route segment, label, TabsMode icon). */
export const PREFS_TABS: ReadonlyArray<{ key: string; label: string; icon?: PmaIconName }> = [
  { key: 'manage', label: 'Manage your settings' },
  { key: 'two-factor', label: 'Two-factor authentication' },
  { key: 'features', label: 'Features', icon: 'b_tblops' },
  { key: 'sql', label: 'SQL queries', icon: 'b_sql' },
  { key: 'navigation', label: 'Navigation panel', icon: 'b_select' },
  { key: 'main-panel', label: 'Main panel', icon: 'b_props' },
  { key: 'export', label: 'Export', icon: 'b_export' },
  { key: 'import', label: 'Import', icon: 'b_import' },
]

const PillLink: TabLinkComponent = ({ href, className, children, ...rest }) => (
  <Link to={href} className={className} {...rest}>
    {children}
  </Link>
)

/**
 * The preferences pills, the "saved" banner after a redirect with `?saved=1` and the session-only
 * notice without pma__userconfig.
 * pma: resources/templates/preferences/header.twig
 */
export function PrefsHeader({
  server,
  active,
  saved,
  header,
}: {
  server: number
  active: string
  saved: boolean
  header: PrefsHeaderData | undefined
}) {
  const docLink = `<a href="${pmaDocUrl('setup', 'linked-tables')}" target="_blank" rel="noopener noreferrer">`
  return (
    <div className="container-fluid">
      <NavPills
        id="user_prefs_tabs"
        link={PillLink}
        items={PREFS_TABS.map((p) => ({
          key: p.key,
          href: `/s/${server}/preferences/${p.key}`,
          active: p.key === active,
          label:
            p.icon === undefined ? t(p.label) : <IconText icon={p.icon} text={t(p.label)} mode="TabsMode" />,
        }))}
      />
      {saved && <MessageBox type="success" text={t('Configuration has been saved.')} />}
      {header !== undefined && !header.hasConfigStorage && (
        <MessageBox type="notice">
          <SafeHtml
            html={t(
              'Your preferences will be saved for current session only. Storing them permanently requires %sphpMyAdmin configuration storage%s.',
              docLink,
              '</a>',
            )}
          />
        </MessageBox>
      )}
    </div>
  )
}
