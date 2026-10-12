/**
 * `SignonScript` example: BetterMyAdmin imports this module and calls `getLoginCredentials(user)`
 * with the server's configured `user` on every page load; it returns `[user, password]` (or a
 * promise of it). An empty user redirects to SignonURL. The port of phpMyAdmin's
 * examples/signon-script.php (where the PHP function is `get_login_credentials`).
 *
 *   Servers: [{ auth_type: 'signon', SignonScript: './apps/server/examples/signon-script.ts', SignonURL: '…' }]
 *
 * A relative path is resolved against BetterMyAdmin's working directory. A `.ts` module needs a
 * TypeScript-aware Node (≥ 22.18 or tsx), a `.mjs` / `.js` one works everywhere.
 *
 * pma: examples/signon-script.php
 */
export function getLoginCredentials(user: string): [string, string] {
  // this would usually check the request (a header set by a reverse proxy, a ticket, …)
  return [user, process.env.SIGNON_PASSWORD ?? '']
}
