import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'node:crypto';
import type { Env } from '../../config/env.schema';

/**
 * Stateless, single-purpose tokens for the two flows that arrive by email.
 *
 * No token table and no pending-registration table. Each token carries what it
 * needs, is signed with a key DERIVED from `AUTH_JWT_SECRET`, and expires.
 *
 * ## The derivation, and why the infix is not decoration
 *
 * Each purpose signs with `AUTH_JWT_SECRET` plus a purpose infix, so a token
 * minted for one flow cannot verify in another. Drop the infix and the schemes
 * collapse: a reset key of `AUTH_JWT_SECRET + (passwordHash ?? '')` is EXACTLY
 * `AUTH_JWT_SECRET` for a Google-first row that has no password — and that is
 * the key the API signs access tokens with. A stolen access token would then
 * verify as a reset token for whoever it names. `:register:` closes the same
 * collapse from the other side.
 *
 * A `purpose` claim is checked on redemption as well. The infix makes a
 * cross-purpose token fail to verify at all; the claim makes it fail loudly if
 * the derivation is ever weakened.
 *
 * ## Two rows derive an identical reset key, and that is safe
 *
 * Every row with a null `passwordHash` — every Google-first account, and every
 * account that never chose a password — derives the same reset key. So does any
 * pair of rows that happen to hold the same hash, which argon2's per-row salt
 * makes vanishingly unlikely but does not forbid.
 *
 * That is not a vulnerability, because an HMAC key is not a capability: holding
 * a token signed under a shared key proves nothing about which row it names.
 * `sub` carries the binding, and it is read from the VERIFIED payload. Password
 * reset is deliberately open to null-hash rows — see the reset flow — so this
 * case is reached in normal use, not only in theory.
 *
 * Anyone tempted to "improve" redemption by trusting an email or a hash supplied
 * by the caller instead of `sub` would break exactly this: read the binding from
 * the token, never from the request.
 */

/** What a verification link is authorised to do. */
export const REGISTER_PURPOSE = 'register';
/** What a reset link is authorised to do. */
export const PASSWORD_RESET_PURPOSE = 'pwreset';

/**
 * A day. Long enough to survive a mail that sits unread overnight, short enough
 * that an address abandoned mid-signup does not stay claimable indefinitely.
 */
export const REGISTER_TOKEN_TTL_SECONDS = 24 * 60 * 60;

/**
 * Thirty minutes. A reset link is strictly more powerful than a verification
 * link — it grants sign-in, where a verification link only creates an account
 * whose password the holder does not know — so it lives a fraction as long.
 */
export const PASSWORD_RESET_TOKEN_TTL_SECONDS = 30 * 60;

/**
 * An account that has been paid for with an argon2 hash but does not exist yet.
 *
 * The password is hashed BEFORE this is minted, so no plaintext ever leaves the
 * request that typed it. Holding the link lets someone create the account; it
 * does not let them sign into it, because they do not know the password it was
 * built from. That is strictly weaker than a reset link, which is the right
 * ordering for the one that is mailed to an address nobody has proved they own.
 */
export interface PendingRegistration {
  email: string;
  passwordHash: string;
  name: string;
}

/** One message for every unusable token, whatever made it unusable. */
const BAD_TOKEN = 'That link is invalid or has expired';

/**
 * The claim the registration token carries the password hash in — SEALED, never
 * the hash itself.
 *
 * A JWT is signed, not encrypted: its payload is base64, and this token is the
 * `?token=` of a URL that lands in a mailbox and stays there. Carried in the
 * clear, the argon2 hash of a password the person very likely reuses is readable
 * by anyone who can read that mail — the provider, a backup of it, whoever a
 * copy gets forwarded to — and is then crackable offline, at their leisure,
 * against every OTHER site that password opens. Chatofy itself is no worse off
 * (mailbox access already means account takeover here), which is exactly why
 * this is easy to wave through: the harm lands somewhere else.
 *
 * Sealing costs one AES-256-GCM pass with a key nobody outside this process has,
 * so the mail carries an opaque string and the exposure goes away. The name says
 * `sealed` so nothing later reads it expecting a hash.
 */
const SEALED_HASH_CLAIM = 'sealedPasswordHash';

/** Domain separation for the payload key — never the token-signing key. */
const PAYLOAD_KEY_INFO = 'chatofy:register-payload:v1';

/** AES-GCM's standard nonce and tag sizes, in bytes. */
const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;

@Injectable()
export class PurposeTokenService {
  private readonly secret: string;

  /**
   * The key that seals the registration payload, derived once.
   *
   * HKDF rather than the secret itself, and with an `info` string of its own, so
   * this key and the signing keys above are independent: none of them can be
   * used to reach any other, and rotating `AUTH_JWT_SECRET` rotates all of them
   * together — which is right, since it already invalidates every outstanding
   * token anyway.
   */
  private readonly payloadKey: Buffer;

  constructor(
    private readonly jwt: JwtService,
    @Inject(ConfigService) config: ConfigService<Env, true>,
  ) {
    this.secret = config.get('AUTH_JWT_SECRET', { infer: true });
    this.payloadKey = Buffer.from(
      hkdfSync('sha256', this.secret, '', PAYLOAD_KEY_INFO, 32),
    );
  }

  /**
   * Encrypts the password hash for its ride through a mailbox.
   *
   * A fresh random nonce per token, and the tag kept alongside it — so a
   * tampered payload fails to open rather than decrypting to something else.
   * `base64url`, because this ends up in a query string.
   */
  private sealPasswordHash(passwordHash: string): string {
    const iv = randomBytes(GCM_IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.payloadKey, iv);
    const body = Buffer.concat([
      cipher.update(passwordHash, 'utf8'),
      cipher.final(),
    ]);
    return [iv, cipher.getAuthTag(), body]
      .map((part) => part.toString('base64url'))
      .join('.');
  }

