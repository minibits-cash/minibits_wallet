/**
 * Turns a mint's raw NUT-06 `/v1/info` response into the things a user actually
 * wants to know: which payment rails it settles on (with their limits), and
 * which capabilities it supports — phrased as capabilities, not as NUT numbers.
 *
 * This is deliberately pure and UI-free so the (considerable) defensive parsing
 * can be reasoned about — and tested — apart from the screen that renders it.
 *
 * EVERY field of a NUT-06 response is optional and real mints publish malformed
 * values, so nothing here may assume a shape. The rule throughout: narrow, or
 * drop the item.
 */
import { GetInfoResponse, SwapMethod } from '@cashu/cashu-ts'
import { IconTypes } from '../../components'
import { TxKeyPath } from '../../i18n'
import { MintUnit, MintUnits } from '../../services/wallet/currency'

/** `icon_url` is not in cashu-ts' type yet, but every mint publishes it. */
export type MintInfo = GetInfoResponse & {icon_url?: string; tos_url?: string; urls?: string[]}

// === NUT support ===

/**
 * Is the NUT whose `nuts` entry is `value` supported?
 *
 * One funnel for the whole zoo of shapes mints publish, replacing what used to
 * be a per-NUT ladder of special cases:
 *
 *  - `{supported: true}`            — the common form
 *  - `{supported: [...]}`           — nutshell's NUT-17, a per-method array
 *  - `[...]`                        — a bare array, also seen for NUT-17
 *    (https://github.com/cashubtc/nutshell/issues/588)
 *  - `{methods: [...], disabled}`   — NUT-04 / NUT-05 / NUT-15 / NUT-29
 *  - `{cached_endpoints: [...]}`    — NUT-19
 *
 * `disabled` wins over everything, since a mint that advertises methods AND
 * disables them is telling us it is off.
 */
export function isNutSupported(value: unknown): boolean {
    if (value === null || typeof value === 'undefined') return false
    if (typeof value === 'boolean') return value
    if (typeof value !== 'object') return Boolean(value)
    if (Array.isArray(value)) return value.length > 0

    const settings = value as Record<string, unknown>

    if (settings.disabled === true) return false
    if (typeof settings.supported === 'boolean') return settings.supported
    if (Array.isArray(settings.supported)) return settings.supported.length > 0
    if (Array.isArray(settings.methods)) return settings.methods.length > 0
    if (Array.isArray(settings.cached_endpoints)) return settings.cached_endpoints.length > 0

    // `disabled: false` with no other evidence still means "on"
    return settings.disabled === false
}

/** The mint's `nuts` map, or an empty one when it published something else. */
function getNuts(info?: MintInfo): Record<string, unknown> {
    const nuts = info?.nuts
    return nuts !== null && typeof nuts === 'object' && !Array.isArray(nuts)
        ? (nuts as Record<string, unknown>)
        : {}
}

/** Support flag for one NUT number, e.g. `supports(info, '11')`. */
function supports(info: MintInfo | undefined, nut: string): boolean {
    return isNutSupported(getNuts(info)[nut])
}

// === Capabilities ===

export type MintCapability = {
    key: string
    icon: IconTypes
    labelTx: TxKeyPath
    /** one line on what it means for the person holding the ecash */
    descriptionTx: TxKeyPath
    supported: boolean
    /**
     * A caveat rather than a feature — its presence is the notable thing, its
     * absence is the norm. Callers render these only when supported, so they
     * never appear in a "not supported" list where the polarity would invert.
     */
    warning?: boolean
}

/**
 * The capability catalogue, in display order.
 *
 * Only NUTs with a consequence a user can feel are listed — the rest stay in
 * the technical NUT breakdown. `nuts` is OR-ed: a capability is on when the
 * mint supports any of them (authentication is clear *or* blind).
 */
