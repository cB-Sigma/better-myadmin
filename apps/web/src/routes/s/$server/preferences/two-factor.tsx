import { createFileRoute } from '@tanstack/react-router'
import { TwoFactorPage } from '../../../../features/preferences/TwoFactorPage'
import { AdminPage } from '../../../../lib/mobileAdmin'

/** pma: /preferences/two-factor */
export const Route = createFileRoute('/s/$server/preferences/two-factor')({
  component: function TwoFactor() {
    const { server } = Route.useParams()
    return (
      <AdminPage>
        <TwoFactorPage server={server} />
      </AdminPage>
    )
  },
})
