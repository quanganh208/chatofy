// What a local speech sidecar's own `/healthz` says it can serve — the runtime
// source of truth `SpeechLanguageSupport` (apps/api) checks the TS registry
// against, rather than trusting a generated list that could drift from what
// the sidecar actually loaded. Shared between the STT and TTS local
// providers because both sidecars publish the same `{languages: string[]}`
// shape on `/healthz`.
import { toLanguageCode, type LanguageCode } from '@chatofy/types';
import type { ServedLanguages } from '../../interfaces/stt-provider.js';
import { fetchWithDeadline } from '../http-util.js';

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * Reads `/healthz` and returns the registry codes it named, or `null` when the
 * answer cannot be trusted — a network failure or timeout, an older sidecar
 * deployed before this field existed, or a `languages` list that named no
 * registry language. All three collapse to the SAME "not known right now"
 * state on purpose: a caller deciding whether to refuse a turn must not tell a
 * sidecar that is merely old apart from one that is merely down, and an empty
 * list is indistinguishable from either — `SUPPORTED_LANGUAGES` on a real
 * sidecar is static and never empty (see `services/local-stt/app.py`).
 *
 * The body is read regardless of HTTP status: `/healthz` answers 503 while
 * models are still loading, but `languages` does not depend on load state.
 *
 * A code the sidecar sent that names no registry language is returned in
 * `unknown` rather than logged here — parity between the sidecar and the TS
 * registry is ⊆, so a sidecar reporting more than the registry knows is a
 * mismatch worth a warning, never a reason to refuse anything. The warning is
 * the caller's to raise: this runs on every refresh, and only the caller knows
 * whether it already said so.
 */
export async function readServedLanguages(
  baseUrl: string,
  timeoutMs: number,
): Promise<ServedLanguages | null> {
  let body: unknown;
  try {
    const res = await fetchWithDeadline(
      `${baseUrl}/healthz`,
      {},
      timeoutMs,
      'Sidecar health check',
    );
    body = await res.json();
  } catch {
    return null;
  }

  const languages =
    body !== null && typeof body === 'object'
      ? (body as { languages?: unknown }).languages
      : undefined;
  if (!isStringArray(languages)) return null;

  const known: LanguageCode[] = [];
  const unknown: string[] = [];
  for (const tag of languages) {
    const code = toLanguageCode(tag);
    if (code) {
      if (!known.includes(code)) known.push(code);
    } else if (!unknown.includes(tag)) {
      unknown.push(tag);
    }
  }
  return known.length > 0 ? { known, unknown } : null;
}
