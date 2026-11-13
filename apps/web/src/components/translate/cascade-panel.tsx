'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useRefreshCreditBalance } from '@/hooks/use-credits';
import { useReportConversationRunning } from '@/hooks/use-conversation-running';
import { useStreamingTranslate } from '@/hooks/use-streaming-translate';
import { useMinutes } from '@/hooks/use-minutes';
import { useConversationAudioUpload } from '@/hooks/use-conversation-audio-upload';
import { useConversationSave } from '@/hooks/use-conversation-save';
import { TranscriptPanes, type StreamProps } from '@/components/translate/transcript-panes';
import { MinutesPanel } from '@/components/translate/minutes-panel';
import { DisplaySettingsPopover } from '@/components/translate/display-settings-popover';
import { VoiceSettingsPopover } from '@/components/translate/voice-settings-popover';
import { ReadinessBanner } from '@/components/translate/readiness-banner';
import { SessionActions, SessionReadouts } from '@/components/translate/session-controls';
import { AUTO_DETECT, languagePairOf, reversePair, type LanguageCode } from '@chatofy/types';
import { toConversationTurns } from '@chatofy/realtime-client';
import {
  sessionVoiceOptions,
  spokenLanguagesOf,
  pairFor,
  pairPatchFor,
  type ConversationMode,
  type TranslateSettings,
} from '@/lib/translate-settings';
import { languageNamer } from '@/i18n/language-pair-labels';
import { recordingOffsetMs } from '@/lib/transcript-time';
import { useLocale, useTranslate } from '@/i18n/provider';
import { ContextPicker } from '@/components/translate/context-picker';
import { FullscreenStage } from '@/components/translate/fullscreen-stage';
import { CaptionWindowPortal } from '@/components/translate/caption-window-portal';
import { StageControls } from '@/components/translate/stage-controls';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { useCaptionWindow } from '@/hooks/use-caption-window';
import { cn } from '@/lib/utils';
import { useImmersiveChrome } from '@/components/layout/chrome-slots';
import { useErrorToast } from '@/components/translate/use-error-toast';
import { resolveContext, toHints, useTranslationContexts } from '@/hooks/use-translation-contexts';

/**
 * Hands-free conversation over the STT → translate → TTS cascade.
 *
 * No button ends a TURN, by design: the turn ends when the speaker stops
 * talking. Pressing one costs half a second of human reaction time, which was
 * the single largest term in the measured latency of the earlier turn-based
 * page. That page and the continuous-mode experiment beside it were the two
 * unlinked lab routes under `/translate`, and both are gone: the REST path they
 * drove is still `POST /translate` in the API, which is where the thesis
 * comparison is measured.
 *
 * Pause and End are not that button and do not cost that half second: they are
 * per CONVERSATION, pressed once at its edge rather than between sentences, so
 * they sit outside the loop the measurement is about. The distinction is worth
 * keeping straight — a reader who collapses the two would delete the pause
 * control believing the note above forbids it.
 *
 * A component rather than a page body, and its hook is only alive while it is
 * mounted — unmounting releases the microphone and the socket through the hook's
 * own cleanup, so there is no teardown to arrange from outside.
 *
 * ## The shape of the screen
 *
 * Two hairline sheets inset on the page ground, each naming and picking its own
 * language, and a dock along the bottom under one hairline: status and level at one
 * end, the single action in the middle, the display gear at the other.
 *
 * **Sheets, not flat regions.** They were briefly flat regions with the pickers in
 * the topbar; the swap then had nothing to fly, because two halves of one surface
 * trading places reads as text jumping, not as the sides trading. Two objects with
 * their own edges is what lets `language-shuffle.ts` show the reversal. No shadow,
 * so neither is an elevated surface.
 *
 * **Settings are split by what they are about, not by what they cost.** The voice
 * opens beside the language it speaks, in that pane's header, because that is where a reader asks why they are or are not
 * hearing anything; the gear keeps the page. They were one popover, which meant the
 * speaker mark configured nothing and the gear configured sound — see
 * `voice-settings-popover.tsx`.
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
 * **The pair belongs to the sheets; the gear is the dock's.** Each sheet's header
 * holds its own picker and voice, and the swap sits on the seam between them
 * (`transcript-panes.tsx` renders them, because it owns the swap animation). The
 * gear, fullscreen and the caption window stay at the end of this screen's own dock,
 * beside Start.
 *
 * It still decides where both popovers go, because `running` and the live volume
 * write originate here; the settings VALUES belong to the page, which is the only
 * place allowed to call `useTranslateSettings`.
 */

