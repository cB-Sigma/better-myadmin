import { z } from 'zod'

export const ServerListEntry = z.object({
  index: z.number().int().positive(),
  /** Label shown in the server selector: `verbose` or `host[:port]` (Server\Select::render). */
  label: z.string(),
  authType: z.enum(['cookie', 'config', 'http', 'signon']),
})
export type ServerListEntry = z.infer<typeof ServerListEntry>

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
})
export type AuthState = z.infer<typeof AuthState>

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
