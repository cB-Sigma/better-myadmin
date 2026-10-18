import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { DbStructurePage } from '../../../../../features/database/DbStructurePage'
import { qs } from '../../../../../lib/search'

/** Database Structure tab (pma: /database/structure) */
export const Route = createFileRoute('/s/$server/db/$db/structure')({
  validateSearch: z.object({
    pos: qs.str(),
    sort: qs.str(),
    sort_order: qs.str(),
    tbl_group: qs.str(),
    tbl_type: qs.str(),
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
