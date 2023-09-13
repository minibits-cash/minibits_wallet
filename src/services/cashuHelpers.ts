import {Mint} from '../models/Mint'
import {
  getDecodedLnInvoice,
  getDecodedToken,
} from '@cashu/cashu-ts'
import cloneDeep from 'lodash.clonedeep'
import AppError, {Err} from '../utils/AppError'
import {Token} from '../models/Token'
import {TokenEntry} from '../models/TokenEntry'
import {Proof} from '../models/Proof'


export type DecodedLightningInvoice = {
  paymentRequest: string
  sections: any[]
  readonly expiry: any
  readonly route_hints: any[]
}

export const decodeToken = function (encoded: string): Token {
  try {
    const decoded = getDecodedToken(encoded)
    return decoded as Token
  } catch (e: any) {
    throw new AppError(
      Err.VALIDATION_ERROR,
      `Provided coins are invalid: ${encoded}`,
      e.message,
    )
  }
}

export const decodeInvoice = function (encoded: string): DecodedLightningInvoice {
  try {
    const decoded = getDecodedLnInvoice(encoded)
    return decoded as DecodedLightningInvoice
  } catch (e: any) {
    throw new AppError(
      Err.VALIDATION_ERROR,
      `Provided invoice is invalid: ${encoded}`,
      e.message,
    )
  }
}

export const getInvoiceData = function (decoded: DecodedLightningInvoice) {
  const result: {amount?: number; description?: string; expiry?: number} = {}

  for (const item of decoded.sections) {
    switch (item.name) {
      case 'amount':
        result.amount = parseInt(item.value) / 1000 //sats
        break
      case 'description':
        result.description = (item.value as string) || ''
        break
    }
  }

  result.expiry = decoded.expiry
  return result
}

export const getTokenAmounts = function (token: Token) {
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

export const getTokenEntryAmount = function (tokenEntry: TokenEntry) {
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

export const getProofsAmount = function (proofs: Array<Proof>): number {
  let totalAmount = 0

  for (const proof of proofs) {
    const amount = proof.amount
    totalAmount += amount
  }

  return totalAmount
}

export const getMintsFromToken = function (token: Token): string[] {
  const mints = token.token.map(item => item.mint)
  return Array.from(new Set(mints)) // make sure the mints are not duplicated
}

export const updateMintProofs = function (
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

export const getProofsFromTokenEntries = (tokenEntries: TokenEntry[]) => {
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
export const getProofsToSend = function (amount: number, proofs: Array<Proof>) {
  let proofsAmount = 0
  const proofSubset = proofs.filter(proof => {
    if (proofsAmount < amount) {
      proofsAmount += proof.amount
      return true
    }
  })
  return proofSubset
}

/**
 * removes a set of tokens from another set of tokens, and returns the remaining.
 * @param proofs
 * @param proofsToRemove
 * @returns
 */
export const getProofsSubset = function (
  proofs: Array<Proof>,
  proofsToRemove: Array<Proof>,
): Array<Proof> {
  return proofs.filter(proof => !proofsToRemove.includes(proof))
}


export const validateMintKeys = function (keys: object): boolean {
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

////////////////////////////
// original nutstash methods - unused
////////////////////////////

/**
 * get a set of tokens from another set of tokens, and returns the remaining.
 * @param proofs
 * @param proofsToRemove
 * @returns
 */
export const getMintFromProof = function (
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



/**
 * returns a subset of all tokens that belong to the specified mint
 * @param mint
 * @param tokens
 * @returns
 */
export const getTokensForMint = function (mint: Mint, tokens: Array<Proof>) {
  const tokenSubset = tokens.filter(token => {
    if (mint?.keysets?.includes(token.id)) {
      return true
    } else {
      return false
    }
  })
  return tokenSubset
}

/**
 * removes a set of tokens from another set of tokens, and returns the remaining.
 * @param tokens
 * @param tokensToRemove
 * @returns
 */
export const getTokenSubset = function (
  tokens: Array<Proof>,
  tokensToRemove: Array<Proof>,
) {
  return tokens.filter(token => !tokensToRemove.includes(token))
}

export const getMintForToken = function (
  token: Proof,
  mints: Array<Mint>,
): Mint | undefined {
  let mint: Mint | undefined
  mints.forEach(m => {
    if (m.keysets?.includes(token.id)) {
      mint = m
    }
  })
  return mint
}

export const getAmountForTokenSet = function (tokens: Array<Proof>): number {
  return tokens.reduce((acc, t) => {
    return acc + t.amount
  }, 0)
}

export const getKeysetsOfTokens = function (tokens: Array<Proof>) {
  return removeDuplicatesFromArray(
    tokens.map(t => {
      return t.id
    }),
  )
}

export const removeDuplicatesFromArray = function <Type>(array: Array<Type>) {
  return array.reduce((acc: Array<Type>, curr: Type) => {
    if (acc.includes(curr)) {
      return acc
    } else {
      return [...acc, curr]
    }
  }, [])
}
