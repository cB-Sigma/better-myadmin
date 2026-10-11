import { createFileRoute, redirect } from '@tanstack/react-router'
import { defaultDatabasePath } from '../../../../../features/shell/tabs.ts'
import { api } from '../../../../../lib/api.ts'
import { DEFAULT_CLIENT_CONFIG } from '../../../../../lib/config.ts'
import { qk } from '../../../../../lib/queryKeys.ts'

/** `/s/:s/db/:db` opens $cfg['DefaultTabDatabase'] (database structure by default). */
export const Route = createFileRoute('/s/$server/db/$db/')({
  beforeLoad: async ({ context, params }) => {
    const cfg = await context.queryClient
      .ensureQueryData({ queryKey: qk.config, queryFn: api.configPublic })
      .catch(() => DEFAULT_CLIENT_CONFIG)
    const path = defaultDatabasePath(
      String(cfg.DefaultTabDatabase ?? DEFAULT_CLIENT_CONFIG.DefaultTabDatabase),
    )
    throw redirect({ to: '/s/$server/db/$db/$', params: { ...params, _splat: path }, replace: true })
  },
})
