import type { TwoFactorForm } from '@bettermyadmin/contracts'
import { type Gettext, sprintf } from '@bettermyadmin/i18n'
import type { PrefsMessage } from '@bettermyadmin/metadata'

/** What a backend sees of TwoFactor: the configuration it edits and TwoFactor::save. */
export interface TwoFactorHost {
  config: TwoFactorConfig
  save(): Promise<true | PrefsMessage>
}

/** `$_SESSION` entries of the two-factor backends. */
export interface TwoFactorSessionState {
  /** `2fa_application_key`: the Application secret offered until it is verified */
  applicationKey?: string
  /** `WebAuthnCredentialCreationOptions` / `WebAuthnCredentialRequestOptions` */
  webauthnCreation?: string
  webauthnRequest?: string
}

/** The stored `2fa` block: `{backend, settings}` (+ `type` once read back by TwoFactor::readConfig). */
export interface TwoFactorConfig {
  backend: string
  settings: Record<string, unknown>
  type?: string
}

export interface TwoFactorContext {
  tr: Gettext
  user: string
  /** $cfg['DBG']['simple2fa'] */
  simple2fa: boolean
  state: TwoFactorSessionState
  /** the request host (`HTTP_HOST` without port), the WebAuthn relying party */
  host: string
  /** TwoFactorPlugin::getAppId(false) (PmaAbsoluteUri host or HTTP_HOST) */
  appId: string
}

export type TwoFactorFields = Record<string, string>

/** pma: src/Plugins/TwoFactorPlugin.php and its subclasses */
export abstract class TwoFactorPlugin {
  static readonly id: string = ''
  protected provided = false
  protected message = ''
  constructor(
    protected readonly tf: TwoFactorHost,
    protected readonly ctx: TwoFactorContext,
  ) {}
  abstract get id(): string
  get showSubmit(): boolean {
    return true
  }
  /** TwoFactorPlugin::getError */
  getError(): string | null {
    if (!this.provided) return null
    const tr = this.ctx.tr
    return this.message !== ''
      ? sprintf(tr.gettext('Two-factor authentication failed: %s'), this.message)
      : tr.gettext('Two-factor authentication failed.')
  }
  check(_fields: TwoFactorFields): boolean | Promise<boolean> {
    return true
  }
  render(): TwoFactorForm {
    return { kind: 'none' }
  }
  setup(): TwoFactorForm {
    return { kind: 'none' }
  }
  configure(_fields: TwoFactorFields): boolean | Promise<boolean> {
    return true
  }
}
