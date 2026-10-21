import { createFileRoute } from '@tanstack/react-router'
import { NotFound } from '../../../../../features/shell/NotFound'

/** Any database-level URL that matches no built page. */
export const Route = createFileRoute('/s/$server/db/$db/$')({ component: NotFound })
