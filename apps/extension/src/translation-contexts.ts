import {
  translationContextListResponseSchema,
  type TranslationContext,
  type TranslationHints,
} from '@chatofy/types';
import { getFreshAccessToken } from './access-token';

/**
 * The extension's own read of a saved AI Context library.
 *
 * Read-only, and deliberately: the popup is the wrong size for authoring 24 term
 * pairs, and both the web editor and this popup read the same
 * `GET /translation-contexts` — authoring happens only on web.
 *
 * Authenticated with {@link getFreshAccessToken}, not a token the popup happened
 * to store earlier: an access token now lives fifteen minutes, and a capture
 * that reused a stale one would be refused at the point nothing on screen can
 * explain why.
 */

/** What one list attempt produced, including the reason it produced nothing. */
export interface TranslationContextsResult {
  contexts: TranslationContext[];
  /** Set on any failure. The list is still usable — it is simply empty. */
  message?: string;
}

/**
 * Fetch the caller's saved contexts.
 *
 * Never throws and never prevents a meeting from starting: a network failure,
 * an expired session, or a response that fails to parse all read back as an
 * empty list with a message, not as an exception a caller has to guard against.
 */
export async function listTranslationContexts(
  apiBaseUrl: string,
): Promise<TranslationContextsResult> {
  const accessToken = await getFreshAccessToken(apiBaseUrl);
  if (accessToken === null) {
    return { contexts: [], message: 'Sign in to use a saved context' };
  }

  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl}/translation-contexts`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
  } catch {
    return { contexts: [], message: `Cannot reach ${apiBaseUrl}` };
  }

  if (!res.ok) {
    return { contexts: [], message: `Could not load your saved contexts (HTTP ${res.status})` };
  }

  const body = (await res.json().catch(() => null)) as { data?: unknown } | null;
  const parsed = translationContextListResponseSchema.safeParse(body?.data);
  if (!parsed.success) {
    return { contexts: [], message: 'Could not read your saved contexts' };
  }

  return { contexts: parsed.data.contexts };
}

/**
 * The stored selection, resolved against the fetched list.
 *
 * Returns `null` for an id that no longer resolves, never an error. Nothing
 * whitelists a stale `contextId` out of storage (`settings.ts`) — this is where
 * that leniency is made safe: a deleted or not-yet-loaded context reads as "no
 * context", and the caller renders the same either way.
 */
export function resolveContext(
  contexts: TranslationContext[],
  contextId: string | undefined,
): TranslationContext | null {
  if (contextId === undefined) return null;
  return contexts.find((context) => context.id === contextId) ?? null;
}

/**
 * A stored context as the wire's hints.
 *
 * Mirrors the web app's own helper of the same name (`translate-settings`
 * plumbing): `undefined`, never `{}`, when nothing is selected, so a capture
 * with no context produces a session byte-identical to one from before this
 * feature existed. `glossary` is passed through as the stored `{vi, en}` pairs
 * untouched — which side is the source is resolved server-side, in the prompt
 * builder, because only the session (and here, only `MeetingCapture`, which
 * starts one session per direction) knows it.
 */
export function toHints(context: TranslationContext | null): TranslationHints | undefined {
  if (context === null) return undefined;

  const hints: TranslationHints = {};
  if (context.topic !== null) hints.topic = context.topic;
  if (context.hotwords.length > 0) hints.hotwords = context.hotwords;
  if (context.glossary.length > 0) hints.glossary = context.glossary;
  if (context.style !== null) hints.style = context.style;
  return hints;
}
