import {Mint} from '../../models/Mint'
import {  
    AmountPreference,
    getDecodedToken,  
} from '@cashu/cashu-ts'
import cloneDeep from 'lodash.clonedeep'
import AppError, {Err} from '../../utils/AppError'
import {Token} from '../../models/Token'
import {TokenEntry} from '../../models/TokenEntry'
import {Proof} from '../../models/Proof'
import { log } from '../logService'



const findEncodedCashuToken = function (content: string) {
    const words = content.split(/\s+|\n+/) // Split text into words
    const maybeToken = words.find(word => word.includes("cashuA"))
    return maybeToken || null
}

const cashuUriPrefixes = [
  'https://wallet.nutstash.app/#',
  'https://wallet.cashu.me/?token=',
  'web+cashu://',
  'cashu://',
  'cashu:'
]

export function validCashuAToken(text: string) {
  for (const prefix of cashuUriPrefixes) {
    if (text && text.startsWith(prefix)) {
      text = text.slice(prefix.length)
      break // necessary
    }
  }
  return text && text.startsWith('cashuA')
}

const extractEncodedCashuToken = function (maybeToken: string): string {

    log.trace('[extractEncodedCashuToken] Extract token from', {maybeToken})
    
    let encodedToken: string | undefined = undefined
    let decoded: Token | undefined = undefined
    
    if (maybeToken && maybeToken.startsWith('cashuA')) {
        decoded = decodeToken(maybeToken) // throws
        return maybeToken
    }

	for (const prefix of cashuUriPrefixes) {
		if (maybeToken && maybeToken.startsWith(prefix)) {            
            encodedToken = maybeToken.slice(prefix.length)
            break // necessary
        }
	}

    log.trace('[extractEncodedCashuToken] Token without prefix', {encodedToken})

    // try to decode
    if(encodedToken) {
        decoded = decodeToken(encodedToken) // throws
        return encodedToken
    }
    
    throw new AppError(Err.NOTFOUND_ERROR, 'Could not extract ecash token from the provided string', {maybeToken, caller: 'extractEncodedCashuToken'})
}



const decodeToken = function (encoded: string): Token {
  try {
    const decoded = getDecodedToken(encoded)
    return decoded as Token
  } catch (e: any) {
    throw new AppError(
      Err.VALIDATION_ERROR,
      `Provided ecash token is invalid.`,
      encoded,
    )
  }
}



const getTokenAmounts = function (token: Token) {
  const mintAmounts: {[k: string]: number} = {}
  let totalAmount = 0

  try {
    for (const tokenEntry of token.token) {
      const amount = getTokenEntryAmount(tokenEntry)
      totalAmount += amount

      const mint = tokenEntry.mint

      if (mintAmounts[mint]) {
        mintAmounts[mint] += amount
      } else {
        mintAmounts[mint] = amount
      }
    }

    const mintAmountsArray = Object.entries(mintAmounts).map(
      ([mintUrl, amount]) => ({mintUrl, amount}),
    )
    return {totalAmount, mintAmounts: mintAmountsArray}
  } catch (e: any) {
    throw new AppError(
      Err.VALIDATION_ERROR,
      'Could not calculate total amount',
      e.message,
    )
  }
}


const getTokenEntryAmount = function (tokenEntry: TokenEntry) {
  try {
    return getProofsAmount(tokenEntry.proofs)
  } catch (e: any) {
    throw new AppError(
      Err.VALIDATION_ERROR,
      'Could not calculate total TokenEntry amount',
      e.message,
    )
  }
}


const getProofsAmount = function (proofs: Array<Proof>): number {
  let totalAmount = 0

  for (const proof of proofs) {
    const amount = proof.amount
    totalAmount += amount
  }

  return totalAmount
}


const getAmountPreferencesCount = function (amountPreferences: AmountPreference[]): number {
    return amountPreferences.reduce((total, preference) => total + preference.count, 0);
}


const getMintsFromToken = function (token: Token): string[] {
  const mints = token.token.map(item => item.mint)
  return Array.from(new Set(mints)) // make sure the mints are not duplicated
}


const getProofsFromTokenEntries = (tokenEntries: TokenEntry[]) => {
  const proofs: Proof[] = []

  for (const entry of tokenEntries) {
    proofs.push(...entry.proofs)
  }

  return proofs
}


const findExactMatch = function (requestedAmount: number, proofs: Proof[]): Proof[] | null {
  const result: Proof[] = [];
  function backtrack(start: number, remaining: number): boolean {
      if (remaining === 0) {
          return true;
      }
      for (let i = start; i < proofs.length; i++) {
          if (proofs[i].amount > remaining) continue;
          result.push(proofs[i]);
          if (backtrack(i + 1, remaining - proofs[i].amount)) {
              return true;
          }
          result.pop();
      }
      return false;
  }

  proofs.sort((a, b) => b.amount - a.amount);
  if (backtrack(0, requestedAmount)) {
      return result;
  }
  return null;
}

const findMinExcess = function (requestedAmount: number, proofs: Proof[]): Proof[] {
  proofs.sort((a, b) => b.amount - a.amount);
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

const getProofsToSend = function (requestedAmount: number, proofs: Proof[]): Proof[] {
  const proofsAmount = getProofsAmount(proofs)
  if(requestedAmount > proofsAmount) {
    throw new AppError(
      Err.VALIDATION_ERROR, 
      'There is not enough funds to send this amount', 
      {requestedAmount, proofsAmount, caller: 'getProofsToSend'})
  }
  const exactMatch = findExactMatch(requestedAmount, proofs);
  if (exactMatch) {
      return exactMatch;
  }

  return findMinExcess(requestedAmount, proofs);
}


/**
 * returns a subset of tokens, so that not all tokens are sent to mint for smaller amounts.
 * @param amount
 * @param tokens
 * @returns
 */
/* const getProofsToSend = function (amount: number, proofs: Array<Proof>) {
  let proofsAmount = 0
  const proofSubset = proofs.filter(proof => {
    if (proofsAmount < amount) {
      proofsAmount += proof.amount
      return true
    }
  })
  return proofSubset
} */


/**
 * removes a set of tokens from another set of tokens, and returns the remaining.
 * @param proofs
 * @param proofsToRemove
 * @returns
 */
const getProofsSubset = function (
  proofs: Array<Proof>,
  proofsToRemove: Array<Proof>,
): Array<Proof> {
  return proofs.filter(proof => !proofsToRemove.includes(proof))
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
        if (isNaN(k)) {
          isValid = false
        }
        if (!isPow2(k)) {
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




export const CashuUtils = {
    findEncodedCashuToken,
    extractEncodedCashuToken,
    decodeToken,    
    getTokenAmounts,
    getTokenEntryAmount,
    getProofsAmount,
    getAmountPreferencesCount,
    getMintsFromToken,
    findMinExcess,
    // updateMintProofs,
    getProofsFromTokenEntries,
    getProofsToSend,
    getProofsSubset,
    validateMintKeys,
    getMintFromProof
}
