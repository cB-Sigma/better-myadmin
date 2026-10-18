import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@bettermyadmin/ui'
import { THEMES } from '@bettermyadmin/ui/themes'
import { t, tProduct } from '../../../lib/i18n'

/**
 * The theme gallery: one card per theme with its screenshot, "name (version)" and "Take it".
 * pma: resources/templates/home/themes.twig
 */
export function ThemeCards({ onTake, active }: { onTake: (id: string) => void; active: string }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {THEMES.map((theme) => (
        <div
          key={theme.id}
          data-theme-card={theme.id}
          className="flex h-full flex-col overflow-hidden rounded-(--radius) border border-(--card-border) bg-(--card-bg)"
        >
          <div className="h-[16vh] overflow-hidden bg-bg-inset">
            <img
              src={`/themes/${theme.id}/screen.png`}
              alt={t('Screenshot of the %s theme.', theme.name)}
              className="h-full w-full object-cover object-top"
              loading="lazy"
            />
          </div>
          <div className="flex-1 p-3">
            <h5 className="text-base font-semibold">
              {theme.name} <small className="font-normal text-fg-muted">({theme.version})</small>
            </h5>
          </div>
          <div className="border-t border-(--card-border) bg-(--grid-header-bg) p-2">
            <Button
              variant="primary"
              name="set_theme"
              value={theme.id}
              onClick={() => onTake(theme.id)}
              aria-pressed={active === theme.id}
            >
              {t('Take it')}
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}

/** `#themesModal`: "phpMyAdmin Themes" with Close. */
export function ThemesDialog(props: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onTake: (id: string) => void
  active: string
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent size="xl" id="themesModal" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{tProduct('phpMyAdmin Themes')}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <ThemeCards
            active={props.active}
            onTake={(id) => {
              props.onTake(id)
              props.onOpenChange(false)
            }}
          />
        </DialogBody>
        <DialogFooter>
          {/* phpMyAdmin's "Get more themes!" links to CSS themes BetterMyAdmin cannot load (parity exceptions X30) */}
          <Button onClick={() => props.onOpenChange(false)}>{t('Close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
