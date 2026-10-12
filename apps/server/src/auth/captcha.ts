import type { CaptchaSettings } from '@bettermyadmin/contracts'
import type { Gettext } from '@bettermyadmin/i18n'
import { phpEmpty } from '@bettermyadmin/metadata'
import type { AppConfig } from '../config.ts'
import { LoginFailure } from './failure.ts'

/**
 * The login form's reCAPTCHA v2 compatible captcha (Google reCAPTCHA, hCaptcha, Turnstile: any
 * service with the same widget and `siteverify` protocol).
 * pma: src/Plugins/Auth/AuthenticationCookie.php::showLoginForm / ::readCredentials,
 *      vendor/google/recaptcha (ReCaptcha::verify, RequestMethod\CurlPost, Response::fromJson)
 */

/** ReCaptcha::SITE_VERIFY_URL, used when CaptchaSiteVerifyURL is empty */
export const SITE_VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify'
/** ReCaptcha::VERSION, sent as `version` like the PHP client */
const CLIENT_VERSION = 'php_1.3.1'

/** has_captcha: the API, both parameter names and both keys are set. */
export function captchaEnabled(cfg: AppConfig): boolean {
  return (
    cfg.CaptchaApi !== '' &&
    cfg.CaptchaRequestParam !== '' &&
    cfg.CaptchaResponseParam !== '' &&
    cfg.CaptchaLoginPrivateKey !== '' &&
    cfg.CaptchaLoginPublicKey !== ''
  )
}

export function captchaSettings(cfg: AppConfig): CaptchaSettings | null {
  if (!captchaEnabled(cfg)) return null
  return {
    api: cfg.CaptchaApi,
    requestParam: cfg.CaptchaRequestParam,
    responseParam: cfg.CaptchaResponseParam,
    siteKey: cfg.CaptchaLoginPublicKey,
    checkbox: cfg.CaptchaMethod === 'checkbox',
  }
}

/** The `script-src` / `frame-src` / `img-src` / `connect-src` addition (Header::getCspHeader). */
export function captchaCsp(cfg: AppConfig): string {
  return captchaEnabled(cfg) ? ` ${cfg.CaptchaCsp}` : ''
}

/**
 * ReCaptcha::verify through CurlPost: POST `secret`, `response`, `remoteip`, `version` to the
 * verify URL. A failed request reads as `connection-failed`, a body that is not JSON as
 * `invalid-json`. Returns the error codes (empty when the captcha passed).
 */
export async function siteVerify(
  url: string,
  secret: string,
  response: string,
  remoteIp: string | false,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const params = new URLSearchParams({ secret, response })
  // http_build_query of Core::getIp()'s false is `remoteip=0`
  params.set('remoteip', remoteIp === false ? '0' : remoteIp)
  params.set('version', CLIENT_VERSION)
  let body: string
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })
    body = await res.text()
  } catch {
    return ['connection-failed']
  }
  let data: unknown
  try {
    data = JSON.parse(body)
  } catch {
    return ['invalid-json']
  }
  // json_decode(…, true) falsy (null, [], 0, "") → invalid-json
  if (phpEmpty(data) || (typeof data === 'object' && Object.keys(data as object).length === 0))
    return ['invalid-json']
  const d = data as Record<string, unknown>
  // `isset($responseData['success']) && $responseData['success'] == true`: PHP truthiness
  if (!phpEmpty(d.success)) return []
  const codes = d['error-codes']
  if (Array.isArray(codes)) return codes.map(String)
  return ['unknown-error']
}

/** readCredentials: the posted response is required and must verify. */
export async function verifyCaptcha(
  cfg: AppConfig,
  response: string | undefined,
  remoteIp: string | false,
  tr: Gettext,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!captchaEnabled(cfg)) return
  if (response === undefined || phpEmpty(response)) {
    throw new LoginFailure(
      'form',
      tr.gettext('Missing Captcha verification, maybe it has been blocked by adblock?'),
    )
  }
  const url = cfg.CaptchaSiteVerifyURL === '' ? SITE_VERIFY_URL : cfg.CaptchaSiteVerifyURL
  const codes = await siteVerify(url, cfg.CaptchaLoginPrivateKey, response, remoteIp, fetchImpl)
  if (codes.length === 0) return
  if (codes.includes('invalid-json'))
    throw new LoginFailure('form', tr.gettext('Failed to connect to the reCAPTCHA service!'))
  throw new LoginFailure('form', tr.gettext('Entered captcha is wrong, try again!'))
}
