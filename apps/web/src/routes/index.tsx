import { createFileRoute, redirect } from '@tanstack/react-router'
import { api } from '../lib/api'
import { qk } from '../lib/queryKeys'

export const Route = createFileRoute('/')({
  beforeLoad: async ({ context }) => {
    const state = await context.queryClient.ensureQueryData({ queryKey: qk.auth, queryFn: api.authState })
    throw redirect({ to: '/s/$server', params: { server: state.server } })
  },
})
