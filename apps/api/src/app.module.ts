import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import { CommonModule } from './common/common.module';
import { AppConfigModule } from './config/app-config.module';
import { AuthModule } from './modules/auth/auth.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { TranslationContextsModule } from './modules/translation-contexts/translation-contexts.module';
import { HealthModule } from './modules/health/health.module';
import { MetaModule } from './modules/meta/meta.module';
import { MinutesModule } from './modules/minutes/minutes.module';
import { StorageModule } from './modules/storage/storage.module';
import { ConferenceModule } from './modules/conference/conference.module';
import { TranslateModule } from './modules/translate/translate.module';
import { UsersModule } from './modules/users/users.module';
import { PrismaModule } from './prisma/prisma.module';
import { envSchema } from './config/env.schema';

/**
 * Root application module.
 * Imports only — no controllers or providers registered here.
 * AppConfigModule and PrismaModule are @Global so they need not be re-imported by feature modules.
 */
@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    CommonModule,
    AuthModule,
    UsersModule,
    ConversationsModule,
    TranslationContextsModule,
    StorageModule,
    TranslateModule,
    // Imported only when CONFERENCE_ENABLED is on. Off, nothing conference-
    // related loads: no Cloudflare SFU client, no /ws/conference, no
    // /conference routes. Read after ConfigModule has loaded .env, through
    // the same schema field that validates it, so the two can never disagree.
    ConditionalModule.registerWhen(ConferenceModule, (env) =>
      envSchema.shape.CONFERENCE_ENABLED.parse(env['CONFERENCE_ENABLED']),
    ),
    MinutesModule,
    HealthModule,
    MetaModule,
  ],
})
export class AppModule {}
