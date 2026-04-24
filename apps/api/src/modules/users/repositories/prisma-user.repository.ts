import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CreateUserDto,
  UpdateUserDto,
  UserRecord,
  UserRepository,
} from '../interfaces/user-repository.interface';

/**
 * Prisma-backed user repository.
 * Methods are stubbed — implement as domain logic is built out.
 * PrismaService is injected via the global PrismaModule.
 */
@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(_id: string): Promise<UserRecord | null> {
    throw new NotImplementedException('PrismaUserRepository.findById');
  }

  findByEmail(_email: string): Promise<UserRecord | null> {
    throw new NotImplementedException('PrismaUserRepository.findByEmail');
  }

  create(_dto: CreateUserDto): Promise<UserRecord> {
    throw new NotImplementedException('PrismaUserRepository.create');
  }

  update(_id: string, _dto: UpdateUserDto): Promise<UserRecord> {
    throw new NotImplementedException('PrismaUserRepository.update');
  }
}
