import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Symmetric encryption for credentials at rest (AES-256-GCM). The key is derived from
 * `blowfish_secret` with HKDF so the secret itself is never used directly.
 *
 * phpMyAdmin encrypts with libsodium secretbox into a cookie (src/Plugins/Auth/AuthenticationCookie.php);
 * we keep the ciphertext server-side (parity exception: credentials are not in the cookie).
 */
export class SecretBox {
  readonly #key: Buffer

  constructor(secret: string | Buffer, purpose: string) {
    const ikm = typeof secret === 'string' ? Buffer.from(secret, 'utf8') : secret
    this.#key = Buffer.from(hkdfSync('sha256', ikm, 'bettermyadmin', purpose, 32))
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv)
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64url')
  }

  /** Returns null when the payload was tampered with or encrypted with another key. */
  decrypt(payload: string): string | null {
    try {
      const buf = Buffer.from(payload, 'base64url')
      if (buf.length < 28) return null
      const decipher = createDecipheriv('aes-256-gcm', this.#key, buf.subarray(0, 12))
      decipher.setAuthTag(buf.subarray(12, 28))
      return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8')
    } catch {
      return null
    }
  }
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function hmacSha256Hex(key: string, data: string): string {
  return createHmac('sha256', key).update(data, 'utf8').digest('hex')
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}
