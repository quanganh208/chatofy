'use client';

import { ArrowLeftRight } from 'lucide-react';
import { Button, LanguageSelect, pairAfterPick } from '@chatofy/ui/react';
import {
  AUTO_DETECT,
  type LanguageCode,
  type SessionLanguageMode,
  type SessionLanguagePair,
} from '@chatofy/types';
import { useTranslate } from '@/i18n/provider';
import { languageNamer } from '@/i18n/language-pair-labels';
import { canAutoDetectInto, representablePair } from '@/lib/translate-settings';
import { cn } from '@/lib/utils';

interface PanelHeadersProps {
  languagePair: SessionLanguagePair;
  /** A conversation is running, so the pair is fixed for its duration. */
  running: boolean;
  onSwap: () => void;
  /** A language picked on one side, as the whole new pair. */
  onLanguagePair: (pair: SessionLanguagePair) => void;
  /**
   * How the server is running the newest turn, or null when no turn has said —
   * see {@link LanguageModeHint}.
   */
  mode?: SessionLanguageMode | null;
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
 * ## The pair stops being a setting
 *
 * It used to live inside the settings popover, which meant the first fact about
 * what is on screen — what language is going in, what language is coming out —
 * was something you had to open something to find. The two panels below have
 * headers; this is what belongs in them.
 *
 * The composition is `LanguagePairPicker` pulled apart to panel width, and the
 * words are that component's own keys: nothing new is invented and nothing is
 * translated twice. The picker itself stays a compact row because one of its
 * consumers is the extension popup, in a 320px window that cannot take an
 * exploded two-panel header — so this is a web-only composition of its
 * `LanguageSelect` rather than an edit to it.
 *
 * ## Two language pickers, and the swap stays
 *
 * While the registry held two languages these were readouts: a picker in either
 * header would have offered one alternative, which is the swap. With three, each
 * header is a real choice, so each is a `LanguageSelect`, and a pick that
 * collides with the other side swaps the pair (`pairAfterPick`, the same rule the
 * popup and `/preferences` use). The swap button stays anyway: reversing the pair
 * between turns is the common action, and it is one press instead of two
 * selects. It is `outline` and the selects are fields, so the screen still spends
 * its one accent on Start.
 *
 * ## The source picker decides the mode
 *
 * Its first entry is "Auto-detect": each turn's language is recognised and
 * translated one way into the target. A named source asks for both ways — the
 * pair as a set, each turn translated into the other side. There is no mode
 * switch; what the server actually ran is a readout beside the source role
 * (`LanguageModeHint`), because the server may answer a two-way start one way.
 *
 * ## Disabled, not hidden, while running
 *
 * The pair rides `client.session.start` and `ConversationSession` holds it for
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
export function PanelHeaders({
  languagePair,
  running,
  onSwap,
  onLanguagePair,
  mode = null,
  voiceControl,
}: PanelHeadersProps) {
  const t = useTranslate();

  return (
    // The same left inset the turns below carry, so a header and the prose it
    // names start at the same x.
    <div className="border-hairline relative border-b px-8">
      <Side
        role={t('web.translate.languagePairSource')}
        hint={<LanguageModeHint mode={mode} />}
        language={
          <HeaderLanguage
            languagePair={languagePair}
            side="source"
            running={running}
            onLanguagePair={onLanguagePair}
          />
        }
        className="border-hairline border-b"
      />
      <Side
        role={t('web.translate.languagePairTarget')}
        language={
          <HeaderLanguage
            languagePair={languagePair}
            side="target"
            running={running}
            onLanguagePair={onLanguagePair}
          />
        }
        end={voiceControl}
      />

      {/* Centred on the pair with a negative margin rather than a translate: the
          reduced-motion guard zeroes `transform`, and a control that moved to the
          corner for a reader who asked for stillness would be a layout bug, not a
          motion one.

          32px tall: 14px icon + 16px padding + 2px border, since `size-auto`
          overrides the shared icon size. Half of that is the offset that actually
          centres it. */}
      <LanguagePairSwap
        languagePair={languagePair}
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
  hint,
}: {
  role: string;
  language: React.ReactNode;
  end?: React.ReactNode;
  /** A readout beside the role — the source side's {@link LanguageModeHint}. */
  hint?: React.ReactNode;
}) {
  return (
    <div className="border-hairline border-b px-8">
      <Side role={role} language={language} end={end} hint={hint} />
    </div>
  );
}

/**
 * Which way the running conversation translates, as the server answered it —
 * a readout, never a control.
 *
 * There is no mode switch: the source picker decides what is ASKED ("detect"
 * runs one way, a named language both ways), and this says what the newest turn
 * actually ran, which can be less — a server that cannot tell the two languages
 * apart right now runs a two-way start one way. Nothing at all before a turn
 * has said: a guess drawn from the pair would claim "both ways" on a server
 * that is about to answer otherwise.
 */
export function LanguageModeHint({ mode }: { mode: SessionLanguageMode | null }) {
  const t = useTranslate();
  if (mode === null) return null;
  return (
    <span className="text-muted-foreground text-label" data-language-mode={mode}>
      {t(mode === 'two-way' ? 'web.translate.modeTwoWay' : 'web.translate.modeOneWay')}
    </span>
  );
}

/**
 * One side's language, as a picker.
 *
 * Disabled while running, for the reason the swap is: the pair rides
 * `client.session.start` and holds for the whole run.
 */
export function HeaderLanguage({
  languagePair,
  side,
  running,
  onLanguagePair,
}: {
  languagePair: SessionLanguagePair;
  side: 'source' | 'target';
  running: boolean;
  onLanguagePair: (pair: SessionLanguagePair) => void;
}) {
  const t = useTranslate();
  const shared = {
    disabled: running,
    nameLanguage: languageNamer(t),
    size: 'sm' as const,
    className: 'font-medium',
  };
  // Through `representablePair`, because a picked TARGET can be the one that
  // rules detection out — the source then becomes a language, visibly, rather
  // than a conversation starting in a mode nothing on screen offered.
  const pick = (pair: SessionLanguagePair) => onLanguagePair(representablePair(pair));

  if (side === 'target') {
    return (
      <LanguageSelect
        {...shared}
        value={languagePair.target}
        onPick={(code) => pick(pairAfterPick(languagePair, 'target', code))}
        label={t('web.translate.languagePairTarget')}
      />
    );
  }
  return (
    <LanguageSelect<SourceChoice>
      {...shared}
      value={languagePair.source}
      onPick={(code) => pick(pairAfterPick(languagePair, 'source', code))}
      label={t('web.translate.languagePairSource')}
      // Offered only where it can be served as Saydi means it — see
      // `canAutoDetectInto`. Hidden rather than disabled: there is no step the
      // reader could take on this screen to make it work.
      detectOption={
        canAutoDetectInto(languagePair.target)
          ? { label: t('web.translate.autoDetect') }
          : undefined
      }
    />
  );
}

type SourceChoice = LanguageCode | typeof AUTO_DETECT;

/**
 * The pair, reversed.
 *
 * Disabled while running: the pair rides `client.session.start` and
 * `ConversationSession` holds it for the whole run, so a swap that stayed live
 * would accept the press, look like it worked, and translate the next turn the
 * old way — nothing thrown and nothing logged.
 */
export function LanguagePairSwap({
  languagePair,
  running,
  onSwap,
  className,
}: {
  languagePair: SessionLanguagePair;
  running: boolean;
  onSwap: () => void;
  className?: string;
}) {
  const t = useTranslate();
  const { source, target } = languagePair;
  const nameLanguage = languageNamer(t);

  return (
    <Button
      variant="outline"
      size="icon"
      // Also dead while the source is "detect": it has no language to trade
      // places with, and a translation cannot be "detect".
      disabled={running || source === AUTO_DETECT}
      onClick={onSwap}
      aria-label={
        source === AUTO_DETECT
          ? t('web.translate.languagePairSwapDetect')
          : t('web.translate.languagePairSwap', {
              from: nameLanguage(target),
              to: nameLanguage(source),
            })
      }
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
  hint,
}: {
  role: string;
  language: React.ReactNode;
  className?: string;
  end?: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className={cn('flex min-h-[58px] items-center gap-2.5 py-2.5', className)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        {/* The role and the hint share one line, so a hint arriving mid-run
            moves nothing below it. Only the role is hidden from assistive tech:
            the picker carries it as its name, the hint is said nowhere else. */}
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span
            aria-hidden
            className="text-muted-foreground text-label font-semibold tracking-wide uppercase"
          >
            {role}
          </span>
          {hint}
        </span>
        {language}
      </div>
      {end ? <div className="ml-auto flex items-center gap-2">{end}</div> : null}
    </div>
  );
}
