import type { Page } from '@playwright/test'
import { type PageSpec, pageParity } from './lib/parity.ts'

/**
 * Server-level pages of docs/features/06-server-level.md beyond the v1 cases (pages.uip.ts):
 * Replication (on the shared primary; the replica states are compared by
 * tests/parity/server-replication.parity.test.ts), Processes, Engines, variable editing, Monitor.
 */

pageParity('server-replication', {
  pma: { route: '/server/replication' },
  ours: { path: '/s/1/replication' },
  interactions: [
    { name: 'show primary status', do: { click: 'Show primary status' } },
    { name: 'show connected replicas', do: { click: 'Show connected replicas' } },
  ],
})

pageParity('server-replication-add-user', {
  pma: { route: '/server/replication' },
  ours: { path: '/s/1/replication' },
  interactions: [
    { name: 'add replica user', do: [{ click: 'Add replica replication user' }, { wait: 500 }] },
    { name: 'host: local', do: { select: ['Host:', 'Local'] } },
  ],
})

pageParity('server-replication-change-primary', {
  pma: { route: '/server/replication' },
  ours: { path: '/s/1/replication' },
  interactions: [{ name: 'configure as replica', do: [{ click: 'configure' }, { wait: 500 }] }],
})

pageParity('server-processes', {
  pma: { route: '/server/status/processes' },
  ours: { path: '/s/1/status/processes' },
  // the processes of the other sessions on the shared server come and go between the captures
  exclude: ['#tableprocesslist tbody'],
  interactions: [{ name: 'show only active', do: { check: 'Show only active' } }],
})

pageParity('server-engines', {
  pma: { route: '/server/engines' },
  ours: { path: '/s/1/engines' },
})

pageParity('server-engine-innodb', {
  pma: { route: '/server/engines/InnoDB' },
  ours: { path: '/s/1/engines/InnoDB' },
})

pageParity('server-engine-innodb-buffer-pool', {
  pma: { route: '/server/engines/InnoDB/Bufferpool' },
  ours: { path: '/s/1/engines/InnoDB/Bufferpool' },
})

pageParity('server-variables-edit', {
  pma: { route: '/server/variables' },
  ours: { path: '/s/1/variables' },
  interactions: [
    { name: 'filter', do: { fill: ['Containing the word:', 'max_connect_errors'] } },
    {
      name: 'edit',
      // phpMyAdmin's icon link is named by its image and its text: located by class in both
      pma: async (page) => {
        await page.locator('#page_content a.editLink:visible').first().click()
        await page.waitForTimeout(800)
      },
      ours: async (page) => {
        await page.locator('#page_content .editLink:visible').first().click()
        await page.waitForTimeout(800)
      },
    },
  ],
})

const openSettings = {
  pma: async (page: Page) => {
    await page.locator('#page_content button[data-bs-target="#monitorSettingsContent"]').click()
    await page.locator('#monitorAddNewChartButton').waitFor()
  },
  ours: async (page: Page) => {
    await page.locator('#page_content button', { hasText: 'Settings' }).first().click()
    await page.locator('#monitorAddNewChartButton').waitFor()
  },
}

pageParity('server-monitor', {
  pma: { route: '/server/status/monitor' },
  ours: { path: '/s/1/status/monitor' },
  // the charts are canvases (no controls); phpMyAdmin's modals are hidden in the page
  interactions: [{ name: 'settings', ...openSettings }],
})

/** A dialog of the monitor, opened by `open` in both apps (phpMyAdmin's Bootstrap modal, our Modal). */
const monitorDialog = (modal: string, open: (page: Page) => Promise<void>, ready: string): PageSpec => ({
  pma: { route: '/server/status/monitor' },
  ours: { path: '/s/1/status/monitor' },
  scope: { pma: `#${modal}.show .modal-content`, ours: `#${modal}` },
  ready: { pma: '#page_content', ours: '#page_content' },
  setup: async ({ pma, ours }) => {
    for (const page of [pma, ours]) {
      await open(page)
      await page.locator(`#${modal} ${ready}`).first().waitFor()
    }
  },
})

pageParity(
  'server-monitor-add-chart',
  monitorDialog(
    'addChartModal',
    async (page) => {
      await (page.url().includes('index.php') ? openSettings.pma(page) : openSettings.ours(page))
      await page.locator('#monitorAddNewChartButton').click()
    },
    '[name="chartTitle"]',
  ),
)

pageParity(
  'server-monitor-instructions',
  monitorDialog(
    'monitorInstructionsModal',
    async (page) => {
      const pma = page.url().includes('index.php')
      await (pma
        ? page.locator('#page_content button[data-bs-target="#monitorInstructionsModal"]')
        : page.locator('#page_content button', { hasText: 'Instructions/Setup' }).first()
      ).click()
      // the log variables are loaded when the dialog opens
      await page.waitForTimeout(1500)
    },
    'p',
  ),
)

pageParity('server-status-variables', {
  pma: { route: '/server/status/variables' },
  ours: { path: '/s/1/status/variables' },
  // the values move between the two captures; the controls are the filters and the links
  exclude: ['#serverStatusVariables tbody'],
  interactions: [
    { name: 'filter', do: { fill: ['Containing the word:', 'innodb'] } },
    { name: 'alert values', do: { check: 'Show only alert values' } },
    { name: 'unformatted', do: { check: 'Show unformatted values' } },
    { name: 'category', do: { select: ['Filter by category…', 'InnoDB'] } },
  ],
})

pageParity('server-binlog', {
  pma: { route: '/server/binlog' },
  ours: { path: '/s/1/binlog' },
  // the events of the shared server's log come and go
  exclude: ['#binlogTable tbody'],
  interactions: [{ name: 'full queries', do: { click: 'Show full queries' } }],
})

pageParity('server-advisor', {
  pma: { route: '/server/status/advisor' },
  ours: { path: '/s/1/status/advisor' },
  // which rules fire depends on the shared server's counters at the moment of each capture
  exclude: ['#rulesAccordion'],
})

pageParity('server-advisor-instructions', {
  pma: { route: '/server/status/advisor' },
  ours: { path: '/s/1/status/advisor' },
  scope: { pma: '#advisorInstructionsModal.show .modal-content', ours: '#advisorInstructionsModal' },
  ready: { pma: '#page_content', ours: '#page_content' },
  setup: async ({ pma, ours }) => {
    for (const page of [pma, ours]) {
      await page.locator('#page_content button', { hasText: 'Instructions' }).first().click()
      await page.locator('#advisorInstructionsModal p').first().waitFor()
    }
  },
})
