import type { MiddlewareHandler } from 'hono'
import type { AppConfig } from '../config.ts'

/**
 * Response headers (docs/architecture/07-security.md#headers).
 * pma: src/Header.php::getHttpHeaders, getCspHeader
 */
export function securityHeaders(cfg: AppConfig): MiddlewareHandler {
  const allow = cfg.CSPAllow.trim()
  const extra = allow === '' ? '' : ` ${allow}`
  const frameAncestors =
    cfg.AllowThirdPartyFraming === true ? '*' : cfg.AllowThirdPartyFraming === 'sameorigin' ? "'self'" : "'none'"
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'wasm-unsafe-eval'${extra}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${extra} https://tile.openstreetmap.org`,
    `connect-src 'self'${extra}`,
    `frame-ancestors ${frameAncestors}`,
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; ')

  return async (c, next) => {
    await next()
    const h = c.res.headers
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
