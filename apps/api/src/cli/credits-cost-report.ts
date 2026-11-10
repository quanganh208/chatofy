// credits:cost-report [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--prod]
//
// Per user and local month: credits settled, and the model tokens and list-price
// USD behind them. Tokens are joined from `LlmCallRecord` by `sessionId` at read
// time, so polish calls that landed after a turn settled are counted with it.
// Minutes runs are user-scoped calls with no session, so they are not in here.
import { Prisma } from '@prisma/client';
import { CREDIT_SECONDS_PER_CREDIT } from '@chatofy/types';
import { BILLING_TIME_ZONE } from '../modules/credits/billing-period';
import { OVERSHOOT_UNCOVERED } from '../modules/credits/credit-lease-ops';
import { PrismaService } from '../prisma/prisma.service';
import { CliRefusal } from './cli-prod-guard';
import { runCreditsCli } from './credits-cli.module';

const USAGE =
  'Usage: credits:cost-report [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--prod]';

/** USD per 1M tokens: uncached input, cached input, output (thinking included). */
interface ModelPrice {
  input: number;
  cached: number;
  output: number;
}

/**
 * List prices, matched by model-id prefix (longest first). Gemini rows were
 * checked against Google's pricing page on 2026-11-09; `gemini-3.8-flash` doubles
 * on 2027-01-01 and this table carries the 2026 rate. DeepSeek is its peak rate
 * (Vietnamese working hours fall in it) and gpt-5.6-sol the OpenRouter catalogue
 * rate, both from the 2026-11-09 pricing research, not re-checked. A model with
 * no row prints `?` for USD rather than a guess. Calls served by the Command
 * Code host are covered by its flat plan; their list price is still shown,
 * because that is what the fallback would cost.
 */
const PRICES: Array<[prefix: string, price: ModelPrice]> = [
  ['gemini-3.1-flash-lite', { input: 0.25, cached: 0.025, output: 1.5 }],
  ['gemini-3.5-flash-lite', { input: 0.3, cached: 0.03, output: 2.5 }],
  ['gemini-3.8-flash', { input: 0.75, cached: 0.075, output: 3.75 }],
  ['gemini-2.5-flash', { input: 0.3, cached: 0.03, output: 2.5 }],
  ['deepseek-v4-pro', { input: 1.32, cached: 0.044, output: 3.96 }],
  ['deepseek-v4-flash', { input: 0.3, cached: 0.006, output: 1.2 }],
  ['deepseek-flash', { input: 0.3, cached: 0.006, output: 1.2 }],
  ['gpt-5.6-sol', { input: 4, cached: 0.4, output: 20 }],
];
PRICES.sort((a, b) => b[0].length - a[0].length);

function priceFor(model: string): ModelPrice | undefined {
  const id = model.toLowerCase().replace(/^.*\//, '');
  return PRICES.find(([prefix]) => id.startsWith(prefix))?.[1];
}

function parseDay(raw: unknown, flag: string): string | undefined {
  if (raw === undefined) return undefined;
  if (
    typeof raw !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(raw) ||
    Number.isNaN(Date.parse(raw))
  ) {
    throw new CliRefusal(`${flag} must be a date as YYYY-MM-DD. ${USAGE}`);
  }
  return raw;
}

interface CreditRow {
  userId: string;
  month: string;
  seconds: number;
  sessions: number;
}

interface TokenRow {
  userId: string;
  month: string;
  model: string;
  calls: number;
  input: number;
  cached: number;
  output: number;
}

runCreditsCli({ from: { type: 'string' }, to: { type: 'string' } }, USAGE, {
  describe(positionals, values) {
    if (positionals.length !== 0) throw new CliRefusal(USAGE);
    parseDay(values.from, '--from');
    parseDay(values.to, '--to');
    return { action: 'read the cost report' };
  },
  async run({ app, values, print }) {
    const from = parseDay(values.from, '--from');
    const to = parseDay(values.to, '--to');
    const prisma = app.get(PrismaService);
    // The local day of a settle, inclusive at both ends.
    const localDay = Prisma.sql`(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${BILLING_TIME_ZONE})::date`;
    const range = Prisma.sql`
      ${from ? Prisma.sql`AND ${localDay} >= ${from}::date` : Prisma.empty}
      ${to ? Prisma.sql`AND ${localDay} <= ${to}::date` : Prisma.empty}`;
    const settles = Prisma.sql`
      SELECT "userId", "sessionId", -amount AS seconds,
             to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${BILLING_TIME_ZONE}, 'YYYY-MM') AS month
      FROM "CreditEntry"
      WHERE kind = 'settle' AND reason IS DISTINCT FROM ${OVERSHOOT_UNCOVERED} ${range}`;

    const credits = await prisma.$queryRaw<CreditRow[]>`
      SELECT "userId", month, sum(seconds)::int AS seconds, count(DISTINCT "sessionId")::int AS sessions
      FROM (${settles}) s
      GROUP BY "userId", month
      ORDER BY month, "userId"`;
    const tokens = await prisma.$queryRaw<TokenRow[]>`
      SELECT s."userId", s.month, r.model, count(*)::int AS calls,
             coalesce(sum(r."inputTokens"), 0)::int AS input,
             coalesce(sum(r."cachedInputTokens"), 0)::int AS cached,
             coalesce(sum(r."outputTokens"), 0)::int AS output
      FROM (SELECT DISTINCT "userId", month, "sessionId" FROM (${settles}) x WHERE "sessionId" IS NOT NULL) s
      JOIN "LlmCallRecord" r ON r."sessionId" = s."sessionId"
      GROUP BY s."userId", s.month, r.model
      ORDER BY s.month, s."userId", r.model`;

    if (credits.length === 0) {
      print('No settled usage in this range.');
      return;
    }
    print(
      [
        'month',
        'user',
        'credits',
        'sessions',
        'model',
        'calls',
        'in',
        'cached',
        'out',
        'usd',
      ].join('\t'),
    );
    for (const row of credits) {
      const models = tokens.filter(
        (t) => t.userId === row.userId && t.month === row.month,
      );
      const costs: Array<number | null> = [];
      const lines = models.map((t) => {
        const price = priceFor(t.model);
        const cost = price
          ? ((t.input - t.cached) * price.input +
              t.cached * price.cached +
              t.output * price.output) /
            1e6
          : null;
        costs.push(cost);
        return [
          t.model,
          t.calls,
          t.input,
          t.cached,
          t.output,
          cost === null ? '?' : cost.toFixed(4),
        ];
      });
      const head = [
        row.month,
        row.userId,
        (row.seconds / CREDIT_SECONDS_PER_CREDIT).toFixed(2),
        row.sessions,
      ];
      if (lines.length === 0) {
        print([...head, '-', 0, 0, 0, 0, '0.0000'].join('\t'));
        continue;
      }
      for (const line of lines) print([...head, ...line].join('\t'));
      // One unpriced model makes the total unknown, not smaller.
      const total = costs.includes(null)
        ? '?'
        : costs.reduce<number>((a, c) => a + (c ?? 0), 0).toFixed(4);
      print([...head, 'TOTAL', '', '', '', '', total].join('\t'));
    }
  },
});
