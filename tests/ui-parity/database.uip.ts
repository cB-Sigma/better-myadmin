import { type PageSpec, pageParity } from './lib/parity.ts'

/**
 * The database-level pages (docs/features/05-database-level.md): Structure, Operations, Search,
 * Query, Routines, Events, Triggers, Tracking, Central columns, Data dictionary, Privileges.
 * Each case runs against its own copy of a small fixture database, `f05_uip`.
 */
const DB = 'f05_uip'
const SQL = `CREATE DATABASE IF NOT EXISTS ${DB};
CREATE TABLE IF NOT EXISTS ${DB}.parent (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, name VARCHAR(20)) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS ${DB}.child (id INT PRIMARY KEY, parent_id INT, FOREIGN KEY (parent_id) REFERENCES ${DB}.parent (id)) ENGINE=InnoDB;
CREATE OR REPLACE VIEW ${DB}.v AS SELECT id, name FROM ${DB}.parent;
DROP PROCEDURE IF EXISTS ${DB}.p1; CREATE PROCEDURE ${DB}.p1(IN x INT) SELECT x;
DROP EVENT IF EXISTS ${DB}.e1; CREATE EVENT ${DB}.e1 ON SCHEDULE EVERY 1 DAY DISABLE DO SELECT 1;
DROP TRIGGER IF EXISTS ${DB}.t_ins; CREATE TRIGGER ${DB}.t_ins BEFORE INSERT ON ${DB}.parent FOR EACH ROW SET NEW.name = UPPER(NEW.name);`

const db = (route: string, path: string, extra: Partial<PageSpec> = {}): PageSpec => ({
  sql: SQL,
  pma: { route, params: { db: DB } },
  ours: { path: `/s/1/db/${DB}/${path}` },
  ...extra,
})

pageParity(
  'db-structure',
  db('/database/structure', 'structure', {
    ready: { pma: '#tablesForm', ours: '#tablesForm' },
    interactions: [{ name: 'check all', do: { check: 'Check all' } }],
  }),
)
pageParity('db-operations', db('/database/operations', 'operations'))
pageParity('db-search', db('/database/search', 'search'))
pageParity('db-query', db('/database/multi-table-query', 'multi-table-query'))
pageParity(
  'db-routines',
  db('/database/routines', 'routines', {
    interactions: [{ name: 'create', do: { click: 'Create new routine' } }],
  }),
)
pageParity(
  'db-events',
  db('/database/events', 'events', { interactions: [{ name: 'create', do: { click: 'Create new event' } }] }),
)
pageParity(
  'db-triggers',
  db('/triggers', 'triggers', { interactions: [{ name: 'create', do: { click: 'Create new trigger' } }] }),
)
pageParity('table-triggers', {
  sql: SQL,
  pma: { route: '/triggers', params: { db: DB, table: 'parent' } },
  ours: { path: `/s/1/db/${DB}/t/parent/triggers` },
})
pageParity('db-tracking', db('/database/tracking', 'tracking'))
pageParity(
  'db-central-columns',
  db('/database/central-columns', 'central-columns', {
    interactions: [{ name: 'add new column', do: { click: 'Add new column' } }],
  }),
)
pageParity('db-data-dictionary', db('/database/data-dictionary', 'data-dictionary'))
pageParity('db-privileges', db('/database/privileges', 'privileges'))
