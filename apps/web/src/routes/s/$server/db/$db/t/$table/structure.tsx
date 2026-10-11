import { createFileRoute } from '@tanstack/react-router'
import { StructurePage } from '../../../../../../../features/table/structure/StructurePage'

/** Table Structure tab (pma: /table/structure) */
export const Route = createFileRoute('/s/$server/db/$db/t/$table/structure')({
  component: function Structure() {
    const { server, db, table } = Route.useParams()
    return <StructurePage key={`${db}.${table}`} server={server} db={db} table={table} />
  },
})
