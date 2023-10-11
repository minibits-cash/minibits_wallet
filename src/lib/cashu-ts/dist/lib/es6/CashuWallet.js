var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
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
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
import { randomBytes } from '@noble/hashes/utils';
import { CashuMint } from './CashuMint.js';
import * as dhke from './DHKE.js';
import { BlindedMessage } from './model/BlindedMessage.js';
import { cleanToken, deriveKeysetId, getDecodedToken, getDefaultAmountPreference, splitAmount } from './utils.js';
/**
 * Class that represents a Cashu wallet.
 * This class should act as the entry point for this library
 */
var CashuWallet = /** @class */ (function () {
    /**
     * @param keys public keys from the mint
     * @param mint Cashu mint instance is used to make api calls
     */
    function CashuWallet(mint, keys) {
        this._keysetId = '';
        this._keys = keys || {};
        this.mint = mint;
        if (keys) {
            this._keysetId = deriveKeysetId(this._keys);
        }
    }
    Object.defineProperty(CashuWallet.prototype, "keys", {
        get: function () {
            return this._keys;
        },
        set: function (keys) {
            this._keys = keys;
            this._keysetId = deriveKeysetId(this._keys);
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(CashuWallet.prototype, "keysetId", {
        get: function () {
            return this._keysetId;
        },
        enumerable: false,
        configurable: true
    });
    /**
     * returns proofs that are already spent (use for keeping wallet state clean)
     * @param proofs (only the 'secret' field is required)
     * @returns
     */
    CashuWallet.prototype.checkProofsSpent = function (proofs) {
        return __awaiter(this, void 0, void 0, function () {
            var payload, spendable;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        payload = {
                            //send only the secret
                            proofs: proofs.map(function (p) { return ({ secret: p.secret }); })
                        };
                        return [4 /*yield*/, this.mint.check(payload)];
                    case 1:
                        spendable = (_a.sent()).spendable;
                        return [2 /*return*/, proofs.filter(function (_, i) { return !spendable[i]; })];
                }
            });
        });
    };
    /**
     * Starts a minting process by requesting an invoice from the mint
     * @param amount Amount requesting for mint.
     * @returns the mint will create and return a Lightning invoice for the specified amount
     */
    CashuWallet.prototype.requestMint = function (amount) {
        return this.mint.requestMint(amount);
    };
    /**
     * Executes a payment of an invoice on the Lightning network.
     * The combined amount of Proofs has to match the payment amount including fees.
     * @param invoice
     * @param proofsToSend the exact amount to send including fees
     * @param feeReserve? optionally set LN routing fee reserve. If not set, fee reserve will get fetched at mint
     */
    CashuWallet.prototype.payLnInvoice = function (invoice, proofsToSend, feeReserve) {
        var _a;
        return __awaiter(this, void 0, void 0, function () {
            var paymentPayload, _b, blindedMessages, secrets, rs, payData, _c, _d, _e, _f;
            var _g;
            return __generator(this, function (_h) {
                switch (_h.label) {
                    case 0:
                        paymentPayload = this.createPaymentPayload(invoice, proofsToSend);
                        if (!!feeReserve) return [3 /*break*/, 2];
                        return [4 /*yield*/, this.getFee(invoice)];
                    case 1:
                        feeReserve = _h.sent();
                        _h.label = 2;
                    case 2:
                        _b = this.createBlankOutputs(feeReserve), blindedMessages = _b.blindedMessages, secrets = _b.secrets, rs = _b.rs;
                        return [4 /*yield*/, this.mint.melt(__assign(__assign({}, paymentPayload), { outputs: blindedMessages }))];
                    case 3:
                        payData = _h.sent();
                        _g = {
                            isPaid: (_a = payData.paid) !== null && _a !== void 0 ? _a : false,
                            preimage: payData.preimage
                        };
                        if (!(payData === null || payData === void 0 ? void 0 : payData.change)) return [3 /*break*/, 5];
                        _e = (_d = dhke).constructProofs;
                        _f = [payData.change, rs, secrets];
                        return [4 /*yield*/, this.getKeys(payData.change)];
                    case 4:
                        _c = _e.apply(_d, _f.concat([_h.sent()]));
                        return [3 /*break*/, 6];
                    case 5:
                        _c = [];
                        _h.label = 6;
                    case 6:
                        _g.change = _c;
                        return [4 /*yield*/, this.changedKeys(payData === null || payData === void 0 ? void 0 : payData.change)];
                    case 7: return [2 /*return*/, (_g.newKeys = _h.sent(),
                            _g)];
                }
            });
        });
    };
    /**
     * Estimate fees for a given LN invoice
     * @param invoice LN invoice that needs to get a fee estimate
     * @returns estimated Fee
     */
    CashuWallet.prototype.getFee = function (invoice) {
        return __awaiter(this, void 0, void 0, function () {
            var fee;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.mint.checkFees({ pr: invoice })];
                    case 1:
                        fee = (_a.sent()).fee;
                        return [2 /*return*/, fee];
                }
            });
        });
    };
    CashuWallet.prototype.createPaymentPayload = function (invoice, proofs) {
        return {
            pr: invoice,
            proofs: proofs
        };
    };
    /**
     * Use a cashu token to pay an ln invoice
     * @param invoice Lightning invoice
     * @param token cashu token
     */
    CashuWallet.prototype.payLnInvoiceWithToken = function (invoice, token) {
        var _this = this;
        var decodedToken = getDecodedToken(token);
        var proofs = decodedToken.token
            .filter(function (x) { return x.mint === _this.mint.mintUrl; })
            .flatMap(function (t) { return t.proofs; });
        return this.payLnInvoice(invoice, proofs);
    };
    /**
     * Receive an encoded Cashu token
     * @param encodedToken Cashu token
     * @param preference optional preference for splitting proofs into specific amounts
     * @returns New token with newly created proofs, token entries that had errors, and newKeys if they have changed
     */
    CashuWallet.prototype.receive = function (encodedToken, preference) {
        var _a;
        return __awaiter(this, void 0, void 0, function () {
            var token, tokenEntries, tokenEntriesWithError, newKeys, _i, token_1, tokenEntry, _b, proofsWithError, proofs, newKeysFromReceive, error_1;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        token = cleanToken(getDecodedToken(encodedToken)).token;
                        tokenEntries = [];
                        tokenEntriesWithError = [];
                        _i = 0, token_1 = token;
                        _c.label = 1;
                    case 1:
                        if (!(_i < token_1.length)) return [3 /*break*/, 6];
                        tokenEntry = token_1[_i];
                        if (!((_a = tokenEntry === null || tokenEntry === void 0 ? void 0 : tokenEntry.proofs) === null || _a === void 0 ? void 0 : _a.length)) {
                            return [3 /*break*/, 5];
                        }
                        _c.label = 2;
                    case 2:
                        _c.trys.push([2, 4, , 5]);
                        return [4 /*yield*/, this.receiveTokenEntry(tokenEntry, preference)];
                    case 3:
                        _b = _c.sent(), proofsWithError = _b.proofsWithError, proofs = _b.proofs, newKeysFromReceive = _b.newKeys;
                        if (proofsWithError === null || proofsWithError === void 0 ? void 0 : proofsWithError.length) {
                            tokenEntriesWithError.push(tokenEntry);
                            return [3 /*break*/, 5];
                        }
                        tokenEntries.push({ mint: tokenEntry.mint, proofs: __spreadArray([], proofs, true) });
                        if (!newKeys) {
                            newKeys = newKeysFromReceive;
                        }
                        return [3 /*break*/, 5];
                    case 4:
                        error_1 = _c.sent();
                        console.error(error_1);
                        tokenEntriesWithError.push(tokenEntry);
                        return [3 /*break*/, 5];
                    case 5:
                        _i++;
                        return [3 /*break*/, 1];
                    case 6: return [2 /*return*/, {
                            token: { token: tokenEntries },
                            tokensWithErrors: tokenEntriesWithError.length ? { token: tokenEntriesWithError } : undefined,
                            newKeys: newKeys
                        }];
                }
            });
        });
    };
    /**
     * Receive a single cashu token entry
     * @param tokenEntry a single entry of a cashu token
     * @param preference optional preference for splitting proofs into specific amounts.
     * @returns New token entry with newly created proofs, proofs that had errors, and newKeys if they have changed
     */
    CashuWallet.prototype.receiveTokenEntry = function (tokenEntry, preference) {
        return __awaiter(this, void 0, void 0, function () {
            var proofsWithError, proofs, newKeys, amount, _a, payload, blindedMessages, _b, promises, error, newProofs, _c, _d, _e, _f, error_2;
            return __generator(this, function (_g) {
                switch (_g.label) {
                    case 0:
                        proofsWithError = [];
                        proofs = [];
                        _g.label = 1;
                    case 1:
                        _g.trys.push([1, 7, , 8]);
                        amount = tokenEntry.proofs.reduce(function (total, curr) { return total + curr.amount; }, 0);
                        if (!preference) {
                            preference = getDefaultAmountPreference(amount);
                        }
                        _a = this.createSplitPayload(amount, tokenEntry.proofs, preference), payload = _a.payload, blindedMessages = _a.blindedMessages;
                        return [4 /*yield*/, CashuMint.split(tokenEntry.mint, payload)];
                    case 2:
                        _b = _g.sent(), promises = _b.promises, error = _b.error;
                        _d = (_c = dhke).constructProofs;
                        _e = [promises,
                            blindedMessages.rs,
                            blindedMessages.secrets];
                        return [4 /*yield*/, this.getKeys(promises, tokenEntry.mint)];
                    case 3:
                        newProofs = _d.apply(_c, _e.concat([_g.sent()]));
                        proofs.push.apply(proofs, newProofs);
                        if (!(tokenEntry.mint === this.mint.mintUrl)) return [3 /*break*/, 5];
                        return [4 /*yield*/, this.changedKeys(__spreadArray([], (promises || []), true))];
                    case 4:
                        _f = _g.sent();
                        return [3 /*break*/, 6];
                    case 5:
                        _f = undefined;
                        _g.label = 6;
                    case 6:
                        newKeys = _f;
                        return [3 /*break*/, 8];
                    case 7:
                        error_2 = _g.sent();
                        console.error(error_2);
                        proofsWithError.push.apply(proofsWithError, tokenEntry.proofs);
                        return [3 /*break*/, 8];
                    case 8: return [2 /*return*/, {
                            proofs: proofs,
                            proofsWithError: proofsWithError.length ? proofsWithError : undefined,
                            newKeys: newKeys
                        }];
                }
            });
        });
    };
    /**
     * Splits and creates sendable tokens
     * if no amount is specified, the amount is implied by the cumulative amount of all proofs
     * if both amount and preference are set, but the preference cannot fulfill the amount, then we use the default split
     * @param amount amount to send while performing the optimal split (least proofs possible). can be set to undefined if preference is set
     * @param proofs proofs matching that amount
     * @param preference optional preference for splitting proofs into specific amounts. overrides amount param
     * @returns promise of the change- and send-proofs
     */
    CashuWallet.prototype.send = function (amount, proofs, preference) {
        return __awaiter(this, void 0, void 0, function () {
            var amountAvailable, proofsToSend, proofsToKeep, _a, amountKeep_1, amountSend, _b, payload, blindedMessages, promises, proofs_1, _c, _d, _e, splitProofsToKeep_1, splitProofsToSend_1, amountKeepCounter_1;
            var _f;
            return __generator(this, function (_g) {
                switch (_g.label) {
                    case 0:
                        if (preference) {
                            amount = preference === null || preference === void 0 ? void 0 : preference.reduce(function (acc, curr) { return acc + curr.amount * curr.count; }, 0);
                        }
                        amountAvailable = 0;
                        proofsToSend = [];
                        proofsToKeep = [];
                        proofs.forEach(function (proof) {
                            if (amountAvailable >= amount) {
                                proofsToKeep.push(proof);
                                return;
                            }
                            amountAvailable = amountAvailable + proof.amount;
                            proofsToSend.push(proof);
                        });
                        if (amount > amountAvailable) {
                            throw new Error('Not enough funds available');
                        }
                        if (!(amount < amountAvailable || preference)) return [3 /*break*/, 4];
                        _a = this.splitReceive(amount, amountAvailable), amountKeep_1 = _a.amountKeep, amountSend = _a.amountSend;
                        _b = this.createSplitPayload(amountSend, proofsToSend, preference), payload = _b.payload, blindedMessages = _b.blindedMessages;
                        return [4 /*yield*/, this.mint.split(payload)];
                    case 1:
                        promises = (_g.sent()).promises;
                        _d = (_c = dhke).constructProofs;
                        _e = [promises,
                            blindedMessages.rs,
                            blindedMessages.secrets];
                        return [4 /*yield*/, this.getKeys(promises)];
                    case 2:
                        proofs_1 = _d.apply(_c, _e.concat([_g.sent()]));
                        splitProofsToKeep_1 = [];
                        splitProofsToSend_1 = [];
                        amountKeepCounter_1 = 0;
                        proofs_1.forEach(function (proof) {
                            if (amountKeepCounter_1 < amountKeep_1) {
                                amountKeepCounter_1 += proof.amount;
                                splitProofsToKeep_1.push(proof);
                                return;
                            }
                            splitProofsToSend_1.push(proof);
                        });
                        _f = {
                            returnChange: __spreadArray(__spreadArray([], splitProofsToKeep_1, true), proofsToKeep, true),
                            send: splitProofsToSend_1
                        };
                        return [4 /*yield*/, this.changedKeys(__spreadArray([], (promises || []), true))];
                    case 3: return [2 /*return*/, (_f.newKeys = _g.sent(),
                            _f)];
                    case 4: return [2 /*return*/, { returnChange: proofsToKeep, send: proofsToSend }];
                }
            });
        });
    };
    /**
     * Request tokens from the mint
     * @param amount amount to request
     * @param hash hash to use to identify the request
     * @returns proofs and newKeys if they have changed
     */
    CashuWallet.prototype.requestTokens = function (amount, hash, AmountPreference) {
        return __awaiter(this, void 0, void 0, function () {
            var _a, blindedMessages, secrets, rs, payloads, promises, _b, _c, _d;
            var _e;
            return __generator(this, function (_f) {
                switch (_f.label) {
                    case 0:
                        _a = this.createRandomBlindedMessages(amount, AmountPreference), blindedMessages = _a.blindedMessages, secrets = _a.secrets, rs = _a.rs;
                        payloads = { outputs: blindedMessages };
                        return [4 /*yield*/, this.mint.mint(payloads, hash)];
                    case 1:
                        promises = (_f.sent()).promises;
                        _e = {};
                        _c = (_b = dhke).constructProofs;
                        _d = [promises, rs, secrets];
                        return [4 /*yield*/, this.getKeys(promises)];
                    case 2:
                        _e.proofs = _c.apply(_b, _d.concat([_f.sent()]));
                        return [4 /*yield*/, this.changedKeys(promises)];
                    case 3: return [2 /*return*/, (_e.newKeys = _f.sent(),
                            _e)];
                }
            });
        });
    };
    /**
     * Initialize the wallet with the mints public keys
     */
    CashuWallet.prototype.initKeys = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        if (!(!this.keysetId || !Object.keys(this.keys).length)) return [3 /*break*/, 2];
                        _a = this;
                        return [4 /*yield*/, this.mint.getKeys()];
                    case 1:
                        _a.keys = _b.sent();
                        this._keysetId = deriveKeysetId(this.keys);
                        _b.label = 2;
                    case 2: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Check if the keysetId has changed and return the new keys
     * @param promises array of promises to check
     * @returns new keys if they have changed
     */
    CashuWallet.prototype.changedKeys = function (promises) {
        if (promises === void 0) { promises = []; }
        return __awaiter(this, void 0, void 0, function () {
            var maybeNewKeys, keysetId;
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.initKeys()];
                    case 1:
                        _a.sent();
                        if (!(promises === null || promises === void 0 ? void 0 : promises.length)) {
                            return [2 /*return*/, undefined];
                        }
                        if (!promises.some(function (x) { return x.id !== _this.keysetId; })) {
                            return [2 /*return*/, undefined];
                        }
                        return [4 /*yield*/, this.mint.getKeys()];
                    case 2:
                        maybeNewKeys = _a.sent();
                        keysetId = deriveKeysetId(maybeNewKeys);
                        return [2 /*return*/, keysetId === this.keysetId ? undefined : maybeNewKeys];
                }
            });
        });
    };
    /**
     * Get the mint's public keys for a given set of proofs
     * @param arr array of proofs
     * @param mint optional mint url
     * @returns keys
     */
    CashuWallet.prototype.getKeys = function (arr, mint) {
        var _a;
        return __awaiter(this, void 0, void 0, function () {
            var keysetId, keys, _b;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0: return [4 /*yield*/, this.initKeys()];
                    case 1:
                        _c.sent();
                        if (!(arr === null || arr === void 0 ? void 0 : arr.length) || !((_a = arr[0]) === null || _a === void 0 ? void 0 : _a.id)) {
                            return [2 /*return*/, this.keys];
                        }
                        keysetId = arr[0].id;
                        if (this.keysetId === keysetId) {
                            return [2 /*return*/, this.keys];
                        }
                        if (!(!mint || mint === this.mint.mintUrl)) return [3 /*break*/, 3];
                        return [4 /*yield*/, this.mint.getKeys(arr[0].id)];
                    case 2:
                        _b = _c.sent();
                        return [3 /*break*/, 5];
                    case 3: return [4 /*yield*/, CashuMint.getKeys(mint, arr[0].id)];
                    case 4:
                        _b = _c.sent();
                        _c.label = 5;
                    case 5:
                        keys = _b;
                        return [2 /*return*/, keys];
                }
            });
        });
    };
    /**
     * Creates a split payload
     * @param amount1 amount to keep
     * @param amount2 amount to send
     * @param proofsToSend proofs to split
     * @returns
     */
    CashuWallet.prototype.createSplitPayload = function (amount, proofsToSend, preference) {
        var totalAmount = proofsToSend.reduce(function (total, curr) { return total + curr.amount; }, 0);
        var keepBlindedMessages = this.createRandomBlindedMessages(totalAmount - amount);
        var sendBlindedMessages = this.createRandomBlindedMessages(amount, preference);
        // join keepBlindedMessages and sendBlindedMessages
        var blindedMessages = {
            blindedMessages: __spreadArray(__spreadArray([], keepBlindedMessages.blindedMessages, true), sendBlindedMessages.blindedMessages, true),
            secrets: __spreadArray(__spreadArray([], keepBlindedMessages.secrets, true), sendBlindedMessages.secrets, true),
            rs: __spreadArray(__spreadArray([], keepBlindedMessages.rs, true), sendBlindedMessages.rs, true),
            amounts: __spreadArray(__spreadArray([], keepBlindedMessages.amounts, true), sendBlindedMessages.amounts, true)
        };
        var payload = {
            proofs: proofsToSend,
            outputs: __spreadArray([], blindedMessages.blindedMessages, true)
        };
        return { payload: payload, blindedMessages: blindedMessages };
    };
    CashuWallet.prototype.splitReceive = function (amount, amountAvailable) {
        var amountKeep = amountAvailable - amount;
        var amountSend = amount;
        return { amountKeep: amountKeep, amountSend: amountSend };
    };
    /**
     * Creates blinded messages for a given amount
     * @param amount amount to create blinded messages for
     * @returns blinded messages, secrets, rs, and amounts
     */
    CashuWallet.prototype.createRandomBlindedMessages = function (amount, amountPreference) {
        var blindedMessages = [];
        var secrets = [];
        var rs = [];
        var amounts = splitAmount(amount, amountPreference);
        for (var i = 0; i < amounts.length; i++) {
            var secret = randomBytes(32);
            secrets.push(secret);
            var _a = dhke.blindMessage(secret), B_ = _a.B_, r = _a.r;
            rs.push(r);
            var blindedMessage = new BlindedMessage(amounts[i], B_);
            blindedMessages.push(blindedMessage.getSerializedBlindedMessage());
        }
        return { blindedMessages: blindedMessages, secrets: secrets, rs: rs, amounts: amounts };
    };
    /**
     * Creates NUT-08 blank outputs (fee returns) for a given fee reserve
     * See: https://github.com/cashubtc/nuts/blob/main/08.md
     * @param feeReserve amount to cover with blank outputs
     * @returns blinded messages, secrets, and rs
     */
    CashuWallet.prototype.createBlankOutputs = function (feeReserve) {
        var blindedMessages = [];
        var secrets = [];
        var rs = [];
        var count = Math.ceil(Math.log2(feeReserve)) || 1;
        for (var i = 0; i < count; i++) {
            var secret = randomBytes(32);
            secrets.push(secret);
            var _a = dhke.blindMessage(secret), B_ = _a.B_, r = _a.r;
            rs.push(r);
            var blindedMessage = new BlindedMessage(0, B_);
            blindedMessages.push(blindedMessage.getSerializedBlindedMessage());
        }
        return { blindedMessages: blindedMessages, secrets: secrets, rs: rs };
    };
    return CashuWallet;
}());
export { CashuWallet };
//# sourceMappingURL=CashuWallet.js.map