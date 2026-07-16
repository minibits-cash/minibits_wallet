/**
 * Jest manual mock for @op-engineering/op-sqlite.
 *
 * op-sqlite is a native module and cannot load under jest, yet the whole model
 * layer imports it transitively (`services -> db -> connection`), which is what
 * blocked instantiating MST stores in a test.
 *
 * This is an IMPORT-TIME shim, not a database. It exists so the module graph
 * resolves; it deliberately does NOT emulate SQLite. Anything that actually
 * executes a statement throws loudly rather than silently returning empty results,
 * because a test that believes it wrote to a database and did not is worse than a
 * test that fails.
 *
 * Two ways to test around it:
 *  - Model/view logic: stub the `Database` facade (`jest.mock('../src/services')`)
 *    and drive the MST tree directly.
 *  - Real SQL semantics: use node:sqlite and mirror the production statements, as
 *    the db suites do (see sqliteMigration*.test.ts).
 */
const notImplemented = name => () => {
  throw new Error(
    `[op-sqlite mock] ${name}() was called in a test. This shim only makes the ` +
      `module graph resolve — it is not a database. Stub the Database facade, or ` +
      `use node:sqlite with the production SQL (see the db test suites).`,
  )
}

const open = () => ({
  execute: notImplemented('execute'),
  executeSync: notImplemented('executeSync'),
  executeAsync: notImplemented('executeAsync'),
  executeBatch: notImplemented('executeBatch'),
  executeBatchAsync: notImplemented('executeBatchAsync'),
  close: () => {},
  delete: () => {},
})

module.exports = {
  open,
  IOS_DOCUMENT_PATH: '/mock/ios/documents',
  ANDROID_FILES_PATH: '/mock/android/files',
}
module.exports.__esModule = true
