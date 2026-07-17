module.exports = {
  preset: 'react-native',
  // Only treat *.test/*.spec files as tests. The default preset glob also
  // matches every .js file under __tests__, which would pull in the i18n
  // scripts (missingTranslations.js etc.) that are run via `yarn test:i18n`.
  testMatch: ['**/*.(test|spec).[jt]s?(x)'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native|@react-native-community|@cashu|@noble|@scure|react-native-flash-message)/)',
  ],
  // Several native or source-shipped packages are unusable under jest, and the
  // MODEL layer reaches all of them at import time (Mint -> services barrel ->
  // mmkvStorage / keyChain / db). That is what made MST stores impossible to
  // instantiate in a test at all; these mappings are what make store tests possible.
  moduleNameMapper: {
    '^@noble/hashes/utils$': '@noble/hashes/utils.js',
    // Same shape as the @noble mapping: the package only exports the explicit
    // `.js` subpath, which jest's resolver will not infer.
    '^@scure/bip39/wordlists/(.*)$': '@scure/bip39/wordlists/$1.js',
    // quick-crypto's native module is unavailable under jest; route to a
    // Node `crypto` shim so deps that import it at load time (e.g. bip32) work.
    '^react-native-quick-crypto$': '<rootDir>/__mocks__/react-native-quick-crypto.js',
    // MMKV and op-sqlite are native. MMKV is Map-backed and behaves; op-sqlite is
    // only an import-time shim and throws if a statement is actually executed —
    // use node:sqlite with the production SQL for real DB semantics (see the db
    // suites).
    '^react-native-mmkv$': '<rootDir>/__mocks__/react-native-mmkv.js',
    '^@op-engineering/op-sqlite$': '<rootDir>/__mocks__/op-sqlite.js',
    // Sentry ships untransformed ESM, so anything importing logService fails to
    // parse. Mocking Sentry rather than logService lets the REAL logger load, so
    // tests can cover code that logs instead of stubbing the logger away.
    '^@sentry/react-native$': '<rootDir>/__mocks__/sentry-react-native.js',
    // nostr-tools ships TS source and vendors its own @noble/curves + @noble/hashes
    // (also source), importing subpaths jest cannot resolve. Mapping those would
    // cross the nested copies onto the top-level @noble versions — on crypto code.
    // Mock the surface instead; nothing in the model layer needs real nostr.
    '^nostr-tools(/.*)?$': '<rootDir>/__mocks__/nostr-tools.js',
  },
}
