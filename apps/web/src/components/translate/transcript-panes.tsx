'use client';

import { useCallback, useLayoutEffect, useRef, type ComponentProps } from 'react';
import type { LanguageCode, SessionLanguageMode, SessionLanguagePair } from '@chatofy/types';
import { cn } from '@/lib/utils';

import { useTranslate } from '@/i18n/provider';
import { ConversationTranscript } from '@/components/translate/conversation-transcript';
import {
  LanguagePairSwap,
  HeaderLanguage,
  LanguageModeHint,
  PanelHeader,
  PanelHeaders,
  TranslateTopbarControls,
  sourceVoiceControl,
  SourceHeaderLanguage,
} from '@/components/translate/panel-headers';
import { TranscriptScroller } from '@/components/translate/transcript-scroller';
import {
  captureShuffle,
  playShuffle,
  type ShuffleSnapshot,
} from '@/components/translate/language-shuffle';
import {
  effectiveStageAppearance,
  pairFor,
  textSizeScale,
  type ConversationMode,
  type TranslateSettings,
} from '@/lib/translate-settings';
import { readingSchemeClass, readingStyle } from '@/lib/reading-appearance';

/**
 * Everything a stream needs except which half of a turn it is showing, and
 * `languagePair` — this file already holds the conversation's pair for its own
 * pane headers, so a caller has no second one to supply.
 */
export type StreamProps = Omit<
  ComponentProps<typeof ConversationTranscript>,
  'side' | 'speakerLabels' | 'interactive' | 'running' | 'languagePair'
>;

interface TranscriptPanesProps {
  settings: TranslateSettings;
  running: boolean;
  /**
   * The fullscreen stage: the stage's look instead of the page's, every header a
   * readout, every speaker name a copy. The arrangement is the page's either way
   * — fullscreen is this screen bigger, not a different one.
   */
  stage?: boolean;
  /** Not offered on the stage — see `stage`. */
  onSwap?: () => void;
  /** A language picked in a header, as the whole new pair. Not offered on the stage. */
  onLanguagePair?: (pair: SessionLanguagePair) => void;
  /** Which page this is — `/translate/one-way` or `/translate/two-way`. Picks the pair the headers show. */
  conversationMode: ConversationMode;
  /**
   * How the server ran the newest turn, for the source header's readout — see
   * `LanguageModeHint`. Null when no turn has said.
   */
  languageMode?: SessionLanguageMode | null;
  /** A language's voice control, for its header's end slot — see `panel-headers.tsx`. */
  voiceControlFor?: (language: LanguageCode) => React.ReactNode;
  stream: StreamProps;
  /**
   * Which language the finished turns on screen were actually translated into.
   *
   * NOT the page's stored pair re-derived: the language pickers stay live between
   * conversations (it is only disabled while `running`), so swapping it after a
   * conversation ends must not change which key `groupTranslation` reads for
   * turns that were never translated into the new target — see `use-streaming
   * -translate.ts`'s `languagePair`, which is captured once at `start` for exactly
   * this. Defaults to the page's stored pair so a caller with no conversation yet
   * (nothing captured, nothing to show) still gets the ordinary pane.
   */
  conversationLanguagePair?: SessionLanguagePair;
}

