import { createFileRoute } from '@tanstack/react-router'
import { NotImplemented } from '../../../../features/shell/NotImplemented'

/** The Monitor (another milestone) */
export const Route = createFileRoute('/s/$server/status/$')({ component: NotImplemented })
