import { type Page, test } from '@playwright/test'
import { type BmaInstance, type PmaInstance, startBmaInstance, startPmaInstance } from './lib/instances.ts'
import { pageParity } from './lib/parity.ts'

/**
 * The setup script (docs/features/01 "Setup script"): every page, against a phpMyAdmin instance
 * without config.inc.php and our server without a configuration file. The setup pages have no
 * `#page_content`: the scope is the setup page (`#page`).
 */
let pma: PmaInstance
let ours: BmaInstance
test.beforeAll(async () => {
  pma = await startPmaInstance('', { noConfig: true })
  ours = await startBmaInstance()
})
test.afterAll(async () => {
  await pma?.stop()
  await ours?.stop()
})

const bases = () => ({ pma: pma.url, ours: ours.url })

/**
 * A form tab. phpMyAdmin's setup pages do not initialise Bootstrap's tab plugin, so its tabs do
 * not switch (Q67, fixed in ours): the pane is shown the way Tab.show() would.
 */
const tab = (label: string) => ({
  name: label,
  pma: async (page: Page) =>
    page.evaluate((name) => {
      const link = [...document.querySelectorAll<HTMLAnchorElement>('#configFormDisplayTab a.nav-link')].find(
        (a) => a.textContent?.trim() === name,
      )
      if (link === undefined) throw new Error(`no tab ${name}`)
      for (const a of document.querySelectorAll('#configFormDisplayTab a.nav-link')) {
        a.classList.remove('active')
        a.setAttribute('aria-selected', 'false')
      }
      for (const p of document.querySelectorAll('.tab-content > .tab-pane'))
        p.classList.remove('show', 'active')
      link.classList.add('active')
      link.setAttribute('aria-selected', 'true')
      document.querySelector(link.getAttribute('href') ?? '')?.classList.add('show', 'active')
    }, label),
  ours: { click: label },
})
const SETUP = '/setup/index.php?route=/setup'
// #BZipDump: the Bzip2 config-check box is environment-determined, not a product difference — Node
// has no bzip2 compressor so our overview always shows it, while phpMyAdmin shows it only when its
// PHP lacks the bz2 extension (a CI runner's PHP has it, the host PHP and the reference image do
// not). Leave it out of both so the comparison does not flip with the runner's PHP build.
const common = { auth: false, bases, scope: '#page', exclude: ['#BZipDump'] } as const

/** Adds one server through the form (both apps), so the overview lists it. */
async function addServer(page: Page, app: 'pma' | 'ours'): Promise<void> {
  const base = app === 'pma' ? pma.url : ours.url
  await page.goto(app === 'pma' ? `${base}${SETUP}&page=servers&mode=add` : `${base}/setup/servers/0`)
  await page.locator(app === 'pma' ? '#Servers-0-host' : '#Servers-0-host').fill('db.example')
  await page.locator('input[name=submit_save]').first().click()
  await page.waitForURL(/\/setup(\/|\/index\.php\?route=\/setup)?$|route=%2Fsetup$|route=\/setup$/)
}

pageParity('setup-overview', {
  ...common,
  pma: { route: '', path: SETUP },
  ours: { path: '/setup' },
  ready: { pma: '#select_lang', ours: '#select_lang' },
})

pageParity('setup-overview-servers', {
  ...common,
  map: 'setup-overview',
  pma: { route: '', path: SETUP },
  ours: { path: '/setup' },
  ready: { pma: '#select_lang', ours: '#select_lang' },
  setup: async ({ pma: p, ours: o }) => {
    await addServer(p, 'pma')
    await addServer(o, 'ours')
    await p.goto(`${pma.url}${SETUP}`)
    await o.goto(`${ours.url}/setup`)
    await o.locator('#select_lang').waitFor()
    // the messages seen before are hidden: show them (the views counted differ by the redirects)
    for (const page of [p, o]) {
      const link = page.locator('#show_hidden_messages')
      if (await link.isVisible()) await link.click()
    }
  },
})

const SERVER_TABS = ['Authentication', 'Server configuration', 'Configuration storage', 'Changes tracking']
pageParity('setup-server-add', {
  ...common,
  map: 'setup-form',
  pma: { route: '', path: `${SETUP}&page=servers&mode=add` },
  ours: { path: '/setup/servers/0' },
  ready: { pma: '#configFormDisplayTab', ours: '#configFormDisplayTab' },
  interactions: SERVER_TABS.map(tab),
})

const FORMSETS: Array<{ formset: string; tabs: string[] }> = [
  {
    formset: 'Features',
    tabs: [
      'Databases',
      'Text fields',
      'Page titles',
      'Warnings',
      'Console',
      'Developer',
      'Import / export',
      'Security',
      'Other core settings',
    ],
  },
  { formset: 'Sql', tabs: ['SQL Query box'] },
  { formset: 'Navi', tabs: ['Navigation tree', 'Servers', 'Databases', 'Tables'] },
  {
    formset: 'Main',
    tabs: [
      'Database structure',
      'Table structure',
      'Browse mode',
      'Edit mode',
      'Tabs',
      'Display relational schema',
    ],
  },
  { formset: 'Import', tabs: ['SQL', 'CSV', 'OpenDocument'] },
  {
    formset: 'Export',
    tabs: ['SQL', 'CodeGen', 'CSV', 'LaTeX', 'Microsoft Office', 'OpenDocument', 'Texy! text'],
  },
]
for (const { formset, tabs } of FORMSETS) {
  pageParity(`setup-form-${formset.toLowerCase()}`, {
    ...common,
    map: 'setup-form',
    pma: { route: '', path: `${SETUP}&page=form&formset=${formset}` },
    ours: { path: `/setup/form/${formset}` },
    ready: { pma: '#configFormDisplayTab', ours: '#configFormDisplayTab' },
    interactions: tabs.map(tab),
  })
}

pageParity('setup-config', {
  ...common,
  pma: { route: '', path: `${SETUP}&page=config` },
  ours: { path: '/setup/config' },
  ready: { pma: 'textarea[name=textconfig]', ours: 'textarea[name=textconfig]' },
})

pageParity('setup-errors', {
  ...common,
  pma: { route: '', path: SETUP },
  ours: { path: '/setup' },
  setup: async ({ pma: p, ours: o }) => {
    // a server, then an invalid port on its edit form: "Submitted form contains errors"
    await addServer(p, 'pma')
    await addServer(o, 'ours')
    await p.goto(`${pma.url}${SETUP}&page=servers&mode=edit&id=1`)
    await o.goto(`${ours.url}/setup/servers/1`)
    for (const page of [p, o]) {
      await page.locator('#Servers-1-port').fill('99999')
      // the change event shows the inline error first (the button moves down)
      await page.keyboard.press('Tab')
      await page.waitForTimeout(300)
      await page.locator('input[name=submit_save]').first().click()
      await page.getByText('Submitted form contains errors').waitFor()
    }
  },
})
