/**
 * The UPGRADE path: an existing database at an old version, driven through the real
 * instance.ts (createSchemaQueries + the real migration registry).
 *
 * This is the path every user's device takes and the one nothing covered. Every
 * other db suite starts from a FRESH in-memory database, where instance.ts builds
 * the latest schema and seeds the version — so migrations never run at all, and the
 * interaction between createSchemaQueries and the registry is never exercised.
 *
 * That gap shipped a real bug. createSchemaQueries runs `CREATE TABLE IF NOT EXISTS`
 * for the CURRENT shape of every table, on every launch. On a device old enough not
 * to have a table yet, it therefore created it at TODAY's shape — and the migration
 * that later adds a column to that table then failed with "duplicate column name",
 * rolling back the whole batch and leaving the database unmigrated. A wallet at v29
 * showed a zero balance.
 *
 * @jest-environment node
 */
jest.mock('../src/services/logService', () => ({
  log: {debug: jest.fn(), error: jest.fn(), info: jest.fn(), trace: jest.fn(), warn: jest.fn()},
}))

// ── A device at db v26 ───────────────────────────────────────────────────────
//
// v26 is the baseline that matters most: it is what the last released NATIVE bundle
// (tag v0.4.3-beta.3, `_dbVersion = 26`, `rootStoreModelVersion = 32`) creates, so
// even a BRAND NEW install today starts here and then OTA-updates the JS to the
// current migrations. It is the common path, not an old edge case.
//
// VERIFIED against that tag rather than reconstructed: its createSchemaQueries
// builds exactly these four tables, and its TRANSACTIONS_COLUMNS (25),
// PROOFS_COLUMNS (12) and RESERVATIONS_COLUMNS (7) match the shapes below column for
// column. mint_counters (v27), melt_recovery (v28), inflight_requests (v29),
// wallet_counters (v30), onchain_mint_quotes (v31) and mints/mint_keysets (v35) do
// not exist there yet.
//
// Frozen deliberately: this is history, and must NOT be re-pointed at schema.ts. A
// fixture that tracks today's shape describes a device that never existed and stops
// testing the upgrade at all.

const SCHEMA_V26 = [
  `CREATE TABLE transactions (
    id INTEGER PRIMARY KEY NOT NULL, paymentId TEXT, type TEXT, amount INTEGER, unit TEXT,
    fee INTEGER, data TEXT, keysetId TEXT, sentFrom TEXT, sentTo TEXT, profile TEXT,
    memo TEXT, mint TEXT, quote TEXT, paymentRequest TEXT, zapRequest TEXT,
    inputToken TEXT, outputToken TEXT, proof TEXT, balanceAfter INTEGER, noteToSelf TEXT,
    tags TEXT, status TEXT, expiresAt TEXT, createdAt TEXT
  )`,
  `CREATE TABLE proofs (
    id TEXT NOT NULL, amount INTEGER NOT NULL, secret TEXT PRIMARY KEY NOT NULL, C TEXT NOT NULL,
    dleq_r TEXT, dleq_s TEXT, dleq_e TEXT, unit TEXT, tId INTEGER, mintUrl TEXT,
    state TEXT NOT NULL DEFAULT 'UNSPENT', updatedAt TEXT
  )`,
  `CREATE TABLE dbversion (id INTEGER PRIMARY KEY NOT NULL, version INTEGER, createdAt TEXT)`,
  `CREATE TABLE reservations (
    id TEXT PRIMARY KEY NOT NULL, transactionId INTEGER NOT NULL, mintUrl TEXT NOT NULL,
    unit TEXT NOT NULL, operationType TEXT NOT NULL, lockedProofs TEXT NOT NULL, createdAt TEXT NOT NULL
  )`,
]

const KEYSET = '009a1f293253e41e'
const MINT_URL = 'https://mint.test'

const seedV26 = (db: any) => {
  for (const sql of SCHEMA_V26) db.exec(sql)
  db.prepare(`INSERT INTO dbversion (id, version, createdAt) VALUES (1, 26, '2026-01-01')`).run()
  // Real user data, so the assertions below mean something.
  db.prepare(
    `INSERT INTO proofs (id, amount, secret, C, unit, tId, mintUrl, state, updatedAt)
     VALUES (?, 100, 's1', 'C', 'sat', 1, ?, 'UNSPENT', '2026-01-01')`,
  ).run(KEYSET, MINT_URL)
  db.prepare(
    `INSERT INTO transactions (id, type, amount, unit, data, mint, status, createdAt)
     VALUES (1, 'TOPUP', 100, 'sat', '{}', ?, 'COMPLETED', '2026-01-01')`,
  ).run(MINT_URL)
}

