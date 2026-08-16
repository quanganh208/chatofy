/**
 * Whether the user's microphone is held shut right now, and why.
 *
 * Two rules live in one expression, and separating them here is the whole point
 * of this file — they answer to different owners and fail in opposite
 * directions.
 *
 * The PRIVACY rule: while the outbound translation is being sent into the
 * meeting rather than merely monitored, a muted meeting client means the user
 * expects nothing to leave. Capturing anyway would translate speech they believe
 * is private and hand it to the page. This rule holds in every mode, under every
 * backend, and nothing below is allowed to weaken it.
 *
 * The ECHO rule: on a loudspeaker the microphone hears the translation playing,
 * the speech gate downstream opens a turn on it, and the extension translates
 * its own output back into the meeting. Gating the microphone at the source is
 * what closes that loop (`outbound-mic.ts`).
 *
 * The echo rule rests on a premise, and the premise is the reason this function
 * takes a `streaming` argument: **it assumes playback has gaps to reopen in.**
 * A backend that trails the speaker by seconds and talks through their pauses
 * has none, so the gate there does not quieten the microphone between sentences
 * — it holds it at zero from the first translated sample to the end of the
 * meeting. Measured as: the user gets one sentence, and nothing after it is ever
 * heard.
 *
 * That was first true of the live backend, which is why live has always been
 * exempt. It became true of the cascade the moment it started speaking settled
 * clauses mid-turn, and the cascade is worse in one respect live is not: its own
 * outbound clauses play while the very turn that produced them is still being
 * captured, so the gate silences the speech it is in the middle of recording,
 * the endpointer sees silence and closes the turn early, and the clauses of that
 * truncated turn gate it again.
 *
 * So the exemption follows the premise rather than the backend: a mode whose
 * playback has no gaps trades the echo gate for headphones and for whatever
 * cancellation the browser will give us (`echoCancellation: "all"` in
 * `outbound-mic.ts`), and says so where the mode is chosen.
 */

export interface MicrophoneGateInput {
  /**
   * Translated audio is sounding right now through these loudspeakers.
   *
   * The narrow "queued or playing" fact from `SoundingSink`, not
   * `OrderedPlayback.isBusy` — see the note in `sounding-sink.ts` for why the
   * wider one would hold the gate shut for whole conversations.
   */
  audible: boolean;
  /** The meeting client muted the microphone we composed for it. */
  muted: boolean;
  /** Playback runs without gaps: the live backend, or a streaming cascade. */
  continuousPlayback: boolean;
}

/**
 * The single answer both rules resolve to.
 *
 * Returned rather than applied so the decision can be tested without a meeting,
 * an `AudioContext`, or a microphone — including the case that matters most and
 * is hardest to reach any other way: that turning the streaming feature off
 * restores the old gate exactly.
 */
export function shouldSuppressMicrophone({
  audible,
  muted,
  continuousPlayback,
}: MicrophoneGateInput): boolean {
  if (muted) return true;
  return audible && !continuousPlayback;
}
