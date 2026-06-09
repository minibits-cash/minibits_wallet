import {Mint} from '../../models/Mint'
import {
  Amount,
  OutputData,
  hasValidDleq,
  pointFromHex,
  verifyDLEQProof,
} from '@cashu/cashu-ts'
import type {
  Token,
  Proof as CashuDecodedProof,
  ProofLike as CashuProof,
  MintKeys as CashuMintKeys,
  PaymentRequest as CashuPaymentRequest,
  PaymentRequestPayload,
  TokenMetadata,
  OutputDataLike,
  MeltPreview,
  SerializedBlindedSignature,
  HasKeysetKeys,
} from '@cashu/cashu-ts'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import AppError, {Err} from '../../utils/AppError'
import { getTokenMetadata } from '@cashu/cashu-ts'
import {Proof} from '../../models/Proof'
import { log } from '../logService'
import { decodePaymentRequest } from '@cashu/cashu-ts'
import { NostrClient } from '../nostrService'
import { getUnixTime } from 'date-fns/getUnixTime'
import { getSnapshot, isStateTreeNode } from 'mobx-state-tree'

export {CashuProof}

/**
 * Type guard to check if a value is an object
 */
const isObj = function(v: unknown): v is object {
  return typeof v === 'object'
}

/**
 * Sum the amounts of an array of proofs
 */
const sumProofs = function(proofs: CashuProof[]): number {
  return proofs.reduce((acc: number, proof: CashuProof) => acc + Number(proof.amount), 0)
}

const CASHU_URI_PREFIXES = [
  'https://wallet.nutstash.app/#',
  'https://wallet.cashu.me/?token=',
  'web+cashu://',
  'cashu://',
  'cashu:'
]

const CASHU_TOKEN_PREFIXES = [
  'cashuA',
  'cashuB'
]

const CASHU_PAYMENT_REQUEST_PREFIXES = [
  'creqA',
  'creqB' 
]

const findEncodedCashuToken = function (content: string) {
  const words = content.split(/\s+|\n+/) // Split text into words
  const maybeToken = words.find(word => CASHU_TOKEN_PREFIXES.some(pref => word.includes(pref)))
  return maybeToken || null
}


const findEncodedCashuPaymentRequest = function (content: string) {
  const words = content.split(/\s+|\n+/) // Split text into words
  const maybeRequest = words.find(word => CASHU_PAYMENT_REQUEST_PREFIXES.some(pref => word.includes(pref)))
  return maybeRequest || null
}


const findEncodedCashuPaymentRequestPayload = function (content: string) {
  try {
    const decoded = JSON.parse(content)
      
    if(decoded && 
      decoded.mint && 
      decoded.unit &&         
      Array.isArray(decoded.proofs) &&
      decoded.proofs.length > 0) {
      return decoded as PaymentRequestPayload
    }

    return null
    
  } catch (e: any) {
    return null
  }
} 


const extractEncodedCashuToken = function (maybeToken: string): string {

    log.trace('[extractEncodedCashuToken] Extract token from', {maybeToken})
    
    let encodedToken: string | undefined = undefined
    let tokenInfo: TokenMetadata | undefined = undefined
    
    if (maybeToken && CASHU_TOKEN_PREFIXES.some(pref => maybeToken.startsWith(pref))) {
        tokenInfo = getTokenMetadata(maybeToken) // throws
        return maybeToken
    }

    for (const prefix of CASHU_URI_PREFIXES) {
      if (maybeToken && maybeToken.startsWith(prefix)) {            
              encodedToken = maybeToken.slice(prefix.length)
              break // necessary
          }
    }

    log.trace('[extractEncodedCashuToken] Token without prefix', {encodedToken})

    // try to decode
    if(encodedToken) {
        tokenInfo = getTokenMetadata(encodedToken) // throws
        return encodedToken
    }
    
    throw new AppError(Err.NOTFOUND_ERROR, 'Could not extract ecash token from the provided string', {maybeToken, caller: 'extractEncodedCashuToken'})
}


