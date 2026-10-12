import { randomBytes } from 'node:crypto'
import { constants, accessSync, existsSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  CONFIG_FILE_NAMES,
  type FormDef,
  SETUP_FORMS,
  setupFormTab,
  userFormFieldPaths,
} from '@bettermyadmin/config'
import type {
  PrefsFormSet,
  SetupConfigRequest,
  SetupConfigResponse,
  SetupFormResponse,
  SetupOverview,
  SetupPage,
  SetupSaveResponse,
  SetupServerResponse,
} from '@bettermyadmin/contracts'
import { type Gettext, type LanguageManager, convertBBCode, sprintf } from '@bettermyadmin/i18n'
import mysql from 'mysql2/promise'
import type { AppDeps } from '../app.ts'
import { sanitizeMySQLHost } from '../auth/failure.ts'
import { ConfigFile, canonical } from '../preferences/config-file.ts'
import { FormDisplay, type FormDisplayContext, type PostedForm } from '../preferences/form-display.ts'
import { type ConnectionTest, validateSetup } from '../preferences/validator.ts'
import type { SessionData } from '../session/store.ts'
import { getLatestVersions, latestCompatible, versionToInt } from '../shell/version.ts'
import { SetupMessageList, type SetupMessages, performConfigChecks, setupLinks } from './checks.ts'
import { generateBmaConfig, generateConfigFile } from './config-generator.ts'

/**
 * The setup script (`/setup`): a configuration built in the session, the overview with the
 * security checks, the server list and forms, the generated configuration file.
 * pma: src/Controllers/Setup/*, src/Setup/SetupHelper.php, src/Setup/Index.php
 */

export interface SetupCtx {
  deps: AppDeps
  session: SessionData
  tr: Gettext
  languages: LanguageManager
  /** the request language (the DefaultLang select's selection) */
  lang: string
  version: string
}

/**
 * Setup runs only while there is no configuration file, like phpMyAdmin's
 * `file_exists(CONFIG_FILE) && ! debug->demo`: none was loaded at start and none has been written
 * into the working directory since.
 */
export function setupDisabled(deps: AppDeps, cwd = process.cwd()): boolean {
  if (deps.cfg.DBG.demo) return false
  return configFileExists(deps, cwd)
}

/** `file_exists(CONFIG_FILE)`: one was loaded at start or has been written into the working directory. */
export function configFileExists(deps: AppDeps, cwd = process.cwd()): boolean {
  if (deps.configFile !== undefined) return true
  return CONFIG_FILE_NAMES.some((n) => existsSync(join(cwd, n)))
}

/** SetupHelper::createConfigFile: the session's configuration, the persisted keys set. */
export function setupConfigFile(session: SessionData): ConfigFile {
  session.setup ??= { config: {} }
  const cf = new ConfigFile(null, undefined, session.setup.config)
  cf.setPersistKeys([
    'DefaultLang',
    'ServerDefault',
    'UploadDir',
    'SaveDir',
    'Servers/1/verbose',
    'Servers/1/host',
    'Servers/1/port',
    'Servers/1/socket',
    'Servers/1/auth_type',
    'Servers/1/user',
    'Servers/1/password',
  ])
  return cf
}

/** SetupHelper::getPages: every form set but Config and Servers. */
export function setupPages(tr: Gettext): SetupPage[] {
  return SETUP_FORMS.filter((t) => t.tab !== 'Config' && t.tab !== 'Servers').map((t) => ({
    formset: t.tab,
    name: tr.gettext(t.name),
  }))
}

/** The `config/` directory Save writes to (phpMyAdmin 4's setup script), when writable. */
export function saveDir(cwd = process.cwd()): string | null {
  const dir = resolve(cwd, 'config')
  try {
    if (!statSync(dir).isDirectory()) return null
    accessSync(dir, constants.W_OK)
    return dir
  } catch {
    return null
  }
}

const msg = (tr: Gettext, s: string) => setupLinks(convertBBCode(tr, s, false, { isSetup: true }))

