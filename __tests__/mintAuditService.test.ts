/**
 * Mint auditor client (services/mintAuditService.ts).
 *
 * The auditor is a third party the wallet must not depend on: it can be down,
 * can answer 404 for a mint it does not track, and can change its payload. The
 * contract this file pins is that NONE of that ever reaches the user as an
 * error — the availability section simply does not render.
 *
 * The other half is the warning heuristics, which mirror cashu.me's auditor
 * panel (MintAuditWarningBox) so the same mint does not read as healthy in one
 * wallet and suspect in the other. Getting a threshold wrong here is quiet and
 * consequential: it either cries wolf about a working mint or stays silent
 * about one that has been failing for a week.
 *
 * @jest-environment node
 */
jest.mock('../src/services/logService', () => ({
    log: {debug: jest.fn(), error: jest.fn(), info: jest.fn(), trace: jest.fn(), warn: jest.fn()},
}))

import {AUDIT_THRESHOLDS, getMintAuditSummary} from '../src/services/mintAuditService'

const MINT_URL = 'https://mint.test/Bitcoin'

const RECORD = {
    id: 2,
    url: MINT_URL,
    name: 'Test mint',
    state: 'OK',
    n_errors: 87,
    n_mints: 1961,
    n_melts: 2951,
    updated_at: '2026-08-10T19:01:04',
}

/** Naive-UTC timestamp `daysAgo` days back, in the auditor's wire format. */
const at = (daysAgo: number) =>
    new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, '')

const swap = (opts: {daysAgo: number; state?: string; ms?: number}) => ({
    state: opts.state ?? 'OK',
    time_taken: opts.ms ?? 2000,
    created_at: at(opts.daysAgo),
})

/** A healthy history: enough recent successes, all fast. */
const healthySwaps = () => Array.from({length: 10}, (_, i) => swap({daysAgo: i * 0.5}))

/** Route the two endpoints the service calls; `swaps: null` fails that request. */
const mockApi = (opts: {record?: unknown; recordStatus?: number; swaps?: unknown | null}) => {
    const fetchMock = jest.fn(async (url: string) => {
        if (url.includes('/mints/url')) {
            const status = opts.recordStatus ?? 200
            return {ok: status >= 200 && status < 300, status, json: async () => opts.record}
        }
        if (opts.swaps === null) throw new Error('network down')
        return {ok: true, status: 200, json: async () => opts.swaps ?? []}
    })
    ;(global as any).fetch = fetchMock
    return fetchMock
}

afterEach(() => {
    delete (global as any).fetch
})

