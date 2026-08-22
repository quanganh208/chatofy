import { Module } from '@nestjs/common';
import { USER_REPOSITORY } from './interfaces/user-repository.interface';
import { PrismaUserRepository } from './repositories/prisma-user.repository';
import { UsersService } from './users.service';

/**
 * Users module — binds USER_REPOSITORY token to PrismaUserRepository.
 * Swap to an in-memory or mock repository for testing without Prisma.
 *
 * USER_REPOSITORY is exported as well as UsersService: AuthService talks to the
 * repository directly, because the reads it needs — credentials, and the Google
 * lookups — carry secret material that has no business on a general-purpose
 * service every module can inject.
 */
@Module({
  providers: [
    UsersService,
    {
      provide: USER_REPOSITORY,
      useClass: PrismaUserRepository,
    },
  ],
  exports: [UsersService, USER_REPOSITORY],
})
export class UsersModule {}
