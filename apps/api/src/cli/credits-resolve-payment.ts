// credits:resolve-payment [<orderId> grant|dismiss [--user <email>] [--plan <code>] [--note <text>]] [--prod]
//
// With no order id, lists the paid payments (SePay transfers, Polar orders)
// waiting for review. `grant` writes the order plan's grant under the payment's
// own reference, so a later webhook retry cannot grant it twice; `--plan`
// grants another catalogue plan instead (a transfer whose amount matches no
// plan names none). `dismiss` only closes the review.
import { normalizeEmail } from '../modules/auth/normalize-email';
import { PrismaService } from '../prisma/prisma.service';
import { CliRefusal } from './cli-prod-guard';
import { runCreditsCli } from './credits-cli.module';

const USAGE =
  'Usage: credits:resolve-payment [<orderId> grant|dismiss [--user <email>] [--plan <code>] [--note <text>]] [--prod]';

const OPTIONS = {
  user: { type: 'string' },
  note: { type: 'string' },
  plan: { type: 'string' },
} as const;

runCreditsCli(OPTIONS, USAGE, {
  describe(positionals, values) {
    // Listing only reads, so it needs --prod against production but no typed confirmation.
    if (positionals.length === 0) {
      return { action: 'list payments waiting for review' };
    }
    if (
      positionals.length !== 2 ||
      !['grant', 'dismiss'].includes(positionals[1]!)
    ) {
      throw new CliRefusal(USAGE);
    }
    if (values.plan !== undefined && positionals[1] !== 'grant') {
      throw new CliRefusal('--plan applies to grant only.');
    }
    return {
      action: `${positionals[1]!} payment order ${positionals[0]!}`,
      confirmWith: positionals[0]!,
    };
  },
  async run({ app, owner, positionals, values, print }) {
    const prisma = app.get(PrismaService);
    if (positionals.length === 0) {
      const orders = await prisma.paymentOrder.findMany({
        where: { status: 'needs_review' },
        orderBy: { paidAt: 'asc' },
      });
      if (orders.length === 0) print('No payments are waiting for review.');
      for (const o of orders) {
        print(
          [
            o.id,
            o.provider,
            o.reviewReason ?? '-',
            `plan=${o.planCode ?? '-'}`,
            `asked=${o.amountVnd ?? o.amountMinor} ${o.currency}`,
            `paid=${o.paidAmountVnd ?? '-'}`,
            `user=${o.userId ?? '-'}`,
            `ref=${o.externalRef ?? '-'}`,
            `paidAt=${o.paidAt?.toISOString() ?? '-'}`,
          ].join('  '),
        );
      }
      return;
    }

    const [orderId, action] = positionals as [string, 'grant' | 'dismiss'];
    const note = typeof values.note === 'string' ? values.note : null;
    const planCode = typeof values.plan === 'string' ? values.plan : undefined;
    let userId: string | undefined;
    if (typeof values.user === 'string') {
      const email = normalizeEmail(values.user);
      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (!user) throw new CliRefusal(`No account with email ${email}.`);
      userId = user.id;
    }
    const result = await owner.resolvePayment(orderId, action, {
      userId,
      note,
      planCode,
    });
    switch (result.state) {
      case 'not_found':
        throw new CliRefusal(`No payment order ${orderId}.`);
      case 'not_reviewable':
        throw new CliRefusal(
          `Order ${orderId} is not waiting for review (status ${result.status}).`,
        );
      case 'dismissed':
        print(`Dismissed order ${orderId}.`);
        return;
      case 'granted':
        print(
          `Granted order ${orderId} to user ${result.userId}: grant ${result.grantId}.`,
        );
    }
  },
});
