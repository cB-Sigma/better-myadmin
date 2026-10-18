import type { MiddlewareHandler } from 'hono'
import { captchaCsp } from '../auth/captcha.ts'
import type { AppConfig } from '../config.ts'

/** The request reached us over HTTPS (directly or through a TLS-terminating proxy). */
export function isHttpsRequest(forwardedProto: string | undefined, url: string): boolean {
  const proto = forwardedProto ?? new URL(url).protocol.replace(':', '')
  return proto.split(',')[0]?.trim() === 'https'
}

/**
 * Response headers (docs/architecture/07-security.md#headers).
 * pma: src/Header.php::getHttpHeaders, getCspHeader
 */
export function securityHeaders(cfg: AppConfig): MiddlewareHandler {
  const allow = cfg.CSPAllow.trim()
  // the captcha hosts come first, like Header::getCspHeader ($captchaUrl . $cspAllow)
  const extra = captchaCsp(cfg) + (allow === '' ? '' : ` ${allow}`)
  const frameAncestors =
    cfg.AllowThirdPartyFraming === true
      ? '*'
      : cfg.AllowThirdPartyFraming === 'sameorigin'
        ? "'self'"
        : "'none'"
  const csp = [
    `default-src 'self'${captchaCsp(cfg)}`,
    `script-src 'self' 'wasm-unsafe-eval'${extra}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${extra} https://tile.openstreetmap.org`,
    `connect-src 'self'${extra}`,
    `frame-ancestors ${frameAncestors}`,
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; ')

  return async (c, next) => {
    // ForceSSL (X22): a plain HTTP request is sent to the same URL over HTTPS
    const https = isHttpsRequest(c.req.header('x-forwarded-proto'), c.req.url)
    if (cfg.ForceSSL && !https) {
      const u = new URL(c.req.url)
      u.protocol = 'https:'
      const host = c.req.header('x-forwarded-host') ?? c.req.header('host')
      if (host !== undefined) u.host = host
      return c.redirect(u.toString(), 301)
    }
    await next()
    const h = c.res.headers
    if (cfg.ForceSSL) h.set('Strict-Transport-Security', 'max-age=31536000')
    h.set('X-XSS-Protection', '1; mode=block')
    h.set('Content-Security-Policy', csp)
    if (cfg.AllowThirdPartyFraming === false) h.set('X-Frame-Options', 'DENY')
    else if (cfg.AllowThirdPartyFraming === 'sameorigin') h.set('X-Frame-Options', 'SAMEORIGIN')
    h.set('X-Content-Type-Options', 'nosniff')
    h.set('Referrer-Policy', 'same-origin')
    h.set('X-Permitted-Cross-Domain-Policies', 'none')
    h.set('X-Robots-Tag', 'noindex, nofollow')
    h.set('Permissions-Policy', 'fullscreen=(self), interest-cohort=()')
    if (c.req.path.startsWith('/api/')) h.set('Cache-Control', 'no-store')
  }
}
