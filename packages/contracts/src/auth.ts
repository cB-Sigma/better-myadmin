import { z } from 'zod'

export const ServerListEntry = z.object({
  index: z.number().int().positive(),
  /** Label shown in the server selector: `verbose` or `host[:port]` (Server\Select::render). */
  label: z.string(),
  authType: z.enum(['cookie', 'config', 'http', 'signon']),
})
export type ServerListEntry = z.infer<typeof ServerListEntry>

/** AuthenticationConfig::showFailure: the page shown when the configured credentials fail. */
export const ConfigAuthFailure = z.object({
  /** the allow/deny failure message (shown as a notice) */
  notice: z.string().nullable(),
  /** "You probably did not create a configuration file…" (no configuration file was loaded) */
  noConfigFile: z.boolean(),
  /** the connection error, then "phpMyAdmin tried to connect…" */
  errors: z.array(z.string()),
})
export type ConfigAuthFailure = z.infer<typeof ConfigAuthFailure>

/** Why the current server is not logged in, for the auth types without a login form. */
export const AuthFailure = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('config') }).merge(ConfigAuthFailure),
  /** AuthenticationHttp::authForm: the 401 page (Wrong username/password) */
  z.object({ kind: z.literal('http') }),
  /** error/generic.twig (You must set SignonURL!, Can not find signon authentication script) */
  z.object({ kind: z.literal('error'), message: z.string() }),
  /** http / signon without a login: the page itself authenticates (401 challenge, SignonURL redirect) */
  z.object({ kind: z.literal('reload') }),
])
export type AuthFailure = z.infer<typeof AuthFailure>

/** The login form's captcha (AuthenticationCookie::showLoginForm has_captcha). */
export const CaptchaSettings = z.object({
  /** CaptchaApi: the script URL (`?hl=<lang>` appended) */
  api: z.string(),
  /** CaptchaRequestParam: the widget's class (`g-recaptcha`, `h-captcha`) */
  requestParam: z.string(),
  /** CaptchaResponseParam: the posted token's field name */
  responseParam: z.string(),
  /** CaptchaLoginPublicKey */
  siteKey: z.string(),
  /** CaptchaMethod = 'checkbox' (else invisible) */
  checkbox: z.boolean(),
})
export type CaptchaSettings = z.infer<typeof CaptchaSettings>

/** GET /api/auth/state */
export const AuthState = z.object({
  authenticated: z.boolean(),
  server: z.number().int().positive(),
  user: z.string().nullable(),
  twoFactorPending: z.boolean(),
  servers: z.array(ServerListEntry),
  /** Username to prefill when LoginCookieRecall is on. */
  recalledUser: z.string().nullable(),
  allowArbitraryServer: z.boolean(),
  csrfToken: z.string(),
  /** Set when the session ended because of inactivity (`no-activity` failure). */
  sessionExpired: z.boolean(),
  /** auth_type of the current server */
  authType: z.enum(['cookie', 'config', 'http', 'signon']),
  /** set when the current server (not cookie auth) is not logged in */
  failure: AuthFailure.nullable(),
  captcha: CaptchaSettings.nullable(),
  /** $cfg['LoginCookieValidity'] (seconds): the idle check's schedule (functions.ts onloadIdleEvent) */
  loginCookieValidity: z.number().int(),
  /** the server sees an HTTPS request (CommonParams is_https; the login form compares it, js-https-mismatch) */
  isHttps: z.boolean(),
})
export type AuthState = z.infer<typeof AuthState>

/**
 * POST /api/auth/check-timeout — the idle check: `access_time` seconds since the user's last
 * activity in the window `guid` (pma: POST / with check_timeout, access_time, guid).
 */
export const CheckTimeoutRequest = z.object({
  guid: z.string().max(64).optional(),
  access_time: z.number(),
})
export type CheckTimeoutRequest = z.infer<typeof CheckTimeoutRequest>
export const CheckTimeoutResponse = z.object({
  success: z.boolean(),
  /** the login ended for inactivity: "No activity within %s seconds; please log in again." */
  message: z.string().optional(),
})
export type CheckTimeoutResponse = z.infer<typeof CheckTimeoutResponse>

/** POST /api/auth/login */
export const LoginRequest = z.object({
  server: z.number().int().positive(),
  username: z.string(),
  password: z.string(),
  /** `host port` when AllowArbitraryServer is on (pma_servername). */
  arbitraryServer: z.string().optional(),
  captchaToken: z.string().optional(),
})
export type LoginRequest = z.infer<typeof LoginRequest>

export const LoginResponse = z.object({
  ok: z.literal(true),
  server: z.number().int().positive(),
  twoFactorRequired: z.boolean(),
  csrfToken: z.string(),
})
export type LoginResponse = z.infer<typeof LoginResponse>

export const LogoutResponse = z.object({
  ok: z.literal(true),
  logoutUrl: z.string().nullable(),
  /** Partial logout (LoginCookieDeleteAll=false): the other server still logged in, shown next. */
  server: z.number().int().positive().nullable().optional(),
})
export type LogoutResponse = z.infer<typeof LogoutResponse>
