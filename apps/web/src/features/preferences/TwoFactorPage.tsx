import type { TwoFactorActionResponse, TwoFactorStatusResponse } from '@bettermyadmin/contracts'
import { DocLink, Loading, MessageBox, Panel, PanelBody, Radio, buttonVariants } from '@bettermyadmin/ui'
import { useMutation, useQuery } from '@tanstack/react-query'
import { type FormEvent, type ReactNode, useCallback, useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'
import { PrefsHeader } from './PrefsHeader.tsx'
import { TwoFactorFields } from './TwoFactorForm.tsx'
import { usePrefsSaved } from './prefsSaved.ts'

/**
 * Two-factor authentication: status, configure (choose → setup → verify) and disable (the
 * current challenge first).
 * pma: src/Controllers/Preferences/TwoFactorController.php, resources/templates/preferences/two_factor/*.twig
 */
export function TwoFactorPage({ server }: { server: number }) {
  const q = useQuery({ queryKey: qk.twoFactor(server), queryFn: () => api.twoFactor(server) })
  const applied = usePrefsSaved(server)
  const [step, setStep] = useState<TwoFactorActionResponse | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})
  const action = useMutation({
    mutationFn: (
      req:
        | { kind: 'configure'; backend: string; fields?: Record<string, string> }
        | { kind: 'remove'; fields?: Record<string, string> },
    ) =>
      req.kind === 'configure'
        ? api.configureTwoFactor(server, {
            backend: req.backend,
            ...(req.fields !== undefined ? { fields: req.fields } : {}),
          })
        : api.removeTwoFactor(server, req.fields !== undefined ? { fields: req.fields } : {}),
    onSuccess: async (r) => {
      setFields({})
      setStep(r)
      if (r.status === 'done') await applied()
    },
  })
  const configure = (backend: string, f?: Record<string, string>) =>
    action.mutate({ kind: 'configure', backend, ...(f !== undefined ? { fields: f } : {}) })
  const remove = (f?: Record<string, string>) =>
    action.mutate({ kind: 'remove', ...(f !== undefined ? { fields: f } : {}) })
  const mutate = action.mutate
  const autoConfigure = useCallback(
    (f: Record<string, string>) => {
      if (step?.status === 'setup') mutate({ kind: 'configure', backend: step.backend, fields: f })
    },
    [step, mutate],
  )
  const autoRemove = useCallback(
    (f: Record<string, string>) => mutate({ kind: 'remove', fields: f }),
    [mutate],
  )

  let body: ReactNode = null
  if (step?.status === 'setup') {
    // pma: preferences/two_factor/configure.twig
    body = (
      <Panel title={t('Configure two-factor authentication')} className="mt-4">
        <PanelBody>
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              configure(step.backend, fields)
            }}
          >
            {step.error !== null && <MessageBox type="error" text={step.error} />}
            <TwoFactorFields
              form={step.form}
              values={fields}
              onChange={setFields}
              onAutoSubmit={autoConfigure}
            />
            <input className={buttonVariants()} type="submit" value={t('Enable two-factor authentication')} />
          </form>
        </PanelBody>
      </Panel>
    )
  } else if (step?.status === 'confirm') {
    // pma: preferences/two_factor/confirm.twig
    body = (
      <Panel title={t('Confirm disabling two-factor authentication')} className="mt-4">
        <PanelBody>
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              remove(fields)
            }}
          >
            <MessageBox
              type="notice"
              text={t(
                'By disabling two factor authentication you will be again able to login using password only.',
              )}
            />
            {step.error !== null && <MessageBox type="error" text={step.error} />}
            <TwoFactorFields
              form={step.form}
              values={fields}
              onChange={setFields}
              onAutoSubmit={autoRemove}
            />
            <input
              className={buttonVariants()}
              type="submit"
              value={t('Disable two-factor authentication')}
            />
          </form>
        </PanelBody>
      </Panel>
    )
  } else if (q.data !== undefined) {
    body = (
      <>
        {step?.status === 'done' && <MessageBox type="notice" text={step.message} className="mt-4" />}
        <Status data={q.data} onConfigure={(b) => configure(b)} onRemove={() => remove()} />
      </>
    )
  }

  return (
    <>
      <PrefsHeader server={server} active="two-factor" saved={false} header={q.data} />
      {q.isPending && <Loading />}
      {q.isError && <MessageBox {...errorMessage(q.error)} />}
      {action.isError && <MessageBox {...errorMessage(action.error)} />}
      {body}
    </>
  )
}

/** pma: preferences/two_factor/main.twig */
function Status({
  data,
  onConfigure,
  onRemove,
}: {
  data: TwoFactorStatusResponse
  onConfigure: (backend: string) => void
  onRemove: () => void
}) {
  const [choice, setChoice] = useState('')
  const missing = (
    <ul className="ms-6 list-disc">
      {data.missing.map((m) => (
        <li key={m.dep}>
          <code>{m.dep}</code> ({m.class})
        </li>
      ))}
    </ul>
  )
  return (
    <>
      <Panel
        title={
          <>
            {t('Two-factor authentication status')} <DocLink page="two_factor" />
          </>
        }
        className="mt-4"
      >
        <PanelBody>
          {!data.enabled ? (
            <p>
              {t(
                'Two-factor authentication is not available, enable phpMyAdmin configuration storage to use it.',
              )}
            </p>
          ) : !data.hasBackends ? (
            <>
              <p>
                {t(
                  'Two-factor authentication is not available, please install optional dependencies to enable authentication backends.',
                )}
              </p>
              <p>{t('Following composer packages are missing:')}</p>
              {missing}
            </>
          ) : (
            <>
              <p>
                {data.backendId !== ''
                  ? t('Two-factor authentication is available and configured for this account.')
                  : t('Two-factor authentication is available, but not configured for this account.')}
              </p>
              {data.missing.length > 0 && (
                <>
                  <p>
                    {t('Please install optional dependencies to enable more authentication backends.')}{' '}
                    {t('Following composer packages are missing:')}
                  </p>
                  {missing}
                </>
              )}
            </>
          )}
        </PanelBody>
      </Panel>
      {data.backendId !== '' ? (
        <Panel title={data.backendName} className="mt-4">
          <PanelBody>
            <p>{t('You have enabled two factor authentication.')}</p>
            <p>{data.backendDescription}</p>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                onRemove()
              }}
            >
              <input
                className={buttonVariants()}
                type="submit"
                name="2fa_remove"
                value={t('Disable two-factor authentication')}
              />
            </form>
          </PanelBody>
        </Panel>
      ) : (
        data.hasBackends && (
          <Panel title={t('Configure two-factor authentication')} className="mt-4">
            <PanelBody>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  onConfigure(choice)
                }}
              >
                {data.backends.map((b) => (
                  // biome-ignore lint/a11y/noLabelWithoutControl: the radio is inside the label (two_factor/main.twig)
                  <label key={b.id} className="block">
                    <Radio
                      name="2fa_configure"
                      value={b.id}
                      checked={choice === b.id}
                      onChange={() => setChoice(b.id)}
                    />{' '}
                    <strong>{b.name}</strong> <p>{b.description}</p>
                  </label>
                ))}
                <input
                  className={buttonVariants()}
                  type="submit"
                  value={t('Configure two-factor authentication')}
                />
              </form>
            </PanelBody>
          </Panel>
        )
      )}
    </>
  )
}