/**
 * A device at version N, built honestly: the v26 schema, then the REAL migrations
 * replayed up to N. Stamping a different version onto the v26 fixture would describe
 * a device that never existed — one claiming v31 without the table v31 creates — and
 * would fail for that reason rather than a real one.
 */
const seedAtVersion = (startVersion: number) => (db: any) => {
  seedV26(db)
  const {MIGRATIONS} = require('../src/services/db/migrations')
  for (const migration of MIGRATIONS) {
    if (migration.version > 26 && migration.version <= startVersion) {
      for (const [sql] of migration.queries) db.exec(sql)
    }
  }
  db.prepare('UPDATE dbversion SET version = ?').run(startVersion)

  // A derivation counter, once the table it lives in exists. Losing this is the one
  // failure that re-issues blinded secrets the mint has already signed.
  if (startVersion >= 27) {
    const hasMintUrl = (db.prepare(`PRAGMA table_info(mint_counters)`).all() as any[]).some(
      c => c.name === 'mintUrl',
    )
    if (hasMintUrl) {
      db.prepare(
        `INSERT INTO mint_counters (mintUrl, keysetId, unit, counter, updatedAt)
         VALUES (?, ?, 'sat', 342, '2026-01-01')`,
      ).run(MINT_URL, KEYSET)
    } else {
      db.prepare(
        `INSERT INTO mint_counters (keysetId, unit, counter, updatedAt)
         VALUES (?, 'sat', 342, '2026-01-01')`,
      ).run(KEYSET)
    }
  }
}

/** Open a database at `startVersion` and let the REAL instance.ts upgrade it. */
const upgradeFrom = (startVersion: number) => {
  jest.resetModules()
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('@op-engineering/op-sqlite').__seedNextDatabase(seedAtVersion(startVersion))
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {Database} = require('../src/services/db')
  const {_dbVersion} = require('../src/services/db/migrations')
  return {Database, _dbVersion, db: Database.getInstance()}
}

/** The baseline the last released native bundle ships. */
const upgradeFromV26 = () => upgradeFrom(26)

const columns = (db: any, table: string): string[] =>
  (db.execute(`PRAGMA table_info(${table})`).rows?._array ?? []).map((r: any) => r.name)

