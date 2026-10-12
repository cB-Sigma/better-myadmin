import { constants, createHash, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto'
import type { TwoFactorForm } from '@bettermyadmin/contracts'
import {
  type TwoFactorContext,
  type TwoFactorFields,
  type TwoFactorHost,
  TwoFactorPlugin,
} from './two-factor-plugin.ts'

/**
 * Hardware security keys through the Web Authentication API, phpMyAdmin's dependency-free server
 * (`none` attestation only, no attestation statement). An assertion is accepted only with a valid
 * signature by the registered public key, besides the challenge, origin, RP id hash and flags.
 *
 * pma: src/Plugins/TwoFactor/WebAuthn.php, src/WebAuthn/CustomServer.php, src/WebAuthn/CBORDecoder.php
 */

class WebAuthnError extends Error {}

function assert(cond: unknown, message = 'Invalid authenticator response.'): asserts cond {
  if (!cond) throw new WebAuthnError(message)
}

const b64 = (b: Buffer) => b.toString('base64')
const b64urlNoPad = (b: Buffer) => b.toString('base64url')
const fromB64 = (s: string) => Buffer.from(s, 'base64')
const fromB64url = (s: string) => Buffer.from(s, 'base64url')
const equal = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b)

/** A minimal CBOR decoder (major types 0–7, definite lengths). */
export function cborDecode(buf: Buffer, start = 0): { value: unknown; end: number } {
  let pos = start
  const take = (n: number) => {
    assert(pos + n <= buf.length, 'Invalid CBOR data.')
    const out = buf.subarray(pos, pos + n)
    pos += n
    return out
  }
  const item = (): unknown => {
    const initial = take(1)[0] as number
    const major = initial >> 5
    const info = initial & 0x1f
    let value: number
    if (info < 24) value = info
    else if (info === 24) value = take(1)[0] as number
    else if (info === 25) value = take(2).readUInt16BE(0)
    else if (info === 26) value = take(4).readUInt32BE(0)
    else if (info === 27) value = Number(take(8).readBigUInt64BE(0))
    else throw new WebAuthnError('Invalid CBOR data.')
    switch (major) {
      case 0:
        return value
      case 1:
        return -1 - value
      case 2:
        return Buffer.from(take(value))
      case 3:
        return take(value).toString('utf8')
      case 4:
        return Array.from({ length: value }, () => item())
      case 5: {
        const m = new Map<unknown, unknown>()
        for (let i = 0; i < value; i++) {
          const k = item()
          m.set(k, item())
        }
        return m
      }
      case 6:
        return item()
      default:
        if (info === 20) return false
        if (info === 21) return true
        if (info === 22 || info === 23) return null
        return value
    }
  }
  const value = item()
  return { value, end: pos }
}

interface AuthData {
  rpIdHash: Buffer
  flags: number
  signCount: number
  attested: { aaguid: string; credentialId: Buffer; publicKey: Buffer } | null
}

/** CustomServer::getAuthenticatorData */
function authenticatorData(raw: Buffer): AuthData {
  assert(raw.length >= 37)
  const flags = raw[32] as number
  const signCount = raw.readUInt32BE(33)
  let attested: AuthData['attested'] = null
  if ((flags & 64) !== 0) {
    const hex = raw.subarray(37, 53).toString('hex')
    const aaguid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    const idLen = raw.readUInt16BE(53)
    const credentialId = raw.subarray(55, 55 + idLen)
    const { value, end } = cborDecode(raw, 55 + idLen)
    assert(value instanceof Map)
    attested = {
      aaguid,
      credentialId: Buffer.from(credentialId),
      publicKey: Buffer.from(raw.subarray(55 + idLen, end)),
    }
  }
  return { rpIdHash: raw.subarray(0, 32), flags, signCount, attested }
}

/** CustomServer::getCollectedClientData */
function clientData(raw: Buffer): { type: string; challenge: string; origin: string } {
  const d = JSON.parse(raw.toString('utf8')) as Record<string, unknown>
  assert(typeof d.type === 'string' && ['webauthn.create', 'webauthn.get'].includes(d.type))
  assert(typeof d.challenge === 'string' && d.challenge !== '')
  assert(typeof d.origin === 'string' && d.origin !== '')
  return { type: d.type, challenge: d.challenge, origin: d.origin }
}

const hostOf = (origin: string) => {
  try {
    return new URL(origin).hostname
  } catch {
    return ''
  }
}

/** CustomServer::getCredentialParameters */
const CREDENTIAL_PARAMETERS = [-257, -259, -37, -39, -7, -36, -8].map((alg) => ({ alg, type: 'public-key' }))

