// credits:grant <email> <credits> <reason> [--prod]
//
// Gives an account a never-expiring promo grant, with an audit entry carrying
// the reason. Production:
//   docker exec -it chatofy_prod_api node dist/cli/credits-grant.js <email> <credits> <reason> --prod
import { randomUUID } from 'node:crypto';
import { CREDIT_SECONDS_PER_CREDIT } from '@chatofy/types';
import { normalizeEmail } from '../modules/auth/normalize-email';
import { CLI_GRANT_MAX_CREDITS } from '../modules/credits/credit-pricing';
import { PrismaService } from '../prisma/prisma.service';
import { CliRefusal } from './cli-prod-guard';
import { runCreditsCli } from './credits-cli.module';

const USAGE = 'Usage: credits:grant <email> <credits> <reason> [--prod]';

/** Whole credits, 1 to the cap. Anything else (0, -5, 1.5, 10001, "ten") is refused. */
function parseGrantCredits(raw: string): number {
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new CliRefusal(
      `credits must be a positive whole number, got "${raw}". ${USAGE}`,
    );
  }
  const credits = Number(raw);
  if (credits > CLI_GRANT_MAX_CREDITS) {
    throw new CliRefusal(
      `credits must be at most ${CLI_GRANT_MAX_CREDITS}, got ${credits}.`,
    );
  }
  return credits;
}

function parse(positionals: string[]) {
  if (positionals.length !== 3 || !positionals[2]!.trim()) {
    throw new CliRefusal(USAGE);
  }
  return {
    email: normalizeEmail(positionals[0]!),
    credits: parseGrantCredits(positionals[1]!),
    reason: positionals[2]!,
  };
}

runCreditsCli({}, USAGE, {
  describe(positionals) {
    const { email, credits, reason } = parse(positionals);
    return {
      action: `grant ${credits} promo credits to ${email} (${reason})`,
      confirmWith: email,
    };
  },
  async run({ app, ledger, positionals, print }) {
    const { email, credits, reason } = parse(positionals);
    const user = await app
      .get(PrismaService)
      .user.findUnique({ where: { email }, select: { id: true } });
    if (!user) throw new CliRefusal(`No account with email ${email}.`);
    const result = await ledger.grant({
      userId: user.id,
      source: 'promo',
      amount: credits * CREDIT_SECONDS_PER_CREDIT,
      expiresAt: null,
      externalRef: `promo:${randomUUID()}`,
      reason,
    });
    print(result.grantId);
  },
});
