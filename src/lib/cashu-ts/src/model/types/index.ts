/**
 * represents a single Cashu proof.
 */
export type Proof = {
	/**
	 * Keyset id, used to link proofs to a mint an its MintKeys.
	 */
	id: string;
	/**
	 * Amount denominated in Satoshis. Has to match the amount of the mints signing key.
	 */
	amount: number;
	/**
	 * The initial secret that was (randomly) chosen for the creation of this proof.
	 */
	secret: string;
	/**
	 * The unblinded signature for this secret, signed by the mints private key.
	 */
	C: string;
};

/**
 * A mints publickey-set.
 */
export type MintKeys = { [k: number]: string };

/**
 * response when after receiving a single TokenEntry
 */
export type ReceiveTokenEntryResponse = {
	/**
	 * Received proofs
	 */
	proofs: Array<Proof>;
	/**
	 * Proofs that could not be received. Doesn't throw an error, but if this field is populated it should be handled by the implementation accordingly
	 */
	proofsWithError: Array<Proof> | undefined;
	/**
	 * If the mint has rotated keys, this field will be populated with the new keys.
	 */
	newKeys?: MintKeys;
};

/**
 *  response after sending
 */
export type SendResponse = {
	/**
	 * Proofs that exceeded the needed amount
	 */
	returnChange: Array<Proof>;
	/**
	 * Proofs to be sent, matching the chosen amount
	 */
	send: Array<Proof>;
	/**
	 * If the mint has rotated keys, this field will be populated with the new keys.
	 */
	newKeys?: MintKeys;
};
/**
 * Response when receiving a complete token.
 */
export type ReceiveResponse = {
	/**
	 * Successfully received Cashu Token
	 */
	token: Token;
	/**
	 * TokenEntries that had errors. No error will be thrown, but clients can choose to handle tokens with errors accordingly.
	 */
	tokensWithErrors: Token | undefined;
	/**
	 * If the mint has rotated keys, this field will be populated with the new keys.
	 */
	newKeys?: MintKeys;
};

/**
 * Payload that needs to be sent to the mint when paying a lightning invoice.
 */
export type PaymentPayload = {
	/**
	 * Payment request/Lighting invoice that should get paid by the mint.
	 */
	pr: string;
	/**
	 * Proofs, matching Lightning invoices amount + fees.
	 */
	proofs: Array<Proof>;
};

/**
 * Payload that needs to be sent to the mint when melting. Includes Return for overpaid fees
 */
export type MeltPayload = {
	/**
	 * Payment request/Lighting invoice that should get paid by the mint.
	 */
	pr: string;
	/**
	 * Proofs, matching Lightning invoices amount + fees.
	 */
	proofs: Array<Proof>;
	/**
	 * Blank outputs (blinded messages) that can be filled by the mint to return overpaid fees
	 */
	outputs: Array<SerializedBlindedMessage>;
};

/**
 * Response from the mint after paying a lightning invoice (melt)
 */
export type MeltResponse = {
	/**
	 * if false, the proofs have not been invalidated and the payment can be tried later again with the same proofs
	 */
	paid: boolean;
	/**
	 * preimage of the paid invoice. can be null, depending on which LN-backend the mint uses
	 */
	preimage: string | null;
	/**
	 * Return/Change from overpaid fees. This happens due to Lighting fee estimation being inaccurate
	 */
	change?: Array<SerializedBlindedSignature>;
} & ApiError;

/**
 * Response after paying a Lightning invoice
 */
export type PayLnInvoiceResponse = {
	/**
	 * if false, the proofs have not been invalidated and the payment can be tried later again with the same proofs
	 */
	isPaid: boolean;
	/**
	 * preimage of the paid invoice. can be null, depending on which LN-backend the mint uses
	 */
	preimage: string | null;
	/**
	 * Return/Change from overpaid fees. This happens due to Lighting fee estimation being inaccurate
	 */
	change: Array<Proof>;
	/**
	 * If the mint has rotated keys, this field will be populated with the new keys.
	 */
	newKeys?: MintKeys;
};

/**
 * Payload that needs to be sent to the mint when performing a split action
 */