/** Verifies an assertion signature with a COSE public key (RS/PS/ES/EdDSA). */
function verifySignature(coseKey: Buffer, data: Buffer, signature: Buffer): boolean {
  const { value } = cborDecode(coseKey)
  assert(value instanceof Map)
  const kty = value.get(1)
  const alg = value.get(3)
  const enc = (k: number) => {
    const v = value.get(k)
    assert(Buffer.isBuffer(v))
    return v.toString('base64url')
  }
  if (kty === 2) {
    const crv = { 1: 'P-256', 2: 'P-384', 3: 'P-521' }[value.get(-1) as 1 | 2 | 3]
    assert(crv !== undefined)
    const key = createPublicKey({ key: { kty: 'EC', crv, x: enc(-2), y: enc(-3) }, format: 'jwk' })
    const hash = alg === -36 ? 'sha512' : alg === -35 ? 'sha384' : 'sha256'
    return verify(hash, data, key, signature)
  }
  if (kty === 3) {
    const key = createPublicKey({ key: { kty: 'RSA', n: enc(-1), e: enc(-2) }, format: 'jwk' })
    const hash = alg === -259 || alg === -39 ? 'sha512' : 'sha256'
    if (alg === -37 || alg === -39)
      return verify(
        hash,
        data,
        { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: hash === 'sha512' ? 64 : 32 },
        signature,
      )
    return verify(hash, data, key, signature)
  }
  if (kty === 1) {
    const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: enc(-2) }, format: 'jwk' })
    return verify(null, data, key, signature)
  }
  return false
}

interface StoredCredential {
  publicKeyCredentialId: string
  type: string
  transports: unknown[]
  attestationType: string
  aaguid: string
  credentialPublicKey: string
  userHandle: string
  counter: number
}

/** pma: src/Plugins/TwoFactor/WebAuthn.php */
export class WebAuthnBackend extends TwoFactorPlugin {
  constructor(tf: TwoFactorHost, ctx: TwoFactorContext) {
    super(tf, ctx)
    const s = tf.config.settings
    if (typeof s.userHandle !== 'string') s.userHandle = ''
    if (s.credentials === null || typeof s.credentials !== 'object') s.credentials = {}
  }

  get id() {
    return 'WebAuthn'
  }

