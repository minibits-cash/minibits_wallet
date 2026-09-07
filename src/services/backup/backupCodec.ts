/**
 * The wallet backup envelope: how a backup payload becomes the string the user
 * carries between devices, and how it comes back.
 *
 * A backup is BEARER MONEY — it holds every proof's secret and signature — and it
 * used to travel as plain base64. Anyone who saw the shared text, or the file it
 * landed in, could redeem all of it. So the payload is encrypted to the wallet's
 * bip39 seed, which the import screen already has: it makes the user enter their
 * mnemonic BEFORE the backup can be pasted, because the profile recovery needs it.
 * The key is therefore available exactly when it is needed, with nothing new to
 * remember and nothing extra to type.
 *
 * The format is versioned by a single character after the `minibits` prefix:
 *
 *   minibitsA<base64>   plaintext JSON. Read-only, and forever: people have old
 *                       backups saved in notes and password managers, and refusing
 *                       them would strand wallets.
 *   minibitsB<base64>   salt(16) ‖ iv(12) ‖ tag(16) ‖ AES-256-GCM ciphertext.
 *
 * Two things deliberately NOT done here:
 *
 *  - The key is not derived from `seedHash`. That value identifies the wallet
 *    profile to the Minibits server, which therefore knows it; a backup key must
 *    be something only the holder of the mnemonic can compute.
 *
 *  - The envelope carries no wallet identifier. It would let the import say "wrong
 *    seed phrase" rather than "wrong seed phrase or damaged backup", at the price
 *    of a stable fingerprint linking any two backup files to the same wallet. The
 *    GCM tag already distinguishes the two cases well enough in practice.
 */
import QuickCrypto from 'react-native-quick-crypto'
import AppError, {Err} from '../../utils/AppError'
import {log} from '../logService'
import {translate} from '../../i18n'

const PREFIX = 'minibits'
/** Plaintext JSON. Decoded, never produced. */
const VERSION_PLAINTEXT = 'A'
/** AES-256-GCM, keyed by the bip39 seed. */
const VERSION_ENCRYPTED = 'B'

const SALT_BYTES = 16
const IV_BYTES = 12
const TAG_BYTES = 16
const KEY_BYTES = 32

/**
 * HKDF domain separator. Changing it makes every existing backup undecryptable,
 * so it changes only alongside a new version character.
 */
const HKDF_INFO = 'minibits/backup/v1'

const CIPHER = 'aes-256-gcm'

/**
 * Every failure in here is shown to the user as-is, so each message is a whole,
 * translated sentence naming what went wrong and, where there is one, what to do
 * about it. AppError also carries it to Sentry — a wallet that cannot restore its
 * backup is exactly what we want to hear about.
 */
const backupError = (message: string, params?: Record<string, any>) =>
    new AppError(Err.VALIDATION_ERROR, message, params)

/**
 * The backup key, derived from the bip39 seed with HKDF-SHA256 (RFC 5869).
 *
 * HKDF and not a password KDF: the input is a 512-bit seed, already uniformly
 * random, so there is nothing for iteration count to buy — Argon2 or a large
 * PBKDF2 would only make every export and import slower. The random per-backup
 * salt means two backups of the same wallet share no key material.
 *
 * The expand step is a single block because the output is 32 bytes, exactly one
 * SHA-256 block: T(1) = HMAC(PRK, info ‖ 0x01).
 */
const deriveBackupKey = function (seed: Uint8Array, salt: Uint8Array) {
    const prk = QuickCrypto.createHmac('sha256', Buffer.from(salt))
        .update(Buffer.from(seed))
        .digest()

    const okm = QuickCrypto.createHmac('sha256', prk)
        .update(Buffer.concat([Buffer.from(HKDF_INFO, 'utf8'), Buffer.from([1])]))
        .digest()

    return okm.subarray(0, KEY_BYTES)
}

/**
 * Encode a backup payload as an encrypted `minibitsB` string.
 *
 * `seed` MUST be the seed the mnemonic derives — `mnemonicToSeedSync(mnemonic)` —
 * because that is what the import computes from the words the user types. The two
 * are the same value for every wallet this codebase has ever created (the keychain
 * seed is generated from the mnemonic), but the import has only the mnemonic, so
 * that is the side the contract is written from.
 *
 * The result is decrypted again before it is returned. That is not paranoia about
 * the cipher: an export that produces an unrestorable string fails SILENTLY, and
 * is discovered by the user at the worst possible moment — when the phone is gone
 * and the backup is all they have. One extra decryption makes that outcome
 * impossible rather than unlikely.
 */
