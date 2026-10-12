import { Button, Loading, MessageBox, NavTabs, Panel, PanelBody, Textarea } from '@bettermyadmin/ui'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../../lib/api'
import { t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'
import { SetupError } from './OverviewPage'
import { SetupLayout } from './SetupLayout'

/**
 * The generated configuration file in a textarea with Download; a second tab shows the same
 * configuration as bettermyadmin.config.json (X7), the file BetterMyAdmin reads.
 * pma: src/Controllers/Setup/ConfigController.php, resources/templates/setup/config/index.twig
 */
export function ConfigPage({ eol }: { eol: string }) {
  const q = useQuery({ queryKey: qk.setupConfig(eol), queryFn: () => api.setupConfig(eol) })
  const [tab, setTab] = useState<'php' | 'bma'>('php')
  if (q.isError) return <SetupError error={q.error} />
  if (q.data === undefined) return <Loading className="p-4" />
  const d = q.data
  const name = tab === 'php' ? 'config.inc.php' : 'bettermyadmin.config.json'
  return (
    <SetupLayout pages={d.pages} formset="">
      <h2 className="mb-3 text-lg font-semibold">{t('Configuration file')}</h2>
      {d.saved !== null && <MessageBox type="success" text={t('Configuration saved to file %s', d.saved)} />}
      <NavTabs
        items={[
          { id: 'php', label: 'config.inc.php' },
          { id: 'bma', label: 'bettermyadmin.config.json' },
        ]}
        active={tab}
        onSelect={(id) => setTab(id === 'bma' ? 'bma' : 'php')}
      />
      <Panel
        title={<span>{name}</span>}
        className="rounded-t-none border-t-0"
        footer={
          <Button
            variant="primary"
            name="submit_download"
            onClick={() => {
              window.location.href = api.setupDownloadUrl(d.eol, tab)
            }}
          >
            {t('Download')}
          </Button>
        }
      >
        <PanelBody>
          <Textarea
            key={tab}
            className="font-mono"
            rows={20}
            name="textconfig"
            spellCheck={false}
            aria-label={t('Generated configuration file')}
            defaultValue={tab === 'php' ? d.php : d.bma}
          />
        </PanelBody>
      </Panel>
    </SetupLayout>
  )
}
