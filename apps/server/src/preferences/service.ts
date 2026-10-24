import {
  type FormDef,
  type FormTabDef,
  PAGE_FORMS,
  pageFormTab,
  userFormFieldPaths,
  userFormTab,
} from '@bettermyadmin/config'
import type {
  PageSettingsResponse,
  PreferencesFormResponse,
  PreferencesImportRequest,
  PreferencesImportResponse,
  PreferencesSaveRequest,
  PreferencesSaveResponse,
  PreferencesTab,
  PrefsFormSet,
  PrefsHeader,
  SqlMessage,
  TwoFactorActionResponse,
  TwoFactorStatusResponse,
} from '@bettermyadmin/contracts'
import { type PhpValue, jsonEncode, sanitizeFilename } from '@bettermyadmin/export'
import { type Translator, htmlspecialchars, phpUrlencode } from '@bettermyadmin/i18n'
import {
  type PrefsMessage,
  type UserPreferences,
  phpJsonDecode,
  phpJsonEncode,
} from '@bettermyadmin/metadata'
import type { MetaRequest } from '../metadata/service.ts'
import { CFG_UPDATE_READ_MAPPING, ConfigFile } from './config-file.ts'
import { FormDisplay, type FormDisplayContext, type PostedForm } from './form-display.ts'
import {
  TwoFactor,
  type TwoFactorContext,
  type TwoFactorFields,
  type TwoFactorSessionState,
} from './two-factor.ts'

/** Settings tab route → UserFormList key. */
export const TAB_FORMS: Readonly<Record<PreferencesTab, string>> = {
  features: 'Features',
  sql: 'Sql',
  navigation: 'Navi',
  'main-panel': 'Main',
  export: 'Export',
  import: 'Import',
}

/** Everything a preferences request needs (UserPreferences + the configuration layers). */
export interface PrefsCtx {
  m: MetaRequest
  tr: Translator
  /** Config::$baseSettings: config without user preferences, `Servers` keyed from 1 */
  base: Record<string, unknown>
  /** Config::$settings: base with the applied preferences (`Server/*` kept) */
  settings: Record<string, unknown>
  prefs: UserPreferences
  fd: FormDisplayContext
  developerTab: boolean
}

/** array_replace_recursive (lists stay lists: keys are replaced by index) */
export function replaceRecursive(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = Array.isArray(a)
    ? ([...a] as unknown as Record<string, unknown>)
    : { ...a }
  for (const [k, v] of Object.entries(b)) {
    const cur = out[k]
    out[k] =
      cur !== null && typeof cur === 'object' && v !== null && typeof v === 'object'
        ? replaceRecursive(cur as Record<string, unknown>, v as Record<string, unknown>)
        : v
  }
  return out
}

export async function prefsCtx(m: MetaRequest): Promise<PrefsCtx> {
  const cfg = m.cfg
  const tr = m.c.get('tr')
  const base = cfg as unknown as Record<string, unknown>
  const applied = (await m.appliedPrefs()).userprefs
  const developerTab = cfg.UserprefsDeveloperTab
  return {
    m,
    tr,
    base,
    settings: replaceRecursive(base, applied),
    prefs: (await m.meta()).userPreferences(),
    developerTab,
    fd: {
      tr,
      base,
      userprefsKeys: new Set(userFormFieldPaths(developerTab)),
      disallow: new Set(cfg.UserprefsDisallow),
      charsets: cfg.AvailableCharsets,
    },
  }
}

/** UserPreferences::pageInit: a fresh ConfigFile with the current settings of every form field. */
export function pageInit(ctx: PrefsCtx): ConfigFile {
  const cf = new ConfigFile(ctx.base)
  cf.resetConfigData()
  cf.setAllowedKeys(userFormFieldPaths(ctx.developerTab))
  cf.setCfgUpdateReadMapping({ ...CFG_UPDATE_READ_MAPPING })
  cf.updateWithGlobalConfig(ctx.settings)
  return cf
}

