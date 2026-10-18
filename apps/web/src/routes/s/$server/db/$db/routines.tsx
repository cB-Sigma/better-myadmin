import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { RoutinesPage } from '../../../../../features/database/RoutinesPage'
import { qs } from '../../../../../lib/search'

/** pma: /database/routines */
export const Route = createFileRoute('/s/$server/db/$db/routines')({
  // SpecialSchemaLinks of the Browse grid open an item's editor (edit_item=1&item_name=…)
  validateSearch: z.object({ edit_item: qs.str(), item_name: qs.str(), item_type: qs.str() }),
  component: function Page() {
    const { server, db } = Route.useParams()
    const q = Route.useSearch()
    const editItem =
      q.edit_item !== undefined && q.edit_item !== '' && q.item_name !== undefined
        ? { name: q.item_name, type: q.item_type ?? 'PROCEDURE' }
        : null
    return <RoutinesPage key={db} server={server} db={db} editItem={editItem} />
  },
})
