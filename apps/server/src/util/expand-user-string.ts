import { quoteString } from '@bettermyadmin/sql-gen'
import type { ServerConfig } from '../config.ts'
import type { Conn } from '../db/connection.ts'

/** phpMyAdmin's version string for @PHPMYADMIN@ (Version::VERSION of the reference checkout). */
export const PMA_VERSION_STRING = 'phpMyAdmin 6.0.0-dev'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
const p2 = (n: number) => String(n).padStart(2, '0')

/** PHP strftime() for the C locale (the directives phpMyAdmin users put in templates). */
export function strftime(format: string, d = new Date()): string {
  return format.replace(/%([a-zA-Z%])/g, (m, c: string) => {
    switch (c) {
      case '%':
        return '%'
      case 'a':
        return DAYS[d.getDay()]!.slice(0, 3)
      case 'A':
        return DAYS[d.getDay()]!
      case 'd':
        return p2(d.getDate())
      case 'e':
        return String(d.getDate()).padStart(2, ' ')
      case 'j': {
        const start = new Date(d.getFullYear(), 0, 0)
        return String(Math.floor((d.getTime() - start.getTime()) / 86400000)).padStart(3, '0')
      }
      case 'u':
        return String(d.getDay() === 0 ? 7 : d.getDay())
      case 'w':
        return String(d.getDay())
      case 'b':
      case 'h':
        return MONTHS[d.getMonth()]!.slice(0, 3)
      case 'B':
        return MONTHS[d.getMonth()]!
      case 'm':
        return p2(d.getMonth() + 1)
      case 'y':
        return p2(d.getFullYear() % 100)
      case 'Y':
        return String(d.getFullYear())
      case 'H':
        return p2(d.getHours())
      case 'I':
        return p2(d.getHours() % 12 === 0 ? 12 : d.getHours() % 12)
      case 'M':
        return p2(d.getMinutes())
      case 'S':
        return p2(d.getSeconds())
      case 'p':
        return d.getHours() < 12 ? 'AM' : 'PM'
      case 'P':
        return d.getHours() < 12 ? 'am' : 'pm'
      case 'D':
        return `${p2(d.getMonth() + 1)}/${p2(d.getDate())}/${p2(d.getFullYear() % 100)}`
      case 'F':
        return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
      case 'T':
        return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`
      case 'R':
        return `${p2(d.getHours())}:${p2(d.getMinutes())}`
      case 's':
        return String(Math.floor(d.getTime() / 1000))
      case 'n':
        return '\n'
      case 't':
        return '\t'
      default:
        return m
    }
  })
}

/** PHP strtr($string, $pairs): longest keys first, no re-replacement. */
export function strtr(str: string, pairs: Record<string, string>): string {
  const keys = Object.keys(pairs)
    .filter((k) => k !== '')
    .sort((a, b) => b.length - a.length)
  if (keys.length === 0) return str
  let out = ''
  let i = 0
  outer: while (i < str.length) {
    for (const k of keys) {
      if (str.startsWith(k, i)) {
        out += pairs[k]
        i += k.length
        continue outer
      }
    }
    out += str[i]
    i++
  }
  return out
}

/**
 * Placeholders of DefaultQueryTable / DefaultQueryDatabase (and the title templates).
 * pma: src/Util.php::expandUserString
 */
export async function expandUserString(
  string: string,
  o: {
    conn: Conn
    server: ServerConfig
    db: string
    table: string
    httpHost: string
    escape?: (s: string) => string
  },
): Promise<string> {
  const verbose = o.server.verbose
  const host = String(o.server.host)
  let replace: Record<string, string> = {
    '@HTTP_HOST@': o.httpHost,
    '@SERVER@': host,
    __SERVER__: host,
    '@VERBOSE@': verbose,
    '@VSERVER@': verbose === '' ? host : verbose,
    '@DATABASE@': o.db,
    __DB__: o.db,
    '@TABLE@': o.table,
    __TABLE__: o.table,
    '@PHPMYADMIN@': PMA_VERSION_STRING,
  }
  // Optional escaping
  if (o.escape !== undefined) {
    const esc = o.escape
    replace = Object.fromEntries(Object.entries(replace).map(([k, v]) => [k, esc(v)]))
  }
  // Backward compatibility in 3.5.x
  let s = string.includes('@FIELDS@') ? strtr(string, { '@FIELDS@': '@COLUMNS@' }) : string
  // Fetch columns list if required
  if (s.includes('@COLUMNS@')) {
    const rows = await o.conn.rows(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ${quoteString(o.db)} AND TABLE_NAME = ${quoteString(o.table)} ORDER BY ORDINAL_POSITION`,
      'expand.columns',
    )
    const names = rows.map((r) => r.COLUMN_NAME ?? '')
    replace['@COLUMNS@'] = (o.escape !== undefined ? names.map(o.escape) : names).join(',')
  }
  s = strftime(s)
  return strtr(s, replace)
}
