'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { useStreamingTranslate } from '@/hooks/use-streaming-translate';
import { useMinutes } from '@/hooks/use-minutes';
import { useConversationSave } from '@/hooks/use-conversation-save';
import { TranscriptPanes } from '@/components/translate/transcript-panes';
import { MinutesPanel } from '@/components/translate/minutes-panel';
import { DisplaySettingsPopover } from '@/components/translate/display-settings-popover';
import { VoiceSettingsPopover } from '@/components/translate/voice-settings-popover';
import { ReadinessBanner } from '@/components/translate/readiness-banner';
import { MicMeter } from '@/components/translate/mic-meter';
import { Button } from '@chatofy/ui/react';
import { Alert, AlertDescription } from '@chatofy/ui/react';
import { StatusIndicator, type StatusTone } from '@chatofy/ui/react';
import { directionLanguages } from '@chatofy/types';
import { toConversationTurns } from '@chatofy/realtime-client';
import type { TranslateSettings } from '@/lib/translate-settings';
import { useLocale, useTranslate } from '@/i18n/provider';

/**
 * Hands-free conversation over the STT → translate → TTS cascade.
 *
 * There is no stop button by design: the turn ends when the speaker stops
 * talking. Pressing one costs half a second of human reaction time, which was
 * the single largest term in the measured latency of the earlier turn-based
 * page. That page and the continuous-mode experiment beside it were the two
 * unlinked lab routes under `/translate`, and both are gone: the REST path they
 * drove is still `POST /translate` in the API, which is where the thesis
 * comparison is measured.
 *
 * A component rather than a page body, and its hook is only alive while it is
 * mounted — unmounting releases the microphone and the socket through the hook's
 * own cleanup, so there is no teardown to arrange from outside.
 *
 * ## The shape of the screen
 *
 * Two panels with two headers naming the two languages, one scrolling body under
 * both, and a dock along the bottom: status and level at one end, the single
 * action in the middle, the display gear at the other.
 *
 * **Settings are split by what they are about, not by what they cost.** The voice
 * opens from the target panel's own header, because that corner is where a reader
 * asks why they are or are not hearing anything; the gear keeps the page. They
 * were one popover, which meant the speaker mark in the header configured nothing
 * and the gear configured sound — see `voice-settings-popover.tsx`.
 *
 * **Two headers, one scroll region.** The obvious version of a two-panel
 * translator gives each panel its own scroller, which is what the product the
 * owner brought does. It cannot work here: the source and its translation are a
 * PAIR, and two scrollers let the halves of one sentence drift apart. So the
 * headers are fixed, the body scrolls once, and a turn's two cells are two cells
 * of one row.
 *
 * **The pair fills the screen, rather than sitting in a 416px box on it.** One
 * scroll region was never what made it small; a fixed cap was. It is now bounded
 * against the viewport instead — `transcript-scroller.tsx` records why the bound
 * has to be a maximum, and why `flex-1` under the shell's `min-h-svh` cannot
 * supply one on its own.
 *
 * What this component contributes is the unbroken `flex-1` chain that lets the
 * region GROW into that bound on a tall screen, plus one invariant: **nothing
 * renders below the dock while a conversation is running** — both the attribution
 * stats and the minutes are `!running`. That keeps the page itself from scrolling
 * mid-sentence. It is necessary rather than sufficient (the transcript's own
 * bound is what stops it growing the column), and anything new added under the
 * dock has to be gated the same way.
 *
 * **The gear left the topbar.** It used to portal through `TopbarSlot` into the
 * chrome, which put a control for this surface in a bar that belongs to every
 * surface; now it sits at the end of this screen's own dock. `TopbarSlotTarget`
 * has `empty:hidden`, so the chrome closes over the gap without knowing.
 *
 * It still decides where both popovers go, because `running` and the live volume
 * write originate here; the settings VALUES belong to the page, which is the only
 * place allowed to call `useTranslateSettings`.
 */

/**
 * Status → dictionary key. The words moved to `@chatofy/i18n`; this table keeps
 * naming which status says which thing, which is the part that is about this
 * component rather than about language.
 */
const STATUS_KEY = {
  idle: 'web.translate.notListening',
  connecting: 'web.translate.connecting',
  listening: 'web.translate.listening',
  'hearing-speech': 'web.translate.hearingYou',
  translating: 'web.translate.translating',
  playing: 'web.translate.speaking',
} as const;

