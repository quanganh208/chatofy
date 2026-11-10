import { useEffect, useState } from 'react';
import {
  USAGE_KIND_LABEL,
  formatCredits,
  formatSignedCredits,
  loadCredits,
  type CreditsResult,
} from '../../src/credits';

/**
 * The account's credits inside the settings pane: what is left and where it
 * comes from, the plan, and the newest five usage rows.
 *
 * A readout, not a control: nothing here is bought or changed. Buying happens on
 * the web, so an account let in to checkout is pointed there in words and every
 * other account reads why buying is closed. Read once each time the pane is
 * shown signed in — a popup lives seconds, so there is nothing to keep fresh.
 */

const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function day(iso: string): string {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? iso : DAY.format(at);
}

export function CreditsPane({ apiBaseUrl, active }: { apiBaseUrl?: string; active: boolean }) {
  const [result, setResult] = useState<CreditsResult>();

  useEffect(() => {
    if (!active || apiBaseUrl === undefined) return;
    let current = true;
    // `loadCredits` never throws; a failure arrives as `message`.
    void loadCredits(apiBaseUrl).then((loaded) => {
      if (current) setResult(loaded);
    });
    return () => {
      current = false;
    };
  }, [active, apiBaseUrl]);

  const balance = result?.balance ?? null;

  return (
    <fieldset
      id="credits"
      className="border-hairline flex min-w-0 flex-col gap-2 border-0 border-t pt-3"
    >
      <legend className="text-muted-foreground text-label font-semibold tracking-wide uppercase">
        Credits
      </legend>

      {result === undefined ? <p className="text-muted-foreground text-hint">Loading…</p> : null}
      {result?.message ? (
        <p role="status" className="text-muted-foreground text-hint">
          {result.message}
        </p>
      ) : null}

      {balance ? (
        <>
          <Line
            label="Credits left"
            value={formatCredits(balance.totalCredits)}
            detail={`Plan ${balance.plan === 'pro' ? 'Pro' : 'Free'}`}
            strong
          />
          <Line
            label="Plan credits"
            value={formatCredits(balance.planCredits)}
            detail={balance.planResetsAt ? `Reset on ${day(balance.planResetsAt)}` : undefined}
          />
          <Line
            label="Top-up credits"
            value={formatCredits(balance.topupCredits)}
            detail="Never expire"
          />
          <p className="text-muted-foreground text-hint">
            {balance.checkoutAllowed
              ? 'Buy credits on the Chatofy website, under Account.'
              : 'Buying credits is not open to the public. Chatofy is a non-commercial thesis project, and only its owner can check out.'}
          </p>
        </>
      ) : null}

      {result && balance ? (
        result.usage.length === 0 ? (
          <p className="text-muted-foreground text-hint">Nothing used yet.</p>
        ) : (
          <ul id="credit-usage" className="flex flex-col">
            {result.usage.map((entry) => (
              <li
                key={entry.id}
                className="border-hairline flex items-baseline justify-between gap-2 border-b py-1 last:border-b-0"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="text-prose truncate">{USAGE_KIND_LABEL[entry.kind]}</span>
                  <span className="text-muted-foreground text-hint">{day(entry.at)}</span>
                </span>
                <span className="text-prose shrink-0 tabular-nums">
                  {formatSignedCredits(entry.credits)}
                </span>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </fieldset>
  );
}

function Line({
  label,
  value,
  detail,
  strong = false,
}: {
  label: string;
  value: string;
  detail?: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="flex min-w-0 flex-col">
        <span className="text-prose">{label}</span>
        {detail ? <span className="text-muted-foreground text-hint">{detail}</span> : null}
      </span>
      <span className={`text-prose shrink-0 tabular-nums${strong ? ' font-semibold' : ''}`}>
        {value}
      </span>
    </div>
  );
}