interface CascadePanelProps {
  /**
   * Which page this is: `/translate/one-way` runs one way — a declared source, or
   * auto-detected — and `/translate/two-way` runs both ways. Each keeps its own stored
   * pair (`pairFor`), so a choice on one page never opens the other in a state
   * it cannot run.
   */
  conversationMode: ConversationMode;
  settings: TranslateSettings;
  onChange: (patch: Partial<TranslateSettings>) => void;
  /** Reader for the saved volume — see `useStreamingTranslate`. */
  /** One language's playback volume, or the untagged (one-way) stage's when absent. */
  getVolume: (language?: LanguageCode) => number;
}

export function CascadePanel({
  conversationMode,
  settings,
  onChange,
  getVolume,
}: CascadePanelProps) {
  const t = useTranslate();
  // The pair this page shows and starts in, and how a pick on it is stored.
  const languagePair = pairFor(settings, conversationMode);
  const setLanguagePair = (pair: Parameters<typeof pairPatchFor>[1]) =>
    onChange(pairPatchFor(conversationMode, pair));
  // Called HERE, the page-level component for `/translate`. The stored id is
  // resolved into hints by the CLIENT rather than server-side, because
  // `client.session.start` fires once per TURN and a server that looked the id up
  // would read the row on every one of them.
  const { contexts, status: contextStatus } = useTranslationContexts();

  // A stored selection resolves against `contexts`, which is `[]` for as long as
  // the list has not settled — `loading`, and `failed` too. Pressing Start in
  // that window ran the whole conversation with no glossary, topic, keywords or
  // register, and nothing on screen said so: the picker itself renders nothing
  // outside `ready`, so the one control that could have explained it disappears
  // in exactly the window this matters.
  //
  // `awaitingContext` GATES Start — the list is still in the air, so waiting a
  // moment is the only way to know what pressing it would send. `contextUnready`
  // does not gate it: once the list has settled and failed, the account still
  // has a right to start an unhinted conversation on purpose, but only once it
  // has been told that is what pressing Start does.
  const awaitingContext = settings.contextId !== null && contextStatus === 'loading';
  const contextUnready = settings.contextId !== null && contextStatus === 'failed';
  const locale = useLocale();
  // Destructured: one of these goes to `ref=`, and the compiler's refs rule would
  // otherwise treat every field read off the same object as a ref read in render.
  const {
    attach: attachFullscreen,
    active: fullscreenActive,
    emulated: fullscreenEmulated,
    enter: enterFullscreen,
    exit: exitFullscreen,
  } = useFullscreen<HTMLElement>();
  const captionWindow = useCaptionWindow(t('web.translate.captionWindowTitle'));
  // Stable, so the session built on first render keeps reading the live value.
  const readVolume = useCallback((language?: LanguageCode) => getVolume(language), [getVolume]);
  // Read at start through the hook's ref, so the latest saved choice applies to
  // the next conversation and never to the one running.
  const readMicProcessing = useCallback(() => settings.micProcessing, [settings.micProcessing]);
  const conversation = useStreamingTranslate(readVolume, readMicProcessing);
  // A language's volume, straight to its gain stage. The untagged stage — a
  // one-way turn's frames — speaks the target, so the target's slider moves it
  // too.
  const setLanguageVolume = (volume: number, language: LanguageCode) => {
    conversation.setVolume(volume, language);
    if (language === pairFor(settings, conversationMode).target) conversation.setVolume(volume);
  };

  // Paused is a RUNNING state. Everything gated on `running` — the save that
  // fires on its falling edge above all — must not fire when the microphone goes
  // off, because the conversation has not ended.
  const running = conversation.status !== 'idle';
  // Settings opens over this page; while this runs, its Translation tab freezes the
  // pair, voice and context the way this page's own controls do.
  useReportConversationRunning(running);

  // Volume is the one voice control that stays live mid-conversation, and it can
  // change from two places: this page's popover, which moves the gain stage itself,
  // and Settings opened over this page, whose change arrives only as new `settings`
  // through the owner sync. A gain stage reads its volume once, when it is built, so
  // without this a volume moved in Settings would be saved and toasted but not heard
  // until the next conversation. Each language whose volume changed since the last
  // render is pushed to its stage (the popover's own change lands twice, harmlessly).
  const { setVolume } = conversation;
  const oneWayTarget = pairFor(settings, conversationMode).target;
  const volumes = settings.voiceByLanguage;
  const heardVolumes = useRef<typeof volumes | null>(null);
  useEffect(() => {
    if (!running) {
      heardVolumes.current = null;
      return;
    }
    const before = heardVolumes.current;
    heardVolumes.current = volumes;
    // The first render of a run: the session read every volume as it started.
    if (!before) return;
    for (const language of Object.keys(volumes) as LanguageCode[]) {
      const volume = volumes[language].volume;
      if (before[language]?.volume === volume) continue;
      setVolume(volume, language);
      if (language === oneWayTarget) setVolume(volume);
    }
  }, [running, volumes, oneWayTarget, setVolume]);

  // A conversation spends credits, so its end reads the shared balance again: the
  // sidebar meter and the readiness banner then show what is left, not what was.
  const refreshCredits = useRefreshCreditBalance();
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running) void refreshCredits();
    wasRunning.current = running;
  }, [running, refreshCredits]);

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

  // Where the recording began, relative to this conversation.
  //
  // Read while the conversation RUNS, from the recorder's own start rather than
  // from the finished recording, because it has two live readers: the transcript
  // shifts every timestamp it draws by it, and the save below stores it so
  // `/history` can shift by the identical number. It is null until the
  // microphone opens — a permission prompt can hold that open for seconds — and
  // a block timestamped in that window reads conversation time on both screens,
  // which is still the same number on both.
  const audioOffsetMs = recordingOffsetMs(
    conversation.recordingStartedAtMs,
    conversation.startedAt,
  );

  // The conversation as history stores it: DISPLAY BLOCKS, grouped and repaired,
  // so what is saved is what was on screen.
  //
  // Computed only once the talking has stopped. It is the same grouping the live
  // transcript already runs per render, but there is no reason to pay for it on
  // the turn path when the only consumer is the save that happens at the end.
  const conversationTurns = useMemo(
    () =>
      // `!conversation.startedAt` alongside `running` rather than falling back
      // to the epoch: a block's `offsetMs` is `openedAt - startedAtMs`, and
      // `openedAt` is a real epoch millisecond reading, so an epoch origin would
      // turn every offset into a decades-long value the write schema refuses
      // outright. Unreached today — `startedAt` is stamped at the same moment
      // `conversationId` is minted, in `use-streaming-translate.ts` — but a
      // future caller of this state is not guaranteed that ordering, and a save
      // refused for every turn is a worse failure than one with no timestamps.
      running || !conversation.startedAt
        ? []
        : toConversationTurns(
            {
              turns: conversation.turns,
              speakers: conversation.speakers,
              attributions: conversation.attributions,
              captures: conversation.captures,
              displays: conversation.displays,
              blockTranslations: conversation.blockTranslations,
            },
            // The origin every stored `offsetMs` is measured from — the capture
            // timestamps are also `Date.now()`, also this tab, so this subtracts
            // meaningfully against them.
            Date.parse(conversation.startedAt),
            // And the pauses it leaves out, so a stored offset is a position in
            // a recording that skipped them — see `offsetPauses`.
            conversation.offsetPauses,
          ),
    [
      running,
      conversation.turns,
      conversation.speakers,
      conversation.attributions,
      conversation.captures,
      conversation.displays,
      conversation.blockTranslations,
      conversation.startedAt,
      conversation.offsetPauses,
    ],
  );

  const save = useConversationSave({
    conversationId: conversation.conversationId,
    startedAt: conversation.startedAt,
    // Captured at `start`, not read live from `settings`: the language pickers
    // are only disabled while running, so a swap between End and the next Start
    // must not flip what an already-finished conversation is stored as. Falls
    // back to the page's stored pair only before the first `start`, when nothing
    // has been captured yet and `turns` is empty so the fallback never saves.
    languagePair: conversation.languagePair ?? languagePair,
    running,
    turns: conversationTurns,
    // Stored by the TRANSCRIPT save, not only by the recording upload, because
    // the gutter is not the player: a conversation whose audio was refused —
    // no storage configured, a body over the cap, a dropped network — still has
    // timestamps, and they have to keep meaning what they meant on the live
    // screen. The upload writes the same number afterwards when it succeeds.
    audioOffsetMs,
    // What History takes off `endedAt - startedAt`, so the card's duration is
    // the time the clock on this screen counted.
    pausedMs: conversation.pausedMs,
    // Captured at `start` with the pair, so the page the conversation ran on
    // is what History calls it — not whichever page the reader is on now.
    twoWayRequested: conversation.twoWayRequested,
    // The title is written in the reader's language, like the minutes.
    titleLanguage: locale,
  });

  // Gated on `save.saved`, not merely on the conversation having ended: the row
  // has to exist before a recording can point at it. Independent of the save in
  // every other way, so a recording that fails to store leaves the transcript
  // exactly as it would have been.
  const audioUpload = useConversationAudioUpload({
    conversationId: conversation.conversationId,
    startedAt: conversation.startedAt,
    recording: conversation.recording,
    saved: save.saved,
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

  const nameLanguage = languageNamer(t);
  // What a start from the current settings may speak, target first: both sides
  // of a two-way pair, the target of anything else.
  const spokenLanguages = spokenLanguagesOf(languagePair, conversationMode);
  // Asked for both ways, answered one way: the pair it runs in, or null. Read
  // off the newest turn's answer, and only while running — the answer belongs
  // to the conversation in progress.
  const declinedPair =
    running &&
    conversation.twoWayRequested &&
    conversation.languageMode?.mode === 'declared' &&
    conversation.languagePair &&
    conversation.languagePair.source !== AUTO_DETECT
      ? languagePairOf(conversation.languagePair.source, conversation.languagePair.target)
      : null;

  // Nothing was stored and nothing ever will be: the same body is refused every
  // time. Only then is there no conversation to summarize — a terminal failure
  // while `saved` holds belongs to an EDIT, and the stored conversation behind
  // it is still there to work from.
  const unstored = save.failure === 'terminal' && !save.saved;

  // The phone's tab bar steps aside while a conversation is open, so the panes and
  // the dock have the whole screen; it comes back when the conversation ends.
  useImmersiveChrome(running);

  // Outcomes, said once as toasts rather than as alerts stacked over the dock —
  // see `use-error-toast.ts`. A failed save offers its retry only when resending
  // the same body could succeed; `saved` picks the sentence, because with the
  // conversation already stored only the edits after it are missing, and "has not
  // been saved" would be false about a row sitting in History. The recording is
  // reported separately and phrased so the difference is clear: the words are
  // safe, the audio is not.
  useErrorToast('translate-conversation', conversation.error);
  useErrorToast(
    'translate-save',
    save.failure
      ? save.saved
        ? t('web.translate.saveEditsFailed')
        : save.failure === 'retryable'
          ? t('web.translate.saveFailedRetryable')
          : t('web.translate.saveFailedTerminal')
      : null,
    save.failure === 'retryable' ? save.retry : undefined,
  );
  useErrorToast(
    'translate-recording',
    audioUpload.failure
      ? audioUpload.failure === 'retryable'
        ? t('web.translate.recordingFailedRetryable')
        : t('web.translate.recordingFailedTerminal')
      : null,
    audioUpload.failure === 'retryable' ? audioUpload.retry : undefined,
  );

  // What Start sends, for both of the places Start can be pressed — the dock and
  // the fullscreen bar.
  const startConversation = () =>
    void conversation.start({
      languagePair,
      mode: conversationMode,
      // Each language this start may speak, as that language's own setup:
      // whether it is spoken, how fast, in which voice. The target leads, so the
      // flat fields an older API reads describe the language a declared turn
      // speaks.
      ...sessionVoiceOptions(settings, spokenLanguages),
      // Always asked for; the server decides whether to answer. A
      // tab loaded before this field existed simply never asks, so
      // it is never sent an event its copy of the contract cannot
      // parse — which is the whole reason the opt-in is per client
      // rather than server-side alone.
      embedSpeaker: true,
      // Same opt-in again: a tab that cannot join a piece of a
      // split turn back to the turn it opened is never sent one.
      splitSpeakers: true,
      // Same opt-in, same reason: a tab loaded before the display
      // rendering existed never asks, so it is never sent something
      // its copy of the contract would reject. The name is a
      // misnomer now — nothing repairs anything, the rendering is
      // computed in process — and renaming it is a breaking change
      // taken separately or not at all.
      repairDisplay: true,
      // `undefined`, not an empty object, when no context is selected
      // — a request with no hints produces a prompt byte-identical to
      // the one without this feature, which is what lets the recorded
      // injection baseline keep describing the default path. A
      // contextId naming a context that no longer exists resolves to
      // null here and reads as "no context".
      hints: toHints(resolveContext(contexts, settings.contextId)),
    });

  // One stream for every view of the conversation — the page's panes, the
  // fullscreen stage and the caption window — so none of them can show a
  // different conversation from the others.
  const stream: StreamProps = {
    turns: conversation.turns,
    liveTurns: conversation.liveTurns,
    captures: conversation.captures,
    // Live only. `toConversationTurns` above builds the SAVED record,
    // where this has no meaning: what a listener did or did not hear is
    // a fact about the run, not about the conversation.
    unheard: conversation.unheard,
    displays: conversation.displays,
    blockTranslations: conversation.blockTranslations,
    // The two origins a turn's timestamp is measured from. The first is
    // what `toConversationTurns` above measures the STORED offset from,
    // and the second is what history shifts that offset by — so the
    // number on screen now is the number read back later.
    startedAtMs: conversation.startedAt ? Date.parse(conversation.startedAt) : null,
    audioOffsetMs,
    // The pauses the stored offset leaves out, left out here too.
    pauses: conversation.offsetPauses,
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
    languageModes: conversation.languageModes,
  };

  // Why no caption window appeared. The blocker is the one refusal the reader can
  // act on, so it says what to do; a failed Picture-in-Picture request says only
  // that it failed.
  useErrorToast(
    'translate-caption-window',
    captionWindow.failure
      ? t(
          captionWindow.failure === 'blocked'
            ? 'web.translate.captionWindowBlocked'
            : 'web.translate.captionWindowFailed',
        )
      : null,
  );

  return (
    // Edge to edge: the column's padding is taken back (`-mx-6 -my-8`, the chrome's
    // `px-6 py-8`), so the dock's hairline runs the full width. Everything else puts
    // the padding back itself — the sheets included, which sit inset on the ground.
    //
    // `min-h-0 flex-1` so the pair below can grow into the slack a tall screen
    // leaves. This chain is what makes the transcript FILL; it is not what bounds
    // it — `min-h-svh` upstream is indefinite, so no `flex-1` descendant is ever
    // constrained by it, and the section carries its own viewport-relative maximum.
    <div className="-mx-6 -my-8 flex min-h-0 flex-1 flex-col">
      {/* Before you press anything: a conversation in progress is its own proof
          that the microphone and the service are fine.

          Gated on `conversation.error` as well as on `running`, and that second
          condition is not redundant. A refused microphone calls `stop()` — which
          emits `onStatus('idle')` — and only THEN `onError`, so by the time the
          error appears `running` is already false. Both would say the same
          sentence: `open-microphone.ts` maps the fault to
          `web.translate.micDenied` and so does this banner. The reactive one — the
          toast — wins because it is about the attempt just made. */}
      {running || conversation.error ? null : (
        <div className="px-6 pt-4 empty:hidden">
          <ReadinessBanner />
        </div>
      )}

      {/* **This is where the transcript stops growing the page.** The maximum is
          viewport-relative and it is on the SECTION rather than on a scroll
          region, because how many scroll regions there are is a setting: `split`
          draws one per pane, and two regions each capped at the viewport are two
          viewports of page. Capping the box that holds all of them — headers
          included — makes the bound the same in every arrangement.

          `flex-1` alone cannot do this and fails silently. `SidebarProvider` is
          `min-h-svh`, an INDEFINITE height: measured at 60 turns with no maximum
          anywhere, the region did not scroll, and the dock sat at y=4664 with
          auto-follow inert. A `min-height` is not a fix: only a resolved maximum
          makes a box overflow.

          What is subtracted is everything stacked around this section: the
          topbar (3rem) and the dock (4.25rem from `sm`; two rows, 7.5rem, below
          it) — plus, on a phone, the tab bar (3.5rem and the safe area) whenever
          it is showing, which is whenever no conversation is open.

          Fullscreen is THIS element, so the stage replaces the panes in place and
          leaving it returns them where they were. Native fullscreen sizes the
          element itself; the emulated layer — iPhone Safari, a frame without
          `allowfullscreen` — draws the same state with a fixed cover. */}
      <section
        ref={attachFullscreen}
        className={cn(
          'relative flex min-h-64 flex-1 flex-col sm:max-h-[calc(100svh-7.25rem)]',
          running
            ? 'max-sm:max-h-[calc(100svh-10.5rem)]'
            : 'max-sm:max-h-[calc(100svh-14rem-env(safe-area-inset-bottom))]',
          fullscreenActive && 'bg-background',
          fullscreenEmulated && 'fixed inset-0 z-50 max-h-none max-sm:max-h-none sm:max-h-none',
        )}
      >
        {fullscreenActive ? (
          <FullscreenStage
            settings={settings}
            conversationMode={conversationMode}
            onChange={onChange}
            running={running}
            stream={stream}
            conversationLanguagePair={conversation.languagePair ?? languagePair}
            languageMode={conversation.languageMode?.mode ?? null}
            conversation={conversation}
            onStart={startConversation}
            awaitingContext={awaitingContext}
            contextUnready={contextUnready}
            onExit={exitFullscreen}
          />
        ) : (
          // The panes are two sheets with their own edges, so they sit inset on the
          // page ground — the padding the column above gave back is put back here —
          // and the swap can fly one sheet into the other's place.
          <div className="flex min-h-0 flex-1 flex-col px-6 pt-6 pb-4">
            <TranscriptPanes
              settings={settings}
              running={running}
              // Same capture as the save above, and for the same reason: a stop-then
              // -swap must not flip which language a finished turn's translation
              // line reads from.
              conversationLanguagePair={conversation.languagePair ?? languagePair}
              onSwap={() => {
                // The swap is disabled for an auto-detected source; this keeps the
                // handler honest about the one pair it cannot reverse.
                const { source, target } = languagePair;
                if (source === AUTO_DETECT) return;
                setLanguagePair(reversePair(languagePairOf(source, target)));
              }}
              languageMode={conversation.languageMode?.mode ?? null}
              conversationMode={conversationMode}
              onLanguagePair={setLanguagePair}
              // The voice belongs beside the language it speaks for — in that pane's
              // header — not behind the gear.
              voiceControlFor={(language) => (
                <VoiceSettingsPopover
                  settings={settings}
                  language={language}
                  running={running}
                  onChange={onChange}
                  onVolumeChange={setLanguageVolume}
                />
              )}
              stream={stream}
            />
          </div>
        )}
      </section>

      {captionWindow.container ? (
        <CaptionWindowPortal
          container={captionWindow.container}
          settings={settings}
          running={running}
          stream={stream}
          languagePair={conversation.languagePair ?? languagePair}
        />
      ) : null}

      {/* Readouts about the conversation in progress: no fill, no surface, nothing
          to press, because nothing on this screen would change them mid-run. */}
      <div className="flex flex-col gap-1 px-6 pb-2 empty:hidden">
        {/* A two-way start the server is running one way — it could not tell the
            two languages apart right now. Said as what the reader gets instead. */}
        {declinedPair ? (
          <p role="status" className="text-muted-foreground text-hint" data-two-way-unavailable>
            {t('web.translate.twoWayUnavailable', {
              from: nameLanguage(declinedPair.source),
              to: nameLanguage(declinedPair.target),
            })}
          </p>
        ) : null}

        {/* Half duplex, which echo cancellation off asks for: the microphone is
            ignored while our translation plays, so speech then is not heard. */}
        {conversation.micPaused ? (
          <p role="status" className="text-muted-foreground text-hint">
            {t('web.translate.micPausedDuringPlayback')}
          </p>
        ) : null}

        {/* Credits running low: a state, not an outcome, because the conversation
            goes on. The stop that may follow is the error toast. */}
        {conversation.notice ? (
          <p role="status" className="text-muted-foreground text-hint" data-conversation-notice>
            {conversation.notice}
          </p>
        ) : null}
      </div>

      {/* The dock: a bar under one hairline, full width. Status and elapsed time at
          one end, the action in the middle, the page's own controls as ghost icons
          at the other — so the action sits in the same place whether or not there
          is anything to report beside it. Below `sm` the action takes the first row
          on its own and the two ends share the second.

          The middle holds TWO buttons while a conversation is open, which is the
          one place this layout bends. They are a pair rather than two controls:
          both end the microphone, and they differ only in whether the
          conversation survives it.

          Inert while fullscreen: the stage's bar carries the session then, and on
          the emulated route this dock is still in the document under the cover —
          tabbable, and its live status announced twice, if it were not. */}
      <div
        inert={fullscreenActive}
        data-slot="translate-dock"
        className="border-hairline grid grid-cols-[1fr_auto] items-center gap-3 border-t px-4 py-3 sm:grid-cols-[1fr_auto_1fr] sm:px-6"
      >
        <SessionReadouts conversation={conversation} />

        <div className="col-span-2 row-start-1 flex items-center gap-2 sm:col-span-1 sm:col-start-2 sm:justify-self-center">
          {/* Rendered once on the screen: here, or in the fullscreen bar. Both at
              once would be two Starts, which the accent budget counts. */}
          {fullscreenActive ? null : (
            <SessionActions
              conversation={conversation}
              onStart={startConversation}
              awaitingContext={awaitingContext}
              contextUnready={contextUnready}
            />
          )}
        </div>

        <div className="flex items-center justify-end gap-1">
          {/* Renders nothing when the account has authored no contexts, so the
              dock is unchanged for everyone who does not use this. A `Select`, so
              it spends no accent — Start is still the screen's one. */}
          <ContextPicker
            contexts={contexts}
            status={contextStatus}
            value={settings.contextId}
            running={running}
            onChange={(contextId) => onChange({ contextId })}
          />
          <StageControls
            onFullscreen={enterFullscreen}
            windowKind={captionWindow.kind}
            windowOpen={captionWindow.container !== null}
            onToggleWindow={captionWindow.container ? captionWindow.close : captionWindow.open}
          />
          <DisplaySettingsPopover settings={settings} onChange={onChange} />
        </div>
      </div>

      {/* After the talking stops: what happened, on the page ground below the dock.
          Nothing renders here while a conversation is running, which keeps the
          page itself from scrolling mid-sentence — anything new added here has to
          be gated the same way. */}
      {/* Not even an empty box while running, so the dock is the panel's last child. */}
      {running ? null : (
        <div className="flex flex-col gap-4 px-6 pt-2 pb-8 empty:hidden">
          {/* The recording on its way up: a state, said where the reader is looking.
            Its failure is a toast. */}
          {audioUpload.uploading ? (
            <p role="status" className="text-muted-foreground text-hint" data-recording-uploading>
              {t('web.translate.recordingUploading')}
            </p>
          ) : null}

          {/* Read back once the talking has stopped. It reports what happened and
            asks for nothing: a line telling somebody they labelled too little would
            be a report card. */}
          {!running && conversation.stats.totalTurns > 0 ? (
            <p className="text-muted-foreground text-hint">
              {/* `automatic` is here so a fully labelled session does not read
                "N turns · 0 marked · 0 left unmarked". `pending` is deliberately
                absent: it is empty by the time this renders. */}
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

          {/* Minutes belong after the talking stops: the audience is whoever wants
            the outcome once the conversation is done. */}
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
              // change that. A stored conversation whose later edit failed keeps its
              // panel: taking it down would pull a generated summary off the screen
              // over a failed rename.
              unavailableHint={
                conversationTurns.length > 0 ? t('web.translate.minutesNeedsSave') : undefined
              }
              onGenerate={() => {
                // Gated on `canGenerate`, which requires a stored conversation and
                // therefore an id. The check is what makes that typed.
                if (!conversation.conversationId) return;
                void minutes.generate(conversation.conversationId, locale);
              }}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
