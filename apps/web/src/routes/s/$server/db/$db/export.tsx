import { createFileRoute } from '@tanstack/react-router'
import { ExportPage } from '../../../../../features/export/ExportPage'
import { exportSearch, searchPairs } from '../../../../../features/export/search'
import { AdminPage } from '../../../../../lib/mobileAdmin'

/** Database Export tab (pma: /database/export, /export/tables) */
export const Route = createFileRoute('/s/$server/db/$db/export')({
  validateSearch: exportSearch,
  component: function DatabaseExport() {
    const { server, db } = Route.useParams()
    const search = Route.useSearch()
    return (
      <AdminPage>
        <ExportPage server={server} scope="database" db={db} request={searchPairs(search)} />
      </AdminPage>
    )
  },
})
