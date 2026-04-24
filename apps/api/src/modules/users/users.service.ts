import { Inject, Injectable } from '@nestjs/common';
import {
  USER_REPOSITORY,
  type CreateUserInput,
  type UpdateUserInput,
  type UserRecord,
  type UserRepository,
} from './interfaces/user-repository.interface.js';

/**
 * UsersService delegates all persistence to the USER_REPOSITORY token.
 * Business logic (e.g. upsert-on-auth) will be added here — not in the repository.
 */
@Injectable()
export class UsersService {
  constructor(@Inject(USER_REPOSITORY) private readonly repo: UserRepository) {}

  findById(id: string): Promise<UserRecord | null> {
    return this.repo.findById(id);
  }

  findByEmail(email: string): Promise<UserRecord | null> {
    return this.repo.findByEmail(email);
  }

  create(input: CreateUserInput): Promise<UserRecord> {
    return this.repo.create(input);
  }

  update(id: string, input: UpdateUserInput): Promise<UserRecord> {
    return this.repo.update(id, input);
  }
}
