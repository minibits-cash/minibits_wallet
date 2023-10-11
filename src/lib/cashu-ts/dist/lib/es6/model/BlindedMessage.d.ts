import { SerializedBlindedMessage } from './types/index.js';
import { ProjPointType } from '@noble/curves/abstract/weierstrass';
declare class BlindedMessage {
    amount: number;
    B_: ProjPointType<bigint>;
    constructor(amount: number, B_: ProjPointType<bigint>);
    getSerializedBlindedMessage(): SerializedBlindedMessage;
}
export { BlindedMessage };
