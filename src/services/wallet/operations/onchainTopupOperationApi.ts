/**
 * Onchain (NUT-30) topup operation API.
 *
 * The bolt11 sibling (topupOperationApi) has a linear lifecycle: one invoice, one
 * payment, one mint, done. Onchain does not, and the differences are the whole
 * reason this is a separate module:
 *
 *   - A quote is an ADDRESS, not an invoice. It has no amount (the mint has
 *     nothing to price) and it can be paid any number of times. The mint tracks
 *     `amount_paid` / `amount_issued`; the wallet mints the difference.
 *
 *   - The amount the user typed is a HINT. It goes into the BIP21 URI, and the
 *     sender is free to ignore it. Under- and overpayment are normal, so a
 *     transaction's amount is provisional until a deposit actually confirms, and
 *     then settles to what was really minted.
 *
 *   - Consequently one quote maps to N transactions (one per mint), not one. The
 *     quote's own state lives in `onchain_mint_quotes`; transactions point at it
 *     via `transactions.quote`.
 *
 *   - The mint returns `expiry: null` — the address never dies. Nothing
 *     server-side bounds the wait, so the wallet imposes its own watch window
 *     (see onchainQuotesRepo).
 *
 * Lifecycle:
 *
 *   createQuote()  → DRAFT → PREPARED → PENDING, plus the persisted quote whose
 *                    address the user is shown.
 *   refreshQuote() → re-check the mint; if anything is credited but not yet
 *                    minted, mint it and settle the transaction to COMPLETED.
 *                    Called by the watcher (onchainOperations) and by the user's
 *                    manual "check for deposits".
 *
 * The states mean what they mean elsewhere in the wallet:
 *
 *   DRAFT     — row exists, mint not yet contacted. Carries the failure if the
 *               quote request is refused, so a burned NUT-20 index is never left
 *               unexplained.
 *   PREPARED  — the mint answered and the quote is persisted. Transient, exactly
 *               as for bolt11 (topupTask calls prepare() and execute() back to
 *               back): a crash marker, not a state a user sits in.
 *   PENDING   — the address is live and we are waiting to be paid. This has to be
 *               PENDING and not PREPARED, because pendingHistory filters on
 *               PENDING alone — anything else drops the topup out of the pending
 *               list, which is precisely where the user looks for it.
 *   COMPLETED — a deposit confirmed and was minted.
 *
 * Unlike bolt11 there is no "arm the watcher" step between PREPARED and PENDING:
 * the watcher is driven by the QUOTE row, so persisting the quote IS the
 * registration. And there is no cancel-to-reclaim — nothing local is locked while
 * we wait, because the "lock" is a mint-side address.
 */
import {log} from '../../logService'
import {MintError, ValidationError} from '../../../utils/AppError'
import {rootStoreInstance} from '../../../models'
import {
    Transaction,
    TransactionData,
    TransactionStatus,
    TransactionType,
} from '../../../models/Transaction'
import {Database} from '../../../services'
import {OnchainMintQuoteRecord} from '../../db/onchainQuotesRepo'
import type {Mint} from '../../../models/Mint'
import {allocateQuoteKeypair, deriveQuoteKeypair} from '../../cashu/nut20'
import {capMintAmount, mintableAmount} from './onchainAmounts'
import {CashuProof} from '../../cashu/cashuUtils'
import {MintUnit} from '../currency'
import {WalletUtils} from '../utils'
import {sendTopupNotification} from '../notifications'

const {mintsStore, proofsStore, transactionsStore, walletStore} = rootStoreInstance

export type CreatedOnchainQuote = {
    transactionId: number
    tx: Transaction
    /** The Bitcoin address the sender pays. */
    address: string
    /** Mint's quote id. */
    quote: string
    /** What the user asked for — a hint carried in the BIP21 URI. */
    amountRequested: number
    watchUntil: Date
}

// ─────────────────────────────────────────────────────────────────────────────
// createQuote()
// ─────────────────────────────────────────────────────────────────────────────

