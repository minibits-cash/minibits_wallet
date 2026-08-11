import {Token, getDecodedToken} from '@cashu/cashu-ts'
import {log} from '../logService'
import {rootStoreInstance} from '../../models'

/**
 * Did this decode fail because a v2 keyset id could not be mapped?
 *
 * Matched on the message because cashu-ts raises both variants as a plain error with
 * no code to switch on. Kept narrow — any other decode failure (malformed token,
 * unsupported version) must propagate untouched rather than trigger a mint call.
 */
const isUnmappableKeysetIdError = function (e: any): boolean {
    const message: string = typeof e?.message === 'string' ? e.message : ''
    return /short keyset id/i.test(message)
}

/**
 * Decode an incoming cashu token, recovering from a keyset list that has gone stale.
 *
 * NUT-00 v4 tokens do not carry a full keyset id. A v0 id (`00…`) is 8 bytes and
 * survives the round trip intact, but a NUT-02 v2 id (`01…`) is 33 bytes and is
 * truncated to its first 8 bytes on encode — so cashu-ts can only give a proof its
 * real id by matching that prefix against the ids the wallet already holds for the
 * mint. Hand it a list without the match and it throws:
 *
 *     Couldn't map short keyset ID 01fc0ec0e59cd6fa to any known keysets of the current Mint
 *     A short keyset ID v2 was encountered, but got no keysets to map it to.
 *
 * Which is exactly what a mint issuing a new keyset produces (a nutshell -> cdk
 * migration flips the old `00…` keysets inactive and starts signing with a v2 one):
 * every wallet that has not touched that mint since the rotation holds a list that
 * cannot decode the ecash now being sent to it — background lightning-address claims
 * and nostr receives included. Nothing in the receive path needed the mint before the
 * decode, so nothing refreshed the list, and the user had no way to know that
 * performing some unrelated operation on the mint was what would fix it.
 *
 * So: try the list we have — the free path, and the only path a v0 id ever needs —
 * and only once a decode has PROVED the list wrong, re-pull the keysets and try
 * again. No extra request is spent on the common case, and the retry needs the ids
 * only, not the keys (keys for a proof's own keyset are loaded later, by
 * WalletStore.receive's ensureKeysetKeys).
 */
export const decodeTokenWithKeysets = async function (
    encodedToken: string,
    mintUrl: string,
): Promise<Token> {
    const {mintsStore, walletStore} = rootStoreInstance

    const keysetIds = () => mintsStore.findByUrl(mintUrl)?.keysetIds ?? []

    try {
        return getDecodedToken(encodedToken, keysetIds())
    } catch (e: any) {
        if (!isUnmappableKeysetIdError(e)) {
            throw e
        }

        log.info(
            '[decodeTokenWithKeysets]',
            'Token references an unknown keyset, refreshing mint keysets',
            {mintUrl, error: e.message},
        )

        // A failure here surfaces: offline, or a mint that genuinely does not know
        // this keyset. Either way the decode below could not have succeeded.
        await walletStore.refreshKeysetsNow(mintUrl)

        return getDecodedToken(encodedToken, keysetIds())
    }
}
