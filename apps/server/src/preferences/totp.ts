import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'

/**
 * RFC 6238 time-based one-time passwords as pragmarx/google2fa computes them (SHA1, 6 digits,
 * 30 s period, base32 secrets).
 *
 * pma: vendor pragmarx/google2fa src/Google2FA.php (generateSecretKey, verifyKey, oathTotp,
 *      getQRCodeUrl), src/Plugins/TwoFactor/Application.php (window 8)
 */

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const PERIOD = 30
const DIGITS = 6

/** Google2FA::generateSecretKey(16) */
export function generateSecretKey(length = 16): string {
  let out = ''
  for (let i = 0; i < length; i++) out += BASE32[randomInt(32)]
  return out
}

export function base32Decode(secret: string): Buffer {
  const clean = secret.toUpperCase().replace(/=+$/, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch)
    if (idx === -1) throw new Error('Invalid characters in the base32 string.')
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** Google2FA::oathTotp for one time step */
export function oathTotp(secret: string, counter: number): string {
  const msg = Buffer.alloc(8)
  msg.writeUInt32BE(Math.floor(counter / 0x100000000), 0)
  msg.writeUInt32BE(counter >>> 0, 4)
  const hash = createHmac('sha1', base32Decode(secret)).update(msg).digest()
  const offset = (hash[hash.length - 1] as number) & 0xf
  const code =
    (((hash[offset] as number) & 0x7f) << 24) |
    ((hash[offset + 1] as number) << 16) |
    ((hash[offset + 2] as number) << 8) |
    (hash[offset + 3] as number)
  return String(code % 10 ** DIGITS).padStart(DIGITS, '0')
}

/** Google2FA::verifyKey with a window of `window` periods before and after now. */
export function verifyKey(secret: string, key: string, window = 8, now = Date.now() / 1000): boolean {
  if (secret === '') return false
  const ts = Math.floor(now / PERIOD)
  const given = Buffer.from(key)
  for (let t = ts - window; t <= ts + window; t++) {
    let expected: Buffer
    try {
      expected = Buffer.from(oathTotp(secret, t))
    } catch {
      return false
    }
    if (expected.length === given.length && timingSafeEqual(expected, given)) return true
  }
  return false
}

/** PHP rawurlencode */
const rawurlencode = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

/** Google2FA::getQRCodeUrl */
export function otpauthUrl(company: string, holder: string, secret: string): string {
  return `otpauth://totp/${rawurlencode(company)}:${rawurlencode(holder)}?secret=${secret}&issuer=${rawurlencode(company)}&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD}`
}
