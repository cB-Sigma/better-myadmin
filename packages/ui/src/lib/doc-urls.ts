/**
 * Documentation URL builders, identical to phpMyAdmin's (minus the `/url` redirector, which our
 * `Referrer-Policy: same-origin` + `rel=noreferrer` makes unnecessary).
 */

/**
 * BetterMyAdmin's documentation (docs-site/, published to GitHub Pages by .github/workflows/docs.yml),
 * which keeps phpMyAdmin's page and anchor names (`config.html#cfg_<Directive>`, `faq.html#faq1-16`);
 * phpMyAdmin links https://docs.phpmyadmin.net/en/latest/ (parity exception X57). The same base as
 * @bettermyadmin/i18n's DOCS_BASE (BBCode `[doc@…]` links).
 */
export const DOCS_BASE = 'https://cb-sigma.github.io/better-myadmin/'

/** A documentation page (and anchor). pma: src/Html/MySQLDocumentation.php::getDocumentationLink */
export function pmaDocUrl(page: string, anchor = ''): string {
  return `${DOCS_BASE}${page}.html${anchor !== '' ? `#${anchor}` : ''}`
}

/**
 * MySQL reference manual URL for the connected server version.
 * pma: src/Util.php::getMySQLDocuURL
 */
export function mysqlDocUrl(link: string, anchor = '', serverVersion = 0): string {
  let page = link.toLowerCase().replaceAll('_', '-')
  if (page === '') page = 'index'
  let mysql = '5.7'
  if (serverVersion >= 90000) mysql = '9.0'
  else if (serverVersion >= 80000) mysql = '8.0'
  const section = page === 'server-error-reference' ? 'mysql-errors' : 'refman'
  return `https://dev.mysql.com/doc/${section}/${mysql}/en/${page}.html${anchor !== '' ? `#${anchor}` : ''}`
}

/** pma: src/Util.php::getDocuURL */
export function serverDocUrl(isMariaDb: boolean, serverVersion = 0): string {
  return isMariaDb ? 'https://mariadb.com/kb/en/documentation/' : mysqlDocUrl('', '', serverVersion)
}
