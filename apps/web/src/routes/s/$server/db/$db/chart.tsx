import { createFileRoute } from '@tanstack/react-router'
import { ChartPage } from '../../../../../features/table/chart/ChartPage'
import { visualizationSearch } from '../../../../../features/table/chart/search'

/** Display chart of a result without a table (pma: /table/chart with db only) */
export const Route = createFileRoute('/s/$server/db/$db/chart')({
  validateSearch: visualizationSearch,
  component: function Chart() {
    const { server, db } = Route.useParams()
    const s = Route.useSearch()
    return (
      <ChartPage
        key={`${db}.${s.sql}`}
        scope={{ server, db }}
        search={{
          sql: s.sql,
          sig: s.sig,
          unlimNumRows: s.unlim_num_rows,
          pos: s.pos,
          sessionMaxRows: s.session_max_rows,
        }}
      />
    )
  },
})
