import { MessageBox, Panel, PanelBody } from '@bettermyadmin/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { errorMessage } from '../../../lib/api'
import { t } from '../../../lib/i18n'
import { type Scope, structureApi, structureKeys } from '../structure/api'
import { setFlash } from '../structure/flash'
import { IndexEditorForm } from './IndexEditor'

/** The standalone index editor (pma: /table/indexes without AJAX, then the Structure page). */
export function IndexPage({ scope, query }: { scope: Scope; query: { index?: string; create?: number } }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: [...structureKeys.table(scope), 'index-form', query],
    queryFn: () => structureApi.indexForm(scope, query),
    gcTime: 0,
  })
  if (q.isError) return <MessageBox {...errorMessage(q.error)} />
  if (q.data === undefined) return null
  return (
    <Panel title={query.index !== undefined ? t('Edit index') : t('Add index')}>
      <PanelBody>
        <IndexEditorForm
          scope={scope}
          form={q.data}
          onDone={async (r) => {
            setFlash(r.messages)
            await qc.invalidateQueries({ queryKey: structureKeys.table(scope) })
            await navigate({
              to: `/s/${scope.server}/db/${encodeURIComponent(scope.db)}/t/${encodeURIComponent(scope.table)}/structure`,
            })
          }}
        />
      </PanelBody>
    </Panel>
  )
}