const CAPABILITY_SPECS: Array<{
    key: string
    nuts: string[]
    icon: IconTypes
    labelTx: TxKeyPath
    descriptionTx: TxKeyPath
    warning?: boolean
}> = [
    {
        key: 'seedRestore',
        nuts: ['9'],
        icon: 'faSeedling',
        labelTx: 'mintInfo_capability_seedRestore',
        descriptionTx: 'mintInfo_capability_seedRestoreDesc',
    },
    {
        key: 'offlineVerification',
        nuts: ['12'],
        icon: 'faShieldHalved',
        labelTx: 'mintInfo_capability_offlineVerification',
        descriptionTx: 'mintInfo_capability_offlineVerificationDesc',
    },
    {
        key: 'lockedEcash',
        nuts: ['11'],
        icon: 'faLock',
        labelTx: 'mintInfo_capability_lockedEcash',
        descriptionTx: 'mintInfo_capability_lockedEcashDesc',
    },
    {
        key: 'timelocks',
        nuts: ['14'],
        icon: 'faClock',
        labelTx: 'mintInfo_capability_timelocks',
        descriptionTx: 'mintInfo_capability_timelocksDesc',
    },
    {
        key: 'feeReturn',
        nuts: ['8'],
        icon: 'faArrowRotateLeft',
        labelTx: 'mintInfo_capability_feeReturn',
        descriptionTx: 'mintInfo_capability_feeReturnDesc',
    },
    {
        key: 'stateCheck',
        nuts: ['7'],
        icon: 'faMagnifyingGlass',
        labelTx: 'mintInfo_capability_stateCheck',
        descriptionTx: 'mintInfo_capability_stateCheckDesc',
    },
    {
        key: 'liveUpdates',
        nuts: ['17'],
        icon: 'faWifi',
        labelTx: 'mintInfo_capability_liveUpdates',
        descriptionTx: 'mintInfo_capability_liveUpdatesDesc',
    },
    {
        key: 'safeRetries',
        nuts: ['19'],
        icon: 'faRecycle',
        labelTx: 'mintInfo_capability_safeRetries',
        descriptionTx: 'mintInfo_capability_safeRetriesDesc',
    },
    {
        key: 'quoteBinding',
        nuts: ['20'],
        icon: 'faKey',
        labelTx: 'mintInfo_capability_quoteBinding',
        descriptionTx: 'mintInfo_capability_quoteBindingDesc',
    },
    {
        key: 'batchedMint',
        nuts: ['29'],
        icon: 'faCoins',
        labelTx: 'mintInfo_capability_batchedMint',
        descriptionTx: 'mintInfo_capability_batchedMintDesc',
    },
    {
        key: 'multiPath',
        nuts: ['15'],
        icon: 'faArrowRightArrowLeft',
        labelTx: 'mintInfo_capability_multiPath',
        descriptionTx: 'mintInfo_capability_multiPathDesc',
    },
    {
        key: 'authRequired',
        nuts: ['21', '22'],
        icon: 'faUserShield',
        labelTx: 'mintInfo_capability_authRequired',
        descriptionTx: 'mintInfo_capability_authRequiredDesc',
        warning: true,
    },
]

export function getMintCapabilities(info?: MintInfo): MintCapability[] {
    return CAPABILITY_SPECS.map(({nuts, ...spec}) => ({
        ...spec,
        supported: nuts.some(nut => supports(info, nut)),
    }))
}

// === Technical NUT breakdown ===

/** Titles from https://github.com/cashubtc/nuts. Unlisted numbers render bare. */
const NUT_TITLES: Record<string, string> = {
    '0': 'Cryptography and models',
    '1': 'Mint public keys',
    '2': 'Keysets and fees',
    '3': 'Swapping tokens',
    '4': 'Minting tokens',
    '5': 'Melting tokens',
    '6': 'Mint information',
    '7': 'Token state check',
    '8': 'Overpaid Lightning fees',
    '9': 'Signature restore',
    '10': 'Spending conditions',
    '11': 'Pay-to-Pubkey (P2PK)',
    '12': 'DLEQ proofs',
    '13': 'Deterministic secrets',
    '14': 'Hashed timelock contracts',
    '15': 'Multi-path payments',
    '16': 'Animated QR codes',
    '17': 'WebSocket subscriptions',
    '18': 'Payment requests',
    '19': 'Cached responses',
    '20': 'Signature on mint quote',
    '21': 'Clear authentication',
    '22': 'Blind authentication',
    '23': 'Payment method: BOLT11',
    '24': 'HTTP 402 Payment Required',
    '25': 'Payment method: BOLT12',
    '26': 'Payment request bech32m encoding',
    '27': 'Nostr mint backup',
    '28': 'Pay-to-blinded-key (P2BK)',
    '29': 'Batched minting',
    '30': 'Payment method: onchain',
}

export type NutSupport = {
    nut: string
    /** "NUT-04" — zero-padded the way the specs are written */
    code: string
    title?: string
    supported: boolean
}

/**
 * Every NUT the mint mentions, numerically sorted.
 *
 * Only what the mint actually published: absence from `nuts` is not the same as
 * "unsupported" for the mandatory NUTs (00–06), which no mint advertises
 * individually but every mint implements.
 */
export function getNutSupport(info?: MintInfo): NutSupport[] {
    return Object.entries(getNuts(info))
        .map(([nut, value]) => ({
            nut,
            code: `NUT-${nut.padStart(2, '0')}`,
            title: NUT_TITLES[nut],
            supported: isNutSupported(value),
        }))
        .sort((a, b) => {
            const na = Number(a.nut)
            const nb = Number(b.nut)
            // non-numeric keys (never seen in the wild, but cheap to survive) sink
            if (isNaN(na) || isNaN(nb)) return a.nut.localeCompare(b.nut)
            return na - nb
        })
}

// === Payment methods and limits ===

export type MethodLimit = {
    unit: string
    /** already-normalized wallet unit, absent when the mint uses one we do not know */
    mintUnit?: MintUnit
    min?: number
    max?: number
}