/**
 * Colour per status, alongside the label rather than instead of it.
 *
 * `live` and `speaking` are red and green on the same dot, so the label is what
 * carries the difference for a colour blind reader — see `status-indicator.tsx`.
 */
const STATUS_TONE: Record<keyof typeof STATUS_KEY, StatusTone> = {
  idle: 'idle',
  connecting: 'busy',
  listening: 'live',
  'hearing-speech': 'live',
  translating: 'busy',
  playing: 'speaking',
};

interface CascadePanelProps {
  settings: TranslateSettings;
  onChange: (patch: Partial<TranslateSettings>) => void;
  /** Reader for the saved volume — see `useStreamingTranslate`. */
  getVolume: () => number;
}

export function CascadePanel({ settings, onChange, getVolume }: CascadePanelProps) {
  const t = useTranslate();
  const locale = useLocale();
  // Stable, so the session built on first render keeps reading the live value.
  const readVolume = useCallback(() => getVolume(), [getVolume]);
  const conversation = useStreamingTranslate(readVolume);

  const running = conversation.status !== 'idle';

  // Minutes are summarized after the talking stops, from the STORED transcript —
  // the client no longer sends the turns, it names the conversation. Keyed by the
  // id the hook minted at `start`, not by a per-mount one: a per-mount id was
  // overwritten by the second conversation in one sitting, and nothing could ask
  // for the first again after a reload.
  const minutes = useMinutes();

  // A summary belongs to the conversation it was drawn from. Without this, the
  // second conversation of a sitting rendered the first one's summary, key
  // points and action items, under a Regenerate button aimed at the new id.
  const { reset: resetMinutes } = minutes;
  useEffect(() => {
    resetMinutes();
  }, [conversation.conversationId, resetMinutes]);

  // The conversation as history stores it: DISPLAY BLOCKS, grouped and repaired,
  // so what is saved is what was on screen.
  //
  // Computed only once the talking has stopped. It is the same grouping the live
  // transcript already runs per render, but there is no reason to pay for it on
  // the turn path when the only consumer is the save that happens at the end.
  const conversationTurns = useMemo(
    () =>
      running
        ? []
        : toConversationTurns({
            turns: conversation.turns,
            speakers: conversation.speakers,
            attributions: conversation.attributions,
            captures: conversation.captures,
            displays: conversation.displays,
          }),
    [
      running,
      conversation.turns,
      conversation.speakers,
      conversation.attributions,
      conversation.captures,
      conversation.displays,
    ],
  );

  const save = useConversationSave({
    conversationId: conversation.conversationId,
    startedAt: conversation.startedAt,
    direction: settings.direction,
    running,
    turns: conversationTurns,
  });

  // Minutes are generated FROM the stored conversation now — the request names
  // it and carries no turns — so a conversation that was not saved cannot be
  // summarized at all. Offering the control anyway would put a button on screen
  // that answers 404 (nothing stored), 400 (already past the prompt ceiling) or
  // 401 (the session that failed the save is the one that would generate).
  //
  // So this gates on `saved` and on nothing else. `saved` outlives a later
  // failure on purpose: once the row exists, an edit that fails to save leaves
  // the stored conversation exactly as it was, and a summary can still be drawn
  // from it. The notice below is what says which case a reader is in.
  const canGenerate = save.saved && conversationTurns.length > 0;

  // Nothing was stored and nothing ever will be: the same body is refused every
  // time. Only then is there no conversation to summarize — a terminal failure
  // while `saved` holds belongs to an EDIT, and the stored conversation behind
  // it is still there to work from.
  const unstored = save.failure === 'terminal' && !save.saved;

  return (
    // `min-h-0 flex-1` so the pair below can grow into the slack a tall screen
    // leaves. This chain is what makes the transcript FILL; it is not what bounds
    // it — `min-h-svh` upstream is indefinite, so no `flex-1` descendant is ever
    // constrained by it, and the scroll region carries its own viewport-relative
    // maximum for that.
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* Before you press anything: a conversation in progress is its own proof
          that the microphone and the service are fine. This is the part of the
          deleted hub that the reactive path does not cover.

          Gated on `conversation.error` as well as on `running`, and that second
          condition is not redundant. A refused microphone calls `stop()` — which
          emits `onStatus('idle')` — and only THEN `onError`, so by the time the
          error appears `running` is already false. Both would render, and both
          would say the same sentence: `open-microphone.ts` maps the fault to
          `web.translate.micDenied` and so does this banner. Two identical
          `role="alert"` regions, announced twice. The reactive one wins because
          it is about the attempt just made. */}
      {running || conversation.error ? null : <ReadinessBanner />}

      {/* No elevation. The pair is separated from the page by a hairline and by
          the divider down its middle; a shadow here would make the conversation
          an object sitting on the screen rather than the screen itself.

          **This is where the transcript stops growing the page.** The maximum is
          viewport-relative and it is on the SECTION rather than on a scroll
          region, because how many scroll regions there are is now a setting:
          `split` draws one per pane, and two regions each capped at the viewport
          are two viewports of page. Capping the box that holds all of them —
          headers included — makes the bound the same in every arrangement.

          `flex-1` alone cannot do this and fails silently. `SidebarProvider` is
          `min-h-svh`, an INDEFINITE height, so nothing below it is ever
          constrained by it: measured at 60 turns with no maximum anywhere, the
          region's `clientHeight` and `scrollHeight` were both 4500, it did not
          scroll, and the dock sat at y=4664 — with auto-follow inert, because
          `scrollTop = scrollHeight` on an unscrollable element is a no-op. A
          `min-height` is not a fix: a floor is not a bound, and only a resolved
          maximum makes a box overflow.

          The 12.5rem subtracted is everything stacked around this section: the
          topbar, the column's padding, the gap below, and the dock. The panel
          headers are NOT in that number any more — they are inside the box being
          capped. */}
      <section className="border-hairline relative flex max-h-[calc(100svh-12.5rem)] min-h-64 flex-1 flex-col overflow-hidden rounded-xl border">
        <TranscriptPanes
          settings={settings}
          running={running}
          onSwap={() =>
            onChange({ direction: settings.direction === 'vi_to_en' ? 'en_to_vi' : 'vi_to_en' })
          }
          // The voice belongs beside the panel it speaks for, not behind the gear
          // at the far end of the dock beside the page settings.
          voiceControl={
            <VoiceSettingsPopover
              settings={settings}
              running={running}
              onChange={onChange}
              onVolumeChange={conversation.setVolume}
            />
          }
          stream={{
            turns: conversation.turns,
            liveTurns: conversation.liveTurns,
            captures: conversation.captures,
            displays: conversation.displays,
            speakers: conversation.speakers,
            attributions: conversation.attributions,
            onAttribute: conversation.attributeTurn,
            onUnattribute: conversation.unattributeTurn,
            onAddSpeaker: conversation.addSpeaker,
            // Naming people is never disabled while running, unlike the settings
            // that ride `session.start`. Those configure a session and cannot
            // change under one; people join a conversation midway, and a roster
            // that locked when the microphone opened would be useless in the case
            // it exists for.
            onRenameSpeaker: conversation.renameSpeaker,
            onRemoveSpeaker: conversation.removeSpeaker,
          }}
        />
      </section>

      {conversation.error ? (
        <Alert variant="live">
          <AlertDescription>{conversation.error}</AlertDescription>
        </Alert>
      ) : null}

      {/* A failed save, and only a failed save — a successful one is silent,
          because "your conversation was kept" is the promise the History item
          in the sidebar already makes. Retry appears ONLY when resending the
          same body could succeed; a terminal failure gets the sentence that
          says why and no button that cannot work.

          `saved` picks the sentence, because it decides what was actually
          lost: with the conversation already stored, only the edits made
          after it are missing, and telling the reader it "has not been saved"
          would be false about a row sitting in their history. */}
      {save.failure ? (
        <Alert variant="live">
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>
              {save.saved
                ? t('web.translate.saveEditsFailed')
                : save.failure === 'retryable'
                  ? t('web.translate.saveFailedRetryable')
                  : t('web.translate.saveFailedTerminal')}
            </span>
            {save.failure === 'retryable' ? (
              <Button variant="outline" size="sm" onClick={save.retry} disabled={save.saving}>
                {save.saving ? t('web.translate.saving') : t('web.translate.saveRetry')}
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {/* The dock. Status at one end, the one action in the middle, settings at
          the other — so the action sits in the same place whether or not there is
          anything to report beside it. */}
      <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <div className="flex flex-wrap items-center gap-2.5">
          <StatusIndicator
            tone={STATUS_TONE[conversation.status]}
            label={t(STATUS_KEY[conversation.status])}
          />
          <MicMeter level={conversation.level} />
        </div>

        <div className="justify-self-stretch sm:justify-self-center">
          {running ? (
            <Button
              variant="live"
              size="lg"
              className="w-full rounded-full sm:w-auto"
              onClick={conversation.stop}
            >
              <MicOff aria-hidden /> {t('web.translate.end')}
            </Button>
          ) : (
            <Button
              size="lg"
              className="w-full rounded-full sm:w-auto"
              onClick={() =>
                void conversation.start({
                  direction: settings.direction,
                  voiceGender: settings.voiceGender,
                  voiceOutput: settings.voiceOutput,
                  // Sent regardless of direction. The server hands it to whichever
                  // engine speaks the output language, and the one without a rate
                  // control ignores it — the UI disables the picker there so the
                  // choice is never silently inert, but the value itself is honest.
                  speed: settings.speed,
                  // ONE token, for the language about to be spoken. Settings keep
                  // one per language because the two engines share no vocabulary;
                  // the wire carries a single value because the server already
                  // knows the direction and two could disagree.
                  voice: settings.voice[directionLanguages(settings.direction).target],
                  // Always asked for; the server decides whether to answer. A
                  // tab loaded before this field existed simply never asks, so
                  // it is never sent an event its copy of the contract cannot
                  // parse — which is the whole reason the opt-in is per client
                  // rather than server-side alone.
                  embedSpeaker: true,
                  // Same opt-in, same reason: a tab loaded before the display
                  // rendering existed never asks, so it is never sent something
                  // its copy of the contract would reject. The name is a
                  // misnomer now — nothing repairs anything, the rendering is
                  // computed in process — and renaming it is a breaking change
                  // taken separately or not at all.
                  repairDisplay: true,
                })
              }
            >
              <Mic aria-hidden /> {t('web.translate.startConversation')}
            </Button>
          )}
        </div>

        <div className="flex items-center justify-end gap-2">
          <DisplaySettingsPopover settings={settings} onChange={onChange} />
        </div>
      </div>

      {/* Read back once the talking has stopped. It reports what happened and
          asks for nothing: the audience for these numbers is whoever decides
          whether the voice layer is worth switching on, and a line telling
          somebody they labelled too little would be a report card. */}
      {!running && conversation.stats.totalTurns > 0 ? (
        <p className="text-muted-foreground text-hint">
          {/* `automatic` joined this line when the acoustic layer started
              naming turns on its own. Without it a fully labelled session read
              "N turns · 0 marked · 0 left unmarked", which says the feature did
              nothing in the exact case where it did everything. `pending` is
              deliberately absent: it is empty by the time this renders, and a
              counter that always shows zero teaches a reader to ignore the line. */}
          {t('web.translate.attributionStats', {
            total: conversation.stats.totalTurns,
            automatic: conversation.stats.automatic,
            confirmed: conversation.stats.confirmed,
            fallback: conversation.stats.fallback,
          })}
          {conversation.stats.suggestions.confirmedMatching +
            conversation.stats.suggestions.corrected +
            conversation.stats.suggestions.unreviewed >
          0
            ? ` · ${t('web.translate.attributionSuggestions', {
                agreed: conversation.stats.suggestions.confirmedMatching,
                changed: conversation.stats.suggestions.corrected,
                unreviewed: conversation.stats.suggestions.unreviewed,
              })}`
            : null}
        </p>
      ) : null}

      {/* Minutes belong after the talking stops, beside the attribution stats:
          the audience is whoever wants the outcome once the conversation is
          done, not a control that competes for attention mid-sentence. */}
      {!running && conversation.turns.length > 0 && !unstored ? (
        <MinutesPanel
          minutes={minutes.minutes}
          loading={minutes.loading}
          error={minutes.error}
          canGenerate={canGenerate}
          // Quiet, because Start is back on screen by the time this renders. Two
          // accent-filled controls at once was this product's one accent-budget
          // violation, and it lived exactly here.
          emphasis="quiet"
          // "Minutes are generated from the saved conversation" is a next step
          // that exists only while a save can still happen, which is why the
          // panel goes away entirely when nothing was stored and no retry can
          // change that — the alert above has already said so, and a hint
          // pointing at a save that will never happen would be worse.
          //
          // It goes away for THAT case only. A stored conversation whose later
          // edit failed keeps its panel: taking it down would pull an
          // already-generated summary off the screen over a failed rename.
          unavailableHint={
            conversationTurns.length > 0 ? t('web.translate.minutesNeedsSave') : undefined
          }
          onGenerate={() => {
            // The button is gated on `canGenerate`, which requires a stored
            // conversation and therefore an id. The check is what makes that
            // typed — there is no id to fall back to.
            if (!conversation.conversationId) return;
            void minutes.generate(conversation.conversationId, locale);
          }}
        />
      ) : null}
    </div>
  );
}
