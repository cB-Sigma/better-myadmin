import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { AddColumnsPage } from '../../../../../../../features/table/structure/ColumnPages'

/** Add column(s) (pma: /table/add-field with num_fields, field_where, after_field) */
export const Route = createFileRoute('/s/$server/db/$db/t/$table/structure_/add')({
  validateSearch: z.object({
    num: z.coerce.number().optional(),
    where: z.enum(['first', 'after', 'last']).optional(),
    after: z.coerce.string().optional(),
  }),
  component: function Add() {
    const { server, db, table } = Route.useParams()
    const s = Route.useSearch()
    return (
      <AddColumnsPage
        scope={{ server, db, table }}
        num={s.num ?? 1}
        where={s.where ?? 'last'}
        after={s.after ?? ''}
      />
    )
  },
})
