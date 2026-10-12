/**
 * Pure helpers of the change-password dialog (unit-tested).
 * pma: resources/js/modules/functions.ts::checkPassword, suggestPassword, checkPasswordStrength
 */

/** suggestPassword: 16 characters from this alphabet (note phpMyAdmin's "…WYXZ" order). */
import { t } from '../../../lib/i18n'
export const PASSWORD_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWYXZ@!_.*/()[]-'

export function suggestPassword(random: (n: number) => Int32Array = defaultRandom): string {
  const words = random(16)
  let out = ''
  for (let i = 0; i < 16; i++) out += PASSWORD_CHARS.charAt(Math.abs(words[i] ?? 0) % PASSWORD_CHARS.length)
  return out
}

function defaultRandom(n: number): Int32Array {
  const a = new Int32Array(n)
  crypto.getRandomValues(a)
  return a
}

/** checkPassword: the alert text, or null when the form may be submitted. */
export function checkPassword(noPassword: boolean, pw: string, pw2: string): string | null {
  if (noPassword) return null
  if (pw === '') return 'The password is empty!'
  if (pw !== pw2) return "The passwords aren't the same!"
  return null
}

/** Strength labels for zxcvbn scores 0–4 (Messages.strExtrWeak … strStrong). */
/** checkPasswordStrength: the zxcvbn score (0 to 4) as text, '' before anything was typed. */
export function strengthLabel(score: number | null): string {
  switch (score) {
    case 0:
      return t('Extremely weak')
    case 1:
      return t('Very weak')
    case 2:
      return t('Weak')
    case 3:
      return t('Good')
    case 4:
      return t('Strong')
    default:
      return ''
  }
}

/** Words that must not make a password look strong (checkPasswordStrength's custom dictionary). */
export function strengthDictionary(username: string): string[] {
  const dict = ['phpmyadmin', 'mariadb', 'mysql', 'php', 'my', 'admin']
  if (username !== '') dict.push(username)
  return dict
}

/** zxcvbn-ts is loaded on first use (it is not part of the initial bundle). */
export async function passwordScore(value: string, username: string): Promise<number> {
  const { zxcvbn, zxcvbnOptions } = await import('@zxcvbn-ts/core')
  zxcvbnOptions.setOptions({ dictionary: { userInputs: strengthDictionary(username) } })
  return zxcvbn(value).score
}

/** Messages.strPasswordEmptyWhenAllowNoPasswordIsEnabled (msgid, inline <code>) */
export const EMPTY_WITH_ALLOW_NO_PASSWORD_OFF =
  'You are trying to set this account to log in with no password, but the configuration directive <code>AllowNoPassword</code> is false. If you proceed, the account will not be able to log in through phpMyAdmin.'

/** change_password.twig #ssl_reqd_warning_cp (msgid, inline <em>) */
export const SHA256_NOTICE =
  "This method requires using an '<em>SSL connection</em>' or an '<em>unencrypted connection that encrypts the password using RSA</em>'; while connecting to the server."
