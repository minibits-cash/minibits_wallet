/**
 * Read-only client for MintRadar (https://mintradar.org), a public Cashu mint
 * monitor. It probes every mint it knows about every 5 minutes and merges
 * cashu.info's swap audit, so it gives an INDEPENDENT availability signal —
 * something the mint's own NUT-06 info can never provide, because a mint that is
 * broken still happily advertises itself.
 *
 * Uses only the stable "API for wallets (v1)":
 * https://github.com/hroomnik007/MintRadar/blob/main/MintRadar/docs/API.md
 *
 * Everything here is best-effort and NON-FATAL: MintRadar is a third party that
 * may be down, may not know a given mint, or may change its payload. Every entry
 * point resolves to `undefined` instead of throwing so the caller can just skip
 * the section. Nothing in the wallet depends on this data.
 *
 * PRIVACY: calling this sends the mint url to a third-party server. It is only
 * ever called from the mint detail screen, on explicit user navigation — never
 * in the background and never for every known mint.
 */
import { isValid, parseISO } from 'date-fns'
import { log } from './logService'

const AUDIT_API_URL = 'https://mintradar.org/api/v1/wallets/mints'
const AUDIT_SITE_URL = 'https://mintradar.org/mint'

/** Short by design: this decorates a screen that must render without it. */
const REQUEST_TIMEOUT = 8000

export type MintAuditStatus = 'online' | 'offline' | 'degraded' | 'archived'

/** MintRadar's wallet mint object, narrowed to the fields we use. */
type MintRadarMint = {
    url: string
    status?: string
    score?: number | null
    scoreStale?: boolean
    uptime24hPct?: number | null
    uptime7dPct?: number | null
    uptime30dPct?: number | null
    lastCheckedAt?: string | null
    downSince?: string | null
    mintDisabled?: boolean | null
    meltDisabled?: boolean | null
    software?: string | null
    outdated?: boolean | null
    isTest?: boolean
    audit?: {swaps7d?: number, attributedFailures?: number} | null
    latency24h?: {p50Ms?: number} | null
}

/** Thresholds the warnings are judged by. */
export const AUDIT_THRESHOLDS = {
    /** MintRadar's own recommendation bar (methodology 7) */
    uptimePercent: 95,
    /** below this audited swap success rate a mint is called unreliable */
    successRatePercent: 85,
    /** MintRadar scores fewer audited swaps than this as neutral */
    minSwaps: 10,
} as const

/**
 * A judgement about the mint, as a code the UI translates.
 *
 * Deliberately NOT a rendered string: the service stays UI- and locale-free,
 * and the screen owns the wording. `params` carries the interpolations the
 * matching message needs.
 */
export type MintAuditWarningCode =
    | 'offline'
    | 'archived'
    | 'lowUptime'
    | 'lowSuccessRate'
    | 'mintDisabled'
    | 'meltDisabled'
    | 'outdated'
    | 'testMint'

export type MintAuditWarning = {
    code: MintAuditWarningCode
    params?: Record<string, string | number>
}

export type MintAuditSummary = {
    status: MintAuditStatus
    /** MintRadar's 0–100 Reliability Score; the last measured one when not online */
    score?: number
    scoreStale: boolean
    uptime24h?: number
    uptime7d?: number
    uptime30d?: number
    /** median probe response time over 24h */
    latencyMs?: number
    /** cashu.info swaps over the last 7 days; absent when MintRadar stores none */
    swaps?: {okCount: number, totalCount: number}
    /** MintRadar's page for this mint */
    auditUrl: string
    /** when MintRadar last probed the mint */
    updatedAt?: Date
    /** empty when nothing is worth flagging */
    warnings: MintAuditWarning[]
}

const parseDate = (value?: string | null): Date | undefined => {
    if (!value) return undefined
    const parsed = parseISO(value)
    return isValid(parsed) ? parsed : undefined
}

const num = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined

const isStatus = (value: unknown): value is MintAuditStatus =>
    value === 'online' || value === 'offline' || value === 'degraded' || value === 'archived'

/**
 * GET `url` and parse it as JSON, or resolve undefined.
 *
 * Aborts on timeout through the signal — a dangling fetch would otherwise keep
 * running after the screen is gone. A 404 (MintRadar does not track this mint)
 * is an expected outcome, not an error, so it is logged at trace like the rest.
 */
const fetchJson = async <T>(url: string): Promise<T | undefined> => {
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

const collectWarnings = (
    mint: MintRadarMint,
    status: MintAuditStatus,
    swaps?: MintAuditSummary['swaps'],
): MintAuditWarning[] => {
    const {uptimePercent, successRatePercent, minSwaps} = AUDIT_THRESHOLDS
    const warnings: MintAuditWarning[] = []

    if (status === 'archived') {
        warnings.push({code: 'archived'})
    } else if (status !== 'online') {
        warnings.push({code: 'offline'})
    }

    const uptime30d = num(mint.uptime30dPct)
    if (status !== 'archived' && typeof uptime30d !== 'undefined' && uptime30d < uptimePercent) {
        warnings.push({code: 'lowUptime', params: {percent: uptime30d, threshold: uptimePercent}})
    }

    // Too few swaps to judge by: MintRadar itself scores them as neutral.
    if (swaps && swaps.totalCount >= minSwaps) {
        const rate = Math.round((swaps.okCount / swaps.totalCount) * 100)
        if (rate < successRatePercent) {
            warnings.push({code: 'lowSuccessRate', params: {percent: rate, threshold: successRatePercent}})
        }
    }

    if (mint.mintDisabled === true) warnings.push({code: 'mintDisabled'})
    if (mint.meltDisabled === true) warnings.push({code: 'meltDisabled'})
    if (mint.outdated === true && mint.software) {
        warnings.push({code: 'outdated', params: {software: mint.software}})
    }
    if (mint.isTest === true) warnings.push({code: 'testMint'})

    return warnings
}

/**
 * Availability summary for `mintUrl`, or undefined when MintRadar does not know
 * this mint / is unreachable / answered something unusable.
 */
export const getMintAuditSummary = async (
    mintUrl: string,
): Promise<MintAuditSummary | undefined> => {
    if (!mintUrl) return undefined

    const response = await fetchJson<{mint?: MintRadarMint}>(
        `${AUDIT_API_URL}/${encodeURIComponent(mintUrl)}`,
    )
    const mint = response?.mint

    // Require the url before trusting anything else in case the shape changes.
    if (!mint || typeof mint.url !== 'string') return undefined

    const status = isStatus(mint.status) ? mint.status : 'offline'
    const total = num(mint.audit?.swaps7d)
    const failed = num(mint.audit?.attributedFailures) ?? 0
    const swaps = total ? {okCount: Math.max(total - failed, 0), totalCount: total} : undefined

    const summary: MintAuditSummary = {
        status,
        score: num(mint.score),
        scoreStale: mint.scoreStale === true,
        uptime24h: num(mint.uptime24hPct),
        uptime7d: num(mint.uptime7dPct),
        uptime30d: num(mint.uptime30dPct),
        latencyMs: num(mint.latency24h?.p50Ms),
        swaps,
        auditUrl: `${AUDIT_SITE_URL}/${encodeURIComponent(mint.url)}`,
        updatedAt: parseDate(mint.lastCheckedAt),
        warnings: collectWarnings(mint, status, swaps),
    }

    log.trace('[mintAuditService.getMintAuditSummary]', 'Loaded audit summary', {
        mintUrl,
        status: summary.status,
        warnings: summary.warnings.map(w => w.code),
    })

    return summary
}