/** Validator::testDBConnection (skipped on the demo server) */
function connectionTest(deps: AppDeps, tr: Gettext): ConnectionTest {
  return async (host, port, socket, user, password) => {
    if (deps.cfg.DBG.demo) return null
    const h = sanitizeMySQLHost(host)
    try {
      const conn = await mysql.createConnection({
        user,
        password,
        connectTimeout: 10_000,
        ...(socket !== '' && (h === '' || h === 'localhost')
          ? { socketPath: socket }
          : { host: h === '' ? 'localhost' : h, port: port === '' ? 3306 : Number(port) }),
      })
      await conn.end().catch(() => {})
      return null
    } catch (e) {
      const err = e as {
        errno?: number
        sqlState?: string
        sqlMessage?: string
        message?: string
        code?: string
      }
      const errno = err.errno ?? (err.code === 'ECONNREFUSED' ? 2002 : 2005)
      // the PHP warning error_get_last() reports for mysqli_connect() (no SQLSTATE before the handshake)
      const warning = `mysqli_connect(): (HY000/${errno}): ${err.sqlMessage ?? err.message ?? ''}`
      return `${tr.gettext('Could not connect to the database server!')} - ${warning}`
    }
  }
}

function fdCtx(ctx: SetupCtx, serverId: number | null): FormDisplayContext {
  return {
    tr: ctx.tr,
    base: null,
    userprefsKeys: new Set(userFormFieldPaths(false)),
    disallow: new Set(),
    charsets: ctx.deps.cfg.AvailableCharsets,
    serverId,
  }
}

/** FormDisplay::validate of the setup script (form validators test the connection). */
async function validateFd(ctx: SetupCtx, fd: FormDisplay): Promise<void> {
  const { paths, values } = fd.validationInput()
  const r = await validateSetup(ctx.tr, paths, values, connectionTest(ctx.deps, ctx.tr))
  const errors: Record<string, string[]> = {}
  if (r !== false) for (const [k, list] of Object.entries(r)) errors[k] = list.map((x) => msg(ctx.tr, x))
  fd.setValidationErrors(errors)
}

async function formSetOf(ctx: SetupCtx, fd: FormDisplay): Promise<PrefsFormSet> {
  await validateFd(ctx, fd)
  return { forms: fd.display(), hasErrors: fd.hasErrors(), errorList: fd.displayErrors(), error: null }
}

/** GET /setup (HomeController): the messages after ServerConfigChecks, servers, languages */
export async function overview(ctx: SetupCtx, versionCheck: boolean): Promise<SetupOverview> {
  const { tr, session } = ctx
  const cf = setupConfigFile(session)
  const messages = new SetupMessageList(session.setup?.messages as SetupMessages | undefined)
  if (versionCheck) await checkVersion(ctx, messages)
  performConfigChecks(cf, messages, tr)
  const text = `${tr.gettext(
    'You are not using a secure connection; all data (including potentially sensitive information, like passwords) is transferred unencrypted!',
  )} <a href="#">${tr.gettext(
    'If your server is also configured to accept HTTPS requests follow this link to use a secure connection.',
  )}</a>`
  messages.set('notice', 'no_https', tr.gettext('Insecure connection'), text)
  const list = messages.end()
  ;(session.setup as NonNullable<SessionData['setup']>).messages = messages.state
  return {
    pages: setupPages(tr),
    messages: list,
    servers: Object.keys(cf.getServers()).map((k) => {
      const id = Number(k)
      return {
        id,
        name: cf.getServerName(id),
        authType: String(cf.getValue(`Servers/${id}/auth_type`) ?? ''),
        dsn: cf.getServerDSN(id),
      }
    }),
    languages: ctx.languages
      .sortedLanguages()
      .map((l) => ({ code: l.code, name: l.name, active: l.code === ctx.lang })),
    eol: session.setup?.eol ?? (process.platform === 'win32' ? 'win' : 'unix'),
    canSave: saveDir() !== null,
  }
}

