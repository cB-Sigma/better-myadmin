/**
 * The four built-in themes of phpMyAdmin, as token sets (themes.css). Manifest fields are the
 * `public/themes/<id>/theme.json` of phpMyAdmin; `colorModes` lists phpMyAdmin's modes plus the
 * `dark` variant every theme gets here (parity exceptions X16/X23).
 * pma: src/Theme/Theme.php, src/Theme/ThemeManager.php
 */
export interface ThemeManifest {
  id: ThemeId
  name: string
  version: string
  description: string
  author: string
  url: string
  supports: string[]
  /** First entry is the default mode (Theme::getColorModes()[0]). */
  colorModes: string[]
  /** phpMyAdmin's own list, before the dark variant was added. */
  pmaColorModes: string[]
}

export const THEME_IDS = ['bootstrap', 'metro', 'original', 'pmahomme'] as const
export type ThemeId = (typeof THEME_IDS)[number]

/** ThemeManager::FALLBACK_THEME */
export const FALLBACK_THEME: ThemeId = 'pmahomme'

const common = { version: '6.0', url: 'https://www.phpmyadmin.net/', supports: ['6.0'] }

/** Sorted by id like ThemeManager::loadThemes (ksort). */
export const THEMES: readonly ThemeManifest[] = [
  {
    ...common,
    id: 'bootstrap',
    name: 'Bootstrap',
    description: 'Bootstrap theme for phpMyAdmin',
    author: 'phpMyAdmin developers',
    colorModes: ['light', 'dark'],
    pmaColorModes: ['light', 'dark'],
  },
  {
    ...common,
    id: 'metro',
    name: 'Metro',
    description: 'Metro theme for phpMyAdmin',
    author: 'phpMyAdmin developers and hplhu',
    colorModes: ['win', 'teal', 'redmond', 'blueeyes', 'mono', 'dark'],
    pmaColorModes: ['win', 'teal', 'redmond', 'blueeyes', 'mono'],
  },
  {
    ...common,
    id: 'original',
    name: 'Original',
    description: 'Original phpMyAdmin theme',
    author: 'phpMyAdmin developers',
    colorModes: ['light', 'dark'],
    pmaColorModes: ['light'],
  },
  {
    ...common,
    id: 'pmahomme',
    name: 'pmahomme',
    description: 'Default phpMyAdmin theme',
    author: 'phpMyAdmin developers',
    colorModes: ['light', 'dark'],
    pmaColorModes: ['light'],
  },
]

export function getTheme(id: string): ThemeManifest | undefined {
  return THEMES.find((t) => t.id === id)
}

export function themeExists(id: string): id is ThemeId {
  return getTheme(id) !== undefined
}

/**
 * Cookie / storage key of the active theme: `bma_theme`, or `bma_theme-<server>` with
 * ThemePerServer (pma: `pma_theme[-N]`). The colour mode key appends `_color`.
 * pma: ThemeManager::getThemeCookieName, getColorModeCookieName
 */
export function themeKey(perServer: boolean, server: number): string {
  return perServer ? `bma_theme-${server}` : 'bma_theme'
}

export function colorModeKey(perServer: boolean, server: number): string {
  return `${themeKey(perServer, server)}_color`
}

export interface ThemeState {
  theme: ThemeId
  /** The stored mode, `null` = follow `prefers-color-scheme` (X23). */
  storedMode: string | null
  /** The mode applied to `<html data-color-mode>`. */
  colorMode: string
}

/**
 * ThemeManager::initializeTheme: the stored theme wins, else ThemeDefault, else pmahomme. An
 * unknown stored theme falls back to ThemeDefault (phpMyAdmin throws MissingTheme; recorded as
 * parity exception X26). The mode is applied only when the theme declares it (Theme::setColorMode).
 * Without a stored mode the OS preference picks `dark` when the theme has it, else the first mode.
 */
export function resolveThemeState(input: {
  storedTheme: string | null
  storedMode: string | null
  themeDefault: string
  prefersDark: boolean
}): ThemeState {
  const fallback: ThemeId = themeExists(input.themeDefault) ? input.themeDefault : FALLBACK_THEME
  const theme: ThemeId =
    input.storedTheme !== null && themeExists(input.storedTheme) ? input.storedTheme : fallback
  const manifest = getTheme(theme)!
  const storedMode =
    input.storedMode !== null && manifest.colorModes.includes(input.storedMode) ? input.storedMode : null
  const auto = input.prefersDark && manifest.colorModes.includes('dark') ? 'dark' : manifest.colorModes[0]!
  return { theme, storedMode, colorMode: storedMode ?? auto }
}

/** Label of a colour mode in the selects (home/index.twig, base.twig). */
export function colorModeLabel(mode: string): string {
  if (mode === 'light') return 'Light'
  if (mode === 'dark') return 'Dark'
  // Twig |title
  return mode.replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Is this mode a dark palette (for `color-scheme`)? */
export function isDarkMode(mode: string): boolean {
  return mode === 'dark'
}
