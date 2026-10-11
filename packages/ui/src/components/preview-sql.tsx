import { useUiSettings } from '../settings.tsx'
import { Button } from './button.tsx'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './dialog.tsx'

/**
 * The "Preview SQL" modal of every form that generates SQL; open while `sql` is not null, "No
 * change" for an empty string.
 * pma: resources/templates/components/_preview_sql.twig, resources/js/modules/functions.ts::previewSql
 */
export function PreviewSqlDialog({ sql, onClose }: { sql: string | null; onClose: () => void }) {
  const { gettext } = useUiSettings()
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
            ) : (
              <pre className="overflow-x-auto font-mono text-xs" dir="ltr">
                <code className="sql">{sql}</code>
              </pre>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>{gettext('Close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
