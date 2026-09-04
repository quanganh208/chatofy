'use client';

import { ArrowLeftRight, Volume2, VolumeX } from 'lucide-react';
import { Button } from '@chatofy/ui/react';
import { directionLanguages, type TranslationDirection } from '@chatofy/types';
import { useTranslate } from '@/i18n/provider';
import { makeLanguageName } from '@/i18n/direction-labels';
import { cn } from '@/lib/utils';

interface PanelHeadersProps {
  direction: TranslationDirection;
  /** A conversation is running, so the direction is fixed for its duration. */
  running: boolean;
  /** Whether the translation is spoken aloud. */
  voiceOutput: boolean;
  /** Two columns, or one stacked column. Mirrors the transcript below. */
  columns: boolean;
  onSwap: () => void;
  onToggleVoice: () => void;
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
 * ## The speaker is a control, after one round as a mark
 *
 * It shipped as an inert `span` carrying a `title`, on the reasoning that
 * speak-aloud cannot change mid-conversation — it rides `client.session.start`,
 * and the server skips synthesis outright when it is off — so a control here
 * would be dead for the length of every conversation and read as broken.
 *
 * **That reasoning produced something that read as broken all the time.** A
 * speaker icon in the top corner of a panel is a button everywhere else on the
 * internet; owner review was somebody pressing it repeatedly and getting
 * nothing. The state it reported was worth reporting, and it still is — the
 * failure was pretending an unpressable thing was not a button.
 *
 * The disproof was already in this file: the swap sits in the same bar, is a
 * real `Button`, and is `disabled={running}` for exactly the same wire reason.
 * Nobody reads that as broken, because disabled is a state a control is allowed
 * to be in — and an inert element beside a working one is the inconsistency, not
 * the cure for it.
 *
 * So it is a toggle, disabled while running, saying in words both what it
 * controls and whether it is on. The gear keeps its switch: two entry points for
 * a boolean is ordinary, unlike the language pickers rejected above, where the
 * only alternative value was the swap already beside them.
 *
 * The left header has no counterpart because nothing is ever spoken in the
 * source language.
 */
export function PanelHeaders({
  direction,
  running,
  voiceOutput,
  columns,
  onSwap,
  onToggleVoice,
}: PanelHeadersProps) {
  const t = useTranslate();
  const nameLanguage = makeLanguageName(t);
  const { source, target } = directionLanguages(direction);
  const Speaker = voiceOutput ? Volume2 : VolumeX;

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
        end={
          <Button
            variant="outline"
            size="sm"
            disabled={running}
            aria-pressed={voiceOutput}
            onClick={onToggleVoice}
            // Two different sentences, because the two states owe different
            // answers. Running, the question is "why can I not press this",
            // and "set it before you start" is the whole answer.
            title={
              running ? t('web.translate.speakLocked') : t('web.translate.speakTranslationAria')
            }
            className="text-prose hover:text-foreground disabled:hover:text-inherit"
          >
            <Speaker aria-hidden className="size-4" />
            {/* The state is in the visible label, not only in the icon. A
                speaker glyph differing from a crossed-out one by a slash is
                the difference between hearing the translation and not, drawn
                at 16px in the corner of the screen. */}
            {t('web.translate.speakTranslation')}:{' '}
            {t(voiceOutput ? 'web.translate.speakOn' : 'web.translate.speakOff')}
          </Button>
        }
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
