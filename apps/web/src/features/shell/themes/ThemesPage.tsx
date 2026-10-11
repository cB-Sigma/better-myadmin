import { useParams } from '@tanstack/react-router'
import { useConfig } from '../../../lib/config.ts'
import { setTheme, useThemeState } from '../theme/theme.ts'
import { ThemeCards } from './ThemeCards.tsx'

/** `/themes` as a page (phpMyAdmin renders the same cards into the home page modal). */
export function ThemesPage() {
  const { server } = useParams({ from: '/s/$server' })
  const cfg = useConfig()
  const opts = { themeDefault: cfg.ThemeDefault, perServer: cfg.ThemePerServer, server }
  const theme = useThemeState(opts)
  return (
    <section>
      <h2 className="mb-3 text-base font-semibold">phpMyAdmin Themes</h2>
      <ThemeCards active={theme.theme} onTake={(id) => (cfg.ThemeManager ? setTheme(opts, id) : undefined)} />
    </section>
  )
}
