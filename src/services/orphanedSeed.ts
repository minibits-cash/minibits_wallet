import {wasSchemaCreatedThisLaunch} from './db/instance'
import {KeyChain} from './keyChain'
import {log} from './logService'

/**
 * An ORPHANED SEED is a wallet key that outlived the wallet: the keychain still holds
 * a seed, but this launch had to build the database from nothing.
 *
 * In practice that means an iOS reinstall. Deleting an app removes its container —
 * this database, and MMKV with it — but iOS deliberately does NOT remove the app's
 * keychain items. (Apple briefly changed that in an iOS 10.3 beta and reverted before
 * release; it has never been contractually guaranteed either way, so this is behavior
 * to detect, not to depend on.) Android has no equivalent: the keystore dies with the
 * app's uid, and `android:allowBackup="false"` keeps Google Backup from restoring a
 * container, so a reinstall there arrives with neither keys nor schema.
 *
 * Why it is worth detecting: the seed comes back, but every derivation counter is
 * gone with the database. Resuming that seed at counter 0 re-derives blinded secrets
 * the mint has ALREADY signed — the duplicate _B that SeedRecoveryScreen advances the
 * counter to avoid. The mint then either rejects the outputs or hands back proofs that
 * are already spent. Recovery is the only safe way to resume such a seed: it walks the
 * derivation space and moves the counter past whatever the mint has seen.
 *
 * WHY A SNAPSHOT, AND NOT A LIVE CHECK. The naive condition — "keys exist AND the
 * schema is new" — triggers on itself. On a genuinely fresh install the schema IS new,
 * so the moment onboarding generates and saves keys the condition becomes true, and a
 * user who backs out of onboarding and returns is offered the chance to reset a seed
 * that is thirty seconds old. The question is not "are there keys now" but "were there
 * keys before we ran", so it is answered once, at startup, before onboarding can
 * create anything.
 */

let _hasOrphanedSeed = false
let _isCaptured = false

/**
 * Answer the question once, at startup. Must run BEFORE onboarding can save keys
 * (see setupRootStore) and AFTER the database has been opened, which is what makes
 * wasSchemaCreatedThisLaunch meaningful.
 *
 * Never throws: a keychain that cannot be read is not a reason to fail a launch. It
 * only means we cannot offer the choice, and the pre-existing behaviour (resume the
 * seed) applies — which is what shipped for every release until now.
 */
export const captureOrphanedSeed = async function () {
  if (_isCaptured) return

  try {
    _hasOrphanedSeed = wasSchemaCreatedThisLaunch() && (await KeyChain.hasWalletKeys())

    if (_hasOrphanedSeed) {
      log.info(
        '[captureOrphanedSeed]',
        'Wallet keys found but no database — the container was wiped and the keychain survived',
      )
    }
  } catch (e: any) {
    log.error('[captureOrphanedSeed]', 'Could not determine seed provenance', {message: e.message})
    _hasOrphanedSeed = false
  } finally {
    _isCaptured = true
  }
}

/** True when this launch found a seed with no wallet behind it. */
export const hasOrphanedSeed = () => _hasOrphanedSeed

/**
 * Clear the flag once the user has decided what to do with the seed.
 *
 * Needed because the snapshot outlives the decision: after a user chooses to start
 * fresh, onboarding generates NEW keys, and without this a back-out-and-return would
 * offer to reset those instead. Recovery deliberately does NOT clear it — a user who
 * abandons recovery half way has not resolved anything, and should be asked again.
 */
export const resolveOrphanedSeed = function () {
  _hasOrphanedSeed = false
}

/** Test seam: restore the module to its pre-capture state. */
export const _resetOrphanedSeedForTests = function () {
  _hasOrphanedSeed = false
  _isCaptured = false
}
