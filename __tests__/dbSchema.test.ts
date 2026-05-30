/**
 * Schema generation tests (Tier 2 module split).
 *
 * Validates that the generated DDL in services/db/schema.ts parses under real
 * SQLite and produces the expected table columns. schema.ts only imports a TYPE
 * from ./connection (elided at runtime), so it loads here without the native
 * op-sqlite module.
 *
 * @jest-environment node
 */
import {DatabaseSync} from 'node:sqlite'
import {
  createSchemaQueries,
  createTable,
  PROOFS_COLUMNS,
  PROOFS_COLUMN_NAMES,
} from '../src/services/db/schema'

const columnNames = (db: DatabaseSync, table: string): string[] =>
  db.prepare(`PRAGMA table_info(${table})`).all().map((r: any) => r.name as string)

describe('db schema generation', () => {
  it('applies createSchemaQueries without error and creates all tables', () => {
    const db = new DatabaseSync(':memory:')
    for (const [sql] of createSchemaQueries) db.exec(sql)

    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all()
      .map((r: any) => r.name)

    expect(tables).toEqual(
      expect.arrayContaining(['transactions', 'proofs', 'dbversion', 'reservations']),
    )
    db.close()
  })

  it('creates the proofs table with the canonical columns', () => {
    const db = new DatabaseSync(':memory:')
    for (const [sql] of createSchemaQueries) db.exec(sql)

    expect(columnNames(db, 'proofs')).toEqual([
      'id', 'amount', 'secret', 'C', 'dleq_r', 'dleq_s', 'dleq_e',
      'unit', 'tId', 'mintUrl', 'state', 'updatedAt',
    ])
    db.close()
  })

  it('PROOFS_COLUMN_NAMES lists every proofs column in declaration order', () => {
    const db = new DatabaseSync(':memory:')
    db.exec(createTable('p', PROOFS_COLUMNS, false))
    const declared = columnNames(db, 'p').join(', ')
    expect(PROOFS_COLUMN_NAMES).toBe(declared)
    db.close()
  })

  it('builds an identical proofs table under a different name (v25 rebuild path)', () => {
    const db = new DatabaseSync(':memory:')
    db.exec(createTable('proofs', PROOFS_COLUMNS))
    db.exec(createTable('proofs_v25', PROOFS_COLUMNS, false))
    expect(columnNames(db, 'proofs_v25')).toEqual(columnNames(db, 'proofs'))
    db.close()
  })
})
