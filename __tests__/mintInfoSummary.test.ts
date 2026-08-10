/**
 * Mint info presentation (screens/Mints/mintInfoSummary.ts).
 *
 * Every field of a NUT-06 `/v1/info` response is optional and mints publish
 * genuinely inconsistent shapes for the same NUT — nutshell answers NUT-17 as a
 * bare array, others as `{supported: [...]}`, others as `{supported: true}`.
 * The mint detail screen used to carry a per-NUT ladder of special cases for
 * this; the whole point of this module is to funnel it into one place, so the
 * funnel is what these tests pin down.
 *
 * The failure that matters is silent: a mint that DOES support something
 * rendering as if it does not (or vice versa), which sends a user to a mint
 * under a false idea of what it can do.
 *
 * @jest-environment node
 */
// currency.ts imports the component modules for its currency icons, which pull
// in react-native-reanimated (ESM, not transformed here). Only MintUnits is
// reached from this module's unit-narrowing.
jest.mock('../src/services/wallet/currency', () => ({
    MintUnits: ['btc', 'sat', 'msat', 'usd', 'eur'],
}))
// The components barrel is imported for the IconTypes TYPE only, which is
// erased at compile time — but the import statement still executes.
jest.mock('../src/components', () => ({}))
jest.mock('../src/i18n', () => ({}))

import {
    asNonEmptyString,
    getContacts,
    getMintCapabilities,
    getNutSupport,
    getPaymentMethods,
    isNutSupported,
    MintInfo,
} from '../src/screens/Mints/mintInfoSummary'

const infoWith = (nuts: Record<string, unknown>) => ({nuts} as unknown as MintInfo)

const capability = (info: MintInfo | undefined, key: string) =>
    getMintCapabilities(info).find(c => c.key === key)

const method = (info: MintInfo | undefined, name: string) =>
    getPaymentMethods(info).find(m => m.method === name)

describe('isNutSupported', () => {
    it('reads the common {supported: boolean} form', () => {
        expect(isNutSupported({supported: true})).toBe(true)
        expect(isNutSupported({supported: false})).toBe(false)
    })

    it('reads a non-empty {supported: [...]} array (nutshell NUT-17)', () => {
        expect(isNutSupported({supported: [{method: 'bolt11', unit: 'sat'}]})).toBe(true)
        expect(isNutSupported({supported: []})).toBe(false)
    })

    it('reads a BARE array, which nutshell also publishes for NUT-17', () => {
        // https://github.com/cashubtc/nutshell/issues/588
        expect(isNutSupported([{method: 'bolt11', unit: 'sat'}])).toBe(true)
        expect(isNutSupported([])).toBe(false)
    })

    it('treats an advertised method list as support', () => {
        expect(isNutSupported({methods: [{method: 'bolt11', unit: 'sat'}]})).toBe(true)
        expect(isNutSupported({methods: []})).toBe(false)
    })

    it('lets `disabled` override an advertised method list', () => {
        expect(isNutSupported({methods: [{method: 'bolt11'}], disabled: true})).toBe(false)
        expect(isNutSupported({methods: [{method: 'bolt11'}], disabled: false})).toBe(true)
    })

    it('reads NUT-19 cached endpoints', () => {
        expect(isNutSupported({cached_endpoints: [{method: 'POST', path: '/v1/swap'}], ttl: 604800})).toBe(true)
        expect(isNutSupported({cached_endpoints: []})).toBe(false)
    })

    it('survives the malformed values mints actually publish', () => {
        expect(isNutSupported(null)).toBe(false)
        expect(isNutSupported(undefined)).toBe(false)
        expect(isNutSupported({})).toBe(false)
        expect(isNutSupported(true)).toBe(true)
        expect(isNutSupported(false)).toBe(false)
        expect(isNutSupported('yes')).toBe(true)
        expect(isNutSupported(0)).toBe(false)
    })
})

describe('capabilities', () => {
    it('is on when ANY of the capability\'s NUTs is supported', () => {
        // authentication: clear (21) OR blind (22)
        expect(capability(infoWith({'22': {supported: true}}), 'authRequired')?.supported).toBe(true)
        expect(capability(infoWith({'21': {supported: true}}), 'authRequired')?.supported).toBe(true)
        expect(capability(infoWith({}), 'authRequired')?.supported).toBe(false)
    })

    it('flags authentication as a caveat, not a feature', () => {
        // The screen renders `warning` capabilities only when PRESENT — a mint
        // that needs no account must not be listed as missing a feature.
        expect(capability(infoWith({}), 'authRequired')?.warning).toBe(true)
        expect(capability(infoWith({}), 'seedRestore')?.warning).toBeUndefined()
    })

    it('reports every capability as unsupported when the mint published no nuts', () => {
        const capabilities = getMintCapabilities(undefined)
        expect(capabilities.length).toBeGreaterThan(0)
        expect(capabilities.every(c => !c.supported)).toBe(true)
    })

    it('is not fooled by a nuts value that is not an object', () => {
        expect(getMintCapabilities({nuts: 'broken'} as unknown as MintInfo).every(c => !c.supported)).toBe(true)
    })
})

