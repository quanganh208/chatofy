/**
 * Who is in this conversation, and which of them said each turn.
 *
 * Split out of `turn-keyed-transcript.ts` because that file had reached the size
 * where a second concern stops being a few extra cases and starts being a second
 * subject. The reducer still owns the state; everything here is a pure function
 * over a slice of it, so the rules can be read and tested without the transcript
 * around them.
 *
 * **These are labels for one conversation, not identities.** Nothing here is
 * persisted, nothing is linked to an account, and a reset drops all of it — see
 * the reset case in the reducer. That is a constraint on the feature rather than
 * an implementation detail: the design this belongs to is allowed to attribute
 * turns precisely because it never remembers a voice.
 */

/**
 * Where a turn's speaker came from.
 *
 * Four values rather than a boolean, and every one past the first exists
 * because collapsing it into "not confirmed" loses something the screen has to
 * be able to say:
 *
 * - `confirmed` — a person said so. **Only this may ever seed a voice centroid.**
 * - `suggested` — proposed by the acoustic layer. It is declared here so the
 *   distinction lives in the type from the beginning; a suggestion that cannot
 *   be told from a confirmation is how a suggestion layer silently becomes an
 *   authority.
 * - `pending` — the acoustic layer heard this turn and could not place it. It
 *   holds no speaker yet and **will get one before the conversation ends**.
 * - `fallback` — nobody attributed this turn, and nothing proposed one.
 *
 * `fallback` is what a boolean cannot express. "Not confirmed" would collapse
 * "nobody said" into "the machine said", and the whole point is that an
 * unattributed turn must never render as a person.
 *
 * `pending` is what a third value could not express either, and the reason is
 * the same one at a different point. It says *the machine is still deciding*,
 * which is neither "nobody said" nor "the machine said" — and the difference is
 * a promise: a `fallback` turn may stay unattributed forever, a `pending` one
 * may not. A chip that never resolves to a person is the one outcome this
 * design treats as a failure, so the state that owes an answer has to be
 * nameable in order to be checkable.
 */
export type AttributionOrigin = 'confirmed' | 'suggested' | 'pending' | 'fallback';

/** One participant, for the length of one conversation. */
export interface SessionSpeaker {
  id: string;
  label: string;
}

/** Who said one turn, and on whose authority. */
export interface TurnAttribution {
  /** `null` exactly when `origin` is `fallback` or `pending`. */
  speakerId: string | null;
  origin: AttributionOrigin;
  /**
   * What the acoustic layer proposed for this turn, if it proposed anything.
   *
   * Kept after a person overrules it, and that is the whole point: a correction
   * that erased what was suggested would erase the only evidence the suggestion
   * was wrong. Whether suggestions are worth having is decided by counting the
   * ones people agreed with against the ones they changed, and neither number
   * can be recovered afterwards.
   *
   * Written by the acoustic layer on every turn it names, and preserved through
   * both a confirmation and a rejection.
   */
  suggestedSpeakerId?: string;
}

/**
 * Turns are addressed by the server's `sessionId`.
 *
 * Three identifiers in this codebase could all be called "the turn id" and they
 * are not interchangeable: the client's `turnId`, the server's `sessionId`, and
 * the segment's own `id`. The transcript already keys its live turns by
 * `sessionId`, because that is the one field every event about a turn carries.
 * Attribution uses the same key so a turn has one address throughout.
 */
export type AttributionsBySession = Record<string, TurnAttribution>;

/**
 * Participants one microphone can carry.
 *
 * Carried from the accepted contract. Beyond this it is not a conversation
 * around a shared device, and a roster that long is a sign something else has
 * gone wrong rather than a case to support.
 */
export const MAX_SPEAKERS = 8;

/** What a turn nobody has attributed reads as. */
export const UNATTRIBUTED: TurnAttribution = { speakerId: null, origin: 'fallback' };

/**
 * Add a participant, or return the roster untouched when it is full.
 *
 * `nextNumber` is threaded through rather than derived from the roster's length,
 * because removing an unattributed speaker would otherwise make the next id
 * collide with a live one — the roster would then hold two people the reducer
 * cannot tell apart, which is worse than the mistake it came from.
 */
