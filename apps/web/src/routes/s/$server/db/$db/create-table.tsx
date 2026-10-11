import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { CreateTablePage } from '../../../../../features/table/create/CreateTablePage'

/** Create table (pma: /table/create, the database Structure "Create new table" box) */
export const Route = createFileRoute('/s/$server/db/$db/create-table')({
  validateSearch: z.object({
    table: z.coerce.string().optional(),
    num_fields: z.coerce.number().int().min(1).optional(),
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