/** Index::versionCheck against the BetterMyAdmin release feed (X20) */
async function checkVersion(ctx: SetupCtx, messages: SetupMessageList): Promise<void> {
  const { tr } = ctx
  const id = `version_check${randomBytes(8).toString('hex')}`
  const url = process.env.BMA_VERSION_FEED_URL ?? ''
  const releases = url === '' ? null : await getLatestVersions(url, Date.now(), ctx.deps.cfg)
  if (releases === null) {
    messages.set(
      'error',
      id,
      tr.gettext('Version check'),
      tr.gettext("Reading of version failed. Maybe you're offline or the upgrade server does not respond."),
    )
    return
  }
  const latest = latestCompatible(releases, process.versions.node, null, false)
  if (latest === null) return
  const upstream = versionToInt(latest.version)
  const local = versionToInt(ctx.version)
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  if (upstream > local) {
    messages.set(
      'notice',
      id,
      tr.gettext('Version check'),
      sprintf(
        tr.gettext(
          'A newer version of phpMyAdmin is available and you should consider upgrading. The newest version is %s, released on %s.',
        ),
        esc(latest.version),
        esc(latest.date),
      ),
    )
  } else if (local % 100 === 0) {
    messages.set(
      'notice',
      id,
      tr.gettext('Version check'),
      msg(
        tr,
        sprintf(
          tr.gettext(
            'You are using Git version, run [kbd]git pull[/kbd] :-)[br]The latest stable version is %s, released on %s.',
          ),
          latest.version,
          latest.date,
        ),
      ),
    )
  } else {
    messages.set(
      'notice',
      id,
      tr.gettext('Version check'),
      tr.gettext('No newer stable version is available'),
    )
  }
}

const formsOf = (formset: string): readonly FormDef[] | null => setupFormTab(formset)?.forms ?? null

/** GET /setup?page=form (FormController): null for "Incorrect form specified!" */
export async function formPage(ctx: SetupCtx, formset: string): Promise<SetupFormResponse | null> {
  const def = setupFormTab(formset)
  if (def === undefined) return null
  const fd = new FormDisplay(def.forms, setupConfigFile(ctx.session), fdCtx(ctx, null))
  return { pages: setupPages(ctx.tr), name: ctx.tr.gettext(def.name), formSet: await formSetOf(ctx, fd) }
}

/**
 * The submit of a setup form: missing data shows the form again, no errors goes back to the
 * overview, validation errors show the "Submitted form contains errors" page.
 */
async function save(ctx: SetupCtx, fd: FormDisplay, post: PostedForm): Promise<SetupSaveResponse> {
  const ok = fd.process(post, false, { skipValidation: true })
  await validateFd(ctx, fd)
  if (!ok) return { saved: false, formSet: await formSetOf(ctx, fd) }
  if (!fd.hasErrors()) return { saved: true }
  return { saved: false, errors: fd.displayErrors() }
}

export async function saveForm(
  ctx: SetupCtx,
  formset: string,
  post: PostedForm,
): Promise<SetupSaveResponse | null> {
  const forms = formsOf(formset)
  if (forms === null) return null
  return save(ctx, new FormDisplay(forms, setupConfigFile(ctx.session), fdCtx(ctx, null)), post)
}

/** mode=revert: FormDisplay::fixErrors */
export async function revertForm(
  ctx: SetupCtx,
  formset: string,
  serverId: number | null = null,
): Promise<void> {
  const forms = serverId === null ? formsOf(formset) : formsOf('Servers')
  if (forms === null) return
  const fd = new FormDisplay(forms, setupConfigFile(ctx.session), fdCtx(ctx, serverId))
  await validateFd(ctx, fd)
  fd.fixErrors()
}

const hasServer = (cf: ConfigFile, id: number) => id >= 1 && cf.get(`Servers/${id}`) !== null

/** GET /setup?page=servers&mode=add|edit (ServersController) */
export async function serverPage(ctx: SetupCtx, id: number): Promise<SetupServerResponse> {
  const cf = setupConfigFile(ctx.session)
  const fd = new FormDisplay(formsOf('Servers') ?? [], cf, fdCtx(ctx, id))
  return {
    pages: setupPages(ctx.tr),
    hasServer: hasServer(cf, id),
    serverId: id,
    dsn: cf.getServerDSN(id),
    formSet: await formSetOf(ctx, fd),
  }
}

