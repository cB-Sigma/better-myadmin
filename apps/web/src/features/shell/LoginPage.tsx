import type { AuthState, CaptchaSettings } from '@bettermyadmin/contracts'
import { MessageBox, Panel, PanelBody, buttonVariants, cn, pmaDocUrl } from '@bettermyadmin/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { CircleHelp, Database } from 'lucide-react'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../../lib/api'
import { PROJECT_URL, useConfig } from '../../lib/config'
import { Trans, t, useLanguage } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'
import { LanguageLabel, LanguageSelect } from './LanguageSelect'
import { DemoServerCard, isDemo } from './session/DemoNotice'

/**
 * Cookie-auth login form.
 * pma: resources/templates/login/form.twig, src/Plugins/Auth/AuthenticationCookie.php::showLoginForm
 */
export function LoginPage({
  state,
  error: shownError,
  onLoggedIn,
}: {
  state: AuthState
  /** a failure shown above the form (the inactivity logout of the expired-login form) */
  error?: string
  /** after logging in (the expired-login form goes on with the page) */
  onLoggedIn?: () => void
}) {
  const qc = useQueryClient()
  const [server, setServer] = useState(state.server)
  const [username, setUsername] = useState(state.recalledUser ?? '')
  const [password, setPassword] = useState('')
  const [arbitrary, setArbitrary] = useState('')
  const userRef = useRef<HTMLInputElement>(null)
  const passRef = useRef<HTMLInputElement>(null)
  const { state: lang } = useLanguage()
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (r) => r.location.pathname })
  const cfg = useConfig()

  // focus the password field when a username is prefilled, else the username (functions.ts)
  // biome-ignore lint/correctness/useExhaustiveDependencies: focus once on mount, like functions.ts
  useEffect(() => {
    if (username !== '') passRef.current?.focus()
    else userRef.current?.focus()
  }, [])

  const formRef = useRef<HTMLFormElement>(null)
  const captcha = state.captcha
  useCaptchaScript(captcha, lang?.code ?? 'en')

  const login = useMutation({
    mutationFn: (captchaToken: string | undefined) =>
      api.login({
        server,
        username,
        password,
        ...(state.allowArbitraryServer ? { arbitraryServer: arbitrary } : {}),
        ...(captchaToken !== undefined ? { captchaToken } : {}),
      }),
    onSuccess: async (r) => {
      onLoggedIn?.()
      // rememberCredentials: the chosen server opens (index.php?route=/&server=N); the page of the
      // URL is kept when it belongs to that server, and always after the idle check's login
      // (session_timedout: no redirect)
      const shown = /^\/s\/(\d+)(\/|$)/.exec(pathname)
      if (onLoggedIn === undefined && (shown === null || Number(shown[1]) !== r.server)) {
        await navigate({ to: '/s/$server', params: { server: r.server } })
      }
      await qc.invalidateQueries({ queryKey: qk.auth })
    },
    // a captcha answer is good for one verification
    onSettled: () => (window as CaptchaWindow)[captchaGlobal(captcha)]?.reset?.(),
  })

  // the widget writes its token into the form field named CaptchaResponseParam
  const submit = () => {
    if (username === '') return
    const field = captcha === null ? null : formRef.current?.elements.namedItem(captcha.responseParam)
    login.mutate(
      field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement ? field.value : undefined,
    )
  }
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    // the invisible captcha submits through recaptchaCallback once it has a token
    if (captcha !== null && !captcha.checkbox) return
    submit()
  }
  useEffect(() => {
    // functions.ts: window.recaptchaCallback submits the login form
    ;(window as CaptchaWindow).recaptchaCallback = submit
  })

  let error: string | null = null
  if (login.error instanceof ApiError) error = login.error.message
  else if (login.error) error = login.error.message
  else if (shownError !== undefined && shownError !== '') error = shownError
  else if (state.sessionExpired) error = t('Your session has expired. Please log in again.')

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <LoginHeader />
      {isDemo(cfg) && <DemoServerCard />}

      {/* login/header.twig #js-https-mismatch: shown when the browser and the server disagree */}
      {(window.location.protocol === 'https:') !== state.isHttps && (
        <MessageBox
          id="js-https-mismatch"
          type="error"
          className="mb-4"
          text={t(
            'There is a mismatch between HTTPS indicated on the server and client. This can lead to a non working phpMyAdmin or a security risk. Please fix your server configuration to indicate HTTPS properly.',
          )}
        />
      )}
      {[lang?.warning ?? null, error].map(
        (msg) => msg !== null && <MessageBox key={msg} type="error" text={msg} className="mb-4" />,
      )}

      {/* pma: login/form.twig — only when $cfg['Lang'] is empty and LanguageManager::hasChoice() */}
      {lang?.languages != null && (
        <Panel
          title=<span id="languageSelectLabel">
            <LanguageLabel />
          </span>
          className="mb-4"
        >
          <PanelBody>
            <LanguageSelect labelledBy="languageSelectLabel" />
          </PanelBody>
        </Panel>
      )}

      <form
        ref={formRef}
        id="login_form"
        onSubmit={onSubmit}
        autoComplete={state.recalledUser !== null ? 'on' : 'off'}
      >
        <Panel
          title=<span>{t('Log in')}</span>
          actions={
            <a href={pmaDocUrl('index')} target="_blank" rel="noopener noreferrer" title={t('Documentation')}>
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
          <footer className="flex items-center justify-end gap-3 border-t border-border bg-bg-subtle px-3 py-2">
            {captcha?.checkbox === true && (
              <div className={cn(captcha.requestParam, 'me-auto')} data-sitekey={captcha.siteKey} />
            )}
            <input
              id="input_go"
              type="submit"
              value={t('Log in')}
              disabled={login.isPending}
              className={cn(
                buttonVariants({ variant: 'primary', size: 'lg' }),
                captcha !== null && !captcha.checkbox && captcha.requestParam,
              )}
              {...(captcha !== null && !captcha.checkbox
                ? { 'data-sitekey': captcha.siteKey, 'data-callback': 'recaptchaCallback' }
                : {})}
            />
          </footer>
        </Panel>
      </form>
    </div>
  )
}

