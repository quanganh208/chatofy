import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthSession, ChangePasswordRequest } from '@chatofy/types';
import { AuthService } from './auth.service';
import { PasswordHasher } from './password-hasher';
import { SessionTerminator } from './session-terminator';
import type { UserRepository } from '../users/interfaces/user-repository.interface';
import { USER_REPOSITORY } from '../users/interfaces/user-repository.interface';

/** A wrong current password. Never 401 — see `changePassword`. */
const WRONG_CURRENT_PASSWORD = 'Your current password is incorrect';

/** A row with no password to check against — a Google-first account. */
const NO_PASSWORD_SET =
  'This account has no password yet. Use "Forgot password" to set one.';

/**
 * A signed-in user replacing their own password.
 *
 * It revokes exactly what a reset revokes — every access token, every refresh
 * family and every open socket issued under the old password — through the same
 * stamp. The difference is the device asking: it has just proved both the session
 * and the current password, so it is handed a replacement session rather than
 * being sent to sign in. Every other device is signed out.
 */
@Injectable()
export class PasswordChangeService {
  private readonly logger = new Logger(PasswordChangeService.name);

  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly terminator: SessionTerminator,
    private readonly auth: AuthService,
  ) {}

  /**
   * Verify the current password, write the new one, end everything else, and
   * mint this device's replacement session.
   *
   * A WRONG CURRENT PASSWORD IS 403, NEVER 401. Every client reads a 401 as "this
   * session is dead" — `use-auth-recovery.ts` on the web signs the user out on
   * one — so a typo here would end the session of the person correcting it.
   *
   * A row with no password (Google-first) is 409, not "incorrect": the caller is
   * authenticated, so saying what kind of account this is leaks nothing, and the
   * honest answer points at the flow that CAN set a first password.
   */
  async changePassword(
    userId: string,
    dto: ChangePasswordRequest,
  ): Promise<AuthSession> {
    const found = await this.users.findCredentialsById(userId);
    // The token verified a moment ago, so a missing row was deleted in between —
    // the same "no identity" the adapter answers for a gone user.
    if (!found) throw new UnauthorizedException('Invalid token');
    if (found.passwordHash === null)
      throw new ConflictException(NO_PASSWORD_SET);

    const matches = await this.hasher.verify(
      found.passwordHash,
      dto.currentPassword,
    );
    if (!matches) throw new ForbiddenException(WRONG_CURRENT_PASSWORD);

    // HASHED FIRST, THEN STAMPED, and ceiled — the reasoning is the reset's, in
    // `PasswordResetService.resetPassword`. In short: the old password works until
    // the write commits, so time spent hashing after taking the stamp widens the
    // band of credentials that outlive it, and truncating instead of ceiling would
    // let anything minted during this second survive.
    const passwordHash = await this.hasher.hash(dto.newPassword);
    //
    // Conditional on the hash just verified: a reset committed during the hash
    // above must not be overwritten by a change checked against the password it
    // replaced. Losing that race means the current password the caller typed is
    // no longer current, which is what 403 says.
    const written = await this.users.updatePasswordHash(
      userId,
      passwordHash,
      new Date(Math.ceil(Date.now() / 1000) * 1000),
      found.passwordHash,
    );
    if (!written) throw new ForbiddenException(WRONG_CURRENT_PASSWORD);
    const { user, changedAt } = written;

    // Including this device's own sockets: they authenticated with a token the
    // change just revoked, and they reconnect with the replacement below.
    const closed = this.terminator.terminate(userId);
    if (closed > 0) {
      this.logger.log(`closed ${closed} socket(s) after a password change`);
    }

    // MINTED AT THE STAMP, NOT AT NOW. The gate refuses a credential when
    // `floor(issuedAt) < changedAt`, and the stamp was ceiled to the NEXT second —
    // so a token issued now, inside the current second, would be refused on its
    // very first use, and the device that changed the password would be signed out
    // by its own success. Stamping both the access token and the refresh family at
    // `changedAt` puts them exactly on the boundary, where the strict `<` passes.
    // It is the stamp the repository WROTE, which only moves forward, so a reset
    // later in this same second still lands strictly after it and ends this
    // session too.
    return this.auth.sessionFor(user, {
      issuedAtSeconds: changedAt.getTime() / 1000,
    });
  }
}
