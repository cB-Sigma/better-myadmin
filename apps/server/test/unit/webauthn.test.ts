import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { englishTranslator } from '@bettermyadmin/i18n'
import { describe, expect, it } from 'vitest'
import type { TwoFactorConfig, TwoFactorHost } from '../../src/preferences/two-factor-plugin.ts'
import { WebAuthnBackend, cborDecode } from '../../src/preferences/webauthn.ts'

/** A minimal CBOR encoder for the authenticator side of the test. */
function cbor(v: unknown): Buffer {
  const head = (major: number, n: number) => {
    if (n < 24) return Buffer.from([(major << 5) | n])
    if (n < 256) return Buffer.from([(major << 5) | 24, n])
    const b = Buffer.alloc(3)
    b[0] = (major << 5) | 25
    b.writeUInt16BE(n, 1)
    return b
  }
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v)
  if (typeof v === 'string') return Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)])
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v])
  if (v instanceof Map) {
    return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])])
  }
  throw new Error('unsupported')
}

const HOST = 'bma.example'

function setup() {
  const config: TwoFactorConfig = { backend: 'WebAuthn', settings: {} }
  let saved = 0
  const host: TwoFactorHost = {
    config,
    save: async () => {
      saved++
      return true
    },
  }
  const state = {}
  const ctx = { tr: englishTranslator(), user: 'root', simple2fa: false, state, host: HOST, appId: HOST }
  return { host, ctx, saved: () => saved }
}

describe('WebAuthn backend (pma: src/WebAuthn/CustomServer.php)', () => {
  it('decodes CBOR', () => {
    expect(
      cborDecode(
        cbor(
          new Map<unknown, unknown>([
            ['a', 1],
            [-2, Buffer.from([1, 2])],
          ]),
        ),
      ).value,
    ).toEqual(
      new Map<unknown, unknown>([
        ['a', 1],
        [-2, Buffer.from([1, 2])],
      ]),
    )
  })

  it('[p08-47e665] registers a credential (attestation none) and verifies a signed assertion [p01-83d6b9]', async () => {
    const { host, ctx, saved } = setup()
    const backend = new WebAuthnBackend(host, ctx)
    const creation = backend.setup()
    expect(creation.kind).toBe('webauthn_creation')
    const options = JSON.parse((creation as { options: string }).options) as {
      challenge: string
      rp: { id: string; name: string }
    }
    expect(options.rp).toEqual({ name: `phpMyAdmin (${HOST})`, id: HOST })

    // the authenticator: an ES256 key
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string }
    const cose = cbor(
      new Map<unknown, unknown>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(jwk.x, 'base64url')],
        [-3, Buffer.from(jwk.y, 'base64url')],
      ]),
    )
    const credId = Buffer.from('credential-id-0001')
    const rpIdHash = createHash('sha256').update(HOST).digest()
    const counter = (n: number) => {
      const b = Buffer.alloc(4)
      b.writeUInt32BE(n)
      return b
    }
    const idLen = Buffer.alloc(2)
    idLen.writeUInt16BE(credId.length)
    const authData = Buffer.concat([
      rpIdHash,
      Buffer.from([0x41]),
      counter(1),
      Buffer.alloc(16),
      idLen,
      credId,
      cose,
    ])
    const clientData = (type: string, challenge: string) =>
      Buffer.from(
        JSON.stringify({
          type,
          challenge: Buffer.from(challenge, 'base64').toString('base64url'),
          origin: `https://${HOST}`,
        }),
      )
    const attestation = cbor(
      new Map<unknown, unknown>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData],
      ]),
    )
    const ok = await backend.configure({
      webauthn_creation_response: JSON.stringify({
        id: credId.toString('base64url'),
        rawId: credId.toString('base64'),
        type: 'public-key',
        response: {
          clientDataJSON: clientData('webauthn.create', options.challenge).toString('base64'),
          attestationObject: attestation.toString('base64'),
        },
      }),
    })
    expect(ok).toBe(true)
    const creds = host.config.settings.credentials as Record<string, { credentialPublicKey: string }>
    expect(Object.keys(creds)).toEqual([credId.toString('base64')])

    // login: the request options allow the credential, the signed assertion passes
    const request = backend.render() as { options: string }
    const ro = JSON.parse(request.options) as { challenge: string; allowCredentials: Array<{ id: string }> }
    expect(ro.allowCredentials[0]?.id).toBe(credId.toString('base64'))
    const assertAuth = Buffer.concat([rpIdHash, Buffer.from([0x01]), counter(2)])
    const assertion = (challenge: string, key = privateKey) => {
      const cd = clientData('webauthn.get', challenge)
      const sig = sign('sha256', Buffer.concat([assertAuth, createHash('sha256').update(cd).digest()]), key)
      return JSON.stringify({
        id: credId.toString('base64url'),
        rawId: credId.toString('base64'),
        type: 'public-key',
        response: {
          authenticatorData: assertAuth.toString('base64'),
          clientDataJSON: cd.toString('base64'),
          signature: sig.toString('base64'),
          userHandle: '',
        },
      })
    }
    expect(await backend.check({ webauthn_request_response: assertion(ro.challenge) })).toBe(true)
    expect(saved()).toBe(1)

    // a replayed challenge fails; so does a signature by another key
    expect(await backend.check({ webauthn_request_response: assertion(ro.challenge) })).toBe(false)
    const ro2 = JSON.parse((backend.render() as { options: string }).options) as { challenge: string }
    const other = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey
    expect(await backend.check({ webauthn_request_response: assertion(ro2.challenge, other) })).toBe(false)
    expect(backend.getError()).toBe('Two-factor authentication failed: Invalid signature.')
  })
})
