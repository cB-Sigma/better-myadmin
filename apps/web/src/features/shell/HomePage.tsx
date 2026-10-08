import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { api } from '../../lib/api'
import { qk } from '../../lib/queryKeys'

/** Home page placeholder; the full set of blocks (pma: HomeController) lands in M1. */
export function HomePage() {
  const { server } = useParams({ from: '/s/$server' })
  const auth = useQuery({ queryKey: qk.auth, queryFn: api.authState })
  return (
    <section className="max-w-3xl rounded border border-border">
      <h2 className="border-b border-border bg-bg-subtle px-3 py-2 text-sm font-semibold">Database server</h2>
      <ul className="list-disc space-y-1 px-8 py-3 text-sm">
        <li>Server: {auth.data?.servers.find((s) => s.index === server)?.label}</li>
        <li>User: {auth.data?.user}</li>
      </ul>
    </section>
  )
}
