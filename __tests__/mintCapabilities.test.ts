/**
 * Mint capability views (Mint.ts).
 *
 * The wallet decides which payment options to offer from the mint's cached NUT-06
 * info. Getting this wrong is user-visible in both directions: offer a method the
 * mint does not have and the operation fails at quote time; hide one it does have
 * and the user simply cannot use their money.
 *
 * Two rules carry most of the weight:
 *
 *  - `onchain` (NUT-30) additionally requires NUT-20, because the mint MUST refuse
 *    an onchain mint quote that carries no pubkey (error 20009).
 *  - When capabilities are UNKNOWN (info never cached), bolt11 is assumed and
 *    anything else is not — assuming bolt11 preserves the wallet's behaviour to
 *    date and cannot strand a user with an empty menu.
 *
 * @jest-environment node
 */
jest.mock('../src/services/logService', () => ({
    log: {debug: jest.fn(), error: jest.fn(), info: jest.fn(), trace: jest.fn(), warn: jest.fn()},
    LogLevel: {ERROR: 'ERROR', WARN: 'WARN', INFO: 'INFO', DEBUG: 'DEBUG', TRACE: 'TRACE'},
}))
jest.mock('../src/services', () => ({
    log: {debug: jest.fn(), error: jest.fn(), info: jest.fn(), trace: jest.fn(), warn: jest.fn()},
    Database: {},
}))
// Mint.ts pulls in ../theme and ../services/wallet/currency, and currency imports
// the components barrel -> react-native-reanimated (ESM, not transformed here).
// Neither is needed to exercise the capability views, which read only mintInfo.
jest.mock('../src/theme', () => ({
    colors: {palette: {iconBlue200: '#4dabf7'}},
    getRandomIconColor: () => '#4dabf7',
}))
jest.mock('../src/services/wallet/currency', () => ({
    MintUnits: ['btc', 'sat', 'msat', 'usd', 'eur'],
}))
// utils.ts -> react-native-flash-message -> react-native-iphone-screen-helper (ESM).
jest.mock('../src/utils/utils', () => ({
    generateId: () => 'testmint',
}))
// cashuUtils -> nostrService -> ESM deps. Not reached by the capability views.
jest.mock('../src/services/cashu/cashuUtils', () => ({
    CashuUtils: {},
}))

import {MintModel} from '../src/models/Mint'

type MethodEntry = {
    method: string
    unit: string
    min_amount?: number | null
    max_amount?: number | null
    options?: {confirmations?: number}
}

/** Build a mint whose cached info advertises the given methods. */
const mintWith = (opts: {
    mintMethods?: MethodEntry[]
    meltMethods?: MethodEntry[]
    mintDisabled?: boolean
    meltDisabled?: boolean
    nut20?: boolean
}) =>
    MintModel.create({
        mintUrl: 'https://mint.test',
        mintInfo: {
            name: 'test',
            pubkey: 'aa',
            version: 'test/1',
            contact: [],
            nuts: {
                '4': {methods: opts.mintMethods ?? [], disabled: opts.mintDisabled ?? false},
                '5': {methods: opts.meltMethods ?? [], disabled: opts.meltDisabled ?? false},
                ...(opts.nut20 === undefined ? {} : {'20': {supported: opts.nut20}}),
            },
            time: Math.floor(Date.now() / 1000),
        } as any,
    })

/** A mint whose info was never cached (offline when added, or a very old entry). */
const mintWithUnknownInfo = () => MintModel.create({mintUrl: 'https://mint.test'})

// Shapes taken from the live CDK test mint.
const BOLT11_SAT: MethodEntry = {method: 'bolt11', unit: 'sat', min_amount: 1, max_amount: 500000}
const ONCHAIN_SAT: MethodEntry = {
    method: 'onchain',
    unit: 'sat',
    min_amount: 10000,
    max_amount: 500000,
    options: {confirmations: 1},
}

