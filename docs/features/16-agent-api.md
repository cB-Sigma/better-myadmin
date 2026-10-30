# 16 — Agent API and MCP (BetterMyAdmin only, X60)

phpMyAdmin has no API for programs. BetterMyAdmin adds a small JSON API and an MCP endpoint for AI
agents and scripts, off unless `AgentApi` (user docs: `docs-site/agents.rst`).

| Concern | Where |
|---|---|
| Routes, mounted at `/api/agent` before the session and CSRF middlewares | `apps/server/src/agent/routes.ts`, `apps/server/src/app.ts` |
| Authentication per request | `apps/server/src/agent/auth.ts` |
| Operations | `apps/server/src/agent/service.ts` |
| MCP (JSON-RPC over POST, protocol 2025-06-18 / 2025-03-26 / 2024-11-05) | `apps/server/src/agent/mcp.ts` |
| Tests | `apps/server/test/int/agent-api.test.ts` |

- **Credentials** by `auth_type`: `config` the configured user; `cookie` / `http` HTTP Basic;
  `signon` the SignonPage module's optional `agentCredentials(request, {server, clientIp})` export.
  Then `checkRules` (AllowDeny, AllowRoot, AllowNoPassword) and the login limiter (`LoginRateLimit`,
  per IP and user), as a login. Access denied (1044/1045/1698) is a 401 and counts as a failure.
- **Connections**: a pool per credential set (`agent:<sha256(server, user, password)>`), outside the
  session sweep, closed when idle (`ConnectionPool.idleTimeout`).
- **Cross-site**: an `Origin` of another host is refused; a POST must be `application/json`.
- **Query**: `splitSql` like the SQL box, `USE db`, the SQL box's LIMIT rule (`isAppendLimitClause`,
  one row more to report `truncated`), `AllowUserDropDatabase`, stop at the first error. Values as
  the server's text, binary (`charsetnr` 63 on string types) as base64.
- **Not recorded** in the SQL history or the console: there is no session to show it in.
