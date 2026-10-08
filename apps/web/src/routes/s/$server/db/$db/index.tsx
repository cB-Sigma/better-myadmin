import { createFileRoute } from '@tanstack/react-router'
import { NotImplemented } from '../../../../../features/shell/NotImplemented'

/** Database scope default tab (Structure); placeholder until the database scope lands. */
export const Route = createFileRoute('/s/$server/db/$db/')({
  component: function DatabaseIndex() {
    const { db } = Route.useParams()
    return (
      <div className="flex flex-col gap-2">
        <h2 className="text-base font-semibold" data-testid="scope-db">
          Database: {db}
        </h2>
        <NotImplemented />
      </div>
    )
  },
})
