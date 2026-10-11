/**
 * phpMyAdmin controls implemented in this folder (parity registry, read statically by tools/parity;
 * see docs/architecture/12-project-structure-and-conventions.md "Parity markers").
 */
export const pmaControls = {
  // pma: resources/templates/server/privileges/add_user.twig
  'server/privileges/add_user.twig#createdb-1': 'AddUserPage.tsx',
  'server/privileges/add_user.twig#createdb-2': 'AddUserPage.tsx',
  'server/privileges/add_user.twig#createdb-3': 'AddUserPage.tsx',
  'server/privileges/add_user.twig#id:adduser_submit': 'AddUserPage.tsx',
  // pma: resources/templates/server/privileges/add_user_fieldset.twig
  'server/privileges/add_user_fieldset.twig#link:Add user account': 'UsersPage.tsx',
  // pma: resources/templates/server/privileges/change_password.twig
  'server/privileges/change_password.twig#authentication_plugin': 'EditUserPage.tsx',
  'server/privileges/change_password.twig#nopass': 'EditUserPage.tsx',
  'server/privileges/change_password.twig#pma_pw': 'EditUserPage.tsx',
  'server/privileges/change_password.twig#pma_pw2': 'EditUserPage.tsx',
  'server/privileges/change_password.twig#submit:Go': 'EditUserPage.tsx',
  // pma: resources/templates/server/privileges/choose_user_group.twig
  'server/privileges/choose_user_group.twig#userGroup': 'UsersPage.tsx',
  // pma: resources/templates/server/privileges/edit_routine_privileges.twig
  'server/privileges/edit_routine_privileges.twig#Alter_routine_priv': 'privileges.ts',
  'server/privileges/edit_routine_privileges.twig#Execute_priv': 'privileges.ts',
  'server/privileges/edit_routine_privileges.twig#Grant_priv': 'privileges.ts',
  'server/privileges/edit_routine_privileges.twig#id:checkall_Routine_priv': 'PrivilegesTableFields.tsx',
  'server/privileges/edit_routine_privileges.twig#submit:Go': 'EditUserPage.tsx',
  // pma: resources/templates/server/privileges/initials_row.twig
  'server/privileges/initials_row.twig#link:Any': 'UsersPage.tsx',
  'server/privileges/initials_row.twig#link:Show all': 'UsersPage.tsx',
  // pma: resources/templates/server/privileges/login_information_fields.twig
  'server/privileges/login_information_fields.twig#authentication_plugin': 'LoginInformationFields.tsx',
  'server/privileges/login_information_fields.twig#hostname': 'LoginInformationFields.tsx',
  'server/privileges/login_information_fields.twig#pma_pw': 'LoginInformationFields.tsx',
  'server/privileges/login_information_fields.twig#pma_pw2': 'LoginInformationFields.tsx',
  'server/privileges/login_information_fields.twig#pred_hostname': 'LoginInformationFields.tsx',
  'server/privileges/login_information_fields.twig#pred_password': 'LoginInformationFields.tsx',
  'server/privileges/login_information_fields.twig#pred_username': 'LoginInformationFields.tsx',
  'server/privileges/login_information_fields.twig#username': 'LoginInformationFields.tsx',
  // pma: resources/templates/server/privileges/new_user_ajax.twig
  'server/privileges/new_user_ajax.twig#button:Edit user group': 'UsersPage.tsx',
  'server/privileges/new_user_ajax.twig#link:Edit privileges': 'UsersPage.tsx',
  'server/privileges/new_user_ajax.twig#link:Export': 'UsersPage.tsx',
  'server/privileges/new_user_ajax.twig#selected_usr[]': 'UsersPage.tsx',
  // pma: resources/templates/server/privileges/privileges_summary.twig
  'server/privileges/privileges_summary.twig#dbname': 'EditUserPage.tsx',
  'server/privileges/privileges_summary.twig#pred_dbname[]': 'EditUserPage.tsx',
  'server/privileges/privileges_summary.twig#pred_routinename': 'EditUserPage.tsx',
  'server/privileges/privileges_summary.twig#pred_tablename': 'EditUserPage.tsx',
  'server/privileges/privileges_summary.twig#routinename': 'EditUserPage.tsx',
  'server/privileges/privileges_summary.twig#submit:Go': 'EditUserPage.tsx',
  'server/privileges/privileges_summary.twig#tablename': 'EditUserPage.tsx',
  // pma: resources/templates/server/privileges/privileges_table.twig
  'server/privileges/privileges_table.twig#Alter_priv': 'privileges.ts',
  'server/privileges/privileges_table.twig#Alter_routine_priv': 'privileges.ts',
  'server/privileges/privileges_table.twig#Create View_priv': 'privileges.ts',
  'server/privileges/privileges_table.twig#Create_priv': 'privileges.ts',
  'server/privileges/privileges_table.twig#Create_routine_priv': 'privileges.ts',
  'server/privileges/privileges_table.twig#Create_tmp_table_priv': 'privileges.ts',
  'server/privileges/privileges_table.twig#Create_user_priv': 'privileges.ts',
  'server/privileges/privileges_table.twig#Create_view_priv': 'privileges.ts',
  'server/privileges/privileges_table.twig#Delete_history_priv': 'privileges.ts',
  'server/privileges/privileges_table.twig#Delete_priv': 'privileges.ts',
  'server/privileges/privileges_table.twig#Drop_priv': 'privileges.ts',
  'server/privileges/privileges_table.twig#Event_priv': 'privileges.ts',
  'server/privileges/privileges_table.twig#Execute_priv': 'privileges.ts',
  'server/privileges/privileges_table.twig#File_priv': 'privileges.ts',
  'server/privileges/privileges_table.twig#Grant_priv': 'privileges.ts',
  'server/privileges/privileges_table.twig#Index_priv': 'privileges.ts',
  'server/privileges/privileges_table.twig#Insert_priv': 'privileges.ts',
  'server/privileges/privileges_table.twig#Insert_priv[]': 'privileges.ts',
  'server/privileges/privileges_table.twig#Insert_priv_none': 'PrivilegesTableFields.tsx',
  'server/privileges/privileges_table.twig#Lock_tables_priv': 'privileges.ts',
  'server/privileges/privileges_table.twig#Process_priv': 'privileges.ts',
  'server/privileges/privileges_table.twig#References_priv': 'privileges.ts',
  'server/privileges/privileges_table.twig#References_priv[]': 'privileges.ts',
  'server/privileges/privileges_table.twig#References_priv_none': 'PrivilegesTableFields.tsx',
  'server/privileges/privileges_table.twig#Reload_priv': 'privileges.ts',
  'server/privileges/privileges_table.twig#Repl_client_priv': 'privileges.ts',
  'server/privileges/privileges_table.twig#Repl_slave_priv': 'privileges.ts',
  'server/privileges/privileges_table.twig#Select_priv': 'privileges.ts',
  'server/privileges/privileges_table.twig#Select_priv[]': 'privileges.ts',
  'server/privileges/privileges_table.twig#Select_priv_none': 'PrivilegesTableFields.tsx',
  'server/privileges/privileges_table.twig#Show_db_priv': 'privileges.ts',
  'server/privileges/privileges_table.twig#Show_view_priv': 'privileges.ts',
  'server/privileges/privileges_table.twig#Shutdown_priv': 'privileges.ts',
  'server/privileges/privileges_table.twig#Super_priv': 'privileges.ts',
  'server/privileges/privileges_table.twig#Trigger_priv': 'privileges.ts',
  'server/privileges/privileges_table.twig#Update_priv': 'privileges.ts',
  'server/privileges/privileges_table.twig#Update_priv[]': 'privileges.ts',
  'server/privileges/privileges_table.twig#Update_priv_none': 'PrivilegesTableFields.tsx',
  'server/privileges/privileges_table.twig#id:addUsersForm_checkall': 'PrivilegesTableFields.tsx',
  'server/privileges/privileges_table.twig#id:checkall_Administration_priv': 'PrivilegesTableFields.tsx',
  'server/privileges/privileges_table.twig#id:checkall_Data_priv': 'PrivilegesTableFields.tsx',
  'server/privileges/privileges_table.twig#id:checkall_Structure_priv': 'PrivilegesTableFields.tsx',
  'server/privileges/privileges_table.twig#id:insert_priv_all': 'PrivilegesTableFields.tsx',
  'server/privileges/privileges_table.twig#id:references_priv_all': 'PrivilegesTableFields.tsx',
  'server/privileges/privileges_table.twig#id:select_priv_all': 'PrivilegesTableFields.tsx',
  'server/privileges/privileges_table.twig#id:update_priv_all': 'PrivilegesTableFields.tsx',
  'server/privileges/privileges_table.twig#max_connections': 'privileges.ts',
  'server/privileges/privileges_table.twig#max_questions': 'privileges.ts',
  'server/privileges/privileges_table.twig#max_updates': 'privileges.ts',
  'server/privileges/privileges_table.twig#max_user_connections': 'privileges.ts',
  'server/privileges/privileges_table.twig#ssl_cipher': 'PrivilegesTableFields.tsx',
  'server/privileges/privileges_table.twig#ssl_type': 'PrivilegesTableFields.tsx',
  'server/privileges/privileges_table.twig#submit:Update user privileges': 'PrivilegesTableFields.tsx',
  'server/privileges/privileges_table.twig#x509_issuer': 'PrivilegesTableFields.tsx',
  'server/privileges/privileges_table.twig#x509_subject': 'PrivilegesTableFields.tsx',
  // pma: resources/templates/server/privileges/subnav.twig
  'server/privileges/subnav.twig#link:User accounts overview': 'shared.tsx',
  'server/privileges/subnav.twig#link:User groups': 'shared.tsx',
  // pma: resources/templates/server/privileges/user_overview.twig
  'server/privileges/user_overview.twig#link:Add user account': 'UsersPage.tsx',
  // pma: resources/templates/server/privileges/user_properties.twig
  'server/privileges/user_properties.twig#mode': 'EditUserPage.tsx',
  'server/privileges/user_properties.twig#submit:Go': 'EditUserPage.tsx',
  // pma: resources/templates/server/privileges/users_overview.twig
  'server/privileges/users_overview.twig#button:Close': 'UsersPage.tsx',
  'server/privileges/users_overview.twig#button:Edit user group': 'UsersPage.tsx',
  'server/privileges/users_overview.twig#button:Unlock': 'UsersPage.tsx',
  'server/privileges/users_overview.twig#delete': 'UsersPage.tsx',
  'server/privileges/users_overview.twig#drop_users_db': 'UsersPage.tsx',
  'server/privileges/users_overview.twig#id:editUserGroupModalSaveButton': 'UsersPage.tsx',
  'server/privileges/users_overview.twig#id:usersForm_checkall': 'UsersPage.tsx',
  'server/privileges/users_overview.twig#link:Add user account': 'UsersPage.tsx',
  'server/privileges/users_overview.twig#link:Edit privileges': 'UsersPage.tsx',
  'server/privileges/users_overview.twig#link:Export': 'UsersPage.tsx',
  'server/privileges/users_overview.twig#selected_usr[]': 'UsersPage.tsx',
  'server/privileges/users_overview.twig#submit_mult': 'UsersPage.tsx',
  // pma: resources/templates/server/user_groups/edit_user_groups.twig
  'server/user_groups/edit_user_groups.twig#id:addUsersForm_checkall': 'UserGroupsPage.tsx',
  'server/user_groups/edit_user_groups.twig#submit:Add user group': 'UserGroupsPage.tsx',
  'server/user_groups/edit_user_groups.twig#userGroup': 'UserGroupsPage.tsx',
  // pma: resources/templates/server/user_groups/tab_list.twig
  'server/user_groups/tab_list.twig#*_*': { file: 'UserGroupsPage.tsx', match: '`${l.level}_${tab.tab}`' },
  // pma: resources/templates/server/user_groups/user_groups.twig
  'server/user_groups/user_groups.twig#button:Close': 'UserGroupsPage.tsx',
  'server/user_groups/user_groups.twig#button:Delete': 'UserGroupsPage.tsx',
  'server/user_groups/user_groups.twig#id:deleteUserGroupConfirm': 'UserGroupsPage.tsx',
  'server/user_groups/user_groups.twig#link:Add user group': 'UserGroupsPage.tsx',
  // pma: resources/templates/table/privileges/index.twig
  'table/privileges/index.twig#id:usersForm_checkall': 'TablePrivilegesPage.tsx',
  'table/privileges/index.twig#link:Add user account': 'TablePrivilegesPage.tsx',
  'table/privileges/index.twig#link:Edit privileges': 'TablePrivilegesPage.tsx',
  'table/privileges/index.twig#link:Export': 'TablePrivilegesPage.tsx',
  'table/privileges/index.twig#selected_usr[]': 'TablePrivilegesPage.tsx',
  'table/privileges/index.twig#submit_mult': 'TablePrivilegesPage.tsx',
  // pma: resources/js/server/privileges.ts, resources/js/server/user_groups.ts
  'js:server/privileges.ts#ajax:GET /server/user-groups/edit-form': {
    file: 'UsersPage.tsx',
    match: 'api.chooseUserGroup',
  },
  "js:server/privileges.ts#ajax:GET <$(this).attr('href')>": {
    file: 'shared.tsx',
    match: 'api.exportPrivileges',
  },
  'js:server/privileges.ts#ajax:GET <href>': {
    file: 'LoginInformationFields.tsx',
    match: 'api.validateUsername',
  },
  'js:server/privileges.ts#ajax:POST /server/privileges': {
    file: 'UsersPage.tsx',
    match: "changeUserGroup: '1'",
  },
  "js:server/privileges.ts#ajax:POST <$(this.form).prop('action')>": {
    file: 'UsersPage.tsx',
    match: 'selected_usr: sel',
  },
  'js:server/privileges.ts#ajax:POST <url>': { file: 'UsersPage.tsx', match: 'api.lockAccount' },
  'js:server/privileges.ts#alert:strHostEmpty': { file: 'privileges.ts', match: 'The host name is empty!' },
  'js:server/privileges.ts#alert:strUserEmpty': { file: 'privileges.ts', match: 'The user name is empty!' },
  "js:server/privileges.ts#change:#fieldset_add_user_login input[name='username']": {
    file: 'LoginInformationFields.tsx',
    match: 'checkUsername',
  },
  'js:server/privileges.ts#change:#select_authentication_plugin': {
    file: 'LoginInformationFields.tsx',
    match: 'setSha256',
  },
  'js:server/privileges.ts#change:#text_pma_change_pw': {
    file: 'EditUserPage.tsx',
    match: 'setNopass(false)',
  },
  'js:server/privileges.ts#change:#text_pma_change_pw2': {
    file: 'EditUserPage.tsx',
    match: 'setPw2(e.target.value)',
  },
  'js:server/privileges.ts#change:input[name="ssl_type"]': {
    file: 'PrivilegesTableFields.tsx',
    match: "disabled={sslType !== 'SPECIFIED'}",
  },
  'js:server/privileges.ts#click:#deleteUserCard .btn.ajax': {
    file: 'UsersPage.tsx',
    match: 'void remove()',
  },
  'js:server/privileges.ts#click:#insert_priv_all': {
    file: 'PrivilegesTableFields.tsx',
    match: 'data-select-target',
  },
  'js:server/privileges.ts#click:#references_priv_all': {
    file: 'PrivilegesTableFields.tsx',
    match: 'data-select-target',
  },
  'js:server/privileges.ts#click:#select_priv_all': {
    file: 'PrivilegesTableFields.tsx',
    match: 'data-select-target',
  },
  'js:server/privileges.ts#click:#update_priv_all': {
    file: 'PrivilegesTableFields.tsx',
    match: 'data-select-target',
  },
  'js:server/privileges.ts#click:<$subNav> a': { file: 'EditUserPage.tsx', match: 'setActive(i)' },
  'js:server/privileges.ts#click:<saveButton>': {
    file: 'UsersPage.tsx',
    match: 'editUserGroupModalSaveButton',
  },
  'js:server/privileges.ts#click:a.export_user_anchor.ajax': {
    file: 'UsersPage.tsx',
    match: 'exporter.run({ username',
  },
  'js:server/privileges.ts#click:button.jsAccountLocking': { file: 'UsersPage.tsx', match: 'lockToggle' },
  'js:server/privileges.ts#click:button.mult_submit[value=export]': {
    file: 'UsersPage.tsx',
    match: 'exporter.run({ selected_usr',
  },
  'js:server/privileges.ts#confirm:strDoYouReally+strDropDatabaseStrongWarning': {
    file: 'UsersPage.tsx',
    match: 'You are about to DESTROY a complete database!',
  },
  'js:server/privileges.ts#confirm:strDropUserWarning': {
    file: 'UsersPage.tsx',
    match: 'Do you really want to revoke the selected user(s) ?',
  },
  'js:server/privileges.ts#confirm:strPasswordEmptyWhenAllowNoPasswordIsEnabled': {
    file: 'EditUserPage.tsx',
    match: 'EMPTY_WITH_ALLOW_NO_PASSWORD_OFF',
  },
  'js:server/privileges.ts#input:#text_pma_pw': {
    file: 'LoginInformationFields.tsx',
    match: "setPredPw('userdefined')",
  },
  'js:server/privileges.ts#keyup:#text_pma_change_pw': {
    file: 'EditUserPage.tsx',
    match: 'void strength(e.target.value)',
  },
  'js:server/privileges.ts#keyup:#text_pma_pw': {
    file: 'LoginInformationFields.tsx',
    match: 'void strength(e.target.value)',
  },
  'js:server/privileges.ts#show.bs.modal:<editUserGroupModal>': {
    file: 'UsersPage.tsx',
    match: 'EditUserGroupModal',
  },
  'js:server/privileges.ts#shown:<modal>': { file: 'shared.tsx', match: 'exportPrivilegesModal' },
  'js:server/privileges.ts#submit:#addUsersForm': { file: 'AddUserPage.tsx', match: 'checkAddUser' },
  'js:server/privileges.ts#submit:#change_password_form': {
    file: 'EditUserPage.tsx',
    match: 'checkPassword(nopass',
  },
  'js:server/privileges.ts#submit:#copyUserForm': { file: 'EditUserPage.tsx', match: 'checkAddUser' },
  'js:server/user_groups.ts#ajax:POST /server/user-groups': {
    file: 'UserGroupsPage.tsx',
    match: "deleteUserGroup: 'true'",
  },
  'js:server/user_groups.ts#click:#deleteUserGroupConfirm': {
    file: 'UserGroupsPage.tsx',
    match: 'deleteUserGroupConfirm',
  },
  'js:server/user_groups.ts#show:<deleteUserGroupModal>': {
    file: 'UserGroupsPage.tsx',
    match: 'Do you really want to delete user group "%s"?',
  },
  'js:server/user_groups.ts#shown:<deleteUserGroupModal>': {
    file: 'UserGroupsPage.tsx',
    match: 'setRemove(g.name)',
  },
}
