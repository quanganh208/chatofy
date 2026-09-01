import { attributionFor, type AttributionsBySession } from './speaker-roster.js';
import type { TurnKeyedTranscript } from './turn-keyed-transcript.js';

/**
 * What actually happened to the labels in one conversation.
 *
 * This exists to answer one question that cannot be answered later: **are people
 * really tapping?** Attribution costs a tap per turn on a product whose whole
 * claim is that there is nothing to press, so the tap is working against the
 * grain — and the consequences compound. Taps are the only source of confirmed
 * turns, so a low rate starves the voice model that would otherwise reduce the
 * tapping, its suggestions never improve, and the reason to correct them falls
 * further. By the time it is obvious, the model has been trained on almost
 * nothing.
 *
 * **Derived, never accumulated.** No counter increments anywhere; these are read
 * off the same state the screen renders. A counter kept alongside can disagree
 * with what is on screen, and then neither one can be trusted.
 *
 * **Nothing leaves the browser.** There is no analytics in this repo and adding
 * one to observe a feature about who spoke would ship exactly the data this
 * design keeps in memory. The cost is real and worth stating: nothing aggregates
 * these across sessions, so whoever runs a session reads the number and writes it
 * down. The alternative was worse.
 */

/**
 * Below this share of turns tapped, the enrolment design has stopped working.
 *
 * **Its decision role is void, and saying so is the point of this paragraph.**
 * It used to decide whether the acoustic layer was worth enabling at all, on the
 * reasoning that under it confirmed turns are too rare to build a voice profile
 * from. That reasoning belonged to the *enrolment* path, where a profile can
 * only come from a tap. The layer that now runs — `auto-attribution.ts` — builds
 * its own voices from its own assignments and needs no taps at all, so a tap
 * rate of zero is its **designed** operating point rather than a starvation
 * signal.
 *
 * Left exported, and left at the same value, because the rate itself is still
 * worth reading: a zero-manual feature that people keep correcting is failing in
 * a way no accuracy number would show. What it must no longer do is gate
 * switching the layer on. Read it as a cost, not as a threshold.
 *
 * **It counts naming taps, not every intervention**, and the difference is
 * deliberate rather than an oversight. {@link AttributionStats.tapRate} is
 * `confirmed / totalTurns` — the share of turns somebody put a name on. A
 * rejection ("nobody here said this") is an intervention too, and it is counted,
 * but in {@link SuggestionOutcomes.corrected} instead. Folding it in here would
 * change what this number measures out from under the value on the left, which
 * was calibrated against the share of turns TAPPED.
 */
export const TAP_RATE_FLOOR = 0.5;

/**
 * How suggestions ended up.
 *
 * Three buckets rather than the obvious two, and the third is the point.
 * "Accepted versus corrected" is self-certifying: if *accepted* just means *not
 * corrected*, then a session where nobody looked at the screen scores perfectly
 * — which is the exact failure the whole suggestion design is afraid of. So a
 * suggestion nobody reviewed is counted as neither. It is not a success and not
 * a failure; it is an absence of evidence, and it has to be reported as one.
 */
export interface SuggestionOutcomes {
  /** Somebody tapped, and agreed. The only evidence a suggestion was right. */
  confirmedMatching: number;
  /** Somebody tapped, and chose differently — including choosing nobody. */
  corrected: number;
  /** Still only a suggestion when the conversation ended. Nobody looked. */
  unreviewed: number;
}

export interface AttributionStats {
  totalTurns: number;
  /** Turns a person attributed to somebody. */
  confirmed: number;
  /** Turns the acoustic layer named on its own and nobody has overruled. */
  automatic: number;
  /**
   * Turns the acoustic layer heard and has not placed **yet**.
   *
   * Non-zero only during a live conversation. `transcript.settled` empties this
   * by construction, so a session that ended with any of these is a bug in the
   * settle path rather than a property of the audio — which is exactly why it is
   * counted separately from {@link AttributionStats.fallback} instead of being
   * folded into it.
   */
  pending: number;
  /**
   * Turns carrying no name and expecting none.
   *
   * **Corrected 2026-09-01.** This was `totalTurns - confirmed`, which was
   * accurate only while nothing could produce a `suggested` turn. With the
   * acoustic layer running, most turns carry a machine-given name, and that
   * subtraction would have reported nearly every one of them as unattributed —
   * a number that looks like the feature is doing nothing while it is doing
   * everything.
   */
  fallback: number;
  /**
   * `confirmed / totalTurns`, or 0 when nothing was said.
   *
   * Read as the **cost** of the labelling, not as a gate — see
   * {@link TAP_RATE_FLOOR}, whose gating role is void. Zero is the designed
   * operating point of a zero-manual feature.
   */
  tapRate: number;
  suggestions: SuggestionOutcomes;
}

function outcomesFor(
  attributions: AttributionsBySession,
  sessionIds: readonly string[],
): SuggestionOutcomes {
  const outcomes: SuggestionOutcomes = { confirmedMatching: 0, corrected: 0, unreviewed: 0 };

  for (const sessionId of sessionIds) {
    const attribution = attributionFor(attributions, sessionId);
    const { suggestedSpeakerId } = attribution;
    if (!suggestedSpeakerId) continue;

    if (attribution.origin === 'suggested') {
      outcomes.unreviewed += 1;
    } else if (attribution.speakerId === suggestedSpeakerId) {
      outcomes.confirmedMatching += 1;
    } else {
      // Includes a turn put back to unattributed: choosing nobody over a
      // proposed name is a correction, and the strongest one there is.
      outcomes.corrected += 1;
    }
  }

  return outcomes;
}

/** Read the conversation's labelling back off the state that rendered it. */
export function attributionStats(state: TurnKeyedTranscript): AttributionStats {
  // Finished turns only. A live turn carries no attribution and counting it
  // would report a tap rate that falls every time somebody starts speaking.
  const sessionIds = state.turns.map((turn) => turn.sessionId);

  // Counted in one pass over the four origins rather than by subtracting, so
  // adding a fifth some day breaks a total rather than silently landing in
  // whichever bucket the subtraction happened to feed.
  const counts = { confirmed: 0, automatic: 0, pending: 0, fallback: 0 };
  for (const sessionId of sessionIds) {
    switch (attributionFor(state.attributions, sessionId).origin) {
      case 'confirmed':
        counts.confirmed += 1;
        break;
      case 'suggested':
        counts.automatic += 1;
        break;
      case 'pending':
        counts.pending += 1;
        break;
      case 'fallback':
        counts.fallback += 1;
        break;
    }
  }

  return {
    totalTurns: sessionIds.length,
    ...counts,
    tapRate: sessionIds.length === 0 ? 0 : counts.confirmed / sessionIds.length,
    suggestions: outcomesFor(state.attributions, sessionIds),
  };
}