export function addSpeaker(
  speakers: readonly SessionSpeaker[],
  nextNumber: number,
  label?: string,
): { speakers: SessionSpeaker[]; nextNumber: number } {
  if (speakers.length >= MAX_SPEAKERS) {
    return { speakers: [...speakers], nextNumber };
  }
  const trimmed = label?.trim();
  return {
    speakers: [
      ...speakers,
      { id: `speaker-${nextNumber}`, label: trimmed || `Speaker ${nextNumber}` },
    ],
    nextNumber: nextNumber + 1,
  };
}

/** Rename a participant. An empty or blank label is ignored, not stored. */
export function renameSpeaker(
  speakers: readonly SessionSpeaker[],
  speakerId: string,
  label: string,
): SessionSpeaker[] {
  const trimmed = label.trim();
  if (!trimmed) return [...speakers];
  return speakers.map((speaker) =>
    speaker.id === speakerId ? { ...speaker, label: trimmed } : speaker,
  );
}

/**
 * Whether a participant may be removed.
 *
 * **A speaker who has been attributed a turn cannot be removed**, and the
 * alternative is what makes this the right rule: re-pointing their turns at
 * `fallback` would leave the transcript claiming nobody said things somebody
 * said. A stale name in the roster is a smaller wrong than a transcript that has
 * quietly lost an author. Someone who added a person by mistake can rename them;
 * someone who added one they never used can remove them.
 */
export function canRemoveSpeaker(attributions: AttributionsBySession, speakerId: string): boolean {
  return !Object.values(attributions).some((attribution) => attribution.speakerId === speakerId);
}

/** Remove a participant, or return the roster untouched when {@link canRemoveSpeaker} refuses. */
export function removeSpeaker(
  speakers: readonly SessionSpeaker[],
  attributions: AttributionsBySession,
  speakerId: string,
): SessionSpeaker[] {
  if (!canRemoveSpeaker(attributions, speakerId)) return [...speakers];
  return speakers.filter((speaker) => speaker.id !== speakerId);
}

/**
 * Record that a person attributed a turn.
 *
 * Refuses a speaker who is not on the roster: an attribution pointing at nobody
 * renders as nothing, and would do it without any error to notice.
 *
 * Every attribution written here is `confirmed`, because a person is the only
 * thing that can reach it. The acoustic layer writes through
 * {@link autoAttributeTurn} instead, and the two paths are kept apart on
 * purpose: this one may overwrite anything, and that one may overwrite almost
 * nothing.
 */
export function attributeTurn(
  attributions: AttributionsBySession,
  speakers: readonly SessionSpeaker[],
  sessionId: string,
  speakerId: string,
): AttributionsBySession {
  if (!speakers.some((speaker) => speaker.id === speakerId)) return attributions;
  const suggested = attributions[sessionId]?.suggestedSpeakerId;
  return {
    ...attributions,
    // The suggestion survives the person overruling it. See `suggestedSpeakerId`.
    [sessionId]: {
      speakerId,
      origin: 'confirmed',
      ...(suggested ? { suggestedSpeakerId: suggested } : {}),
    },
  };
}

/**
 * Put a turn back to unattributed.
 *
 * The counterpart {@link attributeTurn} lacked, and without it a roster holding
 * one person plus one mistaken attribution has no direct way out: the speaker
 * cannot be removed either, because {@link canRemoveSpeaker} refuses.
 *
 * This is not a hole in that refusal. A person saying *nobody I have named said
 * this* is choosing something about a turn; what removal refuses is orphaning
 * turns as a silent side effect of deleting somebody. One is a decision, the
 * other is a consequence nobody asked for.
 *
 * **The row is always written, never dropped — corrected 2026-09-01.** It used
 * to be dropped unless it carried a suggestion, on the reasoning that
 * {@link attributionFor} already answers `fallback` for a turn it has never
 * heard of, and that two encodings of one state is how they drift apart.
 *
 * They stopped being one state when the acoustic layer began labelling turns on
 * its own. A missing row now means *nobody and nothing has decided, and settling
 * should give this turn an ordinal*. An explicit `fallback` row means *a person
 * looked at this and said nobody here said it*. Dropping the row collapsed the
 * second into the first, and the settle pass would then hand the turn a name the
 * person had just refused — the one thing that must never happen automatically.
 *
 * So an explicit `fallback` row is the record that a human acted, and
 * {@link isHumanTouched} reads it as exactly that. The rejected suggestion rides
 * along when there was one, because rejecting a suggestion is the strongest
 * evidence this design collects that suggestions are not working, and it is the
 * only place that evidence exists.
 */
