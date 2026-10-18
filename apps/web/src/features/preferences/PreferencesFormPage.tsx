import type { PreferencesTab, PrefsFormSet } from '@bettermyadmin/contracts'
import { Loading, MessageBox, SafeHtml } from '@bettermyadmin/ui'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'
import { ConfigForm, FormErrors, useConfigForm } from './ConfigForm.tsx'
import { PrefsHeader } from './PrefsHeader.tsx'
import { usePrefsSaved } from './prefsSaved.ts'

/**
 * A Settings tab: Features, SQL queries, Navigation panel, Main panel, Export or Import.
 * pma: src/Controllers/Preferences/{Features,Sql,Navigation,MainPanel,Export,Import}Controller.php,
 *      resources/templates/preferences/forms/main.twig
 */
export function PreferencesFormPage({
  server,
  tab,
  saved,
  hash,
}: {
  server: number
  tab: PreferencesTab
  saved: boolean
  /** the form to show (`tab_hash`, the URL fragment) */
  hash: string
}) {
  const q = useQuery({
    queryKey: qk.preferencesForm(server, tab),
    queryFn: () => api.preferencesForm(server, tab),
  })
  // the form set re-rendered by a failed save (posted values + errors)
  const [failed, setFailed] = useState<PrefsFormSet | null>(null)
  const [revision, setRevision] = useState(0)
  const [active, setActive] = useState(hash)
  const navigate = useNavigate()
  const applied = usePrefsSaved(server)
  const save = useMutation({
    mutationFn: (values: Record<string, string>) => api.savePreferencesForm(server, tab, { values }),
    onSuccess: async (r) => {
      if (r.saved) {
        setFailed(null)
        await applied()
        setRevision((n) => n + 1)
        // getUrlToRedirect: ?saved=1 and the posted tab_hash, which no script of phpMyAdmin fills
        // (display.twig's hidden input stays ''): the page opens again on its first form
        setActive('')
        await navigate({
          to: '/s/$server/preferences/$tab',
          params: { server, tab },
          search: { saved: 1 },
        })
        return
      }
      if (r.formSet !== undefined) {
        setFailed(r.formSet)
        setRevision((n) => n + 1)
      }
    },
  })

  const header = q.data
  const formSet = failed ?? q.data?.formSet
  return (
    <>
      <PrefsHeader server={server} active={tab} saved={saved && failed === null} header={header} />
      {q.isPending && <Loading />}
      {q.isError && <MessageBox {...errorMessage(q.error)} />}
      {save.isError && <MessageBox {...errorMessage(save.error)} />}
      {formSet?.error != null && (
        <MessageBox type="error">
          <SafeHtml html={formSet.error.text} />
        </MessageBox>
      )}
      {formSet?.hasErrors === true && (
        <FormErrors
          title={t('Cannot save settings, submitted form contains errors!')}
          list={formSet.errorList}
        />
      )}
      {formSet !== undefined && (
        <FormBody
          key={`${tab}-${revision}-${q.dataUpdatedAt}`}
          formSet={formSet}
          active={active}
          onTab={setActive}
          onSubmit={(v) => save.mutate(v)}
        />
      )}
    </>
  )
}

function FormBody({
  formSet,
  active,
  onTab,
  onSubmit,
}: {
  formSet: PrefsFormSet
  active: string
  onTab: (name: string) => void
  onSubmit: (v: Record<string, string>) => void
}) {
  const state = useConfigForm(formSet)
  return <ConfigForm state={state} showButtons onSubmit={onSubmit} tab={active} onTab={onTab} />
}
