import { type Page, expect, test } from '@playwright/test'
import { login } from './fixtures.ts'

/**
 * The Routines / Triggers / Events page titles show the icon and the text whatever ActionLinksMode
 * (upstream bab805a40f "Align all page titles to the same style": get_image + the title instead of
 * get_icon, which followed the link mode).
 */
async function setPrefs(page: Page, data: Record<string, unknown>) {
  await page.evaluate(async (configData) => {
    const token = document.cookie
      .split('; ')
      .find((c) => c.startsWith('bma_token='))
      ?.slice('bma_token='.length)
    const r = await fetch('/api/servers/1/prefs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-BMA-Token': decodeURIComponent(token ?? '') },
      body: JSON.stringify({ configData }),
    })
    if (!r.ok) throw new Error(`prefs: ${r.status}`)
  }, data)
}

test('program page titles: the icon and the text in every ActionLinksMode', async ({ page }) => {
  await login(page)
  try {
    for (const mode of ['icons', 'text', 'both']) {
      await setPrefs(page, { ActionLinksMode: mode })
      for (const [path, title, icon] of [
        ['routines', 'Routines', 'b_routines'],
        ['triggers', 'Triggers', 'b_triggers'],
        ['events', 'Events', 'b_events'],
      ] as const) {
        await page.goto(`/s/1/db/mysql/${path}`)
        const h2 = page.locator('h2', { has: page.locator(`[data-icon="ic_${icon}"]`) })
        await expect(h2, `${mode} ${path}`).toHaveCount(1)
        // the visible text, without the icons' <title>
        const text = await h2.evaluate((e) => {
          const c = e.cloneNode(true) as HTMLElement
          for (const x of c.querySelectorAll('svg')) x.remove()
          return (c.textContent ?? '').replace(/\s+/g, ' ').trim()
        })
        expect(text, `${mode} ${path}`).toBe(title)
      }
    }
  } finally {
    await setPrefs(page, {})
  }
})