export type SplitPayload = {
	/**
	 * Proofs to be split
	 */
	proofs: Array<Proof>;
	/**
	 * Fresh blinded messages to be signed by the mint to create the split proofs
	 */
	outputs: Array<SerializedBlindedMessage>;
};
/**
 * Response from the mint after performing a split action
 */
export type SplitResponse = {
	/**
	 * represents the outputs after the split
	 */
	promises: Array<SerializedBlindedSignature>;
} & ApiError;

/**
 * Cashu api error
 */
export type ApiError = {
	/**
	 * Error message
	 */
	error?: string;
	/**
	 * HTTP error code
	 */
	code?: number;
	/**
	 * Detailed error message
	 */
	detail?: string;
};

export type RequestMintResponse = {
	pr: string;
	hash: string;
} & ApiError;

/**
 * Payload that needs to be sent to the mint when checking for spendable proofs
 */
export type CheckSpendablePayload = {
	/**
	 * array of proofs. Only the secret is strictly needed.
	 * If the whole object is passed, it will be stripped of other objects before sending it to the mint.
	 */
	proofs: Array<{ secret: string }>;
};

/**
 * Response when checking proofs if they are spendable. Should not rely on this for receiving, since it can be easily cheated.
 */
export type CheckSpendableResponse = {
	/**
	 * Ordered list for checked proofs. True if the secret has not been redeemed at the mint before
	 */
	spendable: Array<boolean>;
} & ApiError;
/**
 * blinded message for sending to the mint
 */
export type SerializedBlindedMessage = {
	/**
	 * amount
	 */
	amount: number;
	/**
	 * Blinded message
	 */
	B_: string;
};
/**
 * Blinded signature as it is received from the mint
 */
export type SerializedBlindedSignature = {
	/**
	 * keyset id for indicating which public key was used to sign the blinded message
	 */
	id: string;
	/**
	 * Amount denominated in Satoshi
	 */
	amount: number;
	/**
	 * Blinded signature
	 */
	C_: string;
};

/**
 * A Cashu token
 */
export type Token = {
	/**
	 * token entries
	 */
	token: Array<TokenEntry>;
	/**
	 * a message to send along with the token
	 */
	memo?: string;
};
/**
 * TokenEntry that stores proofs and mints
 */
export type TokenEntry = {
	/**
	 * a list of proofs
	 */
	proofs: Array<Proof>;
	/**
	 * the mints URL
	 */
	mint: string;
};
/**
 * @deprecated Token V2
 * should no longer be used
 */
export type TokenV2 = {
	proofs: Array<Proof>;
	mints: Array<{ url: string; ids: Array<string> }>;
};

/**
 * Data that the library needs to hold in memory while it awaits the blinded signatures for the mint. It is later used for unblinding the signatures.
 */
export type BlindedTransaction = {
	/**
	 * Blinded messages sent to the mint for signing.
	 */
	blindedMessages: Array<SerializedBlindedMessage>;
	/**
	 * secrets, kept client side for constructing proofs later.
	 */
	secrets: Array<Uint8Array>;
	/**
	 * Blinding factor used for blinding messages and unblinding signatures after they are received from the mint.
	 */
	rs: Array<bigint>;
	/**
	 * amounts denominated in Satoshi
	 */
	amounts: Array<number>;
};

/**
 * Data that the library needs to hold in memory while it awaits the blinded signatures for the mint. It is later used for unblinding the signatures.
 */
export type BlindedMessageData = {
	/**
	 * Blinded messages sent to the mint for signing.
	 */
	blindedMessages: Array<SerializedBlindedMessage>;
	/**
	 * secrets, kept client side for constructing proofs later.
	 */
	secrets: Array<Uint8Array>;
	/**
	 * Blinding factor used for blinding messages and unblinding signatures after they are received from the mint.
	 */
	rs: Array<bigint>;
};

/**
 * Response from mint at /info endpoint
 */
export type GetInfoResponse = {
	name: string;
	pubkey: string;
	version: string;
	description?: string;
	description_long?: string;
	contact: Array<Array<string>>;
	nuts: Array<string>;
	motd?: string;
	parameter: { peg_out_only: boolean };
};

export type AmountPreference = {
	amount: number;
	count: number;
};