describe('method settings lookup', () => {
    it('returns the advertised setting for a (method, unit) pair', () => {
        const mint = mintWith({mintMethods: [BOLT11_SAT, ONCHAIN_SAT]})

        expect(mint.mintMethodSetting('onchain', 'sat')).toMatchObject({
            method: 'onchain',
            min_amount: 10000,
            options: {confirmations: 1},
        })
    })

    it('is undefined for a method the mint does not advertise', () => {
        const mint = mintWith({mintMethods: [BOLT11_SAT]})

        expect(mint.mintMethodSetting('onchain', 'sat')).toBeUndefined()
    })

    it('does not match a supported method in the wrong unit', () => {
        const mint = mintWith({mintMethods: [ONCHAIN_SAT]})

        expect(mint.mintMethodSetting('onchain', 'usd')).toBeUndefined()
    })

    it('survives the round trip through persisted storage', () => {
        const stored = JSON.parse(
            JSON.stringify({
                name: 'test',
                pubkey: 'aa',
                version: 'test/1',
                contact: [],
                nuts: {
                    '4': {methods: [BOLT11_SAT, ONCHAIN_SAT], disabled: false},
                    '5': {methods: [BOLT11_SAT], disabled: false},
                },
                time: Math.floor(Date.now() / 1000),
            }),
        )
        const mint = MintModel.create({mintUrl: 'https://mint.test', mintInfo: stored})

        expect(mint.mintMethodSetting('bolt11', 'sat')).toMatchObject(BOLT11_SAT)
        expect(mint.mintMethodSetting('onchain', 'sat')).toMatchObject(ONCHAIN_SAT)
        expect(mint.meltMethodSetting('bolt11', 'sat')).toMatchObject(BOLT11_SAT)
    })

    it('keeps mint and melt lists separate', () => {
        // a mint may take onchain deposits without paying onchain out
        const mint = mintWith({
            mintMethods: [BOLT11_SAT, ONCHAIN_SAT],
            meltMethods: [BOLT11_SAT],
            nut20: true,
        })

        expect(mint.supportsMint('onchain', 'sat')).toBe(true)
        expect(mint.supportsMelt('onchain', 'sat')).toBe(false)
    })
})

describe('supportsMint / supportsMelt', () => {
    it('supports bolt11 when advertised', () => {
        const mint = mintWith({mintMethods: [BOLT11_SAT], meltMethods: [BOLT11_SAT]})

        expect(mint.supportsMint('bolt11', 'sat')).toBe(true)
        expect(mint.supportsMelt('bolt11', 'sat')).toBe(true)
    })

    it('does NOT support onchain mint without NUT-20, even when advertised', () => {
        // the mint would reject the quote with 20009 (pubkey required), so an
        // onchain method with no NUT-20 is unusable to us
        const mint = mintWith({mintMethods: [BOLT11_SAT, ONCHAIN_SAT], nut20: false})

        expect(mint.supportsMint('onchain', 'sat')).toBe(false)
        expect(mint.supportsMint('bolt11', 'sat')).toBe(true)
    })

    it('supports onchain mint when advertised alongside NUT-20', () => {
        const mint = mintWith({mintMethods: [BOLT11_SAT, ONCHAIN_SAT], nut20: true})

        expect(mint.supportsMint('onchain', 'sat')).toBe(true)
    })

    it('allows onchain melt without NUT-20 (it gates mint quotes only)', () => {
        const mint = mintWith({meltMethods: [ONCHAIN_SAT], nut20: false})

        expect(mint.supportsMelt('onchain', 'sat')).toBe(true)
    })

    it('handles a pure-onchain mint (no bolt11 at all)', () => {
        const mint = mintWith({
            mintMethods: [ONCHAIN_SAT],
            meltMethods: [ONCHAIN_SAT],
            nut20: true,
        })

        expect(mint.supportsMint('bolt11', 'sat')).toBe(false)
        expect(mint.supportsMelt('bolt11', 'sat')).toBe(false)
        expect(mint.supportsMint('onchain', 'sat')).toBe(true)
        expect(mint.supportsMelt('onchain', 'sat')).toBe(true)
    })
})

