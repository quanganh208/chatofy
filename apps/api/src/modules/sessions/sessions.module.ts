import { Module } from '@nestjs/common';
import { SESSION_STORE } from './interfaces/session-store.interface';
import { SessionsService } from './sessions.service';
import { MemorySessionStore } from './stores/memory-session.store';

/**
 * Sessions module — binds SESSION_STORE token to MemorySessionStore (dev default).
 * Replace with RedisSessionStore or PrismaSessionStore for production.
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
