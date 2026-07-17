/**
 * Mint URL normalization + validation (services/cashu/mintUrl).
 *
 * The single definition of what a mint url may look like, shared by
 * `MintsStore.addMint` and `Mint.setMintUrl`. Those two had drifted — adding a
 * mint stripped the trailing slash and demanded https, renaming one did neither
 * — so a rename could install a url that adding the same mint would have
 * rejected.
 *
 * @jest-environment node
 */
// AppError pulls in logService -> Sentry, which is not loadable under the node
// test environment.
jest.mock('../src/services/logService', () => ({
  log: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    trace: jest.fn(),
    warn: jest.fn(),
  },
}))

import {Mint as CashuMint} from '@cashu/cashu-ts'
import {normalizeMintUrl, isOnionMintUrl} from '../src/services/cashu/mintUrl'
import AppError, {Err} from '../src/utils/AppError'

const expectValidationError = (fn: () => unknown) => {
  expect(fn).toThrow(AppError)
  try {
    fn()
  } catch (e: any) {
    expect(e.name).toBe(Err.VALIDATION_ERROR)
  }
}

describe('normalizeMintUrl', () => {
  describe('trailing slashes (cashu spec: canonical form)', () => {
    test('strips a single trailing slash', () => {
      expect(normalizeMintUrl('https://mint.example/')).toBe('https://mint.example')
    })

    test('strips repeated trailing slashes', () => {
      expect(normalizeMintUrl('https://mint.example///')).toBe('https://mint.example')
    })

    test('leaves a url with no trailing slash alone', () => {
      expect(normalizeMintUrl('https://mint.example')).toBe('https://mint.example')
    })

    test('does NOT leave the slash the URL parser appends', () => {
      // new URL('https://mint.example').href === 'https://mint.example/', so the
      // strip has to happen AFTER canonicalization, not before it.
      expect(normalizeMintUrl('https://mint.example')).not.toMatch(/\/$/)
    })

    test('preserves a path while stripping its trailing slash', () => {
      expect(normalizeMintUrl('https://mint.example/cashu/')).toBe('https://mint.example/cashu')
    })

    test('trims surrounding whitespace (pasted urls)', () => {
      expect(normalizeMintUrl('  https://mint.example/  ')).toBe('https://mint.example')
    })

    test('the two spellings of one mint normalize to the same string', () => {
      // This is what makes the duplicate check able to see a trailing-slash twin.
      expect(normalizeMintUrl('https://mint.example/')).toBe(normalizeMintUrl('https://mint.example'))
    })
  })

  describe('canonical form (must equal what cashu-ts stores)', () => {
    // WalletStore finds cached CashuMint/CashuWallet instances by comparing our
    // stored string to CashuMint.mintUrl. If the two normalizations disagree,
    // every cache lookup misses and the two spellings look like two mints.
    test('lowercases the host', () => {
      expect(normalizeMintUrl('https://Mint.Example')).toBe('https://mint.example')
    })

    test('lowercases the scheme', () => {
      expect(normalizeMintUrl('HTTPS://mint.example')).toBe('https://mint.example')
    })

    test('drops the default https port', () => {
      expect(normalizeMintUrl('https://mint.example:443')).toBe('https://mint.example')
    })

    test('keeps a non-default port', () => {
      expect(normalizeMintUrl('https://mint.example:8443')).toBe('https://mint.example:8443')
    })

    test('preserves path case (paths are case-sensitive)', () => {
      expect(normalizeMintUrl('https://mint.example/Cashu')).toBe('https://mint.example/Cashu')
    })

    test('host-case variants converge on one string', () => {
      expect(normalizeMintUrl('https://MINT.example/')).toBe(normalizeMintUrl('https://mint.example'))
    })
  })

  describe('agreement with cashu-ts', () => {
    // Pins our output to the library's own normalizeUrl (which is @internal, so
    // it can only be observed through the CashuMint constructor). If cashu-ts
    // changes its canonical form, this fails rather than silently splitting the
    // wallet's cache keys.
    test.each([
      'https://mint.example',
      'https://mint.example/',
      'https://mint.example///',
      'https://Mint.Example',
      'HTTPS://MINT.EXAMPLE/',
      'https://mint.example:443/',
      'https://mint.example:8443/cashu/',
      'https://mint.example/Cashu',
    ])('normalizeMintUrl(%s) === new CashuMint(...).mintUrl', url => {
      expect(normalizeMintUrl(url)).toBe(new CashuMint(url).mintUrl)
    })
  })

  describe('https requirement', () => {
    test('accepts https', () => {
      expect(normalizeMintUrl('https://mint.example')).toBe('https://mint.example')
    })

    test('rejects plain http', () => {
      expectValidationError(() => normalizeMintUrl('http://mint.example'))
    })

    test('rejects a non-http scheme', () => {
      expectValidationError(() => normalizeMintUrl('ftp://mint.example'))
    })

    test('rejects a scheme merely PREFIXED with https', () => {
      // `startsWith('https')` — the old check — passes this; it parses as scheme
      // "https-evil:", which is not https at all.
      expectValidationError(() => normalizeMintUrl('https-evil://mint.example'))
    })
  })

  describe('onion exemption', () => {
    test('accepts http for a .onion host (Tor authenticates the endpoint)', () => {
      expect(normalizeMintUrl('http://abcdef.onion')).toBe('http://abcdef.onion')
    })

    test('accepts https for a .onion host', () => {
      expect(normalizeMintUrl('https://abcdef.onion/')).toBe('https://abcdef.onion')
    })

    // The regression the hostname check closes: addMint tested
    // `mintUrl.includes('.onion')`, so a '.onion' ANYWHERE in the string bought a
    // plain-http exemption for an ordinary host.
    test('does NOT let ".onion" in the PATH exempt a plain-http host', () => {
      expectValidationError(() => normalizeMintUrl('http://evil.example/.onion'))
    })

    test('does NOT let ".onion" in the QUERY exempt a plain-http host', () => {
      expectValidationError(() => normalizeMintUrl('http://evil.example?x=.onion'))
    })

    test('does NOT let a ".onion." subdomain prefix exempt a plain-http host', () => {
      expectValidationError(() => normalizeMintUrl('http://x.onion.evil.example'))
    })
  })

  describe('malformed input', () => {
    test('rejects an empty string', () => {
      expectValidationError(() => normalizeMintUrl(''))
    })

    test('rejects whitespace only', () => {
      expectValidationError(() => normalizeMintUrl('   '))
    })

    test('rejects a non-url string', () => {
      expectValidationError(() => normalizeMintUrl('not a url'))
    })

    test('rejects a scheme-less host', () => {
      expectValidationError(() => normalizeMintUrl('mint.example'))
    })
  })
})

describe('isOnionMintUrl', () => {
  test('true for a .onion hostname', () => {
    expect(isOnionMintUrl('http://abcdef.onion')).toBe(true)
  })

  test('true for a .onion hostname with a port and path', () => {
    expect(isOnionMintUrl('http://abcdef.onion:8080/cashu')).toBe(true)
  })

  test('false when .onion appears only in the path', () => {
    expect(isOnionMintUrl('https://evil.example/.onion')).toBe(false)
  })

  test('false for an ordinary host', () => {
    expect(isOnionMintUrl('https://mint.example')).toBe(false)
  })

  test('false (not a throw) for an unparseable url', () => {
    expect(isOnionMintUrl('not a url')).toBe(false)
  })
})
