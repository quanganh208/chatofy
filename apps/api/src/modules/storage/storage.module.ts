import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Env } from '../../config/env.schema';
import { DisabledAvatarStorage } from './disabled-avatar-storage';
import { DisabledConversationAudioStorage } from './disabled-conversation-audio-storage';
import { R2AvatarStorage, type R2Config } from './r2-avatar-storage';
import { R2ConversationAudioStorage } from './r2-conversation-audio-storage';
import type { AvatarStorage } from './interfaces/avatar-storage.interface';
import { AVATAR_STORAGE } from './interfaces/avatar-storage.interface';
import type { ConversationAudioStorage } from './interfaces/conversation-audio-storage.interface';
import { CONVERSATION_AUDIO_STORAGE } from './interfaces/conversation-audio-storage.interface';

/**
 * The complete R2 configuration, or undefined when any part is missing.
 *
 * All-or-nothing by construction, mirroring `getSmtpConfig`. There is no
 * half-configured state where `put` succeeds and no public URL can be composed:
 * the base URL is required here too, even though it is the response mapper that
 * reads it, because storing bytes nobody can fetch is not a working feature.
 *
 * Exported so main.ts can report the unconfigured case at boot without
 * constructing a client.
 */
export function getR2Config(
  config: ConfigService<Env, true>,
): R2Config | undefined {
  const accountId = config.get('R2_ACCOUNT_ID', { infer: true });
  const accessKeyId = config.get('R2_ACCESS_KEY_ID', { infer: true });
  const secretAccessKey = config.get('R2_SECRET_ACCESS_KEY', { infer: true });
  const bucket = config.get('R2_BUCKET', { infer: true });
  const publicBaseUrl = config.get('R2_PUBLIC_BASE_URL', { infer: true });
  if (
    accountId === undefined ||
    accessKeyId === undefined ||
    secretAccessKey === undefined ||
    bucket === undefined ||
    publicBaseUrl === undefined
  ) {
    return undefined;
  }
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

/**
 * The API's object-storage seam: exports the two storage TOKENS and no class.
 *
 * Which implementation binds is decided once, here, from configuration —
 * nothing above this module branches on whether R2 is set up. The same argument
 * MailModule makes for MAIL_SENDER: a consumer that could reach a concrete class
 * is a consumer that can bypass the decision.
 *
 * **Both tokens read the SAME `getR2Config`, and that is a product decision
 * rather than an economy.** Conversation recordings share the avatars' bucket
 * under a `conversations/` prefix. R2 publishes a bucket as a unit and scopes its
 * tokens to a bucket rather than a prefix, so that prefix is a namespace and NOT
 * an access boundary: every recording is reachable by URL to anyone holding one.
 * The trade-off was taken deliberately over a second private bucket and is
 * recorded in `plans/260914-1036-conversation-audio-recording/plan.md`; the
 * mitigation is the 64 bits of entropy in `buildConversationAudioKey`, which is
 * why that function's docblock says the unguessability is load-bearing there and
 * is not in `buildAvatarKey`.
 *
 * One consequence for a future reader: if a private bucket is ever adopted, the
 * change is a second config reader and a different `bucket` on this factory —
 * not a data migration, because `Conversation.audioKey` stores a KEY and the
 * download route is already the only way in.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: AVATAR_STORAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): AvatarStorage => {
        const r2 = getR2Config(config);
        return r2 ? new R2AvatarStorage(r2) : new DisabledAvatarStorage();
      },
    },
    {
      provide: CONVERSATION_AUDIO_STORAGE,
      inject: [ConfigService],
      useFactory: (
        config: ConfigService<Env, true>,
      ): ConversationAudioStorage => {
        const r2 = getR2Config(config);
        return r2
          ? new R2ConversationAudioStorage(r2)
          : new DisabledConversationAudioStorage();
      },
    },
  ],
  exports: [AVATAR_STORAGE, CONVERSATION_AUDIO_STORAGE],
})
export class StorageModule {}
