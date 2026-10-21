import { createFileRoute } from '@tanstack/react-router'
import { NotFound } from '../../../features/shell/NotFound'

/** Any server-level URL that matches no built page (a mistyped address or a stale bookmark). */
export const Route = createFileRoute('/s/$server/$')({ component: NotFound })
