/**
 * phpMyAdmin controls implemented in this folder (parity registry, read statically by tools/parity;
 * see docs/architecture/12-project-structure-and-conventions.md "Parity markers").
 */
export const pmaControls = {
  // pma: resources/templates/navigation/main.twig (#navipanellinks)
  'navigation/main.twig#link:Home': 'NavigationPanel.tsx',
  'navigation/main.twig#link:Empty session data': 'NavigationPanel.tsx',
  'navigation/main.twig#link:phpMyAdmin documentation': 'NavigationPanel.tsx',
  'navigation/main.twig#link:MariaDB Documentation': 'NavigationPanel.tsx',
  'navigation/main.twig#link:Navigation panel settings': 'NavigationPanel.tsx',
  'navigation/main.twig#link:Reload navigation panel': 'NavigationPanel.tsx',
  // pma: src/Navigation/NavigationTree.php::controls
  'src/Navigation/NavigationTree.php#id:pma_navigation_collapse': 'NavigationPanel.tsx',
  'src/Navigation/NavigationTree.php#id:pma_navigation_sync': 'NavigationPanel.tsx',
  // pma: resources/templates/server/select/index.twig (NavigationDisplayServers, DisplayServersList = false)
  'server/select/index.twig#server': { file: 'NavigationPanel.tsx', match: 'select_server' },
  // pma: resources/templates/navigation/tree/fast_filter.twig
  'navigation/tree/fast_filter.twig#text:Type to filter these, Enter to search all': 'NavTree.tsx',
  'navigation/tree/fast_filter.twig#button:Clear fast filter': 'NavTree.tsx',
  // pma: resources/templates/list_navigator.twig + Util::pageselector via Generator::getListNavigator
  'list_navigator.twig#link:Begin': 'NavTree.tsx',
  'list_navigator.twig#link:Previous': 'NavTree.tsx',
  'list_navigator.twig#link:Next': 'NavTree.tsx',
  'list_navigator.twig#link:End': 'NavTree.tsx',
  'src/Html/Generator.php#select:pageselector': { file: 'NavTree.tsx', match: 'pageselector' },
  // pma: resources/js/modules/navigation.ts, navigation/event-loader.ts
  'js:modules/navigation.ts#ajax:POST /navigation': {
    file: 'NavigationPanel.tsx',
    match: 'queryFn: () => api.navBranch(server, q)',
  },
  'js:modules/navigation.ts#ajax:POST <url>': { file: 'store.ts', match: 'searchClause2: text' },
  'js:modules/navigation.ts#click:#pma_navigation .throbber': {
    file: 'NavTree.tsx',
    match: 'if (!row.loading) void store.toggle(node)',
  },
  'js:modules/navigation.ts#click:#pma_navigation_collapser': {
    file: 'NavigationPanel.tsx',
    match: 'id="pma_navigation_collapser"',
  },
  'js:modules/navigation.ts#mousedown:#pma_navigation_resizer': {
    file: 'NavigationPanel.tsx',
    match: 'id="pma_navigation_resizer"',
  },
  'js:modules/navigation.ts#mousemove:document': {
    file: 'NavigationPanel.tsx',
    match: "target.addEventListener('pointermove', move)",
  },
  'js:modules/navigation.ts#mouseup:document': {
    file: 'NavigationPanel.tsx',
    match: "target.addEventListener('pointerup', up)",
  },
  'js:modules/navigation.ts#mouseenter:#full_name_layer': {
    file: 'NavTree.tsx',
    match: 'id="full_name_layer"',
  },
  'js:modules/navigation.ts#mouseleave:#full_name_layer': {
    file: 'NavTree.tsx',
    match: 'onMouseLeave={() => setLayer(null)}',
  },
  'js:modules/navigation.ts#mouseenter:<$containerELem> .hover_show_full': {
    file: 'NavTree.tsx',
    match: 'el.scrollWidth <= el.clientWidth',
  },
  'js:modules/navigation.ts#resize:window': {
    file: 'NavTree.tsx',
    match: 'min-h-0 flex-1 overflow-y-auto overflow-x-hidden',
  },
  "js:modules/navigation/event-loader.ts#ajax:POST <$(this).attr('href')>": {
    file: 'NavExtras.tsx',
    match: "api.navHide(server, 'hide', hide)",
  },
  "js:modules/navigation/event-loader.ts#ajax:POST <$self.attr('href')>": {
    file: 'NavExtras.tsx',
    match: 'api.favorite(server, {',
  },
  'js:modules/navigation/event-loader.ts#blur:#pma_navigation_tree li.fast_filter input.searchClause': {
    file: 'NavTree.tsx',
    match: 'onChange={(e) => store.setFilter(ownerKey, e.target.value)}',
  },
  'js:modules/navigation/event-loader.ts#keyup:#pma_navigation_tree li.fast_filter input.searchClause': {
    file: 'NavTree.tsx',
    match: 'onChange={(e) => store.setFilter(ownerKey, e.target.value)}',
  },
  'js:modules/navigation/event-loader.ts#focus:#pma_navigation_tree li.fast_filter input.searchClause': {
    file: 'NavTree.tsx',
    match: 'e.currentTarget.select()',
  },
  'js:modules/navigation/event-loader.ts#submit:.fast_filter': {
    file: 'NavTree.tsx',
    match: "if (e.key === 'Enter') void store.search(row.filter, ownerKey, e.currentTarget.value)",
  },
  'js:modules/navigation/event-loader.ts#click:#pma_navigation_tree li.fast_filter button.searchClauseClear':
    { file: 'NavTree.tsx', match: 'onClick={() => store.clearFilter(ownerKey)}' },
  'js:modules/navigation/event-loader.ts#click:#pma_navigation_tree div.pageselector a.ajax': {
    file: 'NavTree.tsx',
    match: 'void store.paginate(p, row.ownerKey, v)',
  },
  'js:modules/navigation/event-loader.ts#click:#pma_navigation_tree a.expander': {
    file: 'NavTree.tsx',
    match: "title={t('Expand/Collapse')}",
  },
  'js:modules/navigation/event-loader.ts#click:.favorite_table_anchor': {
    file: 'NavExtras.tsx',
    match: 'className="favorite_table_anchor me-2"',
  },
  'js:modules/navigation/event-loader.ts#click:#pma_navigation_collapse': {
    file: 'NavigationPanel.tsx',
    match: 'onClick={() => store.collapseAll()}',
  },
  'js:modules/navigation/event-loader.ts#click:#pma_navigation_reload': {
    file: 'NavigationPanel.tsx',
    match: 'void onReload().finally(() => setReloading(false))',
  },
  'js:modules/navigation/event-loader.ts#click:#pma_navigation_sync': {
    file: 'NavigationPanel.tsx',
    match: 'onClick={() => store.setSynced(!store.synced)}',
  },
  'js:modules/navigation/event-loader.ts#mouseenter:#pma_navigation_sync': {
    file: 'NavigationPanel.tsx',
    match: 'store.synced !== syncHover',
  },
  'js:modules/navigation/event-loader.ts#mouseout:#pma_navigation_sync': {
    file: 'NavigationPanel.tsx',
    match: 'store.synced !== syncHover',
  },
  'js:modules/navigation/event-loader.ts#click:a.hideNavItem.ajax': {
    file: 'NavExtras.tsx',
    match: 'className="hideNavItem"',
  },
  'js:modules/navigation/event-loader.ts#click:a.showUnhide.ajax': {
    file: 'NavExtras.tsx',
    match: 'className="showUnhide"',
  },
  'js:modules/navigation/event-loader.ts#click:a.unhideNavItem.ajax': {
    file: 'NavExtras.tsx',
    match: "navHide(server, 'unhide', { itemType: type, itemName: item, dbName: db })",
  },
  'js:modules/navigation/event-loader.ts#click:li.new_view a.ajax': {
    file: 'NavTree.tsx',
    match: 'onNewView(newViewDb)',
  },
  'js:modules/navigation/event-loader.ts#mouseover:#pma_navigation_tree.highlight li:not(.fast_filter)': {
    file: 'NavTree.tsx',
    match: "pointer && 'hover:bg-nav-pointer'",
  },
  'js:modules/navigation/event-loader.ts#mouseout:#pma_navigation_tree.highlight li:not(.fast_filter)': {
    file: 'NavTree.tsx',
    match: "pointer && 'hover:bg-nav-pointer'",
  },
  'js:modules/navigation/event-loader.ts#submit:form.config-form': {
    file: '../preferences/ConfigForm.tsx',
    match: "window.sessionStorage.removeItem('navTreePaths')",
  },
  'js:modules/navigation/updateNavigationWidthConfig.ts#ajax:POST /navigation/update-width': {
    file: 'NavigationPanel.tsx',
    match: 'void api.navWidth(server, width)',
  },
  "js:modules/functions.ts#ajax:POST <$('#sync_favorite_tables').attr('href')>": {
    file: 'NavExtras.tsx',
    match: 'void api.syncFavorites(server, local)',
  },
  'js:modules/functions/event-loader.ts#change:select.pageselector': {
    file: 'NavTree.tsx',
    match: 'onChange={(e) => go(Number(e.target.value))}',
  },
  // pma: navigation/tree/quick_warp.twig, recent_favorite_table_favorite.twig, the unhide dialog
  'modals/unhide_nav_item.twig#button:Close': { file: 'NavExtras.tsx', match: 'id="unhideNavItemModal"' },
  'navigation/item_unhide_dialog.twig#link:Unhide': { file: 'NavExtras.tsx', match: "{t('Unhide')}" },
  'navigation/tree/quick_warp.twig#button:Favorites': { file: 'NavExtras.tsx', match: "{t('Favorites')}" },
  'navigation/tree/quick_warp.twig#button:Recent': { file: 'NavExtras.tsx', match: "{t('Recent')}" },
  'recent_favorite_table_favorite.twig#link:Remove from Favorites': {
    file: 'NavExtras.tsx',
    match: "title={t('Remove from Favorites')}",
  },
}
