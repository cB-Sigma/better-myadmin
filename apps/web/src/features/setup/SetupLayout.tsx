import type { SetupPage } from '@bettermyadmin/contracts'
import { cn } from '@bettermyadmin/ui'
import { Link } from '@tanstack/react-router'
import { type ReactNode, useEffect } from 'react'
import { t } from '../../lib/i18n'

/**
 * The setup script's page: the title, the menu (Overview and the form sets) and the content.
 * pma: resources/templates/setup/base.twig
 */
export function SetupLayout({
  pages,
  formset,
  children,
}: {
  pages: readonly SetupPage[]
  /** the current form set ('' on the overview and the other pages) */
  formset: string
  children: ReactNode
}) {
  useEffect(() => {
    // X33: the product name
    document.title = 'BetterMyAdmin setup'
  }, [])
  const item = (to: string, label: string, active: boolean, key: string) => (
    <li key={key}>
      <Link
        to={to}
        className={cn(
          'block rounded px-3 py-1.5 text-[13px] no-underline hover:bg-bg-subtle',
          active && 'active font-semibold text-accent',
        )}
        {...(active ? { 'aria-current': 'page' as const } : {})}
      >
        {label}
      </Link>
    </li>
  )
  return (
    <div className="mx-auto max-w-7xl px-4 py-4">
      <h1 className="mb-4 text-2xl font-semibold">
        <span className="text-accent">BetterMyAdmin</span> setup
      </h1>
      <div className="flex flex-col gap-4 md:flex-row">
        <nav id="menu" className="md:w-56 md:shrink-0">
          <ul className="space-y-0.5">
            {item('/setup', t('Overview'), formset === '', 'overview')}
            {pages.map((p) => item(`/setup/form/${p.formset}`, p.name, formset === p.formset, p.formset))}
          </ul>
        </nav>
        <div id="page" className="setup-page min-w-0 flex-1">
          {children}
        </div>
      </div>
    </div>
  )
}