export function unattributeTurn(
  attributions: AttributionsBySession,
  sessionId: string,
): AttributionsBySession {
  // Written even when there is no row yet, and that case is the reachable one.
  // The server emits a turn's vector only AFTER its final transcript, so the
  // chip is on screen and tappable for a whole round trip before any row
  // exists. Returning early there dropped the rejection silently: the vector
  // then arrived to find nothing recorded, and the clusterer labelled a turn
  // the person had just refused.
  const current = attributions[sessionId];
  const suggested = current?.suggestedSpeakerId;
  return {
    ...attributions,
    [sessionId]: {
      speakerId: null,
      origin: 'fallback',
      ...(suggested ? { suggestedSpeakerId: suggested } : {}),
    },
  };
}

/**
 * Whether a turn already shows somebody's name.
 *
 * The predicate the whole auto-attribution path is built around. A turn reading
 * `confirmed` or `suggested` has a name on screen; `pending` and `fallback` do
 * not. Everything the machine may do is decided by which side of this line a
 * turn sits on.
 */
export function isRendered(attribution: TurnAttribution): boolean {
  return attribution.origin === 'confirmed' || attribution.origin === 'suggested';
}

/**
 * Whether a person has already decided about this turn.
 *
 * **Not the same set as {@link isRendered}, and the difference is a whole class
 * of bug.** Rendering asks "is a name on screen"; this asks "did somebody
 * choose". They disagree on exactly one state, and it is the one that matters
 * most: a turn a person put back to *nobody said this*. That reads `fallback`
 * with the rejected suggestion still on it — see {@link unattributeTurn} — so it
 * is not rendered, and a check that only asked about rendering would let the
 * machine quietly re-apply the very label the person had just thrown away.
 *
 * Rejecting a suggestion is also the single strongest piece of evidence this
 * design collects about whether the acoustic layer is working. Overwriting it
 * does not merely annoy somebody; it deletes the measurement.
 */
export function isHumanTouched(attribution: TurnAttribution): boolean {
  // An explicit `fallback` ROW can only have come from `unattributeTurn`;
  // nothing else writes one. A turn nobody has decided has no row at all, and
  // `attributionFor` answers `fallback` for it without one — which is why this
  // must be called on a stored row and not on that default.
  return attribution.origin === 'confirmed' || attribution.origin === 'fallback';
}

/**
 * Record what the acoustic layer decided, if it is allowed to decide it.
 *
 * **A rendered ordinal is final.** Once a turn shows a name, nothing automatic
 * may change it — not a later, better-informed pass, not a re-clustering, not
 * this function. Only a person may, through {@link attributeTurn}.
 *
 * That rule is a choice with a cost and it is worth stating why it was paid. A
 * pass that renumbered turns with hindsight would score better on paper: it
 * would fix labels the first pass got wrong. But the premise of this design is
 * that in a live conversation nobody is watching the screen, and a chip that
 * silently becomes a different person is unverifiable by the one reader who
 * might have caught it. Stability is the property being bought, and the failure
 * this design names is a chip that never resolves — not a chip that is wrong.
 *
 * Refuses a speaker who is not on the roster, for the same reason
 * {@link attributeTurn} does: an attribution pointing at nobody renders as
 * nothing and would do it without any error to notice.
 */
export function autoAttributeTurn(
  attributions: AttributionsBySession,
  speakers: readonly SessionSpeaker[],
  sessionId: string,
  speakerId: string,
): AttributionsBySession {
  if (!speakers.some((speaker) => speaker.id === speakerId)) return attributions;
  const current = attributions[sessionId];
  // Both predicates, not one. `isRendered` protects a name on screen;
  // `isHumanTouched` protects a person's rejection, which is not on screen and
  // is the more important of the two to leave alone.
  if (current && (isRendered(current) || isHumanTouched(current))) return attributions;
  return {
    ...attributions,
    [sessionId]: { speakerId, origin: 'suggested', suggestedSpeakerId: speakerId },
  };
}

