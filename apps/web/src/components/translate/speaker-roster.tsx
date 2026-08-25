'use client';

import { UserPlus, X } from 'lucide-react';
import {
  canRemoveSpeaker,
  MAX_SPEAKERS,
  type AttributionsBySession,
  type SessionSpeaker,
} from '@chatofy/realtime-client';
import { Button } from '@chatofy/ui/react';

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
  const full = speakers.length >= MAX_SPEAKERS;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {speakers.length === 0 ? (
        <p className="text-muted-foreground text-hint">
          Add the people talking and each turn can be marked with who said it.
        </p>
      ) : null}

      {speakers.map((speaker) => {
        const removable = canRemoveSpeaker(attributions, speaker.id);
        return (
          <div
            key={speaker.id}
            className="border-hairline flex items-center gap-1 rounded-full border py-0.5 pr-1 pl-3"
          >
            <label className="sr-only" htmlFor={`speaker-${speaker.id}`}>
              Name for {speaker.label}
            </label>
            <input
              id={`speaker-${speaker.id}`}
              value={speaker.label}
              onChange={(changeEvent) => onRename(speaker.id, changeEvent.target.value)}
              // Sized to its content so a roster of five does not become five
              // full-width fields, which is what made this read as a form.
              size={Math.max(speaker.label.length, 4)}
              className="text-hint focus-visible:ring-ring/50 bg-transparent outline-none focus-visible:ring-[3px] focus-visible:ring-offset-1"
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              disabled={!removable}
              onClick={() => onRemove(speaker.id)}
              title={
                removable
                  ? `Remove ${speaker.label}`
                  : `${speaker.label} is named on a turn. Change that turn first.`
              }
              aria-label={
                removable
                  ? `Remove ${speaker.label}`
                  : `Cannot remove ${speaker.label}: they are named on a turn`
              }
            >
              <X aria-hidden />
            </Button>
          </div>
        );
      })}

      <Button variant="ghost" size="sm" onClick={onAdd} disabled={full}>
        <UserPlus aria-hidden />
        {full ? `Limit is ${MAX_SPEAKERS} people` : 'Add a person'}
      </Button>
    </div>
  );
}
