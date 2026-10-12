/**
 * phpMyAdmin controls implemented in this folder (parity registry, read statically by tools/parity;
 * see docs/architecture/12-project-structure-and-conventions.md 'Parity markers').
 * pma: resources/templates/table/relation/common_form.twig, resources/templates/table/relation/foreign_key_row.twig, resources/templates/table/relation/relational_dropdown.twig, resources/templates/table/relation/dropdown_generate.twig
 */
export const pmaControls = {
  'table/relation/common_form.twig#link:+ Add constraint': 'RelationPage.tsx',
  'table/relation/common_form.twig#button:Internal relationships': 'RelationPage.tsx',
  'table/relation/common_form.twig#display_field': 'RelationPage.tsx',
  'table/relation/common_form.twig#button:Preview SQL': 'RelationPage.tsx',
  'table/relation/common_form.twig#submit:Save': 'RelationPage.tsx',
  'table/relation/foreign_key_row.twig#constraint_name[*]': {
    file: 'RelationPage.tsx',
    match: 'constraint_name[',
  },
  'table/relation/foreign_key_row.twig#link:+ Add column': 'RelationPage.tsx',
  'js:table/relation.ts#change:select[name^="destination_db"], select[name^="destination_table"], select[name^="destination_foreign_db"], select[name^="destination_foreign_table"]':
    'RelationPage.tsx',
  'js:table/relation.ts#click:a.add_foreign_key': 'RelationPage.tsx',
  'js:table/relation.ts#click:a.add_foreign_key_field': 'RelationPage.tsx',
  'js:table/relation.ts#click:a.drop_foreign_key_anchor.ajax': 'RelationPage.tsx',
  'js:table/relation.ts#confirm:strDoYouReally': 'RelationPage.tsx',
} as const
