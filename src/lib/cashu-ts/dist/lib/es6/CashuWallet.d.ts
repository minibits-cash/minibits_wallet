import { CashuMint } from './CashuMint.js';
import { AmountPreference, MintKeys, PayLnInvoiceResponse, PaymentPayload, Proof, ReceiveResponse, ReceiveTokenEntryResponse, SendResponse, TokenEntry } from './model/types/index.js';
/**
 * Class that represents a Cashu wallet.
 * This class should act as the entry point for this library
 */
declare class CashuWallet {
    private _keys;
    private _keysetId;
    mint: CashuMint;
    /**
     * @param keys public keys from the mint
     * @param mint Cashu mint instance is used to make api calls
     */
    constructor(mint: CashuMint, keys?: MintKeys);
    get keys(): MintKeys;
    set keys(keys: MintKeys);
    get keysetId(): string;
    /**
     * returns proofs that are already spent (use for keeping wallet state clean)
     * @param proofs (only the 'secret' field is required)
     * @returns
     */
    checkProofsSpent<T extends {
        secret: string;
    }>(proofs: Array<T>): Promise<Array<T>>;
    /**
     * Starts a minting process by requesting an invoice from the mint
     * @param amount Amount requesting for mint.
     * @returns the mint will create and return a Lightning invoice for the specified amount
     */
    requestMint(amount: number): Promise<import("./model/types/index.js").RequestMintResponse>;
    /**
     * Executes a payment of an invoice on the Lightning network.
     * The combined amount of Proofs has to match the payment amount including fees.
     * @param invoice
     * @param proofsToSend the exact amount to send including fees
     * @param feeReserve? optionally set LN routing fee reserve. If not set, fee reserve will get fetched at mint
     */
    payLnInvoice(invoice: string, proofsToSend: Array<Proof>, feeReserve?: number): Promise<PayLnInvoiceResponse>;
    /**
     * Estimate fees for a given LN invoice
     * @param invoice LN invoice that needs to get a fee estimate
     * @returns estimated Fee
     */
    getFee(invoice: string): Promise<number>;
    createPaymentPayload(invoice: string, proofs: Array<Proof>): PaymentPayload;
    /**
     * Use a cashu token to pay an ln invoice
     * @param invoice Lightning invoice
     * @param token cashu token
     */
    payLnInvoiceWithToken(invoice: string, token: string): Promise<PayLnInvoiceResponse>;
    /**
     * Receive an encoded Cashu token
     * @param encodedToken Cashu token
     * @param preference optional preference for splitting proofs into specific amounts
     * @returns New token with newly created proofs, token entries that had errors, and newKeys if they have changed
     */
    receive(encodedToken: string, preference?: Array<AmountPreference>): Promise<ReceiveResponse>;
    /**
     * Receive a single cashu token entry
     * @param tokenEntry a single entry of a cashu token
     * @param preference optional preference for splitting proofs into specific amounts.
     * @returns New token entry with newly created proofs, proofs that had errors, and newKeys if they have changed
     */
    receiveTokenEntry(tokenEntry: TokenEntry, preference?: Array<AmountPreference>): Promise<ReceiveTokenEntryResponse>;
    /**
     * Splits and creates sendable tokens
     * if no amount is specified, the amount is implied by the cumulative amount of all proofs
     * if both amount and preference are set, but the preference cannot fulfill the amount, then we use the default split
     * @param amount amount to send while performing the optimal split (least proofs possible). can be set to undefined if preference is set
     * @param proofs proofs matching that amount
     * @param preference optional preference for splitting proofs into specific amounts. overrides amount param
     * @returns promise of the change- and send-proofs
     */
    send(amount: number, proofs: Array<Proof>, preference?: Array<AmountPreference>): Promise<SendResponse>;
    /**
     * Request tokens from the mint
     * @param amount amount to request
     * @param hash hash to use to identify the request
     * @returns proofs and newKeys if they have changed
     */
    requestTokens(amount: number, hash: string, AmountPreference?: Array<AmountPreference>): Promise<{
        proofs: Array<Proof>;
        newKeys?: MintKeys;
    }>;
    /**
     * Initialize the wallet with the mints public keys
     */
    private initKeys;
    /**
     * Check if the keysetId has changed and return the new keys
     * @param promises array of promises to check
     * @returns new keys if they have changed
     */
    private changedKeys;
    /**
     * Get the mint's public keys for a given set of proofs
     * @param arr array of proofs
     * @param mint optional mint url
     * @returns keys
     */
    private getKeys;
    /**
     * Creates a split payload
     * @param amount1 amount to keep
     * @param amount2 amount to send
     * @param proofsToSend proofs to split
     * @returns
     */
    private createSplitPayload;
    private splitReceive;
    /**
     * Creates blinded messages for a given amount
     * @param amount amount to create blinded messages for
     * @returns blinded messages, secrets, rs, and amounts
     */
    private createRandomBlindedMessages;
    /**
     * Creates NUT-08 blank outputs (fee returns) for a given fee reserve
     * See: https://github.com/cashubtc/nuts/blob/main/08.md
     * @param feeReserve amount to cover with blank outputs
     * @returns blinded messages, secrets, and rs
     */
    private createBlankOutputs;
}
export { CashuWallet };
