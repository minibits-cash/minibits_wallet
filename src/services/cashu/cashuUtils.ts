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


const updateMintProofs = function (
  token: Token,
  mintUrl: string,
  updatedProofs: Proof[],
): Token {
  // Find the index of the mint to update
  const mintIndex = token.token.findIndex(mint => mint.mint === mintUrl)

  if (mintIndex === -1) {
    throw new AppError(
      Err.VALIDATION_ERROR,
      `Mint ${mintUrl} not found in token`,
    )
  }

  // Clone the token instance
  const updatedToken: Token = cloneDeep(token)

  // Update the proofs for the specified mint
  updatedToken.token[mintIndex].proofs = updatedProofs

  return updatedToken
}


const getProofsFromTokenEntries = (tokenEntries: TokenEntry[]) => {
  const proofs: Proof[] = []

  for (const entry of tokenEntries) {
    proofs.push(...entry.proofs)
  }

  return proofs
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

export const getProofsToSend = (amount: number, proofs: Proof[]) => {
  if (proofs.reduce((s, t) => (s += t.amount), 0) < amount) {
      // there are not enough proofs to pay the amount
      throw new AppError(Err.VALIDATION_ERROR, 'Not enough proofs to match requested amount', {amount})
    }

    // sort proofs by amount ascending
    proofs = proofs.slice().sort((a, b) => a.amount - b.amount);
    // remember next bigger proof as a fallback
    const nextBigger = proofs.find((p) => p.amount > amount);

    // go through smaller proofs until sum is bigger than amount
    const smallerProofs = proofs.filter((p) => p.amount <= amount);
    // sort by amount descending
    smallerProofs.sort((a, b) => b.amount - a.amount);

    let selectedProofs: Proof[] = [];

    if (smallerProofs.length == 0 && nextBigger) {
      // if there are no smaller proofs, take the next bigger proof as a fallback
      return [nextBigger];
    } else if (smallerProofs.length == 0 && !nextBigger) {
      // no proofs available
      return [];
    }

    // recursively select the largest proof of smallerProofs, subtract the amount from the remainder
    // and call coinSelect again with the remainder and the rest of the smallerProofs (without the largest proof)
    let remainder = amount;
    selectedProofs = [smallerProofs[0]];
    remainder -= smallerProofs[0].amount;
    if (remainder > 0) {
      selectedProofs = selectedProofs.concat(getProofsToSend(remainder, smallerProofs.slice(1)));
    }
    let sum = selectedProofs.reduce((s, t) => (s += t.amount), 0);

    // if sum of selectedProofs is smaller than amount, take next bigger proof instead as a fallback
    if (sum < amount && nextBigger) {
      selectedProofs = [nextBigger];
    }

    log.trace("[getProofsToSend] ### selected amounts", "sum", selectedProofs.reduce((s, t) => (s += t.amount), 0), selectedProofs.map(p => p.amount));
    return selectedProofs
} 


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
    if (m.keysets?.includes(proof.id)) {
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
    updateMintProofs,
    getProofsFromTokenEntries,
    getProofsToSend,
    getProofsSubset,
    validateMintKeys,
    getMintFromProof
}
