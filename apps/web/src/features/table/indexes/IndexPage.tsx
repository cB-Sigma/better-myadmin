import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { t } from '../../../lib/i18n'
import { type Scope, structureApi, structureKeys } from '../structure/api'
import { setFlash } from '../structure/flash'
import { Card, MessageBox, errorMessage } from '../structure/ui'
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
  if (q.isError) return <MessageBox message={errorMessage(q.error)} />
  if (q.data === undefined) return null
  return (
    <Card title={query.index !== undefined ? t('Edit index') : t('Add index')}>
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
    </Card>
  )
}
