import { createFileRoute } from '@tanstack/react-router'
import { ChartPage } from '../../../../../../../features/table/chart/ChartPage'
import { visualizationSearch } from '../../../../../../../features/table/chart/search'

/** Display chart (pma: /table/chart) */
export const Route = createFileRoute('/s/$server/db/$db/t/$table/chart')({
  validateSearch: visualizationSearch,
  component: function Chart() {
    const { server, db, table } = Route.useParams()
    const s = Route.useSearch()
    return (
      <ChartPage
        key={`${db}.${table}.${s.sql}`}
        scope={{ server, db, table }}
        search={{
          sql: s.sql,
          unlimNumRows: s.unlim_num_rows,
          pos: s.pos,
          sessionMaxRows: s.session_max_rows,
        }}
      />
    )
  },
})
