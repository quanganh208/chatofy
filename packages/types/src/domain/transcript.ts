// Transcript segment domain types — schema-first. This is the CANONICAL segment
// shape; events/ws-events.ts imports it instead of redeclaring inline.
import { z } from 'zod';
import { speakerRoleSchema } from './session.js';
// Language codes and directions are owned by the registry (`languages.ts`).
import {
  directionLanguages,
  sourceLanguagesSchema,
  translationDirectionSchema,
  translationMapSchema,
} from './languages.js';

/**
 * Which voice speaks the translation.
 *
 * The only PORTABLE voice selector: gender is the one way of naming a voice that
 * means the same thing to every backend, so it is what a caller uses when it
 * knows nothing about what is running.
 *
 * A caller may also name a specific voice, and this comment used to say it could
 * not. It does so with an opaque token discovered at runtime from the backend
 * itself (`sessionOptions.voice`), never with a value any client hardcodes — the
 * concrete voices are still a speaker id for English and a preset name for
 * Vietnamese, and those vocabularies still belong to the backend alone. An
 * unrecognised token falls back to the gender voice rather than failing the turn,
 * which is what keeps a stale saved choice from costing someone their audio.
 */
export const voiceGenderSchema = z.enum(['female', 'male']);
export type VoiceGender = z.infer<typeof voiceGenderSchema>;

/** Applied wherever the caller may leave the voice unstated. */
export const DEFAULT_VOICE_GENDER: VoiceGender = 'female';

/**
 * The canonical, server-side shape of one turn's record.
 *
 * `direction` and `targetText` are the pre-fan-out fields, KEPT rather than
 * replaced: no client reads them off this record today (`git grep` from the
 * caller's side finds only server code writing them), but the client-side
 * schema still requires them, and `apps/api`/`apps/web` do not deploy
 * atomically. `sourceLanguages` and `translations` are additive — a turn with
 * one source and one target still fills both, `targetText` mirroring
 * `translations[spoken]`.
 *
 * STRICT: no preprocessing. A caller building a segment (only `TurnSession`
 * does) must supply every field, so a server that forgot to fill a new one
 * fails to typecheck rather than being quietly patched here. Backward-
 * compatible PARSING of a segment that predates these two fields is a
 * separate concern — see {@link transcriptSegmentWireSchema} — and belongs
 * only to a client, never to the server that builds this record.
 */
export const transcriptSegmentSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  speakerRole: speakerRoleSchema,
  direction: translationDirectionSchema,
  sourceLanguages: sourceLanguagesSchema,
  translations: translationMapSchema(z.string()),
  sourceText: z.string(),
  targetText: z.string(),
  audioUrl: z.string().nullable(),
  createdAt: z.string(),
});
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;

/**
 * `transcriptSegmentSchema`, tolerant of a segment sent before `sourceLanguages`
 * and `translations` existed.
 *
 * The ONE place this fallback lives, and it is wired into exactly the schema a
 * CLIENT parses an incoming segment with (`ws-events.ts`'s
 * `server.transcript.final`) — never into what the server itself builds or
 * validates. `apps/api` and `apps/web` do not deploy atomically
 * (`ws-events.ts` says so for the same reason elsewhere), so a fresh tab can
 * be talking to an API that was rolled back to before these two fields
 * existed. That segment carries only `direction` and `targetText`, and this
 * preprocessing is what keeps the client's parse of it from failing outright.
 *
 * A compatibility shim, not a permanent second schema: remove it together
 * with the legacy `direction`/`targetText` wire fields, once no deployed API
 * can predate the new ones.
 */
export const transcriptSegmentWireSchema = z.preprocess((raw) => {
  if (typeof raw !== 'object' || raw === null) return raw;
  const segment = raw as Record<string, unknown>;
  if (segment.sourceLanguages !== undefined || segment.translations !== undefined) {
    return segment;
  }
  const { direction } = segment;
  if (typeof direction !== 'string') return segment;
  const { source, target } = directionLanguages(direction);
  return {
    ...segment,
    sourceLanguages: [source],
    translations: { [target]: segment.targetText },
  };
}, transcriptSegmentSchema);
