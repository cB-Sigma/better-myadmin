import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { BinlogPage } from '../../../features/server/InfoPages'

/** pma: /server/binlog */
export const Route = createFileRoute('/s/$server/binlog')({
  validateSearch: z.object({
    log: z.string().catch('').default(''),
    pos: z.coerce.number().int().min(0).catch(0).default(0),
    full: z.boolean().catch(false).default(false),
  }),
  component: function Binlog() {
    const { server } = Route.useParams()
    const { log, pos, full } = Route.useSearch()
    const navigate = Route.useNavigate()
    return (
      <BinlogPage
        server={server}
        log={log}
        pos={pos}
        full={full}
        onChange={(s) => void navigate({ search: (p) => ({ ...p, ...s }) })}
      />
    )
  },
})
