'use client';

import { Card, CardContent } from '@chatofy/ui/react';
import { cn } from '@/lib/utils';

/**
 * A named group of settings rows, on the page ground.
 *
 * Both settings screens were a card per concern: `/preferences` drew two, and
 * `/account` drew three for identity, photo and security. A card is for a thing
 * you act on as a unit, and a list of unrelated switches is not one — so the
 * grouping is a heading and a rule, and elevation is spent only where a group
 * really is an object you work on.
 *
 * `panel` is that exception. It wraps the rows in the screen's one elevated
 * surface, for the group that is a coherent object: the defaults a conversation
 * starts from, and the security actions. Everything else sits on the ground.
 */
export function SettingsSection({
  title,
  note,
  panel,
  children,
}: {
  title: string;
  /** One sentence under the heading, when the group needs explaining. */
  note?: string;
  /** Wrap the rows in the screen's elevated surface. */
  panel?: boolean;
  children: React.ReactNode;
}) {
  const rows = <div className="flex flex-col">{children}</div>;

  return (
    <section className="flex flex-col gap-2.5">
      <div className="border-border flex flex-col gap-1 border-b pb-2.5">
        <h2 className="text-muted-foreground text-label font-semibold tracking-wide uppercase">
          {title}
        </h2>
        {note ? <p className="text-prose text-hint max-w-[62ch]">{note}</p> : null}
      </div>
      {panel ? (
        <Card>
          <CardContent>{rows}</CardContent>
        </Card>
      ) : (
        rows
      )}
    </section>
  );
}

/**
 * One setting inside a {@link SettingsSection}: what it is on the left, the
 * control that changes it on the right.
 *
 * Named for the section rather than for settings in general, because the popover
 * panels on `/translate` have a row of their own — `translate/settings-row.tsx`,
 * an icon and a name with nowhere to put a sentence. Two components called
 * `SettingsRow` took different props and could not stand in for each other, so a
 * caller reaching for the wrong one found out from `tsc` rather than from the
 * import.
 *
 * The pair used to be `justify-between` across the full measure, which at 672px
 * puts a label and its value at opposite ends of half a metre of nothing —
 * three of those read as a table rather than as a person's settings. A grid with
 * the control column sized to its content keeps them related.
 *
 * `block` is for a control too wide to sit beside its label — the direction pair,
 * which is itself two named sides and a swap. It takes the full row and the label
 * sits above it.
 */
export function SettingsSectionRow({
  label,
  note,
  block,
  children,
}: {
  label: string;
  /** What this setting means, or when it takes effect. */
  note?: string;
  block?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'border-hairline grid items-center gap-x-6 gap-y-2 border-b py-3.5 last:border-b-0',
        block ? 'grid-cols-1' : 'grid-cols-[minmax(0,1fr)_auto]',
      )}
    >
      <div className="flex min-w-0 max-w-[38ch] flex-col gap-0.5">
        <span className="text-body font-medium">{label}</span>
        {note ? <span className="text-muted-foreground text-hint">{note}</span> : null}
      </div>
      <div className={cn('flex min-w-0 items-center gap-2.5', block ? '' : 'justify-self-end')}>
        {children}
      </div>
    </div>
  );
}
