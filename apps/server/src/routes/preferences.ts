import {
  PreferencesImportRequest,
  PreferencesSaveRequest,
  PreferencesTab,
  TwoFactorConfigureRequest,
  TwoFactorRemoveRequest,
} from '@bettermyadmin/contracts'
import { Hono } from 'hono'
import { NotFoundError } from '../http/errors.ts'
import { parse, parseJson } from '../http/validate.ts'
import { withMeta } from '../metadata/service.ts'
import {
  autoloadOffered,
  configureTwoFactor,
  exportFileName,
  exportForStorage,
  exportJson,
  exportPhp,
  formPage,
  header,
  importPrefs,
  pageSettings,
  prefsCtx,
  removeTwoFactor,
  resetPrefs,
  saveFormPage,
  savePageSettings,
  twoFactorStatus,
} from '../preferences/service.ts'
import { configFileExists } from '../setup/service.ts'
import type { ServerEnv } from './server.ts'

/**
 * User preferences: Settings tabs, Manage your settings, Two-factor authentication and the
 * page-related settings forms (docs/features/08-settings-preferences-pmadb.md).
 * Mounted at /api/servers/:s/preferences.
 */
export const preferencesRoutes = new Hono<ServerEnv>()

const tabOf = (raw: string | undefined) => parse(PreferencesTab, raw)

/** GET …/forms/:tab — pma: /preferences/{features,sql,navigation,main-panel,export,import} */
preferencesRoutes.get('/forms/:tab', (c) => {
  const tab = tabOf(c.req.param('tab'))
  return withMeta(c, {}, async (m) => c.json(formPage(await prefsCtx(m), tab)))
})

/** POST …/forms/:tab — submit_save / revert */
preferencesRoutes.post('/forms/:tab', async (c) => {
  const tab = tabOf(c.req.param('tab'))
  const req = await parseJson(c, PreferencesSaveRequest)
  return withMeta(c, {}, async (m) => c.json(await saveFormPage(await prefsCtx(m), tab, req)))
})

/** GET …/page/:group — PageSettings::init(group) */
preferencesRoutes.get('/page/:group', (c) =>
  withMeta(c, {}, async (m) => {
    const r = pageSettings(await prefsCtx(m), c.req.param('group'))
    if (r === null) throw new NotFoundError(c.get('tr').gettext('Invalid page settings group.'))
    return c.json(r)
  }),
)

/** POST …/page/:group — PageSettings::processPageSettings (submit_save=<group>) */
preferencesRoutes.post('/page/:group', async (c) => {
  const req = await parseJson(c, PreferencesSaveRequest)
  return withMeta(c, {}, async (m) => {
    const r = await savePageSettings(await prefsCtx(m), c.req.param('group'), req.values)
    if (r === null) throw new NotFoundError(c.get('tr').gettext('Invalid page settings group.'))
    return c.json(r)
  })
})

/** GET …/manage — pma: /preferences/manage */
preferencesRoutes.get('/manage', (c) =>
  withMeta(c, {}, async (m) =>
    c.json({
      ...header(await prefsCtx(m)), // exists_setup_and_not_exists_config: the setup script runs while no configuration file exists
      moreSettings: !configFileExists(c.get('deps')),
      host: c.req.header('host') ?? '',
    }),
  ),
)

/** GET …/manage/export?type=json|php — submit_export (Core::downloadHeader) */
preferencesRoutes.get('/manage/export', (c) =>
  withMeta(c, {}, async (m) => {
    const ctx = await prefsCtx(m)
    const php = c.req.query('type') === 'php'
    const body = php ? await exportPhp(ctx) : await exportJson(ctx)
    const name = exportFileName(c.req.header('host') ?? '', php ? 'php' : 'json')
    return c.body(body, 200, {
      'content-type': php ? 'application/php' : 'application/json',
      'content-transfer-encoding': 'binary',
      'cache-control': 'private, max-age=0',
      'content-description': 'File Transfer',
      'content-disposition': `attachment; filename="${name}"`,
    })
  }),
)

/** GET …/manage/json — submit_get_json (Save to browser's storage) */
preferencesRoutes.get('/manage/json', (c) =>
  withMeta(c, {}, async (m) => c.json(await exportForStorage(await prefsCtx(m)))),
)

/** POST …/manage/import — submit_import (file, local storage or the autoload banner) */
preferencesRoutes.post('/manage/import', async (c) => {
  const req = await parseJson(c, PreferencesImportRequest)
  return withMeta(c, {}, async (m) => c.json(await importPrefs(await prefsCtx(m), req)))
})

/** POST …/manage/reset — submit_clear */
preferencesRoutes.post('/manage/reset', (c) =>
  withMeta(c, {}, async (m) => {
    const r = await resetPrefs(await prefsCtx(m))
    return c.json(r === true ? { ok: true, message: null } : { ok: false, message: r })
  }),
)

/** GET …/autoload — Header: offer the localStorage preferences (session storage only) */
preferencesRoutes.get('/autoload', (c) =>
  withMeta(c, {}, async (m) => c.json({ show: autoloadOffered(await prefsCtx(m)) })),
)

/** POST …/autoload/hide — prefs_autoload=hide */
preferencesRoutes.post('/autoload/hide', (c) => {
  c.get('session').userprefsAutoload = true
  return c.json({ ok: true })
})

/** GET …/two-factor — pma: /preferences/two-factor */
preferencesRoutes.get('/two-factor', (c) =>
  withMeta(c, {}, async (m) => c.json(await twoFactorStatus(await prefsCtx(m)))),
)

/** POST …/two-factor/configure — 2fa_configure (+ the setup form fields) */
preferencesRoutes.post('/two-factor/configure', async (c) => {
  const req = await parseJson(c, TwoFactorConfigureRequest)
  return withMeta(c, {}, async (m) =>
    c.json(await configureTwoFactor(await prefsCtx(m), req.backend, req.fields ?? {})),
  )
})

/** POST …/two-factor/remove — 2fa_remove (+ the challenge fields) */
preferencesRoutes.post('/two-factor/remove', async (c) => {
  const req = await parseJson(c, TwoFactorRemoveRequest, {})
  return withMeta(c, {}, async (m) => c.json(await removeTwoFactor(await prefsCtx(m), req.fields ?? {})))
})
