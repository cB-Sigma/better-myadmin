import { appendFileSync } from 'node:fs'
import type { AppConfig } from '../config.ts'

/**
 * Authentication logging (`AuthLog`, `AuthLogSuccess`): `user denied: <user> (<failure>) from <ip>`
 * and, with AuthLogSuccess, `user authenticated: <user> from <ip>`.
 *
 * Destinations: `php` and `sapi` (PHP's error_log) are the server's error output (stderr); a path
 * appends `M d H:i:s phpmyadmin: <message>` lines to that file; `auto` is `syslog` in phpMyAdmin
 * when PHP has syslog(), which Node has not: it writes to stderr like `php` (X46); `syslog` has no
 * Node equivalent and logs nothing; `''` disables logging.
 * pma: src/Logging.php
 */
export function getLogMessage(user: string, status: string, ip: string | false): string {
  const from = ip === false ? '' : ip
  return status === 'ok'
    ? `user authenticated: ${user} from ${from}`
    : `user denied: ${user} (${status}) from ${from}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** date('M d H:i:s') in the server's local time */
function phpLogDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${MONTHS[d.getMonth()]} ${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** Logging::logUser */
export function logUser(
  cfg: Pick<AppConfig, 'AuthLog' | 'AuthLogSuccess'>,
  user: string,
  status: string,
  ip: string | false,
  write: { stderr: (line: string) => void; file: (path: string, line: string) => void } = {
    stderr: (line) => console.error(line),
    file: (path, line) => appendFileSync(path, line),
  },
  now: Date = new Date(),
): void {
  if (!cfg.AuthLogSuccess && status === 'ok') return
  const dest = cfg.AuthLog === 'auto' ? 'php' : cfg.AuthLog
  if (dest === '' || dest === 'syslog') return
  const message = getLogMessage(user, status, ip)
  if (dest === 'php' || dest === 'sapi') {
    write.stderr(message)
    return
  }
  try {
    write.file(dest, `${phpLogDate(now)} phpmyadmin: ${message}\n`)
  } catch {
    // @error_log: a log file that cannot be written is ignored
  }
}
