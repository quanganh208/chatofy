import { Module } from '@nestjs/common';
import { USER_REPOSITORY } from './interfaces/user-repository.interface';
import { PrismaUserRepository } from './repositories/prisma-user.repository';
import { UsersService } from './users.service';

/**
 * Users module — binds USER_REPOSITORY token to PrismaUserRepository.
 * Swap to an in-memory or mock repository for testing without Prisma.
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
