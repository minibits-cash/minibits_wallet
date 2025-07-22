import {Mint} from '../../models/Mint'
import type {
  getEncodedToken,
  Token, 
  Proof as CashuProof,
  PaymentRequest as CashuPaymentRequest,
  PaymentRequestPayload,
} from '@cashu/cashu-ts'
import AppError, {Err} from '../../utils/AppError'
import { getDecodedToken } from '@cashu/cashu-ts'
import {Proof} from '../../models/Proof'
import { log } from '../logService'
import { decodePaymentRequest, sumProofs } from '@cashu/cashu-ts/src/utils'
import { NostrClient } from '../nostrService'
import { getUnixTime } from 'date-fns/getUnixTime'

export {CashuProof}

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
    let decoded: Token | undefined = undefined
    
    if (maybeToken && CASHU_TOKEN_PREFIXES.some(pref => maybeToken.startsWith(pref))) {
        decoded = getDecodedToken(maybeToken) // throws
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
        decoded = getDecodedToken(encodedToken) // throws
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
  
  throw new AppError(Err.NOTFOUND_ERROR, 'Could not extract ecash token from the provided string', {maybeRequest, caller: 'extractEncodedCashuPaymentRequest'})
}



function base64urlFromBase64(str: string) {
	return str.replace(/\+/g, '-').replace(/\//g, '_').split('=')[0];
	// .replace(/=/g, '.');
}

function base64urlToBase64(str: string) {
	return str.replace(/-/g, '+').replace(/_/g, '/').split('=')[0];
	// .replace(/./g, '=');
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


const isTokenP2PKLocked = function (token: Token) {
  const secrets = token.proofs.map((p) => p.secret)
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
    getProofsSubset,
    validateMintKeys,
    getMintFromProof,
    getP2PKPubkeySecret,
    getP2PKLocktime,
    isTokenP2PKLocked
}
