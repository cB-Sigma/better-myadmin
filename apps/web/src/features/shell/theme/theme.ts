import { type ThemeState, colorModeKey, resolveThemeState, themeKey } from '@bettermyadmin/ui/themes'
import { useSyncExternalStore } from 'react'

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
  write(themeKey(o.perServer, o.server), theme)
  if (colorMode !== undefined && colorMode !== '') write(colorModeKey(o.perServer, o.server), colorMode)
  const s = currentThemeState(o)
  applyThemeState(s)
  for (const l of listeners) l()
  return s
}

let cachedKey = ''
let cachedState: ThemeState | null = null

/** The active theme, re-rendering on changes and on OS colour-scheme changes while in automatic mode. */
export function useThemeState(o: ThemeOptions): ThemeState {
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
