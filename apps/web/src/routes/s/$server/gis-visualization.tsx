import { createFileRoute } from '@tanstack/react-router'
import { GisVisualizationPage } from '../../../features/gis/GisVisualizationPage'
import { visualizationSearch } from '../../../features/table/chart/search'

/** Visualize GIS data of a server-level result (pma: "Missing parameter: db") */
export const Route = createFileRoute('/s/$server/gis-visualization')({
  validateSearch: visualizationSearch,
  component: function Gis() {
    const { server } = Route.useParams()
    const s = Route.useSearch()
    return (
      <GisVisualizationPage
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
