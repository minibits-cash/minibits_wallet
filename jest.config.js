module.exports = {
  preset: 'react-native',
  // Only treat *.test/*.spec files as tests. The default preset glob also
  // matches every .js file under __tests__, which would pull in the i18n
  // scripts (missingTranslations.js etc.) that are run via `yarn test:i18n`.
  testMatch: ['**/*.(test|spec).[jt]s?(x)'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native|@react-native-community|@cashu|@noble|@scure|react-native-flash-message)/)',
  ],
  moduleNameMapper: {
    '^@noble/hashes/utils$': '@noble/hashes/utils.js',
    // quick-crypto's native module is unavailable under jest; route to a
    // Node `crypto` shim so deps that import it at load time (e.g. bip32) work.
    '^react-native-quick-crypto$': '<rootDir>/__mocks__/react-native-quick-crypto.js',
  },
}
