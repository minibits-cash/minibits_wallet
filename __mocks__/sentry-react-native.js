/**
 * Jest manual mock for @sentry/react-native.
 *
 * Sentry ships untransformed ESM, and `transformIgnorePatterns` does not cover it,
 * so any module reaching it fails to parse. `services/logService` imports it at
 * load time and the whole app imports logService — which is why every existing
 * suite mocks logService wholesale just to avoid this.
 *
 * Mocking Sentry instead of logService lets the REAL logService load, so tests can
 * exercise code that logs (and assert on it) rather than replacing the logger.
 *
 * A Proxy backs every property with a lazily-created jest.fn(), so this keeps
 * working as the Sentry surface changes — no enumeration to drift. `logger` is a
 * nested namespace and gets the same treatment.
 */
const makeNamespace = () => {
  const fns = new Map()
  return new Proxy(
    {},
    {
      get(_target, prop) {
        // Jest/Node poke at these during interop and inspection; answering with a
        // mock fn confuses both.
        if (prop === '__esModule') return true
        if (prop === 'then') return undefined
        if (typeof prop === 'symbol') return undefined

        if (prop === 'logger') {
          if (!fns.has('logger')) fns.set('logger', makeNamespace())
          return fns.get('logger')
        }

        if (!fns.has(prop)) fns.set(prop, jest.fn())
        return fns.get(prop)
      },
    },
  )
}

module.exports = makeNamespace()
