/**
 * phpMyAdmin controls implemented in this folder (parity registry, read statically by tools/parity;
 * see docs/architecture/12-project-structure-and-conventions.md "Parity markers").
 */
export const pmaControls = {
  // pma: resources/templates/sql/query.twig
  'sql/query.twig#sql_query': 'SqlPage.tsx',
  'sql/query.twig#sql_delimiter': 'SqlPage.tsx',
  'sql/query.twig#SQL': { file: 'SqlPage.tsx', match: 'button_submit_query' },
}