async function createQuote(input: {
    mintUrl: string
    unit: MintUnit
    amountRequested: number
    memo?: string
}): Promise<CreatedOnchainQuote> {
    const {mintUrl, unit, amountRequested, memo} = input

    if (amountRequested <= 0) {
        throw new ValidationError('Amount to topup must be above zero.')
    }

    const mintInstance = mintsStore.findByUrl(mintUrl)
    if (!mintInstance) {
        throw new ValidationError('Could not find mint', {mintUrl})
    }
    if (!mintInstance.supportsMint!('onchain', unit)) {
        throw new ValidationError('This mint does not support onchain topup for this unit', {
            mintUrl,
            unit,
        })
    }

    // ── DRAFT: a record BEFORE the mint is contacted ─────────────────────
    //
    // This exists so a failure below leaves a trace. Without it, a mint that refuses
    // the quote produced no transaction at all — and a NUT-20 index had already been
    // burned with nothing to explain the gap. Same reason bolt11's prepare() opens
    // with a DRAFT row.
    const transactionData: TransactionData[] = [
        {
            status: TransactionStatus.DRAFT,
            amountToTopup: amountRequested,
            unit,
            method: 'onchain',
            createdAt: new Date(),
        },
    ]

    const transaction = await transactionsStore.addTransaction({
        type: TransactionType.TOPUP_ONCHAIN,
        amount: amountRequested,
        fee: 0,
        unit,
        data: JSON.stringify(transactionData),
        memo,
        mint: mintUrl,
        status: TransactionStatus.DRAFT,
    })
    if (!transaction) {
        throw new ValidationError('Failed to create onchain topup transaction')
    }

    try {
        // Burn a NUT-20 index and derive the quote-locking key. The index is committed
        // to the database before it is used, so a failure below can only SKIP an index,
        // never reuse one. The privkey is NOT persisted — only the index is, and the key
        // is re-derived from the seed when it is time to sign.
        const seed: Uint8Array = await walletStore.getCachedSeed()
        const {index: counterIndex, pubkey} = allocateQuoteKeypair(seed)

        const quoteResponse = await walletStore.createOnchainMintQuote(mintUrl, unit, pubkey)
        const address = quoteResponse.request

        // Persist the quote BEFORE showing the address. If the app dies between the two,
        // the row (with its counterIndex) is already safe, so a deposit to that address
        // stays mintable. Losing it would make the money unspendable.
        Database.addOnchainMintQuote({
            // The stable reference. mintUrl is stored alongside it purely as the
            // record of where this quote was created — the mint may move, and this
            // row outlives the move.
            mintId: mintsStore.findByUrl(mintUrl)?.id,
            quote: quoteResponse.quote,
            mintUrl,
            unit,
            address,
            counterIndex,
            pubkey,
            amountRequested,
            expiry: quoteResponse.expiry ?? null,
        })

        const persisted = Database.getOnchainMintQuote(quoteResponse.quote)
        if (!persisted) {
            throw new MintError('Onchain quote could not be persisted', {
                quote: quoteResponse.quote,
            })
        }
        const watchUntil = new Date(persisted.watchUntil)

        // ── PREPARED: the mint has answered and the quote is safely stored ───
        //
        // Transient, exactly as it is for bolt11 (topupTask calls prepare() and
        // execute() back to back). It is a crash marker, not a state a user sits in:
        // it says the address exists and is persisted, but the transaction is not yet
        // the one the watcher will settle onto.
        //
        // Onchain has no "arm the watcher" step to separate PREPARED from PENDING the
        // way bolt11 does — the watcher is driven by the quote row, so persisting the
        // quote IS the registration. The state is kept anyway so the lifecycle reads
        // the same across every operation, and so a crash here is legible.
        transactionData.push({
            status: TransactionStatus.PREPARED,
            quote: quoteResponse.quote,
            address,
            counterIndex,
            createdAt: new Date(),
        })

        transaction.update({
            status: TransactionStatus.PREPARED,
            quote: quoteResponse.quote,
            paymentRequest: address,
            expiresAt: watchUntil,
            data: JSON.stringify(transactionData),
        })

        // ── PENDING: the address is live and we are waiting to be paid ───────
        //
        // PENDING, not PREPARED, is what "waiting for a deposit" must be: pendingHistory
        // filters on PENDING alone, so anything else would drop this topup out of the
        // pending list — the exact place a user goes looking for it.
        transactionData.push({
            status: TransactionStatus.PENDING,
            createdAt: new Date(),
        })

        transaction.update({
            status: TransactionStatus.PENDING,
            data: JSON.stringify(transactionData),
        })

        log.debug('[OnchainTopupOperationApi.createQuote]', {
            transactionId: transaction.id,
            quote: quoteResponse.quote,
            address,
            amountRequested,
        })

        return {
            transactionId: transaction.id,
            tx: transaction,
            address,
            quote: quoteResponse.quote,
            amountRequested,
            watchUntil,
        }
    } catch (e: any) {
        // Leave the failure on the record rather than dropping it. Mirrors how
        // topupTask marks a failed bolt11 prepare/execute.
        transactionData.push({
            status: TransactionStatus.ERROR,
            error: WalletUtils.formatError(e),
            createdAt: new Date(),
        })

        transaction.update({
            status: TransactionStatus.ERROR,
            data: JSON.stringify(transactionData),
        })

        throw e
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// refreshQuote()
// ─────────────────────────────────────────────────────────────────────────────

export type RefreshOnchainQuoteResult = {
    quote: string
    amountPaid: number
    amountIssued: number
    /** Ecash actually minted during THIS refresh. 0 when nothing new arrived. */
    minted: number
    transactionId?: number
}


/**
 * Re-check a quote against the mint and mint anything credited but not yet issued.
 *
 * Safe to call repeatedly and concurrently-ish: amounts are written monotonically,
 * and the mintable balance is recomputed from the mint's own numbers each time, so
 * a duplicate run finds nothing to do rather than minting twice.
 */
async function refreshQuote(quoteId: string): Promise<RefreshOnchainQuoteResult> {
    const row = Database.getOnchainMintQuote(quoteId)
    if (!row) {
        throw new ValidationError('Unknown onchain mint quote', {quote: quoteId})
    }

    const mint = _resolveQuoteMint(row)
    const quoteResponse = await walletStore.checkOnchainMintQuote(mint.mintUrl, quoteId)

    const amountPaid = Number(quoteResponse.amount_paid ?? 0)
    const amountIssued = Number(quoteResponse.amount_issued ?? 0)

    Database.updateOnchainMintQuoteAmounts(quoteId, amountPaid, amountIssued)

    const mintable = mintableAmount(amountPaid, amountIssued)

    log.trace('[OnchainTopupOperationApi.refreshQuote]', {
        quote: quoteId,
        amountPaid,
        amountIssued,
        mintable,
    })

    if (mintable <= 0) {
        return {quote: quoteId, amountPaid, amountIssued, minted: 0}
    }

    const transactionId = await _mintAvailable(row, mint, quoteResponse, mintable)

    return {
        quote: quoteId,
        amountPaid,
        amountIssued: amountIssued + mintable,
        minted: mintable,
        transactionId,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Private
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a quote's owning mint through its stable id.
 *
 * `row.mintUrl` is deliberately NOT consulted. It records where the quote was
 * created, and a mint that has since moved would leave it pointing at a host that
 * no longer answers — while this quote's address stays creditable for as long as
 * the mint exists (rows here are never deleted), so a late deposit would be
 * unmintable forever, and silently, because the watcher swallows errors by design.
 *
 * A missing mint means it was removed from the wallet (or, on a row from before
 * v33 that the v38 backfill could not match, that its url had already moved on).
 * Either way there is nothing to talk to, so this throws rather than guessing.
 */
function _resolveQuoteMint(row: OnchainMintQuoteRecord): Mint {
    const mint = row.mintId ? mintsStore.findById(row.mintId) : undefined

    if (!mint) {
        throw new ValidationError('Onchain quote has no mint in this wallet', {
            quote: row.quote,
            mintId: row.mintId,
            createdAtUrl: row.mintUrl,
        })
    }

    return mint
}

/**
 * Mint the available balance on a quote and settle it onto a transaction.
 *
 * Reuses the quote's PENDING transaction if there is one (the usual case: the user
 * created the quote, the deposit landed). Otherwise creates a fresh one — that is
 * the second-deposit case, where the original transaction has already COMPLETED and
 * this money is genuinely a new receipt.
 */
async function _mintAvailable(
    row: OnchainMintQuoteRecord,
    mintInstance: Mint,
    quoteResponse: any,
    mintable: number,
): Promise<number> {
    const {quote, counterIndex} = row
    const unit = row.unit as MintUnit

    // The mint resolved from row.mintId by the caller — NOT row.mintUrl, which is
    // only where the quote was created and may since have moved.
    const mintUrl = mintInstance.mintUrl

    // The mint may cap a single mint operation; never ask for more than it allows.
    // Any remainder stays credited on the quote, where the watch rule keeps it
    // visible and the next sweep takes the rest.
    const maxAmount = mintInstance.mintMethodSetting!('onchain', unit)?.max_amount
    const amount = capMintAmount(mintable, maxAmount ? Number(maxAmount) : null)

    // Re-derive the NUT-20 signing key from the seed. Only the index was persisted.
    const seed: Uint8Array = await walletStore.getCachedSeed()
    const {privkey} = deriveQuoteKeypair(seed, counterIndex)

    const tx = await _findOrCreateTransaction(row, mintUrl, amount, unit)
    const transactionId = tx.id

    let proofs: CashuProof[] = []
    try {
        proofs = await walletStore.mintOnchainProofs(
            mintUrl,
            amount,
            unit,
            quoteResponse,
            privkey,
            transactionId,
        )
    } catch (e: any) {
        if (WalletUtils.shouldHealOutputsError(e)) {
            log.error('[_mintAvailable] Healing outdated proofsCounter and repeating mint.')
            proofs = await walletStore.mintOnchainProofs(
                mintUrl,
                amount,
                unit,
                quoteResponse,
                privkey,
                transactionId,
                {increaseCounterBy: 10},
            )
        } else {
            throw e
        }
    }

    if (proofs.length === 0) {
        throw new MintError('Mint returned no proofs for a confirmed onchain deposit', {
            transactionId,
            quote,
        })
    }

    const mintedAmount = proofs.reduce((acc, p) => acc + Number(p.amount), 0)
    const currentSpendable = proofsStore.getUnitBalance(unit)?.unitBalance ?? 0
    const balanceAfter = currentSpendable + mintedAmount

    const txData: TransactionData[] = _parseData(tx)
    txData.push({
        status: TransactionStatus.COMPLETED,
        amountMinted: mintedAmount,
        createdAt: new Date(),
    })

    // Empty reservation used purely as the atomic-commit primitive: proofs INSERT and
    // tx UPDATE land in one SQLite transaction. Nothing local is locked for a topup.
    const reservation = proofsStore.reserve([], {
        transactionId,
        mintUrl,
        unit,
        operationType: 'onchain-topup-mint',
        rollbackTo: 'UNSPENT',
    })

    proofsStore.commitReservation(reservation, {
        newProofs: [{proofs, state: 'UNSPENT', tId: transactionId}],
        transactionUpdate: {
            id: transactionId,
            status: TransactionStatus.COMPLETED,
            // The settled amount, NOT the amount the user asked for. The sender may
            // have under- or overpaid, and history has to show what actually arrived.
            amount: mintedAmount,
            data: JSON.stringify(txData),
            balanceAfter,
        },
    })

    Database.updateOnchainMintQuoteAmounts(
        quote,
        Number(quoteResponse.amount_paid ?? 0),
        Number(quoteResponse.amount_issued ?? 0) + mintedAmount,
    )

    sendTopupNotification(mintedAmount, unit)

    log.debug('[OnchainTopupOperationApi._mintAvailable] Minted', {
        transactionId,
        quote,
        mintedAmount,
    })

    return transactionId
}

/**
 * The PENDING transaction waiting on this quote, or a new one.
 *
 * A second deposit to an address whose transaction already COMPLETED is a genuinely
 * new receipt and gets its own transaction — an amount that mutates after
 * completion would make `balanceAfter` meaningless and read as a rewrite of history.
 */
async function _findOrCreateTransaction(
    row: OnchainMintQuoteRecord,
    /** The mint's url NOW (resolved from row.mintId), not row.mintUrl. */
    mintUrl: string,
    amount: number,
    unit: MintUnit,
): Promise<Transaction> {
    const last = transactionsStore.findLastBy({quote: row.quote})

    // PREPARED counts as reusable, not just PENDING. createQuote passes through it on
    // the way to PENDING, so a crash in that window leaves a PREPARED row for this
    // quote — and settling onto a NEW transaction instead would leave the user with two
    // rows for one deposit.
    if (
        last &&
        last.type === TransactionType.TOPUP_ONCHAIN &&
        (last.status === TransactionStatus.PENDING ||
            last.status === TransactionStatus.PREPARED)
    ) {
        return last
    }

    const transactionData: TransactionData[] = [
        {
            status: TransactionStatus.PENDING,
            amountToTopup: amount,
            unit,
            quote: row.quote,
            address: row.address,
            method: 'onchain',
            note: 'Additional deposit to an existing onchain address',
            createdAt: new Date(),
        },
    ]

    const tx = await transactionsStore.addTransaction({
        type: TransactionType.TOPUP_ONCHAIN,
        amount,
        fee: 0,
        unit,
        data: JSON.stringify(transactionData),
        // Where this deposit is being settled NOW. A second deposit onto an old
        // address is still a payment to the mint at its current url, and this row is
        // brand new — it has no history to preserve.
        mint: mintUrl,
        status: TransactionStatus.PENDING,
    })

    if (!tx) {
        throw new ValidationError('Failed to create onchain topup transaction', {
            quote: row.quote,
        })
    }

    tx.update({quote: row.quote, paymentRequest: row.address})

    return tx
}

function _parseData(tx: Transaction): TransactionData[] {
    try {
        return JSON.parse(tx.data) as TransactionData[]
    } catch {
        return []
    }
}

export const OnchainTopupOperationApi = {
    createQuote,
    refreshQuote,
}
