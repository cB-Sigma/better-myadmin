/**
 * phpMyAdmin's message markup: `[em] [strong] [code] [kbd] [br] [sup] [a@url@target] [doc@page@anchor]
 * [doc@anchor] [dochelpicon]` → HTML. Messages and translations use it ("Please refer to
 * [doc@cfg_MaxExactCount]documentation[/doc]"), so the server and the web app render it identically.
 *
 * pma: src/Sanitize.php::convertBBCode, ::checkLink, ::replaceBBLink, ::replaceDocLink;
 *      src/Html/MySQLDocumentation.php::getDocumentationLink; src/Core.php::linkURL;
 *      src/Html/Generator.php::getImage. (There is no Sanitize::sanitizeMessage in phpMyAdmin 6.)
 */
import { htmlspecialchars } from './php.ts'
import type { Gettext } from './translator.ts'

export interface BBCodeOptions {
  /**
   * Core::linkURL: external links go through the `/url` redirector. Default: phpMyAdmin's
   * `index.php?route=/url&url=<urlencoded>`.
   */
  linkUrl?: (url: string) => string
  /** Base of documentation links (getDocumentationLink without a local docs build). */
  docsBase?: string
  /** Sanitize::isSetup() */
  isSetup?: boolean
}

/** PHP urlencode (application/x-www-form-urlencoded, `~` encoded as in http_build_query). */
export function phpUrlencode(s: string): string {
  return Array.from(new TextEncoder().encode(s), (b) => {
    const c = String.fromCharCode(b)
    if (/[A-Za-z0-9_.-]/.test(c)) return c
    if (c === ' ') return '+'
    return `%${b.toString(16).toUpperCase().padStart(2, '0')}`
  }).join('')
}

/** Core::linkURL */
export function pmaLinkUrl(url: string, isSetup = false): string {
  if (!/^https?:\/\//.test(url)) return url
  const query = `url=${phpUrlencode(url)}`
  return isSetup ? `../index.php?route=/url&${query}` : `index.php?route=/url&${query}`
}

/** Sanitize::checkLink */
export function checkLink(url: string, http = false, other = false, isSetup = false): boolean {
  const u = url.toLowerCase()
  let validStarts = ['https://', 'index.php?route=/url&url=https%3a%2f%2f', './docs/html/', './index.php?']
  if (isSetup) validStarts = validStarts.map((v) => (v.startsWith('./') ? `.${v}` : v))
  if (other) validStarts.push('mailto:', 'ftp://')
  if (http) validStarts.push('http://')
  if (isSetup) validStarts.push('?page=form&', '?page=servers&')
  return validStarts.some((v) => u.startsWith(v))
}

/** PHP empty() on a preg match group */
const phpEmpty = (s: string | undefined) => s === undefined || s === '' || s === '0'

/**
 * BetterMyAdmin's documentation (docs-site/, published by .github/workflows/docs.yml), with
 * phpMyAdmin's page and anchor names; phpMyAdmin links https://docs.phpmyadmin.net/en/latest/
 * (parity exception X57). The same base as @bettermyadmin/ui's DOCS_BASE.
 */
export const DOCS_BASE = 'https://cb-sigma.github.io/better-myadmin/'

/** MySQLDocumentation::getDocumentationLink (no local docs build) */
export function getDocumentationLink(
  page: string,
  anchor = '',
  opts: Pick<BBCodeOptions, 'linkUrl' | 'docsBase' | 'isSetup'> = {},
): string {
  let url = `${page}.html`
  if (anchor !== '') url += `#${anchor}`
  const link = opts.linkUrl ?? ((u: string) => pmaLinkUrl(u, opts.isSetup))
  return link((opts.docsBase ?? DOCS_BASE) + url)
}

/** Sanitize::convertBBCode */
export function convertBBCode(tr: Gettext, message: string, safe = false, opts: BBCodeOptions = {}): string {
  let msg = message
  if (!safe) {
    msg = msg.replace(/[<>"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c]!)
  }
  const pairs: Record<string, string> = {
    '[em]': '<em>',
    '[/em]': '</em>',
    '[strong]': '<strong>',
    '[/strong]': '</strong>',
    '[code]': '<code>',
    '[/code]': '</code>',
    '[kbd]': '<kbd>',
    '[/kbd]': '</kbd>',
    '[br]': '<br>',
    '[/a]': '</a>',
    '[/doc]': '</a>',
    '[sup]': '<sup>',
    '[/sup]': '</sup>',
    // Html\Generator::getImage('b_help', __('Documentation'))
    '[dochelpicon]': (() => {
      const alt = htmlspecialchars(tr.gettext('Documentation'))
      return `<img src="themes/dot.gif" title="${alt}" alt="${alt}" class="icon ic_b_help">`
    })(),
  }
  // strtr: longest key first, no rescanning of replaced text
  msg = msg.replace(
    /\[\/strong\]|\[dochelpicon\]|\[strong\]|\[\/code\]|\[\/doc\]|\[\/kbd\]|\[\/sup\]|\[code\]|\[\/em\]|\[kbd\]|\[sup\]|\[em\]|\[br\]|\[\/a\]/g,
    (m) => pairs[m]!,
  )

  const linkUrl = opts.linkUrl ?? ((u: string) => pmaLinkUrl(u, opts.isSetup))
  msg = msg.replace(
    /\[a@([^\]"@]*)(@([^\]"]*))?\]/g,
    (found, url: string, _g2, target: string | undefined) => {
      if (!checkLink(url, false, false, opts.isSetup)) return found
      if (!phpEmpty(target) && /[^a-z_]+/i.test(target!)) return found
      let attr = ''
      if (!phpEmpty(target)) {
        attr = ` target="${target}"`
        if (target === '_blank') attr += ' rel="noopener noreferrer"'
      }
      const href = url.startsWith('http') ? linkUrl(url) : url
      return `<a href="${href}"${attr}>`
    },
  )

  return msg.replace(
    /\[doc@([a-zA-Z0-9_-]+)(@([a-zA-Z0-9_-]*))?\]/g,
    (_m, first: string, g2: string | undefined, g3: string | undefined) => {
      let page: string
      let anchor: string
      if (g2 !== undefined) {
        page = first
        anchor = g3 ?? ''
      } else {
        anchor = first
        if (anchor.startsWith('faq')) page = 'faq'
        else if (anchor.startsWith('cfg')) page = 'config'
        else page = 'setup'
      }
      return `<a href="${getDocumentationLink(page, anchor, { ...opts, linkUrl })}" target="documentation">`
    },
  )
}