/**
 * Mark that the acoustic layer heard this turn and could not place it.
 *
 * Written as a row rather than left absent, because absence already means
 * `fallback` — "nobody said, and nothing is coming" — and this state means the
 * opposite: an answer is owed. Two states that render differently and promise
 * different things cannot share one encoding.
 *
 * Never overwrites a rendered turn, and never overwrites an existing `pending`
 * either: re-marking would reset nothing but would let a caller believe the
 * second call did something.
 */
export function markPending(
  attributions: AttributionsBySession,
  sessionId: string,
): AttributionsBySession {
  const current = attributions[sessionId];
  if (current && (isRendered(current) || current.origin === 'pending')) return attributions;
  return { ...attributions, [sessionId]: { speakerId: null, origin: 'pending' } };
}

/**
 * Give every turn still waiting an ordinal, and close the promise.
 *
 * `fill` is asked for a speaker per waiting turn and may answer `null`, which is
 * what a turn whose vector never arrived looks like — those are handled by the
 * carry-forward below rather than by the caller.
 *
 * **Carry-forward is a bet, and naming it as one is the point.** A turn with no
 * usable evidence takes the ordinal of the nearest earlier turn that has one.
 * That reads coherently and invents nothing, but it does assume the same person
 * spoke twice, and the real rate at which speakers alternate in this product has
 * never been measured — the bench can only produce a perfect alternation or a
 * coin flip, and neither is a conversation. If that rate is high this rule is
 * systematically wrong, and the first real session is what will say so.
 *
 * Turns are processed in the caller's order, and a filled turn becomes the
 * carry-forward source for the next one, so a run of evidence-free turns at the
 * end of a session all inherit from the last turn that had evidence.
 *
 * **Every branch here assumes the acoustic layer ran**, and the caller is what
 * guarantees it. A turn with no row means "no vector arrived for it yet"; with
 * the layer switched off that describes EVERY turn, and the carry-forward would
 * then spread one confirmed name across a whole transcript. The reducer refuses
 * to call this until at least one voice has been observed — see the
 * `transcript.settled` case. Do not call it from anywhere that cannot promise
 * the same.
 */
export function fillPendingTurns(
  attributions: AttributionsBySession,
  sessionIds: readonly string[],
  fill: (sessionId: string) => string | null,
): AttributionsBySession {
  let carried: string | null = null;
  let next = attributions;
  let changed = false;

  for (const sessionId of sessionIds) {
    const current = next[sessionId];

    // A name is already there. Nothing to do, but it becomes what the next
    // evidence-free turn inherits.
    if (current && isRendered(current)) {
      carried = current.speakerId;
      continue;
    }
    // A person said *nobody here said this*. That is a decision, and the whole
    // point of settling is to answer turns nobody answered.
    if (current && isHumanTouched(current)) continue;

    // Everything left is a turn with no name and no decision on it: `pending`
    // because the clusterer heard it and could not place it, or **no row at
    // all** because the socket closed before the server could send its vector.
    // The second case is not an edge — it is the last one to three turns of
    // every session, and an earlier version of this function skipped it
    // entirely, which quietly broke the one promise the state exists to make.
    const speakerId = fill(sessionId) ?? carried;
    if (!speakerId) continue;

    if (!changed) {
      next = { ...next };
      changed = true;
    }
    next[sessionId] = { speakerId, origin: 'suggested', suggestedSpeakerId: speakerId };
    carried = speakerId;
  }
  return next;
}

/** Who said this turn — `fallback` when nobody has said. */
export function attributionFor(
  attributions: AttributionsBySession,
  sessionId: string,
): TurnAttribution {
  return attributions[sessionId] ?? UNATTRIBUTED;
}

/** The participant an attribution names, or `null` for an unattributed turn. */
export function speakerFor(
  speakers: readonly SessionSpeaker[],
  attributions: AttributionsBySession,
  sessionId: string,
): SessionSpeaker | null {
  const { speakerId } = attributionFor(attributions, sessionId);
  if (!speakerId) return null;
  return speakers.find((speaker) => speaker.id === speakerId) ?? null;
}
