'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  deleteTranslationContext,
  listTranslationContexts,
  saveTranslationContext,
} from '@/clients/api-client';
import type {
  SaveTranslationContextRequest,
  TranslationContext,
  TranslationHints,
} from '@chatofy/types';

/**
 * What the library request produced.
 *
 * `ready` with an empty list and `failed` are separate states for the reason
 * `useVoiceCatalog` gives: an account that genuinely has no contexts and one
 * whose request could not be made both yield "nothing to show", and a UI that
 * treats them identically makes an expired session look exactly like a feature
 * working correctly.
 */
export type TranslationContextsState = 'loading' | 'ready' | 'failed';

/**
 * The stored selection, resolved against the fetched list.
 *
 * Returns `null` for an id that no longer resolves, never an error. The rule is
 * `loadTranslateSettings`'s own, for the voice token: bound it in storage,
 * reconcile it at the point of use, where the catalog has resolved. A deleted
 * context must read as "no context", and the panel must still render — the
 * alternative is a screen that cannot be used because of a row the user
 * themselves removed.
 */
export function resolveContext(
  contexts: TranslationContext[],
  contextId: string | null,
): TranslationContext | null {
  if (!contextId) return null;
  return contexts.find((context) => context.id === contextId) ?? null;
}

/**
 * A stored context as the wire's hints.
 *
 * `undefined`, never `{}`, when nothing is selected: a request with no hints
 * produces a prompt byte-identical to the one without this feature, which is
 * what lets the recorded injection baseline keep describing the default path. An
 * empty glossary array is omitted for the same reason, as is an empty hotword
 * list and a null topic.
 *
 * The glossary travels as the stored `{vi, en}` pairs, UNTOUCHED. Which side is
 * the source is resolved server-side in the prompt builder, because only the
 * session knows its direction — and the extension runs two sessions with
 * opposite directions off one selection.
 */
export function toHints(context: TranslationContext | null): TranslationHints | undefined {
  if (!context) return undefined;
  const hints: TranslationHints = {};
  if (context.topic) hints.topic = context.topic;
  if (context.hotwords.length) hints.hotwords = context.hotwords;
  if (context.glossary.length) hints.glossary = context.glossary;
  if (context.style) hints.style = context.style;
  return Object.keys(hints).length ? hints : undefined;
}

/**
 * The caller's AI Context library, with the writes that change it.
 *
 * One GET per mount rather than a module cache: unlike the voice catalog, this
 * list is a property of the USER and changes while they are looking at it — the
 * editor on `/preferences` is the thing that changes it — so a cache shared
 * across mounts would show a reader the library they had before their own edit.
 */
export function useTranslationContexts() {
  const [contexts, setContexts] = useState<TranslationContext[]>([]);
  const [status, setStatus] = useState<TranslationContextsState>('loading');

  const reload = useCallback(async () => {
    try {
      const result = await listTranslationContexts();
      setContexts(result.contexts);
      setStatus('ready');
      return result.contexts;
    } catch {
      // Deliberately not rethrown and deliberately not silent: the caller shows
      // `failed` rather than pretending the account has no contexts.
      setContexts([]);
      setStatus('failed');
      return [];
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    listTranslationContexts()
      .then((result) => {
        if (cancelled) return;
        setContexts(result.contexts);
        setStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setContexts([]);
        setStatus('failed');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Save one context and refetch.
   *
   * The refetch rather than a local splice: the server decides `updatedAt`,
   * which is the list's sort key, so writing the response into place would put
   * the row in an order the next load disagrees with.
   */
  const save = useCallback(
    async (contextId: string, body: SaveTranslationContextRequest) => {
      await saveTranslationContext(contextId, body);
      await reload();
    },
    [reload],
  );

  const remove = useCallback(
    async (contextId: string) => {
      await deleteTranslationContext(contextId);
      await reload();
    },
    [reload],
  );

  return { contexts, status, save, remove, reload };
}
