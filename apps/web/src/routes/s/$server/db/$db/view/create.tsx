import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { ViewCreatePage } from '../../../../../../features/table/view/ViewForm'
import { qs } from '../../../../../../lib/search'

/** Create view, or Edit view with `table` (pma: /view/create) */
export const Route = createFileRoute('/s/$server/db/$db/view/create')({
  validateSearch: z.object({ table: qs.str(), sql: qs.str() }),
  component: function ViewCreate() {
    const { server, db } = Route.useParams()
    const { table, sql } = Route.useSearch()
    return (
      <ViewCreatePage
        key={`${db}.${table ?? ''}`}
        server={server}
        db={db}
        {...(table === undefined ? {} : { table })}
        {...(sql === undefined ? {} : { sql })}
      />
    )
  },
})
