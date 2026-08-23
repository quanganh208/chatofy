import { Injectable, Logger } from '@nestjs/common';
import {
  MailBudgetClass,
  MailDispatch,
  MailSender,
} from '../interfaces/mail-sender.interface';

/** Repeat sends of the same purpose to the same address inside this window are dropped. Exported for tests. */
export const COOLDOWN_MS = 10 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Rolling-24h ceilings, one per MailBudgetClass.
 *
 * Gmail's own personal-account limit is ~500 recipients/day, so 300 + 150 stays
 * under it with headroom and this budget binds before Gmail's does.
 *
 * THE RESERVED SHARE IS THE SMALLER ONE, and that is deliberate. The tiering
 * exists to stop an address-rotation attacker from silently killing the mail
 * real users depend on, and the only mail that can be protected from such an
 * attacker is mail sent to a row that ALREADY EXISTS — password reset. Every
 * other send is triggered by an unauthenticated caller naming an arbitrary
 * recipient, so no ceiling can tell that traffic apart from an attack.
 *
 * Reset is also genuinely low volume: people reset rarely, and one address is
 * bounded by the cooldown besides. 150/day is generous for it, while the
 * attacker-facing tier keeps enough room to carry real registration traffic.
 *
 * The failure this arrangement prevents: with registration mail drawing on the
 * reserved share, an attacker registering rotating fresh addresses at the
 * route's 5/60s — 7,200/day from one IP — exhausts it in about eighty minutes,
 * after which nobody can recover an account and every route still answers 202.
 */
/*
 * SINGLE-INSTANCE, like the throttler in `auth.module.ts`. Both ceilings and the
 * cooldown live in this process's memory, so a second replica gets its own pair
 * and the totals below double. The arithmetic in this file — and the attack it
 * describes — assumes one process.
 */
export const BUDGET_CEILINGS: Record<MailBudgetClass, number> = {
  [MailBudgetClass.AttackerTriggerable]: 300,
  [MailBudgetClass.Reserved]: 150,
};

/**
 * Masks a recipient for logging: first character of the local part plus the
 * domain, e.g. `j***@example.com`. Never the full address — the domain alone
 * does not identify a person, and keeping it lets an operator correlate
 * complaints ("mail to our own domain is being dropped") without exposing
 * who received what.
 */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return `${email.slice(0, 1)}***@${email.slice(at + 1)}`;
}

/**
 * What the cooldown is keyed on: the PURPOSE as well as the recipient.
 *
 * Keyed on the address alone, the cooldown becomes a way to silence someone
 * else's mail. `POST /auth/register` naming a victim's address sends them the
 * "you already have an account" notice — an attacker-triggerable send, needing
 * no proof of anything — and that would start a ten-minute window the victim's
 * OWN password-reset mail then falls inside and is dropped in. Repeated every
 * ten minutes, at 144 sends a day against a route that allows 5 a minute and an
 * attacker tier that allows 300 a day, a named person can be held out of account
 * recovery indefinitely, seeing only a 202 and no mail.
 *
 * That is the same starvation `BUDGET_CEILINGS` is tiered to prevent, arriving
 * through the other control. Splitting the key closes it: the only way to put a
 * `PasswordReset` send on cooldown is to request a reset for that address, which
 * delivers a working reset link to the victim's own mailbox — the outcome they
 * wanted, not a denial of it.
 *
 * The cost is the mail-bombing ceiling this rises from one message per address
 * per ten minutes to one per purpose, so four. Still bounded, still far below
 * what an inbox notices, and a bounded nuisance is the right trade against an
 * unbounded lockout.
 */
function cooldownKey(dispatch: MailDispatch): string {
  return `${dispatch.purpose} ${dispatch.to}`;
}

/**
 * The one place the cooldown and the tiered budget live — a MailSender that
 * decorates another MailSender, bound to MAIL_SENDER in place of the
 * concrete sender it wraps.
 *
 * This is deliberately NOT a separate injectable service alongside an
 * exported MAIL_SENDER. Two reachable seams — inject the "real" sender, skip
 * the control — ship with green tests and a 202 either way; the first
 * symptom is a Gmail volume lock. Wrapping the token instead makes the
 * control unbypassable by construction: there is no other way to send mail.
 *
 * Both structures below are pruned lazily (on the next relevant check, not on
 * a timer) rather than swept — this is a single-instance, in-memory control
 * that already accepts losing its state on restart, so a cron-style sweep
 * would add a moving part for no benefit.
 *
 * Their growth is bounded in two different ways, and both matter. The RATE is
 * capped by the send budget: an entry is written only after a send clears the
 * budget check AND succeeds, so across any 24h window they gain at most
 * `BUDGET_CEILINGS[AttackerTriggerable] + BUDGET_CEILINGS[Reserved]` keys. The
 * TOTAL is capped by the pruning itself — the cooldown map keeps only entries
 * inside `COOLDOWN_MS` and the budget log only entries inside 24h — which is
 * what stops a long-lived process accumulating every address it has ever mailed.
 */
