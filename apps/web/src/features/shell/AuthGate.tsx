import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useEffect } from 'react'
import { AUTH_LOST_EVENT, api } from '../../lib/api'
import { qk } from '../../lib/queryKeys'
import { TwoFactorLogin } from '../preferences/TwoFactorLogin.tsx'
import { AuthFailurePage } from './AuthFailurePages'
import { LoginPage } from './LoginPage'

/** Like phpMyAdmin, any URL shows the login form until the user is authenticated. */
export function AuthGate({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const state = useQuery({ queryKey: qk.auth, queryFn: api.authState, staleTime: Number.POSITIVE_INFINITY })
  // a request found the session expired: back to the login form, the page kept for after the login
  useEffect(() => {
    const lost = () => void qc.invalidateQueries({ queryKey: qk.auth })
    window.addEventListener(AUTH_LOST_EVENT, lost)
    return () => window.removeEventListener(AUTH_LOST_EVENT, lost)
  }, [qc])
  if (state.isPending) return null
  if (state.isError) {
    return (
      <p className="p-4 text-error">An error has occurred while loading the page: {state.error.message}</p>
    )
  }
  // the password passed, the second factor is pending (AuthenticationPlugin::checkTwoFactor)
  if (!state.data.authenticated && state.data.twoFactorPending) return <TwoFactorLogin />
  // config / http / signon: no login form (AuthenticationConfig / Http / Signon)
  if (!state.data.authenticated && state.data.failure !== null)
    return <AuthFailurePage state={state.data} failure={state.data.failure} />
  if (!state.data.authenticated) return <LoginPage state={state.data} />
  return <>{children}</>
}
