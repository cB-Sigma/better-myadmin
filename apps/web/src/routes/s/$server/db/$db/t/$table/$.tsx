import { createFileRoute } from '@tanstack/react-router'
import { NotFound } from '../../../../../../../features/shell/NotFound'

/** Any table-level URL that matches no built page. */
export const Route = createFileRoute('/s/$server/db/$db/t/$table/$')({ component: NotFound })
