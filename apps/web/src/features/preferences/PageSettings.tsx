import type { PrefsFormSet } from '@bettermyadmin/contracts'
import { Loading, MessageBox } from '@bettermyadmin/ui'
import { useQuery } from '@tanstack/react-query'
import { type MutableRefObject, useMemo, useRef, useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'
import { type PageSettingsRegistration, usePageSettings } from '../shell/page-chrome.tsx'
import { ConfigForm, FormErrors, useConfigForm } from './ConfigForm.tsx'
import { usePrefsSaved } from './prefsSaved.ts'

type Submit = MutableRefObject<(() => Promise<boolean>) | null>

/**
 * The "Page-related settings" form of a page group (Browse, DbStructure, Edit, Export, Import,
 * Navi, Sql, TableStructure): the forms without buttons, saved by the modal's Apply.
 * pma: src/Config/PageSettings.php, resources/js/modules/page_settings.ts
 */
export function PageSettingsForm({
  server,
  group,
  submit,
}: { server: number; group: string; submit: Submit }) {
  const q = useQuery({
    queryKey: qk.pageSettings(server, group),
    queryFn: () => api.pageSettings(server, group),
  })
  const [failed, setFailed] = useState<PrefsFormSet | null>(null)
  const formSet = failed ?? q.data?.formSet
  if (q.isPending) return <Loading />
  if (q.isError) return <MessageBox {...errorMessage(q.error)} />
  if (formSet === undefined) return null
  return (
    <div id={group === 'Navi' ? 'pma_navigation_settings' : 'page_settings_modal'}>
      <div className="page_settings">
        {formSet.error !== null && <MessageBox type="error" text={formSet.error.text} />}
        {formSet.hasErrors && (
          <FormErrors
            title={t('Cannot save settings, submitted configuration form contains errors!')}
            list={formSet.errorList}
          />
        )}
        <Body
          key={failed === null ? 'initial' : JSON.stringify(failed.errorList)}
          formSet={formSet}
          server={server}
          group={group}
          submit={submit}
          onFailed={setFailed}
        />
      </div>
    </div>
  )
}

function Body({
  formSet,
  server,
  group,
  submit,
  onFailed,
}: {
  formSet: PrefsFormSet
  server: number
  group: string
  submit: Submit
  onFailed: (f: PrefsFormSet) => void
}) {
  const state = useConfigForm(formSet, group !== 'Navi')
  const applied = usePrefsSaved(server)
  const save = async (values: Record<string, string>): Promise<boolean> => {
    const r = await api.savePageSettings(server, group, { values })
    if (r.saved) {
      // the page reloads with the new settings
      await applied()
      return true
    }
    if (r.formSet !== undefined) onFailed(r.formSet)
    return false
  }
  submit.current = () => save(state.posted())
  return <ConfigForm state={state} showButtons={false} onSubmit={(v) => void save(v)} />
}

/** PageSettings::init(group) for the mounted page: the gear icon and its modal. */
export function usePagePrefs(server: number, group: string): void {
  const submit: Submit = useRef(null)
  const reg = useMemo<PageSettingsRegistration>(
    () => ({
      group,
      render: () => <PageSettingsForm server={server} group={group} submit={submit} />,
      apply: async () => (submit.current === null ? true : submit.current()),
    }),
    [server, group],
  )
  usePageSettings(reg)
}
