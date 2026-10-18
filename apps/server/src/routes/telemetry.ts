import { ErrorReportRequest, type ErrorReportResponse } from '@bettermyadmin/contracts'
import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import type { AppEnv } from '../app.ts'
import { parseJson } from '../http/validate.ts'
import { APP_VERSION } from '../shell/scope.ts'
import { httpRequest } from '../util/http-request.ts'

export const telemetryRoutes = new Hono<AppEnv>()

/**
 * ErrorReport::sanitizeUrl adapted to our URLs: no host, and the database/table path segments and
 * the token/server parameters are dropped, so no schema names leave the machine.
 */
export function sanitizeUrl(url: string): string {
  try {
    const u = new URL(url, 'http://x')
    for (const p of ['db', 'table', 'token', 'server', 'eq', 'sql', 'sig']) u.searchParams.delete(p)
    const path = u.pathname
      .replace(/\/s\/\d+/, '/s/:s')
      .replace(/\/db\/[^/]+/, '/db/:db')
      .replace(/\/t\/[^/]+/, '/t/:table')
    const q = u.searchParams.toString()
    return path + (q !== '' ? `?${q}` : '')
  } catch {
    return ''
  }
}

/** Stack frames keep only the script name; context lines over 80 chars are cut (error_report.ts). */
function sanitizeException(e: unknown): unknown {
  if (typeof e !== 'object' || e === null) return e
  const ex = e as { message?: unknown; name?: unknown; stack?: unknown }
  const stack = Array.isArray(ex.stack)
    ? ex.stack.map((f: Record<string, unknown>) => ({
        func: f.func,
        line: f.line,
        column: f.column,
        scriptname: typeof f.url === 'string' ? (f.url.split('/').pop() ?? '').split('?')[0] : undefined,
        context: Array.isArray(f.context)
          ? f.context.map((l: unknown) =>
              typeof l === 'string' && l.length > 80 ? `${l.substring(0, 75)}//...` : l,
            )
          : undefined,
      }))
    : undefined
  return { name: ex.name, message: ex.message, stack }
}

/**
 * POST /api/telemetry/error (pma: /error-report): `get_settings` → the SendErrorReports setting;
 * without `send_error_report` → the report data for the modal; with it → "send" the report.
 * Reports go to `BMA_ERROR_REPORT_URL` when set, else to the server log (parity exception X19).
 * pma: src/Controllers/ErrorReportController.php, src/ErrorReport.php
 */
telemetryRoutes.post('/error', async (c) => {
  const req = await parseJson(c, ErrorReportRequest)
  const { cfg } = c.get('deps')
  const session = c.get('session')
  const setting = session.sendErrorReports ?? cfg.SendErrorReports
  if (req.get_settings === true) return c.json({ report_setting: setting } satisfies ErrorReportResponse)

  const report: Record<string, unknown> = {
    bma_version: APP_VERSION,
    user_agent_string: c.req.header('user-agent') ?? '',
    server_software: `Node.js ${process.versions.node}`,
    locale: getCookie(c, 'bma_lang') ?? 'en',
    configuration_storage: 'disabled',
    exception_type: req.exception_type,
    exception: sanitizeException(req.exception),
    script_name: req.url !== undefined ? sanitizeUrl(req.url) : '',
  }
  if (req.send_error_report !== true) return c.json({ report } satisfies ErrorReportResponse)
  if (req.description !== undefined && req.description !== '') report.steps = req.description

  let success = true
  const url = process.env.BMA_ERROR_REPORT_URL ?? ''
  if (url !== '') {
    // ErrorReport::send: HttpRequest::create through ProxyUrl, success on 200
    success = await httpRequest(c.get('deps').cfg, url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    })
      .then((r) => r.status === 200)
      .catch(() => false)
  } else {
    console.warn(`error report: ${JSON.stringify(report)}`)
  }
  let text: string
  if (success) {
    text =
      req.automatic === true || setting === 'always'
        ? c
            .get('tr')
            .gettext(
              'An error has been detected and an error report has been automatically submitted based on your settings.',
            )
        : c.get('tr').gettext('Thank you for submitting this report.')
  } else {
    text = `${c.get('tr').gettext('An error has been detected and an error report has been generated but failed to be sent.')} ${c.get('tr').gettext('If you experience any problems please submit a bug report manually.')}`
  }
  text += ` ${c.get('tr').gettext('You may want to refresh the page.')}`
  // UserPreferences::persistOption('SendErrorReports', 'always', 'ask')
  if (req.always_send === true) session.sendErrorReports = 'always'
  return c.json({ message: { type: success ? 'notice' : 'error', text } } satisfies ErrorReportResponse)
})
