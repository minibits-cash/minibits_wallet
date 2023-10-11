import { secp256k1 } from '@noble/curves/secp256k1';
import { encodeUint8toBase64 } from './base64.js';
import { bytesToNumber } from './utils.js';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/curves/abstract/utils';
function hashToCurve(secret) {
    var point;
    while (!point) {
        var hash = sha256(secret);
        var hashHex = bytesToHex(hash);
        var pointX = '02' + hashHex;
        try {
            point = pointFromHex(pointX);
        }
        catch (error) {
            secret = sha256(secret);
        }
    }
    return point;
}
export function pointFromHex(hex) {
    return secp256k1.ProjectivePoint.fromHex(hex);
}
/* export function h2cToPoint(h2c: H2CPoint<bigint>): ProjPointType<bigint> {
    return secp256k1.ProjectivePoint.fromAffine(h2c.toAffine());
} */
function blindMessage(secret, r) {
    var secretMessageBase64 = encodeUint8toBase64(secret);
    var secretMessage = new TextEncoder().encode(secretMessageBase64);
    var Y = hashToCurve(secretMessage);
    if (!r) {
        r = bytesToNumber(secp256k1.utils.randomPrivateKey());
    }
    var rG = secp256k1.ProjectivePoint.BASE.multiply(r);
    var B_ = Y.add(rG);
    return { B_: B_, r: r };
}
function unblindSignature(C_, r, A) {
    var C = C_.subtract(A.multiply(r));
    return C;
}
function constructProofs(promises, rs, secrets, keys) {
    return promises.map(function (p, i) {
        var C_ = pointFromHex(p.C_);
        var A = pointFromHex(keys[p.amount]);
        var C = unblindSignature(C_, rs[i], A);
        var proof = {
            id: p.id,
            amount: p.amount,
            secret: encodeUint8toBase64(secrets[i]),
            C: C.toHex(true)
        };
        return proof;
    });
}
export { hashToCurve, blindMessage, unblindSignature, constructProofs };
//# sourceMappingURL=DHKE.js.map