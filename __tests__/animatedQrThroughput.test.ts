/**
 * Animated QR (UR) throughput.
 *
 * Scanning a token used to take minutes because react-native-camera-kit defaults
 * scanThrottleDelay to 2000 ms — one accepted part every 2 s. ScanScreen now passes
 * scanThrottleDelay={0}, so the QRCode display interval is the only limit.
 *
 * This pins the part budget the timing estimate rests on: if the fountain encoder or
 * the fragment length regresses, the wall-clock time goes up with it.
 */
import { UR, UREncoder, URDecoder } from '@gandlaf21/bc-ur'

// Must mirror src/screens/Wallet/QRCode.tsx.
const ANIMATED_QR_FRAGMENT_LENGTH = 150
const ANIMATED_QR_INTERVAL = 250

const partsToDecode = (payload: string) => {
  const encoder = new UREncoder(UR.fromBuffer(Buffer.from(payload)), ANIMATED_QR_FRAGMENT_LENGTH, 0)
  const decoder = new URDecoder()
  let parts = 0

  while (!decoder.isComplete()) {
    decoder.receivePart(encoder.nextPart())
    parts++
    if (parts > 1000) throw new Error('decoder never completed')
  }

  expect(decoder.isSuccess()).toBe(true)
  return {parts, decoded: Buffer.from(decoder.resultUR().decodeCBOR()).toString('utf8')}
}

test('a ~3 kB token round-trips within a few seconds of display time', () => {
  const token = 'cashuB' + 'a'.repeat(3000)
  const {parts, decoded} = partsToDecode(token)

  expect(decoded).toBe(token)

  // 3000 bytes / 150 = 20 fragments; the fountain encoder sends those in order first,
  // so a lossless reader needs no more than a handful of extra parts.
  expect(parts).toBeLessThanOrEqual(25)
  // The number that actually matters to the user: seconds, not minutes.
  expect(parts * ANIMATED_QR_INTERVAL).toBeLessThan(8000)
})

test('every displayed part is distinct, so the scanner-side dedupe never stalls', () => {
  const encoder = new UREncoder(UR.fromBuffer(Buffer.from('x'.repeat(1500))), ANIMATED_QR_FRAGMENT_LENGTH, 0)
  const seen = Array.from({length: 30}, () => encoder.nextPart())

  // ScanScreen skips a read equal to the previous one. Consecutive repeats from the
  // encoder would make that dedupe drop real parts.
  seen.forEach((part, i) => expect(part).not.toBe(seen[i - 1]))
})
