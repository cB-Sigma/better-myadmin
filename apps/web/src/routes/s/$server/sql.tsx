import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { SqlPage } from '../../../features/sql/SqlPage'

export const Route = createFileRoute('/s/$server/sql')({
  validateSearch: z.object({ sql: z.string().optional() }),
  component: SqlPage,
})
