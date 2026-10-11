import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { ChangeColumnsPage } from '../../../../../../../features/table/structure/ColumnPages'

/** Change column(s) (pma: /table/structure/change) */
export const Route = createFileRoute('/s/$server/db/$db/t/$table/structure_/change')({
  validateSearch: z.object({ fields: z.union([z.coerce.string(), z.array(z.coerce.string())]).optional() }),
  component: function Change() {
    const { server, db, table } = Route.useParams()
    const { fields } = Route.useSearch()
    const list = fields === undefined ? [] : Array.isArray(fields) ? fields : [fields]
    return <ChangeColumnsPage key={list.join('\u0000')} scope={{ server, db, table }} fields={list} />
  },
})
