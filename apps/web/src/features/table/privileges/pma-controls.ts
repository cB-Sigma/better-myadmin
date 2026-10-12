/**
 * phpMyAdmin controls of the table Privileges tab (parity registry, read statically by
 * tools/parity). The page is the database Privileges page with a `table` (one component for both).
 * pma: resources/templates/table/privileges/index.twig
 */
const page = '../../database/DbPrivilegesPage.tsx'

export const pmaControls = {
  'table/privileges/index.twig#selected_usr[]': { file: page, match: 'checkbox_sel_users_' },
  'table/privileges/index.twig#link:Edit privileges': page,
  'table/privileges/index.twig#link:Export': page,
  'table/privileges/index.twig#id:usersForm_checkall': page,
  'table/privileges/index.twig#submit_mult': page,
  'table/privileges/index.twig#link:Add user account': { file: page, match: 'tablename=' },
}
