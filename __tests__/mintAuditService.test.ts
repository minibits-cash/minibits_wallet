/**
 * Mint auditor client (services/mintAuditService.ts), backed by MintRadar.
 *
 * MintRadar is a third party the wallet must not depend on: it can be down,
 * can answer 404 for a mint it does not track, and can change its payload. The
 * contract this file pins is that NONE of that ever reaches the user as an
 * error — the availability section simply does not render.
 *
 * @jest-environment node
 */
jest.mock('../src/services/logService', () => ({
    log: {debug: jest.fn(), error: jest.fn(), info: jest.fn(), trace: jest.fn(), warn: jest.fn()},
}))

import {getMintAuditSummary} from '../src/services/mintAuditService'

const MINT_URL = 'https://mint.test/Bitcoin'

/** Trimmed copy of a real single-mint answer. */
const MINT = {
    url: MINT_URL,
    status: 'online',
    score: 98,
    scoreStale: false,
    uptime24hPct: 100,
    uptime7dPct: 100,
    uptime30dPct: 100,
    lastCheckedAt: '2026-11-12T11:40:03.262Z',
    mintDisabled: false,
    meltDisabled: false,
    software: 'cdk-mintd/0.18.3',
    outdated: false,
    isTest: false,
    audit: {swaps7d: 12, attributedFailures: 0, fetchedAt: '2026-11-12T11:12:30.129Z'},
    latency24h: {p50Ms: 235, p95Ms: 486, samples: 285},
}

const mockApi = (opts: {body?: unknown; status?: number; fail?: boolean}) => {
    const fetchMock = jest.fn(async (_url: string) => {
        if (opts.fail) throw new Error('network down')
        const status = opts.status ?? 200
        return {ok: status < 300, status, json: async () => opts.body}
    })
    ;(global as any).fetch = fetchMock
    return fetchMock
}

const summaryOf = (mint: object) => {
    mockApi({body: {mint: {...MINT, ...mint}}})
    return getMintAuditSummary(MINT_URL)
}

const codes = async (mint: object) => (await summaryOf(mint))!.warnings.map(w => w.code)

describe('getMintAuditSummary', () => {
    it('maps a healthy mint and hits the encoded single-mint route', async () => {
        const fetchMock = mockApi({body: {mint: MINT}})
        const s = await getMintAuditSummary(MINT_URL)

        expect(fetchMock.mock.calls[0][0]).toBe(
            'https://mintradar.org/api/v1/wallets/mints/https%3A%2F%2Fmint.test%2FBitcoin',
        )
        expect(s).toMatchObject({
            status: 'online',
            score: 98,
            uptime30d: 100,
            latencyMs: 235,
            swaps: {okCount: 12, totalCount: 12},
            auditUrl: 'https://mintradar.org/mint/https%3A%2F%2Fmint.test%2FBitcoin',
            warnings: [],
        })
        expect(s!.updatedAt!.toISOString()).toBe('2026-11-12T11:40:03.262Z')
    })

    it.each([
        ['404', {status: 404, body: {error: {code: 'mint_not_found'}}}],
        ['network error', {fail: true}],
        ['unexpected shape', {body: {mints: []}}],
    ])('resolves undefined on %s', async (_label, opts) => {
        mockApi(opts)
        await expect(getMintAuditSummary(MINT_URL)).resolves.toBeUndefined()
    })

    it('tolerates nulls', async () => {
        const s = await summaryOf({score: null, uptime30dPct: null, audit: null, latency24h: null, status: 'weird'})
        expect(s).toMatchObject({status: 'offline', score: undefined, swaps: undefined, latencyMs: undefined})
    })
})

describe('warnings', () => {
    it('flags offline / degraded / archived', async () => {
        expect(await codes({status: 'offline'})).toEqual(['offline'])
        expect(await codes({status: 'degraded'})).toEqual(['offline'])
        expect(await codes({status: 'archived', uptime30dPct: 0})).toEqual(['archived'])
    })

    it('flags uptime below 95% only', async () => {
        expect(await codes({uptime30dPct: 95})).toEqual([])
        expect(await codes({uptime30dPct: 94})).toEqual(['lowUptime'])
    })

    it('judges swap success only with enough swaps', async () => {
        expect(await codes({audit: {swaps7d: 9, attributedFailures: 5}})).toEqual([])
        expect(await codes({audit: {swaps7d: 20, attributedFailures: 3}})).toEqual([])
        expect(await codes({audit: {swaps7d: 20, attributedFailures: 4}})).toEqual(['lowSuccessRate'])
    })

    it('flags disabled sides, outdated software and test mints', async () => {
        expect(await codes({mintDisabled: true, meltDisabled: true, outdated: true, isTest: true}))
            .toEqual(['mintDisabled', 'meltDisabled', 'outdated', 'testMint'])
    })
})
