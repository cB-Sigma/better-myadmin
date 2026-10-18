import { createFileRoute } from '@tanstack/react-router'
import { GisVisualizationPage } from '../../../../../../../features/gis/GisVisualizationPage'
import { visualizationSearch } from '../../../../../../../features/table/chart/search'

/** Visualize GIS data (pma: /table/gis-visualization) */
export const Route = createFileRoute('/s/$server/db/$db/t/$table/gis-visualization')({
  validateSearch: visualizationSearch,
  component: function Gis() {
    const { server, db, table } = Route.useParams()
    const s = Route.useSearch()
    return (
      <GisVisualizationPage
        key={`${db}.${table}.${s.sql}`}
        scope={{ server, db, table }}
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
