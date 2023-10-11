import {
	CheckSpendablePayload,
	CheckSpendableResponse,
	GetInfoResponse,
	MeltPayload,
	MeltResponse,
	MintKeys,
	RequestMintResponse,
	SerializedBlindedMessage,
	SerializedBlindedSignature,
	SplitPayload,
	SplitResponse
} from './model/types/index.js';
import request from './request.js';
import { isObj, joinUrls } from './utils.js';

/**
 * Class represents Cashu Mint API. This class contains Lower level functions that are implemented by CashuWallet.
 */
class CashuMint {
	/**
	 * @param _mintUrl requires mint URL to create this object
	 * @param _customRequest if passed, use custom request implementation for network communication with the mint
	 */
	constructor(
		private _mintUrl: string,
		private _customRequest?: typeof request
	) {}

	get mintUrl() {
		return this._mintUrl;
	}

	/**
	 * fetches mints info at the /info endpoint
	 * @param mintUrl
	 */
	public static async getInfo(
		mintUrl: string,
		customRequest?: typeof request
	): Promise<GetInfoResponse> {
		const requestInstance = customRequest || request;
		return requestInstance<GetInfoResponse>({ endpoint: joinUrls(mintUrl, 'info') });
	}
	/**
	 * fetches mints info at the /info endpoint
	 */
	async getInfo(): Promise<GetInfoResponse> {
		return CashuMint.getInfo(this._mintUrl, this._customRequest);
	}
	/**
	 * Starts a minting process by requesting an invoice from the mint
	 * @param mintUrl
	 * @param amount Amount requesting for mint.
	 * @returns the mint will create and return a Lightning invoice for the specified amount
	 */
	public static async requestMint(
		mintUrl: string,
		amount: number,
		customRequest?: typeof request
	): Promise<RequestMintResponse> {
		const requestInstance = customRequest || request;
		return requestInstance<RequestMintResponse>({
			endpoint: `${joinUrls(mintUrl, 'mint')}?amount=${amount}`
		});
	}