const extractEncodedCashuPaymentRequest = function (maybeRequest: string): string {
  log.trace('[extractEncodedCashuPaymentRequest] Extract payment request from', {maybeRequest})
  
  let encodedRequest: string | undefined = undefined
  let decoded: CashuPaymentRequest | undefined = undefined
  
  if (maybeRequest && CASHU_PAYMENT_REQUEST_PREFIXES.some(pref => maybeRequest.startsWith(pref))) {
      decoded = decodePaymentRequest(maybeRequest) // throws
      return maybeRequest
  }

  for (const prefix of CASHU_URI_PREFIXES) {
    if (maybeRequest && maybeRequest.startsWith(prefix)) {            
            encodedRequest = maybeRequest.slice(prefix.length)
            break // necessary
        }
  }

  log.trace('[extractEncodedCashuToken] Token without prefix', {encodedRequest})

  // try to decode
  if(encodedRequest) {
      decoded = decodePaymentRequest(encodedRequest) // throws
      return encodedRequest
  }
  
  throw new AppError(Err.NOTFOUND_ERROR, 'Could not extract ecash payment request from the provided string', {maybeRequest, caller: 'extractEncodedCashuPaymentRequest'})
}

const getProofsAmount = function (proofs: Array<Proof | CashuProof>): number {
  return sumProofs(proofs as CashuProof[])
}

// legacy method
const getMintsFromToken = function (token: Token): string[] {
  return [token.mint]  
}


const findExactMatch = function (requestedAmount: number, proofs: Proof[]): Proof[] | null {
  const result: Proof[] = [];
  const memo = new Set<string>(); // A set to store visited states
  const MAX_DEPTH = 1000;  // Set a reasonable recursion depth limit

  function backtrack(start: number, remaining: number, depth: number): boolean {
      if (depth > MAX_DEPTH) {
        log.error('[findExactMatch] Hit max algo depth')
        return false;  // Stop recursion if the depth limit is reached
      }

      if (remaining === 0) {
          return true;
      }

      if (memo.has(`${start}-${remaining}`)) { // Check if we've already visited this state
        log.trace('[findExactMatch] Same state cycle detected')
        return false;
      }

      memo.add(`${start}-${remaining}`); // Mark the state as visited

      for (let i = start; i < proofs.length; i++) {
          if (proofs[i].amount > remaining) continue;
          result.push(proofs[i]);
          if (backtrack(i + 1, remaining - proofs[i].amount, depth + 1)) {
              return true;
          }
          result.pop();
      }
      return false;
  }

  proofs.sort((a, b) => b.amount - a.amount);
  if (backtrack(0, requestedAmount, 0)) {
      return result;
  }
  return null;
}

const findMinExcess = function (requestedAmount: number, proofs: Proof[], preference: 'SMALL' | 'BIG' = 'SMALL'): Proof[] {
  if(preference === 'SMALL') {
    proofs.sort((a, b) => a.amount - b.amount);
  } else {
    proofs.sort((a, b) => b.amount - a.amount);
  }
  
  const selectedProofs: Proof[] = [];
  let currentAmount = 0;

  for (const proof of proofs) {
      if (currentAmount >= requestedAmount) {
          break;
      }
      selectedProofs.push(proof);
      currentAmount += proof.amount;
  }

  return selectedProofs;
}

/* 
 * This function attempts to find exact match combination of proofs for a transaction amount. 
 * If not found, minimal number of proofs exceeding the amount is selected
 * It is intended to minimize number of swaps and possible fees.
 */
const getProofsToSend = function (requestedAmount: number, proofs: Proof[]): Proof[] {
  const proofsAmount = getProofsAmount(proofs)
  if(requestedAmount > proofsAmount) {
    throw new AppError(
      Err.VALIDATION_ERROR, 
      'There is not enough funds to send this amount.', 
      {requestedAmount, proofsAmount, caller: 'getProofsToSend'})
  }
  const exactMatch = findExactMatch(requestedAmount, proofs)
  if (exactMatch) {
      log.trace('[getProofsToSend] found exact match')
      return exactMatch;
  }

  log.trace('[getProofsToSend] no exact match, fallback to findMinExcess')
  return findMinExcess(requestedAmount, proofs)
}


/**
 * removes a set of tokens from another set of tokens, and returns the remaining.
 * @param proofs
 * @param proofsToRemove
 * @returns
 */
const getProofsSubset = function (
  proofs: Array<Proof | CashuProof>,
  proofsToRemove: Array<Proof | CashuProof>,
): Array<Proof | CashuProof> {
  return proofs.filter(proof => !proofsToRemove.some(p => p.secret === proof.secret))
}

