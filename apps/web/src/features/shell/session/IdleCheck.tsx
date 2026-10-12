import type { AuthState } from '@bettermyadmin/contracts'
import { Dialog, DialogContent, DialogTitle } from '@bettermyadmin/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { api } from '../../../lib/api'
import { t } from '../../../lib/i18n'
import { qk } from '../../../lib/queryKeys'
import { LoginPage } from '../LoginPage'

/** setTimeout's largest delay (2^31 - 1 ms), as functions.ts caps it */
const MAX_DELAY = 2 ** 31 - 1

/** The window's id for its browser_access_time entry (sessionStorage `guid`). */
function windowGuid(): string {
  const make = () =>
    Array.from(crypto.getRandomValues(new Uint16Array(8)), (n) => n.toString(16).padStart(4, '0')).join('')
  try {
    let g = window.sessionStorage.getItem('guid')
    if (g === null) {
      g = make()
      window.sessionStorage.setItem('guid', g)
    }
    return g
  } catch {
    return 'default'
  }
}

/** While the expired-login form is shown the page stays (AuthGate does not swap it out). */
export const sessionOverlay = { open: false }

/**
 * The idle check of a logged-in window: seconds without a click, mouse move or key press are
 * counted; shortly before LoginCookieValidity runs out the server is asked whether the login is
 * still there (with the idle time, so another active window keeps it alive). When it is gone the
 * login form opens over the page; after logging in again the page goes on where it was.
 * pma: resources/js/modules/functions.ts::onloadIdleEvent (SetIdleTime, UpdateIdleTime),
 *      templates/login/header.twig (#modalOverlay), AuthenticationCookie::showLoginForm (check_timeout)
 */
export function IdleCheck() {
  const auth = useQuery({ queryKey: qk.auth, queryFn: api.authState, staleTime: Number.POSITIVE_INFINITY })
  const validity = auth.data?.authenticated === true ? auth.data.loginCookieValidity : 0
  const [expired, setExpired] = useState<string | null>(null)
  const idle = useRef(0)

  useEffect(() => {
    if (validity <= 0) return
    const guid = windowGuid()
    idle.current = 0
    const reset = () => {
      idle.current = 0
    }
    document.addEventListener('click', reset)
    document.addEventListener('mousemove', reset)
    document.addEventListener('keypress', reset)
    const tick = window.setInterval(() => {
      idle.current++
    }, 1000)
    let timer = 0
    let stopped = false
    const check = async () => {
      const r = await api.checkTimeout({ guid, access_time: idle.current }).catch(() => null)
      if (stopped) return
      if (r === null || r.success) {
        // another window is active: the login validity counts from now
        if (validity - idle.current < 0) idle.current = 0
        const remaining = validity - idle.current
        const interval = remaining > 5 ? Math.min((remaining - 1) * 1000, MAX_DELAY) : 1000
        timer = window.setTimeout(() => void check(), interval)
        return
      }
      // timeout occurred
      window.clearInterval(tick)
      try {
        window.sessionStorage.clear()
      } catch {
        // storage unavailable
      }
      idle.current = 0
      sessionOverlay.open = true
      setExpired(r.message ?? '')
    }
    timer = window.setTimeout(() => void check(), Math.min(Math.max(validity - 5, 1) * 1000, MAX_DELAY))
    return () => {
      stopped = true
      window.clearTimeout(timer)
      window.clearInterval(tick)
      document.removeEventListener('click', reset)
      document.removeEventListener('mousemove', reset)
      document.removeEventListener('keypress', reset)
    }
  }, [validity])

  if (expired === null || auth.data === undefined) return null
  return <ExpiredLogin state={auth.data} message={expired} onDone={() => setExpired(null)} />
}

/** The login form over the page (#modalOverlay > .modal_form): static, nothing else is reachable. */
function ExpiredLogin({ state, message, onDone }: { state: AuthState; message: string; onDone: () => void }) {
  const qc = useQueryClient()
  return (
    <Dialog open>
      <DialogContent id="modalOverlay" modal="static" hideClose size="md" aria-describedby={undefined}>
        <DialogTitle className="sr-only">{t('Log in')}</DialogTitle>
        <div className="modal_form overflow-auto">
          <LoginPage
            state={{ ...state, sessionExpired: false }}
            error={message}
            onLoggedIn={() => {
              sessionOverlay.open = false
              onDone()
              // the page reads its data again with the new login (handleRedirectAndReload)
              void qc.invalidateQueries()
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
