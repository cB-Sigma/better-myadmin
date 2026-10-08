// Temporary local helpers; to be replaced by @bettermyadmin/sql-gen once it lands.

/** mysqli_real_escape_string semantics for utf8mb4 connections, wrapped in single quotes. */
export function quoteString(s: string): string {
  return `'${s.replace(/[\0\n\r\\'"\x1a]/g, (c) => {
    switch (c) {
      case '\0':
        return '\\0'
      case '\n':
        return '\\n'
      case '\r':
        return '\\r'
      case '\x1a':
        return '\\Z'
      default:
        return `\\${c}`
    }
  })}'`
}

/** Util::backquote */
export function backquote(name: string): string {
  return `\`${name.replaceAll('`', '``')}\``
}
