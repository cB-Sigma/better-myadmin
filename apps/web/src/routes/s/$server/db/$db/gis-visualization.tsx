import { createFileRoute } from '@tanstack/react-router'
import { GisVisualizationPage } from '../../../../../features/gis/GisVisualizationPage'
import { visualizationSearch } from '../../../../../features/table/chart/search'

/** Visualize GIS data of a result without a table (pma: /table/gis-visualization with db only) */
export const Route = createFileRoute('/s/$server/db/$db/gis-visualization')({
  validateSearch: visualizationSearch,
  component: function Gis() {
    const { server, db } = Route.useParams()
    const s = Route.useSearch()
    return (
      <GisVisualizationPage
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
