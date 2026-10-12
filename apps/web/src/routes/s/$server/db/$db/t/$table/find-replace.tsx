import { createFileRoute } from '@tanstack/react-router'
import { FindReplacePage } from '../../../../../../../features/table/search/FindReplacePage'

/** Find and replace (pma: /table/find-replace) */
export const Route = createFileRoute('/s/$server/db/$db/t/$table/find-replace')({
  component: function FindReplace() {
    const { server, db, table } = Route.useParams()
    return <FindReplacePage key={`${db}.${table}`} scope={{ server, db, table }} />
  },
})
