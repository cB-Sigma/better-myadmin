import { createFileRoute, redirect } from '@tanstack/react-router'
import { defaultTablePath } from '../../../../../../../features/shell/tabs.ts'
import { api } from '../../../../../../../lib/api.ts'
import { DEFAULT_CLIENT_CONFIG } from '../../../../../../../lib/config.ts'
import { qk } from '../../../../../../../lib/queryKeys.ts'

/** `/s/:s/db/:db/t/:table` opens $cfg['DefaultTabTable'] (Browse by default). */
export const Route = createFileRoute('/s/$server/db/$db/t/$table/')({
  beforeLoad: async ({ context, params }) => {
    const cfg = await context.queryClient
      .ensureQueryData({ queryKey: qk.config, queryFn: api.configPublic })
      .catch(() => DEFAULT_CLIENT_CONFIG)
    const path = defaultTablePath(String(cfg.DefaultTabTable ?? DEFAULT_CLIENT_CONFIG.DefaultTabTable))
    throw redirect({ to: '/s/$server/db/$db/t/$table/$', params: { ...params, _splat: path }, replace: true })
  },
})
