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
    // Same shape as the @scure/bip39 mapping below: the package's exports map
    // names only the suffixed path, so app code imports it that way. This accepts
    // both spellings, for transitive dependencies still using the bare one.
    '^@noble/hashes/utils(?:\\.js)?$': '@noble/hashes/utils.js',
    // The package's exports map lists ONLY the explicit `.js` subpath, so app code
    // imports it that way (moduleResolution is "bundler", which honours exports).
    // This accepts both spellings, since a transitive dependency may still use the
    // extensionless one, which no resolver can infer from that map.
    '^@scure/bip39/wordlists/([^/.]+)(?:\\.js)?$': '@scure/bip39/wordlists/$1.js',
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
    // react-native-localize is a native TurboModule, and src/i18n calls getLocales()
    // at module scope — so without this, importing `translate` anywhere makes the
    // module unloadable under jest.
    '^react-native-localize$': '<rootDir>/__mocks__/react-native-localize.js',
  },
}
