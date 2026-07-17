import AppError, {Err} from '../../utils/AppError'

/**
 * Mint URL normalization and validation — the single definition of what a mint
 * url may look like.
 *
 * Extracted because the two entry points had drifted: `MintsStore.addMint`
 * stripped the trailing slash and demanded https, while `Mint.setMintUrl` did
 * neither (it only checked `new URL()` parsed). A RENAME could therefore install
 * a url that ADDING the same mint would have rejected — most damagingly a
 * trailing-slash twin of a mint already held, since the duplicate check compares
 * urls literally: two Mint nodes for one real mint, each accumulating its own
 * state.
 *
 * Kept free of model imports so both callers can use it without a cycle.
 */

/**
 * Whether the url points at a Tor hidden service, which is exempt from the https
 * requirement (onion routing already authenticates the endpoint).
 *
 * Tests the parsed HOSTNAME, not the raw string. A substring test for '.onion'
 * (what addMint used to do) also matches a path or query — `http://evil.com/.onion`
 * would earn a plain-http exemption for an ordinary host.
 */
export const isOnionMintUrl = function (mintUrl: string): boolean {
  try {
    return new URL(mintUrl).hostname.endsWith('.onion')
  } catch {
    return false
  }
}

/**
 * Normalize a mint url to its canonical form, or throw AppError(VALIDATION_ERROR).
 *
 * Two rules, from different authorities:
 *
 *  1. NUT-00 requires the trailing slash be gone. On the v3 token: "The mint URL
 *     must be stripped of any trailing slashes (/)"; on v4: "The mint URL MUST be
 *     normalized by stripping any trailing slashes (/)". That is the whole of what
 *     the spec mandates — it says nothing about case or any other form.
 *
 *  2. cashu-ts canonicalizes further, and we MUST match it. `new CashuMint(url)`
 *     stores `normalizeUrl(url)` = `parsed.href` with trailing slashes stripped,
 *     which also lowercases scheme and host and drops a default port. WalletStore
 *     compares our stored string against that value directly (`m.mintUrl ===
 *     mintUrl`, `w.mint.mintUrl === mintUrl`) to find cached CashuMint/CashuWallet
 *     instances. Normalizing the raw input instead would let `https://Mint.Example`
 *     be stored while cashu-ts holds `https://mint.example`: every cache lookup
 *     misses, and the wallet would treat the two spellings as two different mints.
 *     cashu-ts's normalizeUrl is @internal (not exported), hence the reimplementation
 *     here — it must be kept in step with it.
 *
 * The https requirement is ours alone and stricter than cashu-ts, which permits
 * http for any host.
 *
 * cashu-ts additionally rejects credentials, query strings, fragments and
 * percent-encoded paths. Those are deliberately NOT re-checked here: both callers
 * construct a CashuMint against the url before anything is stored, so cashu-ts
 * raises them itself — duplicating the rules would only invite drift.
 */
export const normalizeMintUrl = function (mintUrl: string): string {
  if (!mintUrl || !mintUrl.trim()) {
    throw new AppError(Err.VALIDATION_ERROR, 'Mint URL is required.')
  }

  let parsed: URL
  try {
    parsed = new URL(mintUrl.trim())
  } catch {
    throw new AppError(Err.VALIDATION_ERROR, 'Invalid Mint URL.', {mintUrl})
  }

  // Protocol equality, not `startsWith('https')` — the latter also accepts a
  // scheme merely PREFIXED with https (`https-evil://host` parses fine).
  if (parsed.protocol !== 'https:' && !isOnionMintUrl(parsed.href)) {
    throw new AppError(Err.VALIDATION_ERROR, 'Mint URL needs to start with https.', {mintUrl})
  }

  // `href` first (canonical), THEN strip: the parser appends a trailing slash to
  // an origin-only url, so stripping last removes both that and any the caller
  // typed. Identical to cashu-ts normalizeUrl.
  return parsed.href.replace(/\/+$/, '')
}
