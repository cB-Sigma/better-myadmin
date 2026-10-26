import { z } from 'zod'
import { SqlMessage } from './table-structure.ts'

/**
 * User preferences (Settings tabs, Manage your settings, Two-factor authentication) and the
 * page-related settings forms (docs/features/08-settings-preferences-pmadb.md;
 * pma: /preferences/*, src/Config/FormDisplay.php, src/Config/PageSettings.php, src/TwoFactor.php).
 * Labels and descriptions are HTML (Descriptions::get with BBCode converted) for SafeHtml.
 */

export const PrefsStorage = z.enum(['db', 'local', 'session'])
export type PrefsStorage = z.infer<typeof PrefsStorage>

/** One `<option>` of a select field. */
export const PrefsOption = z.object({
  value: z.string(),
  label: z.string(),
  /** `label="None"` (empty text) */
  emptyLabel: z.boolean().optional(),
})
export type PrefsOption = z.infer<typeof PrefsOption>

/** One input row (config/form_display/input.twig). */
export const PrefsField = z.object({
  /** canonical path `Servers/1/hide_db` */
  path: z.string(),
  /** translated path, the input name and id (`Servers-1-hide_db`) */
  id: z.string(),
  type: z.enum(['text', 'password', 'short_text', 'number_text', 'checkbox', 'select', 'list']),
  name: z.string(),
  desc: z.string(),
  /** the setup script's field comment (Descriptions `cmt`), shown as the b_tblops icon's tooltip */
  comment: z.string().optional(),
  /** documentation link ('' for Import/Export fields) */
  doc: z.string(),
  /** the shown value: checkbox state, selected option value, textarea text, input text */
  value: z.union([z.string(), z.boolean()]),
  /** the value is phpMyAdmin's default (no `custom` class) */
  isDefault: z.boolean(),
  /** the JavaScript default (`data-default-values`): string, boolean or `[value]` for selects */
  jsDefault: z.union([
    z.string(),
    z.boolean(),
    z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
  ]),
  options: z.array(PrefsOption).optional(),
  /** in UserprefsDisallow: "Disabled" notice, not applied */
  disabled: z.boolean(),
  /** "Set value" link value */
  setvalue: z.string().optional(),
  /** setup script: the "Allow users to customize this value" checkbox (`<id>-userprefs-allow`) */
  userprefsAllow: z.boolean().optional(),
  /** inline errors (HTML) */
  errors: z.array(z.string()),
  /** registered JS validators (`data-field-validators`) */
  validators: z.array(z.object({ name: z.string(), args: z.array(z.union([z.string(), z.number()])) })),
  /** `group-field group-field-N` / `group-header-field group-header-N` */
  trClass: z.string(),
})
export type PrefsField = z.infer<typeof PrefsField>

export const PrefsFormItem = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('field'), field: PrefsField }),
  z.object({ kind: z.literal('group'), title: z.string(), group: z.number().int() }),
])
export type PrefsFormItem = z.infer<typeof PrefsFormItem>

/** One form of a tab (a `nav-tabs` pane with its fieldset). */
export const PrefsForm = z.object({
  name: z.string(),
  title: z.string(),
  desc: z.string(),
  /** form-level errors (`dl.errors`) */
  errors: z.array(z.string()),
  items: z.array(PrefsFormItem),
})
export type PrefsForm = z.infer<typeof PrefsForm>

/** The form set of a Settings tab or a page settings group (FormDisplay::getDisplay). */
export const PrefsFormSet = z.object({
  forms: z.array(PrefsForm),
  hasErrors: z.boolean(),
  /** FormDisplay::displayErrors: per field/form name */
  errorList: z.array(z.object({ name: z.string(), errors: z.array(z.string()) })),
  /** a storage failure (Could not save configuration) */
  error: SqlMessage.nullable(),
})
export type PrefsFormSet = z.infer<typeof PrefsFormSet>

