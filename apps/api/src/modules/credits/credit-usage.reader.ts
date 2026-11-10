import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  creditsFromSeconds,
  type CreditUsageEntry,
  type CreditUsageKind,
  type CreditUsageListResponse,
} from '@chatofy/types';
import { PrismaService } from '../../prisma/prisma.service';
import { BILLING_TIME_ZONE } from './billing-period';
import { OVERSHOOT_UNCOVERED } from './credit-lease-ops';

/** Rows per usage page. */
export const USAGE_PAGE_SIZE = 20;
/**
 * Entries one page reads at most to find its rows. A page aggregates only the
 * entries from the `USAGE_SCAN_ENTRIES`-th newest (below the cursor) onward, so
 * its cost follows how far back someone pages, not the account's whole history.
 */
export const USAGE_SCAN_ENTRIES = 2_000;
/**
 * How far before the window's start a group's entries can lie: a conversation
 * row is one local day, and a debit or refund is one transaction. A
 * connection's row can run longer, so its entries are fetched by lease id.
 */
const GROUP_SPAN = Prisma.sql`interval '1 day'`;
/** Kinds the history shows; reserves and releases are bookkeeping. */
const SHOWN_KINDS = Prisma.sql`('settle', 'debit', 'grant', 'refund', 'expire', 'void')`;

interface UsageRow {
  gkey: string;
  ukind: CreditUsageKind;
  at: Date;
  amount: number;
  conversationId: string | null;
  source: string | null;
}

/** What a grant's source is called on a usage row. */
const SOURCE_LABEL: Record<string, string> = {
  free: 'Free monthly credits',
  subscription: 'Pro subscription',
  pass: 'Pro 30-day pass',
  topup: 'Top-up',
  promo: 'Bonus credits',
  refund: 'Refunded credits',
};

function labelFor(row: UsageRow): string {
  if (row.ukind === 'translate') return 'Live translation';
  if (row.ukind === 'minutes' || row.ukind === 'refund')
    return 'Meeting minutes';
  return SOURCE_LABEL[row.source ?? ''] ?? 'Credits';
}

function encodeCursor(row: Pick<UsageRow, 'at' | 'gkey'>): string {
  return Buffer.from(`${row.at.toISOString()}|${row.gkey}`).toString(
    'base64url',
  );
}

/**
 * Where the next page starts. A full page continues after its last row. A
 * short page that was cut off by the scan window (`since`) still has older
 * rows: it continues after its last row, or — when the window held no row of
 * its own (one long group filled it) — from the window's start.
 */
function nextCursorOf(
  rows: UsageRow[],
  last: UsageRow | undefined,
  since: Date | null,
  after: { at: Date } | null,
): string | null {
  if (rows.length > USAGE_PAGE_SIZE && last) return encodeCursor(last);
  if (!since) return null;
  if (last) return encodeCursor(last);
  // (since + 1 ms, '') keeps every row at or before `since` (timestamps are
  // whole milliseconds). If that would not move past the current cursor — the
  // window's edge IS the cursor's instant — skip the rest of that instant
  // rather than serve the same page again.
  const next = new Date(since.getTime() + 1);
  if (after && next.getTime() > after.at.getTime()) {
    return encodeCursor({ at: after.at, gkey: '' });
  }
  return encodeCursor({ at: next, gkey: '' });
}

function decodeCursor(cursor: string): { at: Date; key: string } {
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  const bar = raw.indexOf('|');
  const at = new Date(raw.slice(0, bar));
  if (bar < 1 || Number.isNaN(at.getTime()))
    throw new BadRequestException('Invalid cursor');
  return { at, key: raw.slice(bar + 1) };
}

/**
 * The usage history a person reads: what their credits went on.
 *
 * Settles are grouped into one row per conversation per local day when the
 * client named the conversation, otherwise one row per lease (a connection).
 * A debit or refund split across several grants reads as one row, by its
 * idempotency key. Reserves and releases are bookkeeping and never shown, and
 * consumption that was never charged (`overshoot_uncovered`) is left out.
 */
@Injectable()
export class CreditUsageReader {
  constructor(private readonly prisma: PrismaService) {}

