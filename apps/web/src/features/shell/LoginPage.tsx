import type { AuthState } from '@bettermyadmin/contracts'
import { MessageBox, Panel, PanelBody, buttonVariants } from '@bettermyadmin/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CircleHelp, Database } from 'lucide-react'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../../lib/api'
import { PROJECT_URL } from '../../lib/config'
import { Trans, t, useLanguage } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'
import { LanguageLabel, LanguageSelect } from './LanguageSelect'

/**
 * Cookie-auth login form.
 * pma: resources/templates/login/form.twig, src/Plugins/Auth/AuthenticationCookie.php::showLoginForm
 */
export function LoginPage({ state }: { state: AuthState }) {
  const qc = useQueryClient()
  const [server, setServer] = useState(state.server)
  const [username, setUsername] = useState(state.recalledUser ?? '')
  const [password, setPassword] = useState('')
  const [arbitrary, setArbitrary] = useState('')
  const userRef = useRef<HTMLInputElement>(null)
  const passRef = useRef<HTMLInputElement>(null)
  const { state: lang } = useLanguage()

  // focus the password field when a username is prefilled, else the username (functions.ts)
  // biome-ignore lint/correctness/useExhaustiveDependencies: focus once on mount, like functions.ts
  useEffect(() => {
    if (username !== '') passRef.current?.focus()
    else userRef.current?.focus()
  }, [])

  const login = useMutation({
    mutationFn: () =>
      api.login({
        server,
        username,
        password,
        ...(state.allowArbitraryServer ? { arbitraryServer: arbitrary } : {}),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.auth }),
  })

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (username === '') return
    login.mutate()
  }

  let error: string | null = null
  if (login.error instanceof ApiError) error = login.error.message
  else if (login.error) error = login.error.message
  else if (state.sessionExpired) error = t('Your session has expired. Please log in again.')

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        {/* pma: login/header.twig — the logo links to the project's homepage (tabindex -1) */}
        <a
          href={PROJECT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="logo"
          tabIndex={-1}
          aria-label="BetterMyAdmin"
        >
          <Database className="size-12 text-accent" aria-hidden />
        </a>
        <h1 className="text-xl font-semibold">
          <Trans
            id="Welcome to %s"
            args={[
              <bdo key="name" dir="ltr" lang="en">
                BetterMyAdmin
              </bdo>,
            ]}
          />
        </h1>
      </div>

      {[lang?.warning ?? null, error].map(
        (msg) => msg !== null && <MessageBox key={msg} type="error" text={msg} className="mb-4" />,
      )}

      {/* pma: login/form.twig — only when $cfg['Lang'] is empty and LanguageManager::hasChoice() */}
      {lang?.languages != null && (
        <Panel
          title={
            <>
              <span id="languageSelectLabel">
                <LanguageLabel />
              </span>
            </>
          }
          className="mb-4"
        >
          <PanelBody>
            <LanguageSelect labelledBy="languageSelectLabel" />
          </PanelBody>
        </Panel>
      )}

      <form id="login_form" onSubmit={onSubmit} autoComplete={state.recalledUser !== null ? 'on' : 'off'}>
        <Panel
          title={
            <>
              <span>{t('Log in')}</span>
            </>
          }
          actions={
            <a
              href="https://docs.phpmyadmin.net/en/latest/"
              target="_blank"
              rel="noopener noreferrer"
              title={t('Documentation')}
            >
              <CircleHelp className="size-4" aria-hidden />
              <span className="sr-only">{t('Documentation')}</span>
            </a>
          }
        >
          <div className="space-y-3 p-3 text-sm">
            {state.allowArbitraryServer && (
              <Row
                label={t('Server:')}
                htmlFor="serverNameInput"
                title={t('You can enter hostname/IP address and port separated by space.')}
              >
                <input
                  id="serverNameInput"
                  name="pma_servername"
                  className="input"
                  value={arbitrary}
                  onChange={(e) => setArbitrary(e.target.value)}
                />
              </Row>
            )}
            <Row label={t('Username:')} htmlFor="input_username">
              <input
                ref={userRef}
                id="input_username"
                name="pma_username"
                className="input"
                autoComplete="username"
                spellCheck={false}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </Row>
            <Row label={t('Password:')} htmlFor="input_password">
              <input
                ref={passRef}
                id="input_password"
                name="pma_password"
                type="password"
                className="input"
                autoComplete="current-password"
                spellCheck={false}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Row>
            {state.servers.length > 1 && (
              <Row label={t('Server choice:')} htmlFor="select_server">
                <select
                  id="select_server"
                  name="server"
                  className="input"
                  value={server}
                  onChange={(e) => {
                    setServer(Number(e.target.value))
                    if (state.allowArbitraryServer) setArbitrary('')
                  }}
                >
                  {state.servers.map((s) => (
                    <option key={s.index} value={s.index}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Row>
            )}
          </div>
          <footer className="flex justify-end border-t border-border bg-bg-subtle px-3 py-2">
            <input
              id="input_go"
              type="submit"
              value={t('Log in')}
              disabled={login.isPending}
              className={buttonVariants({ variant: 'primary', size: 'lg' })}
            />
          </footer>
        </Panel>
      </form>
    </div>
  )
}

function Row(props: { label: string; htmlFor: string; title?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] items-center gap-2">
      <label htmlFor={props.htmlFor} title={props.title}>
        {props.label}
      </label>
      {props.children}
    </div>
  )
}
