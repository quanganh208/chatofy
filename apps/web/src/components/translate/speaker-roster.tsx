'use client';

import { useState } from 'react';
import { UserPlus, X } from 'lucide-react';
import {
  canRemoveSpeaker,
  MAX_SPEAKERS,
  type AttributionsBySession,
  type SessionSpeaker,
} from '@chatofy/realtime-client';
import { Button } from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';

/**
 * Who is in the conversation.
 *
 * **Not a form to fill in before starting.** Nobody should have to name five
 * people to hear a translation, so this stays out of the way until somebody adds
 * a participant, and people can be added from a turn in the transcript instead
 * of from here. What it adds over the chip's own picker is the two things a
 * picker cannot do: renaming, and removing.
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
 * a person with no name is not a state the roster can render. But a field bound
 * straight to the stored label cannot be typed into: the space in "Quang Anh" is
 * trimmed off on the keystroke that produces it, React restores the field to the
 * stored value, and the next letter lands as "QuangA". Multi-word names were
 * unreachable, and the placeholder this field starts with is one in both
 * languages.
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
  // above, so a new participant gets a new field rather than this one's draft.
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
        // Sized to its content so a roster of five does not become five
        // full-width fields, which is what made this read as a form.
        size={Math.max(draft.length, 4)}
        className="text-hint focus-visible:ring-ring/50 bg-transparent outline-none focus-visible:ring-[3px] focus-visible:ring-offset-1"
      />
    </>
  );
}

interface SpeakerRosterProps {
  speakers: SessionSpeaker[];
  attributions: AttributionsBySession;
  onAdd: () => void;
  onRename: (speakerId: string, label: string) => void;
  onRemove: (speakerId: string) => void;
}

export function SpeakerRoster({
  speakers,
  attributions,
  onAdd,
  onRename,
  onRemove,
}: SpeakerRosterProps) {
  const t = useTranslate();
  const full = speakers.length >= MAX_SPEAKERS;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {speakers.length === 0 ? (
        <p className="text-muted-foreground text-hint">{t('web.translate.speakerRosterHint')}</p>
      ) : null}

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

      <Button variant="ghost" size="sm" onClick={onAdd} disabled={full}>
        <UserPlus aria-hidden />
        {full
          ? t('web.translate.speakerLimit', { max: MAX_SPEAKERS })
          : t('web.translate.speakerAdd')}
      </Button>
    </div>
  );
}
