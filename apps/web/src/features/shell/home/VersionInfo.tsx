import { Alert, PanelItem } from '@bettermyadmin/ui'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../../lib/api.ts'
import { t, tProduct } from '../../../lib/i18n'
import { qk } from '../../../lib/queryKeys.ts'

/**
 * GitInfo.parseVersionString: `-rcN` → −20−N, `-betaN` → −40−N, `-alphaN` → −60−N, `-dev` → 0.
 * pma: resources/js/modules/git-info.ts
 */
export function parseVersionString(str: string): number {
  let add = 0
  const state = str.split('-')
  const s1 = state[1]
  if (state.length >= 2 && s1 !== undefined) {
    if (s1.startsWith('rc')) add = -20 - Number.parseInt(s1.substring(2), 10)
    else if (s1.startsWith('beta')) add = -40 - Number.parseInt(s1.substring(4), 10)
    else if (s1.startsWith('alpha')) add = -60 - Number.parseInt(s1.substring(5), 10)
  }
  const x = str.split('.')
  const p = (i: number) => Number.parseInt(x[i] ?? '', 10) || 0
  return p(0) * 100000000 + p(1) * 1000000 + p(2) * 10000 + p(3) * 100 + add
}

/** What GitInfo.currentVersion adds next to "Version information:". */
export function versionNotice(
  current: string,
  latest: string,
): { upToDate: boolean; newer: boolean; security: boolean } {
  const c = parseVersionString(current)
  const l = parseVersionString(latest)
  return {
    upToDate: l === c,
    newer: l > c,
    security: l > c && Math.floor(l / 10000) === Math.floor(c / 10000),
  }
}

/** `#li_pma_version` with the asynchronous version check (`li.jsversioncheck`). */
export function VersionInfo({ version, check }: { version: string; check: boolean }) {
  const q = useQuery({
    queryKey: qk.versionCheck,
    queryFn: api.versionCheck,
    enabled: check,
    staleTime: 6 * 3600_000,
  })
  const data =
    q.data !== undefined && 'version' in q.data && q.data.version !== '' && q.data.date !== '' ? q.data : null
  const n = data !== null ? versionNotice(version, data.version) : null
  return (
    <>
      <PanelItem id="li_pma_version" className={`ps-0${check ? ' jsversioncheck' : ''}`}>
        {t('Version information:')} <span className="version">{version}</span>
        {data !== null &&
          n !== null &&
          (n.upToDate ? (
            ` (${t('up to date')})`
          ) : (
            <span className="latest">
              {t(', latest stable version:')}{' '}
              <a
                href={`https://github.com/cB-Abhinav-Gautam/better-myadmin/releases/tag/v${encodeURIComponent(data.version)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {data.version}
              </a>
            </span>
          ))}
      </PanelItem>
      {data !== null && n?.newer === true && (
        <li className="list-none">
          <Alert variant={n.security ? 'error' : 'notice'} id="newer_version_notice" className="m-2">
            {tProduct(
              'A newer version of phpMyAdmin is available and you should consider upgrading. The newest version is %s, released on %s.',
              data.version,
              data.date,
            )}
          </Alert>
        </li>
      )}
    </>
  )
}
