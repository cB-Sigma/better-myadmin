import { MessageBox } from '@bettermyadmin/ui'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { useConfig } from '../../lib/config'
import { Trans, t, tProduct } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'

/**
 * `$cfg['DBG']['demo']`: the "phpMyAdmin Demo Server" notice under every page, with the running Git
 * revision and branch (X33: the product name).
 * pma: resources/templates/base.twig (#pma_demo), src/Footer.php::getDisplay
 */
export function DemoBanner({ server }: { server: number }) {
  const cfg = useConfig() as { DBG?: { demo?: boolean } }
  const demo = cfg.DBG?.demo === true
  const build = useQuery({ queryKey: qk.build, queryFn: () => api.build(), enabled: demo })
  if (!demo) return null
  const git = build.data
  return (
    <div id="pma_demo" className="px-3 print:hidden">
      <MessageBox type="notice">
        <a href={`/s/${server}`}>{tProduct('phpMyAdmin Demo Server')}:</a>{' '}
        {git?.commit != null && git.branch != null ? (
          <Trans
            id="Currently running Git revision %1$s from the %2$s branch."
            args={[<strong key="r">{git.commit.slice(0, 7)}</strong>, <strong key="b">{git.branch}</strong>]}
          />
        ) : (
          t('Git information missing!')
        )}
      </MessageBox>
    </div>
  )
}
