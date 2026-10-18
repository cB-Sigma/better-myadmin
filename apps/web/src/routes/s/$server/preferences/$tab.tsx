import { PreferencesTab } from '@bettermyadmin/contracts'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { PreferencesFormPage } from '../../../../features/preferences/PreferencesFormPage'
import { qs } from '../../../../lib/search'

/** pma: /preferences/features, /sql, /navigation, /main-panel, /export, /import */
export const Route = createFileRoute('/s/$server/preferences/$tab')({
  params: {
    parse: (p) => ({ tab: PreferencesTab.parse(p.tab) }),
    stringify: (p) => ({ tab: p.tab }),
  },
  validateSearch: z.object({ saved: qs.int() }),
  component: function Preferences() {
    const { server, tab } = Route.useParams()
    const { saved } = Route.useSearch()
    const hash = typeof window === 'undefined' ? '' : window.location.hash.replace(/^#/, '')
    return <PreferencesFormPage key={tab} server={server} tab={tab} saved={saved !== undefined} hash={hash} />
  },
})
