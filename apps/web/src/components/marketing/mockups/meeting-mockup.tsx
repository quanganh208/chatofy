import { MessageSquare, User } from 'lucide-react';
import type { Translate } from '@chatofy/i18n';
import { cn } from '@/lib/utils';
import { MockupFrame } from './mockup-parts';

/**
 * A meeting from one participant's seat: three people, each labelled by the language
 * they speak rather than by a name — there are no people here to name — the speaker
 * ringed, their words arriving as a subtitle in the reader's language, and a chat message
 * already translated.
 *
 * The subtitle and the message are the two strings on this page translated per locale
 * inside a picture, because "in your language" is the claim: a Vietnamese reader sees
 * Vietnamese there, a Chinese reader Chinese.
 *
 * The ring is the `speaking` state colour, which is what it means in the product too.
 *
 * The frame grows (`flex-1`) to fill the tall meetings tile, and the video tiles grow
 * with it: the tile's height is set by the two tiles beside it, and copy length differs
 * by locale, so a fixed aspect left a gap above the tile's action in one language or
 * another.
 */
export function MeetingMockup({ t }: { t: Translate }) {
  const people = [
    { language: t('common.languageName.en'), speaking: true },
    { language: t('common.languageName.vi'), speaking: false },
    { language: t('common.languageName.zh'), speaking: false },
  ];

  return (
    <MockupFrame className="flex-1 gap-3 p-3">
      <div className="grid min-h-32 flex-1 grid-cols-3 gap-2">
        {people.map((person) => (
          <div
            key={person.language}
            className={cn(
              'bg-muted relative flex items-center justify-center rounded-lg',
              person.speaking && 'ring-speaking ring-2',
            )}
          >
            <span className="bg-background text-muted-foreground flex size-9 items-center justify-center rounded-full">
              <User className="size-4" />
            </span>
            <span className="bg-background/90 text-label absolute bottom-1 left-1 max-w-[calc(100%-0.5rem)] truncate rounded-md px-1 py-0.5 sm:bottom-1.5 sm:left-1.5 sm:px-1.5 font-medium">
              {person.language}
            </span>
          </div>
        ))}
      </div>
      <p className="bg-foreground text-background text-body rounded-lg px-3 py-2 text-center font-medium">
        {t('web.landing.mockMeetingSubtitle')}
      </p>
      <div className="flex items-start gap-2">
        <span className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-full">
          <MessageSquare className="size-3.5" />
        </span>
        <p className="bg-muted text-body rounded-lg rounded-tl-sm px-3 py-2">
          {t('web.landing.mockMeetingMessage')}
        </p>
      </div>
    </MockupFrame>
  );
}
