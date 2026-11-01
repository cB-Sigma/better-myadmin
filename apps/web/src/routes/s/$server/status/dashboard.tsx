import { createFileRoute } from '@tanstack/react-router'
import { DashboardPage } from '../../../../features/server/DashboardPage'

/** Status › Dashboard: BetterMyAdmin only, no phpMyAdmin route (parity exception X64) */
export const Route = createFileRoute('/s/$server/status/dashboard')({
  component: function Page() {
    const { server } = Route.useParams()
    return <DashboardPage server={server} />
  },
})
