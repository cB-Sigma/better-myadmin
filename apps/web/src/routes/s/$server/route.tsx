import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { ServerShell } from '../../../features/shell/ServerShell'

export const Route = createFileRoute('/s/$server')({
  params: {
    parse: (p) => ({ server: z.coerce.number().int().positive().parse(p.server) }),
    stringify: (p) => ({ server: String(p.server) }),
  },
  component: ServerShell,
})
