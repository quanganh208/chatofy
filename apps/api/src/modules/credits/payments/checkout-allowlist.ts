import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import type { Env } from '../../../config/env.schema';
import { PrismaService } from '../../../prisma/prisma.service';
import { normalizeEmail } from '../../auth/normalize-email';

/**
 * The allowlist as a set of normalised addresses. Compared through the same
 * `normalizeEmail` sign-in uses, so `Alice@Corp.com ` on the list admits the
 * account stored as `alice@corp.com` — identity means one thing everywhere.
 */
export function parseAllowlist(raw: string | undefined): ReadonlySet<string> {
  const emails = (raw ?? '')
    .split(',')
    .map((entry) => normalizeEmail(entry))
    .filter((entry) => entry.length > 0);
  return new Set(emails);
}

/** Empty or unset means no one: checkout is closed by default. */
export function isCheckoutAllowed(
  email: string | null | undefined,
  allowlist: ReadonlySet<string>,
): boolean {
  if (!email) return false;
  return allowlist.has(normalizeEmail(email));
}

type UserReader = Pick<Prisma.TransactionClient, 'user'>;

/**
 * Who may buy. Checked at checkout AND again when a payment is granted, so a
 * checkout link made outside the API, or an account removed from the list
 * after it paid, is refused and recorded rather than credited.
 */
@Injectable()
export class CheckoutAllowlist {
  private readonly allowlist: ReadonlySet<string>;

  constructor(
    config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {
    this.allowlist = parseAllowlist(
      config.get('BILLING_CHECKOUT_ALLOWLIST', { infer: true }),
    );
  }

  allowsEmail(email: string | null | undefined): boolean {
    return isCheckoutAllowed(email, this.allowlist);
  }

  /** The account's email, or null when there is no such account. */
  async emailOf(
    userId: string,
    db: UserReader = this.prisma,
  ): Promise<string | null> {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    return user?.email ?? null;
  }

  async allowsUser(
    userId: string,
    db: UserReader = this.prisma,
  ): Promise<boolean> {
    if (this.allowlist.size === 0) return false;
    return this.allowsEmail(await this.emailOf(userId, db));
  }
}