export type PaymentMethodSummary = {
    method: string
    icon: IconTypes
    /** translated label for known rails; unknown methods fall back to `method` */
    labelTx?: TxKeyPath
    /** per-unit deposit limits; empty when the mint does not mint with this rail */
    mint: MethodLimit[]
    /** per-unit withdrawal limits; empty when the mint does not melt with this rail */
    melt: MethodLimit[]
    /** onchain (NUT-30) only: confirmations the mint waits for before crediting */
    confirmations?: number
}

const METHOD_SPECS: Record<string, {icon: IconTypes; labelTx: TxKeyPath}> = {
    bolt11: {icon: 'faBolt', labelTx: 'mintInfo_method_bolt11'},
    bolt12: {icon: 'faBolt', labelTx: 'mintInfo_method_bolt12'},
    onchain: {icon: 'faCubes', labelTx: 'mintInfo_method_onchain'},
}

/** Display order for the rails we recognise; anything else follows, as given. */
const METHOD_ORDER = ['bolt11', 'bolt12', 'onchain']

/** The `methods` array of NUT-04 (mint) or NUT-05 (melt), or empty. */
function getMethods(info: MintInfo | undefined, nut: '4' | '5'): SwapMethod[] {
    const entry = getNuts(info)[nut]
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return []
    // A disabled NUT-04/05 means the direction is off, whatever it lists.
    if ((entry as Record<string, unknown>).disabled === true) return []
    const methods = (entry as {methods?: unknown}).methods
    return Array.isArray(methods) ? (methods.filter(Boolean) as SwapMethod[]) : []
}

const asPositiveNumber = (value: unknown): number | undefined => {
    const n = Number(value)
    return typeof value !== 'undefined' && value !== null && !isNaN(n) && n >= 0 ? n : undefined
}

function toLimit(method: SwapMethod): MethodLimit | undefined {
    const unit = typeof method.unit === 'string' ? method.unit : undefined
    if (!unit) return undefined

    return {
        unit,
        mintUnit: (MintUnits as readonly string[]).includes(unit) ? (unit as MintUnit) : undefined,
        min: asPositiveNumber(method.min_amount),
        max: asPositiveNumber(method.max_amount),
    }
}

/**
 * Payment rails the mint settles on, each with its deposit and withdrawal
 * limits per unit.
 *
 * A rail is keyed by `method`, NOT by NUT number — onchain (NUT-30) has no
 * `nuts['30']` block of its own, it is simply an entry in the NUT-04 / NUT-05
 * method lists (the same reasoning as Mint.mintMethodSetting). A rail appears
 * here if EITHER direction offers it; the missing direction renders as
 * unsupported rather than silently dropping the rail.
 */
export function getPaymentMethods(info?: MintInfo): PaymentMethodSummary[] {
    const summaries = new Map<string, PaymentMethodSummary>()

    const collect = (direction: 'mint' | 'melt', methods: SwapMethod[]) => {
        for (const method of methods) {
            const name = typeof method.method === 'string' ? method.method : undefined
            const limit = name ? toLimit(method) : undefined
            if (!name || !limit) continue

            let summary = summaries.get(name)
            if (!summary) {
                summary = {
                    method: name,
                    icon: METHOD_SPECS[name]?.icon ?? 'faCoins',
                    labelTx: METHOD_SPECS[name]?.labelTx,
                    mint: [],
                    melt: [],
                }
                summaries.set(name, summary)
            }

            summary[direction].push(limit)

            // NUT-30 publishes the confirmation depth under the mint method's
            // options; it is the same figure for the whole rail.
            const confirmations = asPositiveNumber(
                (method as {options?: {confirmations?: unknown}}).options?.confirmations,
            )
            if (typeof confirmations !== 'undefined') summary.confirmations = confirmations
        }
    }

    collect('mint', getMethods(info, '4'))
    collect('melt', getMethods(info, '5'))

    return [...summaries.values()].sort((a, b) => {
        const ia = METHOD_ORDER.indexOf(a.method)
        const ib = METHOD_ORDER.indexOf(b.method)
        return (ia === -1 ? METHOD_ORDER.length : ia) - (ib === -1 ? METHOD_ORDER.length : ib)
    })
}

// === Contacts ===

export type MintContact = {method: string; info: string}

/** Narrows a possibly-malformed value to a non-empty trimmed string. */
export function asNonEmptyString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/**
 * Contacts, accepting both the current `{method, info}` objects and the legacy
 * `['email', 'a@b.c']` tuples that older mints still publish.
 */
export function getContacts(info?: MintInfo): MintContact[] {
    const raw = Array.isArray(info?.contact) ? info.contact : []
    const contacts: MintContact[] = []

    for (const contact of raw) {
        if (!contact) continue

        const [method, value] = Array.isArray(contact)
            ? [asNonEmptyString(contact[0]), asNonEmptyString(contact[1])]
            : [
                  asNonEmptyString((contact as MintContact).method),
                  asNonEmptyString((contact as MintContact).info),
              ]

        if (method && value) contacts.push({method, info: value})
    }

    return contacts
}
