import type { TwoFactorBackend, TwoFactorForm, TwoFactorStatusResponse } from '@bettermyadmin/contracts'
import type { Gettext } from '@bettermyadmin/i18n'
import type { PrefsMessage, UserPreferences } from '@bettermyadmin/metadata'
import { qrMatrix } from './qr.ts'
import { generateSecretKey, otpauthUrl, verifyKey } from './totp.ts'
import {
  type TwoFactorConfig,
  type TwoFactorContext,
  type TwoFactorFields,
  type TwoFactorHost,
  TwoFactorPlugin,
} from './two-factor-plugin.ts'
import { WebAuthnBackend } from './webauthn.ts'

export type {
  TwoFactorConfig,
  TwoFactorContext,
  TwoFactorFields,
  TwoFactorSessionState,
} from './two-factor-plugin.ts'

/** No Two-Factor Authentication */
class NoneBackend extends TwoFactorPlugin {
  get id() {
    return ''
  }
}

/** pma: src/Plugins/TwoFactor/Simple.php */
class SimpleBackend extends TwoFactorPlugin {
  get id() {
    return 'simple'
  }
  override check(fields: TwoFactorFields) {
    return fields['2fa_confirm'] !== undefined
  }
  override render(): TwoFactorForm {
    return { kind: 'simple' }
  }
}

/** pma: src/Plugins/TwoFactor/Invalid.php */
class InvalidBackend extends TwoFactorPlugin {
  get id() {
    return 'invalid'
  }
  override get showSubmit() {
    return false
  }
  override check() {
    return false
  }
  override render(): TwoFactorForm {
    return { kind: 'invalid' }
  }
}

/** pma: src/Plugins/TwoFactor/Application.php (TOTP, window 8) */
class ApplicationBackend extends TwoFactorPlugin {
  constructor(tf: TwoFactorHost, ctx: TwoFactorContext) {
    super(tf, ctx)
    if (tf.config.settings.secret === undefined) tf.config.settings.secret = ''
  }
  get id() {
    return 'application'
  }
  override check(fields: TwoFactorFields) {
    this.provided = false
    const code = fields['2fa_code']
    if (code === undefined) return false
    this.provided = true
    return verifyKey(String(this.tf.config.settings.secret ?? ''), code, 8)
  }
  override render(): TwoFactorForm {
    return { kind: 'application' }
  }
  override setup(): TwoFactorForm {
    const secret = String(this.tf.config.settings.secret ?? '')
    // the issuer shown in the authenticator app (phpMyAdmin's is `phpMyAdmin (…)`, X57)
    const url = otpauthUrl(`BetterMyAdmin (${this.ctx.appId})`, this.ctx.user, secret)
    return { kind: 'application_configure', secret, qr: qrMatrix(url), otpauth: url }
  }
  override configure(fields: TwoFactorFields) {
    this.ctx.state.applicationKey ??= generateSecretKey()
    this.tf.config.settings.secret = this.ctx.state.applicationKey
    const result = this.check(fields)
    if (result) delete this.ctx.state.applicationKey
    return result
  }
}

type BackendCtor = (new (
  tf: TwoFactorHost,
  ctx: TwoFactorContext,
) => TwoFactorPlugin) & {
  displayName: (tr: Gettext) => string
  description: (tr: Gettext) => string
  backendId: string
}

const backend = (
  cls: new (tf: TwoFactorHost, ctx: TwoFactorContext) => TwoFactorPlugin,
  backendId: string,
  displayName: (tr: Gettext) => string,
  description: (tr: Gettext) => string,
): BackendCtor => Object.assign(cls, { backendId, displayName, description }) as BackendCtor

const NONE = backend(
  NoneBackend,
  '',
  (tr) => tr.gettext('No Two-Factor Authentication'),
  (tr) => tr.gettext('Login using password only.'),
)
const SIMPLE = backend(
  SimpleBackend,
  'simple',
  (tr) => tr.gettext('Simple two-factor authentication'),
  (tr) => tr.gettext('For testing purposes only!'),
)
const APPLICATION = backend(
  ApplicationBackend,
  'application',
  (tr) => tr.gettext('Authentication Application (2FA)'),
  (tr) =>
    tr.gettext(
      'Provides authentication using HOTP and TOTP applications such as FreeOTP, Google Authenticator or Authy.',
    ),
)
const WEBAUTHN = backend(
  WebAuthnBackend,
  'WebAuthn',
  (tr) => tr.gettext('Hardware Security Key (WebAuthn/FIDO2)'),
  (tr) =>
    tr.gettext(
      'Provides authentication using hardware security tokens supporting the WebAuthn/FIDO2 protocol, such as a YubiKey.',
    ),
)
const INVALID = backend(
  InvalidBackend,
  'invalid',
  () => 'Invalid two-factor authentication',
  () => 'Error fallback only!',
)