export async function saveServer(ctx: SetupCtx, id: number, post: PostedForm): Promise<SetupSaveResponse> {
  const cf = setupConfigFile(ctx.session)
  const r = await save(ctx, new FormDisplay(formsOf('Servers') ?? [], cf, fdCtx(ctx, id)), post)
  // a new server with errors: the links of the error page edit it under its new id
  if (r.errors !== undefined && id === 0) r.serverId = cf.getServerCount()
  return r
}

/** ServerDestroyController */
export function deleteServer(ctx: SetupCtx, id: number): void {
  const cf = setupConfigFile(ctx.session)
  if (hasServer(cf, id)) cf.removeServer(id)
}

/** The generated configuration in both formats. */
function generated(ctx: SetupCtx, eol: 'unix' | 'win'): { php: string; bma: string } {
  const php = generateConfigFile(setupConfigFile(ctx.session), { eol, version: ctx.version })
  return { php, bma: generateBmaConfig(php) }
}

/**
 * ShowConfigController: stores DefaultLang / ServerDefault (ConfigForm) and the end of line, then
 * Clear, Download, Save (into `config/`) or Display.
 */
export async function postConfig(
  ctx: SetupCtx,
  req: SetupConfigRequest,
): Promise<{ download?: { name: string; body: string } }> {
  const { session } = ctx
  const cf = setupConfigFile(session)
  const fd = new FormDisplay(formsOf('Config') ?? [], cf, fdCtx(ctx, null))
  fd.process({ DefaultLang: req.DefaultLang, ServerDefault: req.ServerDefault }, true)
  const setup = session.setup as NonNullable<SessionData['setup']>
  setup.eol = req.eol === 'unix' ? 'unix' : 'win'
  delete setup.saved
  if (req.action === 'clear') {
    cf.resetConfigData()
    setup.config = cf.data()
    return {}
  }
  if (req.action === 'download')
    return { download: { name: 'config.inc.php', body: generated(ctx, setup.eol).php } }
  if (req.action === 'save') {
    const dir = saveDir()
    if (dir !== null) {
      const file = join(dir, CONFIG_FILE_NAMES[3])
      writeFileSync(file, generated(ctx, setup.eol).bma, { mode: 0o600 })
      setup.saved = file
    }
  }
  return {}
}

/** GET /setup?page=config (ConfigController) */
export function configPage(ctx: SetupCtx, eolParam: string | undefined): SetupConfigResponse {
  const eol = eolParam === 'win' ? 'win' : 'unix'
  return {
    pages: setupPages(ctx.tr),
    eol,
    ...generated(ctx, eol),
    canSave: saveDir() !== null,
    saved: ctx.session.setup?.saved ?? null,
  }
}

/** The BetterMyAdmin configuration file download. */
export function bmaDownload(ctx: SetupCtx, eol: 'unix' | 'win'): { name: string; body: string } {
  return { name: CONFIG_FILE_NAMES[3], body: generated(ctx, eol).bma }
}

/**
 * ValidateController: the posted values (`Servers-1-host` keys) checked by the named validators;
 * empty lists clear a field's errors. `false`: "Wrong data or no validation for %s".
 */
export async function validateAjax(
  ctx: SetupCtx,
  id: string,
  valuesJson: string,
): Promise<Record<string, string[]> | string> {
  const { tr } = ctx
  let values: unknown
  try {
    values = JSON.parse(valuesJson)
  } catch {
    values = null
  }
  if (values === null || typeof values !== 'object') return tr.gettext('Wrong data')
  const vids = id.split(',')
  const args: Record<string, unknown> = {}
  const keyMap: Record<string, string> = {}
  for (const [k, v] of Object.entries(values)) {
    let k2 = k.replaceAll('-', '/')
    if (k2.indexOf('/') > 0) k2 = canonical(k2)
    keyMap[k2] = k
    args[k2] = v
  }
  const r = await validateSetup(tr, vids, args, connectionTest(ctx.deps, tr), true)
  if (r === false) return sprintf(tr.gettext('Wrong data or no validation for %s'), vids.join(','))
  const out: Record<string, string[]> = {}
  for (const [k, list] of Object.entries(r)) out[keyMap[k] ?? k] = list.map((x) => msg(tr, x))
  return out
}
