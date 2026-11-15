'use client';

import { useCallback } from 'react';
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
import { useScopedLibrary } from './use-scoped-library';

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
 * the settings whitelist's own, for the voice token: bound it in storage,
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
 * session knows its language pair — and the extension runs two sessions with
 * opposite pairs off one selection.
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

/** What {@link useTranslationContexts} hands back. */
export interface TranslationContextsValue {
  contexts: TranslationContext[];
  status: TranslationContextsState;
  /** The scope the rows belong to: `undefined` is personal, else the team's id. */
  teamId: string | undefined;
  /** Writes take the scope captured when their editor opened, never the live one. */
  save: (
    contextId: string,
    body: SaveTranslationContextRequest,
    teamId: string | undefined,
  ) => Promise<void>;
  remove: (contextId: string, teamId: string | undefined) => Promise<void>;
  retry: () => Promise<void>;
}

/** Team rows carry `canEdit`; a personal row is always the caller's own. */
const fetchContexts = (teamId: string | undefined) =>
  listTranslationContexts(teamId).then((result) =>
    result.contexts.map((context) => ({ ...context, canEdit: context.canEdit ?? true })),
  );

/**
 * The AI Context library the reader MANAGES: the active workspace's, with the
 * writes that change it. The translate picker does not read this: it reads every
 * context the reader may use (`use-available-translation-contexts.ts`).
 *
 * Fetches per scope, not from a module cache: the list is a property of the user
 * or the team and changes while they look at it. A save or a delete refetches
 * rather than splicing the response in, because the server decides `updatedAt`,
 * the list's sort key. The scope rules are `use-scoped-library.ts`'s.
 */
export function useTranslationContexts(): TranslationContextsValue {
  const { teamId, rows, status, write, retry } = useScopedLibrary(true, fetchContexts);

  const save = useCallback(
    (contextId: string, body: SaveTranslationContextRequest, scope: string | undefined) =>
      write(scope, () => saveTranslationContext(contextId, body, scope)),
    [write],
  );
  const remove = useCallback(
    (contextId: string, scope: string | undefined) =>
      write(scope, () => deleteTranslationContext(contextId, scope)),
    [write],
  );

  return { contexts: rows, status, teamId, save, remove, retry };
}