/** preferences/header.twig data */
export function header(ctx: PrefsCtx): PrefsHeader {
  return { storage: ctx.prefs.kind, hasConfigStorage: ctx.prefs.kind !== 'session' }
}

/**
 * UserPreferences::save failure: "Could not save configuration", the control link error and, when
 * the storage database cannot be accessed any more, that notice (htmlspecialchars).
 */
export function prefsMessage(tr: Translator, r: PrefsMessage): SqlMessage {
  const lines = [tr.gettext('Could not save configuration'), ...(r.detail !== undefined ? [r.detail] : [])]
  if (r.inaccessible === true)
    lines.push(
      htmlspecialchars(tr.gettext('The phpMyAdmin configuration storage database could not be accessed.')),
    )
  return { type: 'error', text: lines.join('<br><br>') }
}

function formSet(fd: FormDisplay, error: SqlMessage | null = null): PrefsFormSet {
  return { forms: fd.display(), hasErrors: fd.hasErrors(), errorList: fd.displayErrors(), error }
}

export function tabForms(ctx: PrefsCtx, tab: PreferencesTab): readonly FormDef[] {
  return (userFormTab(TAB_FORMS[tab], ctx.developerTab) as FormTabDef).forms
}

/** GET /preferences/<tab> */
export function formPage(ctx: PrefsCtx, tab: PreferencesTab): PreferencesFormResponse {
  const fd = new FormDisplay(tabForms(ctx, tab), pageInit(ctx), ctx.fd)
  return { ...header(ctx), formSet: formSet(fd) }
}

/**
 * TwoFactorPlugin::getAppId(false): the host of `PmaAbsoluteUri` as parse_url() returns it (without
 * the port, case kept), else HTTP_HOST (with the port).
 */
