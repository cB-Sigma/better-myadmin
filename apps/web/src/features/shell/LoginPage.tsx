import type { AuthState } from '@bettermyadmin/contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CircleHelp, Database } from 'lucide-react'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../../lib/api'
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
        <Database className="size-12 text-accent" aria-hidden />
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
        (msg) =>
          msg !== null && (
            <div
              key={msg}
              role="alert"
              className="mb-4 rounded border border-error/40 bg-error-bg px-3 py-2 text-sm text-error"
            >
              {msg}
            </div>
          ),
      )}

      {/* pma: login/form.twig — only when $cfg['Lang'] is empty and LanguageManager::hasChoice() */}
      {lang?.languages != null && (
        <section className="mb-4 rounded border border-border bg-bg-elevated">
          <header className="border-b border-border bg-bg-subtle px-3 py-2 text-sm font-semibold">
            <span id="languageSelectLabel">
              <LanguageLabel />
            </span>
          </header>
          <div className="p-3 text-sm">
            <LanguageSelect labelledBy="languageSelectLabel" />
          </div>
        </section>
      )}

      <form id="login_form" onSubmit={onSubmit} autoComplete={state.recalledUser !== null ? 'on' : 'off'}>
        <section className="rounded border border-border bg-bg-elevated">
          <header className="flex items-center justify-between border-b border-border bg-bg-subtle px-3 py-2 text-sm font-semibold">
            <span>{t('Log in')}</span>
            <a
              href="https://docs.phpmyadmin.net/en/latest/"
              target="_blank"
              rel="noopener noreferrer"
              title={t('Documentation')}
            >
              <CircleHelp className="size-4" aria-hidden />
              <span className="sr-only">{t('Documentation')}</span>
            </a>
          </header>
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
              className="cursor-pointer rounded bg-accent px-4 py-1.5 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60"
            />
          </footer>
        </section>
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
