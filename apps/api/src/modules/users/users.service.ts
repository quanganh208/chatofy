import { Inject, Injectable } from '@nestjs/common';
import {
  CreateUserDto,
  UpdateUserDto,
  UserRecord,
  UserRepository,
  USER_REPOSITORY,
} from './interfaces/user-repository.interface';

/**
 * Users service — thin facade over UserRepository.
 * Place domain validation / business rules here (not in the repository).
 */
@Injectable()
export class UsersService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepo: UserRepository,
  ) {}

  findById(id: string): Promise<UserRecord | null> {
    return this.userRepo.findById(id);
  }

  findByEmail(email: string): Promise<UserRecord | null> {
    return this.userRepo.findByEmail(email);
  }

  create(dto: CreateUserDto): Promise<UserRecord> {
    return this.userRepo.create(dto);
  }

  update(id: string, dto: UpdateUserDto): Promise<UserRecord> {
    return this.userRepo.update(id, dto);
  }
}
