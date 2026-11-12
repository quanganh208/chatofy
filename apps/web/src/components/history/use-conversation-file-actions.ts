'use client';

import { useEffect, useRef, useState } from 'react';
import type { Conversation, ConversationSummary, MinutesContent } from '@chatofy/types';
import { fetchConversationAudio, getConversation } from '@/clients/api-client';
import { useLocale, useTranslate } from '@/i18n/provider';
import { saveBlob, textBlob } from '@/lib/save-file';
import { minutesOrNull } from './conversation-cache';
import { transcriptMarkdown, transcriptText } from './conversation-export';
import { exportFilename, recordingExtension } from './conversation-export-filename';
import { canExportSrt, transcriptSrt } from './conversation-export-srt';
import { useHistoryPanes } from './history-panes-context';

export type TranscriptFormat = 'txt' | 'md' | 'srt';

/** What the live region beside the `⋯` says, and in which tone. */
export interface FileActionNotice {
  tone: 'busy' | 'done' | 'error';
  text: string;
}

/** How long "Transcript copied" stays — the minutes panel's Copied, the same 2 s. */
const NOTICE_MS = 2_000;

interface FileActionsInput {
  conversation: ConversationSummary;
  /** The full conversation when the caller already has it — the open detail. */
  loaded?: Conversation;
  /** The minutes the caller already holds; `undefined` reads them on demand. */
  minutes?: MinutesContent | null;
}

/**
 * Copy and the downloads, for one conversation, from wherever its menu is.
 *
 * A row has only the summary, so the full conversation is fetched when an item is
 * CHOSEN — through the layout's cache, which the open detail also fills, so a
 * second action or the open one costs nothing. Outside the History layout it
 * falls back to a plain fetch.
 *
 * One action at a time: `busy` disables the others, because a second download
 * started while the first is still fetching would race it for the notice.
 */
export function useConversationFileActions({ conversation, loaded, minutes }: FileActionsInput) {
  const t = useTranslate();
  const locale = useLocale();
  const panes = useHistoryPanes();
  const id = conversation.conversationId;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<FileActionNotice | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const say = (next: FileActionNotice | null, transient = false) => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    setNotice(next);
    if (transient) timer.current = window.setTimeout(() => setNotice(null), NOTICE_MS);
  };

  /** The full conversation, with the latest title: a rename updates the summary first. */
  const full = async (): Promise<Conversation> => {
    const found =
      loaded ?? (panes ? await panes.cache.load(id) : (await getConversation(id)).conversation);
    return { ...found, title: conversation.title };
  };

  /** What the menu can tell without fetching: the open detail's copy, or a cached one. */
  const known = (): Conversation | undefined => loaded ?? panes?.cache.peek(id);

  const run = async (work: () => Promise<FileActionNotice | null>, failure: string) => {
    if (busy) return;
    setBusy(true);
    say(known() ? null : { tone: 'busy', text: t('web.history.preparingDownload') });
    try {
      const done = await work();
      say(done, true);
    } catch {
      say({ tone: 'error', text: failure }, true);
    } finally {
      setBusy(false);
    }
  };

  const copy = () =>
    run(async () => {
      await navigator.clipboard.writeText(transcriptText(await full(), t, locale));
      return { tone: 'done', text: t('web.history.transcriptCopied') };
    }, t('web.history.copyFailed'));

  const download = (format: TranscriptFormat) =>
    run(async () => {
      const source = await full();
      if (format === 'srt') {
        // A row cannot know before fetching whether every turn carries a time, so
        // the item is offered and the reason is given here instead of a file.
        if (!canExportSrt(source))
          return { tone: 'error', text: t('web.history.subtitlesNeedTimes') };
        saveBlob(
          textBlob(transcriptSrt(source), 'application/x-subrip', true),
          exportFilename(source, 'srt'),
        );
        return null;
      }
      if (format === 'md') {
        const held =
          minutes !== undefined
            ? minutes
            : conversation.hasMinutes
              ? await minutesOrNull(id)
              : null;
        saveBlob(
          textBlob(transcriptMarkdown(source, t, locale, held), 'text/markdown', false),
          exportFilename(source, 'md'),
        );
        return null;
      }
      saveBlob(
        textBlob(transcriptText(source, t, locale), 'text/plain', true),
        exportFilename(source, 'txt'),
      );
      return null;
    }, t('web.history.downloadFailed'));

  const downloadRecording = () =>
    run(async () => {
      say({ tone: 'busy', text: t('web.history.preparingDownload') });
      const blob = await fetchConversationAudio(id);
      saveBlob(blob, exportFilename(conversation, recordingExtension(blob.type)));
      return null;
    }, t('web.history.downloadFailed'));

  return { busy, notice, known, copy, download, downloadRecording };
}