const verifyProofsDleqOrThrow = function (
  proofs: CashuDecodedProof[],
  mintKeys: CashuMintKeys[],
): void {
  if (!proofs || proofs.length === 0) {
    throw new AppError(
      Err.VALIDATION_ERROR,
      'This token does not contain ecash proofs to verify offline.',
      { caller: 'verifyProofsDleqOrThrow' },
    )
  }

  if (!mintKeys || mintKeys.length === 0) {
    throw new AppError(
      Err.VALIDATION_ERROR,
      'This token cannot be verified offline because the mint keys are not saved. Sync the mint online first.',
      { caller: 'verifyProofsDleqOrThrow' },
    )
  }

  for (const [proofIndex, proof] of proofs.entries()) {
    const amount = proof.amount.toString()
    const params = {
      caller: 'verifyProofsDleqOrThrow',
      proofIndex,
      keysetId: proof.id,
      amount,
    }

    const keyset = mintKeys.find(k => k.id === proof.id)

    if (!keyset || !keyset.keys || !keyset.keys[amount]) {
      throw new AppError(
        Err.VALIDATION_ERROR,
        'This token cannot be verified offline because the mint keys are not saved. Sync the mint online first.',
        params,
      )
    }

    if (!proof.dleq) {
      throw new AppError(
        Err.VALIDATION_ERROR,
        'This token does not include offline verification proof. Receive it online instead.',
        params,
      )
    }

    if (!proof.dleq.r) {
      throw new AppError(
        Err.VALIDATION_ERROR,
        'This token is missing the DLEQ blinding factor needed for offline verification.',
        params,
      )
    }

    let isValid = false

    try {
      isValid = hasValidDleq(proof, keyset)
    } catch {
      isValid = false
    }

    if (!isValid) {
      throw new AppError(
        Err.VALIDATION_ERROR,
        'Offline ecash verification failed. Do not accept this token.',
        params,
      )
    }
  }
}


const validateMintKeys = function (keys: object): boolean {
  let isValid = true
  try {
    const allKeys = Object.keys(keys)

    if (!allKeys) {
      return false
    }

    if (allKeys.length < 1) {
      return false
    }
    allKeys.forEach(k => {
      //try parse int?
      if (isNaN(Number(k))) {
        isValid = false
      }
      if (!isPow2(Number(k))) {
        isValid = false
      }
    })
    return isValid
  } catch (error) {
    return false
  }
}

function getKeysetIdInt(keysetId: string): bigint {
  if (/^[0-9a-fA-F]+$/.test(keysetId)) {
    return BigInt(`0x${keysetId}`) % BigInt(2 ** 31 - 1)
  } else {
    const bin = atob(keysetId)
    const hex = bytesToHex(new TextEncoder().encode(bin))
    return BigInt(`0x${hex}`) % BigInt(2 ** 31 - 1)
  }
}


const exportProofs = (proofs: Proof[]): CashuProof[] => {  

  const exported: CashuProof[] =   proofs.map(proof => {
    if (isStateTreeNode(proof)) {
        const {mintUrl, unit, tId, ...rest} = getSnapshot(proof)
        return rest
    } else {
        const {mintUrl, unit, tId, ...rest} = proof as Proof
        return rest
    }
  })
  
  return exported
}


function isCollidingKeysetId(
  newKeysetId: string,
  storedKeysetIds: string[],
) {
  const newKeysetIdInt = getKeysetIdInt(newKeysetId)
  return storedKeysetIds.some((storedId) => {
    
    if (storedId === newKeysetId) {
      // Colliding keyset ID!
      log.error('[isCollidingKeysetId] Colliding keyset ID', {
        newKeysetId,
        storedId,
      })
      return true
    }

    const storedKeysetIdInt = getKeysetIdInt(storedId)
    
    if (storedKeysetIdInt === newKeysetIdInt) {
      // Colliding keyset ID integer!
      log.error('[isCollidingKeysetId] Colliding keyset ID integer', {
        newKeysetId,
        storedId,
        newKeysetIdInt: newKeysetIdInt.toString(),
        storedKeysetIdInt: storedKeysetIdInt.toString(),
      })

      return true
    }

    return false
  })
}


const isPow2 = function (number: number) {
  return Math.log2(number) % 1 === 0
}


const getMintFromProof = function (
  proof: Proof,
  mints: Array<Mint>,
): Mint | undefined {
  let mint: Mint | undefined
  mints.forEach(m => {
    if (m.keysetIds?.includes(proof.id)) {
      mint = m
    }
  })
  return mint
}


