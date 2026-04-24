import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { SessionsModule } from './modules/sessions/sessions.module.js';
import { TranslateModule } from './modules/translate/translate.module.js';
import { HealthModule } from './modules/health/health.module.js';

/**
 * Root application module.
 * AppConfigModule and PrismaModule are @Global — no need to import them in child modules.
 * No controllers at root level; all routes are owned by feature modules.
 */
@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    AuthModule,
    UsersModule,
    SessionsModule,
    TranslateModule,
    HealthModule,
  ],
})
export class AppModule {}
