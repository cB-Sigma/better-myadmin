import type { Lexer } from '../Lexer.ts'
import type { Parser } from '../Parser.ts'
import type { LexerException, ParserException } from '../exceptions.ts'

/** `[message, code, string near the error, position]` */
export type ErrorEntry = [string, number, string, number | null]

/**
 * Gets the errors of a lexer and/or parser in a uniform format.
 */
// pma: vendor/phpmyadmin/sql-parser/src/Utils/Error.php::get
export function getErrors(objs: readonly (Lexer | Parser)[]): ErrorEntry[] {
  const ret: ErrorEntry[] = []
  for (const obj of objs) {
    if ('str' in obj) {
      for (const err of obj.errors as LexerException[]) ret.push([err.message, err.code, err.ch, err.pos])
    } else {
      for (const err of obj.errors as ParserException[]) {
        ret.push([err.message, err.code, err.token?.token ?? '', err.token?.position ?? null])
      }
    }
  }
  return ret
}

function htmlspecialchars(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

/**
 * Formats the specified errors (`#%1$d: %2$s (near "%4$s" at position %5$d)` by default).
 */
// pma: vendor/phpmyadmin/sql-parser/src/Utils/Error.php::format
export function formatErrors(
  errors: readonly ErrorEntry[],
  format: (n: number, message: string, code: number, near: string, pos: number | null) => string = (
    n,
    message,
    _code,
    near,
    pos,
  ) => `#${n}: ${message} (near "${near}" at position ${pos ?? 0})`,
): string[] {
  return errors.map((err, i) => format(i + 1, err[0], err[1], htmlspecialchars(err[2]), err[3]))
}

export { htmlspecialchars }
