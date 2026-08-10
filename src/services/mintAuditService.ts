/**
 * Read-only client for the public Cashu mint auditor (https://audit.8333.space).
 *
 * The auditor continuously swaps small amounts between the mints it knows about
 * and records whether each swap succeeded and how long it took. That gives an
 * INDEPENDENT availability signal — something the mint's own NUT-06 info can
 * never provide, because a mint that is broken still happily advertises itself.
 *
 * Everything here is best-effort and NON-FATAL: the auditor is a third party
 * that may be down, may not know a given mint, or may change its payload. Every
 * entry point resolves to `undefined` instead of throwing so the caller can just
 * skip the section. Nothing in the wallet depends on this data.
 *
 * PRIVACY: calling this sends the mint url to a third-party server. It is only
 * ever called from the mint detail screen, on explicit user navigation — never
 * in the background and never for every known mint.
 */
import { isValid, parseISO } from 'date-fns'
import { log } from './logService'

/** REST API host. The matching human-facing site is AUDIT_SITE_URL. */
const AUDIT_API_URL = 'https://api.audit.8333.space'
const AUDIT_SITE_URL = 'https://audit.8333.space'

/** How many recent swap events to score. The API caps `limit` at 1000. */
const SWAP_SAMPLE_SIZE = 100

/** Short by design: this decorates a screen that must render without it. */
const REQUEST_TIMEOUT = 8000

/** Auditor verdict for a mint or a single swap event. */
export type MintAuditState = 'OK' | 'WARN' | 'ERROR' | 'UNKNOWN'

/** The auditor's `MintRead` record, narrowed to the fields we render. */
type MintAuditRecord = {
    id: number
    url: string
    name?: string
    state?: string
    updated_at?: string
}

/** The auditor's `SwapEventRead` record, narrowed to the fields we score. */
type SwapEvent = {
    state?: string
    /** milliseconds the swap took end to end */
    time_taken?: number
    created_at?: string
}

/**
 * The thresholds cashu.me's auditor panel judges a mint by, kept at its values
 * so the same mint does not read as healthy in one wallet and suspect in the
 * other. See cashu.me's MintAuditWarningBox.
 */
export const AUDIT_THRESHOLDS = {
    /** window the "recent" figures are computed over */
    recentDays: 7,
    /** below this recent success rate a mint is called unreliable */
    successRatePercent: 85,
    /** no successful swap for this long reads as unreachable */
    inactiveDays: 2,
    /** slower than this on average is called out */
    slowMs: 5000,
    /** fewer recent successes than this means the auditor has too little data */
    requiredSuccessfulSwaps: 7,
} as const

export type MintSwapStats = {
    /** 0–100, share of sampled swaps that completed */
    successRate: number
    okCount: number
    totalCount: number
    /** mean duration of the SUCCESSFUL swaps, in ms; absent if none were timed */
    averageMs?: number
}

/**
 * One audited swap, reduced to what a timeline needs.
 *
 * Kept as parsed values rather than raw payload so the UI never touches the
 * auditor's naive-UTC strings or its `state` vocabulary.
 */
export type MintSwapEvent = {
    at: Date
    ok: boolean
}

/**
 * A judgement about the mint, as a code the UI translates.
 *
 * Deliberately NOT a rendered string: the service stays UI- and locale-free,
 * and the screen owns the wording. `params` carries the interpolations the
 * matching message needs.
 */
export type MintAuditWarningCode =
    | 'lastSwapFailed'
    | 'lastSwapFailedReliable'
    | 'lastSwapFailedUnreliable'
    | 'unknownQuality'
    | 'notEnoughData'
    | 'lowSuccessRate'
    | 'inactive'
    | 'noSuccessfulSwaps'
    | 'slow'

export type MintAuditWarning = {
    code: MintAuditWarningCode
    params?: Record<string, string | number>
}

export type MintAuditSummary = {
    state: MintAuditState
    /**
     * Where to read more. The auditor's site is a single-page mint table with no
     * per-mint route, so this is its root — the same link cashu.me uses.
     */
    auditUrl: string
    /** when the auditor last probed the mint */
    updatedAt?: Date
    /** absent when the swap history could not be loaded or is empty */
    swap?: MintSwapStats
    /** empty when the auditor found nothing worth flagging */
    warnings: MintAuditWarning[]
    /** the sampled swaps that carried a usable timestamp, OLDEST first */
    history: MintSwapEvent[]
}

