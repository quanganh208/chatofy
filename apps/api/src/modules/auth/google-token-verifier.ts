import {
  Injectable,
  NotImplementedException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { Env } from '../../config/env.schema';

/** What a verified Google id_token tells us about who is signing in. */
export interface GoogleIdentity {
  /** Google's stable subject claim. The only durable key — an email can change. */
  sub: string;
  email: string;
  /** Whether Google itself vouches for that address. */
  emailVerified: boolean;
  name?: string;
  /**
   * Google's profile picture URL, when the token carries one.
   *
   * Verified as a CLAIM — it came inside a signature-checked id_token — but
   * untrusted as a FETCH TARGET. The API making an outbound request to a value
   * out of a token payload needs the host control to actually hold, so the
   * importer parses it as a URL against an allowlist and refuses redirects. See
   * `google-avatar-importer.ts`.
   */
  picture?: string;
}

/**
 * Verifies a Google id_token against Google's own keys.
 *
 * `verifyIdToken` checks signature, issuer, expiry and audience against the
 * live JWKS, with the key cache handled for us. Hand-rolling that with jose
 * means owning key rotation and issuer checks, which is a lot of security
 * surface for no gain.
 *
 * The audience is a list, not a value. It costs nothing today — the option takes
 * either — and mobile's per-platform client ids arrive with different ids for
 * the same product, which would otherwise be a breaking change to this contract.
 */
@Injectable()
export class GoogleTokenVerifier {
  private readonly client = new OAuth2Client();

  constructor(private readonly config: ConfigService<Env, true>) {}

  /**
   * Enforced lazily, matching how GEMINI_API_KEY is handled: an unset value must
   * not stop the whole API booting for deployments that never offer Google
   * login, but it must produce a clear answer when the route is actually called.
   */
  private audience(): string[] {
    const raw = this.config.get('GOOGLE_CLIENT_IDS', { infer: true });
    const ids = (raw ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    if (ids.length === 0) {
      // 501 rather than 503: this server does not implement Google login at
      // all, and retrying will not change that.
      //
      // The message below does NOT reach the client — the exception filter
      // forces every 5xx to a generic "Internal server error" so internals
      // cannot leak, which is right and is not worth weakening for this. The
      // STATUS is what carries the distinction, and apps/web/auth.ts reads it
      // to avoid telling the user their Google account is at fault when the
      // truth is that nobody configured the server. This string is for the log.
      throw new NotImplementedException(
        'Google login is not configured on this server',
      );
    }
    return ids;
  }

  async verify(idToken: string): Promise<GoogleIdentity> {
    const audience = this.audience();

    let payload;
    try {
      const ticket = await this.client.verifyIdToken({ idToken, audience });
      payload = ticket.getPayload();
    } catch {
      // Tampered, expired, wrong audience and unparseable all mean the same
      // thing to the caller — no identity — and telling them which would only
      // help someone probing the allowlist.
      throw new UnauthorizedException(
        'That Google sign-in could not be verified',
      );
    }

    if (!payload?.sub || !payload.email) {
      throw new UnauthorizedException(
        'That Google sign-in could not be verified',
      );
    }

    return {
      sub: payload.sub,
      email: payload.email,
      // Strict true. Google sends this as a boolean, but the linking policy
      // turns on it, so a missing or string-y value must read as NOT verified.
      emailVerified: payload.email_verified === true,
      ...(payload.name ? { name: payload.name } : {}),
      ...(payload.picture ? { picture: payload.picture } : {}),
    };
  }
}
