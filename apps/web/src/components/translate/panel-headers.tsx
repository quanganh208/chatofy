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
 *
 * ## One stacked pair, never two columns
 *
 * This drew its two sides side by side above `sm` for a release. Side-by-side
 * headers belong over side-by-side PANES, and the arrangement that has those —
 * `split` — gives each pane its own `PanelHeader` instead, for the reason
 * `transcript-panes.tsx` records. What is left here sits over ONE stream, so a
 * two-column bar would name two things where there is one column of prose.
 */
export function PanelHeaders({ direction, running, onSwap, voiceControl }: PanelHeadersProps) {
  const t = useTranslate();
  const nameLanguage = makeLanguageName(t);
  const { source, target } = directionLanguages(direction);

  return (
    // The same left inset the turns below carry, so a header and the prose it
    // names start at the same x.
    <div className="border-hairline relative border-b px-8">
      <Side
        role={t('web.translate.directionSource')}
        language={nameLanguage(source)}
        className="border-hairline border-b"
      />
      <Side
        role={t('web.translate.directionTarget')}
        language={nameLanguage(target)}
        end={voiceControl}
      />

      {/* Centred on the pair with a negative margin rather than a translate: the
          reduced-motion guard zeroes `transform`, and a control that moved to the
          corner for a reader who asked for stillness would be a layout bug, not a
          motion one.

          32px tall: 14px icon + 16px padding + 2px border, since `size-auto`
          overrides the shared icon size. Half of that is the offset that actually
          centres it. */}
      <DirectionSwap
        direction={direction}
        running={running}
        onSwap={onSwap}
        className="absolute top-1/2 right-3 z-[2] -mt-4"
      />
    </div>
  );
}

/**
 * One side's header, for the arrangement where the two are not adjacent.
 *
 * `split` + `column` puts the source pane above the translation pane, so a bar
 * naming both at the top of the screen would sit above one of them and describe
 * the other. Each pane gets its own instead, which is the same `Side` the pair
 * uses — the words, the sizes and the slot are shared, so the two arrangements
 * cannot drift into naming the languages differently.
 *
 * The swap has no natural home between two stacked panes, so it rides the source
 * header's own end slot there. It is one control about the pair either way.
 */
export function PanelHeader({
  role,
  language,
  end,
}: {
  role: string;
  language: string;
  end?: React.ReactNode;
}) {
  return (
    <div className="border-hairline border-b px-8">
      <Side role={role} language={language} end={end} />
    </div>
  );
}

/**
 * The direction, reversed.
 *
 * Disabled while running: direction rides `client.session.start` and
 * `ConversationSession` holds it for the whole run, so a swap that stayed live
 * would accept the press, look like it worked, and translate the next turn the
 * old way — nothing thrown and nothing logged.
 */
export function DirectionSwap({
  direction,
  running,
  onSwap,
  className,
}: {
  direction: TranslationDirection;
  running: boolean;
  onSwap: () => void;
  className?: string;
}) {
  const t = useTranslate();
  const nameLanguage = makeLanguageName(t);
  const { source, target } = directionLanguages(direction);

  return (
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
        'size-auto rounded-full p-2',
        className,
      )}
    >
      <ArrowLeftRight aria-hidden className="size-3.5" />
    </Button>
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