/**
 * The conversation, arranged the way the reader asked for it.
 *
 * ## Three arrangements, two of them panes
 *
 * `list` is one stream holding both halves of every turn, one scroll region, one
 * chip per turn. `split` is two streams, one per side, and `paneLayout` decides
 * whether they sit beside each other or above one another.
 *
 * **Split means two scroll regions, and that reverses a decision this file's
 * predecessor recorded.** `cascade-panel.tsx` argued for one region on the
 * grounds that a source and its translation are a PAIR, and two scrollers let the
 * halves of one sentence drift apart. That is still true and it is still the cost.
 * What makes it affordable: while a conversation runs both panes are pinned to the
 * newest turn, so drift has nowhere to accumulate — it is a read-back problem, not
 * a live one — and `list` is still there for reading back. The owner chose the
 * trade with both in front of them.
 *
 * ## Where the bounded height comes from
 *
 * Not from here. `cascade-panel.tsx` caps the section against the viewport, and
 * everything below divides that one resolved maximum: this root fills it, each
 * scroller takes `min-h-0 flex-1` inside it, and in `column` the two panes split
 * it between them. A `flex-1` chain with no maximum anywhere above it does not
 * bound anything — `min-h-svh` on the shell is indefinite — and the failure is
 * silent, so the cap must stay a MAXIMUM and must stay above every one of these.
 *
 * ## Every pane carries its own header
 *
 * Not a bar naming both languages above them, which is what `split` had and what
 * it got wrong: below `sm` the two panes stack, and so did that bar's two halves —
 * so the reader saw SOURCE, then TRANSLATION, then a pane of source text under
 * the word "Translation", for that pane's whole height. Stacked panes were
 * already exempted from the bar for exactly this reason; the narrow case is the
 * same fault at a different breakpoint, so the exemption is now the rule for both
 * orientations rather than a special case for one.
 *
 * ## The pair is a page action in a 48rem column
 *
 * In a main column 48rem or wider the pickers, the swap and the voices sit in the topbar
 * (`TranslateTopbarControls`), and every header here is a quiet label naming its
 * side. Until the main column is 48rem wide the topbar has no room, so each pane keeps its picker and
 * the swap sits on the seam between them. Both copies are rendered and CSS picks
 * one, so the server and the client agree on the markup.
 *
 * The single-stream arrangements keep one header for the pair: with one region
 * there is no pane for a header to be wrong about.
 *
 * ## `translationOnly` collapses the arrangement
 *
 * With one side on screen there is nothing to split and nothing to orient, so this
 * renders a single stream regardless of `displayMode` — and the panel drops both
 * controls rather than leaving two that do nothing. The pair header stays: which
 * language is going IN is still a fact about what is being read, even when the
 * source line is not shown.
 *
 * ## Which chip is the control
 *
 * Exactly one stream may be interactive, or two controls write one piece of state
 * with nothing telling the reader they are the same control. It is whichever
 * stream is primary: the merged one in `list`, the source pane in `split`, and in
 * `translationOnly` the translation — there, it is the only stream there is.
 *
 * None of them on the stage. It is read across a room and changes nothing, so a
 * chip there would be a second control for the attribution with nothing saying
 * so — the reason `caption-stage.tsx` gives for the caption window.
 */
