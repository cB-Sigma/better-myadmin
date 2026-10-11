/**
 * Documentation URL builders, identical to phpMyAdmin's (minus the `/url` redirector, which our
 * `Referrer-Policy: same-origin` + `rel=noreferrer` makes unnecessary).
 */

/**
 * phpMyAdmin documentation (we document the same directives, so links keep pointing there).
 * pma: src/Html/MySQLDocumentation.php::getDocumentationLink (no local docs/html build)
 */
export function pmaDocUrl(page: string, anchor = ''): string {
  return `https://docs.phpmyadmin.net/en/latest/${page}.html${anchor !== '' ? `#${anchor}` : ''}`
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

/**
 * PHP manual language mapping, kept for completeness of the doc-link conventions.
 * pma: src/Core.php::getPHPDocLink
 */
export function phpDocUrl(target: string, lang = 'en'): string {
  const map: Record<string, string> = {
    pt_BR: 'pt_BR',
    zh_CN: 'zh',
    zh_TW: 'zh',
    fr: 'fr',
    de: 'de',
    ja: 'ja',
    ru: 'ru',
    es: 'es',
    tr: 'tr',
  }
  return `https://www.php.net/manual/${map[lang] ?? 'en'}/${target}`
}
