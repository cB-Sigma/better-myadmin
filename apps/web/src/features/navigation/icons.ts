import {
  CalendarClock,
  Columns3,
  Database,
  DatabaseZap,
  Eye,
  FileCode,
  Folder,
  Key,
  KeyRound,
  ListOrdered,
  type LucideIcon,
  Plus,
  Search,
  SquareFunction,
  Table,
  Table2,
  TableProperties,
  Zap,
} from 'lucide-react'

/** phpMyAdmin icon names used by the navigation (docs/architecture/09-ui-design-system.md#iconography). */
const MAP: Record<string, LucideIcon> = {
  s_db: Database,
  b_newdb: DatabaseZap,
  b_browse: Table,
  s_tbl: Table2,
  b_props: TableProperties,
  b_sql: FileCode,
  b_search: Search,
  b_insrow: Plus,
  b_table_add: Plus,
  b_views: Eye,
  b_view_add: Plus,
  b_routines: SquareFunction,
  b_routine_add: Plus,
  b_events: CalendarClock,
  b_event_add: Plus,
  b_triggers: Zap,
  b_trigger_add: Plus,
  b_index: ListOrdered,
  b_index_add: Plus,
  b_primary: Key,
  bd_primary: KeyRound,
  pause: Columns3,
  b_column_add: Plus,
  b_group: Folder,
}

export function navIcon(image: string): LucideIcon {
  return MAP[image] ?? Table2
}