/** The preferences header (preferences/header.twig). */
export const PrefsHeader = z.object({
  storage: PrefsStorage,
  /** pma__userconfig (or the local store) is available */
  hasConfigStorage: z.boolean(),
})
export type PrefsHeader = z.infer<typeof PrefsHeader>

export const PreferencesTab = z.enum(['features', 'sql', 'navigation', 'main-panel', 'export', 'import'])
export type PreferencesTab = z.infer<typeof PreferencesTab>

/** GET /api/servers/:s/preferences/forms/:tab */
export const PreferencesFormResponse = PrefsHeader.extend({ formSet: PrefsFormSet })
export type PreferencesFormResponse = z.infer<typeof PreferencesFormResponse>

/** The posted form: browser-style values by input name (checked checkboxes `on`, unchecked absent). */
export const PrefsPostedValues = z.record(z.string(), z.union([z.string(), z.array(z.string())]))

/** POST /api/servers/:s/preferences/forms/:tab (submit_save) */
export const PreferencesSaveRequest = z.object({
  values: PrefsPostedValues,
  /** `revert`: put erroneous fields back to their defaults */
  revert: z.boolean().optional(),
})
export type PreferencesSaveRequest = z.infer<typeof PreferencesSaveRequest>

/** `saved`: redirect to the tab with `?saved=1`; otherwise the form set re-rendered with errors */
export const PreferencesSaveResponse = z.object({
  saved: z.boolean(),
  formSet: PrefsFormSet.optional(),
})
export type PreferencesSaveResponse = z.infer<typeof PreferencesSaveResponse>

/** GET /api/servers/:s/preferences/page/:group (PageSettings::init) */
export const PageSettingsResponse = z.object({ group: z.string(), formSet: PrefsFormSet })
export type PageSettingsResponse = z.infer<typeof PageSettingsResponse>

/** GET /api/servers/:s/preferences/manage */
export const PreferencesManageResponse = PrefsHeader.extend({
  /** the "More settings" card: the setup script is available (no configuration file) */
  moreSettings: z.boolean(),
  /** the HTTP_HOST part of the export file names */
  host: z.string(),
})
export type PreferencesManageResponse = z.infer<typeof PreferencesManageResponse>

/** POST /api/servers/:s/preferences/manage/import */
export const PreferencesImportRequest = z.object({
  /** the file content or localStorage.config */
  json: z.string(),
  merge: z.boolean().optional(),
  /** second step: "Do you want to import remaining settings?" → Yes */
  fixErrors: z.boolean().optional(),
  /** the page the autoload banner was on (`return_url`) */
  returnUrl: z.string().optional(),
})
export type PreferencesImportRequest = z.infer<typeof PreferencesImportRequest>

export const PreferencesImportResponse = z.discriminatedUnion('status', [
  /** saved: ThemeDefault/lang applied by the client, then redirect */
  z.object({
    status: z.literal('saved'),
    themeDefault: z.string().nullable(),
    lang: z.string().nullable(),
    returnUrl: z.string().nullable(),
  }),
  /** preferences/manage/error.twig: the bad fields and the Yes/No question */
  z.object({ status: z.literal('errors'), errorList: PrefsFormSet.shape.errorList }),
  /** Could not import configuration / Could not save configuration */
  z.object({ status: z.literal('failed'), message: SqlMessage }),
])
export type PreferencesImportResponse = z.infer<typeof PreferencesImportResponse>

/** GET /api/servers/:s/preferences/manage/json (submit_get_json, Save to browser's storage) */
export const PreferencesJsonResponse = z.object({ prefs: z.string(), mtime: z.number().int() })
export type PreferencesJsonResponse = z.infer<typeof PreferencesJsonResponse>

/** POST /api/servers/:s/preferences/autoload — hide the localStorage import banner (prefs_autoload=hide) */
export const PreferencesAutoloadResponse = z.object({ ok: z.literal(true) })

