/**
 * Jest manual mock for nostr-tools and all of its subpaths.
 *
 * nostr-tools ships TypeScript SOURCE and vendors its own @noble/curves and
 * @noble/hashes (also source) which import old-style subpaths jest cannot resolve.
 * Mapping those would silently redirect the nested copies onto the top-level @noble
 * packages — different versions, on crypto code. Not a trade worth making to run a
 * test.
 *
 * This matters far beyond nostr: `services/keyChain` imports nostr-tools, the
 * services barrel imports keyChain, and the MODEL layer imports that barrel — so
 * nostr-tools loads for every store test even though none goes near nostr.
 *
 * Calls throw rather than returning plausible fakes: a test that silently derives a
 * bogus key and asserts on it is worse than one that stops and explains. Code that
 * genuinely needs nostr should mock the calling service (as the existing suites do
 * with nostrService).
 */
const makeNamespace = path => {
  const cache = new Map()
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === '__esModule') return true
        if (prop === 'then') return undefined
        if (typeof prop === 'symbol') return undefined

        if (!cache.has(prop)) {
          const name = `${path}.${String(prop)}`
          const fn = () => {
            throw new Error(
              `[nostr-tools mock] ${name}() was called in a test. This mock exists ` +
                `only so the module graph resolves — nostr-tools ships TS source ` +
                `with vendored @noble packages. Mock the calling service instead.`,
            )
          }
          cache.set(prop, fn)
        }
        return cache.get(prop)
      },
    },
  )
}

module.exports = makeNamespace('nostr-tools')
