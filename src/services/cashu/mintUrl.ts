import {normalizeMintUrl as cashuNormalizeMintUrl} from '@cashu/cashu-ts'
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
 * The canonicalization itself is cashu-ts's `normalizeMintUrl`, not a copy of it.
 * That matters because WalletStore finds cached CashuMint/CashuWallet instances by
 * comparing our stored string against `CashuMint.mintUrl` (`m.mintUrl === mintUrl`,
 * `w.mint.mintUrl === mintUrl`), and `new CashuMint(url)` stores exactly what this
 * function returns. Any drift between the two spellings would make every cache
 * lookup miss and the wallet would treat one mint as two.
 *
 * This used to reimplement the rule (`parsed.href` with trailing slashes stripped)
 * because cashu-ts's version was `@internal`. cashu-ts 4.8 renamed it to
 * `normalizeMintUrl` and made it public, so the copy — and the standing obligation
 * to keep it in step by hand — is gone.
 *
 * cashu-ts enforces NUT-00's trailing-slash rule plus its own canonical form
 * (lowercased scheme and host, default port dropped), and rejects credentials,
 * query strings, fragments and percent-encoded paths. Those rejections used to be
 * left to the `new CashuMint()` call further down; delegating moves them here,
 * which is strictly earlier and therefore better.
 *
 * The https requirement is ours alone and stricter than cashu-ts, which permits
 * http for any host — so it stays here, applied to the normalized url.
 */
export const normalizeMintUrl = function (mintUrl: string): string {
  if (!mintUrl || !mintUrl.trim()) {
    throw new AppError(Err.VALIDATION_ERROR, 'Mint URL is required.')
  }

  let normalized: string
  try {
    normalized = cashuNormalizeMintUrl(mintUrl.trim())
  } catch {
    // cashu-ts raises CTSError; the wallet speaks AppError.
    throw new AppError(Err.VALIDATION_ERROR, 'Invalid Mint URL.', {mintUrl})
  }

  // Checked on the NORMALIZED url, so the scheme has already been lowercased and
  // the host is the parsed hostname rather than a substring of the raw input.
  if (!normalized.startsWith('https:') && !isOnionMintUrl(normalized)) {
    throw new AppError(Err.VALIDATION_ERROR, 'Mint URL needs to start with https.', {mintUrl})
  }

  return normalized
}
