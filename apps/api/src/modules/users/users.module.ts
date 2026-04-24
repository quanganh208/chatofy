import { Module } from '@nestjs/common';
import { PrismaUserRepository } from './repositories/prisma-user.repository.js';
import { USER_REPOSITORY } from './interfaces/user-repository.interface.js';
import { UsersService } from './users.service.js';

/**
 * Users module — binds USER_REPOSITORY token to PrismaUserRepository.
 * Exports UsersService for use in other modules (e.g. AuthModule on login).
 */
@Module({
  providers: [
    UsersService,
    {
      provide: USER_REPOSITORY,
      useClass: PrismaUserRepository,
    },
  ],
  exports: [UsersService],
})
export class UsersModule {}
