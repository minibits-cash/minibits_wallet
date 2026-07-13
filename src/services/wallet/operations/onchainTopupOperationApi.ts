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
 *   createQuote()  → PENDING transaction + persisted quote (address to show)
 *   refreshQuote() → re-check the mint; if anything is credited but not yet
 *                    minted, mint it and settle a transaction. Called by the
 *                    watcher (onchainOperations) and by the user's manual
 *                    "check for deposits".
 *
 * There is no PREPARED step and no cancel-to-reclaim: nothing local is locked
 * while we wait, because the "lock" is a mint-side address.
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
        throw new MintError('Onchain quote could not be persisted', {quote: quoteResponse.quote})
    }
    const watchUntil = new Date(persisted.watchUntil)

    const transactionData: TransactionData[] = [
        {
            status: TransactionStatus.PENDING,
            amountToTopup: amountRequested,
            unit,
            quote: quoteResponse.quote,
            address,
            method: 'onchain',
            createdAt: new Date(),
        },
    ]

    // Straight to PENDING: unlike bolt11 there is no PREPARED step, because nothing
    // is reserved locally while we wait — the address IS the pending state. The
    // amount is the user's hint and will be overwritten by what actually arrives.
    const transaction = await transactionsStore.addTransaction({
        type: TransactionType.TOPUP_ONCHAIN,
        amount: amountRequested,
        fee: 0,
        unit,
        data: JSON.stringify(transactionData),
        memo,
        mint: mintUrl,
        status: TransactionStatus.PENDING,
    })
    if (!transaction) {
        throw new ValidationError('Failed to create onchain topup transaction')
    }

    transaction.update({
        quote: quoteResponse.quote,
        paymentRequest: address,
        expiresAt: watchUntil,
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

    const quoteResponse = await walletStore.checkOnchainMintQuote(row.mintUrl, quoteId)

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

    const transactionId = await _mintAvailable(row, quoteResponse, mintable)

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
 * Mint the available balance on a quote and settle it onto a transaction.
 *
 * Reuses the quote's PENDING transaction if there is one (the usual case: the user
 * created the quote, the deposit landed). Otherwise creates a fresh one — that is
 * the second-deposit case, where the original transaction has already COMPLETED and
 * this money is genuinely a new receipt.
 */
async function _mintAvailable(
    row: OnchainMintQuoteRecord,
    quoteResponse: any,
    mintable: number,
): Promise<number> {
    const {quote, mintUrl, counterIndex} = row
    const unit = row.unit as MintUnit

    // The mint may cap a single mint operation; never ask for more than it allows.
    // Any remainder stays credited on the quote, where the watch rule keeps it
    // visible and the next sweep takes the rest.
    const mintInstance = mintsStore.findByUrl(mintUrl)
    const maxAmount = mintInstance?.mintMethodSetting!('onchain', unit)?.max_amount
    const amount = capMintAmount(mintable, maxAmount ? Number(maxAmount) : null)

    // Re-derive the NUT-20 signing key from the seed. Only the index was persisted.
    const seed: Uint8Array = await walletStore.getCachedSeed()
    const {privkey} = deriveQuoteKeypair(seed, counterIndex)

    const tx = await _findOrCreateTransaction(row, amount, unit)
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
    amount: number,
    unit: MintUnit,
): Promise<Transaction> {
    const last = transactionsStore.findLastBy({quote: row.quote})

    if (
        last &&
        last.type === TransactionType.TOPUP_ONCHAIN &&
        last.status === TransactionStatus.PENDING
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
        mint: row.mintUrl,
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
