import {MintUnit} from '../wallet/currency'

/**
 * The shape this needs from a proof. Structural rather than the Proof model, so
 * the helper stays a pure function over plain data and can be tested without a
 * store — it is called with live MST instances, which satisfy it.
 */
export type SummarizableProof = {
    mintUrl: string
    unit: MintUnit
    amount: number
    state?: string
}

export type ImportedProofsGroup<T extends SummarizableProof = SummarizableProof> = {
    mintUrl: string
    unit: MintUnit
    /** Spendable amount restored — what the RECEIVE_IMPORT transaction records. */
    amount: number
    proofs: T[]
}

/**
 * Group freshly imported proofs into the transactions that should record them.
 *
 * BY MINT AND UNIT, not by unit alone. A transaction names the mint it happened
 * at (`Transaction.mint` is required, and `mintId` is resolved from it), and the
 * balance the history has to explain is itself per mint per unit — so a
 * unit-only grouping would have to attribute the ecash of several mints to one
 * arbitrary url, which is precisely the mis-attribution `mintId` exists to stop.
 *
 * Only UNSPENT proofs are counted. The transaction's job is to account for the
 * balance that appeared, and PENDING proofs — locked in an operation the other
 * device had in flight — are not part of it. They still arrive and are still
 * written; they are simply not what this transaction claims. A proof with no
 * state predates the state column and is spendable (see ProofModel's default).
 *
 * Groups come back ordered by mint then unit, so the transactions a single
 * import writes land in a stable order rather than whatever the proofs happened
 * to be in.
 */
export const groupImportedProofs = function <T extends SummarizableProof>(
    proofs: T[],
): ImportedProofsGroup<T>[] {
    const groups = new Map<string, ImportedProofsGroup<T>>()

    for (const proof of proofs ?? []) {
        if (!proof?.mintUrl) continue
        if (proof.state && proof.state !== 'UNSPENT') continue

        const key = `${proof.mintUrl}|${proof.unit}`
        const group = groups.get(key) ?? {mintUrl: proof.mintUrl, unit: proof.unit, amount: 0, proofs: []}

        group.amount += Number(proof.amount)
        group.proofs.push(proof)
        groups.set(key, group)
    }

    return Array.from(groups.values())
        .filter(group => group.amount > 0)
        .sort((a, b) => a.mintUrl.localeCompare(b.mintUrl) || String(a.unit).localeCompare(String(b.unit)))
}
