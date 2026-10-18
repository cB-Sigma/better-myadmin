import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { BinlogPage } from '../../../features/server/InfoPages'
import { qs } from '../../../lib/search'

/** pma: /server/binlog */
export const Route = createFileRoute('/s/$server/binlog')({
  validateSearch: z.object({
    log: qs.strOr(''),
    pos: qs.intOr(0, 0),
    full: qs.flag(),
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