  async page(
    userId: string,
    cursor?: string,
    scanEntries = USAGE_SCAN_ENTRIES,
  ): Promise<CreditUsageListResponse> {
    const after = cursor ? decodeCursor(cursor) : null;
    const below = after
      ? Prisma.sql`AND "createdAt" <= ${after.at}::timestamp(3)`
      : Prisma.empty;
    // Where this page's window starts: the scanEntries-th newest shown entry
    // at or below the cursor. None means the rest of the history is short
    // enough to read whole.
    const edge = await this.prisma.$queryRaw<{ createdAt: Date }[]>`
      SELECT "createdAt" FROM "CreditEntry"
      WHERE "userId" = ${userId} AND kind IN ${SHOWN_KINDS}
        AND reason IS DISTINCT FROM ${OVERSHOOT_UNCOVERED} ${below}
      ORDER BY "createdAt" DESC
      OFFSET ${scanEntries - 1} LIMIT 1`;
    const since = edge[0]?.createdAt ?? null;
    // In the window: entries from one group span before `since`, plus every
    // settle of a connection row that has one in it. Groups whose newest entry
    // is before `since` are left to the next page, so none is read partially.
    const inWindow = since
      ? Prisma.sql`AND (
          "createdAt" >= ${since}::timestamp(3) - ${GROUP_SPAN}
          OR ("leaseId" IS NOT NULL AND kind = 'settle' AND "conversationId" IS NULL
              AND "leaseId" IN (
                SELECT "leaseId" FROM "CreditEntry"
                WHERE "userId" = ${userId} AND kind = 'settle'
                  AND "conversationId" IS NULL AND "leaseId" IS NOT NULL
                  AND "createdAt" >= ${since}::timestamp(3))))`
      : Prisma.empty;
    const recentEnough = since
      ? Prisma.sql`AND max("createdAt") >= ${since}::timestamp(3)`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<UsageRow[]>`
      WITH e AS (
        SELECT
          "createdAt", amount, "conversationId", "grantId",
          CASE kind WHEN 'settle' THEN 'translate' WHEN 'debit' THEN 'minutes' ELSE kind END AS ukind,
          CASE
            WHEN kind = 'settle' AND "conversationId" IS NOT NULL THEN
              'c:' || "conversationId" || ':' ||
              to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${BILLING_TIME_ZONE}, 'YYYY-MM-DD')
            WHEN kind = 'settle' THEN 'l:' || "leaseId"
            ELSE 'k:' || split_part("idempotencyKey", '#', 1)
          END AS gkey
        FROM "CreditEntry"
        WHERE "userId" = ${userId}
          AND kind IN ${SHOWN_KINDS}
          AND reason IS DISTINCT FROM ${OVERSHOOT_UNCOVERED}
          ${inWindow}
      ), g AS (
        SELECT gkey, ukind, max("createdAt") AS at, sum(amount)::int AS amount,
               max("conversationId") AS "conversationId", min("grantId") AS "grantId"
        FROM e
        GROUP BY gkey, ukind
        HAVING sum(amount) <> 0 ${recentEnough}
      )
      SELECT g.gkey, g.ukind, g.at, g.amount, g."conversationId", cg.source
      FROM g LEFT JOIN "CreditGrant" cg ON cg.id = g."grantId"
      ${after ? Prisma.sql`WHERE (g.at, g.gkey) < (${after.at}::timestamp(3), ${after.key}::text)` : Prisma.empty}
      ORDER BY g.at DESC, g.gkey DESC
      LIMIT ${USAGE_PAGE_SIZE + 1}`;

    const page = rows.slice(0, USAGE_PAGE_SIZE);
    const entries: CreditUsageEntry[] = page.map((row) => ({
      id: row.gkey,
      at: row.at.toISOString(),
      kind: row.ukind,
      credits: creditsFromSeconds(row.amount),
      conversationId: row.conversationId,
      label: labelFor(row),
    }));
    const last = page[page.length - 1];
    return { entries, nextCursor: nextCursorOf(rows, last, since, after) };
  }
}
