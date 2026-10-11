import { createFileRoute } from '@tanstack/react-router'
import { TriggersPage } from '../../../../../../../features/database/TriggersPage'

/** Table Triggers tab (pma: /triggers?db=…&table=…) */
export const Route = createFileRoute('/s/$server/db/$db/t/$table/triggers')({
  component: function TableTriggers() {
    const { server, db, table } = Route.useParams()
    return <TriggersPage key={`${db}.${table}`} server={server} db={db} table={table} />
  },
})
