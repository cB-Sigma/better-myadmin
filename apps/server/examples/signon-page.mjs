/**
 * `SignonPage` example: the login page of a signon server, served by BetterMyAdmin itself at
 * SignonURL's path (parity exception X54). The in-process counterpart of examples/signon.ts /
 * phpMyAdmin's examples/signon.php: a form whose credentials go into the SignonSession.
 *
 *   Servers: [{ auth_type: 'signon', SignonSession: 'SignonSession', SignonURL: '/signon/',
 *               LogoutURL: '/signon/?logout', SignonPage: './apps/server/examples/signon-page.mjs' }]
 *
 * The module exports a function (default or `signonPage`) taking the request and a context with
 * the current SignonSession and `sessionCookie(data)`, the Set-Cookie value that stores one
 * (`null` clears it). A relative path is resolved against BetterMyAdmin's working directory.
 *
 * pma: examples/signon.php
 */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

export default async function signonPage(request, { session, sessionCookie }) {
  const url = new URL(request.url)
  if (url.searchParams.has('logout')) {
    return new Response(null, {
      status: 302,
      headers: { 'Set-Cookie': sessionCookie(null), Location: url.pathname },
    })
  }
  if (request.method === 'POST') {
    const form = new URLSearchParams(await request.text())
    const cookie = sessionCookie({
      PMA_single_signon_user: form.get('user') ?? '',
      PMA_single_signon_password: form.get('password') ?? '',
    })
    return new Response(null, { status: 302, headers: { 'Set-Cookie': cookie, Location: '/' } })
  }
  const error = session?.PMA_single_signon_error_message
  return new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>BetterMyAdmin single signon example</title></head>
<body>${error === undefined ? '' : `<p class="error">${esc(error)}</p>`}
<form action="${esc(url.pathname)}" method="post">
<label>User: <input type="text" name="user" autocomplete="username"></label>
<label>Password: <input type="password" name="password" autocomplete="current-password"></label>
<input type="submit"></form></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}
