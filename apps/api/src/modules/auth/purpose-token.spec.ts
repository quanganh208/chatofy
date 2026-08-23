import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  PASSWORD_RESET_TOKEN_TTL_SECONDS,
  PurposeTokenService,
  REGISTER_TOKEN_TTL_SECONDS,
} from './purpose-token';

const SECRET = 'a-test-secret-long-enough-for-the-schema';

describe('PurposeTokenService', () => {
  // The app's own JwtService, registered exactly as AuthModule registers it, so
  // an access token minted here is one the API would have minted.
  const jwt = new JwtService({
    secret: SECRET,
    signOptions: { expiresIn: 60 },
  });
  const config = { get: () => SECRET } as unknown as ConfigService<never, true>;
  const tokens = new PurposeTokenService(jwt, config);

  const pending = {
    email: 'a@b.com',
    passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$abc$def',
    name: 'A',
  };

  describe('registration tokens', () => {
    it('round-trips the pending account', async () => {
      const token = await tokens.issueRegistration(pending);
      await expect(tokens.readRegistration(token)).resolves.toEqual(pending);
    });

    it('carries no plaintext password', async () => {
      // The password is hashed before the token is minted, so no plaintext
      // leaves the request that typed it — and none rides in a URL.
      const token = await tokens.issueRegistration(pending);
      expect(token).not.toContain('correct horse battery');
      const decoded = jwt.decode<Record<string, unknown>>(token);
      expect(decoded).not.toHaveProperty('password');
    });

    it('expires', async () => {
      const token = await tokens.issueRegistration(pending);
      const { exp, iat } = jwt.decode<{ exp: number; iat: number }>(token);
      expect(exp - iat).toBe(REGISTER_TOKEN_TTL_SECONDS);
    });

    it('refuses a token signed with the bare app secret', async () => {
      // Without the `:register:` infix this would verify. The infix is what
      // stops one flow's token being spendable in another.
      const forged = await jwt.signAsync({ ...pending, purpose: 'register' });
      await expect(tokens.readRegistration(forged)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('refuses a reset token presented as a verification link', async () => {
      const reset = await tokens.issuePasswordReset('user_1', null);
      await expect(tokens.readRegistration(reset)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('refuses garbage without throwing anything else', async () => {
      await expect(tokens.readRegistration('not-a-jwt')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('password reset tokens', () => {
    const hash = '$argon2id$v=19$m=65536,t=3,p=4$xyz$uvw';

    it('round-trips the subject under the hash it was minted for', async () => {
      const token = await tokens.issuePasswordReset('user_1', hash);
      await expect(tokens.verifyPasswordReset(token, hash)).resolves.toBe(
        'user_1',
      );
    });

    it('dies the moment the password changes', async () => {
      // Single use, a second reset, and a superseded link are all this one
      // fact: the new hash derives a different key, and no outstanding token
      // verifies under it. No token table has to be kept in step.
      const token = await tokens.issuePasswordReset('user_1', hash);
      await expect(
        tokens.verifyPasswordReset(token, '$argon2-a-different-hash'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('expires in half an hour', async () => {
      const token = await tokens.issuePasswordReset('user_1', hash);
      const { exp, iat } = jwt.decode<{ exp: number; iat: number }>(token);
      expect(exp - iat).toBe(PASSWORD_RESET_TOKEN_TTL_SECONDS);
    });

    it('names its subject before it is trusted, and only for the lookup', async () => {
      const token = await tokens.issuePasswordReset('user_1', hash);
      expect(tokens.unverifiedSubject(token)).toBe('user_1');
      expect(tokens.unverifiedSubject('not-a-jwt')).toBeNull();
    });

    /**
     * The collapse the `:pwreset:` infix exists to prevent, tested for the row
     * that actually reaches it.
     *
     * A row with a null `passwordHash` — every Google-first account — would
     * derive `AUTH_JWT_SECRET` itself under a naive `secret + (hash ?? '')`
     * scheme. That is the key the API signs ACCESS tokens with, so a stolen
     * access token would redeem as a reset token for whoever it names, and a
     * reset token would open every guarded route.
     */
    describe('a null-passwordHash row', () => {
      it('does not accept an access token as a reset token', async () => {
        const accessToken = await jwt.signAsync({ sub: 'user_1' });
        await expect(
          tokens.verifyPasswordReset(accessToken, null),
        ).rejects.toBeInstanceOf(UnauthorizedException);
      });

      it('does not mint a reset token that verifies as an access token', async () => {
        const reset = await tokens.issuePasswordReset('user_1', null);
        await expect(jwt.verifyAsync(reset)).rejects.toBeDefined();
      });

      it('still gets a working reset token of its own', async () => {
        // Reset is deliberately open to these rows, so this path is normal use.
        const reset = await tokens.issuePasswordReset('user_1', null);
        await expect(tokens.verifyPasswordReset(reset, null)).resolves.toBe(
          'user_1',
        );
      });
    });

    it('refuses a verification link presented as a reset token', async () => {
      const registration = await tokens.issueRegistration(pending);
      await expect(
        tokens.verifyPasswordReset(registration, null),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
