import { CheckSpendablePayload, CheckSpendableResponse, GetInfoResponse, MeltPayload, MeltResponse, MintKeys, RequestMintResponse, SerializedBlindedMessage, SerializedBlindedSignature, SplitPayload, SplitResponse } from './model/types/index.js';
import request from './request.js';
/**
 * Class represents Cashu Mint API. This class contains Lower level functions that are implemented by CashuWallet.
 */
declare class CashuMint {
    private _mintUrl;
    private _customRequest?;
    /**
     * @param _mintUrl requires mint URL to create this object
     * @param _customRequest if passed, use custom request implementation for network communication with the mint
     */
    constructor(_mintUrl: string, _customRequest?: typeof request | undefined);
    get mintUrl(): string;
    /**
     * fetches mints info at the /info endpoint
     * @param mintUrl
     */
    static getInfo(mintUrl: string, customRequest?: typeof request): Promise<GetInfoResponse>;
    /**
     * fetches mints info at the /info endpoint
     */
    getInfo(): Promise<GetInfoResponse>;
    /**
     * Starts a minting process by requesting an invoice from the mint
     * @param mintUrl
     * @param amount Amount requesting for mint.
     * @returns the mint will create and return a Lightning invoice for the specified amount
     */
    static requestMint(mintUrl: string, amount: number, customRequest?: typeof request): Promise<RequestMintResponse>;
    /**
     * Starts a minting process by requesting an invoice from the mint
     * @param amount Amount requesting for mint.
     * @returns the mint will create and return a Lightning invoice for the specified amount
     */
    requestMint(amount: number): Promise<RequestMintResponse>;
    /**
     * Requests the mint to perform token minting after the LN invoice has been paid
     * @param mintUrl
     * @param payloads outputs (Blinded messages) that can be written
     * @param hash hash (id) used for by the mint to keep track of wether the invoice has been paid yet
     * @returns serialized blinded signatures
     */
    static mint(mintUrl: string, payloads: {
        outputs: Array<SerializedBlindedMessage>;
    }, hash: string, customRequest?: typeof request): Promise<{
        promises: Array<SerializedBlindedSignature>;
    }>;
    /**
     * Requests the mint to perform token minting after the LN invoice has been paid
     * @param payloads outputs (Blinded messages) that can be written
     * @param hash hash (id) used for by the mint to keep track of wether the invoice has been paid yet
     * @returns serialized blinded signatures
     */
    mint(payloads: {
        outputs: Array<SerializedBlindedMessage>;
    }, hash: string): Promise<{
        promises: SerializedBlindedSignature[];
    }>;
    /**
     * Get the mints public keys
     * @param mintUrl
     * @param keysetId optional param to get the keys for a specific keyset. If not specified, the keys from the active keyset are fetched
     * @returns
     */
    static getKeys(mintUrl: string, keysetId?: string, customRequest?: typeof request): Promise<MintKeys>;
    /**
     * Get the mints public keys
     * @param keysetId optional param to get the keys for a specific keyset. If not specified, the keys from the active keyset are fetched
     * @returns the mints public keys
     */
    getKeys(keysetId?: string): Promise<MintKeys>;
    /**
     * Get the mints keysets in no specific order
     * @param mintUrl
     * @returns all the mints past and current keysets.
     */
    static getKeySets(mintUrl: string, customRequest?: typeof request): Promise<{
        keysets: Array<string>;
    }>;
    /**
     * Get the mints keysets in no specific order
     * @returns all the mints past and current keysets.
     */
    getKeySets(): Promise<{
        keysets: Array<string>;
    }>;
    /**
     * Ask mint to perform a split operation
     * @param mintUrl
     * @param splitPayload data needed for performing a token split
     * @returns split tokens
     */
    static split(mintUrl: string, splitPayload: SplitPayload, customRequest?: typeof request): Promise<SplitResponse>;
    /**
     * Ask mint to perform a split operation
     * @param splitPayload data needed for performing a token split
     * @returns split tokens
     */
    split(splitPayload: SplitPayload): Promise<SplitResponse>;
    /**
     * Ask mint to perform a melt operation. This pays a lightning invoice and destroys tokens matching its amount + fees
     * @param mintUrl
     * @param meltPayload
     * @returns
     */
    static melt(mintUrl: string, meltPayload: MeltPayload, customRequest?: typeof request): Promise<MeltResponse>;
    /**
     * Ask mint to perform a melt operation. This pays a lightning invoice and destroys tokens matching its amount + fees
     * @param meltPayload
     * @returns
     */
    melt(meltPayload: MeltPayload): Promise<MeltResponse>;
    /**
     * Estimate fees for a given LN invoice
     * @param mintUrl
     * @param checkfeesPayload Payload containing LN invoice that needs to get a fee estimate
     * @returns estimated Fee
     */
    static checkFees(mintUrl: string, checkfeesPayload: {
        pr: string;
    }, customRequest?: typeof request): Promise<{
        fee: number;
    }>;
    /**
     * Estimate fees for a given LN invoice
     * @param mintUrl
     * @param checkfeesPayload Payload containing LN invoice that needs to get a fee estimate
     * @returns estimated Fee
     */
    checkFees(checkfeesPayload: {
        pr: string;
    }): Promise<{
        fee: number;
    }>;
    /**
     * Checks if specific proofs have already been redeemed
     * @param mintUrl
     * @param checkPayload
     * @returns redeemed and unredeemed ordered list of booleans
     */
    static check(mintUrl: string, checkPayload: CheckSpendablePayload, customRequest?: typeof request): Promise<CheckSpendableResponse>;
    /**
     * Checks if specific proofs have already been redeemed
     * @param checkPayload
     * @returns redeemed and unredeemed ordered list of booleans
     */
    check(checkPayload: CheckSpendablePayload): Promise<CheckSpendableResponse>;
}
export { CashuMint };
