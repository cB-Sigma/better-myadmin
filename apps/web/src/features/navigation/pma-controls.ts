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
}