/**
 * Two-factor authentication of one user: the `2fa` block of the preferences and its backend.
 *
 * pma: src/TwoFactor.php
 */
export class TwoFactor implements TwoFactorHost {
  config: TwoFactorConfig
  readonly writable: boolean
  backend: TwoFactorPlugin
  readonly #prefs: UserPreferences
  readonly #ctx: TwoFactorContext

  private constructor(prefs: UserPreferences, ctx: TwoFactorContext, config: TwoFactorConfig) {
    this.#prefs = prefs
    this.#ctx = ctx
    this.config = config
    // the local store is permanent storage like pmadb
    this.writable = config.type === 'db' || config.type === 'local'
    this.backend = new (this.backendClass(config.backend))(this, ctx)
  }

  /** new TwoFactor($user): reads the configuration */
  static async create(prefs: UserPreferences, ctx: TwoFactorContext): Promise<TwoFactor> {
    return new TwoFactor(prefs, ctx, await TwoFactor.readConfig(prefs))
  }

  /** TwoFactor::readConfig */
  static async readConfig(prefs: UserPreferences): Promise<TwoFactorConfig> {
    const loaded = await prefs.load()
    const raw = loaded.config_data['2fa']
    const block =
      raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
    const settings = block.settings
    return {
      backend: typeof block.backend === 'string' ? block.backend : '',
      settings:
        settings !== null && typeof settings === 'object'
          ? Array.isArray(settings)
            ? Object.fromEntries(settings.map((v, i) => [String(i), v]))
            : { ...(settings as Record<string, unknown>) }
          : {},
      type: loaded.type,
    }
  }

  /** TwoFactor::getAvailableBackends (Application has its dependencies; U2F `key` has not) */
  available(): BackendCtor[] {
    const out: BackendCtor[] = [NONE]
    if (this.#ctx.simple2fa) out.push(SIMPLE)
    out.push(APPLICATION, WEBAUTHN)
    return out
  }

  /**
   * TwoFactor::getMissingDeps: phpMyAdmin lists the U2F library (a composer package) here. The FIDO
   * U2F API is gone from browsers and there is nothing to install, so the list is empty (X49, X57).
   */
  missingDeps(): Array<{ class: string; dep: string }> {
    return []
  }

  backendClass(name: string): BackendCtor {
    return this.available().find((b) => b.backendId === name) ?? INVALID
  }

  get showSubmit(): boolean {
    return this.backend.showSubmit
  }

  /** TwoFactor::check with `$skipSession` (the session cache is the login's twoFactorOk) */
  async check(fields: TwoFactorFields): Promise<boolean> {
    return this.backend.check(fields)
  }

  /** TwoFactor::render: the error of the last check + the challenge form */
  render(): { form: TwoFactorForm; error: string | null } {
    return { error: this.backend.getError(), form: this.backend.render() }
  }

  /** TwoFactor::setup */
  setup(): { form: TwoFactorForm; error: string | null } {
    return { error: this.backend.getError(), form: this.backend.setup() }
  }

  /** TwoFactor::save: persistOption('2fa', config, null) */
  save(): Promise<true | PrefsMessage> {
    return this.#prefs.persistOption('2fa', configForSave(this.config), null)
  }

  /** TwoFactor::configure */
  async configure(
    name: string,
    fields: TwoFactorFields,
  ): Promise<{ ok: boolean; message: PrefsMessage | null }> {
    this.config = { backend: name, settings: {} }
    const cls = this.backendClass(name)
    if (name !== '' && cls === INVALID) return { ok: false, message: null }
    this.backend = new cls(this, this.#ctx)
    if (name !== '' && !(await this.backend.configure(fields))) return { ok: false, message: null }
    const r = await this.save()
    return { ok: true, message: r === true ? null : r }
  }

  /** TwoFactor::getAllBackends */
  allBackends(): TwoFactorBackend[] {
    const tr = this.#ctx.tr
    return this.available().map((b) => ({
      id: b.backendId,
      name: b.displayName(tr),
      description: b.description(tr),
    }))
  }

  /** preferences/two_factor/main.twig data */
  status(): Omit<TwoFactorStatusResponse, 'storage' | 'hasConfigStorage'> {
    const tr = this.#ctx.tr
    const cls = this.backendClass(this.config.backend)
    return {
      enabled: this.writable,
      hasBackends: this.available().length > 1,
      backendId: cls.backendId,
      backendName: cls.displayName(tr),
      backendDescription: cls.description(tr),
      backends: this.allBackends(),
      missing: this.missingDeps(),
    }
  }
}

/** The `2fa` block as PHP json-encodes it (key order backend, settings[, type]). */
function configForSave(c: TwoFactorConfig): Record<string, unknown> {
  return {
    backend: c.backend,
    settings: c.settings,
    ...(c.type !== undefined ? { type: c.type } : {}),
  }
}
