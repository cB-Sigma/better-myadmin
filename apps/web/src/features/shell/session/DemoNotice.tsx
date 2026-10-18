import { Panel, PanelBody } from '@bettermyadmin/ui'
import { PROJECT_URL } from '../../../lib/config'
import { Trans, tProduct } from '../../../lib/i18n'

/** `$cfg['DBG']['demo']`: this is the demo server (the shell's client-visible DBG/demo). */
export function isDemo(cfg: Record<string, unknown>): boolean {
  return (cfg.DBG as { demo?: boolean } | undefined)?.demo === true
}

/**
 * The "phpMyAdmin Demo Server" card of the home page and the login form.
 * pma: resources/templates/home/index.twig, login/form.twig (is_demo)
 */
export function DemoServerCard({ variant = 'card' }: { variant?: 'card' | 'home' }) {
  return (
    <Panel variant={variant} title={tProduct('phpMyAdmin Demo Server')} className="mb-4">
      <PanelBody>
        <Trans
          id="You are using the demo server. You can do anything here, but please do not change root, debian-sys-maint and pma users. More information is available at %s."
          args={[
            <a key="demo" href={PROJECT_URL} target="_blank" rel="noopener noreferrer">
              {PROJECT_URL.replace(/^https:\/\//, '')}
            </a>,
          ]}
        />
      </PanelBody>
    </Panel>
  )
}
