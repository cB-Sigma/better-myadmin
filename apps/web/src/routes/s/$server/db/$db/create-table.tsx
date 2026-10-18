import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { CreateTablePage } from '../../../../../features/table/create/CreateTablePage'
import { qs } from '../../../../../lib/search'

/** Create table (pma: /table/create, the database Structure "Create new table" box) */
export const Route = createFileRoute('/s/$server/db/$db/create-table')({
  validateSearch: z.object({
    table: qs.str(),
    num_fields: qs.int(1),
  }),
  component: function CreateTable() {
    const { server, db } = Route.useParams()
    const { table, num_fields } = Route.useSearch()
    return (
      <CreateTablePage
        server={server}
        db={db}
        {...(table !== undefined ? { initialName: table } : {})}
        {...(num_fields !== undefined ? { numFields: num_fields } : {})}
      />
    )
  },
})
