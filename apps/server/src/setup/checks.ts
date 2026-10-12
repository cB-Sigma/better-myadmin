import { type Gettext, convertBBCode, sprintf } from '@bettermyadmin/i18n'
import { phpEmpty } from '@bettermyadmin/metadata'
import type { ConfigFile } from '../preferences/config-file.ts'
import { describe } from '../preferences/form-display.ts'
import { generateSecret } from './config-generator.ts'

/**
 * The setup overview's messages: a list kept in the session where a message seen before is
 * hidden (notices only) until "Show hidden messages".
 * pma: src/Setup/Index.php::messagesBegin / messagesSet / messagesEnd / messagesShowHtml
 */
export interface SetupMessageState {
  fresh: boolean
  active: boolean
  title: string
  message: string
}
export type SetupMessages = Record<'error' | 'notice', Record<string, SetupMessageState>>

export class SetupMessageList {
  readonly state: SetupMessages
  constructor(state: SetupMessages | undefined) {
    this.state = state ?? { error: {}, notice: {} }
    // messagesBegin: reset message states
    for (const list of Object.values(this.state))
      for (const m of Object.values(list)) {
        m.fresh = false
        m.active = false
      }
  }

  set(type: 'error' | 'notice', id: string, title: string, message: string): void {
    const fresh = this.state[type][id] === undefined
    this.state[type][id] = { fresh, active: true, title, message }
  }

  /** messagesEnd + messagesShowHtml */
  end(): Array<{ id: string; title: string; type: 'error' | 'notice'; message: string; hidden: boolean }> {
    const out: Array<{
      id: string
      title: string
      type: 'error' | 'notice'
      message: string
      hidden: boolean
    }> = []
    for (const type of Object.keys(this.state) as Array<'error' | 'notice'>) {
      const list = this.state[type]
      for (const [id, m] of Object.entries(list)) if (!m.active) delete list[id]
    }
    for (const type of Object.keys(this.state) as Array<'error' | 'notice'>)
      for (const [id, m] of Object.entries(this.state[type]))
        out.push({ id, title: m.title, type, message: m.message, hidden: !m.fresh && type !== 'error' })
    return out
  }
}

/** The setup pages' URLs for the `[a@?page=…]` links of the messages (SPA routes). */
export function setupLinkUrl(u: string): string {
  const [query = '', hash = ''] = u.replace(/^\?/, '').split('#')
  const p = new URLSearchParams(query)
  const anchor = hash === '' ? '' : `#${hash.replace(/^tab_/, '')}`
  if (p.get('page') === 'form') return `/setup/form/${encodeURIComponent(p.get('formset') ?? '')}${anchor}`
  if (p.get('page') === 'servers') return `/setup/servers/${encodeURIComponent(p.get('id') ?? '0')}${anchor}`
  return u
}

const security = '[a@?page=form&formset=Features#tab_Security]'
const importExport = '[a@?page=form&formset=Features#tab_Import_export]'

/**
 * ServerConfigChecks::performConfigChecks: security and consistency warnings of the configuration
 * being written (a missing 32-byte blowfish_secret with cookie servers is generated). The PHP
 * `session.gc_maxlifetime` check has no equivalent (sessions are swept after twice the cookie
 * lifetime); of the compression functions only a bzip2 compressor is missing in Node.
 * pma: src/Config/ServerConfigChecks.php
 */