export function twoFactorAppId(absoluteUri: string, httpHost: string): string {
  const m =
    /^(?:[a-z][a-z0-9+.-]*:)?\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^:/?#]*)/i.exec(absoluteUri) ??
    // `host:8080` (parse_url's host and port without a scheme)
    /^([^:/?#]+):\d+(?:[/?#]|$)/.exec(absoluteUri)
  return m?.[1] || httpHost
}

/** The 2FA backend context of this request. */
export function twoFactorCtx(ctx: PrefsCtx): TwoFactorContext {
  const c = ctx.m.c
  const session = c.get('session')
  session.twoFactor ??= {}
  const httpHost = c.req.header('host') ?? ''
  return {
    tr: ctx.tr,
    user: ctx.m.user,
    simple2fa: ctx.m.cfg.DBG.simple2fa,
    state: session.twoFactor as TwoFactorSessionState,
    host: httpHost.replace(/:\d+$/, ''),
    appId: twoFactorAppId(ctx.m.cfg.PmaAbsoluteUri, httpHost),
  }
}

/**
 * POST /preferences/<tab> (submit_save): FormDisplay::process(false), then UserPreferences::save
 * of the whole ConfigFile and TwoFactor::save (re-persists `2fa`).
 */
export async function saveFormPage(
  ctx: PrefsCtx,
  tab: PreferencesTab,
  req: PreferencesSaveRequest,
): Promise<PreferencesSaveResponse> {
  const cf = pageInit(ctx)
  const fd = new FormDisplay(tabForms(ctx, tab), cf, ctx.fd)
  if (req.revert === true) {
    fd.fixErrors()
    return { saved: false }
  }
  let error: SqlMessage | null = null
  if (fd.process(req.values as PostedForm, false) && !fd.hasErrors()) {
    const tf = await TwoFactor.create(ctx.prefs, twoFactorCtx(ctx))
    const r = await ctx.prefs.save(cf.getConfigArray())
    await tf.save()
    if (r === true) {
      ctx.m.forgetPrefs()
      return { saved: true }
    }
    error = prefsMessage(ctx.tr, r)
  }
  return { saved: false, formSet: formSet(fd, error) }
}

// ---------------------------------------------------------------------------------------------
// Page settings (PageSettings::init)
// ---------------------------------------------------------------------------------------------

export function pageGroupForms(group: string): readonly FormDef[] | null {
  return pageFormTab(group)?.forms ?? null
}

export function pageSettings(ctx: PrefsCtx, group: string): PageSettingsResponse | null {
  const forms = pageGroupForms(group)
  if (forms === null) return null
  return { group, formSet: formSet(new FormDisplay(forms, pageInit(ctx), ctx.fd)) }
}

/** PageSettings::processPageSettings: no partial save, UserPreferences::save (smart merge keeps 2fa). */
export async function savePageSettings(
  ctx: PrefsCtx,
  group: string,
  values: PostedForm,
): Promise<PreferencesSaveResponse | null> {
  const forms = pageGroupForms(group)
  if (forms === null) return null
  const cf = pageInit(ctx)
  const fd = new FormDisplay(forms, cf, ctx.fd)
  let error: SqlMessage | null = null
  if (fd.process(values, false) && !fd.hasErrors()) {
    const r = await ctx.prefs.save(cf.getConfigArray())
    if (r === true) {
      ctx.m.forgetPrefs()
      return { saved: true }
    }
    error = prefsMessage(ctx.tr, r)
  }
  return { saved: false, formSet: formSet(fd, error) }
}

export const PAGE_GROUPS: readonly string[] = PAGE_FORMS.map((t) => t.tab)

// ---------------------------------------------------------------------------------------------
// Manage your settings (ManageController)
// ---------------------------------------------------------------------------------------------

/** A decoded JSON value as the export helpers' PHP value (objects become ordered maps). */
export function toPhpValue(v: unknown): PhpValue {
  if (v === null || v === undefined) return null
  if (Array.isArray(v)) return v.map(toPhpValue)
  if (typeof v === 'object') return new Map(Object.entries(v).map(([k, x]) => [k, toPhpValue(x)]))
  return v as PhpValue
}

/**
 * `BetterMyAdmin-config-<urlencoded HTTP_HOST>.<ext>` after Core::downloadHeader's
 * Sanitize::sanitizeFilename (phpMyAdmin's file is `phpMyAdmin-config-…`; parity exception X57)
 */
export function exportFileName(httpHost: string, ext: string): string {
  return sanitizeFilename(`BetterMyAdmin-config-${phpUrlencode(httpHost)}.${ext}`)
}

/** submit_export, export_type=text_file: pretty JSON of config_data */
export async function exportJson(ctx: PrefsCtx): Promise<string> {
  const loaded = await ctx.prefs.load()
  return (jsonEncode(toPhpValue(loaded.config_data), { pretty: true }) as string | false) || ''
}

/** submit_get_json */
export async function exportForStorage(ctx: PrefsCtx): Promise<{ prefs: string; mtime: number }> {
  const loaded = await ctx.prefs.load()
  return { prefs: phpJsonEncode(loaded.config_data), mtime: loaded.mtime }
}

/** UserFormList: every Settings tab as its own FormDisplay. */
function userFormList(ctx: PrefsCtx, cf: ConfigFile): FormDisplay[] {
  return Object.values(TAB_FORMS).map(
    (t) => new FormDisplay((userFormTab(t, ctx.developerTab) as FormTabDef).forms, cf, ctx.fd),
  )
}

/**
 * submit_import: the JSON is sanitised as if every value was posted to every Settings form
 * (BaseFormList::process stops at the first form that fails), then saved.
 */
export async function importPrefs(
  ctx: PrefsCtx,
  req: PreferencesImportRequest,
): Promise<PreferencesImportResponse> {
  const tr = ctx.tr
  const session = ctx.m.c.get('session')
  // hide the localStorage offer
  session.userprefsAutoload = true
  const configuration = phpJsonDecode(req.json)
  if (configuration === null || typeof configuration !== 'object') {
    return {
      status: 'failed',
      message: { type: 'error', text: tr.gettext('Could not import configuration') },
    }
  }
  const cf = pageInit(ctx)
  const forms = userFormList(ctx, cf)
  let newConfig: Record<string, unknown> = cf.getFlatDefaultConfig()
  if (req.merge === true) newConfig = { ...newConfig, ...cf.getConfigArray() }
  newConfig = { ...newConfig, ...(configuration as Record<string, unknown>) }
  const post: PostedForm = {}
  for (const [k, v] of Object.entries(newConfig)) post[k.replaceAll('/', '-')] = v
  cf.resetConfigData()
  // phpMyAdmin 6.0-dev ends here with a TypeError (FormDisplay::validateSelect(string|bool) gets the
  // integer defaults) and BaseFormList::process would stop at the first failing form: every form
  // is processed, the defaults that fill the fields the file lacks are never errors
  let allOk = true
  for (const f of forms) allOk = f.process(post, true, { keepDefaults: true }) && allOk
  allOk = allOk && !forms.some((f) => f.hasErrors())
  if (!allOk && req.fixErrors === true) {
    for (const f of forms) f.fixErrors()
    allOk = true
  }
  if (!allOk) return { status: 'errors', errorList: forms.flatMap((f) => f.displayErrors()) }

  const conf = configuration as Record<string, unknown>
  const r = await ctx.prefs.save(cf.getConfigArray())
  if (r !== true) return { status: 'failed', message: prefsMessage(ctx.tr, r) }
  ctx.m.forgetPrefs()
  return {
    status: 'saved',
    themeDefault: typeof conf.ThemeDefault === 'string' ? conf.ThemeDefault : null,
    lang: typeof conf.lang === 'string' ? conf.lang : null,
    returnUrl: req.returnUrl !== undefined && req.returnUrl !== '' ? req.returnUrl : null,
  }
}

/** submit_clear: save([]) (the smart merge keeps `2fa`) */
export async function resetPrefs(ctx: PrefsCtx): Promise<true | SqlMessage> {
  const r = await ctx.prefs.save({})
  if (r !== true) return prefsMessage(ctx.tr, r)
  ctx.m.forgetPrefs()
  return true
}

/** Header::getDisplay: offer to load preferences from localStorage (session storage, once). */
export function autoloadOffered(ctx: PrefsCtx): boolean {
  return ctx.prefs.kind === 'session' && ctx.m.c.get('session').userprefsAutoload !== true
}

// ---------------------------------------------------------------------------------------------
// Two-factor authentication (TwoFactorController)
// ---------------------------------------------------------------------------------------------

export async function twoFactorStatus(ctx: PrefsCtx): Promise<TwoFactorStatusResponse> {
  const tf = await TwoFactor.create(ctx.prefs, twoFactorCtx(ctx))
  return { ...header(ctx), ...tf.status() }
}

/** 2fa_configure: choose → setup form → verify */
export async function configureTwoFactor(
  ctx: PrefsCtx,
  backend: string,
  fields: TwoFactorFields,
): Promise<TwoFactorActionResponse> {
  const tf = await TwoFactor.create(ctx.prefs, twoFactorCtx(ctx))
  const r = await tf.configure(backend, fields)
  if (!r.ok) {
    const s = tf.setup()
    return { status: 'setup', backend, form: s.form, error: s.error }
  }
  ctx.m.forgetPrefs()
  return { status: 'done', message: ctx.tr.gettext('Two-factor authentication has been configured.') }
}

/** 2fa_remove: the current challenge must pass first */
export async function removeTwoFactor(
  ctx: PrefsCtx,
  fields: TwoFactorFields,
): Promise<TwoFactorActionResponse> {
  const tf = await TwoFactor.create(ctx.prefs, twoFactorCtx(ctx))
  if (!(await tf.check(fields))) {
    const r = tf.render()
    return { status: 'confirm', form: r.form, error: r.error }
  }
  await tf.configure('', {})
  ctx.m.forgetPrefs()
  return { status: 'done', message: ctx.tr.gettext('Two-factor authentication has been removed.') }
}