describe('technical NUT breakdown', () => {
    it('sorts numerically, not lexically', () => {
        const nuts = getNutSupport(infoWith({'20': {supported: true}, '4': {}, '17': {}, '7': {}}))
        expect(nuts.map(n => n.nut)).toEqual(['4', '7', '17', '20'])
    })

    it('zero-pads the code the way the specs are written', () => {
        expect(getNutSupport(infoWith({'7': {supported: true}}))[0].code).toBe('NUT-07')
    })

    it('lists only what the mint actually advertised', () => {
        // Absence is not "unsupported": no mint advertises the mandatory NUTs.
        expect(getNutSupport(infoWith({'7': {supported: true}})).map(n => n.nut)).toEqual(['7'])
    })

    it('renders an unknown NUT number without a title rather than dropping it', () => {
        const [nut] = getNutSupport(infoWith({'99': {supported: true}}))
        expect(nut.code).toBe('NUT-99')
        expect(nut.title).toBeUndefined()
        expect(nut.supported).toBe(true)
    })
})

describe('payment methods', () => {
    const LIGHTNING_AND_ONCHAIN = infoWith({
        '4': {
            methods: [
                {method: 'bolt11', unit: 'sat', min_amount: 0, max_amount: 1000000},
                {method: 'onchain', unit: 'sat', min_amount: 10000, options: {confirmations: 3}},
            ],
            disabled: false,
        },
        '5': {
            methods: [{method: 'bolt11', unit: 'sat', min_amount: 1, max_amount: 500000}],
            disabled: false,
        },
    })

    it('groups a rail\'s deposit and withdrawal limits together', () => {
        const bolt11 = method(LIGHTNING_AND_ONCHAIN, 'bolt11')
        expect(bolt11?.mint).toEqual([{unit: 'sat', mintUnit: 'sat', min: 0, max: 1000000}])
        expect(bolt11?.melt).toEqual([{unit: 'sat', mintUnit: 'sat', min: 1, max: 500000}])
    })

    it('keeps a deposit-only rail, with an empty withdrawal side', () => {
        // Dropping it would hide a usable deposit route; the screen renders the
        // missing direction as "Not supported".
        const onchain = method(LIGHTNING_AND_ONCHAIN, 'onchain')
        expect(onchain?.mint).toHaveLength(1)
        expect(onchain?.melt).toEqual([])
    })

    it('carries the onchain confirmation depth', () => {
        expect(method(LIGHTNING_AND_ONCHAIN, 'onchain')?.confirmations).toBe(3)
    })

    it('orders Lightning before on-chain regardless of the mint\'s order', () => {
        expect(getPaymentMethods(LIGHTNING_AND_ONCHAIN).map(m => m.method)).toEqual(['bolt11', 'onchain'])
    })

    it('keeps every unit a rail settles in', () => {
        const multi = infoWith({
            '4': {methods: [
                {method: 'bolt11', unit: 'sat', max_amount: 1000},
                {method: 'bolt11', unit: 'usd', max_amount: 50},
            ]},
        })
        expect(method(multi, 'bolt11')?.mint.map(l => l.unit)).toEqual(['sat', 'usd'])
    })

    it('marks a unit the wallet has no currency data for', () => {
        const exotic = infoWith({'4': {methods: [{method: 'bolt11', unit: 'gbp', max_amount: 10}]}})
        expect(method(exotic, 'bolt11')?.mint[0]).toEqual({unit: 'gbp', mintUnit: undefined, min: undefined, max: 10})
    })

    it('drops a whole direction when the mint disables that NUT', () => {
        const disabled = infoWith({
            '4': {methods: [{method: 'bolt11', unit: 'sat'}], disabled: true},
            '5': {methods: [{method: 'bolt11', unit: 'sat'}], disabled: false},
        })
        expect(method(disabled, 'bolt11')?.mint).toEqual([])
        expect(method(disabled, 'bolt11')?.melt).toHaveLength(1)
    })

    it('distinguishes an absent limit from a zero one', () => {
        // `min_amount: 0` is a real bound and must not read as "no minimum".
        const info = infoWith({'4': {methods: [{method: 'bolt11', unit: 'sat', min_amount: 0}]}})
        const [limit] = method(info, 'bolt11')!.mint
        expect(limit.min).toBe(0)
        expect(limit.max).toBeUndefined()
    })

    it('ignores method entries too malformed to render', () => {
        const junk = infoWith({
            '4': {methods: [null, {unit: 'sat'}, {method: 'bolt11'}, {method: 'bolt11', unit: 'sat'}]},
        })
        expect(getPaymentMethods(junk)).toHaveLength(1)
        expect(method(junk, 'bolt11')?.mint).toEqual([
            {unit: 'sat', mintUnit: 'sat', min: undefined, max: undefined},
        ])
    })

    it('yields nothing when the mint published no methods', () => {
        expect(getPaymentMethods(undefined)).toEqual([])
        expect(getPaymentMethods(infoWith({}))).toEqual([])
    })
})

