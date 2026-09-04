'use client';

import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import type {
  AttributionOrigin,
  AttributionsBySession,
  SessionSpeaker,
} from '@chatofy/realtime-client';
import { Badge } from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';
import { SpeakerManager } from '@/components/translate/speaker-manager';

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
 *   The same italic vocabulary, one step further from settled in the border —
 *   dotted rather than dashed — because there is no name to read, only the
 *   place one is coming to. It says so in words as well as in styling: a
 *   promise a screen reader cannot hear is not a promise.
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
 *
 * ## Three faces, because the roster is gone
 *
 * The chip, the picker, and a manage face carrying rename and remove. Those two
 * were a permanent row under the transcript, and that row is what the two-panel
 * layout could not afford: a block of chrome on screen for the whole
 * conversation, holding only a hint until somebody was added, for two operations
 * the picker beside it was already one click from. `speaker-manager.tsx` records
 * the trade.
 *
 * Adding a person did NOT move with them. It is the only speaker operation
 * wanted before any turn exists, and it stays on the picker's first face.
 */

interface SpeakerChipProps {
  speakers: SessionSpeaker[];
  /** The participant this turn names, or `null` when nobody has said. */
  speaker: SessionSpeaker | null;
  origin: AttributionOrigin;
  /** Read only to decide which people are still removable. */
  attributions: AttributionsBySession;
  onAttribute: (speakerId: string) => void;
  onUnattribute: () => void;
  onAddSpeaker: () => void;
  onRenameSpeaker: (speakerId: string, label: string) => void;
  onRemoveSpeaker: (speakerId: string) => void;
}

/**
 * Which of the chip's three faces is showing.
 *
 * `managing` is the roster that used to sit under the transcript. It is a face
 * of this control rather than a block of its own because everything it offered
 * except renaming and removing was already here — see `speaker-manager.tsx`.
 */
type ChipFace = 'chip' | 'picking' | 'managing';

const CHIP_TONE: Record<AttributionOrigin, string> = {
  confirmed: 'border-border text-foreground',
  // Dashed, italic and dimmed — borrowed verbatim from the live line, so a label
  // that may still change never looks like one that will not.
  suggested: 'border-border border-dashed text-muted-foreground italic opacity-80',
  // Dotted rather than dashed, and at full `text-muted-foreground`.
  //
  // **It carries no name yet, but it may not whisper it.** The first version of
  // this state said "quieter still than `suggested`" and spent `opacity-50` to
  // say it, which composites `textMuted` down to 2.29:1 on the dark ground and
  // 1.99:1 on the light one — against the 4.5 floor
  // `apps/web/src/design/contrast-floors.spec.ts` holds every other pairing to.
  // That spec measures raw tokens, so it cannot see an opacity composite and
  // did not object; the floor still applies, and this is an interactive control
  // rather than a disabled one, so no exemption covers it.
  //
  // The provisional reading now comes from the border rather than from
  // luminance: dotted is a step further from the settled solid border than
  // `suggested`'s dashed, and costs no contrast to say so.
  pending: 'border-border border-dotted text-muted-foreground italic',
  fallback: 'border-transparent text-muted-foreground',
};

export function SpeakerChip({
  speakers,
  speaker,
  origin,
  attributions,
  onAttribute,
  onUnattribute,
  onAddSpeaker,
  onRenameSpeaker,
  onRemoveSpeaker,
}: SpeakerChipProps) {
  const t = useTranslate();
  // Which chip is expanded is a property of this one control, not of the
  // conversation. It stays local; the roster itself lives in the reducer, and a
  // copy of it here would be a second source of truth for what is on screen.
  const [face, setFace] = useState<ChipFace>('chip');

  const choose = (act: () => void) => {
    act();
    setFace('chip');
  };

  if (face === 'chip') {
    return (
      <Badge
        asChild
        variant="outline"
        className={`${CHIP_TONE[origin]} hover:bg-secondary cursor-pointer`}
      >
        <button
          type="button"
          onClick={() => setFace('picking')}
          aria-label={
            speaker
              ? t('web.translate.speakerChange', { name: speaker.label })
              : origin === 'pending'
                ? t('web.translate.speakerPendingAria')
                : t('web.translate.speakerAsk')
          }
        >
          {/* `pending` and `fallback` both hold no speaker, so both would read
              "Who spoke?" — and the difference between them is a promise, not a
              shade: one owes an answer and the other does not. Leaving that to
              the border and the italics would carry it to sighted readers only,
              which is how the state most likely to change becomes the one a
              screen reader cannot track. */}
          {speaker
            ? speaker.label
            : origin === 'pending'
              ? t('web.translate.speakerPending')
              : t('web.translate.speakerUnknown')}
        </button>
      </Badge>
    );
  }

  // Escape closes, so a chip opened by mistake never has to be dismissed by
  // choosing something. Listened for on the group rather than each button, so it
  // works wherever focus has landed inside it — including inside a name field,
  // where the alternative is a person trapped in a text input they opened by
  // accident.
  const closeOnEscape = (keyEvent: React.KeyboardEvent) => {
    if (keyEvent.key === 'Escape') setFace('chip');
  };

  if (face === 'managing') {
    return (
      <div className="flex flex-wrap items-center gap-1.5" onKeyDown={closeOnEscape}>
        <SpeakerManager
          speakers={speakers}
          attributions={attributions}
          onAdd={onAddSpeaker}
          onRename={onRenameSpeaker}
          onRemove={onRemoveSpeaker}
        />
        {/* A way back that is not a keystroke. Escape is the shortcut, not the
            affordance, and this face holds text fields a pointer user reaches
            without ever touching the keyboard. */}
        <Badge asChild variant="ghost" className="text-muted-foreground cursor-pointer">
          <button type="button" onClick={() => setFace('chip')}>
            {t('web.translate.speakerManageDone')}
          </button>
        </Badge>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5" onKeyDown={closeOnEscape}>
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

      {/* Reachable from the turn: the moment anyone notices somebody unlisted is
          speaking is the moment they are looking at that person's turn. It stays
          on this face rather than moving to the manage one because it is the
          only speaker operation wanted before anybody has been named. */}
      <Badge asChild variant="ghost" className="text-muted-foreground cursor-pointer">
        <button type="button" onClick={() => choose(onAddSpeaker)}>
          <UserPlus aria-hidden /> {t('web.translate.speakerAdd')}
        </button>
      </Badge>

      {/* Nothing to rename or remove until somebody exists, so this face is
          offered only once it has content. */}
      {speakers.length > 0 ? (
        <Badge asChild variant="ghost" className="text-muted-foreground cursor-pointer">
          <button type="button" onClick={() => setFace('managing')}>
            {t('web.translate.speakerManage')}
          </button>
        </Badge>
      ) : null}
    </div>
  );
}
