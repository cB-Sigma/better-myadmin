import { createFileRoute } from '@tanstack/react-router'
import { ChartPage } from '../../../features/table/chart/ChartPage'
import { visualizationSearch } from '../../../features/table/chart/search'

/** Display chart of a server-level result (pma: /table/chart without db) */
export const Route = createFileRoute('/s/$server/chart')({
  validateSearch: visualizationSearch,
  component: function Chart() {
    const { server } = Route.useParams()
    const s = Route.useSearch()
    return (
      <ChartPage
        key={s.sql}
        scope={{ server }}
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