describe('contacts', () => {
    it('reads the current {method, info} objects', () => {
        const info = {contact: [{method: 'email', info: 'a@b.c'}]} as unknown as MintInfo
        expect(getContacts(info)).toEqual([{method: 'email', info: 'a@b.c'}])
    })

    it('still reads the legacy tuple form older mints publish', () => {
        const info = {contact: [['email', 'a@b.c']]} as unknown as MintInfo
        expect(getContacts(info)).toEqual([{method: 'email', info: 'a@b.c'}])
    })

    it('drops half-filled and malformed entries', () => {
        const info = {
            contact: [null, {method: 'email'}, {info: 'a@b.c'}, ['nostr', '  '], {method: 'x', info: 'y'}],
        } as unknown as MintInfo
        expect(getContacts(info)).toEqual([{method: 'x', info: 'y'}])
    })

    it('is empty when contact is missing or not an array', () => {
        expect(getContacts(undefined)).toEqual([])
        expect(getContacts({contact: 'nope'} as unknown as MintInfo)).toEqual([])
    })
})

describe('asNonEmptyString', () => {
    it('rejects whitespace-only and non-string values', () => {
        expect(asNonEmptyString('  x ')).toBe('x')
        expect(asNonEmptyString('   ')).toBeUndefined()
        expect(asNonEmptyString(undefined)).toBeUndefined()
        expect(asNonEmptyString(42)).toBeUndefined()
    })
})

describe('the live Minibits mint response', () => {
    // Verbatim `nuts` from https://mint.minibits.cash/Bitcoin — the shape this
    // module was written against, including nutshell's NUT-17 quirk.
    const MINIBITS = infoWith({
        '4': {methods: [{method: 'bolt11', unit: 'sat', min_amount: 0, max_amount: 1000000, options: {description: true}}], disabled: false},
        '5': {methods: [{method: 'bolt11', unit: 'sat', min_amount: 0, max_amount: 1000000}], disabled: false},
        '7': {supported: true},
        '8': {supported: true},
        '9': {supported: true},
        '10': {supported: true},
        '11': {supported: true},
        '12': {supported: true},
        '14': {supported: true},
        '20': {supported: true},
        '15': {methods: [{method: 'bolt11', unit: 'sat'}]},
        '17': {supported: [{method: 'bolt11', unit: 'sat', commands: ['bolt11_melt_quote']}]},
        '19': {cached_endpoints: [{method: 'POST', path: '/v1/swap'}], ttl: 604800},
        '29': {supported: true, max_batch_size: 1000, methods: ['bolt11']},
    })

    it('resolves the capabilities a user would expect to see', () => {
        const supported = getMintCapabilities(MINIBITS).filter(c => c.supported).map(c => c.key)
        expect(supported.sort()).toEqual([
            'batchedMint',
            'feeReturn',
            'liveUpdates',
            'lockedEcash',
            'multiPath',
            'offlineVerification',
            'quoteBinding',
            'safeRetries',
            'seedRestore',
            'stateCheck',
            'timelocks',
        ])
        expect(supported).not.toContain('authRequired')
    })

    it('resolves one Lightning rail with symmetric limits', () => {
        expect(getPaymentMethods(MINIBITS)).toEqual([
            expect.objectContaining({
                method: 'bolt11',
                mint: [{unit: 'sat', mintUnit: 'sat', min: 0, max: 1000000}],
                melt: [{unit: 'sat', mintUnit: 'sat', min: 0, max: 1000000}],
            }),
        ])
    })

    it('marks every advertised NUT as supported', () => {
        expect(getNutSupport(MINIBITS).filter(n => !n.supported)).toEqual([])
    })
})
