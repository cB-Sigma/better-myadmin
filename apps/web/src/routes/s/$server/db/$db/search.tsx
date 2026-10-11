import { createFileRoute } from '@tanstack/react-router'
import { SearchPage } from '../../../../../features/database/SearchPage'

/** pma: /database/search */
export const Route = createFileRoute('/s/$server/db/$db/search')({
  component: function Page() {
    const { server, db } = Route.useParams()
    return <SearchPage key={db} server={server} db={db} />
  },
})
