import { SetupConfigRequest, SetupSaveRequest, SetupValidateRequest } from '@bettermyadmin/contracts'
import { type Context, Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app.ts'
import { NotFoundError } from '../http/errors.ts'
import { parse, parseJson } from '../http/validate.ts'
import { generateConfigFile } from '../setup/config-generator.ts'
import {
  type SetupCtx,
  bmaDownload,
  configPage,
  deleteServer,
  formPage,
  overview,
  postConfig,
  revertForm,
  saveForm,
  saveServer,
  serverPage,
  setupConfigFile,
  setupDisabled,
  validateAjax,
} from '../setup/service.ts'
import { APP_VERSION } from '../shell/scope.ts'

/**
 * The setup script, without login, only while no configuration file exists. Mounted at /api/setup.
 * pma: src/Controllers/Setup/*Controller.php, src/Routing/Routing.php::callSetupController
 */
export const setupRoutes = new Hono<AppEnv>()

/** Every setup controller: "Configuration already exists, setup is disabled!" (404) */
setupRoutes.use('*', async (c, next) => {
  if (setupDisabled(c.get('deps')))
    throw new NotFoundError(c.get('tr').gettext('Configuration already exists, setup is disabled!'))
  await next()
})

const ctxOf = (c: Context<AppEnv>): SetupCtx => ({
  deps: c.get('deps'),
  session: c.get('session'),
  tr: c.get('tr'),
  languages: c.get('languageManager'),
  lang: c.get('language').code,
  version: APP_VERSION,
})
const ServerId = z.coerce.number().int().min(0)
const formsetOf = (c: Context<AppEnv>) => c.req.param('formset') ?? ''
const notFound = (c: Context<AppEnv>) => new NotFoundError(c.get('tr').gettext('Incorrect form specified!'))

/** GET /api/setup — HomeController (`?version_check=1`: Index::versionCheck) */
setupRoutes.get('/', async (c) =>
  c.json(await overview(ctxOf(c), c.req.query('version_check') !== undefined)),
)

/** GET /api/setup/form/:formset — FormController */
setupRoutes.get('/form/:formset', async (c) => {
  const r = await formPage(ctxOf(c), formsetOf(c))
  if (r === null) throw notFound(c)
  return c.json(r)
})

/** POST /api/setup/form/:formset — FormController submit_save */
setupRoutes.post('/form/:formset', async (c) => {
  const req = await parseJson(c, SetupSaveRequest)
  const r = await saveForm(ctxOf(c), formsetOf(c), req.values)
  if (r === null) throw notFound(c)
  return c.json(r)
})

/** POST /api/setup/form/:formset/revert — mode=revert */
setupRoutes.post('/form/:formset/revert', async (c) => {
  await revertForm(ctxOf(c), formsetOf(c))
  return c.json({ ok: true })
})

/** GET /api/setup/servers/:id — ServersController (0: Add a new server) */
setupRoutes.get('/servers/:id', async (c) =>
  c.json(await serverPage(ctxOf(c), parse(ServerId, c.req.param('id')))),
)

/** POST /api/setup/servers/:id — ServersController submit_save */
setupRoutes.post('/servers/:id', async (c) => {
  const req = await parseJson(c, SetupSaveRequest)
  return c.json(await saveServer(ctxOf(c), parse(ServerId, c.req.param('id')), req.values))
})

/** POST /api/setup/servers/:id/revert — mode=revert */
setupRoutes.post('/servers/:id/revert', async (c) => {
  await revertForm(ctxOf(c), 'Servers', parse(ServerId, c.req.param('id')))
  return c.json({ ok: true })
})

/** POST /api/setup/servers/:id/delete — ServerDestroyController */
setupRoutes.post('/servers/:id/delete', async (c) => {
  deleteServer(ctxOf(c), parse(ServerId, c.req.param('id')))
  return c.json({ ok: true })
})

/** POST /api/setup/config — ShowConfigController (Display / Download / Clear / Save) */
setupRoutes.post('/config', async (c) => {
  await postConfig(ctxOf(c), await parseJson(c, SetupConfigRequest))
  return c.json({ ok: true })
})

/** GET /api/setup/config — ConfigController */
setupRoutes.get('/config', (c) => c.json(configPage(ctxOf(c), c.req.query('eol'))))

/** GET /api/setup/config/download — submit_download: config.inc.php, or `format=bma` our file */
setupRoutes.get('/config/download', (c) => {
  const ctx = ctxOf(c)
  const eol = c.req.query('eol') === 'win' ? 'win' : (ctx.session.setup?.eol ?? 'unix')
  const file =
    c.req.query('format') === 'bma'
      ? bmaDownload(ctx, eol)
      : {
          name: 'config.inc.php',
          body: generateConfigFile(setupConfigFile(ctx.session), { eol, version: ctx.version }),
        }
  c.header('Content-Type', 'text/plain; charset=utf-8')
  c.header('Content-Disposition', `attachment; filename="${file.name}"`)
  return c.body(file.body)
})

/** POST /api/setup/validate — ValidateController (AJAX validation) */
setupRoutes.post('/validate', async (c) => {
  const req = await parseJson(c, SetupValidateRequest)
  const r = await validateAjax(ctxOf(c), req.id, req.values)
  return c.json(typeof r === 'string' ? { success: false, message: r } : r)
})
