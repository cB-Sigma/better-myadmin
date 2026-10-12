import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { api } from '../../lib/api'
import { qk } from '../../lib/queryKeys'
import { TwoFactorLogin } from '../preferences/TwoFactorLogin.tsx'
import { LoginPage } from './LoginPage'

/** Like phpMyAdmin, any URL shows the login form until the user is authenticated. */
export function AuthGate({ children }: { children: ReactNode }) {
  const state = useQuery({ queryKey: qk.auth, queryFn: api.authState, staleTime: Number.POSITIVE_INFINITY })
  if (state.isPending) return null
  if (state.isError) {
    return (
      <p className="p-4 text-error">An error has occurred while loading the page: {state.error.message}</p>
    )
  }
  // the password passed, the second factor is pending (AuthenticationPlugin::checkTwoFactor)
  if (!state.data.authenticated && state.data.twoFactorPending) return <TwoFactorLogin />
  if (!state.data.authenticated) return <LoginPage state={state.data} />
  return <>{children}</>
}