describe('failure is always graceful', () => {
    it('resolves undefined when the auditor does not track the mint (404)', async () => {
        mockApi({recordStatus: 404, record: {detail: 'Not found'}})
        await expect(getMintAuditSummary(MINT_URL)).resolves.toBeUndefined()
    })

    it('resolves undefined when the request throws', async () => {
        ;(global as any).fetch = jest.fn(async () => {
            throw new Error('network down')
        })
        await expect(getMintAuditSummary(MINT_URL)).resolves.toBeUndefined()
    })

    it('resolves undefined when the payload is not the record we expect', async () => {
        // No `id` means we cannot trust anything else in the body either.
        mockApi({record: {url: MINT_URL, state: 'OK'}})
        await expect(getMintAuditSummary(MINT_URL)).resolves.toBeUndefined()
    })

    it('keeps the summary when only the swap history fails', async () => {
        // Degrading to the record alone beats dropping the whole section.
        mockApi({record: RECORD, swaps: null})
        const summary = await getMintAuditSummary(MINT_URL)
        expect(summary?.state).toBe('OK')
        expect(summary?.swap).toBeUndefined()
        expect(summary?.warnings).toEqual([])
        expect(summary?.history).toEqual([])
    })

    it('resolves undefined for an empty mint url without calling out', async () => {
        const fetchMock = mockApi({record: RECORD})
        await expect(getMintAuditSummary('')).resolves.toBeUndefined()
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('url-encodes the mint url it looks up', async () => {
        const fetchMock = mockApi({record: RECORD})
        await getMintAuditSummary(MINT_URL)
        expect(fetchMock.mock.calls[0][0]).toContain(encodeURIComponent(MINT_URL))
    })

    it('falls back to UNKNOWN for a state it does not recognise', async () => {
        mockApi({record: {...RECORD, state: 'WEIRD'}})
        expect((await getMintAuditSummary(MINT_URL))?.state).toBe('UNKNOWN')
    })
})

describe('swap statistics', () => {
    it('scores the success rate over the whole sample', async () => {
        mockApi({
            record: RECORD,
            swaps: [swap({daysAgo: 0}), swap({daysAgo: 1}), swap({daysAgo: 2, state: 'ERROR'})],
        })
        const stats = (await getMintAuditSummary(MINT_URL))?.swap
        expect(stats).toMatchObject({successRate: 67, okCount: 2, totalCount: 3})
    })

    it('averages only the SUCCESSFUL swaps — a failure has no meaningful duration', async () => {
        mockApi({
            record: RECORD,
            swaps: [
                swap({daysAgo: 0, ms: 1000}),
                swap({daysAgo: 1, ms: 3000}),
                swap({daysAgo: 2, state: 'ERROR', ms: 60000}),
            ],
        })
        expect((await getMintAuditSummary(MINT_URL))?.swap?.averageMs).toBe(2000)
    })

    it('leaves the average absent when no swap was timed', async () => {
        mockApi({record: RECORD, swaps: [{state: 'OK', created_at: at(0)}]})
        expect((await getMintAuditSummary(MINT_URL))?.swap?.averageMs).toBeUndefined()
    })
})

describe('swap history (drives the timeline)', () => {
    it('returns the sample sorted OLDEST first, whatever order the API used', async () => {
        // The chart reads left-to-right off this ordering, and the API's
        // newest-first ordering is not contractual.
        mockApi({
            record: RECORD,
            swaps: [swap({daysAgo: 1}), swap({daysAgo: 5}), swap({daysAgo: 3})],
        })
        const history = (await getMintAuditSummary(MINT_URL))!.history
        expect(history).toHaveLength(3)
        expect(history.map(h => h.at.getTime())).toEqual(
            [...history.map(h => h.at.getTime())].sort((a, b) => a - b),
        )
    })

    it('carries the outcome as a boolean, not the auditor\'s state vocabulary', async () => {
        mockApi({record: RECORD, swaps: [swap({daysAgo: 1}), swap({daysAgo: 2, state: 'ERROR'})]})
        expect((await getMintAuditSummary(MINT_URL))!.history.map(h => h.ok)).toEqual([false, true])
    })

    it('drops events the timeline could not place', async () => {
        mockApi({record: RECORD, swaps: [{state: 'OK'}, swap({daysAgo: 1})]})
        expect((await getMintAuditSummary(MINT_URL))!.history).toHaveLength(1)
    })
})

describe('auditor timestamps are naive UTC', () => {
    it('reads `2026-08-10T19:01:04` as UTC, not as local time', async () => {
        // Parsed as local time this shifts by the device offset, and far enough
        // east the auditor appears to have checked in the future.
        mockApi({record: RECORD})
        expect((await getMintAuditSummary(MINT_URL))?.updatedAt?.toISOString())
            .toBe('2026-08-10T19:01:04.000Z')
    })

    it('respects an explicit zone when the auditor sends one', async () => {
        mockApi({record: {...RECORD, updated_at: '2026-08-10T19:01:04+02:00'}})
        expect((await getMintAuditSummary(MINT_URL))?.updatedAt?.toISOString())
            .toBe('2026-08-10T17:01:04.000Z')
    })

    it('drops an unparseable timestamp rather than rendering an invalid date', async () => {
        mockApi({record: {...RECORD, updated_at: 'not a date'}})
        expect((await getMintAuditSummary(MINT_URL))?.updatedAt).toBeUndefined()
    })
})

describe('warnings', () => {
    const codesFor = async (state: string, swaps: unknown[]) => {
        mockApi({record: {...RECORD, state}, swaps})
        const summary = await getMintAuditSummary(MINT_URL)
        return summary!.warnings.map(w => w.code)
    }

    it('stays silent about a healthy mint', async () => {
        expect(await codesFor('OK', healthySwaps())).toEqual([])
    })

    it('qualifies a failed last swap by the recent record', async () => {
        // A single failure against a good week usually says more about the
        // swap's counterparty than about this mint.
        expect(await codesFor('ERROR', healthySwaps())).toEqual(['lastSwapFailedReliable'])
    })

    it('calls a failing mint unreliable when the recent record is bad too', async () => {
        const swaps = [
            ...Array.from({length: 6}, (_, i) => swap({daysAgo: i * 0.5, state: 'ERROR'})),
            ...Array.from({length: 4}, (_, i) => swap({daysAgo: 3 + i * 0.5})),
        ]
        expect(await codesFor('ERROR', swaps)).toContain('lastSwapFailedUnreliable')
    })

    it('reports a failure without context when there is no recent history', async () => {
        expect(await codesFor('ERROR', [swap({daysAgo: 60})])).toContain('lastSwapFailed')
    })

    it('says so when the auditor could not form a verdict', async () => {
        expect(await codesFor('UNKNOWN', healthySwaps())).toEqual(['unknownQuality'])
    })

    it('flags thin recent data even when the mint is OK', async () => {
        const codes = await codesFor('OK', [swap({daysAgo: 0}), swap({daysAgo: 1})])
        expect(codes).toContain('notEnoughData')
    })

    it('flags a recent success rate under the threshold', async () => {
        const swaps = [
            ...Array.from({length: 8}, (_, i) => swap({daysAgo: i * 0.2})),
            ...Array.from({length: 4}, (_, i) => swap({daysAgo: 2 + i * 0.2, state: 'ERROR'})),
        ]
        mockApi({record: RECORD, swaps})
        const warning = (await getMintAuditSummary(MINT_URL))!.warnings.find(
            w => w.code === 'lowSuccessRate',
        )
        expect(warning?.params).toEqual({
            percent: 67,
            days: AUDIT_THRESHOLDS.recentDays,
            threshold: AUDIT_THRESHOLDS.successRatePercent,
        })
    })

    it('judges liveness over the whole sample, not the recent window', async () => {
        // A mint that went quiet a month ago has NO recent swaps to fail, so a
        // recent-window-only check would report nothing at all.
        const codes = await codesFor('OK', [swap({daysAgo: 30}), swap({daysAgo: 31})])
        expect(codes).toContain('inactive')
    })

    it('does not call a mint inactive within the threshold', async () => {
        expect(await codesFor('OK', healthySwaps())).not.toContain('inactive')
    })

    it('finds the last success by date, not by array position', async () => {
        // The API returns newest first, but that ordering is not contractual.
        mockApi({
            record: RECORD,
            swaps: [swap({daysAgo: 40}), swap({daysAgo: 0}), swap({daysAgo: 20})],
        })
        const codes = (await getMintAuditSummary(MINT_URL))!.warnings.map(w => w.code)
        expect(codes).not.toContain('inactive')
    })

    it('flags a slow mint', async () => {
        const swaps = Array.from({length: 10}, (_, i) =>
            swap({daysAgo: i * 0.5, ms: AUDIT_THRESHOLDS.slowMs + 1000}),
        )
        mockApi({record: RECORD, swaps})
        const warning = (await getMintAuditSummary(MINT_URL))!.warnings.find(w => w.code === 'slow')
        expect(warning?.params).toEqual({seconds: '6.0'})
    })

    it('reports a mint with swaps but no successes as unreachable', async () => {
        const codes = await codesFor('OK', [
            swap({daysAgo: 0, state: 'ERROR'}),
            swap({daysAgo: 1, state: 'ERROR'}),
        ])
        expect(codes).toContain('noSuccessfulSwaps')
        // ...and not ALSO as inactive, which needs a last success to measure from
        expect(codes).not.toContain('inactive')
    })

    it('ignores swap events with no usable timestamp', async () => {
        const codes = await codesFor('OK', [{state: 'OK', time_taken: 100}, ...healthySwaps()])
        expect(codes).toEqual([])
    })
})
