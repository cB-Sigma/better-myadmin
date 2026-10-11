/**
 * Path rules that attribute a changed phpMyAdmin file to a BetterMyAdmin feature doc and a kind of change.
 * First match wins. Keep in sync with docs/features/* when areas move.
 */
export type Kind = 'behaviour' | 'translations' | 'dependencies' | 'tooling' | 'tests' | 'docs'

export interface Rule {
  re: RegExp
  area: string
  kind: Kind
}

const F = {
  shell: 'features/01-shell-navigation-auth',
  browse: 'features/02-browse-results-grid',
  insert: 'features/03-insert-edit-transformations',
  table: 'features/04-table-level',
  database: 'features/05-database-level',
  server: 'features/06-server-level',
  exim: 'features/07-export-import',
  settings: 'features/08-settings-preferences-pmadb',
  sql: 'features/09-sql-editor-query-pipeline',
} as const

export const RULES: Rule[] = [
  { re: /^resources\/po\//, area: 'i18n', kind: 'translations' },
  { re: /^(composer\.(json|lock)|package\.json|yarn\.lock)$/, area: 'dependencies', kind: 'dependencies' },
  { re: /^(tests\/|phpunit|infection|jest\.config)/, area: 'tests', kind: 'tests' },
  { re: /^(docs\/|README|CHANGELOG|ChangeLog)/, area: 'docs', kind: 'docs' },
  {
    re: /^(\.github\/|bin\/|scripts\/|phpstan|psalm|phpcs|\.phpstorm|babel|\.eslintrc|\.stylelintrc|webpack|\.editorconfig|\.gitattributes|\.gitignore|codecov)/,
    area: 'tooling',
    kind: 'tooling',
  },
  { re: /^src\/(Navigation|Controllers\/Navigation|Server\/Select)/, area: F.shell, kind: 'behaviour' },
  {
    re: /^src\/(Plugins\/Auth|Plugins\/TwoFactor|TwoFactor|Controllers\/Home|Theme|I18n|Header|Footer|Menu|Console|Controllers\/Console|Controllers\/Logout|IpAllowDeny|Session|Http)/,
    area: F.shell,
    kind: 'behaviour',
  },
  {
    re: /^src\/(Display\/Results|Controllers\/Sql\/(?!SqlController)|Controllers\/Table\/GetFieldController)/,
    area: F.browse,
    kind: 'behaviour',
  },
  {
    re: /^src\/(InsertEdit|Controllers\/Table\/(Change|Replace|Delete)|Plugins\/Transformations|Transformations|Controllers\/Transformation|Gis|Controllers\/Gis|Controllers\/BrowseForeigners)/,
    area: F.insert,
    kind: 'behaviour',
  },
  {
    re: /^src\/(Controllers\/(Table|View)|Table\/|Index|Partitioning|CreateAddField|Normalization|Controllers\/Normalization|Tracking|Triggers|Controllers\/Triggers|Charsets|Types)/,
    area: F.table,
    kind: 'behaviour',
  },
  {
    re: /^src\/(Controllers\/Database|Database\/|Bookmarks|ConfigStorage\/.*Designer|Query\/Generator)/,
    area: F.database,
    kind: 'behaviour',
  },
  {
    re: /^src\/(Controllers\/Server|Server\/|Advisory|Replication|Engines|StorageEngine|Plugins\.php|UserPrivileges)/,
    area: F.server,
    kind: 'behaviour',
  },
  {
    re: /^src\/(Export|Import|Plugins\/(Export|Import|Schema)|Controllers\/(Export|Import)|Encoding|Zip|File)/,
    area: F.exim,
    kind: 'behaviour',
  },
  {
    re: /^src\/(Config|ConfigStorage|UserPreferences|Controllers\/Preferences|Controllers\/Setup|Setup)/,
    area: F.settings,
    kind: 'behaviour',
  },
  {
    re: /^src\/(Sql|ParseAnalyze|StatementInfo|SqlQueryForm|Linter|Controllers\/(Sql|Lint|Import\/SimulateDml)|Html\/Generator|Profiling|Utils\/ForeignKey|Console\/History)/,
    area: F.sql,
    kind: 'behaviour',
  },
  {
    re: /^resources\/templates\/(navigation|home|login|menu|console|header|footer|error|themes)/,
    area: F.shell,
    kind: 'behaviour',
  },
  { re: /^resources\/templates\/(display\/results|sql\/(?!query))/, area: F.browse, kind: 'behaviour' },
  {
    re: /^resources\/templates\/(table\/(insert|change|gis)|transformations)/,
    area: F.insert,
    kind: 'behaviour',
  },
  {
    re: /^resources\/templates\/(table|view|columns_definitions|indexes|triggers)\//,
    area: F.table,
    kind: 'behaviour',
  },
  { re: /^resources\/templates\/database\//, area: F.database, kind: 'behaviour' },
  { re: /^resources\/templates\/server\//, area: F.server, kind: 'behaviour' },
  { re: /^resources\/templates\/(export|import)/, area: F.exim, kind: 'behaviour' },
  { re: /^resources\/templates\/(preferences|config|setup)/, area: F.settings, kind: 'behaviour' },
  { re: /^resources\/templates\/sql\/query/, area: F.sql, kind: 'behaviour' },
  {
    re: /^resources\/js\/(navigation|modules\/navigation|console|modules\/console|keyhandler|shortcuts|ajax|modules\/ajax|functions|modules\/functions)/,
    area: F.shell,
    kind: 'behaviour',
  },
  { re: /^resources\/js\/(makegrid|sql|modules\/sql)/, area: F.sql, kind: 'behaviour' },
  { re: /^resources\/js\/(table|indexes|normalization)/, area: F.table, kind: 'behaviour' },
  { re: /^resources\/js\/(database|designer)/, area: F.database, kind: 'behaviour' },
  { re: /^resources\/js\/server/, area: F.server, kind: 'behaviour' },
  { re: /^resources\/js\/(export|import)/, area: F.exim, kind: 'behaviour' },
  { re: /^public\/themes\//, area: F.shell, kind: 'behaviour' },
  { re: /^resources\/sql\//, area: F.settings, kind: 'behaviour' },
  { re: /^app\//, area: F.shell, kind: 'behaviour' },
  { re: /^(src|resources|public)\//, area: 'unclassified', kind: 'behaviour' },
]

export function classify(path: string): { area: string; kind: Kind } {
  for (const r of RULES) if (r.re.test(path)) return { area: r.area, kind: r.kind }
  return { area: 'tooling', kind: 'tooling' }
}