/** A two-factor backend of the configure list (TwoFactor::getAllBackends). */
export const TwoFactorBackend = z.object({ id: z.string(), name: z.string(), description: z.string() })
export type TwoFactorBackend = z.infer<typeof TwoFactorBackend>

/** The setup / challenge form of a backend (TwoFactorPlugin::setup / render). */
export const TwoFactorForm = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  /** Simple: hidden 2fa_confirm=1 */
  z.object({ kind: z.literal('simple') }),
  /** Application challenge: code input */
  z.object({ kind: z.literal('application') }),
  /** Application setup: QR code modules (dark = 1) + secret + code input */
  z.object({
    kind: z.literal('application_configure'),
    secret: z.string(),
    qr: z.array(z.string()),
    otpauth: z.string(),
  }),
  /** WebAuthn: options for navigator.credentials.create/get (JSON) */
  z.object({ kind: z.literal('webauthn_creation'), options: z.string() }),
  z.object({ kind: z.literal('webauthn_request'), options: z.string() }),
  /** Invalid: missing dependencies */
  z.object({ kind: z.literal('invalid') }),
])
export type TwoFactorForm = z.infer<typeof TwoFactorForm>

/** GET /api/servers/:s/preferences/two-factor (preferences/two_factor/main.twig) */
export const TwoFactorStatusResponse = PrefsHeader.extend({
  /** TwoFactor::isWritable (pmadb) */
  enabled: z.boolean(),
  hasBackends: z.boolean(),
  backendId: z.string(),
  backendName: z.string(),
  backendDescription: z.string(),
  backends: z.array(TwoFactorBackend),
  missing: z.array(z.object({ class: z.string(), dep: z.string() })),
})
export type TwoFactorStatusResponse = z.infer<typeof TwoFactorStatusResponse>

/** The posted challenge fields (2fa_code, 2fa_confirm, webauthn response). */
export const TwoFactorFields = z.record(z.string(), z.string())
export type TwoFactorFields = z.infer<typeof TwoFactorFields>

/** POST /api/servers/:s/preferences/two-factor/configure (2fa_configure) */
export const TwoFactorConfigureRequest = z.object({ backend: z.string(), fields: TwoFactorFields.optional() })
export type TwoFactorConfigureRequest = z.infer<typeof TwoFactorConfigureRequest>

/** POST /api/servers/:s/preferences/two-factor/remove (2fa_remove) */
export const TwoFactorRemoveRequest = z.object({ fields: TwoFactorFields.optional() })
export type TwoFactorRemoveRequest = z.infer<typeof TwoFactorRemoveRequest>

/**
 * `done`: configured/removed (notice text); `setup`: show the configure form again (with the
 * failure message when a code was given); `confirm`: disabling needs the current challenge.
 */
export const TwoFactorActionResponse = z.discriminatedUnion('status', [
  z.object({ status: z.literal('done'), message: z.string() }),
  z.object({
    status: z.literal('setup'),
    backend: z.string(),
    form: TwoFactorForm,
    error: z.string().nullable(),
  }),
  z.object({ status: z.literal('confirm'), form: TwoFactorForm, error: z.string().nullable() }),
])
export type TwoFactorActionResponse = z.infer<typeof TwoFactorActionResponse>

/** GET /api/auth/two-factor — the login challenge (login/twofactor.twig) */
export const TwoFactorChallengeResponse = z.object({
  form: TwoFactorForm,
  showSubmit: z.boolean(),
  error: z.string().nullable(),
})
export type TwoFactorChallengeResponse = z.infer<typeof TwoFactorChallengeResponse>

/** POST /api/auth/two-factor */
export const TwoFactorVerifyRequest = z.object({ fields: TwoFactorFields })
export type TwoFactorVerifyRequest = z.infer<typeof TwoFactorVerifyRequest>

export const TwoFactorVerifyResponse = z.object({
  ok: z.boolean(),
  challenge: TwoFactorChallengeResponse.optional(),
})
export type TwoFactorVerifyResponse = z.infer<typeof TwoFactorVerifyResponse>
