'use client';

import type { ComponentProps } from 'react';
import type { SessionLanguageMode, SessionLanguagePair } from '@chatofy/types';
import { cn } from '@/lib/utils';

import { useTranslate } from '@/i18n/provider';
import { ConversationTranscript } from '@/components/translate/conversation-transcript';
import {
  LanguagePairSwap,
  HeaderLanguage,
  LanguageModeHint,
  PanelHeader,
  PanelHeaders,
} from '@/components/translate/panel-headers';
import { TranscriptScroller } from '@/components/translate/transcript-scroller';
import { textSizeScale, type TranslateSettings } from '@/lib/translate-settings';
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
  onSwap: () => void;
  /** A language picked in a header, as the whole new pair. */
  onLanguagePair: (pair: SessionLanguagePair) => void;
  /**
   * How the server ran the newest turn, for the source header's readout — see
   * `LanguageModeHint`. Null when no turn has said.
   */
  languageMode?: SessionLanguageMode | null;
  /** The voice, for the target header's end slot — see `panel-headers.tsx`. */
  voiceControl: React.ReactNode;
  stream: StreamProps;
  /**
   * Which language the finished turns on screen were actually translated into.
   *
   * NOT `settings.languagePair` re-derived: the language pickers stay live between
   * conversations (it is only disabled while `running`), so swapping it after a
   * conversation ends must not change which key `groupTranslation` reads for
   * turns that were never translated into the new target — see `use-streaming
   * -translate.ts`'s `languagePair`, which is captured once at `start` for exactly
   * this. Defaults to `settings.languagePair` so a caller with no conversation yet
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
 * The swap rides the source header's end slot there. Between two panes it has
 * nowhere to be, and one control about the pair belongs in the header of the side
 * that is being translated FROM.
 *
 * The single-stream arrangements keep the bar: with one region there is no pane
 * for a header to be wrong about.
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
 */
export function TranscriptPanes({
  settings,
  running,
  onSwap,
  onLanguagePair,
  voiceControl,
  stream,
  conversationLanguagePair,
  languageMode = null,
}: TranscriptPanesProps) {
  const t = useTranslate();
  // The pair a FINISHED turn's translation line is chosen from — see the prop
  // doc. Per turn, not one target: a two-way reply reads the other side. Headers
  // above keep reading `settings.languagePair`: which language is going IN or
  // coming OUT is a fact about the upcoming conversation, and only the
  // already-spoken text must stay pinned to what it was captured for.
  const turnPair = conversationLanguagePair ?? settings.languagePair;

  const split = settings.displayMode === 'split' && !settings.translationOnly;
  const column = split && settings.paneLayout === 'column';

  // The one place `--reading-scale` and the reader's appearance are written on
  // the page. Everything under it that carries `text-source` or `text-target`
  // scales together, and the `reading-*` utilities read the rest; see
  // `app/globals.css`. The stage writes its own — `caption-stage.tsx`.
  const scale = readingStyle(settings.appearance, textSizeScale(settings.textSize));
  const scheme = readingSchemeClass(settings.appearance);

  const shared = {
    running,
    speakerLabels: settings.speakerLabels,
    showTime: settings.appearance.showTime,
    ...stream,
  };

  const pane = (side: 'both' | 'source' | 'target', interactive: boolean, label: string) => (
    <TranscriptScroller label={label} freeScroll={settings.freeScroll}>
      <ConversationTranscript
        {...shared}
        side={side}
        interactive={interactive}
        languagePair={turnPair}
      />
    </TranscriptScroller>
  );

  if (split) {
    const source = (
      <div className="flex min-h-0 flex-1 flex-col">
        <PanelHeader
          role={t('web.translate.languagePairSource')}
          hint={<LanguageModeHint mode={languageMode} />}
          language={
            <HeaderLanguage
              languagePair={settings.languagePair}
              side="source"
              running={running}
              onLanguagePair={onLanguagePair}
            />
          }
          end={
            <LanguagePairSwap
              languagePair={settings.languagePair}
              running={running}
              onSwap={onSwap}
            />
          }
        />
        {pane('source', true, t('web.translate.paneSource'))}
      </div>
    );
    const target = (
      <div className="flex min-h-0 flex-1 flex-col">
        <PanelHeader
          role={t('web.translate.languagePairTarget')}
          language={
            <HeaderLanguage
              languagePair={settings.languagePair}
              side="target"
              running={running}
              onLanguagePair={onLanguagePair}
            />
          }
          end={voiceControl}
        />
        {pane('target', false, t('web.translate.paneTarget'))}
      </div>
    );

    return (
      <div
        className={cn(
          'reading-frame relative flex min-h-0 flex-1',
          scheme,
          // One column below `sm` and two above it for `row`, in CSS rather than
          // in JavaScript: a `matchMedia` fork would render one thing on the
          // server and another on the client, which is a hydration mismatch and a
          // visible flicker. Two prose columns do not fit a phone.
          column ? 'flex-col' : 'flex-col sm:flex-row',
        )}
        style={scale}
      >
        {/* The divider, only where there is a seam to mark: side by side, on a
            viewport wide enough to actually be side by side. Stacked panes are
            separated by their own headers' rules. */}
        {column ? null : (
          <div
            aria-hidden
            className="bg-hairline absolute inset-y-0 left-1/2 hidden w-px sm:block"
          />
        )}
        {source}
        {target}
      </div>
    );
  }

  return (
    <div className={cn('reading-frame flex min-h-0 flex-1 flex-col', scheme)} style={scale}>
      <PanelHeaders
        languagePair={settings.languagePair}
        running={running}
        onSwap={onSwap}
        onLanguagePair={onLanguagePair}
        mode={languageMode}
        voiceControl={voiceControl}
      />
      {settings.translationOnly
        ? pane('target', true, t('web.translate.paneTarget'))
        : pane('both', true, t('common.transcript'))}
    </div>
  );
}
