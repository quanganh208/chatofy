'use client';

import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import type { AttributionOrigin, SessionSpeaker } from '@chatofy/realtime-client';
import { Badge } from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';

/**
 * Who said one turn, and the control that says otherwise.
 *
 * **Everything here acts on a turn that is already finished.** `cascade-panel.tsx`
 * records the product's core claim — there is no stop button, because pressing
 * one costs half a second of human reaction time, which was the largest single
 * term in the measured latency of the turn-based page. A design that asked
 * someone to identify themselves BEFORE speaking would hand that back. This chip
 * sits on a turn already captured, translated and rendered, off the latency path
 * entirely.
 *
 * **Three states, and the difference between them is load-bearing.** In a live
 * conversation nobody is watching the screen, so a wrong label that nobody
 * corrects is indistinguishable from a right one. The only defence is that a
 * label nobody confirmed must never look like one somebody did:
 *
 * - `confirmed` — a person chose it. Reads settled.
 * - `suggested` — the acoustic layer proposed it. Dashed and italic at reduced
 *   opacity, the same vocabulary `ConversationTranscript` already uses for a
 *   live line that may still change. Not a second language for provisionality;
 *   the same one.
 * - `pending` — the acoustic layer heard the turn and could not place it yet.
 *   The same dashed-italic vocabulary, quieter again, because there is no name
 *   to read — only the place one is coming to.
 * - `fallback` — nobody said. Reads as a question rather than a name, because a
 *   turn nobody attributed must never render as a person.
 *
 * The `suggested` styling was built before anything could produce it.
 * Retrofitting provisionality onto a chip that has spent a release looking
 * definite is how the distinction gets quietly dropped, and it is the rule the
 * design rests on.
 *
 * **`pending` stays a button, like every other state.** The alternative — an
 * inert placeholder — was considered and rejected, because it removes the only
 * surface a person could use to settle the turn themselves, and it makes the
 * rule "a human edit while pending is final" unreachable and therefore
 * untestable. A chip nobody can touch is not a quieter chip, it is a chip that
 * has taken authority away from the one party this design gives it to.
 *
 * **Never accent-filled.** `docs/design-guidelines.md` spends the accent once per
 * screen, and on `/translate` the primary action already has it. Five people
 * talking would put a dozen accent marks on screen and the rule would be gone.
 */

interface SpeakerChipProps {
  speakers: SessionSpeaker[];
  /** The participant this turn names, or `null` when nobody has said. */
  speaker: SessionSpeaker | null;
  origin: AttributionOrigin;
  onAttribute: (speakerId: string) => void;
  onUnattribute: () => void;
  onAddSpeaker: () => void;
}

const CHIP_TONE: Record<AttributionOrigin, string> = {
  confirmed: 'border-border text-foreground',
  // Dashed, italic and dimmed — borrowed verbatim from the live line, so a label
  // that may still change never looks like one that will not.
  suggested: 'border-border border-dashed text-muted-foreground italic opacity-80',
  // Quieter still than `suggested`, and deliberately quieter than `fallback`
  // looks. It carries no name yet, so there is nothing here to read — only a
  // place where one is coming.
  pending: 'border-border border-dashed text-muted-foreground italic opacity-50',
  fallback: 'border-transparent text-muted-foreground',
};

export function SpeakerChip({
  speakers,
  speaker,
  origin,
  onAttribute,
  onUnattribute,
  onAddSpeaker,
}: SpeakerChipProps) {
  const t = useTranslate();
  // Which chip is expanded is a property of this one control, not of the
  // conversation. It stays local; the roster itself lives in the reducer, and a
  // copy of it here would be a second source of truth for what is on screen.
  const [picking, setPicking] = useState(false);

  const choose = (act: () => void) => {
    act();
    setPicking(false);
  };

  if (!picking) {
    return (
      <Badge
        asChild
        variant="outline"
        className={`${CHIP_TONE[origin]} hover:bg-secondary cursor-pointer`}
      >
        <button
          type="button"
          onClick={() => setPicking(true)}
          aria-label={
            speaker
              ? t('web.translate.speakerChange', { name: speaker.label })
              : t('web.translate.speakerAsk')
          }
        >
          {speaker ? speaker.label : t('web.translate.speakerUnknown')}
        </button>
      </Badge>
    );
  }

  return (
    // Escape closes, so a chip opened by mistake never has to be dismissed by
    // choosing something. Listened for on the group rather than each button, so
    // it works wherever focus has landed inside it.
    <div
      className="flex flex-wrap items-center gap-1.5"
      onKeyDown={(keyEvent) => {
        if (keyEvent.key === 'Escape') setPicking(false);
      }}
    >
      {speakers.map((candidate) => (
        <Badge
          key={candidate.id}
          asChild
          variant="outline"
          className="hover:bg-secondary cursor-pointer"
        >
          <button type="button" onClick={() => choose(() => onAttribute(candidate.id))}>
            {candidate.label}
          </button>
        </Badge>
      ))}

      {/* Saying nobody named said this is a choice about the turn, and the only
          way out of a roster holding one person and one mistaken attribution —
          that speaker cannot be removed while a turn still names them. */}
      <Badge asChild variant="ghost" className="text-muted-foreground cursor-pointer">
        <button type="button" onClick={() => choose(onUnattribute)}>
          {t('web.translate.speakerNobody')}
        </button>
      </Badge>

      {/* Reachable from the turn, not only from the roster above: the moment
          anyone notices somebody unlisted is speaking is the moment they are
          looking at that person's turn. */}
      <Badge asChild variant="ghost" className="text-muted-foreground cursor-pointer">
        <button type="button" onClick={() => choose(onAddSpeaker)}>
          <UserPlus aria-hidden /> {t('web.translate.speakerAdd')}
        </button>
      </Badge>
    </div>
  );
}