const getP2PKPubkeySecret = function (secret: string): string | undefined {
  try {
    let secretObject = JSON.parse(secret)
    if (secretObject[0] == "P2PK" && secretObject[1]["data"] != undefined) {
      return secretObject[1]["data"]
    }
  } catch {}
  return undefined
}


const getP2PKLocktime = function (secret: string): number | undefined {
  try {
    let secretObject = JSON.parse(secret)
    if (secretObject[0] == "P2PK" && secretObject[1]["tags"] != undefined) {
      return NostrClient.getFirstTagValue(secretObject[1]["tags"], 'locktime') as number
    }
  } catch {}
  return undefined
}


const isTokenP2PKLocked = function (token: Token | TokenMetadata): boolean {

  const proofs = 'proofs' in token ? token.proofs : token.incompleteProofs
  const secrets = proofs.map((p) => p.secret)
  
  for (const secret of secrets) {
    try {
      if (getP2PKPubkeySecret(secret)) {
        const locktime = CashuUtils.getP2PKLocktime(secret)
        const currentTimestamp = getUnixTime(new Date(Date.now()))

        if(!locktime) {
          return true          
        } else if (locktime > currentTimestamp) {
          return true
        }        
      }
    } catch {}
  }
  return false
}




export interface StoredMeltPreview {
    keysetId: string
    outputData: SerializedOutputData[]
}

export interface SerializedOutputData {
    blindedMessage: { amount: string | number; id: string; B_: string }
    blindingFactor: string  // hex
    secret: string          // hex
    ephemeralE?: string
}

const serializeOutputData = (outputData: OutputDataLike[]): SerializedOutputData[] =>
    outputData.map(od => ({
        blindedMessage: {
            amount: od.blindedMessage.amount.toString(),
            id: od.blindedMessage.id,
            B_: od.blindedMessage.B_,
        },
        blindingFactor: od.blindingFactor.toString(16),
        secret: bytesToHex(od.secret),
        ephemeralE: od.ephemeralE,
    }))

const deserializeOutputData = (serialized: SerializedOutputData[]): OutputData[] =>
    serialized.map(od => new OutputData(
        { amount: Amount.from(od.blindedMessage.amount), id: od.blindedMessage.id, B_: od.blindedMessage.B_ },
        BigInt('0x' + od.blindingFactor),
        hexToBytes(od.secret),
        od.ephemeralE,
    ))

/** Serialize a cashu-ts MeltPreview into the JSON-safe shape stored for recovery. */
const serializeMeltPreview = (meltPreview: MeltPreview): StoredMeltPreview => ({
    keysetId: meltPreview.keysetId,
    outputData: serializeOutputData(meltPreview.outputData),
})

export interface MeltChangeRecoveryStats {
    /** Signatures turned into spendable proofs (matched or fallback). */
    recovered: number
    /** Signatures whose matched blank was at a different index than received. */
    reordered: number
    /** Signatures recovered WITHOUT a passing DLEQ proof (best-effort). */
    noDleqFallback: number
    /** Signatures that could not be assigned a blank at all (lost). */
    unmatched: number
}

/** True when the recovery hit a genuine error (not just benign reordering). */
const meltChangeRecoveryHasError = (s: MeltChangeRecoveryStats): boolean =>
    s.noDleqFallback > 0 || s.unmatched > 0

/**
 * Reconstruct spendable NUT-08 change proofs from a melt quote's blinded
 * signatures, using the blank `outputData` captured in the meltPreview at melt
 * time. Resilient and NEVER throws — it recovers as much as possible.
 *
 * Why this exists: some mints (e.g. nutshell < 0.20.1) return the `change[]`
 * signatures of a paid melt quote in an order that does NOT match the blank
 * outputs the wallet sent. cashu-ts `OutputData.toProof` assumes positional
 * pairing (`change[i] ↔ outputData[i]`) and runs a DLEQ check that THROWS on
 * mismatch. Mapped over the whole array, a single reorder aborted everything and
 * the change was silently discarded — recorded as fee (real funds lost).
 *
 * Strategy, per returned signature:
 *   1+2. Find the blank whose blinded message makes the mint's DLEQ proof
 *        verify. `verifyDLEQProof` is the alignment oracle: a signature verifies
 *        against exactly one blank, so this both REORDERS correctly and keeps
 *        DLEQ as a hard guarantee. Handles in-order and shuffled change alike.
 *   3.   If no blank verifies (a genuine DLEQ failure — mint/lib bug, not a
 *        reorder), unblind the positional blank WITHOUT DLEQ so the (still very
 *        likely valid) proof is recovered rather than dropped. Such proofs get
 *        validated naturally the next time they are spent.
 *
 * @returns recovered proofs plus stats the caller can log / persist to tx.data.
 */
