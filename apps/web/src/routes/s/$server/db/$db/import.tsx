import { createFileRoute } from '@tanstack/react-router'
import { ImportPage } from '../../../../../features/import/ImportPage'
import { importPairs, importSearch } from '../../../../../features/import/search'

/** Database Import tab (pma: /database/import) */
export const Route = createFileRoute('/s/$server/db/$db/import')({
  validateSearch: importSearch,
  component: function DatabaseImport() {
    const { server, db } = Route.useParams()
    const search = Route.useSearch()
    return <ImportPage server={server} scope="database" db={db} request={importPairs(search)} />
  },
})
