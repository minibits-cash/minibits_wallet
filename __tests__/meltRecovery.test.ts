/**
 * Melt recovery (melt_recovery), against the REAL repo and a real database.
 *
 * A per-transaction serialized meltPreview is stored BEFORE a melt is submitted, so
 * a paid-but-unconfirmed melt can be recovered and its change ecash unblinded. The
 * first stored preview for a transaction wins (idempotent), and the row is removed
 * on terminal success/failure.
 *
 * The table is a CHILD of the transaction — its primary key IS transactionId — so
 * it holds no mint reference: the parent owns that fact, and every reader arrives
 * here already holding the transaction. It once duplicated mintUrl and keysetId;
 * neither had a single reader (the keyset that IS used lives inside meltPreview).
 *
 * Calls the production `Database.*` functions rather than mirroring their SQL: the
 * op-sqlite jest mock backs the real driver seam with node:sqlite, so connection.ts,
 * instance.ts and the repo all run for real.
 */
jest.mock('../src/services/logService', () => ({
  log: {debug: jest.fn(), error: jest.fn(), info: jest.fn(), trace: jest.fn(), warn: jest.fn()},
}))

import {Database} from '../src/services/db'

/** A representative StoredMeltPreview (shape from cashuUtils). */
const previewFor = (keysetId: string, secret = 'aa') =>
  ({
    keysetId,
    outputData: [
      {
        blindedMessage: {amount: '2', id: keysetId, B_: 'B_' + secret},
        blindingFactor: 'deadbeef',
        secret,
      },
    ],
  }) as any

const rowCount = () =>
  Database.getInstance().execute('SELECT COUNT(*) AS n FROM melt_recovery').rows?.item(0)?.n

beforeEach(() => {
  Database.getInstance().executeBatch([['DELETE FROM melt_recovery']])
})

describe('Melt recovery (melt_recovery)', () => {
  test('stores and reads back a meltPreview (JSON round-trip)', () => {
    const preview = previewFor('k1')
    Database.addMeltRecovery(101, preview)

    const rec = Database.getMeltRecovery(101)!
    expect(rec.transactionId).toBe(101)
    expect(rec.meltPreview).toEqual(preview)
    // The keyset lives INSIDE the preview — the row never duplicated it.
    expect(rec.meltPreview.keysetId).toBe('k1')
  })

  test('returns undefined when no entry exists', () => {
    expect(Database.getMeltRecovery(999)).toBeUndefined()
  })

  test('the FIRST stored preview wins (ON CONFLICT DO NOTHING)', () => {
    Database.addMeltRecovery(101, previewFor('k1', 'first'))
    // A second attempt for the same tx must not overwrite: the preview describes
    // outputs the mint may already have signed.
    Database.addMeltRecovery(101, previewFor('k1', 'second'))

    expect(Database.getMeltRecovery(101)!.meltPreview.outputData[0].secret).toBe('first')
    expect(rowCount()).toBe(1)
  })

  test('remove deletes the entry (terminal success/failure)', () => {
    Database.addMeltRecovery(101, previewFor('k1'))
    expect(rowCount()).toBe(1)

    Database.removeMeltRecovery(101)
    expect(Database.getMeltRecovery(101)).toBeUndefined()
    expect(rowCount()).toBe(0)
  })

  test('entries for different transactions are independent', () => {
    Database.addMeltRecovery(101, previewFor('k1'))
    Database.addMeltRecovery(102, previewFor('k2'))

    expect(Database.getMeltRecovery(101)!.meltPreview.keysetId).toBe('k1')
    expect(Database.getMeltRecovery(102)!.meltPreview.keysetId).toBe('k2')

    Database.removeMeltRecovery(101)
    expect(Database.getMeltRecovery(101)).toBeUndefined()
    expect(Database.getMeltRecovery(102)!.meltPreview.keysetId).toBe('k2') // unaffected
  })

  describe('seedMeltRecoveries — one-time MST/MMKV copy', () => {
    test('is idempotent — does not overwrite an existing entry', () => {
      Database.addMeltRecovery(101, previewFor('k1', 'live'))
      Database.seedMeltRecoveries([{transactionId: 101, meltPreview: previewFor('k1', 'snapshot')}])

      expect(Database.getMeltRecovery(101)!.meltPreview.outputData[0].secret).toBe('live')
    })

    test('carries over an entry that does not exist yet', () => {
      Database.seedMeltRecoveries([{transactionId: 202, meltPreview: previewFor('k9', 'seeded')}])
      expect(Database.getMeltRecovery(202)!.meltPreview.outputData[0].secret).toBe('seeded')
    })

    test('an empty seed is a no-op', () => {
      expect(Database.seedMeltRecoveries([])).toEqual({seeded: 0})
    })
  })
})
