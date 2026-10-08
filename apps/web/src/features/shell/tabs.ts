import {
  Activity,
  CaseSensitive,
  Cog,
  Database,
  Download,
  FileCode2,
  type LucideIcon,
  Puzzle,
  Repeat,
  Shield,
  Table2,
  Upload,
  Variable,
  Wrench,
} from 'lucide-react'

export interface TabDef {
  key: string
  text: string
  icon: LucideIcon
  /** path below /s/$server */
  path: string
}

/**
 * Server-scope tabs in phpMyAdmin's order (src/Menu.php::getServerTabs, docs/features/01 Menu tabs matrix).
 * Visibility rules (User accounts, Binary log, Replication) need server capabilities and arrive with M1.
 */
export const SERVER_TABS: TabDef[] = [
  { key: 'databases', text: 'Databases', icon: Database, path: 'databases' },
  { key: 'sql', text: 'SQL', icon: FileCode2, path: 'sql' },
  { key: 'status', text: 'Status', icon: Activity, path: 'status' },
  { key: 'rights', text: 'User accounts', icon: Shield, path: 'privileges' },
  { key: 'export', text: 'Export', icon: Download, path: 'export' },
  { key: 'import', text: 'Import', icon: Upload, path: 'import' },
  { key: 'settings', text: 'Settings', icon: Wrench, path: 'settings' },
  { key: 'binlog', text: 'Binary log', icon: Table2, path: 'binlog' },
  { key: 'replication', text: 'Replication', icon: Repeat, path: 'replication' },
  { key: 'vars', text: 'Variables', icon: Variable, path: 'variables' },
  { key: 'charset', text: 'Charsets', icon: CaseSensitive, path: 'collations' },
  { key: 'engine', text: 'Engines', icon: Cog, path: 'engines' },
  { key: 'plugins', text: 'Plugins', icon: Puzzle, path: 'plugins' },
]
