import { createFileRoute } from '@tanstack/react-router'
import { NotImplemented } from '../../../../../features/shell/NotImplemented'

/** Database pages behind tabs that are not built yet. */
export const Route = createFileRoute('/s/$server/db/$db/$')({ component: NotImplemented })