export function TranscriptPanes({
  settings,
  running,
  stage = false,
  onSwap,
  onLanguagePair,
  conversationMode,
  voiceControlFor,
  stream,
  conversationLanguagePair,
  languageMode = null,
}: TranscriptPanesProps) {
  const t = useTranslate();
  // The pair a FINISHED turn's translation line is chosen from — see the prop
  // doc. Per turn, not one target: a two-way reply reads the other side. Headers
  // above keep reading the page's stored pair: which language is going IN or
  // coming OUT is a fact about the upcoming conversation, and only the
  // already-spoken text must stay pinned to what it was captured for.
  const languagePair = pairFor(settings, conversationMode);
  const turnPair = conversationLanguagePair ?? languagePair;

  // The swap, animated as two cards trading places — see `language-shuffle.ts`.
  // Measured on the click, before the pair changes, and played in the layout effect
  // after it has, so the first painted frame already shows each card where it was.
  const frame = useRef<HTMLDivElement>(null);
  const shuffle = useRef<ShuffleSnapshot | null>(null);
  const shuffleThenSwap = useCallback(() => {
    shuffle.current = captureShuffle(frame.current);
    onSwap?.();
  }, [onSwap]);
  useLayoutEffect(() => {
    if (!shuffle.current) return;
    playShuffle(frame.current, shuffle.current);
    shuffle.current = null;
  }, [languagePair.source, languagePair.target]);

  const split = settings.displayMode === 'split' && !settings.translationOnly;
  const column = split && settings.paneLayout === 'column';

  // The one place `--reading-scale` and the reader's appearance are written on
  // the page. Everything under it that carries `text-source` or `text-target`
  // scales together, and the `reading-*` utilities read the rest; see
  // `app/globals.css`. On the stage it is the stage's look instead, which the
  // caption window also draws with — `caption-stage.tsx`.
  const { appearance, textSize } = stage
    ? effectiveStageAppearance(settings)
    : { appearance: settings.appearance, textSize: settings.textSize };
  const scale = readingStyle(appearance, textSizeScale(textSize));
  const scheme = readingSchemeClass(appearance);

  const shared = {
    running,
    speakerLabels: settings.speakerLabels,
    showTime: appearance.showTime,
    ...stream,
  };

  const pane = (side: 'both' | 'source' | 'target', primary: boolean, label: string) => (
    <TranscriptScroller label={label} freeScroll={settings.freeScroll}>
      <ConversationTranscript
        {...shared}
        side={side}
        interactive={primary && !stage}
        languagePair={turnPair}
      />
    </TranscriptScroller>
  );

  // The pickers, the swap and the voices move to the topbar once the main column is 48rem wide; the panes
  // keep their own copy for the phone, where the topbar has no room. Never on the
  // stage, which changes nothing.
  const topbar =
    !stage && onLanguagePair ? (
      <TranslateTopbarControls
        languagePair={languagePair}
        running={running}
        onSwap={onSwap ? shuffleThenSwap : undefined}
        onLanguagePair={onLanguagePair}
        conversationMode={conversationMode}
        voiceControlFor={voiceControlFor}
      />
    ) : null;
  const controls = !stage && onLanguagePair;

  if (split) {
    // Two flat regions on the page ground, split by one hairline: vertical side by
    // side, horizontal stacked. No sheet, no radius, no shadow — the screen IS the
    // conversation, not an object on it. A reader who picked their own background
    // keeps it on both (`--reading-bg`, set by `readingStyle` on the frame below).
    //
    // The ground is still painted, as the page's own colour: the swap flies the two
    // regions through each other (`language-shuffle.ts`), and a transparent region
    // would show the other's words through its own while they cross.
    //
    // `data-shuffle-card` names the language each region holds, so a swap can fly
    // them into each other's places.
    const region = 'reading-frame relative flex min-h-0 flex-1 flex-col overflow-hidden';
    const ground = { backgroundColor: 'var(--reading-bg, var(--background))' };
    const source = (
      <div data-shuffle-card={languagePair.source} className={region} style={ground}>
        <PanelHeader
          role={t('web.translate.languagePairSource')}
          languagePair={languagePair}
          side="source"
          hint={<LanguageModeHint mode={languageMode} />}
          controls={
            controls
              ? {
                  language: (
                    <SourceHeaderLanguage
                      languagePair={languagePair}
                      running={running}
                      onLanguagePair={onLanguagePair}
                      conversationMode={conversationMode}
                    />
                  ),
                  end: sourceVoiceControl(languagePair, conversationMode, voiceControlFor),
                }
              : undefined
          }
        />
        {pane('source', true, t('web.translate.paneSource'))}
      </div>
    );
    const target = (
      <div
        data-shuffle-card={languagePair.target}
        // The one divider: on the second region, so it reads as the seam between them.
        className={cn(
          region,
          'border-hairline border-t',
          column ? undefined : '@xl:border-t-0 @xl:border-l',
        )}
        style={ground}
      >
        <PanelHeader
          role={t('web.translate.languagePairTarget')}
          languagePair={languagePair}
          side="target"
          controls={
            controls
              ? {
                  language: (
                    <HeaderLanguage
                      languagePair={languagePair}
                      side="target"
                      running={running}
                      onLanguagePair={onLanguagePair}
                      conversationMode={conversationMode}
                    />
                  ),
                  end: voiceControlFor?.(languagePair.target),
                }
              : undefined
          }
        />
        {pane('target', false, t('web.translate.paneTarget'))}
      </div>
    );

    return (
      // The query container for the row: whether two regions fit side by side is a
      // fact about the room this column has, not about the viewport. An open
      // sidebar at 768px leaves the column ~512px — past `sm`, but two-way
      // headers need ~546px side by side, and the page scrolled sideways.
      <div className="@container flex min-h-0 flex-1 flex-col">
        {topbar}
        <div
          ref={frame}
          className={cn(
            'relative flex min-h-0 flex-1',
            scheme,
            // One column below a 36rem container and two above it for `row`, in CSS
            // rather than in JavaScript: a `ResizeObserver` fork would render one
            // thing on the server and another on the client, which is a hydration
            // mismatch and a visible flicker. Two prose columns do not fit a phone.
            column ? 'flex-col' : 'flex-col @xl:flex-row',
          )}
          style={scale}
        >
          {/* The swap on the seam, while the main column is under 48rem — wider, it is in the topbar.
            Side by side it points across, stacked it points up and down. Above both
            regions while they cross (`z-20` over their 11 and 12). */}
          {onSwap && controls ? (
            <div className="absolute top-1/2 left-1/2 z-20 -translate-x-1/2 -translate-y-1/2 @3xl/main:hidden">
              <LanguagePairSwap
                languagePair={languagePair}
                running={running}
                onSwap={shuffleThenSwap}
                className="bg-background hover:bg-muted size-11 p-0"
                iconClassName={cn('size-5', column ? 'rotate-90' : '@max-xl:rotate-90')}
              />
            </div>
          ) : null}
          {source}
          {target}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={frame}
      className={cn('reading-frame flex min-h-0 flex-1 flex-col overflow-hidden', scheme)}
      style={scale}
    >
      {topbar}
      <PanelHeaders
        languagePair={languagePair}
        running={running}
        onSwap={onSwap ? shuffleThenSwap : undefined}
        onLanguagePair={stage ? undefined : onLanguagePair}
        conversationMode={conversationMode}
        mode={languageMode}
        voiceControlFor={voiceControlFor}
      />
      {settings.translationOnly
        ? pane('target', true, t('web.translate.paneTarget'))
        : pane('both', true, t('common.transcript'))}
    </div>
  );
}
