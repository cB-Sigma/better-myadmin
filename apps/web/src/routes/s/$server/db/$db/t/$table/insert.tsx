import { createFileRoute } from '@tanstack/react-router'
import { InsertEditPage } from '../../../../../../../features/insert-edit/InsertEditPage'

/** Table Insert tab (pma: /table/change without a where clause) */
export const Route = createFileRoute('/s/$server/db/$db/t/$table/insert')({
  component: function Insert() {
    const { server, db, table } = Route.useParams()
    return <InsertEditPage key={`${db}.${table}`} server={Number(server)} db={db} table={table} where={[]} />
  },
})
