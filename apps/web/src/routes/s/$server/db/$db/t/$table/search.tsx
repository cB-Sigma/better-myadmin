import { createFileRoute } from '@tanstack/react-router'
import { SearchPage } from '../../../../../../../features/table/search/SearchPage'

/** Table search (pma: /table/search) */
export const Route = createFileRoute('/s/$server/db/$db/t/$table/search')({
  component: function Search() {
    const { server, db, table } = Route.useParams()
    return <SearchPage key={`${db}.${table}`} scope={{ server, db, table }} />
  },
})
