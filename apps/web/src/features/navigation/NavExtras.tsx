import type { NavNode } from '@bettermyadmin/contracts'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Modal,
  PmaIcon,
  showMessage,
} from '@bettermyadmin/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { t } from '../../lib/i18n'
import { qk } from '../../lib/queryKeys'

/**
 * The navigation's Recent / Favorites dropdowns and the hide / show-hidden-items controls.
 *
 * pma: src/Navigation/NavigationTree.php::quickWarp, templates/navigation/tree/quick_warp.twig,
 *      recent_favorite_table_recent.twig, recent_favorite_table_favorite.twig,
 *      src/Favorites/RecentFavoriteTables.php::getHtmlSyncFavoriteTables,
 *      src/Navigation/Nodes/NodeDatabaseChild.php / NodeDatabase.php::getHtmlForControlButtons,
 *      templates/navigation/item_unhide_dialog.twig, templates/modals/unhide_nav_item.twig,
 *      resources/js/modules/functions.ts::onloadRecentFavoriteTables,
 *      resources/js/modules/navigation/event-loader.ts (favorite_table_anchor, hideNavItem, showUnhide)
 */

const FAVORITES_KEY = 'favoriteTables'

function localFavorites(): string {
  try {
    return window.localStorage.getItem(FAVORITES_KEY) ?? ''
  } catch {
    return ''
  }
}

function storeFavorites(v: string | undefined): void {
  if (v === undefined) return
  try {
    window.localStorage.setItem(FAVORITES_KEY, v)
  } catch {
    // storage unavailable
  }
}

/**
 * A table visit adds it to Recent (pma: Http\Middleware\RecentTableHandling). The lists' read waits
 * for the pending add: both requests store the lists in the session, the later one would win.
 */
let pendingRecent: Promise<unknown> = Promise.resolve()
export function addRecentTable(
  qc: ReturnType<typeof useQueryClient>,
  server: number,
  tb: { db: string; table: string },
): void {
  // the list's read waits for the POST only (not for its own refetch)
  const added = api.addRecent(server, tb).catch(() => {
    // the recent list is a convenience: a failure leaves the page as it is
  })
  pendingRecent = added
  void added.then(() => qc.invalidateQueries({ queryKey: qk.recentFavorite(server) }))
}

