import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type {
  CreateUserInput,
  UpdateUserInput,
  UserRecord,
  UserRepository,
} from '../interfaces/user-repository.interface.js';

/**
 * Prisma-backed UserRepository skeleton.
 * Methods throw NotImplementedException — to be implemented when auth flow is wired.
 * PrismaService is injected but unused until implementation is complete.
 */
@Injectable()
export class PrismaUserRepository implements UserRepository {
  // PrismaService injected for future implementation — unused by stubs intentionally.
  constructor(private readonly prisma: PrismaService) {}

  findById(_id: string): Promise<UserRecord | null> {
    void this.prisma; // suppress unused warning until implemented
    throw new NotImplementedException('UserRepository.findById not implemented');
  }

  findByEmail(_email: string): Promise<UserRecord | null> {
    throw new NotImplementedException('UserRepository.findByEmail not implemented');
  }

  create(_input: CreateUserInput): Promise<UserRecord> {
    throw new NotImplementedException('UserRepository.create not implemented');
  }

  update(_id: string, _input: UpdateUserInput): Promise<UserRecord> {
    throw new NotImplementedException('UserRepository.update not implemented');
  }
}
