import { createFileRoute } from '@tanstack/react-router'
import { ImportPage } from '../../../../../../../features/import/ImportPage'
import { importPairs, importSearch } from '../../../../../../../features/import/search'

/** Table Import tab (pma: /table/import) */
export const Route = createFileRoute('/s/$server/db/$db/t/$table/import')({
  validateSearch: importSearch,
  component: function TableImport() {
    const { server, db, table } = Route.useParams()
    const search = Route.useSearch()
    return <ImportPage server={server} scope="table" db={db} table={table} request={importPairs(search)} />
  },
})
