/**
 * The single boundary between `react-native-webrtc` tracks and the DOM-typed
 * `MediaStreamTrack` that `mediasoup-client` is written against.
 *
 * `mediasoup-client` compiles against `lib.dom`, so `transport.produce({ track })`
 * and `consumer.track` are typed as the DOM `MediaStreamTrack`. On React Native the
 * concrete objects come from `react-native-webrtc`, whose `MediaStreamTrack` is a
 * structurally-compatible-but-nominally-different class. Passing one where the other
 * is expected is the source of the three typecheck errors the PoC carried at
 * `sendTransport.produce({ track })` and when reading `consumer.track`.
 *
 * At runtime the two are interchangeable — `react-native-webrtc` installs its track
 * class as the global `MediaStreamTrack` via `registerGlobals()`, which is exactly
 * what mediasoup-client reaches for. So the mismatch is purely nominal, and the
 * correct fix is a localized cast at this one seam rather than `any` scattered
 * through the hook. Nothing outside this module performs the cast.
 */

import type { MediaStream, MediaStreamTrack as NativeMediaStreamTrack } from 'react-native-webrtc';

/**
 * A DOM `MediaStreamTrack` as far as the type system is concerned.
 *
 * This is the type `mediasoup-client` consumes and produces. We re-export it under
 * our own name so call sites read intent ("a track mediasoup will accept") rather
 * than naming the DOM lib directly.
 */
export type MediasoupTrack = MediaStreamTrack;

/**
 * Adapt a `react-native-webrtc` track to the DOM-typed track mediasoup-client
 * expects when producing.
 *
 * The cast is sound: `registerGlobals()` (called once at hook module load) makes the
 * native track class the runtime `MediaStreamTrack`, so mediasoup-client operates on
 * the same object kind it would in a browser. The two structural `unknown` hops keep
 * the cast explicit and greppable instead of an implicit `any`.
 */
export function toMediasoupTrack(track: NativeMediaStreamTrack): MediasoupTrack {
  return track as unknown as MediasoupTrack;
}

/**
 * Adapt a DOM-typed track handed back by mediasoup-client (e.g. `consumer.track`)
 * to the `react-native-webrtc` track type, so it can be added to a native
 * `MediaStream` for `RTCView`.
 *
 * Same soundness argument as {@link toMediasoupTrack}, in the opposite direction.
 */
export function toNativeTrack(track: MediasoupTrack): NativeMediaStreamTrack {
  return track as unknown as NativeMediaStreamTrack;
}

/**
 * The structural surface of a `react-native-webrtc` `MediaStream` that this feature
 * reads. Re-exported so the hook and components depend on the adapter module rather
 * than importing the native type directly in several places.
 */
export type NativeStream = MediaStream;
export type { NativeMediaStreamTrack };
