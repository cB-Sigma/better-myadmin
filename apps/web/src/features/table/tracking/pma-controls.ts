/**
 * phpMyAdmin controls implemented in this folder (parity registry, read statically by tools/parity;
 * see docs/architecture/12-project-structure-and-conventions.md 'Parity markers').
 * pma: resources/templates/table/tracking/main.twig, resources/templates/create_tracking_version.twig,
 *      resources/templates/table/tracking/report_table.twig, resources/js/table/tracking.ts
 */
const statement = { file: 'TrackingPage.tsx', match: "name={s.toLowerCase().replace(' ', '_')}" }

export const pmaControls = {
  'create_tracking_version.twig#alter_table': statement,
  'create_tracking_version.twig#rename_table': statement,
  'create_tracking_version.twig#create_table': statement,
  'create_tracking_version.twig#drop_table': statement,
  'create_tracking_version.twig#alter_view': statement,
  'create_tracking_version.twig#create_view': statement,
  'create_tracking_version.twig#drop_view': statement,
  'create_tracking_version.twig#create_index': statement,
  'create_tracking_version.twig#drop_index': statement,
  'create_tracking_version.twig#insert': statement,
  'create_tracking_version.twig#update': statement,
  'create_tracking_version.twig#delete': statement,
  'create_tracking_version.twig#truncate': statement,
  'create_tracking_version.twig#submit:Create version': 'TrackingPage.tsx',
  'table/tracking/main.twig#table': 'TrackingPage.tsx',
  'table/tracking/main.twig#selected_versions[]': 'TrackingPage.tsx',
  'table/tracking/main.twig#link:Delete version': 'TrackingPage.tsx',
  'table/tracking/main.twig#link:Tracking report': 'TrackingPage.tsx',
  'table/tracking/main.twig#link:Structure snapshot': 'TrackingPage.tsx',
  'table/tracking/main.twig#submit_mult': 'TrackingPage.tsx',
  'table/tracking/main.twig#submit:L113': { file: 'TrackingPage.tsx', match: "t('Deactivate now')" },
  "js:table/tracking.ts#ajax:POST <$form.attr('action')>": 'TrackingPage.tsx',
  'js:table/tracking.ts#ajax:POST <url>': 'TrackingPage.tsx',
  'js:table/tracking.ts#click:#versionsForm.ajax button[name="submit_mult"], #versionsForm.ajax input[name="submit_mult"]':
    'TrackingPage.tsx',
  'js:table/tracking.ts#click:a.delete_entry_anchor.ajax': 'TrackingPage.tsx',
  'js:table/tracking.ts#click:a.delete_version_anchor.ajax': 'TrackingPage.tsx',
  'js:table/tracking.ts#confirm:strDeleteTrackingVersion': 'TrackingPage.tsx',
  'js:table/tracking.ts#confirm:strDeleteTrackingVersionMultiple': 'TrackingPage.tsx',
  'js:table/tracking.ts#confirm:strDeletingTrackingEntry': 'TrackingPage.tsx',
} as const
