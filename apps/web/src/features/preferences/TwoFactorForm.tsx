import type { TwoFactorForm as TwoFactorFormData } from '@bettermyadmin/contracts'
import { Input, Label, MessageBox, showMessage } from '@bettermyadmin/ui'
import { useEffect, useRef } from 'react'
import { t } from '../../lib/i18n'
import { webauthnCreate, webauthnGet, webauthnSupported } from './twoFactor.ts'

/** The QR code of the Application setup (bacon's SVG renderer: 4 modules margin). */
function QrCode({ rows }: { rows: string[] }) {
  const n = rows.length
  const size = n + 8
  let d = ''
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '1') d += `M${x + 4},${y + 4}h1v1h-1z`
  })
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={200}
      height={200}
      role="img"
      aria-label="QR code"
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="white" />
      <path d={d} fill="black" />
    </svg>
  )
}

/**
 * The fields of a two-factor backend form: the login / disable challenge (TwoFactorPlugin::render)
 * or the setup step (::setup). WebAuthn forms run the browser ceremony and submit by themselves.
 * pma: resources/templates/login/twofactor/*.twig, resources/js/webauthn.ts
 */
export function TwoFactorFields({
  form,
  values,
  onChange,
  onAutoSubmit,
}: {
  form: TwoFactorFormData
  values: Record<string, string>
  onChange: (v: Record<string, string>) => void
  /** WebAuthn: the authenticator answered, submit with these fields */
  onAutoSubmit: (v: Record<string, string>) => void
}) {
  const started = useRef<string | null>(null)
  // the hidden 2fa_confirm of the Simple backend
  useEffect(() => {
    if (form.kind === 'simple' && values['2fa_confirm'] === undefined) onChange({ '2fa_confirm': '1' })
  }, [form.kind, values, onChange])
  useEffect(() => {
    if (form.kind !== 'webauthn_creation' && form.kind !== 'webauthn_request') return
    if (started.current === form.options) return
    started.current = form.options
    if (!webauthnSupported()) {
      showMessage(
        t('WebAuthn is not available. Please use a supported browser in a secure context (HTTPS).'),
        false,
        'error',
      )
      return
    }
    const run = form.kind === 'webauthn_creation' ? webauthnCreate : webauthnGet
    const field =
      form.kind === 'webauthn_creation' ? 'webauthn_creation_response' : 'webauthn_request_response'
    run(form.options)
      .then((json) => onAutoSubmit({ [field]: json }))
      .catch((e: unknown) => showMessage(String(e), false, 'error'))
  }, [form, onAutoSubmit])

  switch (form.kind) {
    case 'application':
      return (
        <div className="mb-3">
          <Label className="form-label block" htmlFor="2faCodeInput">
            {t('Authentication code:')}
          </Label>
          <Input
            id="2faCodeInput"
            type="text"
            name="2fa_code"
            autoComplete="off"
            autoFocus
            value={values['2fa_code'] ?? ''}
            onChange={(e) => onChange({ ...values, '2fa_code': e.target.value })}
          />
          <p className="mt-2">
            {t(
              'Open the two-factor authentication app on your device to view your authentication code and verify your identity.',
            )}
          </p>
        </div>
      )
    case 'application_configure':
      return (
        <>
          <p>
            {t(
              'Please scan following QR code into the two-factor authentication app on your device and enter authentication code it generates.',
            )}
          </p>
          <p className="my-2">
            <QrCode rows={form.qr} />
          </p>
          <p>
            {t('Secret/key:')} <strong>{form.secret}</strong>
          </p>
          <p className="my-2">
            <Label>
              {t('Authentication code:')}{' '}
              <Input
                type="text"
                name="2fa_code"
                autoComplete="off"
                className="w-auto!"
                value={values['2fa_code'] ?? ''}
                onChange={(e) => onChange({ ...values, '2fa_code': e.target.value })}
              />
            </Label>
          </p>
        </>
      )
    case 'webauthn_creation':
      return (
        <p className="card-text">
          {t('Please connect your WebAuthn/FIDO2 device. Then confirm registration on the device.')}
        </p>
      )
    case 'webauthn_request':
      return (
        <p className="card-text">
          {t('Please connect your WebAuthn/FIDO2 device. Then confirm login on the device.')}
        </p>
      )
    case 'invalid':
      return (
        <MessageBox
          type="error"
          text={t(
            'The configured two factor authentication is not available, please install missing dependencies.',
          )}
        />
      )
    default:
      return null
  }
}
