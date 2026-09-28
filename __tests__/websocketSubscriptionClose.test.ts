/**
 * The cashu-ts contract that the websocket->poller fallbacks rest on.
 *
 * `_monitorSentProofs` (sendOperationApi), `_monitorAsyncMeltQuote`
 * (transferOperationApi) and the mint-quote watcher (topupOperationApi) all
 * subscribe over NUT-17 and fall back to a poller when the websocket cannot
 * carry the update. The subscribe call failing is the easy half, and a plain
 * try/catch covers it. The other half is an ESTABLISHED subscription dying
 * later: mints and reverse proxies idle out long-lived sockets, and a sent
 * token or a pending melt quote routinely outlives one.
 *
 * Up to cashu-ts 4.10 that case was UNREPORTABLE. `createSubscription` passed
 * the error callback only to `addRpcListener`, which covers the subscribe RPC
 * itself; `addSubListener(subId, callback)` took no error callback at all, so
 * once the subscription was live nothing held a way to signal it. A socket
 * close ran `stopMessageHandling()`, which drained the queue and told nobody.
 * The subscription simply went quiet and the transaction hung.
 *
 * 4.11 (#1252) stores the error callback per subscription and fans it out from
 * `stopMessageHandling(err)`. That is what lets the fallback start, and it is
 * the entire reason the pollers in those three functions are hoisted out of
 * the setup `catch` into a shared `startPoller()` reachable from both paths.
 *
 * If a future cashu-ts stops invoking the error callback on close, those three
 * fallbacks go silent again with no other test failing. This pins it at the
 * WSConnection level — the layer the `wallet.on.*` helpers are built on — so
 * the assertion is about the library contract rather than our wiring.
 *
 * Deterministic and offline: the WebSocket implementation is injected.
 *
 * @jest-environment node
 */
import {WSConnection, injectWebSocketImpl} from '@cashu/cashu-ts'

type CloseInit = {code: number; reason: string; wasClean: boolean}

/** Minimal WebSocket double: opens next tick, acks `subscribe`, closes on demand. */
class FakeWebSocket {
    static instances: FakeWebSocket[] = []
    static OPEN = 1

    onopen?: () => void
    onclose?: (e: CloseInit) => void
    onmessage?: (e: {data: string}) => void
    onerror?: (e: unknown) => void
    readyState = 0
    sent: string[] = []

    constructor(public url: string) {
        FakeWebSocket.instances.push(this)
        setTimeout(() => {
            this.readyState = FakeWebSocket.OPEN
            this.onopen?.()
        }, 0)
    }

    send(raw: string) {
        this.sent.push(raw)
        const msg = JSON.parse(raw)
        if (msg.method === 'subscribe') {
            // The sub listener is only registered once this ack lands.
            setTimeout(
                () =>
                    this.onmessage?.({
                        data: JSON.stringify({
                            jsonrpc: '2.0',
                            result: {status: 'OK', subId: msg.params.subId},
                            id: msg.id,
                        }),
                    }),
                0,
            )
        }
    }

    close() {
        this.readyState = 3
    }

    /** What a mint or proxy does to an idle connection. */
    dropRemote(init: Partial<CloseInit> = {}) {
        this.readyState = 3
        this.onclose?.({code: 1006, reason: 'idle timeout', wasClean: false, ...init})
    }
}

const tick = () => new Promise(resolve => setTimeout(resolve, 5))

async function establishedSubscription() {
    const ws = new WSConnection('wss://mint.test/v1/ws')
    await ws.connect()

    const updates: unknown[] = []
    const errors: Error[] = []
    ws.createSubscription(
        {kind: 'proof_state', filters: ['deadbeef']} as never,
        payload => updates.push(payload),
        error => errors.push(error),
    )
    await tick()

    const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
    return {ws, socket, updates, errors}
}

describe('an established NUT-17 subscription reports a socket close', () => {
    beforeEach(() => {
        FakeWebSocket.instances = []
        injectWebSocketImpl(FakeWebSocket as never)
    })

    it('PRECONDITION: the subscription is live before the socket drops', async () => {
        const {ws, errors} = await establishedSubscription()

        expect(ws.activeSubscriptions).toHaveLength(1)
        expect(errors).toHaveLength(0)
    })

    it('invokes the error callback when the mint drops the connection', async () => {
        const {socket, errors} = await establishedSubscription()

        socket.dropRemote()
        await tick()

        // This is the signal the three operation-api fallbacks start their
        // poller from. Before 4.11 it never arrived and they hung instead.
        expect(errors).toHaveLength(1)
        expect(errors[0]).toBeInstanceOf(Error)
        expect(errors[0].message).toMatch(/closed/i)
    })

    it('drops the subscription so a later close cannot fire it twice', async () => {
        const {ws, socket, errors} = await establishedSubscription()

        socket.dropRemote()
        await tick()
        socket.dropRemote()
        await tick()

        expect(errors).toHaveLength(1)
        expect(ws.activeSubscriptions).toHaveLength(0)
    })

    it('reports a CLEAN close too — idle teardown is not a success signal', async () => {
        const {socket, errors} = await establishedSubscription()

        socket.dropRemote({code: 1000, reason: '', wasClean: true})
        await tick()

        expect(errors).toHaveLength(1)
    })
})
