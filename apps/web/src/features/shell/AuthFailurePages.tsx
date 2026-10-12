import type { AuthFailure, AuthState } from '@bettermyadmin/contracts'
import { MessageBox, NativeSelect, SafeHtml, buttonVariants } from '@bettermyadmin/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from '../../lib/api'
import { t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'
import { LoginHeader } from './LoginPage'

/**
 * The pages of the auth types without a login form.
 * pma: src/Plugins/Auth/AuthenticationConfig.php::showFailure, AuthenticationHttp.php::authForm,
 *      resources/templates/error/generic.twig
 */
export function AuthFailurePage({ state, failure }: { state: AuthState; failure: AuthFailure }) {
  switch (failure.kind) {
    case 'config':
      return <ConfigFailurePage state={state} failure={failure} />
    case 'http':
      return <HttpDeniedPage />
    case 'error':
      return <GenericErrorPage message={failure.message} />
    case 'reload':
      return <ReloadPage />
  }
}

/**
 * AuthenticationConfig::showFailure: "Access denied!" with the allow/deny notice or the
 * connection errors, "Retry to connect" and, with several servers, the server choice.
 */
function ConfigFailurePage({
  state,
  failure,
}: { state: AuthState; failure: Extract<AuthFailure, { kind: 'config' }> }) {
  const qc = useQueryClient()
  useEffect(() => {
    document.title = t('Access denied!')
  }, [])
  return (
    <div id="loginform" className="mx-auto max-w-3xl px-4 py-10">
      <LoginHeader logo={false} />
      <div className="mx-auto w-3/4 space-y-3 text-sm">
        {failure.notice !== null && <MessageBox type="notice" text={failure.notice} />}
        {failure.noConfigFile && (
          <p>
            <SafeHtml
              html={t(
                'You probably did not create a configuration file. You might want to use the %1$ssetup script%2$s to create one.',
                '<a href="/setup">',
                '</a>',
              )}
              as="span"
            />
          </p>
        )}
        {failure.errors.map((e) => (
          <MessageBox key={e} type="error" text={e} />
        ))}
        <a href={`/s/${state.server}`} className={buttonVariants({ variant: 'primary' })}>
          {t('Retry to connect')}
        </a>
        {state.servers.length > 1 && (
          // Select::render(true): another server, its login runs on the next request
          <div className="flex items-center gap-2">
            <label htmlFor="select_server">{t('Current server:')}</label>
            <NativeSelect
              id="select_server"
              className="w-auto!"
              value={String(state.server)}
              onChange={async (e) => {
                const server = Number(e.target.value)
                await api.switchServer(server)
                await qc.invalidateQueries({ queryKey: qk.auth })
              }}
            >
              {state.servers.map((s) => (
                <option key={s.index} value={s.index}>
                  {s.label}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
      </div>
    </div>
  )
}

/** AuthenticationHttp::authForm: the body of the 401 response (shown when the prompt is cancelled). */
function HttpDeniedPage() {
  useEffect(() => {
    document.title = t('Access denied!')
  }, [])
  return (
    <div id="loginform" className="mx-auto max-w-md px-4 py-10">
      <LoginHeader logo={false} />
      <h3>
        <MessageBox type="error" text={t('Wrong username/password. Access denied.')} />
      </h3>
    </div>
  )
}

/** error/generic.twig: "phpMyAdmin - Error" and the message (X33: the product name). */
export function GenericErrorPage({ message }: { message: string }) {
  return (
    <div className="p-4 text-[small]">
      <h1 className="bg-error px-2 py-1 text-[1.4em] font-bold text-white">BetterMyAdmin - {t('Error')}</h1>
      <MessageBox type="error" className="errormessage rounded-none">
        <SafeHtml html={message} as="p" />
      </MessageBox>
    </div>
  )
}

const RELOAD_KEY = 'bma_auth_reload'

/**
 * http / signon without a login: the page load authenticates (401 challenge, SignonURL redirect),
 * so reload once; a second reload within 10 s means nothing authenticates the page.
 */
function ReloadPage() {
  const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0)
  const loop = Date.now() - last < 10_000
  useEffect(() => {
    if (loop) return
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
    window.location.reload()
  }, [loop])
  return loop ? <GenericErrorPage message={t('Cannot log in to the database server.')} /> : null
}
