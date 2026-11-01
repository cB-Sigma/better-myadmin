/**
 * Database → Diagram: the automatic, read-only ER diagram (BetterMyAdmin-only, parity exception X63;
 * docs/features/05-database-level.md). One compact payload for the whole database: what the logged-in
 * user can see of its tables, views, columns, keys and relations.
 */

export interface ErColumn {
  name: string
  /** COLUMN_TYPE (`int(11) unsigned`, `varchar(64)`, `enum('a','b')`) */
  type: string
  /** IS_NULLABLE = YES */
  nullable: boolean
  /** part of the PRIMARY KEY */
  pk: boolean
  /** the only column of a UNIQUE index (not the primary key) */
  unique: boolean
}

export interface ErTable {
  name: string
  /** TABLE_TYPE VIEW / SYSTEM VIEW */
  view: boolean
  /** ENGINE ('' for a view) */
  engine: string
  /** TABLE_COMMENT ('' for a view) */
  comment: string
  /** in ORDINAL_POSITION order; only the columns the user has a privilege on */
  columns: ErColumn[]
}

export interface ErRelation {
  /** `fk`: a FOREIGN KEY constraint; `internal`: a relation of the configuration storage (pma__relation) */
  kind: 'fk' | 'internal'
  /** the constraint name, '' for an internal relation */
  name: string
  /** the referencing table (always in this database) and its columns */
  table: string
  columns: string[]
  /** the referenced database (this one, or another for a cross-database relation), table and columns */
  refDb: string
  refTable: string
  refColumns: string[]
}

export interface ErDiagramResponse {
  db: string
  /** sorted by name */
  tables: ErTable[]
  relations: ErRelation[]
}
