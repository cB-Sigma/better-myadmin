import { createFileRoute } from '@tanstack/react-router'
import { CentralColumnsPage } from '../../../../../features/database/CentralColumnsPage'

/** pma: /database/central-columns */
export const Route = createFileRoute('/s/$server/db/$db/central-columns')({
  component: function Page() {
    const { server, db } = Route.useParams()
    return <CentralColumnsPage key={db} server={server} db={db} />
  },
})
