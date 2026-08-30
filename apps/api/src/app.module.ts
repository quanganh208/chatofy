import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module';
import { AppConfigModule } from './config/app-config.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { MetaModule } from './modules/meta/meta.module';
import { MinutesModule } from './modules/minutes/minutes.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { StorageModule } from './modules/storage/storage.module';
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
    SessionsModule,
    StorageModule,
    TranslateModule,
    MinutesModule,
    HealthModule,
    MetaModule,
  ],
})
export class AppModule {}
