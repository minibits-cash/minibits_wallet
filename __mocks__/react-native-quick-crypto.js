/**
 * Jest manual mock for react-native-quick-crypto.
 *
 * quick-crypto is a drop-in replacement for Node's `crypto`, so under jest
 * (Node environment, no native module) we simply delegate to Node's crypto.
 * This lets dependencies that load it at import time — e.g. @scure/bip32 via
 * @cashu/cashu-ts — be required without the native `QuickCrypto` module.
 */
const crypto = require('crypto')

module.exports = crypto
module.exports.default = crypto
