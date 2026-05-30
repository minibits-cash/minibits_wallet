import {isAlive} from 'mobx-state-tree'
import {Proof, ProofState, ProofRecord} from '../../models/Proof'
import {log} from '../logService'
import {SQLBatchTuple} from './connection'
import {getInstance} from './instance'
import {dbError} from './errors'

export const addOrUpdateProof = function (
  proof: Proof,
  state: ProofState = 'UNSPENT',
) {
  try {
    const now = new Date()

    const query = `
      INSERT OR REPLACE INTO proofs (id, amount, secret, C, dleq_r, dleq_s, dleq_e, unit, tId, mintUrl, state, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    const params = [
      proof.id,
      proof.amount,
      proof.secret,
      proof.C,
      proof.dleq ? proof.dleq.r : null,
      proof.dleq ? proof.dleq.s : null,
      proof.dleq ? proof.dleq.e : null,
      proof.unit,
      proof.tId,
      proof.mintUrl,
      state,
      now.toISOString(),
    ]

    const db = getInstance()
    const result = db.execute(query, params)
    // DO NOT log proof secrets to Sentry
    log.info('[addOrUpdateProof]', `Proof added or updated in the database`,
      {id: result.insertId, tId: proof.tId, state},
    )

    const newProof = getProofById(result.insertId as number)

    return newProof as ProofRecord
  } catch (e: any) {
    throw dbError('Could not store proof into the database', e)
  }
}

export const addOrUpdateProofs = function (
  proofs: Proof[],
  state: ProofState = 'UNSPENT',
): number | undefined {
  try {
    const now = new Date()
    let insertQueries: SQLBatchTuple[] = []

    if (proofs.length === 0) {
      log.error('[addOrUpdateProofs] Empty proof array passed')
      return 0
    }

    for (const proof of proofs) {
      if (!isAlive(proof)) {
        log.error('[addOrUpdateProofs] Proof is not alive', {id: proof.id})
        continue
      }

      insertQueries.push([
        `INSERT OR REPLACE INTO proofs (id, amount, secret, C, dleq_r, dleq_s, dleq_e, unit, tId, mintUrl, state, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          proof.id,
          proof.amount,
          proof.secret,
          proof.C,
          proof.dleq ? proof.dleq.r : null,
          proof.dleq ? proof.dleq.s : null,
          proof.dleq ? proof.dleq.e : null,
          proof.unit,
          proof.tId,
          proof.mintUrl,
          state,
          now.toISOString(),
        ],
      ])
    }

    const db = getInstance()
    const {rowsAffected} = db.executeBatch(insertQueries)

    // DO NOT log proof secrets to Sentry
    log.info('[addOrUpdateProofs]',
      `${rowsAffected} ${state} proofs were added or updated in the database`,
    )

    return rowsAffected
  } catch (e: any) {
    throw dbError('Could not insert or update proofs into the database', e)
  }
}


export const updateProofsMintUrl = function (currentMintUrl: string, updatedMintUrl: string) {
  try {
    const query = `
      UPDATE proofs
      SET mintUrl = ?
      WHERE mintUrl = ?
    `
    const params = [updatedMintUrl, currentMintUrl]

    const db = getInstance()
    db.execute(query, params)

    log.debug('[updateMintUrl]', 'Proof mintUrl updated', {currentMintUrl, updatedMintUrl})


  } catch (e: any) {
    throw dbError('Could not update proof mintUrl in database', e)
  }
}

export const removeAllProofs = async function () {
  try {
    const query = `
      DELETE FROM proofs
    `
    const db = getInstance()
    db.execute(query)

    log.info('[removeAllProofs]', 'All proofs were removed from the database.')

    return true
  } catch (e: any) {
    throw dbError('Could not remove proofs from the database', e)
  }
}

export const getProofById = function (id: number) {
  try {
    const query = `
      SELECT * FROM proofs WHERE id = ?
    `
    const params = [id]

    const db = getInstance()
    const {rows} = db.execute(query, params)

    return rows?.item(0) as ProofRecord
  } catch (e: any) {
    throw dbError('proof not found', e)
  }
}

export const getProofs = async (
  includeUnspent: boolean,
  includePending: boolean,
  includeSpent: boolean,
): Promise<ProofRecord[]> => {
  if (!includeUnspent && !includePending && !includeSpent) {
    return []
  }

  const states: string[] = []
  if (includeUnspent) states.push("'UNSPENT'")
  if (includePending) states.push("'PENDING'")
  if (includeSpent)  states.push("'SPENT'")

  const query = `
    SELECT *
    FROM proofs
    WHERE state IN (${states.join(', ')})
    ORDER BY id DESC
  `

  try {
    const db = getInstance()
    const { rows } = await db.executeAsync(query)
    return (rows?._array ?? []) as ProofRecord[]
  } catch (e: any) {
    throw dbError('Proofs could not be retrieved from the database', e)
  }
}

export const getProofsByTransaction = function (transactionId: number): ProofRecord[] {
  try {
    const query = `
      SELECT *
      FROM proofs
      WHERE tId = ?
    `
    const params = [transactionId]

    const db = getInstance()
    const {rows} = db.execute(query, params)

    return rows?._array as ProofRecord[]
  } catch (e: any) {
    throw dbError('Proofs could not be retrieved from the database', e)
  }
}
