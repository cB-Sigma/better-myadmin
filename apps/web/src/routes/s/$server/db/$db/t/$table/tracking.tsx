import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { TrackingPage } from '../../../../../../../features/table/tracking/TrackingPage'
import { qs } from '../../../../../../../lib/search'

/**
 * Table Tracking tab (pma: /table/tracking; the database Tracking page links its versions'
 * `report=true&version=N` and `snapshot=true&version=N`).
 */
export const Route = createFileRoute('/s/$server/db/$db/t/$table/tracking')({
  validateSearch: z.object({ report: qs.str(), snapshot: qs.str(), version: qs.str() }),
  component: function Tracking() {
    const { server, db, table } = Route.useParams()
    const { report, snapshot, version } = Route.useSearch()
    const open =
      version === undefined
        ? null
        : report !== undefined
          ? { kind: 'report' as const, version }
          : snapshot !== undefined
            ? { kind: 'snapshot' as const, version }
            : null
    return <TrackingPage key={`${db}.${table}`} scope={{ server, db, table }} open={open} />
  },
})