	/**
	 * Starts a minting process by requesting an invoice from the mint
	 * @param amount Amount requesting for mint.
	 * @returns the mint will create and return a Lightning invoice for the specified amount
	 */
	async requestMint(amount: number): Promise<RequestMintResponse> {
		return CashuMint.requestMint(this._mintUrl, amount, this._customRequest);
	}
	/**
	 * Requests the mint to perform token minting after the LN invoice has been paid
	 * @param mintUrl
	 * @param payloads outputs (Blinded messages) that can be written
	 * @param hash hash (id) used for by the mint to keep track of wether the invoice has been paid yet
	 * @returns serialized blinded signatures
	 */
	public static async mint(
		mintUrl: string,
		payloads: { outputs: Array<SerializedBlindedMessage> },
		hash: string,
		customRequest?: typeof request
	) {
		const requestInstance = customRequest || request;
		const data = await requestInstance<{ promises: Array<SerializedBlindedSignature> }>({
			endpoint: `${joinUrls(mintUrl, 'mint')}?hash=${hash}`,
			method: 'POST',
			requestBody: payloads
		});

		if (!isObj(data) || !Array.isArray(data?.promises)) {
			throw new Error('bad response');
		}

		return data;
	}
	/**
	 * Requests the mint to perform token minting after the LN invoice has been paid
	 * @param payloads outputs (Blinded messages) that can be written
	 * @param hash hash (id) used for by the mint to keep track of wether the invoice has been paid yet
	 * @returns serialized blinded signatures
	 */
	async mint(payloads: { outputs: Array<SerializedBlindedMessage> }, hash: string) {
		return CashuMint.mint(this._mintUrl, payloads, hash, this._customRequest);
	}
	/**
	 * Get the mints public keys
	 * @param mintUrl
	 * @param keysetId optional param to get the keys for a specific keyset. If not specified, the keys from the active keyset are fetched
	 * @returns
	 */
	public static async getKeys(
		mintUrl: string,
		keysetId?: string,
		customRequest?: typeof request
	): Promise<MintKeys> {
		if (keysetId) {
			// make the keysetId url safe
			keysetId = keysetId.replace(/\//g, '_').replace(/\+/g, '-');
		}
		const requestInstance = customRequest || request;
		return requestInstance<MintKeys>({
			endpoint: keysetId ? joinUrls(mintUrl, 'keys', keysetId) : joinUrls(mintUrl, 'keys')
		});
	}
	/**
	 * Get the mints public keys
	 * @param keysetId optional param to get the keys for a specific keyset. If not specified, the keys from the active keyset are fetched
	 * @returns the mints public keys
	 */
	async getKeys(keysetId?: string): Promise<MintKeys> {
		return CashuMint.getKeys(this._mintUrl, keysetId, this._customRequest);
	}
	/**
	 * Get the mints keysets in no specific order
	 * @param mintUrl
	 * @returns all the mints past and current keysets.
	 */
	public static async getKeySets(
		mintUrl: string,
		customRequest?: typeof request
	): Promise<{ keysets: Array<string> }> {
		const requestInstance = customRequest || request;
		return requestInstance<{ keysets: Array<string> }>({ endpoint: joinUrls(mintUrl, 'keysets') });
	}

	/**
	 * Get the mints keysets in no specific order
	 * @returns all the mints past and current keysets.
	 */
	async getKeySets(): Promise<{ keysets: Array<string> }> {
		return CashuMint.getKeySets(this._mintUrl, this._customRequest);
	}

	/**
	 * Ask mint to perform a split operation
	 * @param mintUrl
	 * @param splitPayload data needed for performing a token split
	 * @returns split tokens
	 */
	public static async split(
		mintUrl: string,
		splitPayload: SplitPayload,
		customRequest?: typeof request
	): Promise<SplitResponse> {
		const requestInstance = customRequest || request;
		const data = await requestInstance<SplitResponse>({
			endpoint: joinUrls(mintUrl, 'split'),
			method: 'POST',
			requestBody: splitPayload
		});

		if (!isObj(data) || !Array.isArray(data?.promises)) {
			throw new Error('bad response');
		}

		return data;
	}
	/**
	 * Ask mint to perform a split operation
	 * @param splitPayload data needed for performing a token split
	 * @returns split tokens
	 */
	async split(splitPayload: SplitPayload): Promise<SplitResponse> {
		return CashuMint.split(this._mintUrl, splitPayload, this._customRequest);
	}
	/**
	 * Ask mint to perform a melt operation. This pays a lightning invoice and destroys tokens matching its amount + fees
	 * @param mintUrl
	 * @param meltPayload
	 * @returns
	 */
	public static async melt(
		mintUrl: string,
		meltPayload: MeltPayload,
		customRequest?: typeof request
	): Promise<MeltResponse> {
		const requestInstance = customRequest || request;
		const data = await requestInstance<MeltResponse>({
			endpoint: joinUrls(mintUrl, 'melt'),
			method: 'POST',
			requestBody: meltPayload
		});

		if (
			!isObj(data) ||
			typeof data?.paid !== 'boolean' ||
			(data?.preimage !== null && typeof data?.preimage !== 'string')
		) {
			throw new Error('bad response');
		}

		return data;
	}
	/**
	 * Ask mint to perform a melt operation. This pays a lightning invoice and destroys tokens matching its amount + fees
	 * @param meltPayload
	 * @returns
	 */
	async melt(meltPayload: MeltPayload): Promise<MeltResponse> {
		return CashuMint.melt(this._mintUrl, meltPayload, this._customRequest);
	}
	/**
	 * Estimate fees for a given LN invoice
	 * @param mintUrl
	 * @param checkfeesPayload Payload containing LN invoice that needs to get a fee estimate
	 * @returns estimated Fee
	 */
	public static async checkFees(
		mintUrl: string,
		checkfeesPayload: { pr: string },
		customRequest?: typeof request
	): Promise<{ fee: number }> {
		const requestInstance = customRequest || request;
		const data = await requestInstance<{ fee: number }>({
			endpoint: joinUrls(mintUrl, 'checkfees'),
			method: 'POST',
			requestBody: checkfeesPayload
		});

		if (!isObj(data) || typeof data?.fee !== 'number') {
			throw new Error('bad response');
		}

		return data;
	}
	/**
	 * Estimate fees for a given LN invoice
	 * @param mintUrl
	 * @param checkfeesPayload Payload containing LN invoice that needs to get a fee estimate
	 * @returns estimated Fee
	 */
	async checkFees(checkfeesPayload: { pr: string }): Promise<{ fee: number }> {
		return CashuMint.checkFees(this._mintUrl, checkfeesPayload, this._customRequest);
	}
	/**
	 * Checks if specific proofs have already been redeemed
	 * @param mintUrl
	 * @param checkPayload
	 * @returns redeemed and unredeemed ordered list of booleans
	 */
	public static async check(
		mintUrl: string,
		checkPayload: CheckSpendablePayload,
		customRequest?: typeof request
	): Promise<CheckSpendableResponse> {
		const requestInstance = customRequest || request;
		const data = await requestInstance<CheckSpendableResponse>({
			endpoint: joinUrls(mintUrl, 'check'),
			method: 'POST',
			requestBody: checkPayload
		});

		if (!isObj(data) || !Array.isArray(data?.spendable)) {
			throw new Error('bad response');
		}

		return data;
	}
	/**
	 * Checks if specific proofs have already been redeemed
	 * @param checkPayload
	 * @returns redeemed and unredeemed ordered list of booleans
	 */
	async check(checkPayload: CheckSpendablePayload): Promise<CheckSpendableResponse> {
		return CashuMint.check(this._mintUrl, checkPayload, this._customRequest);
	}
}

export { CashuMint };
