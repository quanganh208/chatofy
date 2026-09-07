'use client';

import type { AttributionOrigin, SessionSpeaker } from '@chatofy/realtime-client';
import { cn } from '@/lib/utils';

/**
 * Who spoke a turn, on the stream that is not the one you name people from.
 *
 * `split` draws the two sides as two panes, and a pane read on its own has to say
 * whose words these are — a wall of translations attributed to nobody is a wall of
 * translations you cannot follow. But two interactive chips for one turn would be
 * two controls writing one piece of state, and the reader would have no way to
 * know they were the same control. So exactly one stream carries the chip and the
 * other carries this: the same name, no menu, nothing to press.
 *
 * **It repeats the chip's provisionality vocabulary rather than inventing one.**
 * A label the acoustic layer guessed must not read as settled here just because
 * this copy cannot be corrected in place — that would make the pane showing the
 * least trustworthy version the one that looks most certain. Italic is the whole
 * signal; the chip's borders have nothing to attach to without a border of its
 * own, and adding one would draw a second chip.
 *
 * A `<p>`, not a button and not a `Badge`. It is a readout, and anything that
 * looked pressable here would be a control that does nothing — the exact fault
 * the speaker mark in the panel header was corrected for.
 *
 * **With no name, it renders nothing.** The chip's own empty state is the words
 * "Who spoke?", which is a call to action — repeated here it would ask the reader
 * a question on the one stream that offers no way to answer it, and in `split` it
 * would ask it twice per turn, side by side, once pressable and once not. A turn
 * nobody has named simply carries no name on this side; the question is on the
 * stream that can take the answer.
 */
export function SpeakerLabel({
  speaker,
  origin,
}: {
  speaker: SessionSpeaker | null;
  origin: AttributionOrigin;
}) {
  if (!speaker) return null;

  return (
    <p
      className={cn(
        'text-muted-foreground text-hint font-medium',
        (origin === 'suggested' || origin === 'pending') && 'italic',
      )}
    >
      {speaker.label}
    </p>
  );
}
