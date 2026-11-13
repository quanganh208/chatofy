import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { USER_PREFERENCES_STORE } from './interfaces/user-preferences-store.interface';
import { PreferencesController } from './preferences.controller';
import { PreferencesService } from './preferences.service';
import { PrismaUserPreferencesStore } from './stores/prisma-user-preferences.store';

/**
 * Account preferences — the one document every client syncs its settings with.
 *
 * `useClass` behind a token, like `TranslationContextsModule`: the backend is not
 * a deployment choice, and the token is what lets a spec substitute a double.
 */
@Module({
  imports: [AuthModule],
  controllers: [PreferencesController],
  providers: [
    PreferencesService,
    { provide: USER_PREFERENCES_STORE, useClass: PrismaUserPreferencesStore },
  ],
})
export class PreferencesModule {}
