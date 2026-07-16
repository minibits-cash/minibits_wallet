/**
 * Jest manual mock for react-native-mmkv.
 *
 * MMKV is a native module, so it cannot load under jest. Everything in the model
 * layer reaches it transitively — `Mint -> theme -> useThemeColor -> services ->
 * mmkvStorage` — which is what made MST stores impossible to instantiate in a test
 * at all.
 *
 * Backed by a plain Map per instance id, so it behaves like real storage for the
 * small surface mmkvStorage uses (getString/set/delete/clearAll). Tests that care
 * about persistence can therefore round-trip; tests that do not can ignore it.
 */
class MMKV {
  constructor(config = {}) {
    // Keyed by id so two MMKV instances stay isolated, as they are natively.
    const id = config.id ?? 'default'
    if (!MMKV._stores.has(id)) MMKV._stores.set(id, new Map())
    this._store = MMKV._stores.get(id)
  }

  getString(key) {
    const value = this._store.get(key)
    return typeof value === 'string' ? value : undefined
  }

  set(key, value) {
    this._store.set(key, value)
  }

  delete(key) {
    this._store.delete(key)
  }

  clearAll() {
    this._store.clear()
  }

  getAllKeys() {
    return Array.from(this._store.keys())
  }

  contains(key) {
    return this._store.has(key)
  }
}

/** Every instance ever created, by id. Reset between tests via __resetMMKV(). */
MMKV._stores = new Map()

/** Test helper: drop all stored data so suites cannot leak state into each other. */
const __resetMMKV = () => {
  MMKV._stores.clear()
}

module.exports = {MMKV, __resetMMKV}
module.exports.__esModule = true
