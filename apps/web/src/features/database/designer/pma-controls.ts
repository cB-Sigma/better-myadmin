/**
 * phpMyAdmin controls and Designer behaviours implemented in this folder (parity registry, read
 * statically by tools/parity; see docs/architecture/12-project-structure-and-conventions.md
 * "Parity markers").
 */

export const pmaControls = {
  // pma: resources/templates/database/designer/database_tables.twig
  'database/designer/database_tables.twig#id:select_all_*': {
    file: 'DesignerPage.tsx',
    match: 'id={`select_all_${index}`}',
  },
  'database/designer/database_tables.twig#id:select_*._*': {
    file: 'DesignerPage.tsx',
    match: 'id={`select_${x.key}._${c.name}`}',
  },
  // pma: resources/templates/database/designer/main.twig (side menu)
  'database/designer/main.twig#link:Show/Hide tables list': {
    file: 'DesignerPage.tsx',
    match: "'key_Show_left_menu'",
  },
  'database/designer/main.twig#link:View in fullscreen': {
    file: 'DesignerPage.tsx',
    match: "'toggleFullscreen'",
  },
  'database/designer/main.twig#link:Add tables from other databases': {
    file: 'DesignerPage.tsx',
    match: "'addOtherDbTables'",
  },
  'database/designer/main.twig#link:New page': { file: 'DesignerPage.tsx', match: "'newPage'" },
  'database/designer/main.twig#link:Open page': { file: 'DesignerPage.tsx', match: "'editPage'" },
  'database/designer/main.twig#link:Save page': { file: 'DesignerPage.tsx', match: "'savePos'" },
  'database/designer/main.twig#link:Save page as': { file: 'DesignerPage.tsx', match: "'SaveAs'" },
  'database/designer/main.twig#link:Delete pages': { file: 'DesignerPage.tsx', match: "'delPages'" },
  'database/designer/main.twig#link:Create table': { file: 'DesignerPage.tsx', match: "'StartTableNew'" },
  'database/designer/main.twig#link:Create relationship': { file: 'DesignerPage.tsx', match: "'rel_button'" },
  'database/designer/main.twig#link:Choose column to display': {
    file: 'DesignerPage.tsx',
    match: "'display_field_button'",
  },
  'database/designer/main.twig#link:Reload': { file: 'DesignerPage.tsx', match: "'reloadPage'" },
  'database/designer/main.twig#link:Help': { file: 'DesignerPage.tsx', match: "pmaDocUrl('faq', 'faq6-31')" },
  'database/designer/main.twig#link:Angular links': {
    file: 'DesignerPage.tsx',
    match: "'angular_direct_button'",
  },
  'database/designer/main.twig#link:Snap to grid': { file: 'DesignerPage.tsx', match: "'grid_button'" },
  'database/designer/main.twig#link:Small/Big All': { file: 'DesignerPage.tsx', match: "'key_SB_all'" },
  'database/designer/main.twig#link:Toggle small/big': {
    file: 'DesignerPage.tsx',
    match: "'SmallTabInvert'",
  },
  'database/designer/main.twig#link:Toggle relationship lines': {
    file: 'DesignerPage.tsx',
    match: "'relLineInvert'",
  },
  'database/designer/main.twig#link:Export schema': { file: 'DesignerPage.tsx', match: "'exportPages'" },
  'database/designer/main.twig#link:Build Query': { file: 'DesignerPage.tsx', match: "'build_query_button'" },
  'database/designer/main.twig#link:Move Menu': { file: 'DesignerPage.tsx', match: "'key_Left_Right'" },
  'database/designer/main.twig#link:Pin text': { file: 'DesignerPage.tsx', match: "'pin_Text'" },
  'database/designer/main.twig#link:Hide/Show all': { file: 'DesignerPage.tsx', match: "t('Hide/Show all')" },
  'database/designer/main.twig#link:Hide/Show tables with no relationship': {
    file: 'DesignerPage.tsx',
    match: "t('Hide/Show tables with no relationship')",
  },
  // relation panes
  'database/designer/main.twig#on_delete': { file: 'DesignerPage.tsx', match: 'RefOption id="on_delete"' },
  'database/designer/main.twig#on_update': { file: 'DesignerPage.tsx', match: 'RefOption id="on_update"' },
  'database/designer/main.twig#Button': { file: 'DesignerPage.tsx', match: 'name="Button"' },
  // query builder panes
  'database/designer/main.twig#rel_opt': { file: 'QueryBuilder.tsx', match: 'id="rel_opt"' },
  'database/designer/main.twig#id:Query': { file: 'QueryBuilder.tsx', match: 'id="Query"' },
  'database/designer/main.twig#id:new_name': { file: 'QueryBuilder.tsx', match: 'id="new_name"' },
  'database/designer/main.twig#operator': { file: 'QueryBuilder.tsx', match: 'id="operator"' },
  'database/designer/main.twig#id:groupby': { file: 'QueryBuilder.tsx', match: 'id="groupby"' },
  'database/designer/main.twig#orderby': { file: 'QueryBuilder.tsx', match: 'id="orderby"' },
  'database/designer/main.twig#h_operator': { file: 'QueryBuilder.tsx', match: 'id="h_operator"' },
  'database/designer/main.twig#h_rel_opt': { file: 'QueryBuilder.tsx', match: 'id="h_rel_opt"' },
  'database/designer/main.twig#id:having': { file: 'QueryBuilder.tsx', match: 'id="having"' },
  'database/designer/main.twig#id:e_rename': { file: 'QueryBuilder.tsx', match: 'id="e_rename"' },
  'database/designer/main.twig#hoperator': { file: 'QueryBuilder.tsx', match: 'id="hoperator"' },
  'database/designer/main.twig#hrel_opt': { file: 'QueryBuilder.tsx', match: 'id="hrel_opt"' },
  'database/designer/main.twig#id:hQuery': { file: 'QueryBuilder.tsx', match: 'id="hQuery"' },
  'database/designer/main.twig#erel_opt': { file: 'QueryBuilder.tsx', match: 'id="erel_opt"' },
  'database/designer/main.twig#id:eQuery': { file: 'QueryBuilder.tsx', match: 'id="eQuery"' },
  'database/designer/main.twig#link:Active options': {
    file: 'DesignerPage.tsx',
    match: "t('Active options')",
  },
  // modals
  'database/designer/main.twig#button:Cancel': { file: 'DesignerDialogs.tsx', match: "t('Cancel')" },
  'database/designer/main.twig#id:designerModalGoButton': {
    file: 'DesignerDialogs.tsx',
    match: 'id="designerModalGoButton"',
  },
  'database/designer/main.twig#id:designerModalYesButton': {
    file: 'DesignerDialogs.tsx',
    match: 'id="designerModalYesButton"',
  },
  'database/designer/main.twig#id:designerModalNoButton': {
    file: 'DesignerDialogs.tsx',
    match: 'id="designerModalNoButton"',
  },
  'database/designer/main.twig#button:Close': { file: 'QueryBuilder.tsx', match: "t('Close')" },
  'database/designer/main.twig#sql_query': { file: 'QueryBuilder.tsx', match: 'id="textSqlquery"' },
  'database/designer/main.twig#id:buildQuerySubmitButton': {
    file: 'QueryBuilder.tsx',
    match: 'id="buildQuerySubmitButton"',
  },
  // pma: page_save_as.twig, page_selector.twig, schema_export.twig
  'database/designer/page_save_as.twig#save_page': { file: 'DesignerDialogs.tsx', match: 'name="save_page"' },
  'database/designer/page_save_as.twig#selected_value': {
    file: 'DesignerDialogs.tsx',
    match: 'id="selected_value"',
  },
  'database/designer/page_selector.twig#selected_page': {
    file: 'DesignerDialogs.tsx',
    match: 'id="selected_page"',
  },
  'database/designer/schema_export.twig#export_type': {
    file: 'DesignerDialogs.tsx',
    match: 'name="export_type"',
  },

  // pma: resources/js/designer/history.ts
  'js:designer/history.ts#click:#buildQuerySubmitButton': {
    file: 'QueryBuilder.tsx',
    match: 'onSubmit(value)',
  },
  'js:designer/history.ts#shown:#buildQueryModal': {
    file: 'QueryBuilder.tsx',
    match: 'id="buildQueryModal"',
  },
  // pma: resources/js/designer/init.ts
  'js:designer/init.ts#ajaxStop:document': {
    file: 'DesignerDialogs.tsx',
    match: "onClick={() => setChoice('new')}",
  },
  'js:designer/init.ts#click:#selected_value': {
    file: 'DesignerDialogs.tsx',
    match: "onClick={() => setChoice('new')}",
  },
  'js:designer/init.ts#click:.trigger': { file: 'DesignerPage.tsx', match: 'setPanelOpen(!panelOpen)' },
  'js:designer/init.ts#click:#addOtherDbTables': {
    file: 'DesignerPage.tsx',
    match: "setDialog({ kind: 'addTable' })",
  },
  'js:designer/init.ts#click:#angular_direct_button': {
    file: 'DesignerPage.tsx',
    match: 'setAngular(!angular)',
  },
  'js:designer/init.ts#click:#build_query_button': { file: 'DesignerPage.tsx', match: 'runBuild' },
  'js:designer/init.ts#click:#query_builder': { file: 'DesignerPage.tsx', match: 'runBuild' },
  'js:designer/init.ts#click:#canvas': { file: 'DesignerPage.tsx', match: 'onClick={canvasClick}' },
  'js:designer/init.ts#click:#delPages': { file: 'DesignerPage.tsx', match: "setDialog({ kind: 'delete' })" },
  'js:designer/init.ts#click:#display_field_button': { file: 'DesignerPage.tsx', match: 'startDisplayField' },
  'js:designer/init.ts#click:#editPage': { file: 'DesignerPage.tsx', match: "setDialog({ kind: 'edit' })" },
  'js:designer/init.ts#click:#exportPages': {
    file: 'DesignerPage.tsx',
    match: "setDialog({ kind: 'export' })",
  },
  'js:designer/init.ts#click:#grid_button': { file: 'DesignerPage.tsx', match: 'setGrid(!grid)' },
  'js:designer/init.ts#click:#key_HS': { file: 'DesignerPage.tsx', match: 'onClick={noHaveConstr}' },
  'js:designer/init.ts#click:#key_HS_all': { file: 'DesignerPage.tsx', match: 'onClick={hideTabAll}' },
  'js:designer/init.ts#click:#key_Left_Right': { file: 'DesignerPage.tsx', match: 'setRight(!right)' },
  'js:designer/init.ts#click:#key_SB_all': { file: 'DesignerPage.tsx', match: 'smallTabAll,' },
  'js:designer/init.ts#click:#key_Show_left_menu': {
    file: 'DesignerPage.tsx',
    match: 'setLeftMenu((v) => !v)',
  },
  'js:designer/init.ts#click:#newPage': {
    file: 'DesignerPage.tsx',
    match: 'promptToSave(() => loadPage(-1))',
  },
  'js:designer/init.ts#click:#ok_edit_Aggr': { file: 'QueryBuilder.tsx', match: 'okId="ok_edit_Aggr"' },
  'js:designer/init.ts#click:#ok_edit_having': { file: 'QueryBuilder.tsx', match: 'okId="ok_edit_having"' },
  'js:designer/init.ts#click:#ok_edit_rename': { file: 'QueryBuilder.tsx', match: 'okId="ok_edit_rename"' },
  'js:designer/init.ts#click:#ok_edit_where': { file: 'QueryBuilder.tsx', match: 'okId="ok_edit_where"' },
  'js:designer/init.ts#click:#pin_Text': { file: 'DesignerPage.tsx', match: 'setPinned(!pinned)' },
  'js:designer/init.ts#click:#query_Aggregate_Button': {
    file: 'QueryBuilder.tsx',
    match: 'cancelId="query_Aggregate_Button"',
  },
  'js:designer/init.ts#click:#query_having_button': {
    file: 'QueryBuilder.tsx',
    match: 'cancelId="query_having_button"',
  },
  'js:designer/init.ts#click:#query_rename_to_button': {
    file: 'QueryBuilder.tsx',
    match: 'cancelId="query_rename_to_button"',
  },
  'js:designer/init.ts#click:#query_where_button': {
    file: 'QueryBuilder.tsx',
    match: 'cancelId="query_where_button"',
  },
  'js:designer/init.ts#click:#rel_button': { file: 'DesignerPage.tsx', match: 'startRelation, onRelation' },
  'js:designer/init.ts#click:#relLineInvert': { file: 'DesignerPage.tsx', match: 'setShowLines(!showLines)' },
  'js:designer/init.ts#click:#reloadPage': { file: 'DesignerPage.tsx', match: 'loadPage(selectedPage))' },
  'js:designer/init.ts#click:#SaveAs': { file: 'DesignerPage.tsx', match: "setDialog({ kind: 'saveAs' })" },
  'js:designer/init.ts#click:#savePos': { file: 'DesignerPage.tsx', match: 'save3()' },
  'js:designer/init.ts#click:#SmallTabInvert': {
    file: 'DesignerPage.tsx',
    match: 'collapsed: !x.collapsed })))',
  },
  'js:designer/init.ts#click:#StartTableNew': { file: 'DesignerPage.tsx', match: '/create-table`' },
  'js:designer/init.ts#click:#toggleFullscreen': { file: 'DesignerPage.tsx', match: 'toggleFullscreen,' },
  'js:designer/init.ts#click:input#cancel_button': {
    file: 'DesignerPage.tsx',
    match: 'onClick={() => setUpdRel(null)}',
  },
  'js:designer/init.ts#click:input#cancel_close_option': {
    file: 'QueryBuilder.tsx',
    match: 'cancelId="cancel_close_option"',
  },
  'js:designer/init.ts#click:input#cancel_new_rel_panel': {
    file: 'DesignerPage.tsx',
    match: 'onClick={() => setNewRel(null)}',
  },
  'js:designer/init.ts#click:input#del_button': {
    file: 'DesignerPage.tsx',
    match: 'onClick={removeRelation}',
  },
  'js:designer/init.ts#click:input#ok_add_object': { file: 'DesignerPage.tsx', match: 'onOk={optionAdd}' },
  'js:designer/init.ts#click:input#ok_new_rel_panel': {
    file: 'DesignerPage.tsx',
    match: 'onClick={newRelation}',
  },
  'js:designer/init.ts#fullscreenchange:document': { file: 'DesignerPage.tsx', match: "'fullscreenchange'" },
  'js:designer/init.ts#mouseenter:#side_menu': {
    file: 'DesignerPage.tsx',
    match: 'onMouseEnter={() => setHover(true)}',
  },
  'js:designer/init.ts#mouseleave:#side_menu': {
    file: 'DesignerPage.tsx',
    match: 'onMouseLeave={() => setHover(false)}',
  },
  // pma: resources/js/designer/move.ts
  'js:designer/move.ts#ajax:POST /database/designer': {
    file: 'DesignerPage.tsx',
    match: '.designerSavePage(',
  },
  'js:designer/move.ts#ajax:POST /sql': { file: 'DesignerDialogs.tsx', match: 'api.exportAliasNames' },
  "js:designer/move.ts#ajax:POST <$form.attr('action')>": {
    file: 'DesignerPage.tsx',
    match: '.designerDeletePage(',
  },
  'js:designer/move.ts#alert:strPleaseSelectPrimaryOrUniqueKey': {
    file: 'DesignerPage.tsx',
    match: "window.alert(t('Please select the primary key or a unique key!'))",
  },
  'js:designer/move.ts#change:#add_table_from': {
    file: 'DesignerDialogs.tsx',
    match: 'setDb(e.currentTarget.value)',
  },
  'js:designer/move.ts#change:<$formatDropDown>': {
    file: 'DesignerDialogs.tsx',
    match: 'setFormat(e.currentTarget.value)',
  },
  'js:designer/move.ts#click:#designerModalGoButton': {
    file: 'DesignerDialogs.tsx',
    match: 'onClick={onGo}',
  },
  'js:designer/move.ts#click:#designerModalNoButton': {
    file: 'DesignerDialogs.tsx',
    match: 'onClick={onNo}',
  },
  'js:designer/move.ts#click:#designerModalYesButton': {
    file: 'DesignerDialogs.tsx',
    match: 'onClick={onYes}',
  },
  'js:designer/move.ts#click:<$newTableLine> .designer_Tabs2,.designer_Tabs': {
    file: 'DesignerPage.tsx',
    match: 'onClick={() => selectTab(x.key)}',
  },
  'js:designer/move.ts#click:<$newTableLine> .scroll_tab_checkbox': {
    file: 'DesignerPage.tsx',
    match: 'visibleTab(x.key, e.currentTarget.checked)',
  },
  'js:designer/move.ts#click:<$newTableLine> .scroll_tab_struct': {
    file: 'DesignerPage.tsx',
    match: 'onClick={() => openStructure(x)}',
  },
  'js:designer/move.ts#click:<element> .select_all_1': {
    file: 'DesignerPage.tsx',
    match: 'onCheckAll(e.currentTarget.checked)',
  },
  'js:designer/move.ts#click:<element> .select_all_store_col': {
    file: 'DesignerPage.tsx',
    match: 'onCheck(c.name, e.currentTarget.checked)',
  },
  'js:designer/move.ts#click:<element> .small_tab_pref_1': {
    file: 'DesignerPage.tsx',
    match: 'onClick={onStructure}',
  },
  'js:designer/move.ts#click:<element> .small_tab_pref_click_opt': {
    file: 'DesignerPage.tsx',
    match: 'onOption(c.name, e)',
  },
  'js:designer/move.ts#click:<element> .small_tab,.small_tab2': {
    file: 'DesignerPage.tsx',
    match: 'onClick={onSmall}',
  },
  'js:designer/move.ts#click:<element> .tab_field_2,.tab_field_3,.tab_field': {
    file: 'DesignerPage.tsx',
    match: 'onClick={(e) => onField(c.name, e)}',
  },
  'js:designer/move.ts#hidden:<modal>': { file: 'DesignerDialogs.tsx', match: 'onClose={onClose}' },
  'js:designer/move.ts#mousedown:document': {
    file: 'DesignerPage.tsx',
    match: "addEventListener('mousedown'",
  },
  'js:designer/move.ts#mousemove:document': {
    file: 'DesignerPage.tsx',
    match: "addEventListener('mousemove'",
  },
  'js:designer/move.ts#mouseup:document': { file: 'DesignerPage.tsx', match: "addEventListener('mouseup'" },
  'js:designer/move.ts#mouseout:<element> .tab_zag_noquery': {
    file: 'DesignerPage.tsx',
    match: 'onMouseOut={() => setOver(false)}',
  },
  'js:designer/move.ts#mouseout:<element> .tab_zag_query': {
    file: 'DesignerPage.tsx',
    match: 'tab_zag_query',
  },
  'js:designer/move.ts#mouseover:<element> .tab_zag_noquery': {
    file: 'DesignerPage.tsx',
    match: 'onMouseOver={() => setOver(true)}',
  },
  'js:designer/move.ts#mouseover:<element> .tab_zag_query': {
    file: 'DesignerPage.tsx',
    match: 'tab_zag_query',
  },
  'js:designer/move.ts#submit:#save_as_pages': { file: 'DesignerDialogs.tsx', match: 'id="save_as_pages"' },
  'js:designer/move.ts#submit:<$form>': { file: 'DesignerDialogs.tsx', match: 'id="save_page"' },
}
