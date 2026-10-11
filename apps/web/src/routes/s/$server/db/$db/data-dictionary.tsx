import { createFileRoute } from '@tanstack/react-router'
import { DataDictionaryPage } from '../../../../../features/database/DataDictionaryPage'

/** pma: /database/data-dictionary */
export const Route = createFileRoute('/s/$server/db/$db/data-dictionary')({
  component: function Page() {
    const { server, db } = Route.useParams()
    return <DataDictionaryPage key={db} server={server} db={db} />
  },
})
