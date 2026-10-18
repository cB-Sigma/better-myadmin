import {
  type ThemeState,
  colorModeKey,
  colorModeLabel,
  resolveThemeState,
  themeKey,
} from '@bettermyadmin/ui/themes'
import { useEffect, useSyncExternalStore } from 'react'
import { api } from '../../../lib/api'
import { pgettext } from '../../../lib/i18n'

/**
 * Client-side theme store (the route map replaces /themes and /themes/set with it): the choice is
 * kept in localStorage and mirrored in a cookie of the same name (`bma_theme[-N]`, `…_color`, 30
 * days like phpMyAdmin's cookies) so public/theme-init.js applies it before first paint.
 * pma: src/Theme/ThemeManager.php (initializeTheme, setThemeCookie), src/Controllers/ThemeSetController.php
 */

const COOKIE_DAYS = 30
const listeners = new Set<() => void>()

function read(key: string): string | null {
  try {
    const v = localStorage.getItem(key)
    if (v !== null) return v
  } catch {
    // storage blocked: fall back to the cookie
  }
  for (const part of document.cookie.split('; ')) {
    if (part.startsWith(`${key}=`)) return decodeURIComponent(part.slice(key.length + 1))
  }
  return null
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // ignore
  }
  document.cookie = `${key}=${encodeURIComponent(value)}; path=/; max-age=${COOKIE_DAYS * 86400}; SameSite=Strict`
}

function prefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

export interface ThemeOptions {
  themeDefault: string
  perServer: boolean
  server: number
}

export function currentThemeState(o: ThemeOptions): ThemeState {
  return resolveThemeState({
    storedTheme: read(themeKey(o.perServer, o.server)),
    storedMode: read(colorModeKey(o.perServer, o.server)),
    themeDefault: o.themeDefault,
    prefersDark: prefersDark(),
  })
}

export function applyThemeState(s: ThemeState): void {
  const html = document.documentElement
  html.dataset.theme = s.theme
  html.dataset.colorMode = s.colorMode
}

/**
 * ThemeSetController: set the theme, then the colour mode when it is valid for the theme
 * (Theme::setColorMode ignores unknown modes); the stored mode is kept per theme cookie.
 */
export function setTheme(o: ThemeOptions, theme: string, colorMode?: string): ThemeState {
  const changed = read(themeKey(o.perServer, o.server)) !== theme
  write(themeKey(o.perServer, o.server), theme)
  // ThemeSetController also stores ThemeDefault in the user preferences
  if (changed) void api.themeSet(o.server, theme).catch(() => {})
  if (colorMode !== undefined && colorMode !== '') write(colorModeKey(o.perServer, o.server), colorMode)
  const s = currentThemeState(o)
  applyThemeState(s)
  for (const l of listeners) l()
  return s
}

/** The colour-mode option label: home/index.twig's Light / Dark msgids, other modes title-cased. */
export function colorModeText(mode: string): string {
  if (mode === 'light') return pgettext('Light color mode of the theme', 'Light')
  if (mode === 'dark') return pgettext('Dark color mode of the theme', 'Dark')
  return colorModeLabel(mode)
}

let cachedKey = ''
let cachedState: ThemeState | null = null

const synced = new Set<number>()

/**
 * loadUserPreferences "save theme": a theme cookie that differs from the preferences' ThemeDefault
 * (a theme chosen in another browser, or before the preferences changed) is stored again, once per
 * page load and server.
 */
function useThemePreferenceSync(o: ThemeOptions): void {
  useEffect(() => {
    if (synced.has(o.server)) return
    synced.add(o.server)
    const stored = read(themeKey(o.perServer, o.server))
    if (stored !== null && stored !== o.themeDefault) void api.themeSet(o.server, stored).catch(() => {})
  }, [o.server, o.perServer, o.themeDefault])
}

/** The active theme, re-rendering on changes and on OS colour-scheme changes while in automatic mode. */
export function useThemeState(o: ThemeOptions): ThemeState {
  useThemePreferenceSync(o)
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      const mq =
        typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null
      const onScheme = () => {
        applyThemeState(currentThemeState(o))
        cb()
      }
      mq?.addEventListener('change', onScheme)
      return () => {
        listeners.delete(cb)
        mq?.removeEventListener('change', onScheme)
      }
    },
    () => {
      const s = currentThemeState(o)
      const key = `${s.theme}|${s.colorMode}|${s.storedMode}`
      if (key !== cachedKey || cachedState === null) {
        cachedKey = key
        cachedState = s
      }
      return cachedState
    },
  )
}
