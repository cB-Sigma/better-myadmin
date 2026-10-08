/**
 * Documentation links.
 * pma: src/Util.php::getMySQLDocuURL, src/Html/MySQLDocumentation.php::getDocumentationLink
 */
export function mysqlDocUrl(link: string, anchor = '', versionInt = 0): string {
  let page = link.toLowerCase().replaceAll('_', '-')
  if (page === '') page = 'index'
  const mysql = versionInt >= 90000 ? '9.0' : versionInt >= 80000 || versionInt === 0 ? '8.0' : '5.7'
  const section = page === 'server-error-reference' ? 'mysql-errors' : 'refman'
  return `https://dev.mysql.com/doc/${section}/${mysql}/en/${page}.html${anchor !== '' ? `#${anchor}` : ''}`
}

/** phpMyAdmin documentation (e.g. ('faq', 'faq6-40')). */
export function pmaDocUrl(page: string, anchor = ''): string {
  return `https://docs.phpmyadmin.net/en/latest/${page}.html${anchor !== '' ? `#${anchor}` : ''}`
}
