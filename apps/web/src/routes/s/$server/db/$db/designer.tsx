import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { DesignerPage } from '../../../../../features/database/designer/DesignerPage'

/** pma: /database/designer (`?page=` a saved page, `?query` the visual query builder) */
export const Route = createFileRoute('/s/$server/db/$db/designer')({
  validateSearch: z.object({ page: z.coerce.string().optional(), query: z.coerce.string().optional() }),
  component: function Page() {
    const { server, db } = Route.useParams()
    const { page, query } = Route.useSearch()
    return (
      <DesignerPage
        key={db}
        server={server}
        db={db}
        {...(page !== undefined ? { page } : {})}
        {...(query !== undefined ? { query } : {})}
      />
    )
  },
})
