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
 * Below this share of turns tapped, the design has stopped working.
 *
 * Not a UI threshold — nothing warns anyone. It is the number that decides
 * whether the acoustic layer is worth enabling at all: under it, confirmed turns
 * are too rare to build a voice profile from, and switching suggestions on would
 * make things worse rather than better, because a bad suggestion still costs a
 * correction. Good thresholds cannot rescue a starved profile.
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
  /** Turns left carrying no name. */
  fallback: number;
  /** `confirmed / totalTurns`, or 0 when nothing was said. Compare to {@link TAP_RATE_FLOOR}. */
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
  const confirmed = sessionIds.filter(
    (sessionId) => attributionFor(state.attributions, sessionId).origin === 'confirmed',
  ).length;

  return {
    totalTurns: sessionIds.length,
    confirmed,
    fallback: sessionIds.length - confirmed,
    tapRate: sessionIds.length === 0 ? 0 : confirmed / sessionIds.length,
    suggestions: outcomesFor(state.attributions, sessionIds),
  };
}
