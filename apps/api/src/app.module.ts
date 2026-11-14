import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module';
import { AppConfigModule } from './config/app-config.module';
import { AuthModule } from './modules/auth/auth.module';
import { CreditsModule } from './modules/credits/credits.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { GlossariesModule } from './modules/glossaries/glossaries.module';
import { TeamsModule } from './modules/teams/teams.module';
import { TranslationContextsModule } from './modules/translation-contexts/translation-contexts.module';
import { HealthModule } from './modules/health/health.module';
import { MetaModule } from './modules/meta/meta.module';
import { MinutesModule } from './modules/minutes/minutes.module';
import { PreferencesModule } from './modules/preferences/preferences.module';
import { StorageModule } from './modules/storage/storage.module';
import { ConferenceModule } from './modules/conference/conference.module';
import { TranslateModule } from './modules/translate/translate.module';
import { UsersModule } from './modules/users/users.module';
import { PrismaModule } from './prisma/prisma.module';

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
    PreferencesModule,
    ConversationsModule,
    TranslationContextsModule,
    GlossariesModule,
    TeamsModule,
    StorageModule,
    TranslateModule,
    ConferenceModule,
    MinutesModule,
    CreditsModule,
    HealthModule,
    MetaModule,
  ],
})
export class AppModule {}
