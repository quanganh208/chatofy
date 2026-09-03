'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiClientError } from '@chatofy/api-client';
import type { ConversationTurn, TranslationDirection } from '@chatofy/types';
import { saveConversation } from '@/clients/api-client';

/**
 * Why a save failed, from the caller's point of view.
 *
 * - `retryable` — a network error, a 5xx, or a throttle. Sending the same body
 *   again can succeed, so a Retry control is honest.
 * - `terminal` — a 400 (over the storage ceiling, or implausible timestamps), a
 *   401, or the 413 the parser answers for an oversized body. The same body will
 *   never succeed; offering "retry" forever is a lie.
 *
 * Anything unrecognized is `retryable`. Defaulting the other way would abandon a
 * conversation that a transient blip could have saved.
 */
export type ConversationSaveFailure = 'retryable' | 'terminal';

export interface UseConversationSave {
  /**
   * The current conversation is stored. Once the row exists it stays true: a
   * later edit that fails to save does not un-store what is already in the
   * database, and saying otherwise would tell the reader their conversation was
   * lost while it sits in their history.
   */
  saved: boolean;
  /** A save is in flight. */
  saving: boolean;
  /**
   * The last save failed. Read alongside `saved`, which says what was lost:
   * with `saved` false nothing is stored, with `saved` true the conversation is
   * stored and only the edits made after it are missing.
   */
  failure: ConversationSaveFailure | null;
  /** Re-attempt the last save. A no-op unless the last failure was retryable. */
  retry: () => void;
}

/** What the hook needs to know about the conversation it is saving. */
export interface ConversationSaveInput {
  /** Re-minted on every `start`; null before the first conversation. */
  conversationId: string | null;
  startedAt: string | null;
  direction: TranslationDirection;
  /** True while the microphone is open. The save fires on the falling edge. */
  running: boolean;
  /** The finished conversation as display blocks — see `toConversationTurns`. */
  turns: ConversationTurn[];
}

/**
 * How long a burst of edits to an already-stored conversation is allowed to
 * settle before it is written.
 *
 * A rename is typed one character at a time and every write replaces the WHOLE
 * transcript, so an un-coalesced field would spend one full-transcript PUT per
 * keystroke against a route throttled per minute — naming two people could hit
 * the throttle and show a save failure for typing.
 */
const EDIT_COALESCE_MS = 800;

/**
 * Saves a finished conversation, once, when it ends.
 *
 * ## When it fires
 *
 * On the `running → idle` transition with at least one block, whatever caused
 * it: a user pressing End and a dropped socket are the same event here, because
 * the turns so far are worth keeping either way. What distinguishes them is the
 * id, and that is `useStreamingTranslate`'s job — the next `start` mints a new
 * one, so a resumed conversation never overwrites the half that was saved.
 *
 * It also fires on unmount when blocks exist and nothing has been saved, which
 * covers a route change; and it re-fires when the transcript changes after the
 * conversation ended, so a roster edit or a late attribution is stored too —
 * safe because the write is a full replacement. That first write is immediate
 * and the later ones are coalesced: the falling edge is what the conversation
 * depends on, an edit is not.
 *
 * ## When it ended
 *
 * `endedAt` is stamped ONCE, at the falling edge, and every re-save of the same
 * conversation repeats it. Re-stamping per write would grow the stored duration
 * by however long the reader spent editing — a card reading an hour for a
 * twenty-minute conversation.
 *
 * That is the whole of what it buys. It does not make a late edit acceptable to
 * the API: the write is validated against the clock at the boundary, and
 * `startedAt` is whatever the conversation started with either way.
 *
 * ## What it does not cover
 *
 * A hard tab close or a crash may lose the conversation. This is accepted, not
 * overlooked: the alternative is writing on the per-turn hot path, where sub-2s
 * turn latency is the product's headline criterion, and `keepalive` cannot
 * carry a body this size (a 64KiB standard cap, against a ~520KB ceiling here).
 * The loss profile is no worse than today's — what changes is that ending a
 * conversation normally keeps it. If that ever proves unacceptable, the fix is
 * per-turn writes and its latency cost must be MEASURED, not assumed.
 *
 * ## Serialization
 *
 * One in-flight promise per id; a save requested while one is running queues
 * behind it. The store is hardened against concurrent replaces too, but the
 * client should not be generating the collisions in the first place.
 */
