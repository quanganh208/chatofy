'use client';

import { ArrowLeftRight } from 'lucide-react';
import { Button } from '@chatofy/ui/react';
import { directionLanguages, type TranslationDirection } from '@chatofy/types';
import { useTranslate } from '@/i18n/provider';
import { makeLanguageName } from '@/i18n/direction-labels';
import { cn } from '@/lib/utils';

interface PanelHeadersProps {
  direction: TranslationDirection;
  /** A conversation is running, so the direction is fixed for its duration. */
  running: boolean;
  /** Two columns, or one stacked column. Mirrors the transcript below. */
  columns: boolean;
  onSwap: () => void;
  /**
   * The voice control, rendered at the end of the target header.
   *
   * A slot rather than props, so this component stays about the two languages and
   * the swap between them. What goes in it reads and writes the whole settings
   * object, which is the page's to own — see `translate/page.tsx`.
   */
  voiceControl: React.ReactNode;
}

/**
 * Which way this is translating, said permanently at the top of the two panels.
 *
 * ## Direction stops being a setting
 *
 * It used to live inside the settings popover, which meant the first fact about
 * what is on screen — what language is going in, what language is coming out —
 * was something you had to open something to find. The two panels below have
 * headers; this is what belongs in them.
 *
 * The composition is `DirectionToggle` pulled apart to panel width, and the words
 * are that component's own keys: nothing new is invented and nothing is
 * translated twice. **`DirectionToggle` itself is untouched.** It is a shared
 * package component and one of its consumers is the extension popup, rendering
 * in a 320px window that cannot take an exploded two-panel header — so this is a
 * new web-only component beside it rather than an edit to it.
 *
 * ## Two language readouts, one swap
 *
 * The languages are text, not pickers. There are exactly two — `vi` and `en` are
 * the whole enum — so a picker in either header would offer one alternative,
 * which is the swap; three entry points for one state change, on a screen whose
 * job is to be unambiguous. If a third language ever arrives these become
 * pickers and the swap goes.
 *
 * ## Disabled, not hidden, while running
 *
 * Direction rides `client.session.start` and `ConversationSession` holds it for
 * the whole run, so a swap that stayed live would accept the press, look like it
 * worked, and translate the next turn the old way. It is disabled instead of
 * removed because "this is translating Vietnamese into English" is exactly what a
 * reader still wants to see mid-sentence.
 *
 * ## The end of the target header is a slot
 *
 * What sits there is the voice — see `voice-settings-popover.tsx`, which records
 * the three shapes it took and why only the last one is right. This component
 * holds none of that: it takes a node, so it stays about the two languages and
 * the swap, and nothing here has to know that the settings object exists.
 *
 * The left header has no counterpart because nothing is ever spoken in the
 * source language.
 */
export function PanelHeaders({
  direction,
  running,
  columns,
  onSwap,
  voiceControl,
}: PanelHeadersProps) {
  const t = useTranslate();
  const nameLanguage = makeLanguageName(t);
  const { source, target } = directionLanguages(direction);

  return (
    <div
      // The SAME grid the turns below use, so a header and the column it names
      // start at the same x. Its gap is wider only because the swap button lives
      // in it: 48px against the turns' 24px, both centred on the half, so the
      // divider lands in the middle of both.
      className={cn(
        'border-hairline relative grid border-b px-8',
        columns ? 'grid-cols-1 gap-x-12 sm:grid-cols-2' : 'grid-cols-1',
      )}
    >
      <Side
        role={t('web.translate.directionSource')}
        language={nameLanguage(source)}
        className={cn(
          columns ? 'border-hairline border-b sm:border-b-0' : 'border-hairline border-b',
        )}
      />
      <Side
        role={t('web.translate.directionTarget')}
        language={nameLanguage(target)}
        end={voiceControl}
      />

      {/* Centred with a negative margin rather than a translate: the reduced-motion
          guard zeroes `transform`, and a control that moved to the corner for a
          reader who asked for stillness would be a layout bug, not a motion one. */}
      <Button
        variant="outline"
        size="icon"
        disabled={running}
        onClick={onSwap}
        aria-label={t('web.translate.directionSwap', {
          from: nameLanguage(target),
          to: nameLanguage(source),
        })}
        className={cn(
          'text-prose hover:text-foreground disabled:hover:text-inherit',
          'absolute z-[2] size-auto rounded-full p-2',
          // 32px tall: 14px icon + 16px padding + 2px border, since `size-auto`
          // overrides the shared icon size. Half of that is the offset that
          // actually centres it.
          columns
            ? 'top-1/2 right-3 -mt-4 sm:right-auto sm:left-1/2 sm:-ml-4'
            : 'top-1/2 right-3 -mt-4',
        )}
      >
        <ArrowLeftRight aria-hidden className="size-3.5" />
      </Button>
    </div>
  );
}

function Side({
  role,
  language,
  className,
  end,
}: {
  role: string;
  language: string;
  className?: string;
  end?: React.ReactNode;
}) {
  return (
    <div className={cn('flex min-h-[58px] items-center gap-2.5 py-2.5', className)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-muted-foreground text-label font-semibold tracking-wide uppercase">
          {role}
        </span>
        <span className="text-body truncate font-medium">{language}</span>
      </div>
      {end ? <div className="ml-auto flex items-center gap-2">{end}</div> : null}
    </div>
  );
}
