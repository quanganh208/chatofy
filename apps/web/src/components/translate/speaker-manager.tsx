'use client';

import { useState } from 'react';
import { UserPlus, X } from 'lucide-react';
import {
  canRemoveSpeaker,
  MAX_SPEAKERS,
  type AttributionsBySession,
  type SessionSpeaker,
} from '@chatofy/realtime-client';
import { HISTORY_LIMITS } from '@chatofy/types';
import { Button } from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';

/**
 * Renaming and removing the people in a conversation.
 *
 * **This used to be a permanent row under the transcript**, and the row is what
 * it cost: a block of chrome on screen for the whole conversation — including
 * when nobody had been added and it held only a hint — in exchange for the two
 * operations a picker cannot do. Everything else it offered, the speaker chip on
 * a turn already did. So this is now the chip's second face, reached from the
 * picker, and the transcript gets the height back.
 *
 * The trade taken knowingly: rename and remove are one level deeper, and they
 * need a finished turn on screen to reach. That is the state they are wanted in
 * — a name is worth fixing once you can see it labelling something — and adding
 * a person, the one thing wanted before any turn exists, stays on the picker's
 * first face.
 *
 * **Names live for one conversation.** They are gone when the panel unmounts,
 * along with the transcript they labelled. That is the feature rather than a gap
 * — the design is allowed to attribute turns at all because it never remembers a
 * voice — so nothing here should grow a way to persist them.
 *
 * **Removal is refused while a turn still names somebody**, and the button says
 * so rather than disappearing. The alternative would be dropping their turns
 * back to unattributed, which leaves the transcript claiming nobody said things
 * somebody said. The way out is to say who did speak, or that nobody named did,
 * from the turn itself.
 */

/**
 * The name field, holding what is being typed rather than what has been stored.
 *
 * The reducer refuses a blank label and stores the trimmed one, which is right —
 * a person with no name is not a state the transcript can render. But a field
 * bound straight to the stored label cannot be typed into: the space in "Quang
 * Anh" is trimmed off on the keystroke that produces it, React restores the
 * field to the stored value, and the next letter lands as "QuangA". Multi-word
 * names were unreachable, and the placeholder this field starts with is one in
 * both languages.
 *
 * So the draft lives here for as long as somebody is typing, and the reducer
 * still sees only labels it would accept. A blank field is left alone while it
 * is being edited and snaps back to the stored name on blur, because the stored
 * name is what the transcript is already showing.
 */
function SpeakerNameField({
  speaker,
  onRename,
}: {
  speaker: SessionSpeaker;
  onRename: (speakerId: string, label: string) => void;
}) {
  const t = useTranslate();
  // Seeded once and never re-synced from the stored label. An effect that
  // followed `speaker.label` would undo the fix it looks like it completes:
  // typing a space stores the trimmed name, the stored name changes, and the
  // effect puts the field back to it — the same lost keystroke by a longer
  // route. Nothing else renames a speaker, and the row is keyed by `speaker.id`
  // below, so a new participant gets a new field rather than this one's draft.
  const [draft, setDraft] = useState(speaker.label);

  return (
    <>
      <label className="sr-only" htmlFor={`speaker-${speaker.id}`}>
        {t('web.translate.speakerNameFor', { name: speaker.label })}
      </label>
      <input
        id={`speaker-${speaker.id}`}
        value={draft}
        onChange={(changeEvent) => {
          setDraft(changeEvent.target.value);
          onRename(speaker.id, changeEvent.target.value);
        }}
        onBlur={() => setDraft(speaker.label)}
        // The same ceiling the save enforces. Past it the whole conversation
        // fails to store with a 400, which is terminal — so an unbounded field
        // could cost the transcript for a name nobody could see was too long.
        maxLength={HISTORY_LIMITS.MAX_SPEAKER_LABEL_CHARS}
        // Sized to its content so five people do not become five full-width
        // fields, which is what made this read as a form.
        size={Math.max(draft.length, 4)}
        className="text-hint focus-visible:ring-ring/50 bg-transparent outline-none focus-visible:ring-[3px] focus-visible:ring-offset-1"
      />
    </>
  );
}

interface SpeakerManagerProps {
  speakers: SessionSpeaker[];
  attributions: AttributionsBySession;
  onAdd: () => void;
  onRename: (speakerId: string, label: string) => void;
  onRemove: (speakerId: string) => void;
}

export function SpeakerManager({
  speakers,
  attributions,
  onAdd,
  onRename,
  onRemove,
}: SpeakerManagerProps) {
  const t = useTranslate();
  const full = speakers.length >= MAX_SPEAKERS;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {speakers.map((speaker) => {
        const removable = canRemoveSpeaker(attributions, speaker.id);
        return (
          <div
            key={speaker.id}
            className="border-hairline flex items-center gap-1 rounded-full border py-0.5 pr-1 pl-3"
          >
            <SpeakerNameField speaker={speaker} onRename={onRename} />
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              disabled={!removable}
              onClick={() => onRemove(speaker.id)}
              title={
                removable
                  ? t('web.translate.speakerRemove', { name: speaker.label })
                  : t('web.translate.speakerRemoveBlocked', { name: speaker.label })
              }
              aria-label={
                removable
                  ? t('web.translate.speakerRemove', { name: speaker.label })
                  : t('web.translate.speakerRemoveBlockedAria', { name: speaker.label })
              }
            >
              <X aria-hidden />
            </Button>
          </div>
        );
      })}

      {/* Called with no arguments, deliberately. `onAdd` reaches a handler whose
          optional first parameter is the new person's name, and handing the
          click straight to it passes React's MouseEvent as that name — which
          the reducer then tries to trim, throwing into the error boundary.
          TypeScript allows the wiring, so the parens are the only guard. */}
      <Button variant="ghost" size="sm" onClick={() => onAdd()} disabled={full}>
        <UserPlus aria-hidden />
        {full
          ? t('web.translate.speakerLimit', { max: MAX_SPEAKERS })
          : t('web.translate.speakerAdd')}
      </Button>
    </div>
  );
}
