import { Inject, Injectable } from '@nestjs/common';
import {
  UserAuthState,
  UserRecord,
  UserRepository,
  USER_REPOSITORY,
} from './interfaces/user-repository.interface';

/**
 * The user reads that carry NO secret material.
 *
 * Deliberately narrower than `UserRepository`, and that is the whole reason it
 * exists: the repository's other reads return password hashes and Google
 * subjects, which have no business on a service every module can inject. The
 * three auth flows take `USER_REPOSITORY` directly because they genuinely need
 * those columns; everything else takes this.
 *
 * So a method belongs here only if it is safe for any caller to hold. Anything
 * that returns credentials stays on the repository.
 */
@Injectable()
export class UsersService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepo: UserRepository,
  ) {}

  findById(id: string): Promise<UserRecord | null> {
    return this.userRepo.findById(id);
  }

  /**
   * The revocation read, exposed because `JwtAuthAdapter` injects this service
   * rather than the repository.
   *
   * A passthrough and nothing more — no caching. A TTL here would re-open the
   * window revocation exists to close, and it would do so invisibly, in the one
   * place nothing else would notice.
   */
  findAuthStateById(id: string): Promise<UserAuthState | null> {
    return this.userRepo.findAuthStateById(id);
  }
}
