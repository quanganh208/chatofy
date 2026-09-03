'use client';

import { useCallback, useMemo } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { useStreamingTranslate } from '@/hooks/use-streaming-translate';
import { useMinutes } from '@/hooks/use-minutes';
import { useConversationSave } from '@/hooks/use-conversation-save';
import { ConversationTranscript } from '@/components/translate/conversation-transcript';
import { MinutesPanel } from '@/components/translate/minutes-panel';
import { TranslateSettingsPopover } from '@/components/translate/translate-settings-popover';
import { TopbarSlot } from '@/components/layout/topbar-slot';
import { SpeakerRoster } from '@/components/translate/speaker-roster';
import { Button } from '@chatofy/ui/react';
import { Card } from '@chatofy/ui/react';
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
 * the single largest term in the measured latency of the turn-based page — that
 * page is still available at /translate/baseline as the comparison.
 *
 * A component rather than a page body, so the mode toggle can mount it beside
 * {@link LivePanel} without the two sharing a render. That separation is the
 * point: this path is the product and the live one is the experiment, and
 * nothing here should be able to break because that one changed.
 *
 * Its hook is only alive while this component is mounted, so switching modes
 * releases the microphone and the socket through the hook's own unmount
 * cleanup — there is no teardown to arrange from outside.
 *
 * It still decides where the settings go, because `running` and the live volume write
 * both originate here; the settings VALUES belong to the page, which is the only place
 * allowed to call `useTranslateSettings`. What changed is the destination: the panel now
 * renders through `TopbarSlot` into the chrome's gear popover instead of sitting in this
 * column. The portal is what makes that possible without lifting the conversation hook —
 * this component keeps every handler and every piece of state it already had, and only
 * the DOM position of one control moves.
 *
 * Nothing else follows it up there. The status, the mic level and the transcript stay
 * below: this is a hands-free screen, and chrome that rearranges itself while someone is
 * mid-sentence is worse than chrome that is slightly quiet.
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
  // So this gates on `saved`, and the notice below says which of the two cases a
  // reader is in: a retryable failure is worth retrying, and a terminal one
  // means the conversation is gone and no summary can be drawn from it.
  const canGenerate = save.saved && conversationTurns.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-6 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          {/* No heading naming the direction. The control below names it, and a
              screen that states the same fact twice makes the second one look like a
              different fact. */}
          <div className="flex flex-col gap-1">
            <p className="text-prose text-body max-w-prose">{t('web.translate.speakNaturally')}</p>
          </div>
          {running ? (
            <Button variant="live" onClick={conversation.stop}>
              <MicOff aria-hidden /> {t('web.translate.end')}
            </Button>
          ) : (
            <Button
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

        {/* Not disabled while running, unlike the settings in the topbar popover.
            Those configure a session and cannot change under one; people join a
            conversation midway, and a roster that locked when the microphone
            opened would be useless in the case it exists for. */}
        <SpeakerRoster
          speakers={conversation.speakers}
          attributions={conversation.attributions}
          onAdd={conversation.addSpeaker}
          onRename={conversation.renameSpeaker}
          onRemove={conversation.removeSpeaker}
        />

        <div className="border-hairline flex flex-wrap items-center gap-4 border-t pt-4">
          <StatusIndicator
            tone={STATUS_TONE[conversation.status]}
            label={t(STATUS_KEY[conversation.status])}
          />
          {/* Mic level, and an explicit note when input is deliberately ignored
              so a muted microphone never looks like a broken one. */}
          <div
            className="bg-muted h-1.5 min-w-32 flex-1 overflow-hidden rounded-full"
            role="presentation"
          >
            <div
              className="bg-primary h-full transition-[width] duration-75 motion-reduce:transition-none"
              style={{ width: `${Math.min(100, conversation.level * 300)}%` }}
            />
          </div>
        </div>

        {conversation.error ? (
          <Alert variant="live">
            <AlertDescription>{conversation.error}</AlertDescription>
          </Alert>
        ) : null}

        {/* A failed save, and only a failed save — a successful one is silent,
            because "your conversation was kept" is the promise the History item
            in the sidebar already makes. Retry appears ONLY when resending the
            same body could succeed; a terminal failure gets the sentence that
            says why and no button that cannot work. */}
        {save.failure ? (
          <Alert variant="live">
            <AlertDescription className="flex flex-wrap items-center gap-3">
              <span>
                {save.failure === 'retryable'
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
      </Card>

      <TopbarSlot>
        <TranslateSettingsPopover
          settings={settings}
          running={running}
          onChange={onChange}
          onVolumeChange={conversation.setVolume}
        />
      </TopbarSlot>

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

      <ConversationTranscript
        turns={conversation.turns}
        liveTurns={conversation.liveTurns}
        captures={conversation.captures}
        displays={conversation.displays}
        running={running}
        layout={settings.transcriptLayout}
        speakers={conversation.speakers}
        attributions={conversation.attributions}
        onAttribute={conversation.attributeTurn}
        onUnattribute={conversation.unattributeTurn}
        onAddSpeaker={conversation.addSpeaker}
      />

      {/* Minutes belong after the talking stops, beside the attribution stats:
          the audience is whoever wants the outcome once the conversation is
          done, not a control that competes for attention mid-sentence. */}
      {!running && conversation.turns.length > 0 ? (
        <MinutesPanel
          minutes={minutes.minutes}
          loading={minutes.loading}
          error={minutes.error}
          canGenerate={canGenerate}
          unavailableHint={
            conversationTurns.length > 0 ? t('web.translate.minutesNeedsSave') : undefined
          }
          onGenerate={() => void minutes.generate(conversation.conversationId ?? '', locale)}
        />
      ) : null}
    </div>
  );
}
