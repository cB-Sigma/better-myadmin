import { z } from 'zod'
import { PrefsFormSet, PrefsPostedValues } from './preferences.ts'

/** The setup script's menu: Overview then one entry per form set (SetupHelper::getPages). */
export const SetupPage = z.object({ formset: z.string(), name: z.string() })
export type SetupPage = z.infer<typeof SetupPage>

/** Index::messagesShowHtml */
export const SetupMessage = z.object({
  id: z.string(),
  type: z.enum(['error', 'notice']),
  title: z.string(),
  /** HTML (BBCode converted) */
  message: z.string(),
  /** seen before: hidden until "Show hidden messages" */
  hidden: z.boolean(),
})
export type SetupMessage = z.infer<typeof SetupMessage>

export const SetupServer = z.object({
  id: z.number().int(),
  name: z.string(),
  authType: z.string(),
  dsn: z.string(),
})
export type SetupServer = z.infer<typeof SetupServer>

/** GET /api/setup (HomeController) */
export const SetupOverview = z.object({
  pages: z.array(SetupPage),
  messages: z.array(SetupMessage),
  servers: z.array(SetupServer),
  languages: z.array(z.object({ code: z.string(), name: z.string(), active: z.boolean() })),
  /** End of line of the generated file */
  eol: z.enum(['unix', 'win']),
  /** a writable `config/` directory: "Save" writes the configuration there */
  canSave: z.boolean(),
})
export type SetupOverview = z.infer<typeof SetupOverview>

/** GET /api/setup/form/:formset (FormController) */
export const SetupFormResponse = z.object({
  pages: z.array(SetupPage),
  name: z.string(),
  formSet: PrefsFormSet,
})
export type SetupFormResponse = z.infer<typeof SetupFormResponse>

/** GET /api/setup/servers/:id — 0 adds a server (ServersController) */
export const SetupServerResponse = z.object({
  pages: z.array(SetupPage),
  hasServer: z.boolean(),
  serverId: z.number().int(),
  dsn: z.string(),
  formSet: PrefsFormSet,
})
export type SetupServerResponse = z.infer<typeof SetupServerResponse>

/** POST /api/setup/form/:formset, /api/setup/servers/:id (submit_save) */
export const SetupSaveRequest = z.object({ values: PrefsPostedValues })
export type SetupSaveRequest = z.infer<typeof SetupSaveRequest>

/**
 * `saved`: back to the overview. Otherwise `formSet` is the form shown again (missing data), or
 * `errors` the "Submitted form contains errors" page (the server id of a new server included).
 */
export const SetupSaveResponse = z.object({
  saved: z.boolean(),
  formSet: PrefsFormSet.optional(),
  errors: z.array(z.object({ name: z.string(), errors: z.array(z.string()) })).optional(),
  serverId: z.number().int().optional(),
})
export type SetupSaveResponse = z.infer<typeof SetupSaveResponse>

/** POST /api/setup/config (ShowConfigController): DefaultLang, ServerDefault, eol and the button */
export const SetupConfigRequest = z.object({
  DefaultLang: z.string(),
  ServerDefault: z.string(),
  eol: z.enum(['unix', 'win']),
  action: z.enum(['display', 'download', 'clear', 'save']),
})
export type SetupConfigRequest = z.infer<typeof SetupConfigRequest>

/** GET /api/setup/config (ConfigController): the generated file, and the BetterMyAdmin one */
export const SetupConfigResponse = z.object({
  pages: z.array(SetupPage),
  eol: z.enum(['unix', 'win']),
  /** ConfigGenerator::getConfigFile */
  php: z.string(),
  /** the same configuration as bettermyadmin.config.json */
  bma: z.string(),
  canSave: z.boolean(),
  /** the path written by the last Save */
  saved: z.string().nullable(),
})
export type SetupConfigResponse = z.infer<typeof SetupConfigResponse>

/** POST /api/setup/validate (ValidateController): `id` comma-separated validator ids */
export const SetupValidateRequest = z.object({ id: z.string(), values: z.string() })
export type SetupValidateRequest = z.infer<typeof SetupValidateRequest>
