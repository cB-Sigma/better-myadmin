import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { DbStructurePage } from '../../../../../features/database/DbStructurePage'

/** Database Structure tab (pma: /database/structure) */
export const Route = createFileRoute('/s/$server/db/$db/structure')({
  validateSearch: z.object({
    pos: z.coerce.string().optional(),
    sort: z.string().optional(),
    sort_order: z.string().optional(),
    tbl_group: z.string().optional(),
    tbl_type: z.string().optional(),
  }),
  component: function DbStructure() {
    const { server, db } = Route.useParams()
    const search = Route.useSearch()
    const navigate = Route.useNavigate()
    return (
      <DbStructurePage
        key={db}
        server={server}
        db={db}
        search={search}
        onSearch={(s) => void navigate({ search: s as never, replace: true })}
      />
    )
  },
})
