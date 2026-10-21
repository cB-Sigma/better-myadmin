import { MessageBox } from '@bettermyadmin/ui'
import { Link } from '@tanstack/react-router'
import { t } from '../../lib/i18n'

/**
 * Fallback for a URL that matches no page. Every phpMyAdmin feature route is built, so this only
 * catches a mistyped address or a stale bookmark. phpMyAdmin resolves routes on the server and has
 * no SPA fallback, so the sentence is ours (i18n-new); "Home" is phpMyAdmin's own msgid.
 */
export function NotFound() {
  return (
    <div className="space-y-3 p-4 text-sm">
      {/* i18n-new: SPA fallback for an unknown URL (phpMyAdmin routes on the server) */}
      <MessageBox type="error" flush text={t('The page you requested was not found.')} />
      <Link to="/" className="text-accent hover:underline">
        {t('Home')}
      </Link>
    </div>
  )
}
