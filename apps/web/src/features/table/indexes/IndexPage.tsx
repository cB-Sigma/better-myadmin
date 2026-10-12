import { MessageBox, Panel, PanelBody } from '@bettermyadmin/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { type TableRef, api, errorMessage } from '../../../lib/api'
import { t } from '../../../lib/i18n'
import { qk } from '../../../lib/queryKeys'
import { setFlash } from '../structure/flash'
import { IndexEditorForm } from './IndexEditor'

/** The standalone index editor (pma: /table/indexes without AJAX, then the Structure page). */
export function IndexPage({ scope, query }: { scope: TableRef; query: { index?: string; create?: number } }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: qk.indexForm(scope, query),
    queryFn: () => api.indexForm(scope, query),
    gcTime: 0,
  })
  if (q.isError) return <MessageBox {...errorMessage(q.error)} />
  if (q.data === undefined) return null
  return (
    // index_form.twig: a `.card` without header
    <Panel>
      <PanelBody>
        <IndexEditorForm
          scope={scope}
          form={q.data}
          onDone={async (r) => {
            setFlash(r.messages)
            await qc.invalidateQueries({ queryKey: qk.tbl(scope) })
            await navigate({
              to: `/s/${scope.server}/db/${encodeURIComponent(scope.db)}/t/${encodeURIComponent(scope.table)}/structure`,
            })
          }}
        />
      </PanelBody>
    </Panel>
  )
}
