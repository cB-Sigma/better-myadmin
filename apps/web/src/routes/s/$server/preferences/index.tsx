import { createFileRoute, redirect } from '@tanstack/react-router'

/** `/s/:s/preferences` opens the Settings landing (Manage your settings), like the Settings menu. */
export const Route = createFileRoute('/s/$server/preferences/')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/s/$server/preferences/manage', params, replace: true })
  },
})