export const encodeBackup = function (payload: unknown, seed: Uint8Array): string {
    if (!seed || seed.length === 0) {
        throw backupError(translate('backupCodec_missingSeedToEncrypt'), {
            caller: 'encodeBackup',
        })
    }

    const plaintext = Buffer.from(JSON.stringify(payload), 'utf8')
    let encoded: string

    try {
        const salt = Buffer.from(QuickCrypto.randomBytes(SALT_BYTES))
        const iv = Buffer.from(QuickCrypto.randomBytes(IV_BYTES))

        const cipher = QuickCrypto.createCipheriv(CIPHER, deriveBackupKey(seed, salt), iv)
        const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
        const tag = cipher.getAuthTag()

        encoded = PREFIX + VERSION_ENCRYPTED + Buffer.concat([salt, iv, tag, ciphertext]).toString('base64')
    } catch (e: any) {
        throw backupError(translate('backupCodec_encryptFailed', {error: e.message}), {
            caller: 'encodeBackup',
        })
    }

    // Read back what we are about to hand the user. See the note above.
    let verified: unknown
    try {
        verified = decodeBackup(encoded, seed)
    } catch (e: any) {
        throw backupError(translate('backupCodec_verifyFailed'), {
            caller: 'encodeBackup',
            error: e.message,
        })
    }

    if (!Buffer.from(JSON.stringify(verified), 'utf8').equals(plaintext)) {
        throw backupError(translate('backupCodec_verifyMismatch'), {
            caller: 'encodeBackup',
        })
    }

    log.debug('[encodeBackup]', 'Wallet backup encrypted', {bytes: encoded.length})

    return encoded
}

/**
 * The decoded bytes as a payload. Anything that reaches JSON.parse has already
 * passed the GCM tag (or is a legacy plaintext body), so a parse failure here
 * means the string itself was mangled on its way between the two devices —
 * truncated by whatever the user pasted it through, most likely.
 */
const parsePayload = function (json: string): unknown {
    try {
        return JSON.parse(json)
    } catch (e: any) {
        throw backupError(translate('backupCodec_unreadable'), {
            caller: 'decodeBackup',
            error: e.message,
        })
    }
}

/** Split `minibits<version><body>`, or say why it is not a backup at all. */
const parseEnvelope = function (backup: string): {version: string; body: string} {
    const trimmed = (backup ?? '').trim()

    if (!trimmed.startsWith(PREFIX) || trimmed.length <= PREFIX.length) {
        throw backupError(translate('backupCodec_notABackup', {prefix: PREFIX}), {
            caller: 'decodeBackup',
        })
    }

    return {
        version: trimmed.charAt(PREFIX.length),
        body: trimmed.slice(PREFIX.length + 1),
    }
}

/**
 * Decode a backup string back into its payload, whichever version it is.
 *
 * The legacy plaintext body is read as LATIN-1 on purpose. It was produced by
 * `btoa(JSON.stringify(...))`, which maps each UTF-16 code unit below 0x100 to one
 * byte — so an accented character in a contact name is a single byte in those
 * backups, and reading them as UTF-8 would corrupt exactly the names that motivated
 * moving off `btoa` in the first place. (`btoa` also threw outright on anything
 * above U+00FF, which is why some exports used to fail with no backup produced;
 * `minibitsB` is UTF-8 throughout and has no such limit.)
 */
export const decodeBackup = function (backup: string, seed: Uint8Array): unknown {
    const {version, body} = parseEnvelope(backup)

    if (version === VERSION_PLAINTEXT) {
        return parsePayload(Buffer.from(body, 'base64').toString('latin1'))
    }

    if (version !== VERSION_ENCRYPTED) {
        throw backupError(translate('backupCodec_unsupportedVersion', {version}), {
            caller: 'decodeBackup',
        })
    }

    if (!seed || seed.length === 0) {
        throw backupError(translate('backupCodec_missingSeedToDecrypt'), {
            caller: 'decodeBackup',
        })
    }

    const envelope = Buffer.from(body, 'base64')

    if (envelope.length <= SALT_BYTES + IV_BYTES + TAG_BYTES) {
        throw backupError(translate('backupCodec_incomplete'), {caller: 'decodeBackup'})
    }

    const salt = envelope.subarray(0, SALT_BYTES)
    const iv = envelope.subarray(SALT_BYTES, SALT_BYTES + IV_BYTES)
    const tag = envelope.subarray(SALT_BYTES + IV_BYTES, SALT_BYTES + IV_BYTES + TAG_BYTES)
    const ciphertext = envelope.subarray(SALT_BYTES + IV_BYTES + TAG_BYTES)

    const decipher = QuickCrypto.createDecipheriv(CIPHER, deriveBackupKey(seed, salt), iv)
    decipher.setAuthTag(tag)

    let plaintext: Buffer
    try {
        plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    } catch (e: any) {
        // GCM cannot tell a wrong key from altered bytes — both fail the same tag
        // check — so the message names both, in the order the user should check.
        throw backupError(translate('backupCodec_decryptFailed'), {caller: 'decodeBackup'})
    }

    return parsePayload(plaintext.toString('utf8'))
}