describe('the NUT-04 / NUT-05 disabled flag', () => {
    it('reports no mint method when NUT-04 is disabled, however many are listed', () => {
        const mint = mintWith({mintMethods: [BOLT11_SAT, ONCHAIN_SAT], mintDisabled: true, nut20: true})

        expect(mint.mintMethodSetting('bolt11', 'sat')).toBeUndefined()
        expect(mint.mintMethodSetting('onchain', 'sat')).toBeUndefined()
        expect(mint.supportsMint('bolt11', 'sat')).toBe(false)
        expect(mint.supportsMint('onchain', 'sat')).toBe(false)
    })

    it('reports no melt method when NUT-05 is disabled', () => {
        const mint = mintWith({meltMethods: [BOLT11_SAT], meltDisabled: true})

        expect(mint.meltMethodSetting('bolt11', 'sat')).toBeUndefined()
        expect(mint.supportsMelt('bolt11', 'sat')).toBe(false)
    })

    it('disables only the half that is switched off', () => {
        // topups closed, payouts still open
        const mint = mintWith({
            mintMethods: [BOLT11_SAT],
            mintDisabled: true,
            meltMethods: [BOLT11_SAT],
        })

        expect(mint.supportsMint('bolt11', 'sat')).toBe(false)
        expect(mint.supportsMelt('bolt11', 'sat')).toBe(true)
    })

    it('is not the same as unknown capabilities — a disabled mint has cached info', () => {
        const mint = mintWith({mintMethods: [BOLT11_SAT], mintDisabled: true})

        expect(mint.hasUnknownCapabilities).toBe(false)
        expect(mint.supportsMint('bolt11', 'sat')).toBe(false)
    })

    it('keeps melting available when disabled NUT-04 omits methods', () => {
        const mint = MintModel.create({
            mintUrl: 'https://mint.test',
            mintInfo: {
                nuts: {
                    '4': {disabled: true},
                    '5': {methods: [BOLT11_SAT], disabled: false},
                },
                time: Math.floor(Date.now() / 1000),
            } as any,
        })

        expect(mint.supportsMint('bolt11', 'sat')).toBe(false)
        expect(mint.supportsMelt('bolt11', 'sat')).toBe(true)
    })

    it('keeps minting available when disabled NUT-05 omits methods', () => {
        const mint = MintModel.create({
            mintUrl: 'https://mint.test',
            mintInfo: {
                nuts: {
                    '4': {methods: [BOLT11_SAT], disabled: false},
                    '5': {disabled: true},
                },
                time: Math.floor(Date.now() / 1000),
            } as any,
        })

        expect(mint.supportsMint('bolt11', 'sat')).toBe(true)
        expect(mint.supportsMelt('bolt11', 'sat')).toBe(false)
    })
})

describe('supportsNut20', () => {
    it.each(['true', 'false', 1])('rejects a truthy non-boolean support flag (%s)', supported => {
        const mint = MintModel.create({
            mintUrl: 'https://mint.test',
            mintInfo: {
                nuts: {
                    '4': {methods: [ONCHAIN_SAT], disabled: false},
                    '5': {methods: [], disabled: false},
                    '20': {supported},
                },
                time: Math.floor(Date.now() / 1000),
            } as any,
        })

        expect(mint.supportsNut20).toBe(false)
        expect(mint.supportsMint('onchain', 'sat')).toBe(false)
    })

    it('is true when the mint advertises NUT-20', () => {
        expect(mintWith({nut20: true}).supportsNut20).toBe(true)
    })

    it('is false when the mint advertises it as unsupported', () => {
        expect(mintWith({nut20: false}).supportsNut20).toBe(false)
    })

    it('is false when the mint does not mention NUT-20 at all', () => {
        expect(mintWith({}).supportsNut20).toBe(false)
    })

    it('is false when info was never cached', () => {
        expect(mintWithUnknownInfo().supportsNut20).toBe(false)
    })
})

describe('unknown capabilities (info never cached)', () => {
    it('assumes bolt11, so an upgrading user never loses their Lightning options', () => {
        const mint = mintWithUnknownInfo()

        expect(mint.hasUnknownCapabilities).toBe(true)
        expect(mint.supportsMint('bolt11', 'sat')).toBe(true)
        expect(mint.supportsMelt('bolt11', 'sat')).toBe(true)
    })

    it('hides onchain until the mint positively advertises it', () => {
        const mint = mintWithUnknownInfo()

        expect(mint.supportsMint('onchain', 'sat')).toBe(false)
        expect(mint.supportsMelt('onchain', 'sat')).toBe(false)
    })
})

describe('setMintInfo stamps the fetch time', () => {
    it('sets `time` so the staleness check can actually fire', () => {
        // Callers pass a raw GetInfoResponse (which has no `time`). If the stamp
        // were left to them, `now - undefined` is NaN, NaN > ttl is false, and the
        // TTL would never fire — info would be cached forever.
        const mint = mintWithUnknownInfo()
        const before = Math.floor(Date.now() / 1000)

        mint.setMintInfo({
            name: 'test',
            pubkey: 'aa',
            version: 'test/1',
            contact: [],
            nuts: {'4': {methods: [], disabled: false}, '5': {methods: [], disabled: false}},
        } as any)

        expect(typeof mint.mintInfo!.time).toBe('number')
        expect(mint.mintInfo!.time).toBeGreaterThanOrEqual(before)
        expect(mint.hasUnknownCapabilities).toBe(false)
    })
})
