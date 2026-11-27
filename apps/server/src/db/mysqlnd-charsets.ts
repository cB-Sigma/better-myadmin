import { MysqlError } from '../http/errors.ts'

/**
 * The character set names mysqli::set_charset accepts: mysqlnd looks a name up in its own charset
 * table (ignoring case) and fails with "Invalid character set was provided" before it sends
 * `SET NAMES <name>`. Probed by scripts/gen-mysqlnd-charsets.php (test/unit/fixtures).
 */
export const MYSQLND_CHARSETS: ReadonlySet<string> = new Set([
  'armscii8',
  'ascii',
  'big5',
  'binary',
  'cp1250',
  'cp1251',
  'cp1256',
  'cp1257',
  'cp850',
  'cp852',
  'cp866',
  'cp932',
  'dec8',
  'eucjpms',
  'euckr',
  'filename',
  'gb18030',
  'gb2312',
  'gbk',
  'geostd8',
  'greek',
  'hebrew',
  'hp8',
  'keybcs2',
  'koi8r',
  'koi8u',
  'latin1',
  'latin2',
  'latin5',
  'latin7',
  'macce',
  'macroman',
  'sjis',
  'swe7',
  'tis620',
  'ucs2',
  'ujis',
  'utf16',
  'utf16le',
  'utf32',
  'utf8',
  'utf8mb4',
])

/**
 * DatabaseInterface::setCharset → mysqli::set_charset: `SET NAMES <name>` for a name mysqlnd
 * knows (sent as given), nothing for one it does not. Returns false when mysqlnd refuses the name
 * or the server refuses the statement (e.g. ucs2 as a client character set).
 * pma: src/Dbal/DbiMysqli.php::setCharset
 */
export async function setCharset(
  conn: { query(sql: string, label: string): Promise<unknown> },
  charset: string,
  label: string,
): Promise<boolean> {
  if (!MYSQLND_CHARSETS.has(charset.toLowerCase())) return false
  return conn.query(`SET NAMES ${charset}`, label).then(
    () => true,
    (e: unknown) => {
      if (e instanceof MysqlError) return false
      throw e
    },
  )
}
