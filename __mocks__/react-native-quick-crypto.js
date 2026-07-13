/**
 * Jest manual mock for react-native-quick-crypto.
 *
 * quick-crypto is a drop-in replacement for Node's `crypto`, so under jest
 * (Node environment, no native module) we simply delegate to Node's crypto.
 * This lets dependencies that load it at import time — e.g. @scure/bip32 via
 * @cashu/cashu-ts — be required without the native `QuickCrypto` module.
 *
 * `__esModule` is load-bearing. Our patches to @scure/bip32 and @scure/bip39
 * (see patches/) rewire them onto quick-crypto for native speed, using a DEFAULT
 * import: `import quickCrypto from 'react-native-quick-crypto'` and then calling
 * `quickCrypto.createHmac(...)` / `.pbkdf2Sync(...)`. Without the `__esModule`
 * marker, Babel's interop wraps this CJS module again — the default import then
 * resolves to `{default: crypto}` instead of `crypto`, and every call lands on
 * `undefined`. With it, interop hands back `default` directly.
 */
// `node:` prefix is deliberate: the bare `crypto` specifier resolves to an empty
// shim under the react-native jest preset, which silently yields a module with no
// createHmac/pbkdf2Sync on it.
const crypto = require('node:crypto')

module.exports = crypto
module.exports.default = crypto
module.exports.__esModule = true
