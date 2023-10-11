var BlindedMessage = /** @class */ (function () {
    function BlindedMessage(amount, B_) {
        this.amount = amount;
        this.B_ = B_;
    }
    BlindedMessage.prototype.getSerializedBlindedMessage = function () {
        return { amount: this.amount, B_: this.B_.toHex(true) };
    };
    return BlindedMessage;
}());
export { BlindedMessage };
//# sourceMappingURL=BlindedMessage.js.map