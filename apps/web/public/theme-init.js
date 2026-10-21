// Applies the stored theme and colour mode before first paint (no inline scripts under our CSP).
// Mirrors packages/ui/src/themes/index.ts::resolveThemeState and themeKey/colorModeKey; the server
// fills data-theme-default / data-theme-per-server on <html> from ThemeDefault / ThemePerServer.
;(() => {
  const MODES = {
    bootstrap: ['light', 'dark'],
    metro: ['win', 'teal', 'redmond', 'blueeyes', 'mono', 'dark'],
    modern: ['light', 'dark'],
    original: ['light', 'dark'],
    pmahomme: ['light', 'dark'],
  }
  const read = (k) => {
    let v = null
    try {
      v = localStorage.getItem(k)
    } catch (e) {}
    if (v === null) {
      const c = document.cookie.split('; ').find((p) => p.indexOf(`${k}=`) === 0)
      if (c) v = decodeURIComponent(c.slice(k.length + 1))
    }
    return v
  }
  try {
    const html = document.documentElement
    const perServer = html.getAttribute('data-theme-per-server') === '1'
    const m = /^\/s\/(\d+)(\/|$)/.exec(location.pathname)
    const key = perServer && m ? `bma_theme-${m[1]}` : 'bma_theme'
    let def = html.getAttribute('data-theme-default') || 'modern'
    if (!MODES[def]) def = 'modern'
    let theme = read(key)
    if (!theme || !MODES[theme]) theme = def
    let mode = read(`${key}_color`)
    if (!mode || MODES[theme].indexOf(mode) === -1) {
      const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
      mode = dark && MODES[theme].indexOf('dark') !== -1 ? 'dark' : MODES[theme][0]
    }
    html.dataset.theme = theme
    html.dataset.colorMode = mode
  } catch (e) {}
})()