  /**
   * Opens what {@link sealPasswordHash} produced, or null if it will not open.
   *
   * Null for every failure — wrong shape, wrong sizes, a failed tag, a payload
   * minted under a rotated secret. The caller turns all of them into the same
   * BAD_TOKEN the signature failures already collapse into, because to whoever
   * followed the link they all mean the one thing: it does not work.
   */
  private openPasswordHash(sealed: string): string | null {
    const parts = sealed.split('.');
    if (parts.length !== 3) return null;
    const [ivPart = '', tagPart = '', bodyPart = ''] = parts;

    const iv = Buffer.from(ivPart, 'base64url');
    const tag = Buffer.from(tagPart, 'base64url');
    if (iv.length !== GCM_IV_BYTES || tag.length !== GCM_TAG_BYTES) return null;

    try {
      const decipher = createDecipheriv('aes-256-gcm', this.payloadKey, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(Buffer.from(bodyPart, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      return null;
    }
  }

  /** `AUTH_JWT_SECRET` bound to one purpose. See the note above. */
  private registerKey(): string {
    return `${this.secret}:${REGISTER_PURPOSE}:`;
  }

  /**
   * The reset key, bound to the purpose AND to the row's current password hash.
   *
   * Folding the hash in is what makes a reset link die the moment the password
   * changes: completing a reset writes a new hash, which derives a different
   * key, which no outstanding link verifies under. That covers single use, a
   * second reset, and a link that was mailed and then superseded — with no token
   * table to keep in step.
   */
  private passwordResetKey(passwordHash: string | null): string {
    return `${this.secret}:${PASSWORD_RESET_PURPOSE}:${passwordHash ?? ''}`;
  }

  issueRegistration(pending: PendingRegistration): Promise<string> {
    return this.jwt.signAsync(
      {
        email: pending.email,
        name: pending.name,
        // Field by field rather than `{ ...pending }`: a spread would put the
        // raw hash in the payload beside the sealed one, and the seal would be
        // decoration. Anything added to PendingRegistration later has to be
        // listed here deliberately, which is the point.
        [SEALED_HASH_CLAIM]: this.sealPasswordHash(pending.passwordHash),
        purpose: REGISTER_PURPOSE,
      },
      {
        secret: this.registerKey(),
        expiresIn: REGISTER_TOKEN_TTL_SECONDS,
      },
    );
  }

  /** Verifies a verification link and returns the account it would create. */
  async readRegistration(token: string): Promise<PendingRegistration> {
    const claims = await this.verify(token, this.registerKey());
    if (claims.purpose !== REGISTER_PURPOSE) {
      throw new UnauthorizedException(BAD_TOKEN);
    }

    const { email, name } = claims;
    const sealed = claims[SEALED_HASH_CLAIM];
    if (
      typeof email !== 'string' ||
      typeof sealed !== 'string' ||
      typeof name !== 'string'
    ) {
      throw new UnauthorizedException(BAD_TOKEN);
    }

    const passwordHash = this.openPasswordHash(sealed);
    if (passwordHash === null) throw new UnauthorizedException(BAD_TOKEN);

    return { email, passwordHash, name };
  }

  issuePasswordReset(
    userId: string,
    currentPasswordHash: string | null,
  ): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, purpose: PASSWORD_RESET_PURPOSE },
      {
        secret: this.passwordResetKey(currentPasswordHash),
        expiresIn: PASSWORD_RESET_TOKEN_TTL_SECONDS,
      },
    );
  }

  /**
   * Reads whom a reset token NAMES, without trusting it yet.
   *
   * Deriving the key needs that row's current password hash, which needs the
   * user id, which is inside the token — so the subject has to be read before it
   * can be verified. Everything this returns is unverified and is good for
   * exactly one thing: looking up the row whose hash completes the key. The
   * authoritative subject is the one {@link verifyPasswordReset} returns from the
   * VERIFIED payload.
   */
  unverifiedSubject(token: string): string | null {
    const decoded: unknown = this.jwt.decode(token);
    if (typeof decoded !== 'object' || decoded === null) return null;
    const { sub } = decoded as { sub?: unknown };
    return typeof sub === 'string' && sub.length > 0 ? sub : null;
  }

  /**
   * Verifies a reset token against the key that row's hash derives, and returns
   * the subject it is now trusted to name.
   */
  async verifyPasswordReset(
    token: string,
    passwordHash: string | null,
  ): Promise<string> {
    const claims = await this.verify(
      token,
      this.passwordResetKey(passwordHash),
    );
    if (claims.purpose !== PASSWORD_RESET_PURPOSE) {
      throw new UnauthorizedException(BAD_TOKEN);
    }
    const { sub } = claims;
    if (typeof sub !== 'string' || sub.length === 0) {
      throw new UnauthorizedException(BAD_TOKEN);
    }
    return sub;
  }

  /**
   * Expiry, a wrong signature and malformed input all mean the same thing to
   * whoever followed the link — it does not work — so they collapse into one
   * message rather than reporting which.
   */
  private async verify(
    token: string,
    secret: string,
  ): Promise<Record<string, unknown>> {
    try {
      return await this.jwt.verifyAsync<Record<string, unknown>>(token, {
        secret,
      });
    } catch {
      throw new UnauthorizedException(BAD_TOKEN);
    }
  }
}
