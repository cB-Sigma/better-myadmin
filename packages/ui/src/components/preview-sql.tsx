import { useUiSettings } from '../settings.tsx'
import { Button } from './button.tsx'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './dialog.tsx'

/**
 * The "Preview SQL" modal of every form that generates SQL; open while `sql` is not null, "No
 * change" for an empty string. Its footer:
 * - default: Close (`#previewSqlModal`, components/_preview_sql.twig)
 * - `onBack`: "Go back" to the dialog it was opened from (`#indexDialogPreviewModal`,
 *   `#designerModalPreviewModal` of Move columns)
 * - `onConfirm`: OK + Close (`#previewSqlConfirmModal`, modals/preview_sql_confirmation.twig:
 *   confirmPreviewSql before dropping an index)
 * pma: resources/js/modules/functions.ts::previewSql / confirmPreviewSql
 */
export function PreviewSqlDialog({
  sql,
  onClose,
  onBack,
  onConfirm,
  highlight = false,
}: {
  sql: string | null
  onClose: () => void
  onBack?: () => void
  onConfirm?: () => void
  /** functions.ts::previewSql / confirmPreviewSql run highlightSql on the dialog */
  highlight?: boolean
}) {
  const { gettext, renderSql } = useUiSettings()
  return (
    <Dialog open={sql !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg" aria-describedby={undefined} closeLabel={gettext('Close')}>
        <DialogHeader>
          <DialogTitle>{gettext('Preview SQL')}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="preview_sql" data-testid="preview-sql">
            {sql === '' ? (
              gettext('No change')
            ) : highlight && renderSql !== undefined && sql !== null ? (
              renderSql(sql)
            ) : (
              <pre className="overflow-x-auto font-mono text-xs" dir="ltr">
                <code className="sql">{sql}</code>
              </pre>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          {onBack !== undefined ? (
            <Button variant="primary" onClick={onBack}>
              {gettext('Go back')}
            </Button>
          ) : (
            <>
              {onConfirm !== undefined && (
                <Button id="previewSQLConfirmOkButton" onClick={onConfirm}>
                  {gettext('OK')}
                </Button>
              )}
              <Button {...(onConfirm === undefined ? { id: 'previewSQLCloseButton' } : {})} onClick={onClose}>
                {gettext('Close')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
