/**
 * @jest-environment node
 */

/**
 * The onboarding cases, and which of them may touch the seed.
 *
 * A seed is ORPHANED when the keychain still holds one but this launch had to build
 * the database from nothing — the container was wiped and the keychain survived it.
 * That is the only case where resuming would derive from a zeroed counter against a
 * seed the mint has already seen, and so the only one worth interrupting a user for.
 *
 * The schema half runs for real: instance.ts is driven through the op-sqlite mock, so
 * "was the database built this launch" is decided by the production code path rather
 * than by a stub of it. Only the keychain is mocked, because there isn't one under
 * jest.
 */

jest.mock('../src/services/logService', () => ({
  log: {debug: jest.fn(), error: jest.fn(), info: jest.fn(), trace: jest.fn(), warn: jest.fn()},
}))

const mockHasWalletKeys = jest.fn()
jest.mock('../src/services/keyChain', () => ({
  KeyChain: {hasWalletKeys: mockHasWalletKeys},
}))

/**
 * A database that already exists. Only the version row matters — it is the single
 * fact instance.ts branches on, and stamping it at the current version means no
 * migration runs, which is what a launch on an up-to-date wallet actually does.
 */
const seedExistingDatabase = (db: any) => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {_dbVersion} = require('../src/services/db/migrations')
  db.exec(`CREATE TABLE dbversion (id INTEGER PRIMARY KEY NOT NULL, version INTEGER, createdAt TEXT)`)
  db.exec(`INSERT INTO dbversion (id, version, createdAt) VALUES (1, ${_dbVersion}, '2026-01-01')`)
}

type Launch = {databaseExists: boolean; keysInKeychain: boolean}

/** One app launch, up to the point setupRootStore captures the answer. */
const launch = async ({databaseExists, keysInKeychain}: Launch) => {
  jest.resetModules()
  mockHasWalletKeys.mockReset()
  mockHasWalletKeys.mockResolvedValue(keysInKeychain)

  if (databaseExists) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('@op-engineering/op-sqlite').__seedNextDatabase(seedExistingDatabase)
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {Database} = require('../src/services/db')
  Database.getInstance() // what setupRootStore does before capturing

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const orphanedSeed = require('../src/services/orphanedSeed')
  await orphanedSeed.captureOrphanedSeed()

  return orphanedSeed
}

describe('orphaned seed detection — the onboarding cases', () => {
  test('a fresh first install: no keys, no database', async () => {
    const {hasOrphanedSeed} = await launch({databaseExists: false, keysInKeychain: false})

    expect(hasOrphanedSeed()).toBe(false)
  })

  test('an Android reinstall looks exactly like a first install', async () => {
    // Not a separate code path, and that IS the finding: the keystore dies with the
    // app's uid and allowBackup="false" stops Google Backup restoring a container, so
    // Android arrives with neither keys nor schema and needs no special handling.
    const {hasOrphanedSeed} = await launch({databaseExists: false, keysInKeychain: false})

    expect(hasOrphanedSeed()).toBe(false)
  })

  test('an iOS reinstall: keys survived, the database did not', async () => {
    // The one case worth prompting on. iOS keeps keychain items across app deletion.
    const {hasOrphanedSeed} = await launch({databaseExists: false, keysInKeychain: true})

    expect(hasOrphanedSeed()).toBe(true)
  })

  test('a TOS re-onboard leaves the seed alone', async () => {
    // isOnboarded is flipped back to false to re-show the terms. The wallet, its
    // database and its counters are all intact — there is nothing to decide.
    const {hasOrphanedSeed} = await launch({databaseExists: true, keysInKeychain: true})

    expect(hasOrphanedSeed()).toBe(false)
  })

  test('replaying onboarding from the developer screen leaves the seed alone', async () => {
    const {hasOrphanedSeed} = await launch({databaseExists: true, keysInKeychain: true})

    expect(hasOrphanedSeed()).toBe(false)
  })

  test('a factory reset leaves the seed alone, because it takes the keys with it', async () => {
    // DeveloperScreen calls removeWalletKeys() alongside cleanAll(), so the next
    // launch finds neither — a first install, not an orphan.
    const {hasOrphanedSeed} = await launch({databaseExists: false, keysInKeychain: false})

    expect(hasOrphanedSeed()).toBe(false)
  })
})

describe('the snapshot', () => {
  test('keys created BY onboarding do not make the wallet look orphaned', async () => {
    // The trap this module exists to avoid. On a fresh install the schema IS new, so
    // a live check would turn true the instant onboarding saved its keys — offering
    // to reset a seed thirty seconds old to anyone who backed out and came back.
    const {hasOrphanedSeed, captureOrphanedSeed} = await launch({
      databaseExists: false,
      keysInKeychain: false,
    })

    // Onboarding generates and saves keys; the keychain now has some.
    mockHasWalletKeys.mockResolvedValue(true)
    await captureOrphanedSeed()

    expect(hasOrphanedSeed()).toBe(false)
  })

  test('resolving it clears it, so a fresh start is not re-offered', async () => {
    const {hasOrphanedSeed, resolveOrphanedSeed} = await launch({
      databaseExists: false,
      keysInKeychain: true,
    })
    expect(hasOrphanedSeed()).toBe(true)

    resolveOrphanedSeed()

    expect(hasOrphanedSeed()).toBe(false)
  })

  test('an unreadable keychain does not fail the launch', async () => {
    jest.resetModules()
    mockHasWalletKeys.mockReset()
    mockHasWalletKeys.mockRejectedValue(new Error('keychain unavailable'))

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {Database} = require('../src/services/db')
    Database.getInstance()

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const orphanedSeed = require('../src/services/orphanedSeed')

    await expect(orphanedSeed.captureOrphanedSeed()).resolves.toBeUndefined()
    // Falls back to the behaviour every release until now shipped: resume the seed.
    expect(orphanedSeed.hasOrphanedSeed()).toBe(false)
  })
})
