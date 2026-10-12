import { MessageBox, Panel, PanelBody } from '@bettermyadmin/ui'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { api } from '../../../lib/api'
import { PROJECT_URL } from '../../../lib/config'
import { Trans, t, tProduct } from '../../../lib/i18n'
import { qk } from '../../../lib/queryKeys'

/**
 * The demo server's footer notice ($cfg['DBG']['demo']): a link home and the running git revision
 * and branch (or "Git information missing!").
 * pma: resources/templates/base.twig (#pma_demo), src/Footer.php::getGitRevisionInfo
 */
export function DemoNotice({ server }: { server: number }) {
  const build = useQuery({ queryKey: qk.build, queryFn: api.build, staleTime: Number.POSITIVE_INFINITY })
  const commit = build.data?.commit ?? null
  const branch = build.data?.branch ?? null
  const ext = { target: '_blank', rel: 'noopener noreferrer' } as const
  return (
    <div id="pma_demo" className="px-3 pb-2 print:hidden">
      <MessageBox type="notice">
        <Link to="/s/$server" params={{ server }}>
          {tProduct('phpMyAdmin Demo Server')}:
        </Link>{' '}
        {commit !== null && branch !== null ? (
          <Trans
            id="Currently running Git revision %1$s from the %2$s branch."
            args={[
              <a key="rev" href={`${PROJECT_URL}/commit/${commit}`} {...ext}>
                {commit}
              </a>,
              <a key="branch" href={`${PROJECT_URL}/tree/${branch}`} {...ext}>
                {branch}
              </a>,
            ]}
          />
        ) : (
          t('Git information missing!')
        )}
      </MessageBox>
    </div>
  )
}

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
