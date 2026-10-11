import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@bettermyadmin/ui'
import { t } from '../../../lib/i18n'
import { HighlightedSql } from '../../sql/HighlightedSql'

/**
 * The "Preview SQL" modal (#previewSqlModal + components/_preview_sql.twig: "No change" when empty).
 */
export function PreviewSqlDialog({ sql, onClose }: { sql: string | null; onClose: () => void }) {
  return (
    <Dialog open={sql !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent id="previewSqlModal">
        <DialogHeader>
          <DialogTitle>{t('Preview SQL')}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="preview_sql" data-testid="preview-sql">
            {sql === null || sql.trim() === '' ? t('No change') : <HighlightedSql sql={sql.trimEnd()} />}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button id="previewSQLCloseButton" onClick={onClose}>
            {t('Close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
