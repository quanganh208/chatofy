'use client';

import type { LiveTurn } from '@chatofy/realtime-client';
import { cn } from '@/lib/utils';
import { useSmoothTextReveal } from '@/hooks/use-smooth-text-reveal';
import { TurnLanguage } from '@/components/translate/turn-language-tag';

interface LiveTurnLineProps {
  live: LiveTurn;
  showsSource: boolean;
  showsTarget: boolean;
  /** The rule and insets every turn on the stream shares. */
  frameClassName: string;
}

/**
 * The sentence still being spoken, typed in grapheme by grapheme on both halves.
 *
 * Its own component so that the reveal's frame-rate state re-renders this line
 * and nothing else: the finished turns above it are a list that can run long,
 * and redrawing it sixty times a second to move one line would be the expensive
 * way to animate a few characters.
 *
 * What a screen reader hears is unchanged. The typed text is `aria-hidden` and a
 * plain copy of what the server sent sits beside it, so the live region still
 * announces once per server update, not once per character.
 */
export function LiveTurnLine({
  live,
  showsSource,
  showsTarget,
  frameClassName,
}: LiveTurnLineProps) {
  const sourceText = showsSource ? live.text : '';
  const targetText = showsTarget ? live.translation : '';
  // Unconditional, as hooks must be; a side this pane does not show is given
  // nothing to type.
  // Destructured, as `cascade-panel.tsx` does for `useFullscreen`: one field goes
  // to `ref=`, and the compiler's refs rule would otherwise treat every field read
  // off the same object as a ref read in render.
  const { shown: sourceShown, attach: attachSource } = useSmoothTextReveal(sourceText, {
    initialIntervalMs: 300,
  });
  // A provisional translation streams in token by token and restarts for each
  // longer prefix, so its updates come faster than the recogniser's. It holds the
  // previous guess while the new one is still shorter, and may type a little
  // faster, because a whole sentence often lands at once.
  const { shown: targetShown, attach: attachTarget } = useSmoothTextReveal(targetText, {
    initialIntervalMs: 120,
    holdWhileShorter: true,
    maxGraphemesPerFrame: 4,
  });

  // The committed index is into the server's string; the typed one is a prefix
  // of it, so the split is wherever the shorter of the two ends.
  const head = Math.min(live.committedChars ?? sourceShown.length, sourceShown.length);

  return (
    <div
      // Dashed rule and italics say "unfinished". An `opacity-80` said it too
      // and cost the floor: composited over the page it took this line — the
      // most-watched one on the screen — to 3.98:1 dark and 3.33:1 light,
      // under the 4.5 every token here clears on its own.
      // `contrast-floors.spec.ts` reads TOKENS and cannot see a composited
      // alpha, so the dim passed every gate while breaking the rule they
      // exist for.
      className={cn('border-border border-dashed', frameClassName)}
    >
      {/* Present only once the server has decided the turn's language —
          a declared turn never carries one, so nothing here changes for
          it. The finished turn's tag replaces this, and may differ. */}
      {live.language ? <TurnLanguage languages={[live.language]} /> : null}
      {sourceText ? (
        <p className="reading-source text-source italic">
          {/* Two layers, one line. The head is text the recogniser has
              stopped revising; the tail is still a guess. Splitting them
              is the whole point of the settled-text event — without it the
              reader cannot tell which half is safe to read.

              `?? shown.length` is what a client that never receives the
              settled event sees: the whole line as the head, which is
              exactly the old rendering.

              A colour token, never `opacity`, and the comment above says
              why. */}
          <span aria-hidden ref={attachSource}>
            {sourceShown.slice(0, head)}
            {live.committedChars === undefined ? null : (
              <span className="text-muted-foreground">{sourceShown.slice(head)}</span>
            )}
          </span>
          <span className="sr-only">{sourceText}</span>
        </p>
      ) : null}
      {/* Only on turns long enough for the wait to be felt; short ones have
          their real translation before a guess would be read. */}
      {targetText ? (
        <p className="text-muted-foreground text-target italic">
          <span aria-hidden ref={attachTarget}>
            {targetShown}
          </span>
          <span className="sr-only">{targetText}</span>
        </p>
      ) : null}
    </div>
  );
}
