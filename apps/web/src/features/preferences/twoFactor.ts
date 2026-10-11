/**
 * The browser side of the WebAuthn backend: options from the server (base64 buffers) to
 * navigator.credentials, the credential back to JSON with base64 buffers.
 * pma: resources/js/webauthn.ts
 */

export const arrayBufferToBase64 = (buffer: ArrayBuffer | null): string => {
  if (buffer === null) return ''
  let s = ''
  for (const byte of new Uint8Array(buffer)) s += String.fromCharCode(byte)
  return window.btoa(s)
}

export const base64ToUint8Array = (s: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(window.atob(s), (c) => c.charCodeAt(0))

export function webauthnSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    navigator.credentials !== undefined &&
    typeof navigator.credentials.create === 'function' &&
    typeof navigator.credentials.get === 'function' &&
    typeof window.PublicKeyCredential !== 'undefined'
  )
}

interface Options {
  challenge: string
  user?: { id: string; name: string; displayName: string }
  excludeCredentials?: Array<{ id: string; type: string }>
  allowCredentials?: Array<{ id: string; type: string }>
  [k: string]: unknown
}

/** The creation options of `data-creation-options` as PublicKeyCredentialCreationOptions. */
export function creationOptions(json: string): PublicKeyCredentialCreationOptions {
  const o = JSON.parse(json) as Options
  return {
    ...(o as unknown as PublicKeyCredentialCreationOptions),
    challenge: base64ToUint8Array(o.challenge),
    user: { ...(o.user as NonNullable<Options['user']>), id: base64ToUint8Array(o.user?.id ?? '') },
    ...(o.excludeCredentials !== undefined
      ? {
          excludeCredentials: o.excludeCredentials.map((c) => ({
            ...c,
            type: 'public-key' as const,
            id: base64ToUint8Array(c.id),
          })),
        }
      : {}),
  }
}

/** The request options of `data-request-options` as PublicKeyCredentialRequestOptions. */
export function requestOptions(json: string): PublicKeyCredentialRequestOptions {
  const o = JSON.parse(json) as Options
  return {
    ...(o as unknown as PublicKeyCredentialRequestOptions),
    challenge: base64ToUint8Array(o.challenge),
    ...(o.allowCredentials !== undefined
      ? {
          allowCredentials: o.allowCredentials.map((c) => ({
            ...c,
            type: 'public-key' as const,
            id: base64ToUint8Array(c.id),
          })),
        }
      : {}),
  }
}

/** handleCreation: the attestation as `webauthn_creation_response` */
export async function webauthnCreate(json: string): Promise<string> {
  const credential = (await navigator.credentials.create({
    publicKey: creationOptions(json),
  })) as PublicKeyCredential
  const response = credential.response as AuthenticatorAttestationResponse
  return JSON.stringify({
    id: credential.id,
    rawId: arrayBufferToBase64(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: arrayBufferToBase64(response.clientDataJSON),
      attestationObject: arrayBufferToBase64(response.attestationObject),
    },
  })
}

/** handleRequest: the assertion as `webauthn_request_response` */
export async function webauthnGet(json: string): Promise<string> {
  const credential = (await navigator.credentials.get({
    publicKey: requestOptions(json),
  })) as PublicKeyCredential
  const response = credential.response as AuthenticatorAssertionResponse
  return JSON.stringify({
    id: credential.id,
    rawId: arrayBufferToBase64(credential.rawId),
    type: credential.type,
    response: {
      authenticatorData: arrayBufferToBase64(response.authenticatorData),
      clientDataJSON: arrayBufferToBase64(response.clientDataJSON),
      signature: arrayBufferToBase64(response.signature),
      userHandle: arrayBufferToBase64(response.userHandle),
    },
  })
}
