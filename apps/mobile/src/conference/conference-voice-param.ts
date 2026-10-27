/**
 * The translated-voice gender the lobby passed to the call screen, read without
 * trusting it: a route param is a string or nothing, and anything that is not a
 * known gender is the schema default.
 *
 * Pure (no React Native imports), so it runs under `node --test`.
 */
import { DEFAULT_VOICE_GENDER, voiceGenderSchema, type VoiceGender } from '@chatofy/types/domain';

export function parseVoiceGenderParam(raw: unknown): VoiceGender {
  const parsed = voiceGenderSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_VOICE_GENDER;
}
