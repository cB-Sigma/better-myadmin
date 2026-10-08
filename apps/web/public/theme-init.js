// Applies the stored theme and colour mode before first paint (no inline scripts under our CSP).
;(() => {
  try {
    const t = localStorage.getItem('bma.theme') || 'pmahomme'
    const m = localStorage.getItem('bma.colorMode') || 'auto'
    document.documentElement.dataset.theme = t
    if (m !== 'auto') document.documentElement.dataset.colorMode = m
  } catch {}
})()
