'use client';

import { useEffect, useRef, useState } from 'react';
import type { SessionLanguageMode, SessionLanguagePair } from '@chatofy/types';
import { Minimize2 } from 'lucide-react';
import { Button } from '@chatofy/ui/react';
import type { UseStreamingTranslate } from '@/hooks/use-streaming-translate';
import { useIdleReveal } from '@/hooks/use-idle-reveal';
import { DisplaySettingsPopover } from '@/components/translate/display-settings-popover';
import { SessionActions, SessionReadouts } from '@/components/translate/session-controls';
import { TranscriptPanes, type StreamProps } from '@/components/translate/transcript-panes';
import { readingSchemeClass } from '@/lib/reading-appearance';
import { effectiveStageAppearance, type TranslateSettings } from '@/lib/translate-settings';
import { useTranslate } from '@/i18n/provider';
import { cn } from '@/lib/utils';

/**
 * The translate screen, fullscreen.
 *
 * ## The page's arrangement, the stage's look
 *
 * The same `TranscriptPanes` the page draws — split or list, side by side or
 * stacked, whichever the reader chose — so going fullscreen shows the screen they
 * were reading, bigger, and not a different one. What changes is the look (the
 * stage profile, set for reading across a room) and that nothing in the panes is
 * a control: the headers name the pair, the speaker names are copies.
 *
 * ## A bar that gets out of the way
 *
 * Everything a reader would otherwise leave fullscreen for: the status, Start or
 * Pause and End, the display gear, and the way out. It is a row of its own at the
 * foot, under the panes. It lay over the pane headers once, so as not to cover
 * the newest line, and then it covered the pair those headers name instead. In a
 * row of its own it covers neither, and since it fades rather than unmounts the
 * row keeps its height, so no line of the transcript moves when it comes or goes.
 * It hides after a few seconds alone and comes back on any pointer move, tap or
 * key, and it does not hide while it is being used: holding keyboard focus, or
 * with the gear's panel open.
 *
 * A pointer resting on it is not a hold. It held once, and the commonest way in
 * — click Start in the bar, then read — left the pointer on the bar, so the bar
 * never hid. A pointer that is still on the bar after three seconds is not using
 * it.
 *
 * The focus hold is for KEYBOARD focus only. A mouse click leaves focus on the
 * button it pressed, and a bar held up by that would never hide for anyone who
 * pressed Start in it.
 *
 * ## Into its own element
 *
 * The gear's panel opens into this stage's root rather than the body: native
 * fullscreen draws the fullscreen element and nothing else, so a panel portalled
 * to the body would open where nobody can see it.
 *
 * ## Accent
 *
 * Start (or Resume) is the one filled control, as on the page — the dock's copy is
 * not rendered while this is up. The gear is outline and the exit ghost.
 */
export function FullscreenStage({
  settings,
  onChange,
  running,
  stream,
  conversationLanguagePair,
  languageMode,
  conversation,
  onStart,
  awaitingContext,
  contextUnready,
  onExit,
}: {
  settings: TranslateSettings;
  onChange: (patch: Partial<TranslateSettings>) => void;
  running: boolean;
  stream: StreamProps;
  /** The pair the turns on screen were translated for — see `TranscriptPanes`. */
  conversationLanguagePair: SessionLanguagePair;
  languageMode: SessionLanguageMode | null;
  conversation: Pick<
    UseStreamingTranslate,
    'status' | 'level' | 'startedAt' | 'pauses' | 'pause' | 'resume' | 'end'
  >;
  onStart: () => void;
  awaitingContext: boolean;
  contextUnready: boolean;
  onExit: () => void;
}) {
  const t = useTranslate();
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const awake = useIdleReveal(root, { hold: settingsOpen || keyboardFocus });
  // The ground the captions are read on, for the bar and the panel too: a light
  // bar over the default black stage was a strip of page left on top of it.
  const scheme = readingSchemeClass(effectiveStageAppearance(settings).appearance);

  // The control that opened fullscreen is outside it now (or under the cover), so
  // focus starts on the way back out. That focus is not the reader using the bar,
  // so it holds nothing: someone who pressed Full screen with Enter gets a
  // `:focus-visible` exit button, and a hold on it kept the bar up for good.
  const exitButton = useRef<HTMLButtonElement>(null);
  const arriving = useRef(true);
  useEffect(() => {
    exitButton.current?.focus();
    arriving.current = false;
  }, []);

  return (
    <div
      ref={setRoot}
      // A hand on the pointer ends a keyboard hold: whoever pressed Esc out of the
      // panel with focus left on the gear is not still using it.
      onPointerMove={() => setKeyboardFocus(false)}
      className={cn(
        'bg-background text-foreground relative flex min-h-0 flex-1 flex-col',
        scheme,
        // Nothing to point at while the bar is down, and a pointer resting over
        // the captions is one more thing in front of them.
        !awake && 'cursor-none',
      )}
    >
      <TranscriptPanes
        stage
        settings={settings}
        running={running}
        stream={stream}
        conversationLanguagePair={conversationLanguagePair}
        languageMode={languageMode}
      />

      <div
        data-stage-bar
        data-awake={awake}
        className={cn(
          'border-hairline flex shrink-0 flex-wrap items-center gap-2 border-t px-3 py-2',
          'transition-opacity duration-200 motion-reduce:transition-none',
          // Faded rather than unmounted: the same buttons stay in the same places,
          // and Tab still reaches them — the key itself wakes the bar.
          awake ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onFocus={(event) => {
          if (!arriving.current) setKeyboardFocus(matchesFocusVisible(event.target));
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setKeyboardFocus(false);
        }}
      >
        {/* A row of its own below `sm`: beside Start, End and two icons, a phone
            leaves the status about seventy pixels and cut its label mid-word. */}
        <SessionReadouts conversation={conversation} className="basis-full sm:flex-1 sm:basis-0" />
        <div className="flex items-center gap-2 max-sm:w-full max-sm:justify-end">
          <SessionActions
            conversation={conversation}
            onStart={onStart}
            awaitingContext={awaitingContext}
            contextUnready={contextUnready}
            compact
          />
          <DisplaySettingsPopover
            settings={settings}
            onChange={onChange}
            container={root}
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
          />
          <Button
            ref={exitButton}
            variant="ghost"
            size="icon"
            aria-label={t('web.translate.fullscreenExit')}
            onClick={onExit}
          >
            <Minimize2 aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}

/** `:focus-visible`, where the engine can answer it — a test DOM may not. */
function matchesFocusVisible(target: EventTarget): boolean {
  if (!(target instanceof Element)) return false;
  try {
    return target.matches(':focus-visible');
  } catch {
    return false;
  }
}
