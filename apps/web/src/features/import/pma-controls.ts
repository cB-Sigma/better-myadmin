/**
 * phpMyAdmin controls implemented in this folder (parity registry, read statically by tools/parity;
 * see docs/architecture/12-project-structure-and-conventions.md "Parity markers").
 */
export const pmaControls = {
  // pma: resources/templates/import.twig
  'import.twig#id:uploadFileTab': 'ImportPage.tsx',
  'import.twig#id:localFileTab': 'ImportPage.tsx',
  'import.twig#import_file': 'ImportPage.tsx',
  'import.twig#local_import_file': 'ImportPage.tsx',
  'import.twig#charset_of_file': 'ImportPage.tsx',
  'import.twig#allow_interrupt': 'ImportPage.tsx',
  'import.twig#skip_queries': 'ImportPage.tsx',
  'import.twig#fk_checks': 'ImportPage.tsx',
  'import.twig#format': 'ImportPage.tsx',
  'import.twig#id:buttonGo': 'ImportPage.tsx',
  // pma: resources/templates/import_status.twig (the result page's way back)
  'import_status.twig#link:Back': { file: 'ImportPage.tsx', match: "t('Back')" },
  // pma: resources/js/import.ts (behaviours)
  'js:import.ts#ajax:GET /import-status': { file: 'ImportPage.tsx', match: 'api.importEvents' },
  'js:import.ts#change:#input_import_file': {
    file: 'ImportPage.tsx',
    match: 'matchFormat(e.currentTarget.value',
  },
  'js:import.ts#change:#plugins': { file: 'ImportPage.tsx', match: 'setPlugin(e.currentTarget.value)' },
  'js:import.ts#change:#select_local_import_file': {
    file: 'ImportPage.tsx',
    match: 'select_local_import_file',
  },
  'js:import.ts#click:#importmain #buttonGo': { file: 'ImportPage.tsx', match: 'Uploading your import file' },
  'js:import.ts#keyup:#text_csv_enclosed': { file: 'ImportPage.tsx', match: 'oneCharacter(el.value)' },
  'js:import.ts#submit:#import_file_form': {
    file: 'ImportPage.tsx',
    match: 'Please select the file you want to import:',
  },
}
