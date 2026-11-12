'use client';

import { useRef, useState } from 'react';
import type { Conversation, ConversationSummary, MinutesContent } from '@chatofy/types';
import { fetchConversationAudio, getConversation } from '@/clients/api-client';
import { useLocale, useTranslate } from '@/i18n/provider';
import { notify } from '@/lib/notify';
import { saveBlob, textBlob } from '@/lib/save-file';
import { minutesOrNull } from './conversation-cache';
import { transcriptMarkdown, transcriptText } from './conversation-export';
import { exportFilename, recordingExtension } from './conversation-export-filename';
import { canExportSrt, transcriptSrt } from './conversation-export-srt';
import { useHistoryPanes } from './history-panes-context';

/** A failure a second try cannot fix, said as it is and with no Retry. */
class Unfixable extends Error {}

export type TranscriptFormat = 'txt' | 'md' | 'srt';

/** What a finished action reports: a toast, or nothing more to say. */
type Outcome = { message: string } | null;

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
 * Outcomes are toasts, one per conversation (a stable id): "Copying…" or
 * "Preparing the download…" while a fetch runs, replaced in place by "Transcript
 * copied", "Downloaded <file>", or a failure that stays until dismissed and offers
 * Retry. The menu has closed by then, so a line beside it was a line nobody saw.
 *
 * One action at a time: `busy` disables the others, because a second download
 * started while the first is still fetching would race it for the toast.
 */
export function useConversationFileActions({ conversation, loaded, minutes }: FileActionsInput) {
  const t = useTranslate();
  const locale = useLocale();
  const panes = useHistoryPanes();
  const id = conversation.conversationId;
  const toastId = `conversation-file-${id}`;
  const [busy, setBusy] = useState(false);
  // The guard itself is a ref: two activations inside one render would both read
  // `busy` as false. The state is only what the menu draws.
  const running = useRef(false);

  /** The full conversation, with the latest title: a rename updates the summary first. */
  const full = async (): Promise<Conversation> => {
    const found =
      loaded ?? (panes ? await panes.cache.load(id) : (await getConversation(id)).conversation);
    // Deleted while it was being fetched — from the header or another row. Nothing
    // is saved or copied for a conversation that no longer exists.
    if (panes?.cache.isGone(id)) throw new Error('The conversation was deleted');
    return { ...found, title: conversation.title };
  };

  /** What the menu can tell without fetching: the open detail's copy, or a cached one. */
  const known = (): Conversation | undefined => loaded ?? panes?.cache.peek(id);

  // Synchronous up to `work()`'s first await, which is what lets `copy` reach the
  // clipboard inside the reader's gesture.
  const run = async (
    work: () => Promise<Outcome>,
    failure: string,
    retry: (() => void) | null,
    pending = t('web.history.preparingDownload'),
  ) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    if (!known()) notify.info(pending, { id: toastId });
    try {
      const done = await work();
      if (done) notify.success(done.message, { id: toastId });
      else notify.dismiss(toastId);
    } catch (error) {
      if (error instanceof Unfixable) notify.error(error.message, { id: toastId });
      else notify.error(failure, { id: toastId, ...(retry ? { retry } : {}) });
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  /**
   * The clipboard is written inside the reader's gesture, or Safari refuses it. A
   * conversation already held is written at once. One that must be fetched first
   * goes in as a `ClipboardItem` built from the PENDING text, which the browser
   * accepts within the gesture and fills when the fetch lands; where that is not
   * supported, the text is written after the fetch — fine in Chromium and Firefox.
   */
  const copy = (): Promise<void> =>
    run(
      async () => {
        const held = known();
        const clipboard = navigator.clipboard;
        if (held) {
          await clipboard.writeText(
            transcriptText({ ...held, title: conversation.title }, t, locale),
          );
        } else if (typeof ClipboardItem !== 'undefined' && typeof clipboard.write === 'function') {
          const blob = full().then(
            (source) => new Blob([transcriptText(source, t, locale)], { type: 'text/plain' }),
          );
          await clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
        } else {
          const text = transcriptText(await full(), t, locale);
          await clipboard.writeText(text);
        }
        return { message: t('web.history.transcriptCopied') };
      },
      t('web.history.copyFailed'),
      () => void copy(),
      t('web.history.copying'),
    );

  const downloaded = (filename: string): Outcome => ({
    message: t('web.history.downloaded', { file: filename }),
  });

  const download = (format: TranscriptFormat): Promise<void> =>
    run(
      async () => {
        const source = await full();
        if (format === 'srt') {
          // A row cannot know before fetching whether every turn carries a time, so
          // the item is offered and the reason is given here instead of a file.
          // Retrying cannot help, so this failure offers no Retry.
          if (!canExportSrt(source)) throw new Unfixable(t('web.history.subtitlesNeedTimes'));
          const filename = exportFilename(source, 'srt');
          saveBlob(textBlob(transcriptSrt(source), 'application/x-subrip', true), filename);
          return downloaded(filename);
        }
        if (format === 'md') {
          const held =
            minutes !== undefined
              ? minutes
              : conversation.hasMinutes
                ? await minutesOrNull(id)
                : null;
          const filename = exportFilename(source, 'md');
          saveBlob(
            textBlob(transcriptMarkdown(source, t, locale, held), 'text/markdown', false),
            filename,
          );
          return downloaded(filename);
        }
        const filename = exportFilename(source, 'txt');
        saveBlob(textBlob(transcriptText(source, t, locale), 'text/plain', true), filename);
        return downloaded(filename);
      },
      t('web.history.downloadFailed'),
      () => void download(format),
    );

  const downloadRecording = (): Promise<void> =>
    run(
      async () => {
        // The recording is never cached, so it always says it is on its way.
        notify.info(t('web.history.preparingDownload'), { id: toastId });
        const blob = await fetchConversationAudio(id);
        const filename = exportFilename(conversation, recordingExtension(blob.type));
        saveBlob(blob, filename);
        return downloaded(filename);
      },
      t('web.history.downloadFailed'),
      () => void downloadRecording(),
    );

  return { busy, known, copy, download, downloadRecording };
}
