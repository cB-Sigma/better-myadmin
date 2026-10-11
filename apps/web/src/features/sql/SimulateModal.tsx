import type { SimulateResponse } from '@bettermyadmin/contracts'
import { Button, MessageBox, Modal } from '@bettermyadmin/ui'
import { t } from '../../lib/i18n'
import { HighlightedSql } from './HighlightedSql'

/**
 * The "Simulate query" modal: per statement the parsed SQL and "Affected rows:" linking to the rows.
 * pma: resources/templates/sql/query.twig (#simulateDmlModal), resources/js/sql.ts (#simulate_dml)
 */
export function SimulateModal({
  data,
  versionInt,
  onClose,
  onShowRows,
}: {
  data: SimulateResponse
  versionInt: number
  onClose: () => void
  onShowRows: (sql: string, sig: string) => void
}) {
  return (
    <Modal
      open
      id="simulateDmlModal"
      title={t('Simulate query')}
      size="md"
      onClose={onClose}
      footer={<Button onClick={onClose}>{t('Close')}</Button>}
    >
      <div className="modal-body preview_sql">
        {data.sqlData === null ? (
          <MessageBox type="error" text={data.message ?? ''} flush />
        ) : (
          data.sqlData.map((d, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: statements are positional
            <div key={i}>
              {i > 0 && <hr className="my-2 border-border" />}
              <strong>{t('SQL query:')}</strong>
              <HighlightedSql sql={d.sqlQuery} versionInt={versionInt} className="my-1" />
              {t('Affected rows:')}{' '}
              <Button
                variant="link"
                onClick={() => {
                  onClose()
                  onShowRows(d.matchedRowsSql, d.matchedRowsSig)
                }}
              >
                {d.matchedRows}
              </Button>
            </div>
          ))
        )}
      </div>
    </Modal>
  )
}
