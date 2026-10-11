import { createFileRoute } from '@tanstack/react-router'
import { CollationsPage } from '../../../features/server/InfoPages'

/** pma: /server/collations */
export const Route = createFileRoute('/s/$server/collations')({
  component: function Page() {
    const { server } = Route.useParams()
    return <CollationsPage server={server} />
  },
})
