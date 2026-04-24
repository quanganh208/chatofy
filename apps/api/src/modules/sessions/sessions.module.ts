import { Module } from '@nestjs/common';
import { SESSION_STORE } from './interfaces/session-store.interface.js';
import { SessionsService } from './sessions.service.js';
import { MemorySessionStore } from './stores/memory-session.store.js';

/**
 * Sessions module — binds SESSION_STORE to MemorySessionStore by default.
 * For production, replace with RedisSessionStore by updating the useClass binding.
 * Exports SessionsService so TranslateModule and other modules can manage sessions.
 */
@Module({
  providers: [
    SessionsService,
    {
      provide: SESSION_STORE,
      useClass: MemorySessionStore,
    },
  ],
  exports: [SessionsService],
})
export class SessionsModule {}
