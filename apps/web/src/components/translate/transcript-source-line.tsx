'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslate } from '@/i18n/provider';

interface TranscriptSourceLineProps {
  /** What to show: the repaired rendering where one exists, raw otherwise. */
  text: string;
  /** Exactly what the recognizer produced, always. */
  raw: string;
  /** Whether `text` differs from `raw` because a repair landed. */
  repaired: boolean;
}

/**
 * One turn's source line, with the recognizer's own words one tap away.
 *
 * The repaired line is the display and the raw line is the record, and the
 * product cannot quietly replace one with the other. A repair is a model's
 * rendering of what a speaker said: it restores punctuation and numerals, and it
 * could in principle put a word on screen nobody uttered. The divergence guard
 * is what makes that unlikely; this is what makes it CHECKABLE, by the one
 * person who can — the speaker, reading their own sentence back.
 *
 * So the toggle is offered only when there is genuinely something else to see.
 * A turn with no repair renders exactly the paragraph it rendered before this
 * existed: no control, no marker, nothing to explain. Showing a disclosure on
 * every turn would teach people to ignore it on the turns where it matters.
 *
 * Deliberately NOT an accent control. Every screen in this app spends its one
 * accent-filled control elsewhere, and a per-turn disclosure competing with the
 * conversation's primary action would be the wrong thing shouting.
 *
 * Local state per line rather than lifted: which originals somebody has open is
 * about reading, it belongs to no session, and it must not survive the
 * conversation.
 */
export function TranscriptSourceLine({ text, raw, repaired }: TranscriptSourceLineProps) {
  const t = useTranslate();
  const [showRaw, setShowRaw] = useState(false);

  if (!repaired) return <p className="text-prose text-source">{text}</p>;

  return (
    <div className="flex flex-col gap-1">
      <p className="text-prose text-source">{text}</p>
      <button
        type="button"
        onClick={() => setShowRaw((open) => !open)}
        // `aria-expanded` rather than a label that changes meaning: a screen
        // reader announces the state from the attribute, so the name can stay
        // constant and describe the thing being disclosed.
        aria-expanded={showRaw}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex w-fit items-center gap-1 rounded text-hint focus-visible:ring-2 focus-visible:outline-none"
      >
        <ChevronDown
          aria-hidden
          className={cn(
            'size-3 transition-transform motion-reduce:transition-none',
            showRaw && 'rotate-180',
          )}
        />
        {t('web.translate.sourceRawToggle')}
      </button>
      {showRaw ? (
        // Marked as machine output in words, not only in styling. Somebody
        // reading two similar Vietnamese sentences has no way to tell which is
        // which from a shade of grey, and getting that backwards is worse than
        // not offering the comparison at all.
        // `text-source`, the same size as the line above it, and that is the whole
        // point of the disclosure: two renderings of one sentence can only be
        // compared like for like. It was `text-hint` — fixed at 12px while the
        // repaired line follows the reader's size — which at the largest step put
        // 28px against 12px and made the comparison harder than the shade of grey
        // this control exists to replace. What separates them is the rule, the
        // label and the colour, none of which change with size.
        <p className="text-muted-foreground border-hairline text-source border-l-2 pl-3">
          <span className="font-medium">{t('web.translate.sourceRawLabel')}</span> {raw}
        </p>
      ) : null}
    </div>
  );
}