/**
 * Parse an auditor timestamp, which arrives as a NAIVE UTC datetime
 * (`2026-08-10T19:01:04`, no designator).
 *
 * The zone has to be supplied before parsing: ISO 8601 — and therefore
 * `parseISO` — reads a bare datetime as LOCAL time, which would shift "last
 * checked" by the device's utc offset. Far enough east and the auditor appears
 * to have checked in the future.
 */
const parseUtcDate = (value?: string): Date | undefined => {
    if (!value) return undefined
    const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value)
    const parsed = parseISO(hasZone ? value : `${value}Z`)
    return isValid(parsed) ? parsed : undefined
}

const isAuditState = (value: unknown): value is MintAuditState =>
    value === 'OK' || value === 'WARN' || value === 'ERROR' || value === 'UNKNOWN'

/**
 * GET `path` and parse it as JSON, or resolve undefined.
 *
 * Aborts on timeout through the signal — a dangling fetch would otherwise keep
 * running after the screen is gone. A 404 (auditor does not track this mint) is
 * an expected outcome, not an error, so it is logged at trace like the rest.
 */
const fetchJson = async <T>(path: string): Promise<T | undefined> => {
    const url = `${AUDIT_API_URL}${path}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {Accept: 'application/json'},
            // React Native's own AbortSignal declaration diverges from lib.dom's
            // (`onabort` is non-nullable there), so the two never structurally
            // match. Runtime behaviour is fine — RN's fetch honours the signal.
            signal: controller.signal as any,
        })

        if (!response.ok) {
            log.trace('[mintAuditService.fetchJson]', 'Auditor returned a non-OK status', {
                status: response.status,
                url,
            })
            return undefined
        }

        return (await response.json()) as T
    } catch (e: any) {
        log.trace('[mintAuditService.fetchJson]', 'Auditor request failed', {
            message: e?.message,
            url,
        })
        return undefined
    } finally {
        clearTimeout(timer)
    }
}

/** Mean of the successful swaps only — a failed swap has no meaningful duration. */
const averageDurationMs = (succeeded: SwapEvent[]): number | undefined => {
    const timed = succeeded.filter(e => typeof e.time_taken === 'number' && e.time_taken > 0)
    if (timed.length === 0) return undefined
    return timed.reduce((sum, e) => sum + (e.time_taken as number), 0) / timed.length
}

const summarizeSwaps = (events: SwapEvent[]): MintSwapStats | undefined => {
    if (events.length === 0) return undefined

    const succeeded = events.filter(e => e?.state === 'OK')

    return {
        successRate: Math.round((succeeded.length / events.length) * 100),
        okCount: succeeded.length,
        totalCount: events.length,
        averageMs: averageDurationMs(succeeded),
    }
}

const daysBetween = (from: Date, to: Date) =>
    (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)

/**
 * Swaps that carried a usable timestamp, OLDEST first.
 *
 * Sorted here rather than trusting the API's newest-first ordering, which is not
 * contractual — and the timeline in the UI reads wrong if it is ever violated.
 * Events with an unparseable `created_at` are dropped: they can be neither
 * placed on the timeline nor aged against the recent window.
 */
const toHistory = (events: SwapEvent[]): Array<MintSwapEvent & {event: SwapEvent}> =>
    events
        .map(event => ({event, at: parseUtcDate(event.created_at), ok: event.state === 'OK'}))
        .filter((e): e is MintSwapEvent & {event: SwapEvent} => !!e.at)
        .sort((a, b) => a.at.getTime() - b.at.getTime())

/**
 * The auditor's judgements about a mint, mirroring cashu.me's warning panel so
 * the two wallets agree about the same mint.
 *
 * `state` is the verdict on the LAST swap alone, which is why a failure is
 * always qualified by the recent window: one failed swap against a mint with a
 * good week usually says more about the swap's counterparty than about this
 * mint. Reported as codes; see MintAuditWarningCode.
 */
const collectWarnings = (
    state: MintAuditState,
    events: SwapEvent[],
    dated: Array<MintSwapEvent & {event: SwapEvent}>,
): MintAuditWarning[] => {
    const {recentDays, successRatePercent, inactiveDays, slowMs, requiredSuccessfulSwaps} =
        AUDIT_THRESHOLDS
    const warnings: MintAuditWarning[] = []
    const now = new Date()

    const recent = dated.filter(({at}) => daysBetween(at, now) <= recentDays)
    const recentOk = recent.filter(({ok}) => ok)
    const recentRate = recent.length > 0 ? (recentOk.length / recent.length) * 100 : 0

    if (state === 'WARN' || state === 'ERROR') {
        const params = {ok: recentOk.length, total: recent.length, days: recentDays}
        warnings.push(
            recent.length === 0 ? {code: 'lastSwapFailed'}
            : recentRate >= successRatePercent ? {code: 'lastSwapFailedReliable', params}
            : {code: 'lastSwapFailedUnreliable', params},
        )
    } else if (state === 'UNKNOWN') {
        warnings.push({code: 'unknownQuality'})
    } else if (state === 'OK') {
        if (recentOk.length < requiredSuccessfulSwaps) {
            warnings.push({code: 'notEnoughData', params: {count: recentOk.length, days: recentDays}})
        }
        if (recent.length > 0 && recentRate < successRatePercent) {
            warnings.push({
                code: 'lowSuccessRate',
                params: {percent: Math.round(recentRate), days: recentDays, threshold: successRatePercent},
            })
        }
    }

    // Liveness and speed are judged over the WHOLE sample, not the recent
    // window — a mint that went quiet a month ago has no recent swaps to fail.
    const succeeded = dated.filter(({ok}) => ok)

    if (succeeded.length === 0) {
        if (events.length > 0) warnings.push({code: 'noSuccessfulSwaps'})
        return warnings
    }

    // `dated` is sorted oldest first, so the last success is the final entry.
    const idleDays = Math.floor(daysBetween(succeeded[succeeded.length - 1].at, now))

    if (idleDays > inactiveDays) {
        warnings.push({code: 'inactive', params: {count: idleDays}})
    }

    const averageMs = averageDurationMs(succeeded.map(({event}) => event))

    if (typeof averageMs !== 'undefined' && averageMs > slowMs) {
        warnings.push({code: 'slow', params: {seconds: (averageMs / 1000).toFixed(1)}})
    }

    return warnings
}

/**
 * Availability summary for `mintUrl`, or undefined when the auditor does not
 * know this mint / is unreachable / answered something unusable.
 *
 * The swap history is a second request and is treated as optional on its own:
 * losing it degrades the section to the mint's state alone rather than dropping
 * it entirely.
 */
export const getMintAuditSummary = async (
    mintUrl: string,
): Promise<MintAuditSummary | undefined> => {
    if (!mintUrl) return undefined

    const record = await fetchJson<MintAuditRecord>(
        `/mints/url?url=${encodeURIComponent(mintUrl)}`,
    )

    // The auditor answers 200 with a body we cannot key off of if it ever
    // changes shape, so require the id before trusting anything else.
    if (!record || typeof record.id !== 'number') return undefined

    const events = await fetchJson<SwapEvent[]>(
        `/swaps/mint/${record.id}?skip=0&limit=${SWAP_SAMPLE_SIZE}`,
    )

    const state = isAuditState(record.state) ? record.state : 'UNKNOWN'
    const swapEvents = Array.isArray(events) ? events.filter(Boolean) : []
    const dated = toHistory(swapEvents)

    const summary: MintAuditSummary = {
        state,
        auditUrl: AUDIT_SITE_URL,
        updatedAt: parseUtcDate(record.updated_at),
        swap: summarizeSwaps(swapEvents),
        // Requires the swap history: without it every liveness heuristic would
        // fire on missing data rather than on a real problem.
        warnings: Array.isArray(events) ? collectWarnings(state, swapEvents, dated) : [],
        history: dated.map(({at, ok}) => ({at, ok})),
    }

    log.trace('[mintAuditService.getMintAuditSummary]', 'Loaded audit summary', {
        mintUrl,
        state: summary.state,
        warnings: summary.warnings.map(w => w.code),
    })

    return summary
}