export function useConversationSave(input: ConversationSaveInput): UseConversationSave {
  const { conversationId, startedAt, direction, running, turns } = input;

  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<ConversationSaveFailure | null>(null);

  // The tail of the save queue for the CURRENT id. Everything chains onto it
  // rather than racing it.
  const inFlight = useRef<Promise<void>>(Promise.resolve());
  // Which id `saved` describes, so a new conversation starts unsaved.
  const savedId = useRef<string | null>(null);
  // When the current conversation ended, minted at the first write of it.
  const endedAt = useRef<string | null>(null);
  // Which id has already had its immediate first write requested; anything
  // after that for the same id is an edit.
  const firstWriteFor = useRef<string | null>(null);
  // An edit waiting out its coalescing delay, and the timer carrying it. The
  // flag outlives the timer on purpose: the effect below clears the timer on
  // its way out, and the unmount handler still has to write the edit.
  const editPending = useRef(false);
  const editTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // What to send, readable from a callback without making the effects below
  // depend on it. Written in an effect rather than during render: a render can
  // be discarded or replayed, so a ref write there is a side effect at a moment
  // React promises nothing about. Declared FIRST so the effects that read it run
  // after it in the same commit.
  const latest = useRef({ conversationId, startedAt, direction, turns, saved });
  useEffect(() => {
    latest.current = { conversationId, startedAt, direction, turns, saved };
  }, [conversationId, startedAt, direction, turns, saved]);

  const enqueue = useCallback(() => {
    const { conversationId: id, startedAt: began, direction: dir, turns: rows } = latest.current;
    if (!id || !began || rows.length === 0) return;

    // The first write of this conversation decides when it ended; every later
    // one repeats that instant rather than reporting the time of the edit.
    endedAt.current ??= new Date().toISOString();
    const ended = endedAt.current;

    setSaving(true);
    setFailure(null);
    inFlight.current = inFlight.current.then(async () => {
      try {
        await saveConversation(id, {
          direction: dir,
          startedAt: began,
          endedAt: ended,
          turns: rows,
        });
        // A write that lands after the reader has started another conversation
        // stored the right rows under the right id — but the state it would
        // write describes a conversation that is no longer on screen, and
        // "saved" for the wrong one enables a Generate that can only 404.
        if (latest.current.conversationId !== id) return;
        savedId.current = id;
        setSaved(true);
        setFailure(null);
      } catch (err) {
        if (latest.current.conversationId !== id) return;
        // A failed EDIT leaves the conversation exactly as stored. Only a
        // conversation that never landed at all is unsaved.
        if (savedId.current !== id) setSaved(false);
        setFailure(classify(err));
      } finally {
        if (latest.current.conversationId === id) setSaving(false);
      }
    });
  }, []);

  // A new conversation is unsaved, whatever the previous one's outcome was.
  useEffect(() => {
    if (!conversationId || savedId.current === conversationId) return;
    setSaved(false);
    setFailure(null);
    // Including `saving`: a write for the conversation being left is still in
    // flight, and its own completion refuses to touch state that now describes
    // a different conversation — so nothing else would ever put this back down,
    // and the new conversation would read as saving for its whole life.
    setSaving(false);
    endedAt.current = null;
    // An edit still waiting belongs to the conversation that is being left, and
    // `enqueue` reads whatever is current — so it is dropped, not carried over.
    if (editTimer.current !== null) clearTimeout(editTimer.current);
    editTimer.current = null;
    editPending.current = false;
    // A fresh queue per id: the previous conversation's chain is finished with,
    // and keeping it would make the first save of a new one wait on it.
    inFlight.current = Promise.resolve();
  }, [conversationId]);

  // The falling edge, plus a re-save when the transcript changes afterwards.
  //
  // Keyed on a content signature rather than on `turns` itself: the array has a
  // new identity every render, which would re-fire this on every partial. The
  // signature is only computed once the conversation has ENDED, so nothing walks
  // the transcript on the hot path.
  const signature = running ? '' : signatureOf(turns);
  useEffect(() => {
    if (running || signature === '') return;

    // The write the conversation depends on, so it goes out at once.
    if (firstWriteFor.current !== conversationId) {
      firstWriteFor.current = conversationId;
      enqueue();
      return;
    }

    // An edit to a conversation already written. The cleanup below cancels it
    // when another keystroke arrives, so a burst becomes one write.
    editPending.current = true;
    editTimer.current = setTimeout(() => {
      editTimer.current = null;
      editPending.current = false;
      enqueue();
    }, EDIT_COALESCE_MS);
    return () => {
      if (editTimer.current !== null) clearTimeout(editTimer.current);
      editTimer.current = null;
    };
  }, [running, signature, conversationId, enqueue]);

  // Unmount — a route change away from a finished conversation nothing saved,
  // or away from an edit whose coalescing delay had not elapsed.
  useEffect(
    () => () => {
      if (editPending.current) {
        editPending.current = false;
        enqueue();
        return;
      }
      if (!latest.current.saved && latest.current.turns.length > 0) enqueue();
    },
    [enqueue],
  );

  const retry = useCallback(() => {
    if (failure !== 'retryable') return;
    enqueue();
  }, [failure, enqueue]);

  return { saved, saving, failure, retry };
}

/**
 * Only 400, 401 and 413 are terminal; everything else retries.
 *
 * A 404 cannot occur on a PUT that creates, and a 413 comes from the parser
 * before any route runs — the body is too large, and resending it will not make
 * it smaller.
 */
function classify(err: unknown): ConversationSaveFailure {
  const terminal = new Set([400, 401, 413]);
  if (err instanceof ApiClientError && terminal.has(err.status)) return 'terminal';
  return 'retryable';
}

/**
 * A fingerprint of the labels and the text, so a roster edit or a late
 * attribution after the conversation ended triggers a re-save while a plain
 * re-render does not. Empty means "nothing to save".
 *
 * The separator is a NUL because no label or transcript can contain one, so no
 * pair of different transcripts can produce the same fingerprint. It is written
 * as an escape: the literal byte makes this file binary to git, which hides the
 * whole hook from a diff.
 */
function signatureOf(turns: readonly ConversationTurn[]): string {
  return turns
    .map((turn) => `${turn.speakerLabel ?? ''}|${turn.displayText ?? turn.sourceText}`)
    .join('\0');
}
