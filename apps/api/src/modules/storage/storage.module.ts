import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Env } from '../../config/env.schema';
import { DisabledAvatarStorage } from './disabled-avatar-storage';
import { R2AvatarStorage, type R2Config } from './r2-avatar-storage';
import type { AvatarStorage } from './interfaces/avatar-storage.interface';
import { AVATAR_STORAGE } from './interfaces/avatar-storage.interface';

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
 * The API's object-storage seam: exports ONLY AVATAR_STORAGE.
 *
 * Which implementation binds is decided once, here, from configuration —
 * nothing above this module branches on whether R2 is set up. The same argument
 * MailModule makes for MAIL_SENDER: a consumer that could reach a concrete class
 * is a consumer that can bypass the decision.
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
  ],
  exports: [AVATAR_STORAGE],
})
export class StorageModule {}
