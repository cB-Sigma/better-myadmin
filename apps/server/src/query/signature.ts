import { hmacSha256Hex, safeEqual } from '../session/crypto.ts'

/**
 * Signed SQL for URLs: hash_hmac('sha256', sql, $_SESSION[' HMAC_secret '] . blowfish_secret).
 * pma: src/Core.php::signSqlQuery / checkSqlQuerySignature
 */
export function signSql(sql: string, sessionSecret: string, blowfishSecret: string): string {
  return hmacSha256Hex(sessionSecret + blowfishSecret, sql)
}

export function checkSqlSignature(
  sql: string,
  sig: string,
  sessionSecret: string,
  blowfishSecret: string,
): boolean {
  return safeEqual(signSql(sql, sessionSecret, blowfishSecret), sig)
}
