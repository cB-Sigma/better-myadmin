/**
 * phpMyAdmin controls implemented in this folder (parity registry, read statically by tools/parity;
 * see docs/architecture/12-project-structure-and-conventions.md "Parity markers").
 * Keys come from tools/parity/inventory/controls.json; values name the component that renders the
 * control, optionally with a string that must occur in it.
 */
export const pmaControls = {
  // pma: resources/templates/login/form.twig
  'login/form.twig#lang': 'LanguageSelect.tsx',
  'login/form.twig#pma_servername': 'LoginPage.tsx',
  'login/form.twig#pma_username': 'LoginPage.tsx',
  'login/form.twig#pma_password': 'LoginPage.tsx',
  'login/form.twig#server': 'LoginPage.tsx',
  'login/form.twig#id:input_go': 'LoginPage.tsx',
  // pma: resources/templates/home/index.twig ("Appearance settings")
  'home/index.twig#lang': { file: 'HomePage.tsx', match: '<LanguageSelect' },
  // pma: resources/templates/menu/main.twig (breadcrumb + tabs)
  'menu/main.twig#link:Server:': 'ServerShell.tsx',
  'menu/main.twig#link:(current)': 'ServerShell.tsx',
}