describe('upgrading an existing database (the device path)', () => {
  test('a v26 wallet — the last released native bundle — migrates to the current version', () => {
    // The reported failure: this threw "duplicate column name: mintId", the batch
    // rolled back, and the wallet came up with nothing.
    const {Database, _dbVersion, db} = upgradeFromV26()

    expect(Database.getDatabaseVersion(db).version).toBe(_dbVersion)
  })

  test('the money survives', () => {
    const {db} = upgradeFromV26()

    const proof = db.execute(`SELECT * FROM proofs WHERE secret = 's1'`).rows?.item(0)
    expect(proof.amount).toBe(100)
    expect(proof.mintUrl).toBe(MINT_URL)
  })

  test('a derivation counter survives the v32 re-key', () => {
    // From v27, the first version that HAS mint_counters. A v26 wallet has no such
    // table at all — its counters are still in the MMKV snapshot, and the rootStore
    // v33 seed is what copies them in.
    //
    // This is the one value whose loss re-issues blinded secrets the mint has
    // already signed, and v32 re-keys the very table it lives in, from
    // (mintUrl, keysetId) onto keysetId.
    const {Database} = upgradeFrom(27)

    expect(Database.getCounter(KEYSET)?.counter).toBe(342)
  })

  test('every column the later migrations add is present', () => {
    const {db} = upgradeFromV26()

    // v33 / v34: the mint-identity columns.
    expect(columns(db, 'onchain_mint_quotes')).toContain('mintId')
    expect(columns(db, 'reservations')).toContain('mintId')
    expect(columns(db, 'transactions')).toContain('mintId')

    // v34 also rebuilt the child tables WITHOUT their duplicated mint reference.
    expect(columns(db, 'inflight_requests')).not.toContain('mintUrl')
    expect(columns(db, 'melt_recovery')).not.toContain('mintUrl')
  })

  test('tables introduced after v29 exist, at the current shape', () => {
    const {db} = upgradeFromV26()

    expect(columns(db, 'wallet_counters')).toContain('counter') // v30
    expect(columns(db, 'onchain_mint_quotes')).toContain('counterIndex') // v31
    expect(columns(db, 'mints')).toContain('mintUrl') // v35
    expect(columns(db, 'mint_keysets')).toContain('keysetId') // v35
  })

  test('mint_counters is re-keyed onto keysetId alone', () => {
    const {db} = upgradeFromV26()

    expect(columns(db, 'mint_counters')).toEqual(
      expect.arrayContaining(['keysetId', 'unit', 'counter', 'updatedAt']),
    )
    expect(columns(db, 'mint_counters')).not.toContain('mintUrl')
  })

  test('the repos work against the upgraded database', () => {
    // The real point: not just that the DDL landed, but that the app can use it.
    const {Database} = upgradeFromV26()

    Database.setCounter('00ad268c4d1f5826', 'sat', 7)
    expect(Database.getCounter('00ad268c4d1f5826')?.counter).toBe(7)

    expect(Database.getMints()).toEqual([])
    expect(Database.getWatchedOnchainMintQuotes()).toEqual([])
  })

  test('re-running the upgrade on an already-current database is a no-op', () => {
    // Every subsequent launch takes this path.
    jest.resetModules()
    const {Database} = require('../src/services/db')
    const {_dbVersion} = require('../src/services/db/migrations')

    const db = Database.getInstance()
    expect(Database.getDatabaseVersion(db).version).toBe(_dbVersion)

    // A second call must not re-run anything.
    expect(Database.getDatabaseVersion(Database.getInstance()).version).toBe(_dbVersion)
  })

  // The bug's real shape: it bites at any version predating a table that a LATER
  // migration alters. v29 is simply where it was reported. Rather than trust that
  // one case, walk every version the registry knows about.
  describe('every supported starting version reaches the current schema', () => {
    test.each([26, 27, 28, 29, 30, 31, 32, 33, 34])('from v%i', startVersion => {
      jest.resetModules()
      require('@op-engineering/op-sqlite').__seedNextDatabase(seedAtVersion(startVersion))
      const {Database} = require('../src/services/db')
      const {_dbVersion} = require('../src/services/db/migrations')

      const db = Database.getInstance()

      expect(Database.getDatabaseVersion(db).version).toBe(_dbVersion)
      expect(columns(db, 'onchain_mint_quotes')).toContain('mintId')
      expect(columns(db, 'transactions')).toContain('mintId')
      // The money, at every starting point.
      expect(db.execute(`SELECT amount FROM proofs WHERE secret = 's1'`).rows?.item(0)?.amount).toBe(100)
    })
  })
})

describe('cleanAll — the factory reset', () => {
  test('drops EVERY table, not a hand-listed subset', () => {
    jest.resetModules()
    const {Database} = require('../src/services/db')
    Database.getInstance() // builds the current schema

    Database.cleanAll()

    const db = Database.getInstance()
    const remaining = (
      db.execute(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
        .rows?._array ?? []
    ).map((r: any) => r.name)

    // The old list named seven tables while the schema had eleven, so a factory
    // reset left the user's mints and their onchain deposit addresses behind.
    expect(remaining).toEqual([])
  })

  test('also clears tables no list would know about', () => {
    // The failure mode that broke a test device: a leftover table from a bad build
    // outlived the reset, and the create-migration that should have rebuilt it
    // skipped it (IF NOT EXISTS) — so the ALTER after it hit "duplicate column".
    jest.resetModules()
    require('@op-engineering/op-sqlite').__seedNextDatabase((db: any) => {
      db.exec(`CREATE TABLE some_leftover_table (id TEXT)`)
    })
    const {Database} = require('../src/services/db')
    Database.getInstance()

    Database.cleanAll()

    const db = Database.getInstance()
    const remaining = (
      db.execute(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
        .rows?._array ?? []
    ).map((r: any) => r.name)

    expect(remaining).toEqual([])
  })

  test('is safe on an already-empty database', () => {
    jest.resetModules()
    const {Database} = require('../src/services/db')
    Database.getInstance()

    Database.cleanAll()
    expect(() => Database.cleanAll()).not.toThrow()
  })
})
