import { checkPassword } from '../shell/home/password.ts'

/**
 * Pure helpers of Server › Replication (unit-tested).
 * pma: resources/js/replication.ts, resources/js/server/privileges.ts (CheckAddUser),
 *      resources/js/modules/functions.ts::onloadChangePasswordEvents, ::checkPassword
 */

/** replication.ts: `Math.floor(Math.random() * 10000000)`, chosen once per page load */
export function randomServerId(random: () => number = Math.random): number {
  return Math.floor(random() * 10000000)
}

/**
 * replication.ts::updateConfig — the my.cnf lines of the primary configuration wizard: the prefix,
 * then one `binlog_ignore_db=` (mode `all`) or `binlog_do_db=` (mode `ign`) line per selected
 * database.
 */
export function primaryConfigSnippet(serverId: number, mode: 'all' | 'ign', selected: string[]): string {
  const prefix = `server-id=${serverId}\nlog_bin=mysql-bin\nlog_error=mysql-bin.err\n`
  const key = mode === 'all' ? 'binlog_ignore_db=' : 'binlog_do_db='
  return prefix + selected.map((db) => `${key}${db}\n`).join('')
}

export type PredHostname = 'any' | 'localhost' | 'thishost' | 'hosttable' | 'userdefined'

/**
 * onloadChangePasswordEvents: what choosing a host preset writes into the host field (null: the
 * field keeps its text and gets the focus).
 */
export function hostnameForPreset(pred: PredHostname, thisHost: string | null): string | null {
  if (pred === 'any') return '%'
  if (pred === 'localhost') return 'localhost'
  if (pred === 'thishost' && thisHost !== null && thisHost !== '') return thisHost
  if (pred === 'hosttable') return ''
  return null
}

/**
 * CheckAddUser: the alert of the add-user form, or null when it may be posted. The host field is
 * checked first, so the untouched form ("Any host" with an empty field) is refused like in
 * phpMyAdmin until a host preset is chosen again.
 */
export function checkAddUser(f: {
  hostname: string
  predUsername: 'any' | 'userdefined'
  username: string
  predPassword: 'none' | 'userdefined'
  password: string
  password2: string
}): string | null {
  if (f.hostname === '') return 'The host name is empty!'
  if (f.predUsername === 'userdefined' && f.username === '') return 'The user name is empty!'
  return checkPassword(f.predPassword === 'none', f.password, f.password2)
}
