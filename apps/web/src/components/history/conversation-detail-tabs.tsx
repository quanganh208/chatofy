'use client';

import type { Conversation } from '@chatofy/types';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@chatofy/ui/react';
import { HistoryTranscript } from '@/components/history/history-transcript';
import { MinutesPanel } from '@/components/translate/minutes-panel';
import type { UseMinutes } from '@/hooks/use-minutes';
import { useLocale, useTranslate } from '@/i18n/provider';

interface ConversationDetailTabsProps {
  conversation: Conversation;
  minutes: UseMinutes;
  /** Jump the player; absent when there is no recording to jump. */
  onSeek?: (ms: number) => void;
}

/**
 * Transcript | Minutes — two panels of ONE conversation, which is what `Tabs` is for.
 *
 * Not routes: both belong to the URL of the conversation, and neither is something a
 * reader shares on its own. Not a segmented control either: these reveal a panel
 * rather than setting a value, so a tabpanel exists behind each tab.
 *
 * The line variant, ink underline: a selected tab states the current view, it is
 * not the screen's action. The one accent-filled control on this screen is the
 * minutes panel's Generate, and it exists only while the Minutes tab is open —
 * Radix mounts the active panel alone — so the transcript view spends none.
 *
 * `MinutesPanel` is reused unchanged and is its own card: one elevated surface, and
 * only on the Minutes tab. The transcript is on the page ground.
 */
export function ConversationDetailTabs({
  conversation,
  minutes,
  onSeek,
}: ConversationDetailTabsProps) {
  const t = useTranslate();
  const locale = useLocale();
  const hasMinutes = conversation.hasMinutes || minutes.minutes !== null;

  return (
    <Tabs defaultValue="transcript" className="gap-6">
      <TabsList
        variant="line"
        className="border-hairline w-full justify-start rounded-none border-b"
      >
        <TabsTrigger value="transcript" className="flex-none">
          {t('common.transcript')}
        </TabsTrigger>
        <TabsTrigger value="minutes" className="flex-none">
          {t('web.history.tabMinutes')}
          {hasMinutes ? (
            <>
              <span aria-hidden className="bg-muted-foreground size-1.5 rounded-full" />
              <span className="sr-only">{t('web.history.tabMinutesReady')}</span>
            </>
          ) : null}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="transcript">
        <HistoryTranscript
          turns={conversation.turns}
          languages={conversation.languages}
          audioOffsetMs={conversation.audioOffsetMs}
          onSeek={onSeek}
        />
      </TabsContent>

      <TabsContent value="minutes">
        {/* `canGenerate` is unconditional. A stored conversation has at least one
            turn — the write schema refuses an empty one — so the panel's "nothing
            to summarize" state is unreachable from this route. */}
        <MinutesPanel
          minutes={minutes.minutes}
          loading={minutes.loading}
          error={minutes.error}
          canGenerate
          onGenerate={() => void minutes.generate(conversation.conversationId, locale)}
        />
      </TabsContent>
    </Tabs>
  );
}
