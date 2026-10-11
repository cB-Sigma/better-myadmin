import { Alert, PmaIcon } from '@bettermyadmin/ui'
import { Outlet } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { ApiError } from '../../../lib/api.ts'
import { DatabaseTabBar, TableTabBar } from '../ScopeTabBars.tsx'
import { useDatabaseScope, useScopeParams, useTableScope } from '../scope.ts'

function Sticky({ children }: { children: ReactNode }) {
  return (
    <div className="sticky top-0 z-10 -mx-3 -mt-3 mb-3 border-b border-(--tab-border) bg-bg px-2 pt-1 print:hidden">
      {children}
    </div>
  )
}

function ScopeError({ error }: { error: unknown }) {
  const text = error instanceof ApiError || error instanceof Error ? error.message : String(error)
  return (
    <Alert variant="error">
      <PmaIcon name="s_error" /> {text}
    </Alert>
  )
}

/** `/s/:s/db/:db/*` — the database tab bar, unless a table is selected (the table layout renders its own). */
export function DatabaseScopeLayout() {
  const { server, db, table } = useScopeParams()
  const scope = useDatabaseScope(server, db)
  if (table !== '') return <Outlet />
  return (
    <>
      <Sticky>
        <DatabaseTabBar server={server} db={db} />
      </Sticky>
      {scope.isError ? <ScopeError error={scope.error} /> : <Outlet />}
    </>
  )
}

/** `/s/:s/db/:db/t/:table/*` — the table tab bar. */
export function TableScopeLayout() {
  const { server, db, table } = useScopeParams()
  const scope = useTableScope(server, db, table)
  return (
    <>
      <Sticky>
        <TableTabBar server={server} db={db} table={table} />
      </Sticky>
      {scope.isError ? <ScopeError error={scope.error} /> : <Outlet />}
    </>
  )
}