  #credentials(): Record<string, StoredCredential> {
    return this.tf.config.settings.credentials as Record<string, StoredCredential>
  }

  /** WebAuthn::getAllowedCredentials */
  #allowed(): Array<{ type: string; id: string }> {
    return Object.values(this.#credentials())
      .filter(
        (c) => typeof c.publicKeyCredentialId === 'string' && c.publicKeyCredentialId !== '' && c.type !== '',
      )
      .map((c) => ({ type: c.type, id: c.publicKeyCredentialId }))
  }

  override render(): TwoFactorForm {
    const options = JSON.stringify({
      challenge: b64(randomBytes(32)),
      allowCredentials: this.#allowed().map((c) => ({ ...c, id: b64(fromB64url(c.id)) })),
      timeout: 60000,
      attestation: 'none',
      userVerification: 'discouraged',
    })
    this.ctx.state.webauthnRequest = options
    return { kind: 'webauthn_request', options }
  }

  override async check(fields: TwoFactorFields): Promise<boolean> {
    this.provided = false
    const response = fields.webauthn_request_response ?? ''
    const stored = this.ctx.state.webauthnRequest
    if (response === '' || stored === undefined) return false
    this.provided = true
    delete this.ctx.state.webauthnRequest
    try {
      const challenge = (JSON.parse(stored) as { challenge: string }).challenge
      this.#validateAssertion(response, challenge)
      await this.tf.save()
      return true
    } catch (e) {
      this.message = e instanceof Error ? e.message : String(e)
      return false
    }
  }

  /** CustomServer::parseAndValidateAssertionResponse (+ signature verification) */
  #validateAssertion(json: string, challenge: string): void {
    const c = JSON.parse(json) as Record<string, unknown>
    const r = (c.response ?? {}) as Record<string, unknown>
    assert(typeof c.id === 'string' && c.id !== '' && c.type === 'public-key' && typeof c.rawId === 'string')
    for (const k of ['clientDataJSON', 'authenticatorData', 'signature'])
      assert(typeof r[k] === 'string' && r[k] !== '')
    const rawId = fromB64(c.rawId as string)
    assert(rawId.length > 0 && equal(rawId, fromB64url(c.id as string)))
    const allowed = this.#allowed()
    if (allowed.length > 0) assert(allowed.some((a) => equal(fromB64url(a.id), rawId)))
    const source = this.#credentials()[b64(rawId)]
    assert(source !== undefined)
    const authRaw = fromB64(r.authenticatorData as string)
    const clientRaw = fromB64(r.clientDataJSON as string)
    const auth = authenticatorData(authRaw)
    const cd = clientData(clientRaw)
    assert(cd.type === 'webauthn.get')
    assert(equal(fromB64(challenge), fromB64url(cd.challenge)))
    assert(hostOf(cd.origin) === this.ctx.host)
    assert(equal(createHash('sha256').update(this.ctx.host).digest(), auth.rpIdHash))
    assert((auth.flags & 1) !== 0)
    const signed = Buffer.concat([authRaw, createHash('sha256').update(clientRaw).digest()])
    assert(
      verifySignature(fromB64url(source.credentialPublicKey), signed, fromB64(r.signature as string)),
      'Invalid signature.',
    )
    source.counter = auth.signCount
    this.#credentials()[b64(rawId)] = source
  }

  override setup(): TwoFactorForm {
    const userId = b64(randomBytes(32))
    const host = this.ctx.host
    const options = JSON.stringify({
      challenge: b64(randomBytes(32)),
      rp: { name: `phpMyAdmin (${host})`, id: host },
      user: { id: userId, name: this.ctx.user, displayName: this.ctx.user },
      pubKeyCredParams: CREDENTIAL_PARAMETERS,
      authenticatorSelection: { authenticatorAttachment: 'cross-platform', userVerification: 'discouraged' },
      timeout: 60000,
      attestation: 'none',
    })
    this.ctx.state.webauthnCreation = options
    return { kind: 'webauthn_creation', options }
  }

  override configure(fields: TwoFactorFields): boolean {
    this.provided = false
    const response = fields.webauthn_creation_response ?? ''
    const stored = this.ctx.state.webauthnCreation
    if (response === '' || stored === undefined) return false
    this.provided = true
    delete this.ctx.state.webauthnCreation
    try {
      const cred = this.#validateAttestation(response, stored)
      const id = b64(fromB64url(cred.publicKeyCredentialId))
      this.#credentials()[id] = cred
      this.tf.config.settings.userHandle = cred.userHandle
      return true
    } catch (e) {
      this.message = e instanceof Error ? e.message : String(e)
      return false
    }
  }

  /** CustomServer::parseAndValidateAttestationResponse */
  #validateAttestation(json: string, optionsJson: string): StoredCredential {
    let c: Record<string, unknown>
    let r: Record<string, unknown>
    let rawId: Buffer
    try {
      c = JSON.parse(json) as Record<string, unknown>
      r = (c.response ?? {}) as Record<string, unknown>
      assert(
        typeof c.id === 'string' && c.id !== '' && c.type === 'public-key' && typeof c.rawId === 'string',
      )
      assert(typeof r.clientDataJSON === 'string' && typeof r.attestationObject === 'string')
      rawId = fromB64(c.rawId as string)
      assert(rawId.length > 0 && equal(rawId, fromB64url(c.id as string)))
    } catch {
      throw new WebAuthnError('Invalid authenticator response.')
    }
    const options = JSON.parse(optionsJson) as { challenge: string; user: { id: string } }
    const cd = clientData(fromB64(r.clientDataJSON as string))
    assert(cd.type === 'webauthn.create')
    assert(equal(fromB64(options.challenge), fromB64url(cd.challenge)))
    assert(hostOf(cd.origin) === this.ctx.host, 'Invalid origin.')
    const { value } = cborDecode(fromB64(r.attestationObject as string))
    assert(value instanceof Map)
    const fmt = value.get('fmt')
    const attStmt = value.get('attStmt')
    const authRaw = value.get('authData')
    assert(typeof fmt === 'string' && Buffer.isBuffer(authRaw))
    const auth = authenticatorData(authRaw)
    assert(auth.attested !== null)
    assert(equal(createHash('sha256').update(this.ctx.host).digest(), auth.rpIdHash), 'Invalid rpIdHash.')
    assert((auth.flags & 1) !== 0)
    assert(fmt === 'none')
    assert(attStmt instanceof Map && attStmt.size === 0)
    return {
      publicKeyCredentialId: b64urlNoPad(auth.attested.credentialId),
      type: 'public-key',
      transports: [],
      attestationType: fmt,
      aaguid: auth.attested.aaguid,
      credentialPublicKey: b64urlNoPad(auth.attested.publicKey),
      userHandle: b64urlNoPad(fromB64(options.user.id)),
      counter: auth.signCount,
    }
  }
}
