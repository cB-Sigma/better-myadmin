import { createFileRoute } from '@tanstack/react-router'
import { TwoFactorPage } from '../../../../features/preferences/TwoFactorPage'

/** pma: /preferences/two-factor */
export const Route = createFileRoute('/s/$server/preferences/two-factor')({
  component: function TwoFactor() {
    const { server } = Route.useParams()
    return <TwoFactorPage server={server} />
  },
})
