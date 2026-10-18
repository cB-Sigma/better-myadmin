import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The optional two-factor packages phpMyAdmin's reference checkout is installed without
 * (`composer install --no-dev`: they are only suggested), at the versions of its composer.lock.
 * They are installed into a side Composer project (cached in `.data/pma-2fa-vendor`) whose
 * autoloader a private instance's config.inc.php requires: TwoFactor checks `class_exists` at run
 * time, so the authenticator-app (`application`) backend is offered then. `web-auth/webauthn-lib`
 * is left out, as in phpMyAdmin's release builds, so WebAuthn uses its CustomServer.
 *
 * Sources (`--prefer-source`), because GitHub's dist archives need a token here.
 */
const PACKAGES = {
  'pragmarx/google2fa-qrcode': '3.0.1',
  'pragmarx/google2fa': '8.0.3',
  'bacon/bacon-qr-code': '3.1.1',
  'dasprid/enum': '1.0.7',
  'paragonie/constant_time_encoding': '3.1.3',
  'code-lts/u2f-php-server': '1.2.2',
}

const here = dirname(fileURLToPath(import.meta.url))
const DIR = process.env.BMA_PARITY_2FA_VENDOR ?? join(here, '../../../.data/pma-2fa-vendor')

/** The side project's `vendor/autoload.php`, installing it on first use; null when Composer fails. */
export function twoFactorVendor(): string | null {
  const autoload = join(DIR, 'vendor/autoload.php')
  if (existsSync(autoload)) return autoload
  mkdirSync(DIR, { recursive: true })
  writeFileSync(
    join(DIR, 'composer.json'),
    JSON.stringify({ require: PACKAGES, config: { 'preferred-install': 'source', 'platform-check': false } }),
  )
  const r = spawnSync(
    process.env.BMA_PARITY_COMPOSER ?? 'composer',
    ['install', '--no-interaction', '--no-progress'],
    {
      cwd: DIR,
      encoding: 'utf8',
      timeout: 600_000,
      env: { ...process.env, COMPOSER_ALLOW_SUPERUSER: '1' },
    },
  )
  if (r.status !== 0 || !existsSync(autoload)) {
    console.warn(`pma-2fa-vendor: composer install failed\n${r.stderr ?? r.error}`)
    return null
  }
  return autoload
}
