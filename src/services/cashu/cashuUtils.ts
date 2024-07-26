import {Mint} from '../../models/Mint'
import {  
    AmountPreference,
    getDecodedToken,
    getEncodedToken,  
} from '@cashu/cashu-ts'
import cbor from '@exodus/borc'
import type {Token as TokenV3, TokenEntry as TokenEntryV3, Proof as ProofV3} from '@cashu/cashu-ts'
import AppError, {Err} from '../../utils/AppError'
import {} from '@cashu/cashu-ts'
import {Proof} from '../../models/Proof'
import { log } from '../logService'
// import { encodeCBOR } from '@cashu/cashu-ts/src/cbor'
import { encodeBase64ToJson, encodeBase64toUint8, encodeUint8toBase64 } from '@cashu/cashu-ts/src/base64'
import { bytesToHex, hexToBytes } from '@noble/curves/abstract/utils';

interface ProofV4 {
  a: number;
  s: string;
  c: Uint8Array;
  d?: { 
    e: Uint8Array,
    s: Uint8Array,
    r: Uint8Array
  },
  w?: string
}

interface TokenEntryV4 {
  i: Uint8Array;
  p: ProofV4[];
}

interface TokenV4 {
  m: string;
  u: string;
  d?: string;
  t: TokenEntryV4[]
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

const findEncodedCashuToken = function (content: string) {
  const words = content.split(/\s+|\n+/) // Split text into words
  const maybeToken = words.find(word => CASHU_TOKEN_PREFIXES.some(pref => word.includes(pref)))
  return maybeToken || null
}

const isValidCashuToken = function (text: string) {
  for (const prefix of CASHU_URI_PREFIXES) {
    if (text && text.startsWith(prefix)) {
      text = text.slice(prefix.length)
      break // necessary
    }
  }
  return text && CASHU_TOKEN_PREFIXES.some(pref => text.startsWith(pref))
}

const extractEncodedCashuToken = function (maybeToken: string): string {

    log.trace('[extractEncodedCashuToken] Extract token from', {maybeToken})
    
    let encodedToken: string | undefined = undefined
    let decoded: TokenV3 | undefined = undefined
    
    if (maybeToken && CASHU_TOKEN_PREFIXES.some(pref => maybeToken.startsWith(pref))) {
        decoded = decodeToken(maybeToken) // throws
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
        decoded = decodeToken(encodedToken) // throws
        return encodedToken
    }
    
    throw new AppError(Err.NOTFOUND_ERROR, 'Could not extract ecash token from the provided string', {maybeToken, caller: 'extractEncodedCashuToken'})
}



/* const decodeToken = function (encoded: string): V3Token {
  try {
    const decoded = getDecodedToken(encoded)
    return decoded as V3Token
  } catch (e: any) {
    throw new AppError(
      Err.VALIDATION_ERROR,
      `Provided ecash token is invalid.`,
      {message: e.message, encoded},
    )
  }
} */



function mapToV4TokenEntries(tokenEntries: TokenEntryV3[]): TokenEntryV4[] {
  const v4TokenEntries: TokenEntryV4[] = [];

  tokenEntries.forEach(entry => {
    const idMap: { [id: string]: ProofV4[] } = {};

    entry.proofs.forEach(proof => {
      if (!idMap[proof.id]) {
        idMap[proof.id] = [];
      }
      idMap[proof.id].push({
        a: proof.amount,
        s: proof.secret,
        c: hexToBytes(proof.C)
      });
    });

    for (const id in idMap) {
      v4TokenEntries.push({
        i: hexToBytes(id),
        p: idMap[id]
      });
    }
  });

  return v4TokenEntries  
}

function base64urlFromBase64(str: string) {
	return str.replace(/\+/g, '-').replace(/\//g, '_').split('=')[0];
	// .replace(/=/g, '.');
}

function base64urlToBase64(str: string) {
	return str.replace(/-/g, '+').replace(/_/g, '/').split('=')[0];
	// .replace(/./g, '=');
}


const encodeToken = function (token: TokenV3, version: 3 | 4 = 3): string {
  try {
    if(version === 3) {
      return getEncodedToken(token)
    } else if(version === 4) {
      const v4tokenEntries = mapToV4TokenEntries(token.token)

      const v4Token: TokenV4 = {
        m: token.token[0].mint as string,
        u: token.unit as string,
        d: token.memo as string,
        t: v4tokenEntries
      }

      log.trace('[encodeToken]', {v4Token})

      const encodedCbor = cbor.encode(v4Token)
      return 'cashuB' + base64urlFromBase64(encodeUint8toBase64(encodedCbor))
    } else {
      throw new Error('Invalid version.')
    }    
  } catch (e: any) {
    throw new AppError(
      Err.VALIDATION_ERROR,
      `Error encoding token to version {${version}} format.`,
      {message: e.message},
    )
  }
}


/**
 * Helper function to decode cashu tokens into object
 * @param token an encoded cashu token (cashuAey...)
 * @returns cashu token object
 */
function decodeToken(token: string) {
	// remove prefixes
	const uriPrefixes = [...CASHU_URI_PREFIXES, 'cashu'];
	uriPrefixes.forEach((prefix) => {
		if (!token.startsWith(prefix)) {
			return;
		}
		token = token.slice(prefix.length);
	});
	return handleTokens(token);
}

/**
 * @param token
 * @returns
 */
function handleTokens(token: string): TokenV3 {
	const version = token.slice(0, 1);
	const encodedToken = token.slice(1);
	if (version === 'A') {
		return encodeBase64ToJson<TokenV3>(encodedToken);
	} else if (version === 'B') {
		const uInt8Token = encodeBase64toUint8(base64urlToBase64(encodedToken));
		const tokenData = cbor.decodeFirst(uInt8Token) as TokenV4
		const mergedTokenEntry: TokenEntryV3 = { mint: tokenData.m, proofs: [] };
		tokenData.t.forEach((tokenEntry) =>
			tokenEntry.p.forEach((p) => {
				mergedTokenEntry.proofs.push({
					secret: p.s,
					C: bytesToHex(p.c),
					amount: p.a,
					id: bytesToHex(tokenEntry.i)
				});
			})
		);
		return { token: [mergedTokenEntry], memo: tokenData.d || '', unit: tokenData.u };
	} else {
		throw new Error('Token version is not supported');
	}
}



const getTokenAmounts = function (token: TokenV3) {
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


const getTokenEntryAmount = function (tokenEntry: TokenEntryV3) {
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


const getProofsAmount = function (proofs: Array<ProofV3>): number {
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


const getMintsFromToken = function (token: TokenV3): string[] {
  const mints = token.token.map(item => item.mint)
  return Array.from(new Set(mints)) // make sure the mints are not duplicated
}


const getProofsFromTokenEntries = (tokenEntries: TokenEntryV3[]) => {
  const proofs: ProofV3[] = []

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
    isValidCashuToken,
    decodeToken,
    encodeToken,
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
