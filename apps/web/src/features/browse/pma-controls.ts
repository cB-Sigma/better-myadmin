/**
 * phpMyAdmin controls implemented in this folder (parity registry, read statically by tools/parity;
 * see docs/architecture/12-project-structure-and-conventions.md "Parity markers").
 */
export const pmaControls = {
  // pma: resources/templates/display/results/checkbox_and_links.twig
  'display/results/checkbox_and_links.twig#rows_to_delete[*]': {
    file: 'GridTable.tsx',
    match: 'rows_to_delete[',
  },
  // pma: resources/templates/display/results/table.twig (navigation bar)
  'display/results/table.twig#navig': 'ResultsView.tsx',
  'display/results/table.twig#submit:Save edited data': 'ResultsView.tsx',
  'display/results/table.twig#submit:Restore column order': 'ResultsView.tsx',
  'display/results/table.twig#session_max_rows': 'ResultsView.tsx',
  'display/results/table.twig#id:filterRows': 'ResultsView.tsx',
  'display/results/table.twig#sql_query': 'ResultsView.tsx',
  'src/Display/Results.php#pos': 'ResultsView.tsx',
  // display options form
  'display/results/table.twig#id:extraOptionsButton': 'ResultsView.tsx',
  'display/results/table.twig#pftext': 'ResultsView.tsx',
  'display/results/table.twig#relational_display': 'ResultsView.tsx',
  'display/results/table.twig#display_binary': 'ResultsView.tsx',
  'display/results/table.twig#display_blob': 'ResultsView.tsx',
  'display/results/table.twig#hide_transformation': 'ResultsView.tsx',
  'display/results/table.twig#geoOption': 'ResultsView.tsx',
  'display/results/table.twig#submit:Go': 'ResultsView.tsx',
  // With selected
  'display/results/table.twig#id:resultsForm_*_checkall': {
    file: 'ResultsView.tsx',
    match: 'resultsForm_grid_checkall',
  },
  'display/results/table.twig#submit_mult': 'ResultsView.tsx',
  // Query results operations
  'display/results/table.twig#button:Print': 'ResultsView.tsx',
  'display/results/table.twig#link:Copy to clipboard': 'ResultsView.tsx',
  'display/results/table.twig#link:Export': 'ResultsView.tsx',
  'display/results/table.twig#link:Display chart': 'ResultsView.tsx',
  'display/results/table.twig#link:Visualize GIS data': 'ResultsView.tsx',
  'display/results/table.twig#link:Create view': 'ResultsView.tsx',
  // pma: resources/templates/sql/_bookmark.twig
  'sql/_bookmark.twig#bkm_fields[bkm_label]': 'ResultsView.tsx',
  'sql/_bookmark.twig#bkm_all_users': 'ResultsView.tsx',
  'sql/_bookmark.twig#submit:Create new bookmark': 'ResultsView.tsx',
  // pma: resources/templates/table/delete/confirm.twig
  'table/delete/confirm.twig#fk_checks': 'ResultsView.tsx',
  'table/delete/confirm.twig#mult_btn': 'ResultsView.tsx',
}
