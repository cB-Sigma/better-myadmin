/**
 * Single signon example: a tiny login application handing credentials to BetterMyAdmin through
 * the `SignonSession` cookie (`auth_type = 'signon'`), the port of phpMyAdmin's examples/signon.php.
 *
 *   BMA_SECRET=<BetterMyAdmin's blowfish_secret> npx tsx apps/server/examples/signon.ts
 *
 * BetterMyAdmin configuration (the example listens on :8090, BetterMyAdmin on :8080, one host so
 * the cookie is shared):
 *
 *   Servers: [{ auth_type: 'signon', SignonSession: 'SignonSession', SignonURL: 'http://localhost:8090/' }]
 *
 * pma: examples/signon.php
 */
import { createServer } from 'node:http'
import { decodeSignonSession, encodeSignonSession } from '../src/auth/signon.ts'

const secret = process.env.BMA_SECRET ?? ''
const sessionName = 'SignonSession'
const bma = process.env.BMA_URL ?? 'http://localhost:8080/'

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const cookieOf = (header: string | undefined, name: string) =>
  header
    ?.split(';')
    .map((p) => p.trim().split('='))
    .find(([k]) => k === name)?.[1]

createServer((req, res) => {
  if (req.method === 'POST') {
    let body = ''
    req.on('data', (d) => {
      body += d
    })
    req.on('end', () => {
      const f = new URLSearchParams(body)
      // store the credentials, and update another field of the server configuration
      const value = encodeSignonSession(secret, {
        PMA_single_signon_user: f.get('user') ?? '',
        PMA_single_signon_password: f.get('password') ?? '',
        ...(f.get('host') ? { PMA_single_signon_host: f.get('host') as string } : {}),
        ...(f.get('port') ? { PMA_single_signon_port: f.get('port') as string } : {}),
        PMA_single_signon_cfgupdate: { verbose: 'Signon test' },
      })
      // the cookie parameters must match SignonCookieParams (path '/', httponly here)
      res.writeHead(302, {
        'Set-Cookie': `${sessionName}=${value}; Path=/; HttpOnly; SameSite=Lax`,
        Location: bma,
      })
      res.end()
    })
    return
  }
  const value = cookieOf(req.headers.cookie, sessionName)
  const error =
    value === undefined ? undefined : decodeSignonSession(secret, value)?.PMA_single_signon_error_message
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(`<!DOCTYPE HTML>
<html lang="en" dir="ltr">
<head><meta charset="utf-8"><title>BetterMyAdmin single signon example</title></head>
<body>
${error !== undefined ? `<p class="error">${esc(error)}</p>` : ''}
<form action="/" method="post">
Username: <input type="text" name="user" autocomplete="username" spellcheck="false"><br>
Password: <input type="password" name="password" autocomplete="current-password" spellcheck="false"><br>
Host: (will use the one from the configuration by default) <input type="text" name="host"><br>
Port: (will use the one from the configuration by default) <input type="text" name="port"><br>
<input type="submit">
</form>
</body>
</html>`)
}).listen(Number(process.env.PORT ?? 8090))