const recoverMeltChange = function (params: {
    outputData: OutputData[]
    quoteChange: SerializedBlindedSignature[]
    keyset: HasKeysetKeys
}): {change: CashuDecodedProof[]; stats: MeltChangeRecoveryStats} {
    const {outputData, quoteChange, keyset} = params
    const pool = outputData.map((od, idx) => ({od, idx, used: false}))
    const change: CashuDecodedProof[] = []
    const stats: MeltChangeRecoveryStats = {
        recovered: 0,
        reordered: 0,
        noDleqFallback: 0,
        unmatched: 0,
    }

    quoteChange.forEach((sig, sigIndex) => {
        const amount = sig.amount.toString()
        const pubkeyHex = keyset.keys[amount]

        // ── Layers 1+2: DLEQ-matched pairing (in-order or reordered change) ──
        if (sig.dleq && pubkeyHex) {
            let A: ReturnType<typeof pointFromHex> | undefined
            let C_: ReturnType<typeof pointFromHex> | undefined
            try {
                A = pointFromHex(pubkeyHex)
                C_ = pointFromHex(sig.C_)
            } catch {
                A = undefined
            }

            if (A && C_) {
                const dleq = {s: hexToBytes(sig.dleq.s), e: hexToBytes(sig.dleq.e)}
                const match = pool.find(p => {
                    if (p.used) return false
                    try {
                        return verifyDLEQProof(
                            dleq,
                            pointFromHex(p.od.blindedMessage.B_),
                            C_!,
                            A!,
                        )
                    } catch {
                        return false
                    }
                })

                if (match) {
                    match.used = true
                    if (match.idx !== sigIndex) stats.reordered++
                    change.push(match.od.toProof(sig, keyset))
                    stats.recovered++
                    return
                }
            }
        }

        // ── Layer 3: no blank's DLEQ verifies → not a reorder. Recover the proof
        // WITHOUT DLEQ from the positional blank (best guess) so funds aren't
        // lost. Prefer the same-index blank; fall back to any remaining one.
        const fallback =
            pool.find(p => !p.used && p.idx === sigIndex) ??
            pool.find(p => !p.used)

        if (!fallback) {
            stats.unmatched++
            log.error(
                '[CashuUtils.recoverMeltChange] No blank left for change signature; funds for this output are lost',
                {sigIndex, amount, keysetId: keyset.id},
            )
            return
        }

        // Logged at ERROR: a genuine DLEQ failure (mint/lib bug), not a mere
        // reorder. The proof is still recovered, but the mint's honesty for this
        // output is unverified — surface it for investigation.
        log.error(
            '[CashuUtils.recoverMeltChange] DLEQ unverifiable for change signature; recovering proof without DLEQ',
            {sigIndex, amount, keysetId: keyset.id, fallbackBlankIndex: fallback.idx},
        )

        fallback.used = true
        stats.noDleqFallback++
        stats.recovered++
        change.push(fallback.od.toProof({...sig, dleq: undefined}, keyset))
    })

    return {change, stats}
}

export const CashuUtils = {
    findEncodedCashuToken,
    findEncodedCashuPaymentRequest,
    findEncodedCashuPaymentRequestPayload,
    extractEncodedCashuToken,
    extractEncodedCashuPaymentRequest,
    getProofsAmount,
    getMintsFromToken,
    findExactMatch,
    findMinExcess,
    getProofsToSend,
    exportProofs,
    getProofsSubset,
    verifyProofsDleqOrThrow,
    validateMintKeys,
    getMintFromProof,
    getP2PKPubkeySecret,
    getP2PKLocktime,
    isTokenP2PKLocked,
    isCollidingKeysetId,
    isObj,
    sumProofs,
    serializeOutputData,
    deserializeOutputData,
    serializeMeltPreview,
    recoverMeltChange,
    meltChangeRecoveryHasError,
}


