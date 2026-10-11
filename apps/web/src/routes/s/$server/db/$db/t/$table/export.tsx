import { createFileRoute } from '@tanstack/react-router'
import { ExportPage } from '../../../../../../../features/export/ExportPage'
import { exportSearch, searchPairs } from '../../../../../../../features/export/search'

/** Table Export tab (pma: /table/export, /table/export/rows with where_clause) */
export const Route = createFileRoute('/s/$server/db/$db/t/$table/export')({
  validateSearch: exportSearch,
  component: function TableExport() {
    const { server, db, table } = Route.useParams()
    const search = Route.useSearch()
    return <ExportPage server={server} scope="table" db={db} table={table} request={searchPairs(search)} />
  },
})
