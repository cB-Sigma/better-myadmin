import { createFileRoute } from '@tanstack/react-router'
import { TrackingPage } from '../../../../../../../features/table/tracking/TrackingPage'

/** Table Tracking tab (pma: /table/tracking) */
export const Route = createFileRoute('/s/$server/db/$db/t/$table/tracking')({
  component: function Tracking() {
    const { server, db, table } = Route.useParams()
    return <TrackingPage key={`${db}.${table}`} scope={{ server, db, table }} />
  },
})