/** tree/quick_warp.twig: shown when NumRecentTables / NumFavoriteTables are not 0 */
export function QuickWarp({ server }: { server: number }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const q = useQuery({
    queryKey: qk.recentFavorite(server),
    queryFn: async () => {
      await pendingRecent
      return api.recentFavorite(server)
    },
  })
  const sync = q.data?.syncFavorites === true
  // onloadRecentFavoriteTables: the favorites of localStorage synchronised to the storage once
  useEffect(() => {
    if (!sync) return
    const local = localFavorites()
    if (local === 'undefined') return
    void api.syncFavorites(server, local).then((r) => {
      storeFavorites(r.favoriteTables)
      void qc.invalidateQueries({ queryKey: qk.recentFavorite(server) })
    })
  }, [sync, server, qc])
  if (q.data === undefined) return null
  const d = q.data
  if (d.numRecentTables <= 0 && d.numFavoriteTables <= 0) return null
  const open = async (tb: { db: string; table: string }) => {
    // /table/recent-favorite: forget a table that no longer exists, then /sql (Browse)
    const r = await api.openRecentFavorite(server, tb)
    if (!r.ok) {
      if (r.message !== null) showMessage(r.message.text, false, 'error')
      return
    }
    await qc.invalidateQueries({ queryKey: qk.recentFavorite(server) })
    void navigate({ to: '/s/$server/db/$db/t/$table/browse', params: { server, db: tb.db, table: tb.table } })
  }
  const removeFavorite = async (tb: { db: string; table: string }) => {
    const r = await api.favorite(server, { ...tb, action: 'remove', favoriteTables: localFavorites() })
    if (!r.changes) {
      if (r.message !== undefined) showMessage(r.message.text, false, 'error')
      return
    }
    storeFavorites(r.favoriteTables)
    await qc.invalidateQueries({ queryKey: qk.recentFavorite(server) })
    // the database Structure page's stars
    await qc.invalidateQueries({ queryKey: qk.db({ server, db: tb.db }) })
  }
  const label = (tb: { db: string; table: string }) => `\`${tb.db}\`.\`${tb.table}\``
  return (
    <div className="my-3 mx-1 flex gap-1" id="recentFavoriteTablesWrapper">
      {d.numRecentTables > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="secondary" title={t('Recently visited tables')}>
              {t('Recent')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent id="recentTableList">
            {d.recent.length === 0 ? (
              <DropdownMenuItem disabled>{t('There are no recent tables.')}</DropdownMenuItem>
            ) : (
              d.recent.map((tb) => (
                <DropdownMenuItem key={`${tb.db}.${tb.table}`} asChild>
                  <Link
                    to="/s/$server/db/$db/t/$table/browse"
                    params={{ server, db: tb.db, table: tb.table }}
                    onClick={(e) => {
                      e.preventDefault()
                      void open(tb)
                    }}
                  >
                    {label(tb)}
                  </Link>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {d.numFavoriteTables > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="secondary" title={t('Favorite tables')}>
              {t('Favorites')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent id="favoriteTableList">
            {d.favorite.length === 0 ? (
              <DropdownMenuItem disabled>{t('There are no favorite tables.')}</DropdownMenuItem>
            ) : (
              d.favorite.map((tb) => (
                <DropdownMenuItem key={`${tb.db}.${tb.table}`} onSelect={(e) => e.preventDefault()}>
                  <button
                    type="button"
                    className="favorite_table_anchor me-2"
                    title={t('Remove from Favorites')}
                    onClick={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      void removeFavorite(tb)
                    }}
                  >
                    <PmaIcon name="b_favorite" />
                  </button>
                  <Link
                    to="/s/$server/db/$db/t/$table/browse"
                    params={{ server, db: tb.db, table: tb.table }}
                    onClick={(e) => {
                      e.preventDefault()
                      void open(tb)
                    }}
                  >
                    {label(tb)}
                  </Link>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

/** Navigation::getItemUnhideDialog's type labels */
function typeLabel(type: string): string {
  switch (type) {
    case 'group':
      return t('Groups:')
    case 'event':
      return t('Events:')
    case 'function':
      return t('Functions:')
    case 'procedure':
      return t('Procedures:')
    case 'table':
      return t('Tables:')
    case 'view':
      return t('Views:')
    default:
      return type
  }
}
const TYPES = ['group', 'event', 'function', 'procedure', 'table', 'view']

/** the controls after a node: Hide (database children), Show hidden items (a database with hidden ones) */
export function NodeControls({
  server,
  node,
  onChanged,
}: { server: number; node: NavNode; onChanged: () => void }) {
  const [unhide, setUnhide] = useState(false)
  const hide = node.hide
  return (
    <>
      {hide !== undefined && (
        <span className="navItemControls ms-auto hidden ps-1 group-hover:inline">
          <button
            type="button"
            className="hideNavItem"
            title={t('Hide')}
            onClick={() =>
              void api.navHide(server, 'hide', hide).then((r) => {
                if (r.success) onChanged()
              })
            }
          >
            <PmaIcon name="hide" alt={t('Hide')} />
          </button>
        </span>
      )}
      {(node.hiddenCount ?? 0) > 0 && (
        <span className="dbItemControls ms-auto ps-1">
          <button
            type="button"
            className="showUnhide"
            title={t('Show hidden items')}
            onClick={() => setUnhide(true)}
          >
            <PmaIcon name="show" alt={t('Show hidden items')} />
          </button>
        </span>
      )}
      {unhide && (
        <UnhideDialog
          server={server}
          db={node.realName}
          onClose={() => setUnhide(false)}
          onChanged={onChanged}
        />
      )}
    </>
  )
}

function UnhideDialog({
  server,
  db,
  onClose,
  onChanged,
}: { server: number; db: string; onClose: () => void; onChanged: () => void }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: qk.navHidden(server, db), queryFn: () => api.navHidden(server, db) })
  const hidden = q.data?.hidden ?? {}
  const types = TYPES.filter((type) => Array.isArray(hidden[type]))
  return (
    <Modal
      open
      onClose={onClose}
      id="unhideNavItemModal"
      title={t('Show hidden navigation tree items.')}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t('Close')}
        </Button>
      }
    >
      {types.map((type, i) => (
        <div key={type}>
          {i > 0 && <br />}
          <strong>{typeLabel(type)}</strong>
          <table className="w-full text-sm">
            <tbody>
              {(hidden[type] ?? []).map((item) => (
                <tr key={item}>
                  <td>{item}</td>
                  <td className="text-end">
                    <button
                      type="button"
                      className="unhideNavItem inline-flex items-center gap-1 text-accent"
                      onClick={() =>
                        void api
                          .navHide(server, 'unhide', { itemType: type, itemName: item, dbName: db })
                          .then(async (r) => {
                            if (!r.success) return
                            await qc.invalidateQueries({ queryKey: qk.navHidden(server, db) })
                            onChanged()
                          })
                      }
                    >
                      <PmaIcon name="show" />
                      {t('Unhide')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </Modal>
  )
}
