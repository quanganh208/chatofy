import { randomBytes } from 'node:crypto';
import { HISTORY_LIMITS } from '@chatofy/types';

/**
 * The largest recording this API will store, re-exported from the shared
 * contract rather than redefined.
 *
 * It lives in `@chatofy/types` because the BROWSER needs the same number: the
 * client refuses an oversized blob locally instead of spending the upload to
 * earn a 413. Two copies of a ceiling drift.
 */
export const MAX_CONVERSATION_AUDIO_BYTES =
  HISTORY_LIMITS.MAX_CONVERSATION_AUDIO_BYTES;

/** A container this API is willing to store and hand back. */
export type ConversationAudioType = { mime: string; ext: string };

/**
 * Every accepted container, keyed by the bytes that identify it.
 *
 * WebM/Matroska opens with the EBML magic `1A 45 DF A3`. MP4 and its relatives
 * carry `ftyp` at offset 4, after the box's own length — which is why this is
 * matched at 4 rather than as a prefix. Both are needed: Chromium and Firefox
 * produce WebM, and Safari's `MediaRecorder` produces MP4 and cannot play WebM
 * at all.
 */
const SIGNATURES: ReadonlyArray<{
  type: ConversationAudioType;
  matches: (bytes: Buffer) => boolean;
}> = [
  {
    type: { mime: 'audio/webm', ext: 'webm' },
    matches: (b) =>
      b.length >= 4 &&
      b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])),
  },
  {
    type: { mime: 'audio/mp4', ext: 'm4a' },
    matches: (b) => b.length >= 12 && b.toString('ascii', 4, 8) === 'ftyp',
  },
];

/**
 * Decides the container from the bytes themselves. Null means "not audio we
 * accept".
 *
 * The client's declared `Content-Type` is never consulted, for the reason
 * `sniffAvatarImage` gives: these are user-supplied bytes and a declared type is
 * a claim. The sniffed value is what is stored as the object's `ContentType` and
 * what the download route sets on the way back, so a payload that is not audio
 * can never be served back as whatever its uploader named it.
 *
 * Rejecting an empty buffer here rather than letting it through is deliberate: a
 * zero-byte recording is a failed capture, and storing one would put a player on
 * a conversation with nothing to play.
 */
export function sniffConversationAudio(
  bytes: Buffer,
): ConversationAudioType | null {
  if (bytes.length === 0 || bytes.length > MAX_CONVERSATION_AUDIO_BYTES) {
    return null;
  }
  return SIGNATURES.find((entry) => entry.matches(bytes))?.type ?? null;
}

/**
 * `conversations/{ownerId}/{random16}.{ext}`.
 *
 * ## The entropy is load-bearing here, unlike in `buildAvatarKey`
 *
 * That function's comment says "nothing in this design LEANS on unguessability —
 * the bucket is public-read by product intent", which is true of avatars: a
 * photograph a user chose to display is meant to be fetchable.
 *
 * **This design does lean on it.** Conversation recordings share that same
 * public-read bucket under a `conversations/` prefix, and a prefix is a
 * NAMESPACE, not an access boundary — R2 publishes a bucket as a unit. So every
 * object here is reachable by anyone holding its URL, and the random half is the
 * only thing standing between a stored conversation and a guessed one.
 *
 * That is a product decision, made deliberately against the alternative of a
 * second private bucket, and it is recorded in
 * `plans/260914-1036-conversation-audio-recording/plan.md`. Two consequences for
 * anyone editing this function:
 *
 * 1. **Never make the key derivable.** No conversation id, no timestamp, no
 *    content hash alone. The conversation id in particular appears in the URL bar
 *    and in browser history, so a key built from it would be readable by anyone
 *    who ever saw a link.
 * 2. **Never widen the alphabet downward.** 8 random bytes is 64 bits; that is
 *    what the guess costs.
 *
 * ## Why it is deterministic per upload, not per attempt
 *
 * The key is minted ONCE per conversation and then reused: the service reads the
 * row's existing `audioKey` first and only calls this when there is none. A
 * fresh key on every retry would leave the first attempt's object in the bucket
 * with nothing pointing at it — unreachable, unbilled to any row, and impossible
 * to find later except by listing the prefix.
 */
export function buildConversationAudioKey(
  ownerId: string,
  type: ConversationAudioType,
): string {
  const entropy = randomBytes(8).toString('hex');
  return `conversations/${ownerId}/${entropy}.${type.ext}`;
}