@Injectable()
export class GuardedMailSender implements MailSender {
  private readonly logger = new Logger(GuardedMailSender.name);

  /** purpose+email -> timestamp (ms) of its last SUCCESSFUL send. See {@link cooldownKey}. */
  private readonly lastSentAt = new Map<string, number>();

  /** Per-class timestamps (ms) of successful sends, for the rolling 24h count. */
  private readonly budgetLog: Record<MailBudgetClass, number[]> = {
    [MailBudgetClass.AttackerTriggerable]: [],
    [MailBudgetClass.Reserved]: [],
  };

  constructor(private readonly inner: MailSender) {}

  async send(dispatch: MailDispatch): Promise<void> {
    const masked = maskEmail(dispatch.to);

    // Header-injection floor: `to` is required for a mail to exist at all,
    // but no code path may hand it a control character. Reject rather than
    // strip — a silently-altered recipient is worse than a rejected send.
    if (/[\r\n]/.test(dispatch.to)) {
      this.logger.error(
        `Mail rejected (purpose=${dispatch.purpose}): recipient contains a control character`,
      );
      return;
    }

    const lastSent = this.pruneCooldowns().get(cooldownKey(dispatch));
    if (lastSent !== undefined && Date.now() - lastSent < COOLDOWN_MS) {
      this.logger.warn(
        `Mail dropped (purpose=${dispatch.purpose}, to=${masked}): recipient cooldown active`,
      );
      return;
    }

    if (this.isBudgetExhausted(dispatch.budgetClass)) {
      this.logger.error(
        `Mail dropped (purpose=${dispatch.purpose}, class=${dispatch.budgetClass}): ` +
          `24h budget of ${BUDGET_CEILINGS[dispatch.budgetClass]} exhausted`,
      );
      return;
    }

    // Cooldown and budget are recorded on a SUCCESSFUL send only. There is no
    // SIGTERM drain in main.ts, so a deploy kills sends mid-flight; crediting
    // those against the window would leave a user staring at a UI that
    // confirmed three sends that never happened, and would let a failed
    // attempt itself count against the volume budget for nothing delivered.
    try {
      await this.inner.send(dispatch);
    } catch (error) {
      this.logger.error(
        `Mail send failed (purpose=${dispatch.purpose}, to=${masked})`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }

    const now = Date.now();
    this.lastSentAt.set(cooldownKey(dispatch), now);
    this.budgetLog[dispatch.budgetClass].push(now);
    this.logger.log(
      `Mail sent (purpose=${dispatch.purpose}, to=${masked}, class=${dispatch.budgetClass})`,
    );
  }

  /**
   * Drops cooldown entries that have already expired, and returns the map.
   *
   * An entry older than `COOLDOWN_MS` can never make a send wait — the check
   * above would pass it regardless — so keeping it holds a recipient's address
   * in memory for nothing. Without this the map only ever grows: bounded in
   * RATE by the send budget, but not in TOTAL, which is roughly 164k addresses
   * a year for a process that stays up.
   *
   * Swept on the same lookup that reads it rather than on a timer, matching the
   * budget log below: this is single-instance in-memory state that already
   * accepts losing everything on restart, so a scheduled sweep would be a moving
   * part with nothing to gain. The map holds at most one cooldown window's worth
   * of sends, so the scan is over a handful of entries.
   */
  private pruneCooldowns(): Map<string, number> {
    const cutoff = Date.now() - COOLDOWN_MS;
    for (const [key, at] of this.lastSentAt) {
      if (at < cutoff) this.lastSentAt.delete(key);
    }
    return this.lastSentAt;
  }

  /** Prunes entries outside the rolling 24h window, then checks the ceiling. */
  private isBudgetExhausted(budgetClass: MailBudgetClass): boolean {
    const cutoff = Date.now() - DAY_MS;
    const live = this.budgetLog[budgetClass].filter((at) => at >= cutoff);
    this.budgetLog[budgetClass] = live;
    return live.length >= BUDGET_CEILINGS[budgetClass];
  }
}
