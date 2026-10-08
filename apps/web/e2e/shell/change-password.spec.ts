import { expect, test } from '@playwright/test'
import mysql from 'mysql2/promise'
import { E2E, MYSQL, login } from '../fixtures.ts'

/** Home → Change password, end to end (UserPasswordController, modals/change_password.twig). */
test.describe('change password', () => {
  test.afterEach(async () => {
    const c = await mysql.createConnection(MYSQL)
    await c.query(`ALTER USER '${E2E.pw}'@'%' IDENTIFIED BY '${E2E.pw}'`)
    await c.end()
  })

  test('validation alerts, strength meter, generator, success message with the masked SQL, new password works', async ({
    page,
  }) => {
    await login(page, E2E.pw, E2E.pw)
    await page.locator('#change_password_anchor').click()
    const dialog = page.getByRole('dialog', { name: 'Change password' })
    await expect(dialog.locator('#select_authentication_plugin_cp')).toHaveValue('mysql_native_password')

    // checkPassword: alert() for mismatching passwords
    await dialog.locator('#text_pma_change_pw').fill('abc')
    await dialog.locator('#text_pma_change_pw2').fill('abd')
    let alertText = ''
    page.once('dialog', (d) => {
      alertText = d.message()
      void d.accept()
    })
    await dialog.getByRole('button', { name: 'Go' }).click()
    await expect.poll(() => alertText).toBe("The passwords aren't the same!")
    // checkPassword empties both fields
    await expect(dialog.locator('#text_pma_change_pw')).toHaveValue('')

    // the generator fills both fields with 16 characters and rates them
    await dialog.getByRole('button', { name: 'Generate' }).click()
    const generated = await dialog.locator('#generated_pw').inputValue()
    expect(generated).toHaveLength(16)
    await expect(dialog.locator('#text_pma_change_pw')).toHaveValue(generated)
    await expect(dialog.locator('#change_password_strength')).not.toBeEmpty()

    await dialog.locator('#text_pma_change_pw').fill('m1shell-E2e-new')
    await dialog.locator('#text_pma_change_pw2').fill('m1shell-E2e-new')
    await expect(dialog.locator('#change_password_strength')).toHaveText(/weak|Good|Strong/)
    await dialog.getByRole('button', { name: 'Go' }).click()
    await expect(page.getByText('The profile has been updated.')).toBeVisible()
    await expect(page.locator('code.sql')).toHaveText(`ALTER USER '${E2E.pw}'@'%' IDENTIFIED BY '***'`)

    // the session keeps working, and the new password logs in
    await page.reload()
    await expect(page.locator('#maincontainer')).toBeVisible()
    await page.getByRole('button', { name: 'Open user account menu' }).click()
    await page.getByRole('menuitem', { name: 'Log out' }).click()
    await login(page, E2E.pw, 'm1shell-E2e-new')
  })

  test('No Password with AllowNoPassword = false asks for confirmation', async ({ page }) => {
    await login(page, E2E.pw, E2E.pw)
    await page.locator('#change_password_anchor').click()
    const dialog = page.getByRole('dialog', { name: 'Change password' })
    await dialog.locator('#nopass_1').check()
    await dialog.getByRole('button', { name: 'Go' }).click()
    const confirm = page.getByRole('alertdialog', { name: 'Confirm' })
    await expect(confirm).toContainText('AllowNoPassword is false')
    await confirm.getByRole('button', { name: 'Close' }).click()
    await expect(confirm).toBeHidden()
  })
})
