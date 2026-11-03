'use client';

import { useLayoutEffect, useRef } from 'react';
import { useSmoothTextReveal } from '@/hooks/use-smooth-text-reveal';
import {
  claimLiveLine,
  previouslyDrawn,
  recordDrawn,
  wasDrawn,
  useLiveLineHandoff,
  type HandoffConsumer,
} from '@/components/translate/live-line-handoff';

interface MorphingTextProps {
  /** What the line says now. */
  text: string;
  /** The turns this line shows; a new one may be taking over from its live line. */
  sessionIds: readonly string[];
  /** Which half of a live line this text continues. */
  half: Exclude<HandoffConsumer, 'position'>;
  /**
   * Whether a turn arriving with nothing to continue may be typed in. Only the
   * newest blocks: a batch of turns restored after the transcript mounted
   * would otherwise all type at once.
   */
  typeInWhenNew: boolean;
}

/** Every change to a finished line completes within this long. The user's bound (03/11/2026). */
export const SETTLED_MORPH_MS = 800;

/**
 * A finished line's text: drawn whole when it first appears, and morphed —
 * changed words erased and retyped in place — whenever it changes after that.
 *
 * Finished lines change more than they look like they should. The finished turn
 * replaces the live line with a rendering whose numbers and punctuation were
 * typeset, and whose translation was made from the whole sentence; then a
 * polished translation may replace the draft, and about a second later the
 * block it joined may be retranslated whole. Each of those used to be one
 * frame's swap. Each is now typed, within {@link SETTLED_MORPH_MS}.
 *
 * When a turn has just finished, its line starts from what the live line was
 * showing, so the words the reader was following turn into the final ones where
 * they stand instead of vanishing below and reappearing above.
 *
 * What a screen reader hears is the final text, once: while a change is drawn
 * the morph is `aria-hidden` beside a plain copy, as on the live line.
 */
export function MorphingText({ text, sessionIds, half, typeInWhenNew }: MorphingTextProps) {
  const registry = useLiveLineHandoff();
  // The turns this line had the last time its text changed; `null` before the
  // first. Read and written only inside the seed, which runs in a layout effect.
  const known = useRef<readonly string[] | null>(null);
  const { shown, attach } = useSmoothTextReveal(text, {
    initialIntervalMs: 300,
    maxGraphemesPerFrame: half === 'source' ? 3 : 4,
    maxMorphMs: SETTLED_MORPH_MS,
    instantInitial: true,
    seed: (_target, current) => {
      const before = known.current;
      known.current = sessionIds;
      const added = before === null ? sessionIds : sessionIds.filter((id) => !before.includes(id));
      if (added.length === 0) return null;
      const now = performance.now();
      // The turn's own live line first. Another line that just ended — the
      // parent of a split turn — only for turns never drawn before: a line
      // that is remounting has a past of its own, and borrowing a stranger's
      // words would put another turn's sentence inside this block.
      const own = claimLiveLine(registry, added, half, now, { ownLineOnly: true });
      const borrowed =
        own ?? (wasDrawn(registry, half, added) ? null : claimLiveLine(registry, added, half, now));
      const live = borrowed?.[half] ?? '';
      if (before !== null) {
        // A turn that joined a block already on screen continues it: the
        // block's own text stays, and the live words follow it until they
        // become final. Without a live line, the new words are simply typed on.
        return live === '' || current === '' ? null : `${current} ${live}`;
      }
      if (live !== '') return live;
      // Mounting for the second time — regrouped under a new key — so start
      // from what these turns already read on screen.
      const drawn = previouslyDrawn(registry, half, sessionIds);
      if (drawn !== null) return drawn;
      if (wasDrawn(registry, half, sessionIds)) return null;
      // A turn that finished with no live line to continue, arriving at the end
      // of a transcript already on screen, is typed in like everything else.
      // The transcript's own first render is drawn whole.
      return registry?.ready && typeInWhenNew ? '' : null;
    },
  });
  // What this line reads, for a remount to start from. The target, not the
  // morph in progress: a remount mid-morph should finish heading to it.
  useLayoutEffect(() => {
    recordDrawn(registry, half, sessionIds, text);
  });
  // Two copies only while a change is drawn: the morph hidden from assistive
  // technology, the final text beside it for it to read. Once settled, one
  // copy, so selecting or searching the line finds each word once.
  const morphing = shown !== text;
  return (
    <>
      <span aria-hidden={morphing || undefined} ref={attach}>
        {shown}
      </span>
      {morphing ? <span className="sr-only">{text}</span> : null}
    </>
  );
}
