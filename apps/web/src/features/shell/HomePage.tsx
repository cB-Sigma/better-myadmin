import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { CircleHelp, Languages } from 'lucide-react'
import { api } from '../../lib/api'
import { t, useLanguage } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'
import { LanguageLabel, LanguageSelect } from './LanguageSelect'

/** Home page placeholder; the full set of blocks (pma: HomeController) lands in M1. */
export function HomePage() {
  const { server } = useParams({ from: '/s/$server' })
  const auth = useQuery({ queryKey: qk.auth, queryFn: api.authState })
  const { state: lang } = useLanguage()
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      {/* pma: home/index.twig "Appearance settings" → #li_select_lang (when there is a language choice) */}
      {lang?.languages != null && (
        <section className="rounded border border-border">
          <h2 className="border-b border-border bg-bg-subtle px-3 py-2 text-sm font-semibold">
            {t('Appearance settings')}
          </h2>
          <ul className="px-3 py-3 text-sm">
            <li id="li_select_lang" className="flex flex-wrap items-center gap-2">
              <label htmlFor="languageSelect" className="flex items-center gap-1 whitespace-nowrap">
                <Languages className="size-4" aria-hidden />
                <LanguageLabel />
                <a
                  href="https://docs.phpmyadmin.net/en/latest/faq.html#faq7-2"
                  target="documentation"
                  title={t('Documentation')}
                >
                  <CircleHelp className="size-4" aria-hidden />
                  <span className="sr-only">{t('Documentation')}</span>
                </a>
              </label>
              <LanguageSelect className="input w-auto" />
            </li>
          </ul>
        </section>
      )}
      <section className="rounded border border-border">
        <h2 className="border-b border-border bg-bg-subtle px-3 py-2 text-sm font-semibold">
          {t('Database server')}
        </h2>
        <ul className="list-disc space-y-1 px-8 py-3 text-sm">
          <li>
            {t('Server:')} {auth.data?.servers.find((s) => s.index === server)?.label}
          </li>
          <li>
            {t('User:')} {auth.data?.user}
          </li>
        </ul>
      </section>
    </div>
  )
}
