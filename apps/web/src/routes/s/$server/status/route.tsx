import { createFileRoute } from '@tanstack/react-router'
import { StatusLayout } from '../../../../features/server/StatusPages'

/** pma: templates/server/status/base.twig */
export const Route = createFileRoute('/s/$server/status')({
  component: function Page() {
    const { server } = Route.useParams()
    return <StatusLayout server={server} />
  },
})
