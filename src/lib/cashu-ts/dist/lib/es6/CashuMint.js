var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
import request from './request.js';
import { isObj, joinUrls } from './utils.js';
/**
 * Class represents Cashu Mint API. This class contains Lower level functions that are implemented by CashuWallet.
 */
var CashuMint = /** @class */ (function () {
    /**
     * @param _mintUrl requires mint URL to create this object
     * @param _customRequest if passed, use custom request implementation for network communication with the mint
     */
    function CashuMint(_mintUrl, _customRequest) {
        this._mintUrl = _mintUrl;
        this._customRequest = _customRequest;
    }
    Object.defineProperty(CashuMint.prototype, "mintUrl", {
        get: function () {
            return this._mintUrl;
        },
        enumerable: false,
        configurable: true
    });
    /**
     * fetches mints info at the /info endpoint
     * @param mintUrl
     */
    CashuMint.getInfo = function (mintUrl, customRequest) {
        return __awaiter(this, void 0, void 0, function () {
            var requestInstance;
            return __generator(this, function (_a) {
                requestInstance = customRequest || request;
                return [2 /*return*/, requestInstance({ endpoint: joinUrls(mintUrl, 'info') })];
            });
        });
    };
    /**
     * fetches mints info at the /info endpoint
     */
    CashuMint.prototype.getInfo = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, CashuMint.getInfo(this._mintUrl, this._customRequest)];
            });
        });
    };
    /**
     * Starts a minting process by requesting an invoice from the mint
     * @param mintUrl
     * @param amount Amount requesting for mint.
     * @returns the mint will create and return a Lightning invoice for the specified amount
     */
    CashuMint.requestMint = function (mintUrl, amount, customRequest) {
        return __awaiter(this, void 0, void 0, function () {
            var requestInstance;
            return __generator(this, function (_a) {
                requestInstance = customRequest || request;
                return [2 /*return*/, requestInstance({
                        endpoint: "".concat(joinUrls(mintUrl, 'mint'), "?amount=").concat(amount)
                    })];
            });
        });
    };
    /**
     * Starts a minting process by requesting an invoice from the mint
     * @param amount Amount requesting for mint.
     * @returns the mint will create and return a Lightning invoice for the specified amount
     */
    CashuMint.prototype.requestMint = function (amount) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, CashuMint.requestMint(this._mintUrl, amount, this._customRequest)];
            });
        });
    };
    /**
     * Requests the mint to perform token minting after the LN invoice has been paid
     * @param mintUrl
     * @param payloads outputs (Blinded messages) that can be written
     * @param hash hash (id) used for by the mint to keep track of wether the invoice has been paid yet
     * @returns serialized blinded signatures
     */
    CashuMint.mint = function (mintUrl, payloads, hash, customRequest) {
        return __awaiter(this, void 0, void 0, function () {
            var requestInstance, data;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        requestInstance = customRequest || request;
                        return [4 /*yield*/, requestInstance({
                                endpoint: "".concat(joinUrls(mintUrl, 'mint'), "?hash=").concat(hash),
                                method: 'POST',
                                requestBody: payloads
                            })];
                    case 1:
                        data = _a.sent();
                        if (!isObj(data) || !Array.isArray(data === null || data === void 0 ? void 0 : data.promises)) {
                            throw new Error('bad response');
                        }
                        return [2 /*return*/, data];
                }
            });
        });
    };
    /**
     * Requests the mint to perform token minting after the LN invoice has been paid
     * @param payloads outputs (Blinded messages) that can be written
     * @param hash hash (id) used for by the mint to keep track of wether the invoice has been paid yet
     * @returns serialized blinded signatures
     */
    CashuMint.prototype.mint = function (payloads, hash) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, CashuMint.mint(this._mintUrl, payloads, hash, this._customRequest)];
            });
        });
    };
    /**
     * Get the mints public keys
     * @param mintUrl
     * @param keysetId optional param to get the keys for a specific keyset. If not specified, the keys from the active keyset are fetched
     * @returns
     */
    CashuMint.getKeys = function (mintUrl, keysetId, customRequest) {
        return __awaiter(this, void 0, void 0, function () {
            var requestInstance;
            return __generator(this, function (_a) {
                if (keysetId) {
                    // make the keysetId url safe
                    keysetId = keysetId.replace(/\//g, '_').replace(/\+/g, '-');
                }
                requestInstance = customRequest || request;
                return [2 /*return*/, requestInstance({
                        endpoint: keysetId ? joinUrls(mintUrl, 'keys', keysetId) : joinUrls(mintUrl, 'keys')
                    })];
            });
        });
    };
    /**
     * Get the mints public keys
     * @param keysetId optional param to get the keys for a specific keyset. If not specified, the keys from the active keyset are fetched
     * @returns the mints public keys
     */
    CashuMint.prototype.getKeys = function (keysetId) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, CashuMint.getKeys(this._mintUrl, keysetId, this._customRequest)];
            });
        });
    };
    /**
     * Get the mints keysets in no specific order
     * @param mintUrl
     * @returns all the mints past and current keysets.
     */
    CashuMint.getKeySets = function (mintUrl, customRequest) {
        return __awaiter(this, void 0, void 0, function () {
            var requestInstance;
            return __generator(this, function (_a) {
                requestInstance = customRequest || request;
                return [2 /*return*/, requestInstance({ endpoint: joinUrls(mintUrl, 'keysets') })];
            });
        });
    };
    /**
     * Get the mints keysets in no specific order
     * @returns all the mints past and current keysets.
     */
    CashuMint.prototype.getKeySets = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, CashuMint.getKeySets(this._mintUrl, this._customRequest)];
            });
        });
    };
    /**
     * Ask mint to perform a split operation
     * @param mintUrl
     * @param splitPayload data needed for performing a token split
     * @returns split tokens
     */
    CashuMint.split = function (mintUrl, splitPayload, customRequest) {
        return __awaiter(this, void 0, void 0, function () {
            var requestInstance, data;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        requestInstance = customRequest || request;
                        return [4 /*yield*/, requestInstance({
                                endpoint: joinUrls(mintUrl, 'split'),
                                method: 'POST',
                                requestBody: splitPayload
                            })];
                    case 1:
                        data = _a.sent();
                        if (!isObj(data) || !Array.isArray(data === null || data === void 0 ? void 0 : data.promises)) {
                            throw new Error('bad response');
                        }
                        return [2 /*return*/, data];
                }
            });
        });
    };
    /**
     * Ask mint to perform a split operation
     * @param splitPayload data needed for performing a token split
     * @returns split tokens
     */
    CashuMint.prototype.split = function (splitPayload) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, CashuMint.split(this._mintUrl, splitPayload, this._customRequest)];
            });
        });
    };
    /**
     * Ask mint to perform a melt operation. This pays a lightning invoice and destroys tokens matching its amount + fees
     * @param mintUrl
     * @param meltPayload
     * @returns
     */
    CashuMint.melt = function (mintUrl, meltPayload, customRequest) {
        return __awaiter(this, void 0, void 0, function () {
            var requestInstance, data;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        requestInstance = customRequest || request;
                        return [4 /*yield*/, requestInstance({
                                endpoint: joinUrls(mintUrl, 'melt'),
                                method: 'POST',
                                requestBody: meltPayload
                            })];
                    case 1:
                        data = _a.sent();
                        if (!isObj(data) ||
                            typeof (data === null || data === void 0 ? void 0 : data.paid) !== 'boolean' ||
                            ((data === null || data === void 0 ? void 0 : data.preimage) !== null && typeof (data === null || data === void 0 ? void 0 : data.preimage) !== 'string')) {
                            throw new Error('bad response');
                        }
                        return [2 /*return*/, data];
                }
            });
        });
    };
    /**
     * Ask mint to perform a melt operation. This pays a lightning invoice and destroys tokens matching its amount + fees
     * @param meltPayload
     * @returns
     */
    CashuMint.prototype.melt = function (meltPayload) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, CashuMint.melt(this._mintUrl, meltPayload, this._customRequest)];
            });
        });
    };
    /**
     * Estimate fees for a given LN invoice
     * @param mintUrl
     * @param checkfeesPayload Payload containing LN invoice that needs to get a fee estimate
     * @returns estimated Fee
     */
    CashuMint.checkFees = function (mintUrl, checkfeesPayload, customRequest) {
        return __awaiter(this, void 0, void 0, function () {
            var requestInstance, data;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        requestInstance = customRequest || request;
                        return [4 /*yield*/, requestInstance({
                                endpoint: joinUrls(mintUrl, 'checkfees'),
                                method: 'POST',
                                requestBody: checkfeesPayload
                            })];
                    case 1:
                        data = _a.sent();
                        if (!isObj(data) || typeof (data === null || data === void 0 ? void 0 : data.fee) !== 'number') {
                            throw new Error('bad response');
                        }
                        return [2 /*return*/, data];
                }
            });
        });
    };
    /**
     * Estimate fees for a given LN invoice
     * @param mintUrl
     * @param checkfeesPayload Payload containing LN invoice that needs to get a fee estimate
     * @returns estimated Fee
     */
    CashuMint.prototype.checkFees = function (checkfeesPayload) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, CashuMint.checkFees(this._mintUrl, checkfeesPayload, this._customRequest)];
            });
        });
    };
    /**
     * Checks if specific proofs have already been redeemed
     * @param mintUrl
     * @param checkPayload
     * @returns redeemed and unredeemed ordered list of booleans
     */
    CashuMint.check = function (mintUrl, checkPayload, customRequest) {
        return __awaiter(this, void 0, void 0, function () {
            var requestInstance, data;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        requestInstance = customRequest || request;
                        return [4 /*yield*/, requestInstance({
                                endpoint: joinUrls(mintUrl, 'check'),
                                method: 'POST',
                                requestBody: checkPayload
                            })];
                    case 1:
                        data = _a.sent();
                        if (!isObj(data) || !Array.isArray(data === null || data === void 0 ? void 0 : data.spendable)) {
                            throw new Error('bad response');
                        }
                        return [2 /*return*/, data];
                }
            });
        });
    };
    /**
     * Checks if specific proofs have already been redeemed
     * @param checkPayload
     * @returns redeemed and unredeemed ordered list of booleans
     */
    CashuMint.prototype.check = function (checkPayload) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, CashuMint.check(this._mintUrl, checkPayload, this._customRequest)];
            });
        });
    };
    return CashuMint;
}());
export { CashuMint };
//# sourceMappingURL=CashuMint.js.map