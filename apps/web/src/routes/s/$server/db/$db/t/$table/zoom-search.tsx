import { createFileRoute } from '@tanstack/react-router'
import { ZoomSearchPage } from '../../../../../../../features/table/search/ZoomSearchPage'

/** Zoom search (pma: /table/zoom-search) */
export const Route = createFileRoute('/s/$server/db/$db/t/$table/zoom-search')({
  component: function ZoomSearch() {
    const { server, db, table } = Route.useParams()
    return <ZoomSearchPage key={`${db}.${table}`} scope={{ server, db, table }} />
  },
})