/**
 * The logo linking to the project's homepage and "Welcome to BetterMyAdmin" (X33).
 * pma: resources/templates/login/header.twig
 */
export function LoginHeader({ logo = true }: { logo?: boolean }) {
  return (
    <div className="mb-6 flex flex-col items-center gap-2 text-center">
      {/* pma: login/header.twig — the logo links to the project's homepage (tabindex -1); the
          config / http failure pages have the heading only */}
      {logo && (
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
      )}
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
  )
}

type CaptchaWindow = Window & {
  recaptchaCallback?: () => void
  grecaptcha?: { reset?: () => void }
  hcaptcha?: { reset?: () => void }
  turnstile?: { reset?: () => void }
}

/** The widget's global object, for reset() after a verification (g-recaptcha → grecaptcha). */
function captchaGlobal(c: CaptchaSettings | null): 'grecaptcha' | 'hcaptcha' | 'turnstile' {
  if (c?.requestParam.startsWith('h-') === true) return 'hcaptcha'
  if (c?.requestParam.startsWith('cf-') === true) return 'turnstile'
  return 'grecaptcha'
}

/** `<script src="{{ captcha_api }}?hl={{ lang }}" async defer>` once per page. */
function useCaptchaScript(c: CaptchaSettings | null, lang: string) {
  useEffect(() => {
    if (c === null) return
    const src = `${c.api}?hl=${encodeURIComponent(lang)}`
    if (document.querySelector(`script[src="${CSS.escape(src)}"]`) !== null) return
    const el = document.createElement('script')
    el.src = src
    el.async = true
    el.defer = true
    document.head.append(el)
  }, [c, lang])
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
