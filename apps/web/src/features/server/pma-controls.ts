/**
 * phpMyAdmin controls implemented in this folder (parity registry, read statically by tools/parity;
 * see docs/architecture/12-project-structure-and-conventions.md "Parity markers").
 */
export const pmaControls = {
  // pma: resources/templates/server/binlog/index.twig
  'server/binlog/index.twig#log': 'InfoPages.tsx',
  'server/binlog/index.twig#submit:Go': 'InfoPages.tsx',
  'server/binlog/index.twig#link:Previous': {
    file: 'InfoPages.tsx',
    match: "pgettext('Previous page', 'Previous')",
  },
  'server/binlog/index.twig#link:Next': { file: 'InfoPages.tsx', match: "pgettext('Next page', 'Next')" },
  'server/binlog/index.twig#link:Show full queries': 'InfoPages.tsx',
  'server/binlog/index.twig#link:Truncate shown queries': 'InfoPages.tsx',
  // pma: resources/templates/server/databases/index.twig
  'server/databases/index.twig#new_db': 'DatabasesPage.tsx',
  'server/databases/index.twig#db_collation': 'DatabasesPage.tsx',
  'server/databases/index.twig#id:buttonGo': 'DatabasesPage.tsx',
  'server/databases/index.twig#id:checkAllCheckbox': 'DatabasesPage.tsx',
  'server/databases/index.twig#submit_mult': {
    file: 'DatabasesPage.tsx',
    match: 'id="bulkActionDropButton"',
  },
  'server/databases/index.twig#filterText': 'DatabasesPage.tsx',
  'server/databases/index.twig#link:Database': {
    file: 'DatabasesPage.tsx',
    match: "sortHeader('SCHEMA_NAME', t('Database'))",
  },
  'server/databases/index.twig#link:Collation': {
    file: 'DatabasesPage.tsx',
    match: "sortHeader('DEFAULT_COLLATION_NAME', t('Collation'))",
  },
  'server/databases/index.twig#link:Ascending': 'DatabasesPage.tsx',
  'server/databases/index.twig#selected_dbs[]': 'DatabasesPage.tsx',
  "server/databases/index.twig#link:Jump to database '%s'": 'DatabasesPage.tsx',
  'server/databases/index.twig#link:Check privileges': 'DatabasesPage.tsx',
  'server/databases/index.twig#link:SQL': 'DatabasesPage.tsx',
  'server/databases/index.twig#link:Enable statistics': 'DatabasesPage.tsx',
  'server/databases/index.twig#button:Cancel': 'DatabasesPage.tsx',
  'server/databases/index.twig#id:dropDatabaseModalDropButton': 'DatabasesPage.tsx',
  // pma: resources/templates/server/status/base.twig
  'server/status/base.twig#link:Server': { file: 'StatusPages.tsx', match: "['', t('Server')]" },
  'server/status/base.twig#link:Processes': {
    file: 'StatusPages.tsx',
    match: "['processes', t('Processes')]",
  },
  'server/status/base.twig#link:Query statistics': {
    file: 'StatusPages.tsx',
    match: "['queries', t('Query statistics')]",
  },
  'server/status/base.twig#link:All status variables': {
    file: 'StatusPages.tsx',
    match: "['variables', t('All status variables')]",
  },
  'server/status/base.twig#link:Monitor': { file: 'StatusPages.tsx', match: "['monitor', t('Monitor')]" },
  'server/status/base.twig#link:Advisor': { file: 'StatusPages.tsx', match: "['advisor', t('Advisor')]" },
  // pma: resources/templates/server/status/advisor/index.twig
  'server/status/advisor/index.twig#button:Instructions': 'StatusPages.tsx',
  'server/status/advisor/index.twig#button:Close': {
    file: 'StatusPages.tsx',
    match: 'id="advisorInstructionsModal"',
  },
  // the accordion button of a fired rule (labelled by the rule's issue)
  'server/status/advisor/index.twig#button:L61': {
    file: 'StatusPages.tsx',
    match: 'aria-controls={`collapse${i + 1}`}',
  },
  // pma: resources/templates/server/status/variables/index.twig
  'server/status/variables/index.twig#filterText': 'StatusPages.tsx',
  'server/status/variables/index.twig#filterAlert': 'StatusPages.tsx',
  'server/status/variables/index.twig#filterCategory': 'StatusPages.tsx',
  'server/status/variables/index.twig#dontFormat': 'StatusPages.tsx',
  'server/status/variables/index.twig#submit:Refresh': {
    file: 'StatusPages.tsx',
    match: "value={t('Refresh')}",
  },
  // pma: resources/templates/server/engines/show.twig
  'server/engines/show.twig#link:Variables': 'InfoPages.tsx',
  // pma: resources/templates/server/replication/change_primary.twig
  'server/replication/change_primary.twig#username': 'ReplicationPage.tsx',
  'server/replication/change_primary.twig#pma_pw': 'ReplicationPage.tsx',
  'server/replication/change_primary.twig#hostname': 'ReplicationPage.tsx',
  'server/replication/change_primary.twig#text_port': 'ReplicationPage.tsx',
  'server/replication/change_primary.twig#id:confreplica_submit': 'ReplicationPage.tsx',
  // pma: resources/templates/server/replication/database_multibox.twig
  'server/replication/database_multibox.twig#db_select[]': 'ReplicationPage.tsx',
  'server/replication/database_multibox.twig#link:Select all': 'ReplicationPage.tsx',
  'server/replication/database_multibox.twig#link:Unselect all': 'ReplicationPage.tsx',
  // pma: resources/templates/server/replication/primary_add_replica_user.twig
  'server/replication/primary_add_replica_user.twig#pred_username': 'ReplicationPage.tsx',
  'server/replication/primary_add_replica_user.twig#username': 'ReplicationPage.tsx',
  'server/replication/primary_add_replica_user.twig#pred_hostname': 'ReplicationPage.tsx',
  'server/replication/primary_add_replica_user.twig#hostname': 'ReplicationPage.tsx',
  'server/replication/primary_add_replica_user.twig#pred_password': 'ReplicationPage.tsx',
  'server/replication/primary_add_replica_user.twig#pma_pw': 'ReplicationPage.tsx',
  'server/replication/primary_add_replica_user.twig#pma_pw2': 'ReplicationPage.tsx',
  'server/replication/primary_add_replica_user.twig#id:button_generate_password': 'ReplicationPage.tsx',
  'server/replication/primary_add_replica_user.twig#generated_pw': 'ReplicationPage.tsx',
  'server/replication/primary_add_replica_user.twig#id:adduser_submit': 'ReplicationPage.tsx',
  // pma: resources/templates/server/replication/primary_configuration.twig
  'server/replication/primary_configuration.twig#db_type': 'ReplicationPage.tsx',
  'server/replication/primary_configuration.twig#id:goButton': 'ReplicationPage.tsx',
  // pma: resources/templates/server/replication/primary_replication.twig
  'server/replication/primary_replication.twig#link:Show primary status': 'ReplicationPage.tsx',
  'server/replication/primary_replication.twig#link:Show connected replicas': 'ReplicationPage.tsx',
  'server/replication/primary_replication.twig#link:Add replica replication user': 'ReplicationPage.tsx',
  // pma: resources/templates/server/replication/replica_configuration.twig
  'server/replication/replica_configuration.twig#primary_connection': 'ReplicationPage.tsx',
  'server/replication/replica_configuration.twig#id:goButton': 'ReplicationPage.tsx',
  'server/replication/replica_configuration.twig#link:See replica status table': 'ReplicationPage.tsx',
  'server/replication/replica_configuration.twig#link:Control replica:': 'ReplicationPage.tsx',
  'server/replication/replica_configuration.twig#link:Reset replica': 'ReplicationPage.tsx',
  'server/replication/replica_configuration.twig#link:Start SQL Thread only': 'ReplicationPage.tsx',
  'server/replication/replica_configuration.twig#link:Start IO Thread only': 'ReplicationPage.tsx',
  'server/replication/replica_configuration.twig#link:Error management:': 'ReplicationPage.tsx',
  'server/replication/replica_configuration.twig#link:Skip current error': 'ReplicationPage.tsx',
  'server/replication/replica_configuration.twig#sr_replica_skip_error': 'ReplicationPage.tsx',
  'server/replication/replica_configuration.twig#link:Change or reconfigure primary server':
    'ReplicationPage.tsx',
  // pma: resources/templates/server/status/monitor/index.twig
  'server/status/monitor/index.twig#id:monitorPauseResumeButton': 'MonitorPage.tsx',
  'server/status/monitor/index.twig#button:Settings': 'MonitorPage.tsx',
  'server/status/monitor/index.twig#button:Instructions/Setup': 'MonitorPage.tsx',
  'server/status/monitor/index.twig#id:monitorAddNewChartButton': 'MonitorPage.tsx',
  'server/status/monitor/index.twig#id:monitorRearrangeChartButton': 'MonitorPage.tsx',
  'server/status/monitor/index.twig#id:monitorDoneRearrangeChartButton': 'MonitorPage.tsx',
  'server/status/monitor/index.twig#monitorChartRefreshRate': 'MonitorPage.tsx',
  'server/status/monitor/index.twig#monitorChartColumns': 'MonitorPage.tsx',
  'server/status/monitor/index.twig#button:Import': 'MonitorPage.tsx',
  'server/status/monitor/index.twig#button:Close': 'MonitorPage.tsx',
  'server/status/monitor/index.twig#file': 'MonitorPage.tsx',
  'server/status/monitor/index.twig#id:monitorImportConfigImportButton': 'MonitorPage.tsx',
  'server/status/monitor/index.twig#id:monitorExportConfigButton': 'MonitorPage.tsx',
  'server/status/monitor/index.twig#id:monitorResetConfigButton': 'MonitorPage.tsx',
  'server/status/monitor/index.twig#chartTitle': 'MonitorPage.tsx',
  'server/status/monitor/index.twig#chartType': 'MonitorPage.tsx',
  'server/status/monitor/index.twig#presetCharts': 'MonitorPage.tsx',
  'server/status/monitor/index.twig#varChartList': 'MonitorPage.tsx',
  'server/status/monitor/index.twig#variableInput': 'MonitorPage.tsx',
  'server/status/monitor/index.twig#differentialValue': 'MonitorPage.tsx',
  'server/status/monitor/index.twig#useDivisor': 'MonitorPage.tsx',
  'server/status/monitor/index.twig#valueDivisor': 'MonitorPage.tsx',
  'server/status/monitor/index.twig#link:KiB': 'MonitorPage.tsx',
  'server/status/monitor/index.twig#link:MiB': 'MonitorPage.tsx',
  'server/status/monitor/index.twig#useUnit': 'MonitorPage.tsx',
  'server/status/monitor/index.twig#valueUnit': 'MonitorPage.tsx',
  'server/status/monitor/index.twig#link:Add this series': 'MonitorPage.tsx',
  'server/status/monitor/index.twig#link:Clear series': 'MonitorPage.tsx',
  'server/status/monitor/index.twig#id:addChartButton': 'MonitorPage.tsx',
  'server/status/monitor/index.twig#id:closeModalButton': 'MonitorPage.tsx',
  'server/status/monitor/index.twig#dateStart': 'MonitorLogs.tsx',
  'server/status/monitor/index.twig#dateEnd': 'MonitorLogs.tsx',
  'server/status/monitor/index.twig#id:limitTypes': 'MonitorLogs.tsx',
  'server/status/monitor/index.twig#id:removeVariables': 'MonitorLogs.tsx',
  'server/status/monitor/index.twig#id:logAnalyseModalSlowLogButton': 'MonitorLogs.tsx',
  'server/status/monitor/index.twig#id:logAnalyseModalGeneralLogButton': 'MonitorLogs.tsx',
  'server/status/monitor/index.twig#id:sqlquery': 'MonitorLogs.tsx',
  'server/status/monitor/index.twig#id:queryAnalyzerModalAnalyseButton': 'MonitorLogs.tsx',
  'server/status/monitor/index.twig#button:Cancel request': 'MonitorLogs.tsx',
  'server/status/monitor/index.twig#id:analysingLogsLogDataLoadedModalJumpButton': 'MonitorLogs.tsx',
  'server/status/monitor/index.twig#id:serverResponseErrorModalReloadButton': 'MonitorPage.tsx',
  // pma: resources/templates/server/status/processes/index.twig
  'server/status/processes/index.twig#showExecuting': 'StatusPages.tsx',
  'server/status/processes/index.twig#submit:Refresh': 'StatusPages.tsx',
  'server/status/processes/index.twig#refreshRate': 'StatusPages.tsx',
  'server/status/processes/index.twig#link:Start auto refresh': 'StatusPages.tsx',
  // pma: resources/templates/server/status/processes/list.twig
  'server/status/processes/list.twig#link:Descending': 'StatusPages.tsx',
  'server/status/processes/list.twig#link:Truncate shown queries': 'StatusPages.tsx',
  'server/status/processes/list.twig#link:Kill': 'StatusPages.tsx',
  // pma: resources/templates/server/variables/index.twig
  'server/variables/index.twig#link:Save': 'VariablesPage.tsx',
  'server/variables/index.twig#link:Cancel': 'VariablesPage.tsx',
  'server/variables/index.twig#link:Edit': 'VariablesPage.tsx',
  // pma: resources/js/replication.ts
  'js:replication.ts#ajax:POST <url>': {
    file: 'ReplicationPage.tsx',
    match: "act.mutate({ action: 'reset', control: null })",
  },
  'js:replication.ts#change:#db_select': {
    file: 'ReplicationPage.tsx',
    match: 'setSelected([...e.target.selectedOptions].map((o) => o.value))',
  },
  'js:replication.ts#change:#db_type': {
    file: 'ReplicationPage.tsx',
    match: "setMode(e.target.value as 'all' | 'ign')",
  },
  'js:replication.ts#click:#db_reset_href': {
    file: 'ReplicationPage.tsx',
    match: 'id="db_reset_href" onClick={() => setSelected([])}',
  },
  'js:replication.ts#click:#db_select_href': {
    file: 'ReplicationPage.tsx',
    match: 'id="db_select_href" onClick={() => setSelected(databases)}',
  },
  'js:replication.ts#click:#primary_replicas_href': {
    file: 'ReplicationPage.tsx',
    match: 'setReplicas(!replicas)',
  },
  'js:replication.ts#click:#primary_status_href': {
    file: 'ReplicationPage.tsx',
    match: 'id="primary_status_href" onClick={() => setStatus(!status)}',
  },
  'js:replication.ts#click:#replica_control_href': {
    file: 'ReplicationPage.tsx',
    match: 'setControl(!control)',
  },
  'js:replication.ts#click:#replica_errormanagement_href': {
    file: 'ReplicationPage.tsx',
    match: 'setErrors(!errors)',
  },
  'js:replication.ts#click:#replica_status_href': {
    file: 'ReplicationPage.tsx',
    match: 'id="replica_status_href" onClick={() => setStatus(!status)}',
  },
  'js:replication.ts#click:#reset_replica': { file: 'ReplicationPage.tsx', match: 'id="reset_replica"' },
  "js:replication.ts#click:<$('#button_generate_password') as JQuer…>": {
    file: 'ReplicationPage.tsx',
    match: 'id="button_generate_password"',
  },
  'js:replication.ts#confirm:strResetReplicaWarning': {
    file: 'ReplicationPage.tsx',
    match: "question: t('Do you really want to reset the replica (RESET REPLICA)?')",
  },
  // pma: resources/js/server/databases.ts
  'js:server/databases.ts#ajax:GET <dbStructUrl>': {
    file: 'DatabasesPage.tsx',
    match: 'void navigate({ to: `/s/${server}/db/${encodeURIComponent(r.db)}',
  },
  "js:server/databases.ts#ajax:POST <$form.attr('action')>": {
    file: 'DatabasesPage.tsx',
    match: 'api.createDatabase(server, v.name, v.collation)',
  },
  'js:server/databases.ts#ajax:POST <parts[0]>': {
    file: 'DatabasesPage.tsx',
    match: 'api.dropDatabases(server, names)',
  },
  'js:server/databases.ts#alert:strFormEmpty': {
    file: 'DatabasesPage.tsx',
    match: "window.alert(t('Missing value in the form!'))",
  },
  'js:server/databases.ts#click:#dropDatabaseModalDropButton': {
    file: 'DatabasesPage.tsx',
    match: 'drop.mutate(confirm)',
  },
  'js:server/databases.ts#submit:#create_database_form.ajax': {
    file: 'DatabasesPage.tsx',
    match: 'create.mutate({ name, collation',
  },
  'js:server/databases.ts#submit:#dbStatsForm': {
    file: 'DatabasesPage.tsx',
    match: 'setConfirm([...selected])',
  },
  // pma: resources/js/server/status/monitor.ts
  'js:server/status/monitor.ts#ajax:POST /server/status/monitor/chart': {
    file: 'MonitorPage.tsx',
    match: 'api.monitorChart(server, requiredData, abort.signal)',
  },
  'js:server/status/monitor.ts#ajax:POST /server/status/monitor/log-vars': {
    file: 'MonitorLogs.tsx',
    match: 'api.monitorLogVars(server, v)',
  },
  'js:server/status/monitor.ts#ajax:POST /server/status/monitor/query': {
    file: 'MonitorLogs.tsx',
    match: "api.monitorQuery(server, row?.db ?? '', query)",
  },
  'js:server/status/monitor.ts#ajax:POST <url>': { file: 'MonitorLogs.tsx', match: 'api.monitorLog(' },
  'js:server/status/monitor.ts#alert:strAddOneSeriesWarning': {
    file: 'MonitorPage.tsx',
    match: "window.alert(t('Please add at least one variable to the series!'))",
  },
  'js:server/status/monitor.ts#alert:strFailedBuildingGrid': {
    file: 'MonitorPage.tsx',
    match: "window.alert(t('Failed building chart grid with imported config. Resetting to default config…'))",
  },
  'js:server/status/monitor.ts#alert:strFailedParsingConfig': {
    file: 'MonitorPage.tsx',
    match: 'window.alert(t("Failed parsing config file. It doesn\'t seem to be valid JSON code."))',
  },
  'js:server/status/monitor.ts#change:#chartSeries': { file: 'MonitorPage.tsx', match: 'setListIndex(i)' },
  'js:server/status/monitor.ts#change:#noWHEREData': {
    file: 'MonitorLogs.tsx',
    match: 'setGroup(e.target.checked)',
  },
  "js:server/status/monitor.ts#change:<$('#monitorChartColumnsSelect') as JQue…>": {
    file: 'MonitorPage.tsx',
    match: 'changeColumns(Number(e.target.value))',
  },
  "js:server/status/monitor.ts#change:<$('#monitorChartRefreshRateSelect') as …>": {
    file: 'MonitorPage.tsx',
    match: 'gridRefresh: Number(e.target.value) * 1000',
  },
  'js:server/status/monitor.ts#change:<$(\'input[name="chartType"]\') as JQuery<…>': {
    file: 'MonitorPage.tsx',
    match: "changeType('chartStatusVar')",
  },
  'js:server/status/monitor.ts#change:<$(\'input[name="useDivisor"]\') as JQuery…>': {
    file: 'MonitorPage.tsx',
    match: 'setUseDivisor(e.target.checked)',
  },
  'js:server/status/monitor.ts#change:<$(\'input[name="useUnit"]\') as JQuery<HT…>': {
    file: 'MonitorPage.tsx',
    match: 'setUseUnit(e.target.checked)',
  },
  'js:server/status/monitor.ts#change:<$(\'select[name="varChartList"]\') as JQu…>': {
    file: 'MonitorPage.tsx',
    match: 'if (i !== 0) setVariable(e.target.value)',
  },
  'js:server/status/monitor.ts#change:<$presetList>': {
    file: 'MonitorPage.tsx',
    match: "setTitle(presets[e.target.value]?.title ?? '')",
  },
  'js:server/status/monitor.ts#click:#addChartButton': {
    file: 'MonitorPage.tsx',
    match: 'onAdd(structuredClone({ ...chart, title }))',
  },
  'js:server/status/monitor.ts#click:#chartPreset': {
    file: 'MonitorPage.tsx',
    match: 'onClick={() => setTitle(presets[preset]?.title ?? title)}',
  },
  'js:server/status/monitor.ts#click:#chartStatusVar': {
    file: 'MonitorPage.tsx',
    match: "onClick={() => setTitle(selectedSeries.replaceAll('_', ' '))}",
  },
  'js:server/status/monitor.ts#click:#closeModalButton': {
    file: 'MonitorPage.tsx',
    match: 'id="closeModalButton" onClick={close}',
  },
  'js:server/status/monitor.ts#click:#monitorAddNewChartButton': {
    file: 'MonitorPage.tsx',
    match: 'id="monitorAddNewChartButton" onClick={() => setModal(\'addChart\')}',
  },
  'js:server/status/monitor.ts#click:#monitorDoneRearrangeChartButton': {
    file: 'MonitorPage.tsx',
    match: 'id="monitorDoneRearrangeChartButton"',
  },
  'js:server/status/monitor.ts#click:#monitorExportConfigButton': {
    file: 'MonitorPage.tsx',
    match: 'id="monitorExportConfigButton" onClick={exportJson}',
  },
  'js:server/status/monitor.ts#click:#monitorPauseResumeButton': {
    file: 'MonitorPage.tsx',
    match: 'setRedraw(!redraw)',
  },
  'js:server/status/monitor.ts#click:#monitorRearrangeChartButton': {
    file: 'MonitorPage.tsx',
    match: 'id="monitorRearrangeChartButton" onClick={() => setEditMode(true)}',
  },
  'js:server/status/monitor.ts#click:#monitorResetConfigButton': {
    file: 'MonitorPage.tsx',
    match: 'clearStored(storage())',
  },
  'js:server/status/monitor.ts#click:#queryAnalyzerDialog div.placeHolder a[href*="#showExplain"]': {
    file: 'MonitorLogs.tsx',
    match: 'data-href={`#showExplain-${i}`}',
  },
  'js:server/status/monitor.ts#click:#queryAnalyzerDialog div.placeHolder a[href="#showChart"]': {
    file: 'MonitorLogs.tsx',
    match: 'data-href="#showChart"',
  },
  'js:server/status/monitor.ts#click:#queryAnalyzerDialog div.placeHolder a[href="#showNums"]': {
    file: 'MonitorLogs.tsx',
    match: 'data-href="#showNums"',
  },
  'js:server/status/monitor.ts#click:#startFilterQueryText': {
    file: 'MonitorLogs.tsx',
    match: 'onClick={() => setApplied(text)}',
  },
  'js:server/status/monitor.ts#click:<$dialog> a.set': {
    file: 'MonitorLogs.tsx',
    match: 'set.mutate({ varName, varValue })',
  },
  'js:server/status/monitor.ts#click:<$tCell>': { file: 'MonitorLogs.tsx', match: 'onAnalyze(r.row)' },
  'js:server/status/monitor.ts#click:<analysingLogsLogDataLoadedModalJumpButt…>': {
    file: 'MonitorLogs.tsx',
    match: 'id="analysingLogsLogDataLoadedModalJumpButton"',
  },
  'js:server/status/monitor.ts#click:<logAnalyseModalGeneralLogButton>': {
    file: 'MonitorLogs.tsx',
    match: "void load('general')",
  },
  'js:server/status/monitor.ts#click:<logAnalyseModalSlowLogButton>': {
    file: 'MonitorLogs.tsx',
    match: "void load('slow')",
  },
  'js:server/status/monitor.ts#click:<monitorImportConfigImportButton>': {
    file: 'MonitorPage.tsx',
    match: 'id="monitorImportConfigImportButton"',
  },
  'js:server/status/monitor.ts#click:<queryAnalyzerModalAnalyseButton>': {
    file: 'MonitorLogs.tsx',
    match: 'onClick={() => analyse.mutate()}',
  },
  'js:server/status/monitor.ts#click:<serverResponseErrorModalReloadButton>': {
    file: 'MonitorPage.tsx',
    match: 'window.location.reload()',
  },
  'js:server/status/monitor.ts#click:a[href="#kibDivisor"]': {
    file: 'MonitorPage.tsx',
    match: "setDivisor('1024')",
  },
  'js:server/status/monitor.ts#click:a[href="#mibDivisor"]': {
    file: 'MonitorPage.tsx',
    match: 'setDivisor(String(1024 * 1024))',
  },
  'js:server/status/monitor.ts#click:a[href="#submitAddSeries"]': {
    file: 'MonitorPage.tsx',
    match: 'newSeriesNode(variable, {',
  },
  'js:server/status/monitor.ts#click:a[href="#submitClearSeries"]': {
    file: 'MonitorPage.tsx',
    match: 'id="clearSeriesLink"',
  },
  'js:server/status/monitor.ts#hidden.bs.modal:<analysingLogsLogDataLoadedModal>': {
    file: 'MonitorLogs.tsx',
    match: 'setSummary(false)',
  },
  'js:server/status/monitor.ts#hidden.bs.modal:<analysingLogsModal>': {
    file: 'MonitorLogs.tsx',
    match: 'id="analysingLogsModal"',
  },
  'js:server/status/monitor.ts#hidden.bs.modal:<logAnalyseModal>': {
    file: 'MonitorPage.tsx',
    match: 'onClose={() => setAnalyse(null)}',
  },
  'js:server/status/monitor.ts#hidden.bs.modal:<monitorImportConfigModal>': {
    file: 'MonitorPage.tsx',
    match: 'id="monitorImportConfigModal"',
  },
  'js:server/status/monitor.ts#hidden.bs.modal:<queryAnalyzerModal>': {
    file: 'MonitorLogs.tsx',
    match: 'analyse.reset()',
  },
  'js:server/status/monitor.ts#keyup:#filterQueryText': {
    file: 'MonitorLogs.tsx',
    match: 'text: button ? applied : text',
  },
  'js:server/status/monitor.ts#shown.bs.modal:<analysingLogsLogDataLoadedModal>': {
    file: 'MonitorLogs.tsx',
    match: 'id="analysingLogsLogDataLoadedModal"',
  },
  'js:server/status/monitor.ts#shown.bs.modal:<logAnalyseModal>': {
    file: 'MonitorLogs.tsx',
    match: 'id="logAnalyseModal"',
  },
  'js:server/status/monitor.ts#shown.bs.modal:<monitorImportConfigModal>': {
    file: 'MonitorPage.tsx',
    match: "setModal('import')",
  },
  'js:server/status/monitor.ts#shown.bs.modal:<monitorInstructionsModal>': {
    file: 'MonitorLogs.tsx',
    match: 'queryKey: qk.monitorLogVars(server)',
  },
  'js:server/status/monitor.ts#shown.bs.modal:<queryAnalyzerModal>': {
    file: 'MonitorLogs.tsx',
    match: 'setQuery(row.argument ?? row.sql_text ??',
  },
  // pma: resources/js/server/status/processes.ts
  "js:server/status/processes.ts#ajax:POST <$(this).attr('href')>": {
    file: 'StatusPages.tsx',
    match: 'api.killProcess(server, id)',
  },
  'js:server/status/processes.ts#ajax:POST <processList.refreshUrl>': {
    file: 'StatusPages.tsx',
    match: 'refetchInterval: auto ? rate * 1000 : false',
  },
  'js:server/status/processes.ts#change:#id_refreshRate': {
    file: 'StatusPages.tsx',
    match: 'setRate(Number(e.target.value))',
  },
  'js:server/status/processes.ts#click:#tableprocesslist a.kill_process': {
    file: 'StatusPages.tsx',
    match: 'kill.mutate(p.id)',
  },
  'js:server/status/processes.ts#click:#tableprocesslist thead a': {
    file: 'StatusPages.tsx',
    match: 'onSearch({ order_by_field: c.orderByField',
  },
  'js:server/status/processes.ts#click:a#toggleRefresh': { file: 'StatusPages.tsx', match: 'setAuto(!auto)' },
  // pma: resources/js/server/status/variables.ts
  'js:server/status/variables.ts#change:#filterCategory': {
    file: 'StatusPages.tsx',
    match: 'setCategory(e.target.value)',
  },
  "js:server/status/variables.ts#change:<$('#dontFormat') as JQuery<HTMLInputEle…>": {
    file: 'StatusPages.tsx',
    match: 'setRaw(e.target.checked)',
  },
  "js:server/status/variables.ts#change:<$('#filterAlert') as JQuery<HTMLInputEl…>": {
    file: 'StatusPages.tsx',
    match: 'setAlertOnly(e.target.checked)',
  },
  'js:server/status/variables.ts#keyup:#filterText': {
    file: 'StatusPages.tsx',
    match: 'setText(e.target.value)',
  },
  // pma: resources/js/server/variables.ts
  'js:server/variables.ts#ajax:GET /server/variables/get/': {
    file: 'VariablesPage.tsx',
    match: 'api.serverVariable(server, v.name)',
  },
  'js:server/variables.ts#ajax:POST /server/variables/set/': {
    file: 'VariablesPage.tsx',
    match: 'api.setVariable(server, v.name, editing)',
  },
  'js:server/variables.ts#click:<$myCancelLink>': {
    file: 'VariablesPage.tsx',
    match: 'onClick={() => setEditing(null)}',
  },
  'js:server/variables.ts#click:<$mySaveLink>': { file: 'VariablesPage.tsx', match: 'onClick={save}' },
  'js:server/variables.ts#click:a.editLink': { file: 'VariablesPage.tsx', match: 'onClick={startEdit}' },
  'js:server/variables.ts#keydown:<$valueCell> input': {
    file: 'VariablesPage.tsx',
    match: "e.key === 'Escape'",
  },
}
