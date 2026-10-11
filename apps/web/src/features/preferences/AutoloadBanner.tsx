import { Alert } from '@bettermyadmin/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'
import { clearPrefs, storedPrefs } from './manage.ts'
import { usePrefsSaved } from './prefsSaved.ts'

/**
 * `#prefs_autoload`: with session-only preferences and settings in the browser's storage, offer
 * to import them (once per session; No / Delete settings answer `prefs_autoload=hide`).
 * pma: resources/templates/preferences/autoload.twig, resources/js/modules/config.ts::offerPrefsAutoimport
 */
export function AutoloadBanner({ server }: { server: number }) {
  const q = useQuery({
    queryKey: qk.preferencesAutoload(server),
    queryFn: () => api.preferencesAutoload(server),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const qc = useQueryClient()
  const applied = usePrefsSaved(server)
  const stored = useMemo(storedPrefs, [])
  const [gone, setGone] = useState(false)
  const hide = useMutation({
    mutationFn: () => api.hidePreferencesAutoload(server),
    onSuccess: () => qc.setQueryData(qk.preferencesAutoload(server), { show: false }),
  })
  const load = useMutation({
    mutationFn: (json: string) =>
      api.importPreferences(server, { json, returnUrl: window.location.pathname + window.location.search }),
    onSuccess: async () => {
      qc.setQueryData(qk.preferencesAutoload(server), { show: false })
      await applied()
    },
  })
  if (gone || q.data?.show !== true || stored === null) return null
  return (
    <Alert variant="notice" id="prefs_autoload" className="m-2 print:hidden">
      {t(
        'Your browser has phpMyAdmin configuration for this domain. Would you like to import it for current session?',
      )}
      <br />
      {/* biome-ignore lint/a11y/useValidAnchor: autoload.twig answers with #yes / #no / #delete links */}
      <a
        href="#yes"
        onClick={(e) => {
          e.preventDefault()
          load.mutate(stored.config)
        }}
      >
        {t('Yes')}
      </a>{' '}
      / {/* biome-ignore lint/a11y/useValidAnchor: autoload.twig answers with #yes / #no / #delete links */}
      <a
        href="#no"
        onClick={(e) => {
          e.preventDefault()
          setGone(true)
          hide.mutate()
        }}
      >
        {t('No')}
      </a>{' '}
      / {/* biome-ignore lint/a11y/useValidAnchor: autoload.twig answers with #yes / #no / #delete links */}
      <a
        href="#delete"
        onClick={(e) => {
          e.preventDefault()
          setGone(true)
          clearPrefs()
          hide.mutate()
        }}
      >
        {t('Delete settings')}
      </a>
    </Alert>
  )
}
