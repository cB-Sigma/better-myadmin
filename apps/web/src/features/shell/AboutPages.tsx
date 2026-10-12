import { MessageBox, SafeHtml } from '@bettermyadmin/ui'
import { useQuery } from '@tanstack/react-query'
import { Navigate } from '@tanstack/react-router'
import { api, errorMessage } from '../../lib/api'
import { t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'

/**
 * The home page's List of changes and License, and Show runtime information (phpinfo(), X15).
 * pma: src/Controllers/ChangeLogController.php, templates/changelog.twig,
 *      src/Controllers/LicenseController.php, src/Controllers/PhpInfoController.php
 */

/** "The %s file is not available on this system, please visit %s for more information." */
function Unavailable({ file, url }: { file: string; url: string }) {
  const [before, middle, after] = t(
    'The %s file is not available on this system, please visit %s for more information.',
  ).split('%s')
  return (
    <p>
      {before}
      {file}
      {middle}
      <a href={url} rel="noopener noreferrer" target="_blank">
        {new URL(url).host}
      </a>
      {after}
    </p>
  )
}

export function ChangelogPage({ server }: { server: number }) {
  const q = useQuery({ queryKey: qk.about(server, 'changelog'), queryFn: () => api.aboutChangelog(server) })
  if (q.isError) return <MessageBox {...errorMessage(q.error)} />
  if (q.data === undefined) return null
  if (!q.data.available) return <Unavailable file={q.data.file} url={q.data.url} />
  return <SafeHtml as="pre" className="my-3 whitespace-pre-wrap text-sm" html={q.data.html} />
}

export function LicensePage({ server }: { server: number }) {
  const q = useQuery({ queryKey: qk.about(server, 'license'), queryFn: () => api.aboutLicense(server) })
  if (q.isError) return <MessageBox {...errorMessage(q.error)} />
  if (q.data === undefined) return null
  if (!q.data.available) return <Unavailable file={q.data.file} url={q.data.url} />
  // text/plain
  return <pre className="my-3 whitespace-pre-wrap text-sm">{q.data.text}</pre>
}

export function RuntimeInfoPage({ server }: { server: number }) {
  const q = useQuery({ queryKey: qk.about(server, 'runtime'), queryFn: () => api.aboutRuntime(server) })
  if (q.isError) return <MessageBox {...errorMessage(q.error)} />
  if (q.data === undefined) return null
  // PhpInfoController: without $cfg['ShowPhpInfo'] the home page
  if (!q.data.enabled) return <Navigate to="/s/$server" params={{ server }} replace />
  const d = q.data
  const rows: Array<[string, string]> = [
    ['Node.js', d.runtime.version],
    ...Object.entries(d.runtime.versions).map(([k, v]): [string, string] => [k, v]),
    ['platform', `${d.system.platform} ${d.system.release} (${d.system.arch})`],
    ['pid', String(d.process.pid)],
    ['uptime', `${d.process.uptimeSeconds} s`],
    ['rss', `${d.process.rssBytes}`],
    ['heap used', `${d.process.heapUsedBytes}`],
    ['cwd', d.process.cwd],
    ['ShowServerInfo', String(d.config.ShowServerInfo)],
  ]
  return (
    <table className="my-3 text-sm">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k} className="odd:bg-grid-odd even:bg-grid-even">
            <th className="px-2 py-1 text-left font-semibold">{k}</th>
            <td className="px-2 py-1 font-mono">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