export function performConfigChecks(cf: ConfigFile, messages: SetupMessageList, tr: Gettext): void {
  const bb = (s: string) => convertBBCode(tr, s, false, { isSetup: true, linkUrl: setupLinkUrl })
  const name = (path: string) => describe(tr, path, 'name')
  const blowfishSecret = String(cf.get('blowfish_secret', '') ?? '')

  // performConfigChecksServers
  let blowfishSecretSet = false
  let cookieAuthUsed = false
  const serverCount = cf.getServerCount()
  for (let i = 1; i <= serverCount; i++) {
    const cookieAuthServer = cf.getValue(`Servers/${i}/auth_type`) === 'cookie'
    cookieAuthUsed ||= cookieAuthServer
    let serverName = cf.getServerName(i)
    if (serverName === 'localhost') serverName = `${serverName} [${i}]`
    serverName = serverName
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')

    if (cookieAuthServer && Buffer.byteLength(blowfishSecret, 'utf8') !== 32) {
      blowfishSecretSet = true
      cf.set('blowfish_secret', generateSecret())
    }

    if (phpEmpty(cf.getValue(`Servers/${i}/ssl`))) {
      messages.set(
        'notice',
        `Servers/${i}/ssl`,
        `${name('Servers/1/ssl')} (${serverName})`,
        tr.gettext('You should use SSL connections if your database server supports it.'),
      )
    }

    const securityInfo = bb(
      sprintf(
        tr.gettext(
          'If you feel this is necessary, use additional protection settings - %1$shost authentication%2$s settings and %3$strusted proxies list%4$s. However, IP-based protection may not be reliable if your IP belongs to an ISP where thousands of users, including you, are connected to.',
        ),
        `[a@?page=servers&mode=edit&id=${i}#tab_Server_config]`,
        '[/a]',
        security,
        '[/a]',
      ),
    )

    if (
      cf.getValue(`Servers/${i}/auth_type`) === 'config' &&
      String(cf.getValue(`Servers/${i}/user`) ?? '') !== '' &&
      String(cf.getValue(`Servers/${i}/password`) ?? '') !== ''
    ) {
      messages.set(
        'notice',
        `Servers/${i}/auth_type`,
        `${name('Servers/1/auth_type')} (${serverName})`,
        `${bb(
          sprintf(
            tr.gettext(
              'You set the [kbd]config[/kbd] authentication type and included username and password for auto-login, which is not a desirable option for live hosts. Anyone who knows or guesses your phpMyAdmin URL can directly access your phpMyAdmin panel. Set %1$sauthentication type%2$s to [kbd]cookie[/kbd] or [kbd]http[/kbd].',
            ),
            `[a@?page=servers&mode=edit&id=${i}#tab_Server]`,
            '[/a]',
          ),
        )} ${securityInfo}`,
      )
    }

    if (
      phpEmpty(cf.getValue(`Servers/${i}/AllowRoot`)) ||
      phpEmpty(cf.getValue(`Servers/${i}/AllowNoPassword`))
    )
      continue
    messages.set(
      'notice',
      `Servers/${i}/AllowNoPassword`,
      `${name('Servers/1/AllowNoPassword')} (${serverName})`,
      `${tr.gettext('You allow for connecting to the server without a password.')} ${securityInfo}`,
    )
  }
  if (cookieAuthUsed && blowfishSecretSet) {
    messages.set(
      'notice',
      'blowfish_secret_created',
      name('blowfish_secret'),
      bb(
        tr.gettext(
          "You didn't have blowfish secret set and have enabled [kbd]cookie[/kbd] authentication, so a key was automatically generated for you. It is used to encrypt cookies; you don't need to remember it.",
        ),
      ),
    )
  }

  if (!phpEmpty(cf.getValue('AllowArbitraryServer'))) {
    messages.set(
      'notice',
      'AllowArbitraryServer',
      name('AllowArbitraryServer'),
      bb(
        sprintf(
          tr.gettext(
            'This %soption%s should be disabled as it allows attackers to bruteforce login to any MySQL server. If you feel this is necessary, use %srestrict login to MySQL server%s or %strusted proxies list%s. However, IP-based protection with trusted proxies list may not be reliable if your IP belongs to an ISP where thousands of users, including you, are connected to.',
          ),
          security,
          '[/a]',
          security,
          '[/a]',
          security,
          '[/a]',
        ),
      ),
    )
  }

  // performConfigChecksLoginCookie
  const validity = Number(cf.getValue('LoginCookieValidity') ?? 0)
  if (validity > 1800) {
    messages.set(
      'notice',
      'LoginCookieValidity',
      name('LoginCookieValidity'),
      bb(
        sprintf(
          tr.gettext(
            '%sLogin cookie validity%s should be set to 1800 seconds (30 minutes) at most. Values larger than 1800 may pose a security risk such as impersonation.',
          ),
          security,
          '[/a]',
        ),
      ),
    )
  }
  const store = cf.getValue('LoginCookieStore')
  if (store !== 0 && validity > Number(store ?? 0)) {
    messages.set(
      'error',
      'LoginCookieValidity',
      name('LoginCookieValidity'),
      bb(
        sprintf(
          tr.gettext(
            'If using [kbd]cookie[/kbd] authentication and %sLogin cookie store%s is not 0, %sLogin cookie validity%s must be set to a value less or equal to it.',
          ),
          security,
          '[/a]',
          security,
          '[/a]',
        ),
      ),
    )
  }

  const directoryNotice = tr.gettext(
    'This value should be double checked to ensure that this directory is neither world accessible nor readable or writable by other users on your server.',
  )
  // `!= ''`
  if (String(cf.getValue('SaveDir') ?? '') !== '')
    messages.set('notice', 'SaveDir', name('SaveDir'), bb(directoryNotice))
  if (String(cf.getValue('TempDir') ?? '') !== '')
    messages.set('notice', 'TempDir', name('TempDir'), bb(directoryNotice))

  // performConfigChecksZips: zlib and zip always exist in Node; bzip2 decompresses (import) but
  // has no compressor, phpMyAdmin's `bzcompress`
  if (!phpEmpty(cf.getValue('BZipDump'))) {
    messages.set(
      'error',
      'BZipDump',
      name('BZipDump'),
      bb(
        sprintf(
          tr.gettext(
            '%1$sBzip2 compression and decompression%2$s requires functions (%3$s) which are unavailable on this system.',
          ),
          importExport,
          '[/a]',
          'bzcompress',
        ),
      ),
    )
  }
}
