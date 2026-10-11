import { expect, test } from '@playwright/test'

/**
 * The login page's Language card (pma: login/form.twig): switching re-renders the page in the chosen
 * language, `<html lang dir>` follows it, RTL locales flip the layout, and the choice is remembered.
 */
test('switching the language on the login page, RTL flips the layout [p01-728b8d]', async ({ page }) => {
  await page.goto('/')
  const heading = page.locator('h1')
  await expect(heading).toHaveText('Welcome to BetterMyAdmin')
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
  await expect(page.locator('#languageSelectLabel')).toHaveText('Language')

  const select = page.locator('#languageSelect')
  await expect(select).toHaveValue('en')
  await expect(select.locator('option[value="de"]')).toHaveText('Deutsch - German')
  await expect(select.locator('option')).toHaveCount(49)

  // German
  await select.selectOption('de')
  await expect(heading).toHaveText('Willkommen bei BetterMyAdmin')
  await expect(page.locator('html')).toHaveAttribute('lang', 'de')
  await expect(page.locator('#languageSelectLabel')).toHaveText('Sprache (Language)')
  await expect(page.locator('label[for="input_username"]')).toHaveText('Benutzername:')
  await expect(page.locator('#input_go')).toHaveValue('Anmeldung')

  // Arabic: right-to-left
  const userLabel = page.locator('label[for="input_username"]')
  const userInput = page.locator('#input_username')
  const ltrLabel = await userLabel.boundingBox()
  const ltrInput = await userInput.boundingBox()
  expect(ltrLabel!.x).toBeLessThan(ltrInput!.x)

  await page.locator('#languageSelect').selectOption('ar')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
  await expect(heading).toHaveText('أهلا بك في BetterMyAdmin')
  const rtlLabel = await userLabel.boundingBox()
  const rtlInput = await userInput.boundingBox()
  // the label column moved to the right of the input
  expect(rtlLabel!.x).toBeGreaterThan(rtlInput!.x)
  // the selector itself stays lang="en" dir="ltr" like phpMyAdmin's
  await expect(page.locator('#languageSelect')).toHaveAttribute('dir', 'ltr')

  // remembered (language cookie) across a reload
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.locator('#languageSelect')).toHaveValue('ar')

  // back to German, log in: the shell is German too
  await page.locator('#languageSelect').selectOption('de')
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
  await page.locator('#input_username').fill(process.env.BMA_TEST_USER ?? 'root')
  await page.locator('#input_password').fill(process.env.BMA_TEST_PASSWORD ?? 'root')
  await page.locator('#input_go').click()
  await expect(page.getByRole('link', { name: 'Datenbanken' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Anzeige-Einstellungen' })).toBeVisible()
})
