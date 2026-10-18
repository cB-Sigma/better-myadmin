import type { StorageStatusResponse } from '@bettermyadmin/contracts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { qk } from '../../lib/queryKeys.ts'
import { CheckRelationsPage } from './CheckRelationsPage.tsx'

/** check_relations.twig (CheckRelationsController) rendered from a storage status. */
const rp = (o: Record<string, unknown>) =>
  ({
    user: 'u',
    db: 'phpmyadmin',
    allworks: false,
    ...Object.fromEntries(
      [
        'relation',
        'table_info',
        'table_coords',
        'pdf_pages',
        'column_info',
        'bookmark',
        'history',
        'recent',
        'favorite',
        'table_uiprefs',
        'tracking',
        'userconfig',
        'users',
        'usergroups',
        'navigationhiding',
        'savedsearches',
        'central_columns',
        'designer_settings',
        'export_templates',
      ].map((k) => [k, null]),
    ),
    ...o,
  }) as unknown as StorageStatusResponse['relationParameters']

const status = (o: Partial<StorageStatusResponse>): StorageStatusResponse =>
  ({
    relationParameters: rp({}),
    pmadbConfigured: true,
    zeroConf: true,
    arePmadbTablesDefined: true,
    arePmadbTablesAllDisabled: false,
    configurationStorageDbName: 'phpmyadmin',
    sqlDir: '/srv/sql/',
    homeNotice: null,
    operationsNotice: null,
    offer: null,
    tables: [],
    features: [],
    stores: {},
    controlError: null,
    ...o,
  }) as StorageStatusResponse

function render(s: StorageStatusResponse, db = '') {
  const qc = new QueryClient()
  qc.setQueryData(qk.storageStatus(1, db), s)
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <CheckRelationsPage server={1} db={db} />
    </QueryClientProvider>,
  )
}

describe('check-relations page (check_relations.twig)', () => {
  it('without a storage database: not OK, and the Create offer of the zero configuration [p08-19523b]', () => {
    const html = render(status({ relationParameters: rp({ db: null }) }))
    expect(html).toContain('Configuration of pmadb…')
    expect(html).toContain('not OK')
    expect(html).toContain('Create</button> a database named &#x27;phpmyadmin&#x27; and setup')
    expect(render(status({ relationParameters: rp({ db: null }) }), 'shop')).toContain(
      'Create</button> the phpMyAdmin configuration storage in the current database.',
    )
  })

  it('table rows, feature lines, the column_info hint and the quick steps [p08-5b639b] [p08-d5ec83]', () => {
    const html = render(
      status({
        relationParameters: rp({ relation: 'pma__relation', relwork: true, commwork: true, mimework: false }),
      }),
    )
    expect(html).toContain('$cfg[&#x27;Servers&#x27;][$i][&#x27;relation&#x27;]')
    expect(html).toContain('General relation features: <span class="text-success">Enabled</span>')
    expect(html).toContain('Saving export templates: <span class="text-error">Disabled</span>')
    expect(html).toContain('Please see the documentation on how to update your column_info table.')
    expect(html).toContain('Create</button> missing phpMyAdmin configuration storage tables.')
    expect(html).toContain('Quick steps to set up advanced features:')
    expect(html).toContain('Create a pma user and give access to these tables.')
    expect(render(status({ relationParameters: rp({ allworks: true }) }))).not.toContain('Quick steps')
  })
})
