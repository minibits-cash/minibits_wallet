import { SerializedBlindedMessage } from './types/index.js';
import { ProjPointType } from '@noble/curves/abstract/weierstrass';

class BlindedMessage {
	amount: number;
	B_: ProjPointType<bigint>;
	constructor(amount: number, B_: ProjPointType<bigint>) {
		this.amount = amount;
		this.B_ = B_;
	}
	getSerializedBlindedMessage(): SerializedBlindedMessage {
		return { amount: this.amount, B_: this.B_.toHex(true) };
	}
}
export { BlindedMessage };
